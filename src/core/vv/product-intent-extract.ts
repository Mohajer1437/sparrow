import { promises as fs } from 'fs';
import * as path from 'path';
import { QualityProfile } from '../../domain/quality-profile';
import { extractApiRouteFromText, extractHttpMethod } from './api-route';
import {
  CheckpointQuestion,
  ProductAmbiguity,
  ProductAssumption,
  ProductIntent,
  ProductRisk,
  ProductValidationRequest,
  ResolvedProductAnswer,
} from '../../domain/product-analysis';

export interface RepoSignals {
  readonly hasCookieAuth: boolean;
  readonly hasLoginRoute: boolean;
  readonly hasAppRouterHome: boolean;
  readonly apiRoutes: ReadonlyArray<string>;
  readonly evidence: ReadonlyArray<string>;
}

export interface ExtractedIntent {
  readonly intent: ProductIntent;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly assumptions: ReadonlyArray<ProductAssumption>;
  readonly ambiguities: ReadonlyArray<ProductAmbiguity>;
  readonly risks: ReadonlyArray<ProductRisk>;
  readonly checkpointQuestions: ReadonlyArray<CheckpointQuestion>;
  readonly verificationRequirements: ReadonlyArray<string>;
  readonly materialAmbiguityIds: ReadonlyArray<string>;
}

const ACTOR_PATTERNS: ReadonlyArray<{ readonly id: string; readonly re: RegExp }> = [
  { id: 'teacher', re: /\bteachers?\b/i },
  { id: 'student', re: /\bstudents?\b/i },
  { id: 'admin', re: /\badmins?(istrators?)?\b/i },
  { id: 'anonymous visitor', re: /\b(anonymous visitors?|anonymous users?|unauthenticated|logged[- ]out)\b/i },
  { id: 'authenticated user', re: /\b(authenticated users?|logged[- ]in users?)\b/i },
  { id: 'guest', re: /\bguests?\b/i },
  { id: 'owner', re: /\bowners?\b/i },
  { id: 'service', re: /\b(service account|backend service)\b/i },
];

const FILE_QUESTION = /what files? should i change|which files? (should|do) i (change|modify)|no specific file/i;

export function stripNegatedClauses(text: string): string {
  return text.replace(/\b(do not|don't|dont|without)\b[^.]*\.?/gi, ' ');
}

export function extractActors(task: string): string[] {
  const found: string[] = [];
  for (const pattern of ACTOR_PATTERNS) {
    if (pattern.re.test(task)) found.push(pattern.id);
  }
  return found;
}

export function extractConstraints(task: string): string[] {
  const found: string[] = [];
  const re = /\b((?:Do not|Don't|Dont|Keep existing|Without adding)[^.]+)\.?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(task)) !== null) {
    const item = match[1].trim();
    if (item.length > 6) found.push(item.replace(/\s+/g, ' '));
  }
  return unique(found);
}

export function extractCapabilities(task: string): string[] {
  const found: string[] = [];
  const source = stripNegatedClauses(task);
  const re = /\b(add|keep|reject|persist|create|require|return|show|display|prevent)\b[^.!]{0,80}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const item = match[0].replace(/\s+/g, ' ').trim();
    if (item.length >= 8 && item.length <= 120) found.push(item);
    if (found.length >= 8) break;
  }
  return unique(found);
}

export function extractTestIds(task: string): string[] {
  return unique(
    [...task.matchAll(/(?:data-testid|test[\s-]?id)\s*[:=]\s*['"]?([A-Za-z0-9:_-]+)/gi)].map(match => match[1]),
  );
}

export function stripWrappingQuotes(value: string): string {
  let v = value.trim();
  for (let i = 0; i < 4; i++) {
    if (v.length < 2) break;
    const start = v[0];
    const end = v[v.length - 1];
    const pair = (start === '"' && end === '"')
      || (start === "'" && end === "'")
      || (start === '\u201c' && end === '\u201d')
      || (start === '\u2018' && end === '\u2019');
    if (!pair) break;
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function extractExactTexts(task: string): string[] {
  return unique(
    [...task.matchAll(/exact(?:ly)?(?:\s+visible)?\s+text(?:\s+to)?\s+(.+?)(?:\s+and\b|,|\.|$)/gi)]
      .map(match => stripWrappingQuotes(match[1].trim().replace(/[.,;:]+$/, '').trim()))
      .filter(Boolean),
  );
}

export function extractExpectedOutcomes(task: string): string[] {
  const found: string[] = [];
  for (const testId of extractTestIds(task)) {
    found.push('Element with data-testid="' + testId + '" is visible.');
  }
  for (const exact of extractExactTexts(task)) {
    found.push('Exact visible text "' + exact + '" is shown.');
  }
  const status = task.match(/\b(return|returns|receive|status)\b[^.]{0,40}\b(401|403|400|404|200|201)\b/i);
  if (status) found.push(status[0].replace(/\s+/g, ' ').trim());
  const persist = task.match(/\b(persisted|associated|created|saved)\b[^.']{0,80}/i);
  if (persist) found.push(persist[0].replace(/\s+/g, ' ').trim());
  return unique(found);
}

export function extractUserGoal(task: string): string {
  const withoutConstraints = task
    .replace(/\b(Do not|Don't|Dont)[^.]*\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = (withoutConstraints.split(/(?<=\.)\s+/)[0] || withoutConstraints).trim();
  if (!sentence) return 'Unspecified product goal';
  return sentence.slice(0, 280);
}

export function looksLikeUi(task: string): boolean {
  return /\b(page|ui|button|form|browser|frontend|next\.js|react|data-testid|visible text|footer|layout)\b/i.test(task);
}

export function looksLikeApi(task: string): boolean {
  return /\b(api|endpoint|\/api\/)\b/i.test(task)
    || /\b(POST|PUT|PATCH|DELETE)\s+\/api\//.test(task)
    || /\/api\/[A-Za-z0-9/_-]+/.test(task);
}

export function isIntroducingAuth(task: string): boolean {
  const cleaned = stripNegatedClauses(task);
  return /\b(add|create|implement|introduce|build)\b[\s\S]{0,48}\b(login|sign[- ]?in|sign[- ]?up|registration|authentication|oauth|jwt)\b/i.test(cleaned)
    || /\b(login|sign[- ]?in|registration) (page|flow|so users)\b/i.test(cleaned);
}

export function hasSpecificAuthMechanism(task: string): boolean {
  return /\b(oauth|jwt|session cookie|magic link|password|existing cookie|cookie session|auth cookie|cookie auth)\b/i.test(task);
}

export function hasOwnershipSpecified(task: string): boolean {
  return /\bonly (the )?owner\b/i.test(task)
    || /\bowner[- ]only\b/i.test(task)
    || /\btheir (own )?(classes|assignments|resources)\b/i.test(task)
    || /\bcannot (edit|modify|update|delete) (another|other|someone else's)\b/i.test(task)
    || /\bonly class teachers\b/i.test(task)
    || /\bany teacher can (edit|modify)\b/i.test(task);
}

export function isOwnershipAmbiguous(task: string): boolean {
  const cleaned = stripNegatedClauses(task);
  if (hasOwnershipSpecified(cleaned) || hasOwnershipSpecified(task)) return false;
  const mutates = /\b(edit|modify|update|delete|manage|create)\b/i.test(cleaned);
  if (!mutates) return false;
  const teachersAndAssignments = /\bteachers?\b/i.test(cleaned) && /\bassignments?\b/i.test(cleaned);
  const principalAndResource = /\b(teacher|student|admin|user|owner)\b/i.test(cleaned)
    && /\b(resource|assignment|record|item|account)\b/i.test(cleaned);
  return teachersAndAssignments || principalAndResource;
}

export function mentionsDestructive(task: string): boolean {
  return /\b(delete all|drop database|wipe|destroy production|remove all users|delete account)\b/i.test(stripNegatedClauses(task));
}

export function emptyRepoSignals(): RepoSignals {
  return { hasCookieAuth: false, hasLoginRoute: false, hasAppRouterHome: false, apiRoutes: [], evidence: [] };
}

export async function readRepoSignals(
  workspacePath: string | undefined,
  profile: QualityProfile,
): Promise<RepoSignals> {
  if (!workspacePath || profile === 'MVP') return emptyRepoSignals();
  const evidence: string[] = [];
  let hasCookieAuth = false;
  let hasLoginRoute = false;
  let hasAppRouterHome = false;
  const apiRoutes: string[] = [];

  const middlewareCandidates = ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js'];
  for (const rel of middlewareCandidates) {
    const full = path.join(workspacePath, rel);
    try {
      const content = (await fs.readFile(full, 'utf8')).slice(0, 4000);
      if (/cookie|auth\s*=/i.test(content)) {
        hasCookieAuth = true;
        evidence.push(rel + ' uses cookie/session auth');
      }
      break;
    } catch {
      // try next
    }
  }

  const loginCandidates = ['app/login/page.tsx', 'src/app/login/page.tsx', 'app/login/page.jsx'];
  for (const rel of loginCandidates) {
    try {
      await fs.access(path.join(workspacePath, rel));
      hasLoginRoute = true;
      evidence.push(rel + ' exists');
      break;
    } catch {
      // try next
    }
  }

  const homeCandidates = ['app/page.tsx', 'src/app/page.tsx', 'app/page.jsx'];
  for (const rel of homeCandidates) {
    try {
      await fs.access(path.join(workspacePath, rel));
      hasAppRouterHome = true;
      evidence.push(rel + ' is the App Router home page');
      break;
    } catch {
      // try next
    }
  }

  const apiRoots = [
    path.join(workspacePath, 'app', 'api'),
    path.join(workspacePath, 'src', 'app', 'api'),
  ];
  for (const root of apiRoots) {
    try {
      const names = await fs.readdir(root);
      for (const name of names.slice(0, 12)) {
        apiRoutes.push('/api/' + name);
      }
    } catch {
      // missing
    }
  }

  return { hasCookieAuth, hasLoginRoute, hasAppRouterHome, apiRoutes, evidence };
}

export function answerResolves(
  answers: ReadonlyArray<ResolvedProductAnswer> | undefined,
  id: string,
): string | undefined {
  if (!answers || answers.length === 0) return undefined;
  const hit = answers.find(item =>
    item.question.toLowerCase().includes(id.toLowerCase())
    || id.toLowerCase().includes(item.question.toLowerCase()),
  );
  return hit?.answer.trim() || undefined;
}

export function buildExtractedIntent(
  request: ProductValidationRequest,
  signals: RepoSignals,
): ExtractedIntent {
  const task = request.task || '';
  const profile = request.qualityProfile;
  const constraints = extractConstraints(task);
  const actors = extractActors(task);
  const capabilities = extractCapabilities(task);
  const outcomes = extractExpectedOutcomes(task);
  const userGoal = extractUserGoal(task);
  const ui = looksLikeUi(task);
  const api = looksLikeApi(task);

  const assumptions: ProductAssumption[] = [];
  const ambiguities: ProductAmbiguity[] = [];
  const risks: ProductRisk[] = [];
  const checkpointQuestions: CheckpointQuestion[] = [];
  const materialAmbiguityIds: string[] = [];
  const acceptanceCriteria: string[] = [];
  const verificationRequirements: string[] = [];

  const resolvedOwnership = answerResolves(request.resolvedAnswers, 'ownership')
    || (hasOwnershipSpecified(task) ? (task.match(/\bonly (the )?owner\b[^.']*/i) || ['only the owner'])[0] : undefined);
  const resolvedAuth = answerResolves(request.resolvedAnswers, 'auth');

  acceptanceCriteria.push('Existing project behavior that is out of scope remains unchanged.');

  if (/\b(fix|bug|error|broken)\b/i.test(task)) {
    acceptanceCriteria.push('The reported defect is no longer reproducible.');
  }

  const testIds = extractTestIds(task);
  const exactTexts = extractExactTexts(task);
  for (const testId of testIds) {
    acceptanceCriteria.push(
      'Given the requested page is open, when it renders, then the element with data-testid="'
      + testId + '" is visible.',
    );
  }
  for (const exact of exactTexts) {
    acceptanceCriteria.push(
      'Given the requested page is open, when it renders, then the exact visible text '
      + exact + '.',
    );
  }

  const apiRoute = extractApiRouteFromText(task);
  const apiMethod = extractHttpMethod(task);
  const wantsAuthz = /\b(only authenticated|authenticated users? may|unauthenticated|401|403)\b/i.test(task)
    && !isIntroducingAuth(task);

  if (wantsAuthz && apiRoute) {
    const method = apiMethod || 'POST';
    acceptanceCriteria.push(
      'Given an unauthenticated caller, when ' + method + ' ' + apiRoute
      + ' is issued, then the response status is 401 or 403.',
    );
    acceptanceCriteria.push(
      'Given an authenticated caller using the existing session, when ' + method + ' ' + apiRoute
      + ' is issued with valid input, then the request is not rejected solely for being unauthenticated.',
    );
  }

  if (resolvedOwnership) {
    acceptanceCriteria.push(
      'Given a resource owned by one actor, when another actor attempts to edit it, then only the owner is allowed unless the accepted decision says otherwise. Accepted: '
      + resolvedOwnership + '.',
    );
  }

  if (actors.includes('teacher') && /\bassignments?\b/i.test(task) && /\bcreate\b/i.test(task)) {
    acceptanceCriteria.push(
      'Given a valid teacher and class, when an assignment is submitted, then an assignment is persisted and associated with that class.',
    );
  }

  if (ui && testIds.length === 0 && exactTexts.length === 0 && !/\b(fix|bug|error|broken)\b/i.test(task) && profile !== 'MVP') {
    acceptanceCriteria.push('The requested user-facing outcome is implemented and observable.');
  }

  if (api && !wantsAuthz && profile !== 'MVP') {
    acceptanceCriteria.push('API responses match the intended contract for success and error cases.');
  }

  if (profile === 'PRODUCTION' && ui && (testIds.length > 0 || exactTexts.length > 0)) {
    acceptanceCriteria.push('The changed UI path can be opened and used without console errors.');
  }
  if (profile === 'PRODUCTION' && api && /\b(400|422|invalid|malformed|missing)\b/i.test(task)) {
    acceptanceCriteria.push(
      'Given invalid or missing input on the named API, when the request is submitted, then a 4xx client error is returned rather than a 5xx.',
    );
  }

  if (profile === 'MVP') {
    while (acceptanceCriteria.length > 3) acceptanceCriteria.pop();
  }

  const incoming = [
    ...(request.intakeAmbiguities ?? []),
    ...(request.clarificationQuestions ?? []),
  ];
  for (const item of incoming) {
    if (FILE_QUESTION.test(item) || /no specific file/i.test(item) || /no clear success criteria/i.test(item)) {
      const assumption: ProductAssumption = {
        statement: 'Implementation file-scope and success checks can be inferred from the prompt and existing project layout.',
        reason: item,
        confidence: 'HIGH',
        impact: 'Low',
      };
      assumptions.push(assumption);
      ambiguities.push({
        id: 'file-scope',
        text: item,
        classification: 'SAFE_ASSUMPTION',
        reason: 'File choice is a Planner concern; Product QA does not ask which files to change.',
      });
    } else if (isMaterialIncoming(item) && profile === 'PRODUCTION') {
      ambiguities.push({
        id: 'incoming-material',
        text: item,
        classification: 'BLOCKING',
        reason: 'Incoming clarification is material to product behavior.',
      });
      checkpointQuestions.push({
        id: 'incoming-material-' + String(checkpointQuestions.length),
        question: item,
        context: 'This uncertainty is material to product behavior and must be answered in the single human checkpoint.',
      });
      materialAmbiguityIds.push(item);
    } else {
      assumptions.push({
        statement: item,
        reason: 'Recorded as a non-blocking intake note.',
        confidence: 'MEDIUM',
        impact: 'Low',
      });
      ambiguities.push({
        id: 'incoming-note',
        text: item,
        classification: 'NON_BLOCKING',
        reason: 'Does not materially change the requested product.',
      });
    }
  }

  if (signals.hasAppRouterHome && (ui || testIds.length > 0) && /\bapp\/page\.tsx\b/i.test(task)) {
    assumptions.push({
      statement: 'The named App Router home file is the intended UI surface.',
      reason: 'The prompt names app/page.tsx and the repository already uses that as the home page.',
      confidence: 'HIGH',
      impact: 'Low',
    });
  } else if (signals.hasAppRouterHome && ui && !/\bapp\/page\.tsx\b/i.test(task) && testIds.length === 0) {
    assumptions.push({
      statement: 'Home UI work targets the existing App Router page.',
      reason: 'Repository convention: app/page.tsx (or src/app/page.tsx) is the home surface.',
      confidence: 'HIGH',
      impact: 'Low',
    });
  }

  if (testIds.length > 0 && /\bdata-testid\b/i.test(task)) {
    assumptions.push({
      statement: 'The named data-testid is the observable acceptance hook.',
      reason: 'Existing product verification already uses data-testid locators.',
      confidence: 'HIGH',
      impact: 'Low',
    });
  }

  if (wantsAuthz && (signals.hasCookieAuth || hasSpecificAuthMechanism(task) || resolvedAuth)) {
    assumptions.push({
      statement: 'Reuse the existing cookie/session authentication already present in the product.',
      reason: signals.hasCookieAuth
        ? (signals.evidence.find(item => /cookie/i.test(item)) || 'Repository middleware already implements cookie auth.')
        : 'The prompt specifies the existing cookie/session mechanism.',
      confidence: 'HIGH',
      impact: 'Medium',
    });
    ambiguities.push({
      id: 'auth-mechanism',
      text: 'Authentication mechanism for the authorization boundary',
      classification: 'SAFE_ASSUMPTION',
      reason: 'Existing product session can be reused; a new auth stack is not requested.',
    });
  }

  if (/\bsuccess feedback\b/i.test(task) && !/\b(toast|inline|banner|alert)\b/i.test(task)) {
    ambiguities.push({
      id: 'success-feedback-channel',
      text: 'Success feedback channel is unspecified',
      classification: 'NON_BLOCKING',
      reason: 'Toast versus inline copy does not change the requested product outcome.',
    });
  }

  const isInvestigation =
    /\b(read_only|read only|do not modify|do not create|only inspect|only analyze|reconnaissance|understanding report|architecture discovery)\b/i.test(task) ||
    /^\s*(?:\/execute\s+)?(?:analyze|inspect|investigate|explain|explore|audit|survey|understand|review|discovery|map|detect)\b/i.test(task) ||
    /\b(?:perform the following analysis|technical understanding of this)\b/i.test(task);

  if (!isInvestigation) {
    maybeBlockAuth(task, profile, signals, resolvedAuth, wantsAuthz, ambiguities, checkpointQuestions, materialAmbiguityIds, assumptions);
    maybeBlockPayment(task, profile, ambiguities, checkpointQuestions, materialAmbiguityIds, assumptions);
    maybeBlockPermissions(task, profile, ambiguities, checkpointQuestions, materialAmbiguityIds, assumptions);
    maybeBlockOwnership(task, profile, resolvedOwnership, ambiguities, checkpointQuestions, materialAmbiguityIds, assumptions);
    maybeBlockDestructive(task, profile, ambiguities, checkpointQuestions, materialAmbiguityIds, assumptions);
    maybeBlockExclusiveOr(task, profile, ambiguities, checkpointQuestions, materialAmbiguityIds, assumptions);
  } else {
    assumptions.push({
      statement: 'Read-only analysis task: inspecting existing implementation without mutating project behavior.',
      reason: 'Task is an investigation/analysis request.',
      confidence: 'HIGH',
      impact: 'Low',
    });
  }

  if (profile === 'MVP') {
    checkpointQuestions.length = 0;
    for (const item of ambiguities) {
      if (item.classification === 'BLOCKING') {
        assumptions.push({
          statement: 'MVP assumption for ' + item.id + ': use the safest conventional implementation already present in the repo.',
          reason: 'MVP only blocks questions that make implementation impossible.',
          confidence: 'MEDIUM',
          impact: 'Low',
        });
      }
    }
  } else if (profile === 'STANDARD') {
    const allowed = new Set(['destructive', 'payment', 'auth-mechanism', 'permissions', 'ownership', 'exclusive-or']);
    const kept = checkpointQuestions.filter(item => allowed.has(item.id));
    checkpointQuestions.splice(0, checkpointQuestions.length, ...kept);
  }

  pushRisks(task, profile, request.riskLevel, wantsAuthz, ui, api, risks);

  verificationRequirements.push('deterministic');
  if (ui || testIds.length > 0 || exactTexts.length > 0) verificationRequirements.push('browser');
  if (api || apiRoute) verificationRequirements.push('api');
  if (wantsAuthz) verificationRequirements.push('authorization-boundary');
  if (/\b(persist|save|create assignment|associated)\b/i.test(task)) verificationRequirements.push('persistence');
  if (testIds.length > 0 || exactTexts.length > 0) verificationRequirements.push('user-visible-success');
  if (profile !== 'MVP' && (wantsAuthz || api)) verificationRequirements.push('user-visible-failure');
  if (profile !== 'MVP' && acceptanceCriteria.length > 0) verificationRequirements.push('intent-contract');
  if (profile !== 'MVP' && (wantsAuthz || isIntroducingAuth(task) || mentionsDestructive(task))) {
    verificationRequirements.push('security');
  }
  if (profile === 'PRODUCTION' && (wantsAuthz || mentionsDestructive(task))) {
    verificationRequirements.push('adversarial');
  }
  if (profile === 'MVP') {
    const allowed = new Set(['deterministic', 'browser', 'api']);
    const filtered = unique(verificationRequirements.filter(item => allowed.has(item)));
    verificationRequirements.splice(0, verificationRequirements.length, ...filtered);
  }

  const intent: ProductIntent = {
    userGoal,
    requestedCapabilities: capabilities,
    actors,
    expectedOutcomes: outcomes.length > 0 ? outcomes : [userGoal],
    importantConstraints: constraints,
  };

  return {
    intent,
    acceptanceCriteria: unique(acceptanceCriteria),
    assumptions: dedupeAssumptions(assumptions),
    ambiguities,
    risks: profile === 'MVP' ? risks.filter(item => item.severity === 'HIGH').slice(0, 1) : risks,
    checkpointQuestions: uniqueQuestions(checkpointQuestions),
    verificationRequirements: unique(verificationRequirements),
    materialAmbiguityIds: unique(materialAmbiguityIds),
  };
}

function maybeBlockAuth(
  task: string,
  profile: QualityProfile,
  signals: RepoSignals,
  resolvedAuth: string | undefined,
  wantsAuthz: boolean,
  ambiguities: ProductAmbiguity[],
  checkpointQuestions: CheckpointQuestion[],
  materialIds: string[],
  assumptions: ProductAssumption[],
): void {
  const mentionsAuthWord = /\b(login|sign[- ]?in|oauth|jwt)\b/i.test(stripNegatedClauses(task));
  if (!mentionsAuthWord && !isIntroducingAuth(task)) return;
  if (resolvedAuth || hasSpecificAuthMechanism(task)) return;
  if (wantsAuthz && (signals.hasCookieAuth || hasSpecificAuthMechanism(task))) return;
  if (!isIntroducingAuth(task) && signals.hasCookieAuth) {
    assumptions.push({
      statement: 'Continue using the repository cookie/session login.',
      reason: 'Auth is referenced but a new mechanism is not requested, and cookie auth already exists.',
      confidence: 'HIGH',
      impact: 'Low',
    });
    ambiguities.push({
      id: 'auth-mechanism',
      text: 'Which authentication mechanism',
      classification: 'SAFE_ASSUMPTION',
      reason: 'Existing cookie session is sufficient evidence.',
    });
    return;
  }
  materialIds.push('auth-mechanism');
  ambiguities.push({
    id: 'auth-mechanism',
    text: 'Authentication mechanism is unspecified',
    classification: 'BLOCKING',
    reason: 'The chosen mechanism changes security boundaries and acceptance.',
  });
  if (profile === 'PRODUCTION' || profile === 'STANDARD') {
    checkpointQuestions.push({
      id: 'auth-mechanism',
      question: 'Which authentication mechanism and session model should be used?',
      context: 'The request introduces login/authentication but does not name OAuth, JWT, session cookies, magic links, or passwords. That choice changes security boundaries and how V&V will accept the feature.',
      options: ['Session cookie', 'JWT', 'OAuth', 'Password session'],
    });
  }
}

function maybeBlockPayment(
  task: string,
  profile: QualityProfile,
  ambiguities: ProductAmbiguity[],
  checkpointQuestions: CheckpointQuestion[],
  materialIds: string[],
  assumptions: ProductAssumption[],
): void {
  if (!/\b(payment|checkout|billing|pricing|subscription)\b/i.test(stripNegatedClauses(task))) return;
  if (/\b(stripe|paypal|free|one[- ]time|subscription)\b/i.test(task)) {
    assumptions.push({
      statement: 'Use the payment mechanism named in the request.',
      reason: 'The prompt already names the commercial mechanism.',
      confidence: 'HIGH',
      impact: 'High',
    });
    return;
  }
  materialIds.push('payment');
  ambiguities.push({
    id: 'payment',
    text: 'Payment or pricing behavior is unspecified',
    classification: 'BLOCKING',
    reason: 'Financial behavior changes acceptance and business outcomes.',
  });
  if (profile === 'PRODUCTION' || profile === 'STANDARD') {
    checkpointQuestions.push({
      id: 'payment',
      question: 'What is the required payment or pricing behavior?',
      context: 'The request mentions payment, checkout, billing, or pricing without naming the commercial model. That decision is material.',
      options: ['One-time payment', 'Subscription', 'Free'],
    });
  }
}

function maybeBlockPermissions(
  task: string,
  profile: QualityProfile,
  ambiguities: ProductAmbiguity[],
  checkpointQuestions: CheckpointQuestion[],
  materialIds: string[],
  assumptions: ProductAssumption[],
): void {
  if (!/\b(permission|role|rbac|admin-only|authorization)\b/i.test(stripNegatedClauses(task))) return;
  if (/\b(admin|user|guest|owner)\b/i.test(task) && /\b(can|cannot|allowed|denied)\b/i.test(task)) {
    assumptions.push({
      statement: 'Honor the role allow/deny wording already in the request.',
      reason: 'Roles and allow/deny are explicit.',
      confidence: 'HIGH',
      impact: 'Medium',
    });
    return;
  }
  materialIds.push('permissions');
  ambiguities.push({
    id: 'permissions',
    text: 'Which roles may perform the action is unspecified',
    classification: 'BLOCKING',
    reason: 'Permissions change authorization boundaries and acceptance.',
  });
  if (profile === 'PRODUCTION' || profile === 'STANDARD') {
    checkpointQuestions.push({
      id: 'permissions',
      question: 'Which roles are allowed to perform this action?',
      context: 'The request mentions roles or permissions without stating who is allowed or denied. That changes authorization and acceptance criteria.',
      options: ['Admin only', 'Authenticated users', 'Owner only'],
    });
  }
}

function maybeBlockOwnership(
  task: string,
  profile: QualityProfile,
  resolvedOwnership: string | undefined,
  ambiguities: ProductAmbiguity[],
  checkpointQuestions: CheckpointQuestion[],
  materialIds: string[],
  assumptions: ProductAssumption[],
): void {
  if (resolvedOwnership || hasOwnershipSpecified(task)) {
    if (resolvedOwnership) {
      assumptions.push({
        statement: 'Ownership decision: ' + resolvedOwnership,
        reason: 'The user already answered this product question.',
        confidence: 'HIGH',
        impact: 'High',
      });
    }
    return;
  }
  if (!isOwnershipAmbiguous(task)) return;
  materialIds.push('ownership');
  ambiguities.push({
    id: 'ownership',
    text: 'Resource ownership for edit/manage is unspecified',
    classification: 'BLOCKING',
    reason: 'Whether another principal may mutate a resource changes permissions, data ownership, and acceptance.',
  });
  if (profile === 'PRODUCTION' || profile === 'STANDARD') {
    checkpointQuestions.push({
      id: 'ownership',
      question: 'Should an administrator or other teacher be allowed to modify resources owned by another teacher, or should only the owner be allowed?',
      context: 'The request lets a teacher create or edit assignments/resources but does not say whether ownership is exclusive. That decision changes permissions, data ownership, and what V&V must accept.',
      options: ['Only the owner can edit', 'Any teacher can edit any assignment'],
    });
  }
}

function maybeBlockDestructive(
  task: string,
  profile: QualityProfile,
  ambiguities: ProductAmbiguity[],
  checkpointQuestions: CheckpointQuestion[],
  materialIds: string[],
  assumptions: ProductAssumption[],
): void {
  if (!mentionsDestructive(task)) return;
  if (/\b(reversible|soft delete|require confirmation|confirm)\b/i.test(task)) {
    assumptions.push({
      statement: 'Honor the stated destructive-safety wording.',
      reason: 'The prompt already constrains irreversibility or confirmation.',
      confidence: 'HIGH',
      impact: 'High',
    });
    return;
  }
  materialIds.push('destructive');
  ambiguities.push({
    id: 'destructive',
    text: 'Destructive data-loss boundary is unspecified',
    classification: 'BLOCKING',
    reason: 'Deletion or wipe changes lifecycle and cannot be guessed.',
  });
  if (profile === 'PRODUCTION' || profile === 'STANDARD') {
    checkpointQuestions.push({
      id: 'destructive',
      question: 'This action is destructive. Should it be reversible, or require explicit confirmation, and what is the exact data-loss boundary?',
      context: 'The request includes deletion or wipe behavior without saying whether it is reversible or confirmed. Guessing would be unsafe.',
      options: ['Require confirmation and keep it irreversible', 'Soft-delete / reversible'],
    });
  }
}

function maybeBlockExclusiveOr(
  task: string,
  profile: QualityProfile,
  ambiguities: ProductAmbiguity[],
  checkpointQuestions: CheckpointQuestion[],
  materialIds: string[],
  assumptions: ProductAssumption[],
): void {
  if (!/\b(either|or alternatively)\b/i.test(stripNegatedClauses(task))) return;
  materialIds.push('exclusive-or');
  ambiguities.push({
    id: 'exclusive-or',
    text: 'Alternative product behaviors were offered',
    classification: 'BLOCKING',
    reason: 'Choosing either alternative changes the accepted product.',
  });
  if (profile === 'PRODUCTION' || profile === 'STANDARD') {
    checkpointQuestions.push({
      id: 'exclusive-or',
      question: 'Which of the alternative product behaviors is required?',
      context: 'The request offers mutually exclusive behaviors. Product QA will not pick one silently.',
    });
  }
}

function pushRisks(
  task: string,
  profile: QualityProfile,
  riskLevel: string | undefined,
  wantsAuthz: boolean,
  ui: boolean,
  api: boolean,
  risks: ProductRisk[],
): void {
  risks.push({
    category: 'Functional',
    description: 'The delivered behavior may not match the stated user goal.',
    severity: 'MEDIUM',
  });
  if (wantsAuthz || /\b(permission|owner|authenticated)\b/i.test(task)) {
    risks.push({
      category: 'Authorization',
      description: 'A technically valid implementation may still allow the wrong actor to mutate or read the resource.',
      severity: 'HIGH',
    });
  }
  if (isIntroducingAuth(task) || /\blogin\b/i.test(task)) {
    risks.push({
      category: 'Authentication',
      description: 'Session establishment may be incomplete or inconsistent with existing login.',
      severity: 'HIGH',
    });
  }
  if (/\b(save|persist|create|assignment|record)\b/i.test(task)) {
    risks.push({
      category: 'Data Integrity',
      description: 'Records may be stored without the required association or uniqueness.',
      severity: 'MEDIUM',
    });
  }
  if (/\b(session|logged[- ]in|cookie)\b/i.test(task)) {
    risks.push({
      category: 'User State',
      description: 'Authenticated and anonymous states may diverge from the accepted intent.',
      severity: 'MEDIUM',
    });
  }
  if (mentionsDestructive(task)) {
    risks.push({
      category: 'Destructive Behavior',
      description: 'Deletion is destructive and may be irreversible.',
      severity: 'HIGH',
    });
  }
  if (api && /\b(400|error|fail|invalid)\b/i.test(task)) {
    risks.push({
      category: 'Failure Handling',
      description: 'Invalid input or unauthorized callers may receive the wrong status or no user-visible failure.',
      severity: 'MEDIUM',
    });
  }
  if (/\b(concurrent|race|same time)\b/i.test(task)) {
    risks.push({
      category: 'Concurrency',
      description: 'Concurrent writes may corrupt or duplicate records.',
      severity: 'MEDIUM',
    });
  }
  if (/\b(stripe|paypal|third[- ]party|webhook)\b/i.test(task)) {
    risks.push({
      category: 'External Dependency',
      description: 'Behavior depends on an external service that can fail independently.',
      severity: 'MEDIUM',
    });
  }
  if (ui && profile === 'PRODUCTION') {
    risks.push({
      category: 'UX Criticality',
      description: 'The user-visible success state may be missing even if persistence succeeds.',
      severity: 'LOW',
    });
  }
  if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
    risks.push({
      category: 'Functional',
      description: 'Pre-execution risk is ' + riskLevel + '.',
      severity: 'HIGH',
    });
  }
}

function isMaterialIncoming(text: string): boolean {
  return /\b(auth|login|payment|permission|delete all|ownership|unspecified product)\b/i.test(text)
    || /cannot (infer|determine)/i.test(text);
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function uniqueQuestions(items: CheckpointQuestion[]): CheckpointQuestion[] {
  const seen = new Set<string>();
  const out: CheckpointQuestion[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function dedupeAssumptions(items: ProductAssumption[]): ProductAssumption[] {
  const seen = new Set<string>();
  const out: ProductAssumption[] = [];
  for (const item of items) {
    if (seen.has(item.statement)) continue;
    seen.add(item.statement);
    out.push(item);
  }
  return out;
}
