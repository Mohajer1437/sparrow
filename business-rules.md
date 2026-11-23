<div dir="rtl">

# 📜 سند کامل قوانین بیزینس پروژه Sparrow CLI

> **نسخه سند**: 2.0
> **تاریخ**: تیر ۱۴۰۵
> **مراحل تکمیل‌شده**: R1, Knowledge Pipeline, R2.1–R2.6, R3.1–R3.8, R4.5–R4.26  
> **وضعیت فعلی**: R4 Foundation Architecture — FROZEN (r4-foundation-complete)

---

## 📑 فهرست مطالب

1. [معرفی پروژه](#-معرفی-پروژه)
2. [چشم‌انداز محصول](#-چشم‌انداز-محصول)
3. [قوانین مطلق (NEVER)](#-قوانین-مطلق-never)
4. [قوانین اجباری (ALWAYS)](#-قوانین-اجباری-always)
5. [اصول معماری](#-اصول-معماری)
6. [قوانین پچ‌نویسی](#-قوانین-پچ‌نویسی)
7. [قوانین مدیریت Session](#-قوانین-مدیریت-session)
8. [قوانین اجرای ایمن پچ (R2.6)](#-قوانین-اجرای-ایمن-پچ-r26)
9. [قوانین یکپارچگی Git (R2.5)](#-قوانین-یکپارچگی-git-r25)
10. [قوانین Checkpoint و Recovery (R4.18–R4.22)](#-قوانین-checkpoint-و-recovery-r418r422)
11. [قوانین Audit Trail (R4.23)](#-قوانین-audit-trail-r423)
12. [قوانین Runtime Protection (R4.12)](#-قوانین-runtime-protection-r412)
13. [قوانین Observability (R4.15)](#-قوانین-observability-r415)
14. [قوانین Configuration (R4.7–R4.8)](#-قوانین-configuration-r47r48)
15. [قوانین Memory Boundary (R4.10)](#-قوانین-memory-boundary-r410)
16. [قوانین تست](#-قوانین-تست)
17. [امضاهای حیاتی کد](#-امضاهای-حیاتی-کد)
18. [ابزارهای Workspace](#-ابزارهای-workspace)
19. [دستورات CLI](#-دستورات-cli)
20. [سیستم Multi-Agent](#-سیستم-multi-agent)
21. [مراحل تکمیل‌شده](#-مراحل-تکمیل‌شده)
22. [محدودیت‌های شناخته‌شده](#-محدودیت‌های-شناخته‌شده)
23. [نقشه راه آینده](#-نقشه-راه-آینده)
24. [دستور شروع در چت جدید](#-دستور-شروع-در-چت-جدید)

---

## 🎯 معرفی پروژه

**Sparrow CLI** یک AI Software Engineer محلی (local-first) است که با TypeScript و Node.js نوشته شده و می‌تواند به صورت خودکار پروژه‌های نرم‌افزاری را درک، برنامه‌ریزی، و به صورت ایمن اصلاح کند.

### ویژگی‌های کلیدی

| ویژگی | توضیح |
|-------|-------|
| **محلی (Local-First)** | بدون نیاز به دیتابیس، همه چیز روی فایل‌سیستم |
| **ایمن (Safe)** | هرگز کد شکسته persist نمی‌شود |
| **قابل بازیابی (Recoverable)** | Checkpoint + Resume بعد از crash |
| **قابل ردیابی (Traceable)** | Audit Trail ماندگار برای هر execution |
| **هوشمند (Intelligent)** | از دانش پروژه برای تصمیم‌گیری بهتر استفاده می‌کند |
| **محافظت‌شده (Protected)** | Governor برای CPU/Memory/Temperature |
| **قابل مشاهده (Observable)** | Telemetry + Diagnostics |
| **مستند (Documented)** | Documentation Intelligence |

---

## 🌟 چشم‌انداز محصول

> **"AI که کد می‌زند" ≠ "AI که فرآیند توسعه را مدیریت می‌کند"**

این پروژه در دسته دوم قرار می‌گیرد. Agent ما فقط کد تولید نمی‌کند، بلکه **فرآیند کامل توسعه نرم‌افزار** را مدیریت می‌کند.

### جریان کامل اجرا (End-to-End Flow)

```
User Request (CLI / REPL)
    ↓
ConversationOrchestrator → TaskExecutor → Provider.generate()
    ↓
AgentOrchestrator (role resolution: coder / reviewer / planner)
    ↓
WorkflowOrchestrator (10-step pipeline)
    ├── Step 1:  Start Session
    ├── Step 2:  Load Memory (WorkspaceMemory + RoleMemory)
    ├── Step 2.5: beforePlan Hook (R4.14)
    ├── Step 3:  Task Planning (LLM)
    ├── Step 3.5: Plan Validation (R4.14)
    ├── Step 3.6: afterPlan Hook (R4.14)
    ├── Step 4:  Impact Analysis
    ├── Step 5:  Deterministic Review
    ├── Step 5.5: Runtime Protection Check (R4.12)
    ├── Step 6:  Safe Patch Execution
    │            ├── Backup + Apply
    │            ├── Verification (TS + Tests)
    │            ├── Checkpoint (R4.19)
    │            ├── Audit (R4.23)
    │            ├── ✅ Pass → Git Commit
    │            └── ❌ Fail → Rollback + Retry (max 3)
    ├── Step 7:  Git Commit
    ├── Step 8:  Reflection
    ├── Step 9:  Post Execution Pipeline (Knowledge Feedback)
    └── Step 10: Complete Session + Final Checkpoint
    ↓
Response to User
```

### جریان Recovery

```
Execution → Checkpoint (بعد از هر step)
    ↓ (قطع شدن)
agent recovery list → شناسایی checkpoint active
    ↓ (انتخاب کاربر — هرگز خودکار نیست)
agent recovery resume <id>
    ↓
RecoveryService.findResumable() → validateCheckpoint()
    ↓
RecoveryService.prepareResumeContext()
    ↓
StepExecutionEngine (resumedFromCheckpoint = true)
    → ادامه از step درست (نه از صفر)
    ↓
Completion → Checkpoint (status: completed) → Audit
```

---

## 🚫 قوانین مطلق (NEVER)

این قوانین **هرگز** نباید نقض شوند. نقض هر یک از این‌ها یک باگ بحرانی است.

### ۱. ایمنی فایل‌سیستم

```
1. NEVER modify files directly without backup
2. NEVER partially apply a failed patch (all-or-nothing)
3. NEVER allow path traversal (sandbox enforcement)
4. NEVER access protected directories (.ai, .git, node_modules)
5. NEVER commit before tests pass
```

### ۲. یکپارچگی داده

```
6. NEVER corrupt session files (always use atomic writes)
7. NEVER store huge LLM responses in sessions
8. NEVER mutate existing events (append-only)
9. NEVER delete failed sessions (they are recoverable)
10. NEVER overwrite existing git history
```

### ۳. معماری

```
11. NEVER introduce a database (local-first filesystem only)
12. NEVER break existing contracts (additive changes only)
13. NEVER throw from contracts (always return result objects or null)
14. NEVER add provider-specific logic in domain/contracts
15. NEVER add Ollama dependency outside core/provider/
16. NEVER import from core/ in domain/ (type-only exceptions noted)
17. NEVER import from core/ in contracts/
```

### ۴. عملیات Git

```
18. NEVER execute destructive git commands:
    - git reset --hard
    - git push --force / push -f
    - git clean -fd
19. NEVER auto-push commits
20. NEVER commit unverified code
```

### ۵. محدودیت‌های اجرایی

```
21. NEVER exceed MAX_ITERATIONS = 50 در Sparrow loop
22. NEVER exceed MAX_PATCH_RETRIES = 3
23. NEVER allow infinite loops (detect identical tool calls)
24. NEVER crash on storage errors (graceful degradation)
```

### ۶. Checkpoint و Recovery (R4.18–R4.22)

```
25. NEVER auto-resume without explicit user confirmation
26. NEVER resume a completed execution
27. NEVER resume an abandoned execution
28. NEVER restart from step zero when checkpoint exists
29. NEVER lose execution identity (executionId, sessionId)
30. NEVER let checkpoint write failure break execution (fail-safe)
```

### ۷. Audit Trail (R4.23)

```
31. NEVER delete or update audit events (append-only)
32. NEVER let audit failure break execution (fail-safe)
33. NEVER use audit data for automatic decision-making
```

### ۸. Runtime Protection (R4.12)

```
34. NEVER skip governor health checks during execution
35. NEVER ignore CPU/Memory/Temperature thresholds
36. NEVER let governor failure crash execution (fail-safe)
```

### ۹. Observability (R4.15)

```
37. NEVER let telemetry influence execution decisions (passive only)
38. NEVER let diagnostics failure break execution
```

### ۱۰. Configuration (R4.7–R4.8)

```
39. NEVER bypass schema validation on config migration
40. NEVER hardcode model names outside default configs
41. NEVER read config without going through ConfigurationLoader
```

---

## ✅ قوانین اجباری (ALWAYS)

این قوانین **همیشه** باید رعایت شوند.

### ۱. قبل از هر تغییر

```
1. ALWAYS create backup before any file modification
2. ALWAYS run verification (TS + tests) after patch
3. ALWAYS rollback on verification failure
4. ALWAYS record retry attempts in session
```

### ۲. یکپارچگی داده

```
5. ALWAYS use atomic writes for session files (temp + rename)
6. ALWAYS keep events append-only
7. ALWAYS use existing abstractions (Workspace, RuntimeRepository)
8. ALWAYS validate input before processing
```

### ۳. Git و Commit

```
9. ALWAYS use conventional commits:
   feat / fix / refactor / test / docs / chore
10. ALWAYS keep first line ≤ 72 chars
11. ALWAYS use safe revert (not reset --hard) for rollback
12. ALWAYS log every git operation in session events
```

### ۴. سازگاری

```
13. ALWAYS maintain backward compatibility
14. ALWAYS run discovery BEFORE writing patches
15. ALWAYS verify TypeScript compilation before committing
16. ALWAYS run in-scope tests during patch verification
```

### ۵. Checkpoint و Recovery

```
17. ALWAYS create checkpoint after each successful step
18. ALWAYS create checkpoint after each failed step
19. ALWAYS preserve executionId and sessionId across resume
20. ALWAYS validate checkpoint before resume
21. ALWAYS use currentStepIndex as tiebreaker in loadLatest
```

### ۶. Audit Trail

```
22. ALWAYS record step_started, step_completed, step_failed events
23. ALWAYS record checkpoint_created events
24. ALWAYS record recovery_triggered events
25. ALWAYS generate unique auditId and timestamp for each event
```

### ۷. Runtime Protection

```
26. ALWAYS check governor before each step execution
27. ALWAYS pause execution when threshold exceeded
28. ALWAYS resume after pause duration (if autoResume enabled)
```

### ۸. Observability

```
29. ALWAYS record telemetry events passively
30. ALWAYS freeze telemetry data (Object.freeze)
```

### ۹. Configuration

```
31. ALWAYS load configuration through ConfigurationLoader
32. ALWAYS validate schema version before migration
33. ALWAYS backup config before migration
```

### ۱۰. Memory Boundary

```
34. ALWAYS enforce role-level memory isolation
35. ALWAYS use RoleMemoryRepository for role-scoped data
36. ALWAYS use WorkspaceMemoryRepository for shared data
```

---

## 🏛️ اصول معماری

### Clean Architecture

```
Domain ← Contracts ← Core ← CLI
```

- **Domain** (44 مدل): انواع داده خالص، immutable، بدون dependency خارجی
- **Contracts** (57 اینترفیس): واسط‌ها، فقط از Domain import می‌کنند
- **Core** (65+ کلاس): پیاده‌سازی‌ها، از Domain + Contracts import می‌کنند
- **CLI**: Presentation layer، فقط از Core (via AppFactory) import می‌کند

### Dependency Rules

```
✅ Domain: فقط از Domain import می‌کند
✅ Contracts: فقط از Domain import می‌کند
✅ Core: از Domain + Contracts import می‌کند
✅ CLI: از Core (via AppFactory) import می‌کند
⚠️ 2 type-only exception: conversation-turn.ts, execution-request.ts (technical debt)
```

### اصول SOLID

| اصل | پیاده‌سازی |
|-----|-----------|
| **S**ingle Responsibility | هر کلاس یک وظیفه دارد |
| **O**pen/Closed | Extend، نه Replace |
| **L**iskov Substitution | پیاده‌سازی‌ها قابل تعویض |
| **I**nterface Segregation | واسط‌های کوچک و متمرکز |
| **D**ependency Inversion | Core به Contracts وابسته است، نه Implementations |

### الگوهای طراحی استفاده‌شده

1. **Additive Extension**: اضافه کردن بدون شکستن
2. **Never-Throw Contracts**: `Promise<T | null>` یا result objects
3. **Fail-Safe by Default**: هر خطا → log + graceful degradation
4. **Append-Only Audit**: events هرگز mutate نمی‌شوند
5. **Atomic Operations**: temp file + rename برای ایمنی
6. **Checkpoint-Resume**: ذخیره state در step boundaryها
7. **Passive Observability**: telemetry هرگز بر execution تأثیر نمی‌گذارد
8. **Governor Pattern**: health check قبل از هر step

### AppFactory (DI Container)

```
65 create method
همه wiring از AppFactory
هیچ direct instantiation در CLI
```

---

## 🔧 قوانین پچ‌نویسی

### اصول کلی

```
1. ALWAYS run discovery script FIRST (read actual files)
2. NEVER guess method signatures or field names
3. NEVER change existing type definitions (add optional fields only)
4. Use `this.rootDir` in AppFactory (NOT this.workspacePath)
```

### الگوی پچ Additive برای Interface

```typescript
// ❌ اشتباه: جایگزین کل interface
export interface WorkspaceSession {
  // ... همه فیلدهای جدید
}

// ✅ درست: اضافه کردن فیلد optional
if "newField" not in content:
    lines.insert(closing_brace_index, '  readonly newField?: Type;')
```

### الگوی Smart Write (create or update)

```python
def smart_write_file(path, content, created_files, modified_files):
    if path.exists():
        current = path.read_text()
        if current == content: return  # UNCHANGED
        backup_file(path)
        atomic_write(path, content)
        modified_files.append(path)
    else:
        atomic_write(path, content)
        created_files.append(path)
```

### اصول Scope Discipline

```
- فقط تست‌های in-scope را در verification اجرا کن
- از --testPathPattern استفاده کن، نه --testPathIgnorePatterns
- اگر تستی خارج از scope است، در پچ نباید اجرا شود
```

---

## 📦 قوانین مدیریت Session

### وضعیت‌های Session

```typescript
export type SessionStatus =
  | 'created'      // تازه ساخته شده
  | 'planning'     // در حال برنامه‌ریزی
  | 'executing'    // در حال اجرا
  | 'validating'   // در حال اعتبارسنجی
  | 'completed'    // موفقیت‌آمیز تمام شد
  | 'failed'       // شکست خورد
  | 'paused'       // توسط Governor متوقف شد
  | 'rolled_back'; // rollback شد (terminal)
```

### ساختار RetryAttempt

```typescript
export interface RetryAttempt {
  readonly attempt: number;       // ⚠️ اجباری
  readonly timestamp: string;     // ⚠️ اجباری
  readonly action: string;        // ⚠️ اجباری
  readonly error: string;         // ⚠️ اجباری (NOT optional!)
  readonly resolution?: string;   // اختیاری
}
```

> **هشدار مهم**: فیلد `error` در `RetryAttempt` اجباری است و **هرگز** نباید `undefined` باشد.

### قوانین مهم Session

```
1. Session failure MUST NOT delete session
2. Failed sessions are recoverable (status: failed → resume)
3. ROLLED_BACK is terminal (cannot resume)
4. Retry history persists across attempts
5. After successful completion: cleanup temp artifacts
6. Sessions stored in .ai/sessions/{id}/session.json
7. Atomic writes prevent corruption
```

---

## 🛡️ قوانین اجرای ایمن پچ (R2.6)

### جریان SafePatchExecutor

```
┌─────────────────────────────────────────────────┐
│  Loop (max 3 attempts)                          │
│                                                  │
│  attempt++                                       │
│  ├─ PatchExecutor.execute(request)              │
│  ├─ VerificationEngine.verify(workspacePath)    │
│  │   ├─ TypeScript: npx tsc --noEmit            │
│  │   ├─ Tests: npm test                          │
│  │   └─ Lint: npm run lint (optional)           │
│  └─ Decision:                                    │
│      ├─ ✅ Pass:                                 │
│      │   └─ updateSession('completed')          │
│      └─ ❌ Fail:                                 │
│          ├─ addRetryAttempt(...)                 │
│          ├─ PatchExecutor.rollback()            │
│          └─ Continue loop                        │
│                                                  │
│  Max retries exceeded:                           │
│  └─ updateSession('rolled_back')                │
└─────────────────────────────────────────────────┘
```

---

## 🔀 قوانین یکپارچگی Git (R2.5)

### Conventional Commits

```
<type>(<scope>): <description>
```

**Types مجاز**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

### دستورات مجاز و غیرمجاز

| وضعیت | دستور |
|--------|-------|
| ✅ مجاز | `git add`, `git commit`, `git revert`, `git status`, `git log` |
| ❌ غیرمجاز | `git reset --hard`, `git push --force`, `git clean -fd` |

---

## 💾 قوانین Checkpoint و Recovery (R4.18–R4.22)

### Checkpoint Model

```typescript
export interface ExecutionCheckpoint {
  readonly checkpointId: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly currentStepIndex: number;
  readonly totalSteps: number;
  readonly completedStepIds: ReadonlyArray<string>;
  readonly pendingStepIds: ReadonlyArray<string>;
  readonly status: 'active' | 'completed' | 'abandoned';
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

### قوانین Checkpoint

```
1. Checkpoint بعد از هر step موفق ساخته می‌شود (status: active)
2. Checkpoint بعد از آخرین step → status: completed
3. Checkpoint بعد از step ناموفق هم ساخته می‌شود
4. Checkpoint write failure → console.warn، execution ادامه دارد
5. Checkpoint در .ai/checkpoints/{checkpointId}.json ذخیره می‌شود
6. loadLatest باید currentStepIndex را به عنوان tiebreaker استفاده کند
7. loadLatest نباید status را فیلتر کند (ResumeEngine.canResume خودش check می‌کند)
```

### قوانین Recovery

```
1. Recovery هرگز خودکار نیست — فقط با تأیید صریح کاربر
2. Recovery completed execution را resume نمی‌کند
3. Recovery abandoned execution را resume نمی‌کند
4. Resume از step درست شروع می‌شود (نه از صفر)
5. executionId و sessionId حفظ می‌شوند
6. stepهای completed دوباره اجرا نمی‌شوند
7. corrupted checkpoint → null (fail-safe)
8. missing checkpoint → null (fail-safe)
```

### StepExecutionEngine Resume Logic

```typescript
const startIndex = context.resumedFromCheckpoint ? context.currentStepIndex : 0;
for (let i = startIndex; i < plan.steps.length; i++) {
  // ...
}
```

---

## 📝 قوانین Audit Trail (R4.23)

### Event Types

```typescript
export type AuditEventType =
  | 'execution_started'
  | 'execution_resumed'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'checkpoint_created'
  | 'recovery_triggered'
  | 'execution_completed'
  | 'execution_failed';
```

### قوانین Audit

```
1. Audit append-only است — هرگز delete/update نمی‌شود
2. Audit failure هرگز execution را break نمی‌کند (fail-safe)
3. Audit passive است — هرگز بر execution تأثیر نمی‌گذارد
4. هر event دارای auditId و timestamp منحصربه‌فرد است
5. Audit در .ai/audit/{executionId}.json ذخیره می‌شود
6. همه eventها Object.freeze هستند (immutable)
```

### Integration Points

```
StepExecutionEngine:
  - step_started (بعد از recordStepStarted)
  - step_completed (بعد از recordStepCompleted)
  - step_failed (بعد از recordStepFailed)
  - checkpoint_created (بعد از saveCheckpoint)

DefaultRecoveryTrigger:
  - recovery_triggered (بعد از findResumable موفق)
```

---

## 🛡️ قوانین Runtime Protection (R4.12)

### Governor Parameters

| Parameter | Default | توضیح |
|-----------|---------|-------|
| `cpuThreshold` | 90% | آستانه CPU |
| `memoryThreshold` | 85% | آستانه Memory |
| `temperatureThreshold` | 80°C | آستانه دما |
| `pauseDurationMs` | 30000 | مدت pause |
| `healthCheckIntervalMs` | 5000 | فاصله check |
| `autoResume` | true | resume خودکار |

### قوانین Governor

```
1. Governor قبل از هر step check می‌شود
2. اگر threshold exceeded → pause → wait → resume
3. Governor failure → console.warn، execution ادامه دارد
4. Governor optional است — بدون آن execution正常 ادامه دارد
5. Governor هرگز execution را متوقف نمی‌کند (فقط pause موقت)
```

---

## 📊 قوانین Observability (R4.15)

### Telemetry

```
1. Telemetry passive است — هرگز بر execution تأثیر نمی‌گذارد
2. Telemetry in-memory است (runtime only)
3. همه dataها Object.freeze هستند
4. Telemetry failure هرگز execution را break نمی‌کند
```

### Diagnostics

```
1. Diagnostics deterministic است
2. Diagnostics از telemetry data تولید می‌شود
3. Diagnostics هرگز LLM استفاده نمی‌کند
```

---

## ⚙️ قوانین Configuration (R4.7–R4.8)

### Configuration Lifecycle

```
Defaults → .ai/config.json → Environment Variables → EffectiveConfiguration
                                    ↓
                          Schema Validation (R4.8)
                                    ↓
                          Migration if needed
```

### قوانین Configuration

```
1. همه config از ConfigurationLoader خوانده می‌شود
2. Schema version قبل از migration validate می‌شود
3. Config قبل از migration backup می‌شود
4. Migration failure → restore backup
5. Environment variables بالاترین اولویت را دارند
6. مدل پیش‌فرض: qwen3-32b
7. Provider پیش‌فرض: ollama
8. Ollama URL پیش‌فرض: http://localhost:11434
```

---

## 🧠 قوانین Memory Boundary (R4.10)

### Memory Model

```
Shared Workspace Memory (WorkspaceMemoryRepository)
  +
Role Memory Boundary (RoleMemoryRepository)
```

### قوانین Memory

```
1. Role memory از workspace memory ایزوله است
2. RoleMemoryRepository فقط برای role-scoped data
3. WorkspaceMemoryRepository فقط برای shared data
4. Memory loading failure → console.warn، execution ادامه دارد
5. MemoryContextBuilder حداکثر 4000 chars تولید می‌کند
```

---

## 🧪 قوانین تست

### قوانین عمومی

```
1. Tests must use actual type signatures from discovery
2. Mock objects must match real interface shapes
3. Use `as any` for mock type casting
4. Non-null assertion (!) after toBeDefined() check
5. Default timeout is 5 seconds (increase for shell commands)
6. Temp dirs need cleanup in afterEach
7. Windows: EBUSY errors on rmdir (use force: true)
8. Use --forceExit for Jest (prevent hanging)
9. Use --runInBand for sequential execution
```

### الگوی Mock

```typescript
const mockStore: jest.Mocked<SessionStore> = {
  create: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  list: jest.fn(),
  delete: jest.fn()
} as any;
```

### تست‌های Shell Command

```
- Shell command tests need 30000ms+ timeout
- describe.skip برای تست‌هایی که به node_modules نیاز دارند
- استفاده از --forceExit برای جلوگیری از hanging
```

---

## 🔑 امضاهای حیاتی کد

### PatchExecutor

```typescript
export interface PatchExecutor {
  execute(request: PatchRequest): Promise<PatchResult>;
  rollback(sessionId: string): Promise<boolean>;
}
```

### VerificationEngine

```typescript
export interface VerificationEngine {
  verify(workspacePath: string): Promise<VerificationResult>;
}
```

### GitManager

```typescript
export interface GitManager {
  status(): Promise<GitStatus>;
  commit(request: GitCommitRequest): Promise<GitCommitResult>;
  rollback(commitHash: string): Promise<GitRollbackResult>;
  getCurrentBranch(): Promise<string | null>;
  listRecentCommits(count?: number): Promise<ReadonlyArray<GitCommitInfo>>;
  isRepository(): Promise<boolean>;
}
```

### Workspace

```typescript
export interface Workspace {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  writeFileAtomic(filePath: string, content: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  listFiles(directoryPath: string): Promise<string[]>;
  listEntries(path: string): Promise<string[]>;
  deleteFile(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  isDirectory(path: string): Promise<boolean>;
}
```

### SessionStore

```typescript
export interface SessionStore {
  create(session: WorkspaceSession): Promise<void>;
  get(id: string): Promise<WorkspaceSession | null>;
  update(id: string, patch: Partial<WorkspaceSession>): Promise<WorkspaceSession | null>;
  list(workspacePath: string): Promise<ReadonlyArray<WorkspaceSession>>;
  delete(id: string): Promise<boolean>;
}
```

### CheckpointRepository (R4.18)

```typescript
export interface CheckpointRepository {
  save(checkpoint: ExecutionCheckpoint): Promise<void>;
  load(checkpointId: string): Promise<ExecutionCheckpoint | null>;
  loadLatest(executionId: string): Promise<ExecutionCheckpoint | null>;
  delete(checkpointId: string): Promise<boolean>;
  list(executionId: string): Promise<ReadonlyArray<ExecutionCheckpoint>>;
  listAll(): Promise<ReadonlyArray<ExecutionCheckpoint>>;
}
```

### RecoveryService (R4.20)

```typescript
export interface RecoveryService {
  findResumable(executionId: string): Promise<RecoveryCandidate | null>;
  prepareResumeContext(candidate: RecoveryCandidate): ExecutionContext;
  validateCheckpoint(checkpoint: ExecutionCheckpoint): boolean;
}
```

### RecoveryTrigger (R4.21)

```typescript
export interface RecoveryTrigger {
  listRecoverable(): Promise<ReadonlyArray<RecoveryOption>>;
  resume(executionId: string): Promise<{ success: boolean; message: string }>;
}
```

### AuditService (R4.23)

```typescript
export interface AuditService {
  record(event: Omit<ExecutionAuditEvent, 'auditId' | 'timestamp'>): Promise<void>;
  getHistory(executionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>>;
  getSessionHistory(sessionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>>;
}
```

### ExecutionAuditRepository (R4.23)

```typescript
export interface ExecutionAuditRepository {
  append(event: ExecutionAuditEvent): Promise<void>;
  listByExecution(executionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>>;
  listBySession(sessionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>>;
  getLatest(executionId: string): Promise<ExecutionAuditEvent | null>;
}
```

### ExecutionGovernor (R4.12)

```typescript
export interface ExecutionGovernor {
  evaluate(health: RuntimeHealth): GovernorDecision;
  getPolicy(): GovernorPolicy;
}
```

### TelemetryCollector (R4.15)

```typescript
export interface TelemetryCollector {
  recordEvent(event: TimelineEvent): void;
  recordStep(step: StepTelemetry): void;
  getTelemetry(): ExecutionTelemetry;
  reset(): void;
}
```

### DocumentationService (R4.17)

```typescript
export interface DocumentationService {
  collectComponents(): Promise<ReadonlyArray<ComponentDocumentation>>;
  getDecisions(): Promise<ReadonlyArray<ArchitectureDecisionRecord>>;
  generateDocumentation(): Promise<DocumentationState>;
  getState(): Promise<DocumentationState | null>;
}
```

### StepExecutionEngine (R4.14)

```typescript
export class StepExecutionEngine {
  constructor(
    sessionManager: SessionManager,
    reflectionEngine: ReflectionEngine,
    executionGovernor?: ExecutionGovernor,
    runtimeHealthProvider?: RuntimeHealthProvider,
    pipelineHooks?: PipelineHooks,
    resumeEngine?: ResumeEngine,
    auditService?: AuditService,
  );
  executeSteps(sessionId, plan, context): Promise<StepExecutionResult>;
}
```

### AgentOrchestrator (R3)

```typescript
export interface AgentOrchestrator {
  execute(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
}

export interface AgentExecutionRequest {
  readonly roleId: string;
  readonly task: string;
  readonly targetFiles?: ReadonlyArray<string>;
  readonly patchRequest?: PatchRequest;
}
```

### RoleAssignmentService

```typescript
export interface RoleAssignmentService {
  updateAssignment(roleId: string, modelId: string): Promise<RoleAssignment>;
  getAssignment(roleId: string): Promise<RoleAssignment | undefined>;
  listAssignments(): Promise<ReadonlyArray<RoleAssignment>>;
  reload(): Promise<void>;
  resetAssignments(): Promise<void>;
}
```

---

## 🛠️ ابزارهای Workspace

| # | ابزار | کاربرد | Safety |
|---|-------|--------|--------|
| 1 | `read_file` | خواندن محتوای فایل | Path traversal protection |
| 2 | `write_file` | نوشتن/بازنویسی فایل | Sandbox enforcement |
| 3 | `create_file` | ایجاد فایل جدید (fail اگر وجود دارد) | Auto mkdir |
| 4 | `delete_file` | حذف فایل | Protected dirs ممنوع |
| 5 | `list_directory` | لیست directory | Non-recursive |
| 6 | `search_files` | جستجوی فایل‌ها | Respects .gitignore |
| 7 | `grep` | جستجوی متن | Size limits |
| 8 | `apply_patch` | اعمال batch از تغییرات ایمن | Backup + Verify + Rollback |

---

## 💻 دستورات CLI

### مدیریت Workspace

```bash
agent init                    # راه‌اندازی workspace جدید
agent doctor                  # بررسی سلامت workspace
agent status                  # نمایش وضعیت پروژه
agent workspace               # نمایش workspace فعلی
agent use <path>              # تغییر workspace
```

### تعامل با Agent

```bash
agent ask "<message>"         # پرسش از agent
agent repl                    # حالت تعاملی REPL
```

### مدیریت Session

```bash
agent sessions                # لیست همه sessions
agent resume <id>             # ادامه session ناتمام
agent patch-status <id>       # وضعیت patch execution
```

### عملیات Git

```bash
agent git-status              # وضعیت مخزن git
agent commits [N]             # لیست commits اخیر (default 10)
agent rollback <hash>         # بازگشت ایمن به commit
```

### Recovery (R4.21)

```bash
agent recovery list           # لیست executionهای قابل resume
agent recovery resume <id>    # resume یک execution
```

### Roles و Models

```bash
agent role list               # لیست roleها
agent role show <id>          # جزئیات role
agent model list              # لیست مدل‌ها
agent model list --local      # فقط مدل‌های محلی
agent model show <id>         # جزئیات مدل
agent assign list             # لیست assignmentها
agent assign set <role> <model>  # تخصیص مدل به role
agent assign reset            # بازنشانی به پیش‌فرض
```

### Configuration و Protection

```bash
agent config show             # نمایش config
agent config set <key> <val>  # تنظیم config
agent protect status          # وضعیت محافظت
agent protect set <key> <val> # تنظیم محافظت
agent protect reset           # بازنشانی محافظت
```

### دستورات REPL

```bash
/help          # نمایش لیست دستورات
/status        # وضعیت پروژه
/protect       # تنظیمات محافظت
/recovery      # بازیابی executionها
/role          # مدیریت roleها
/model         # مدیریت مدل‌ها
/clear         # پاک کردن صفحه
/history       # تاریخچه
/exit          # خروج
<text>         # سوال مستقیم از agent
```

---

## 🤖 سیستم Multi-Agent

### Roleهای پیش‌فرض

| Role | توضیح | Tool Policy | Context Scope |
|------|-------|-------------|---------------|
| `coder` | نوشتن کد | default | full |
| `reviewer` | بررسی کد | read-only | limited |
| `planner` | طراحی معماری | default | full |

### تخصیص مدل به Role

```bash
agent assign set coder qwen3-8b
agent assign set reviewer qwen2.5-coder-7b
agent assign set planner qwen3-32b
```

### AgentOrchestrator Flow

```
AgentOrchestrator.execute(request)
  ↓
۱. Role resolution: roleId → RoleConfiguration
  ↓
۲. Model resolution: RoleAssignment → modelId + providerId
   (اگر assignment نباشد → fallback به RoleConfiguration)
  ↓
۳. Validation: model exists? available? provider exists?
  ↓
۴. Configuration snapshot (برای traceability)
  ↓
۵. WorkflowOrchestrator.execute(task, model, provider)
```

### تفاوت REPL/Ask با AgentOrchestrator

| | REPL / Ask | AgentOrchestrator |
|---|---|---|
| Role | `DefaultCliRole` (ثابت) | قابل انتخاب |
| Model | `qwen2.5:3b` (hardcoded) | از RoleAssignment |
| Pipeline | ConversationOrchestrator | WorkflowOrchestrator (10-step) |
| Checkpoint | ندارد | دارد |
| Audit | ندارد | دارد |
| Governor | ندارد | دارد |

---

## ✅ مراحل تکمیل‌شده

### R1 — Foundation

| مرحله | وضعیت | دستاورد |
|-------|--------|---------|
| R1 | ✅ | Workspace Runtime + 8 ابزار + Multi-workspace + REPL |

### Knowledge Pipeline

| مرحله | وضعیت | دستاورد |
|-------|--------|---------|
| Knowledge Pipeline | ✅ | تولید 3 فایل دانش + Chunked + Incremental |

### R2 — Knowledge & Memory

| مرحله | وضعیت | دستاورد |
|-------|--------|---------|
| R2.1 | ✅ | WorkspaceMemory (READ-ONLY) |
| R2.2 | ✅ | MemoryContextBuilder (max 4000 chars) |
| R2.3 | ✅ | TaskPlanner + ExecutionPlan |
| R2.4 | ✅ | WorkspaceSessions + RetryAttempt + Recovery |
| R2.5 | ✅ | Git Integration + Conventional Commits |
| R2.6 | ✅ | Safe Patch Execution + Verification + Retry Loop |

### R3 — Execution Pipeline

| مرحله | وضعیت | دستاورد |
|-------|--------|---------|
| R3.1 | ✅ | WorkflowOrchestrator (10-step pipeline) |
| R3.2 | ✅ | TaskPlanner (LLM-based planning) |
| R3.3 | ✅ | ImpactAnalyzer |
| R3.4 | ✅ | Reviewer (deterministic review) |
| R3.5 | ✅ | SafePatchExecutor (retry + rollback) |
| R3.6 | ✅ | GitManager (commit, rollback) |
| R3.7 | ✅ | VerificationEngine |
| R3.8 | ✅ | PostExecutionPipeline (KnowledgeFeedback) |

### R4 — Foundation Architecture (FROZEN)

| مرحله | وضعیت | دستاورد |
|-------|--------|---------|
| R4.5 | ✅ | Atomic Write (LocalRuntimeRepository) |
| R4.6 | ✅ | REPL (ReplSession, CommandParser, 13 commands) |
| R4.7 | ✅ | Configuration Lifecycle (DefaultConfigurationLoader) |
| R4.8 | ✅ | Schema Validation (DefaultConfigurationMigrator) |
| R4.9 | ✅ | Knowledge Feedback (DefaultKnowledgeFeedbackEngine) |
| R4.10 | ✅ | Memory Boundary (RoleMemoryRepository, WorkspaceMemoryRepository) |
| R4.12 | ✅ | Runtime Health (ExecutionGovernor, NodeRuntimeHealthProvider) |
| R4.13 | ✅ | Execution Planning (DefaultExecutionPlanner, deterministic) |
| R4.14 | ✅ | Step Lifecycle (StepExecutionEngine, PipelineHooks) |
| R4.15 | ✅ | Observability (TelemetryCollector, DiagnosticsReporter) |
| R4.16 | ✅ | Testing Infrastructure (FakeProviders, E2E + Stress) |
| R4.17 | ✅ | Documentation Intelligence (DocumentationService) |
| R4.18 | ✅ | Checkpoint Foundation (CheckpointRepository, ResumeEngine) |
| R4.19 | ✅ | Checkpoint Integration (StepExecutionEngine ↔ Checkpoint) |
| R4.20 | ✅ | Recovery Service (DefaultRecoveryService) |
| R4.21 | ✅ | Recovery Trigger (DefaultRecoveryTrigger, CLI) |
| R4.22 | ✅ | Resilience Validation (22 failure injection tests) |
| R4.23 | ✅ | Audit Trail (AuditService, FileAuditRepository) |
| R4.24 | ✅ | Architecture Validation |
| R4.25 | ✅ | Architecture Forensics (CLEAN ARCHITECTURE) |
| R4.26 | ✅ | Final Architecture Freeze (r4-foundation-complete) |

---

## ⚠️ محدودیت‌های شناخته‌شده

| # | محدودیت | توضیح | Severity |
|---|---------|-------|----------|
| 1 | `domain/conversation-turn.ts` | Type-only import از contracts | Low |
| 2 | `domain/execution-request.ts` | Type-only import از contracts | Low |
| 3 | `core/session/file-session-store.ts` | Direct fs بدون RuntimeRepository | Low |
| 4 | REPL/Ask hardcoded model | `qwen2.5:3b` در `cli-role.ts` — باید از config بخواند | Medium |
| 5 | AgentOrchestrator not wired to CLI | فقط در کد قابل استفاده است، CLI command ندارد | Medium |
| 6 | Validation commands hardcoded | `npm run build` و `npm test` → باید configurable شود | Low |
| 7 | Backup files never cleaned | بعد از git commit باید cleanup شوند | Low |
| 8 | No conflict resolution | git revert abort می‌کند روی conflict | Low |

---

## 🗺️ نقشه راه آینده

### R5 — Autonomous Software Engineer

```
- Self-learning از retry history
- Knowledge updates از failures
- Continuous improvement
- Intelligent model selection per task
- Multi-agent collaboration (parallel execution)
```

### Foundation آماده ✅

- ✅ Session management با retry
- ✅ Safe patch execution + rollback
- ✅ Verification system
- ✅ Checkpoint + Resume
- ✅ Recovery (user-triggered)
- ✅ Audit Trail
- ✅ Runtime Protection
- ✅ Observability
- ✅ Role-based Multi-Agent
- ✅ Knowledge Pipeline
- ✅ Configuration Lifecycle
- ✅ Memory Boundary
- ✅ Documentation Intelligence

---

## 🚀 دستور شروع در چت جدید

برای ادامه پروژه در یک چت جدید، این متن را کپی کنید:

```
من روی پروژه Sparrow CLI کار می‌کنم. یک AI Software Engineer
local-first که با TypeScript/Node.js نوشته شده.

معماری: Clean Architecture (Domain → Contracts → Core → CLI)
Domain: 44 مدل | Contracts: 57 اینترفیس | Core: 65+ کلاس
AppFactory: 65 create method | Tests: 730 (97 فایل)

Milestones تکمیل‌شده:
  R1 (Foundation), Knowledge Pipeline, R2.1-R2.6 (Knowledge & Memory),
  R3.1-R3.8 (Execution Pipeline), R4.5-R4.26 (Foundation Architecture)

وضعیت: R4 FROZEN (r4-foundation-complete)
مرحله بعدی: R5

قوانین اصلی:
- Additive changes only (هرگز breaking change)
- Never throw from contracts
- Discovery BEFORE implementation
- Filesystem ops only through Workspace/RuntimeRepository
- No database (local-first)
- Atomic writes (temp + rename)
- Backup before any file modification
- Verify (TS + tests) after any patch
- MAX_PATCH_RETRIES = 3
- MAX_ITERATIONS = 50
- Checkpoint after each step (fail-safe)
- Audit append-only (fail-safe)
- Governor before each step (fail-safe)
- Recovery never automatic (user-triggered only)
- Telemetry passive (never influences execution)

امضاهای حیاتی:
- RetryAttempt.error: string (MANDATORY, not optional!)
- PatchExecutor.execute(request: PatchRequest): Promise<PatchResult>
- SessionManager.getSession(): Promise<WorkspaceSession | null>
- CheckpointRepository.loadLatest(): no status filter, currentStepIndex tiebreaker
- StepExecutionEngine: startIndex = resumedFromCheckpoint ? currentStepIndex : 0
- AppFactory از this.rootDir استفاده می‌کند (نه this.workspacePath)

Technical Debt (non-blocking):
- 2 type-only domain→contracts imports
- 1 direct fs in file-session-store.ts
- REPL/Ask hardcoded model (qwen2.5:3b)
- AgentOrchestrator not wired to CLI

لطفاً [مرحله بعدی] را implement کن.
```

---

## 📊 آمار نهایی

| متریک | مقدار |
|-------|-------|
| Domain Models | 44 |
| Contracts | 57 |
| Core Classes | 65+ |
| AppFactory Methods | 65 |
| Test Files | 97 |
| Total Tests | 730 |
| Milestones | 30+ (R1→R4.26) |
| Circular Dependencies | 0 |
| Boundary Violations | 0 |
| Dead Code | 0 |
| Critical Risks | 0 |
| Technical Debts | 3 (low) + 2 (medium) |

---

> **نکته پایانی**: قوانین این سند بر اساس تجربه عملی در توسعه پروژه استخراج شده‌اند. نقض هر یک از این قوانین می‌تواند منجر به باگ‌های بحرانی، شکستن backward compatibility، یا از دست رفتن داده‌ها شود.

**پایان سند** 🎉

</div>