# Sparrow Knowledge System

## Production Fix + Evidence-Driven Implementation Protocol

تو در حال پیاده‌سازی Production Fix برای Knowledge System پروژه **Sparrow** هستی.

Repository اصلی:

```text
E:\agentic
```

Workspace واقعی برای validation:

```text
E:\agentic-r9-real-project
```

هدف این کار فقط اضافه کردن چند کلاس یا سبز کردن تست‌ها نیست.

هدف این است که Knowledge System واقعاً در runtime به یک **deterministic, incrementally maintained repository index** تبدیل شود که بعد از هر واحد اجرای واقعی، وضعیت ساختاری repository را به‌روز کند و execution unit بعدی بتواند از آن برای کاهش repository exploration استفاده کند.

معیار اصلی موفقیت:

```text
Repository
   ↓
Structural Knowledge
   ↓
Bounded Query
   ↓
Relevant Context
   ↓
LLM
   ↓
Mutation
   ↓
Knowledge Update
   ↓
Bounded Query
   ↓
Next Execution Unit
```

اگر این چرخه در runtime واقعی اتفاق نیفتد، Knowledge System را Fixed در نظر نگیر.

---

# 1. مهم‌ترین قانون این Implementation

از این لحظه هیچ Phase یا Feature را صرفاً به دلیل اینکه:

* کد compile می‌شود
* unit test پاس می‌شود
* integration test پاس می‌شود
* چند JSON تولید شده
* یک کلاس جدید اضافه شده
* یا implementation ظاهراً کامل است

قبول نکن.

هر Phase فقط زمانی `DONE` است که:

1. implementation انجام شده باشد
2. تست مناسب داشته باشد
3. runtime behavior اثبات شده باشد
4. evidence قابل بررسی تولید شده باشد
5. evidence در پوشه زیر ذخیره شده باشد:

```text
E:\agentic\knowledge-audit\
```

این پوشه باید در root پروژه Sparrow باشد.

---

# 2. Evidence Package اجباری

تمام مدارک این کار باید فقط در این پوشه جمع شوند:

```text
E:\agentic\knowledge-audit\
```

ساختار پیشنهادی:

```text
knowledge-audit/
├── README.md
├── 00-baseline/
├── 01-structural-index/
├── 02-incremental-sync/
├── 03-plan-step-integration/
├── 04-query-layer/
├── 05-planner-consumption/
├── 06-executor-consumption/
├── 07-recovery/
├── 08-real-workspace/
├── 09-token-and-tool-benchmark/
├── 10-final-verification/
└── final-report.md
```

در صورت نیاز می‌توانی structure را بهتر کنی، ولی:

**تمام evidence باید زیر `knowledge-audit/` باشد.**

هیچ evidence مهمی را فقط در chat، console output یا memory خودت نگه ندار.

---

# 3. Evidence باید قابل Audit باشد

برای هر Phase حداقل این موارد را ثبت کن:

```text
phase-result.md
test-results.txt
runtime-evidence.md
```

در صورت نیاز:

```text
before/
after/
logs/
snapshots/
benchmarks/
```

Evidence باید شامل موارد واقعی باشد، نه جملات کلی مثل:

```text
"Feature works."
"Tests passed."
"Knowledge is updated."
```

به جای آن باید نشان بدهی:

```text
BEFORE:
graph hash = ...
file count = ...
target file exists = ...

ACTION:
step-1 modified src/foo.ts

AFTER:
graph hash = ...
foo.ts hash = ...
edge X -> Y exists = ...
timestamp = ...

QUERY:
query(seed=...)
returned nodes = ...

EXECUTION:
step-2 consumed query result
list_directory calls = ...
search_files calls = ...
grep calls = ...
read_file calls = ...

RESULT:
...
```

هر ادعای مهم باید evidence داشته باشد.

---

# 4. Baseline اجباری

قبل از تغییر implementation یک baseline کامل بگیر.

Baseline باید وضعیت فعلی را ثبت کند.

حداقل:

```text
knowledge-audit/00-baseline/
```

شامل:

* وضعیت فعلی Knowledge files
* وضعیت فعلی structural graph
* وضعیت فعلی KnowledgePipeline
* وضعیت WorkspaceMemory
* وضعیت PlannerContext
* وضعیت TargetedContextGatherer
* وضعیت CODEBASE_MAP
* وضعیت ChangeDetector
* وضعیت StructuralAnalyzer
* وضعیت Mutation Ledger
* مسیر واقعی TaskExecutionService
* مسیر واقعی AgentOrchestrator
* مسیر واقعی WorkflowOrchestrator
* مسیر واقعی StepExecutionEngine
* مسیر واقعی PlanStep execution
* مسیر checkpoint
* مسیر post execution
* تعداد و نوع tool calls در یک اجرای واقعی

اگر graph وجود ندارد، همین نبودن graph باید به عنوان baseline ثبت شود.

---

# 5. اصل معماری

این implementation نباید معماری Sparrow را به یک distributed graph system تبدیل کند.

ممنوع:

* Neo4j
* Redis
* Kafka
* graph server
* vector database
* external graph database
* SQLite صرفاً برای این feature
* LLM-based indexing در hot path
* embedding-based retrieval برای structural graph
* اجرای KnowledgePipeline بعد از هر step
* اجرای TaskExecutor برای ساخت knowledge
* ساخت execution engine جدید

فعلاً persistence می‌تواند JSON باشد.

مثلاً:

```text
.ai/knowledge/structural-graph.json
```

اما abstraction مناسب برای persistence ایجاد کن تا implementation آینده محدود به JSON نباشد.

---

# 6. Source of Truth

این اصل غیرقابل مذاکره است:

```text
Repository filesystem = source of truth
Structural graph = deterministic index
```

اگر graph و filesystem اختلاف داشتند:

```text
filesystem wins
```

Graph نباید جای source code را بگیرد.

Graph فقط باید کمک کند LLM بفهمد:

* چه فایل‌هایی مهم هستند
* چه moduleهایی مرتبط هستند
* چه symbolهایی وجود دارند
* چه import/export relationshipهایی وجود دارند
* چه فایل‌هایی باید read شوند
* چه testهایی مرتبط هستند
* چه dependencyهایی تحت تأثیر mutation هستند

---

# 7. Structural Knowledge

Graph حداقل باید بتواند این موارد را represent کند:

```ts
type KnowledgeNodeKind =
  | 'file'
  | 'module'
  | 'symbol';

type KnowledgeEdgeKind =
  | 'imports'
  | 'contains';
```

حداقل اطلاعات:

```ts
interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  path?: string;
  hash?: string;
  exports?: string[];
  metadata?: Record<string, unknown>;
}

interface KnowledgeEdge {
  from: string;
  to: string;
  kind: KnowledgeEdgeKind;
}
```

در صورت وجود implementation مناسب می‌توانی موارد بیشتری اضافه کنی.

اما از over-engineering جلوگیری کن.

---

# 8. Initial Index

اگر:

```text
.ai/knowledge/structural-graph.json
```

وجود ندارد، سیستم باید بتواند deterministic initial index بسازد.

Initial indexing باید:

* LLM-free باشد
* deterministic باشد
* قابل تکرار باشد
* TS را پشتیبانی کند
* TSX را پشتیبانی کند
* source roots واقعی project را بشناسد
* server/ و سایر rootهای معتبر را hard-code حذف نکند
* import relationship بسازد
* export/symbol information را تا حد reasonable ثبت کند
* hash فایل‌ها را ثبت کند

از `StructuralAnalyzer` موجود استفاده کن.

اگر StructuralAnalyzer کمبود دارد، آن را extend کن.

Analyzer جدید موازی و duplicate نساز.

---

# 9. Source Root Problem

Audit قبلی نشان داده که source-root handling فعلی ممکن است فقط روی مسیرهایی مانند:

```text
src/app
src/components
src/lib
src/types
```

تمرکز داشته باشد.

این approach کافی نیست.

به‌خصوص:

```text
server/
```

و:

```text
.tsx
```

باید بررسی و اصلاح شوند.

Source roots باید بر اساس workspace/project profile یا configuration واقعی تعیین شوند، نه چند مسیر hard-coded تصادفی.

---

# 10. Hash Strategy

اگر `ChangeDetector` یا utility معتبر برای hashing وجود دارد، از همان canonical logic استفاده کن.

Duplicate hashing implementation نساز.

بررسی کن که:

* `.ts`
* `.tsx`
* relevant source files
* server files

در detection لحاظ شوند.

---

# 11. Incremental Synchronization

یک component مشخص برای synchronization ایجاد کن.

مثلاً:

```ts
KnowledgeSynchronizer
```

وظیفه آن:

```text
Mutation Ledger
      ↓
Candidate Paths
      ↓
Filesystem Truth
      ↓
Structural Analysis
      ↓
Incremental Graph Update
      ↓
Persistent Graph
```

حداقل input:

```ts
interface KnowledgeSyncInput {
  sessionId: string;
  stepId: string;
  todoId?: string;
  candidatePaths: ReadonlyArray<string>;
  outcome:
    | 'success'
    | 'failed'
    | 'rolled_back'
    | 'skipped';
}
```

حداقل result:

```ts
interface KnowledgeSyncResult {
  changedNodes: ReadonlyArray<string>;
  changedEdges: ReadonlyArray<{
    from: string;
    to: string;
  }>;
  skipped: boolean;
  reason?: string;
}
```

---

# 12. Mutation Ledger باید مبنا باشد

Synchronization نباید با این منطق انجام شود:

```text
"احتمالاً این فایل تغییر کرده"
```

باید تا حد ممکن از:

```text
Mutation Ledger
```

و filesystem truth استفاده کند.

Candidate paths باید از mutation واقعی بیایند.

---

# 13. Rename / Move

حداقل correctness:

```text
old path deleted
new path created
```

Graph باید بعد از synchronization وضعیت صحیح repository را نشان دهد.

اگر hash-based rename detection به شکل ساده و deterministic قابل پیاده‌سازی است می‌توانی اضافه کنی.

اما correctness مهم‌تر از optimization است.

---

# 14. PlanStep Boundary

مهم‌ترین integration point:

```text
PlanStep
```

است.

نه:

```text
individual tool call
```

و نه:

```text
whole task
```

Knowledge synchronization باید بعد از completion هر PlanStep انجام شود.

Flow مطلوب:

```text
PlanStep
   ↓
Tool Execution
   ↓
Mutation Ledger
   ↓
Verification / Repair
   ↓
Knowledge Synchronizer
   ↓
Checkpoint
   ↓
Next PlanStep
```

اگر repair بخشی از همان step semantics است، مطمئن شو mutation نهایی هم در graph منعکس می‌شود.

---

# 15. Integration Location

مسیر واقعی runtime را پیدا کن.

به صورت فرضی:

```text
TaskExecutionService
  ↓
AgentOrchestrator
  ↓
WorkflowOrchestrator
  ↓
StepExecutionEngine
  ↓
PlanStep
```

Integration را بر اساس codebase واقعی انجام بده.

به interfaceهای موجود مثل:

```text
PipelineHooks.afterStep
```

اعتماد نکن مگر اینکه واقعاً در AppFactory/runtime wiring استفاده شده باشند.

اگر hook موجود ولی unwired است:

* یا آن را صحیح wire کن
* یا مستقیم در canonical PlanStep boundary integrate کن

اما یک مسیر دوم و duplicate برای synchronization نساز.

---

# 16. Required Outcomes

این حالت‌ها را حتماً پشتیبانی و تست کن:

### Success + mutation

```text
step succeeds
mutation exists
graph updates
```

### Failure + mutation

```text
step fails
mutation remains
graph reflects filesystem
```

### Rollback

```text
mutation
↓
rollback
↓
filesystem restored
↓
graph restored
```

### Repair

```text
step
↓
failure
↓
repair
↓
final mutation state
↓
graph reflects final state
```

### No mutation

```text
step
↓
no mutation
↓
no unnecessary reindex
```

---

# 17. Sync Failure Policy

Knowledge sync نباید باعث corruption execution شود.

اگر sync fail شد:

```text
execution result remains valid
graph marked stale
failure logged
recovery mechanism available
```

این behavior باید test شود.

اما fail-open به معنی silently ignoring error نیست.

باید evidence و observability وجود داشته باشد.

---

# 18. Crash Recovery

یک مشکل مهم:

```text
Mutation happens
↓
process crashes
↓
graph update never happens
```

در startup یا next execution باید امکان تشخیص stale knowledge وجود داشته باشد.

حداقل mechanism:

* graph metadata
* source hashes
* last synchronized state
* dirty/stale indicator

سپس:

```text
stale detection
↓
bounded repair
```

و در صورت نیاز:

```text
full deterministic reindex
```

نباید همیشه full reindex انجام شود.

---

# 19. KnowledgeQuery

Graph را هیچ‌وقت کامل وارد prompt نکن.

یک query layer بساز.

مثلاً:

```ts
interface KnowledgeQuery {
  seeds: string[];
  includeImporters: boolean;
  includeImports: boolean;
  maxNodes: number;
}
```

Query باید bounded باشد.

مثلاً:

```text
target file
  ↓
imports
  ↓
importers
  ↓
related symbols
```

با limit مشخص.

---

# 20. Planner Consumption

Planner باید بتواند از structural knowledge استفاده کند.

اما graph نباید کل prompt را اشغال کند.

Planner باید بتواند برای یک Todo/PlanStep مرتبط، context محدودی مثل این بگیرد:

```text
target modules
relevant files
imports
importers
symbols
boundaries
tests
```

و سپس source files مورد نیاز را انتخاب کند.

---

# 21. Executor Consumption

Executor نیز باید از graph استفاده کند.

این بخش بسیار مهم است.

هدف صرفاً این نیست که Planner graph را ببیند.

بعد از:

```text
PlanStep 1
```

اگر مثلاً:

```text
src/auth/service.ts
```

تغییر کرد، PlanStep بعدی باید بتواند از graph بفهمد:

```text
src/auth/service.ts
imports X
is imported by Y
contains Z
```

و بر اساس آن مستقیم سراغ فایل‌های مرتبط برود.

هدف کاهش:

```text
list_directory
search_files
grep
blind read_file
```

است.

---

# 22. CODEBASE_MAP

اگر current implementation این را دارد:

```text
CODEBASE_MAP deferred
```

دیگر نمی‌توانی صرفاً آن را به صورت دائمی deferred نگه داری.

اگر codebase map قدیمی/غیرقابل اتکا است:

```text
structural graph query
```

باید نقش structural retrieval را بر عهده بگیرد.

اما:

```text
do not dump entire graph
```

و:

```text
do not duplicate codebase-map logic
```

---

# 23. KnowledgePipeline

این بسیار مهم است.

`KnowledgePipeline` را بعد از هر PlanStep اجرا نکن.

اگر KnowledgePipeline:

* LLM دارد
* TaskExecutor دارد
* tool loop دارد

نباید وارد synchronization hot path شود.

Synchronization باید:

```text
deterministic
cheap
incremental
LLM-free
```

باشد.

---

# 24. Tests

حداقل تست‌های زیر باید وجود داشته باشند.

### T0

Initial structural indexing

### T1

TS source detection

### T2

TSX source detection

### T3

Server source root detection

### T4

File create

### T5

Import edge creation

### T6

PlanStep 1 mutation → graph update → PlanStep 2 query

### T7

Planner consumes graph

### T8

Executor consumes graph

### T9

File modification

### T10

File deletion

### T11

Rollback

### T12

Failure with remaining mutation

### T13

Repair

### T14

No mutation

### T15

Sync failure / fail-open

### T16

Crash/stale recovery

### T17

No LLM during structural synchronization

### T18

KnowledgePipeline is not invoked for per-step synchronization

### T19

Bounded query

### T20

No whole-graph prompt dump

---

# 25. Integration Test اصلی

یک integration test واقعی بساز که این سناریو را اثبات کند:

```text
Initial repository
      ↓
PlanStep 1
      ↓
modify/create file
      ↓
Step 1 completes
      ↓
KnowledgeSynchronizer
      ↓
structural graph changes
      ↓
PlanStep 2
      ↓
KnowledgeQuery
      ↓
relevant dependency discovered
      ↓
executor reads relevant file
```

Test باید واقعاً graph state قبل و بعد را مقایسه کند.

---

# 26. مهم‌ترین Runtime Acceptance Test

این test باید وجود داشته باشد:

```text
Step 1 modifies A
Step 2 needs relationship involving A
```

بعد ثابت کن که Step 2 از knowledge جدید استفاده کرده است.

Evidence باید نشان دهد:

```text
Graph before Step 1
Graph after Step 1
Query issued by Step 2
Query result
Files subsequently read
Exploration calls
```

بدون این test، ادعای:

```text
"Knowledge is integrated into execution"
```

را قبول نکن.

---

# 27. Token / Tool Benchmark

معیار اصلی فقط correctness نیست.

یک benchmark قبل/بعد ایجاد کن.

حداقل این tool calls را بشمار:

```text
list_directory
search_files
grep
read_file
```

در صورت دسترسی، token usage را نیز ثبت کن.

مقایسه:

```text
BEFORE
vs
AFTER
```

برای سناریوی مشابه.

هدف:

```text
less repository rediscovery
less redundant exploration
```

است.

اگر correctness بهتر شده ولی exploration هیچ تغییری نکرده، implementation را از نظر هدف اصلی ناقص بدان.

---

# 28. Benchmark باید Fair باشد

مقایسه باید تا حد ممکن:

* task مشابه
* workspace مشابه
* initial state مشابه
* model مشابه
* execution conditions مشابه

داشته باشد.

صرفاً یک اجرای تصادفی را به عنوان benchmark استفاده نکن.

---

# 29. Evidence برای Benchmark

در:

```text
knowledge-audit/09-token-and-tool-benchmark/
```

ثبت کن:

```text
baseline-run.md
graph-aware-run.md
comparison.md
raw/
```

مثلاً:

```text
Baseline:
list_directory = 7
search_files = 11
grep = 8
read_file = 21

Graph-aware:
list_directory = 2
search_files = 3
grep = 2
read_file = 14
```

اعداد واقعی را خودت استخراج کن.

هرگز عدد فرضی ننویس.

---

# 30. Phase Acceptance Gate

هر Phase باید یک Gate داشته باشد.

مثلاً:

```text
PHASE 1
Structural Index
```

برای PASS شدن:

```text
[ ] implementation exists
[ ] unit tests pass
[ ] integration test passes
[ ] real workspace validation exists
[ ] evidence exists
[ ] evidence is reproducible
[ ] no prohibited architecture introduced
```

اگر یکی از موارد اصلی fail است:

```text
PHASE = NOT DONE
```

---

# 31. Evidence Quality Levels

Evidence را این‌گونه طبقه‌بندی کن:

### Level 0

Claim only

مثال:

```text
"Implemented."
```

قابل قبول نیست.

### Level 1

Unit test

برای correctness پایه کافی است، ولی برای final acceptance کافی نیست.

### Level 2

Integration test

رفتار چند component را اثبات می‌کند.

### Level 3

Runtime evidence

اجرای واقعی application را اثبات می‌کند.

### Level 4

Real workspace evidence

روی:

```text
E:\agentic-r9-real-project
```

اثبات می‌شود.

### Level 5

Before/After benchmark

هم correctness و هم اثر عملی را نشان می‌دهد.

برای Final Fix حداقل بخش‌های اصلی باید Level 4 یا Level 5 باشند.

---

# 32. هیچ Phase را زود DONE نکن

اگر مثلاً implementation نوشته شده ولی:

```text
real workspace evidence
```

نداری:

```text
NOT DONE
```

اگر graph ساخته می‌شود ولی executor از آن استفاده نمی‌کند:

```text
NOT DONE
```

اگر executor استفاده می‌کند ولی PlanStep بعدی graph جدید را نمی‌بیند:

```text
NOT DONE
```

اگر graph update می‌شود ولی exploration کاهش پیدا نمی‌کند:

```text
INVESTIGATE
```

نه اینکه خودکار موفقیت اعلام شود.

---

# 33. Real Workspace Validation

روی:

```text
E:\agentic-r9-real-project
```

حداقل یک سناریوی reversible اجرا کن.

قبل از اجرا:

```text
git status
```

ثبت کن.

بعد از اجرا:

```text
git status
```

و:

```text
git diff
```

ثبت کن.

اگر workspace git ندارد، equivalent filesystem snapshot ایجاد کن.

هیچ تغییر destructive دائمی ایجاد نکن.

---

# 34. Audit Artifacts

در هر phase evidence واقعی ذخیره کن.

مثلاً:

```text
knowledge-audit/
  01-structural-index/
    phase-result.md
    graph-before.json
    graph-after.json
    test-results.txt
    runtime-evidence.md

  02-incremental-sync/
    phase-result.md
    before.json
    after.json
    mutation-ledger.txt
    sync-log.txt
    test-results.txt

  03-plan-step-integration/
    phase-result.md
    execution-trace.txt
    graph-before.json
    graph-after.json
    test-results.txt

  09-token-and-tool-benchmark/
    baseline-run.md
    graph-aware-run.md
    comparison.md
```

Evidence files باید تا حد ممکن machine-readable و human-readable باشند.

---

# 35. Final Report

در:

```text
E:\agentic\knowledge-audit\final-report.md
```

یک گزارش نهایی بساز.

باید شامل این بخش‌ها باشد:

```text
1. Executive Summary
2. Original Failure
3. Root Cause
4. Architecture Changes
5. Runtime Integration
6. Structural Graph Design
7. Synchronization Semantics
8. Query Design
9. Planner Integration
10. Executor Integration
11. Recovery
12. Test Matrix
13. Real Workspace Validation
14. Benchmark
15. Known Limitations
16. Remaining Risks
17. Evidence Index
18. Final Acceptance
```

---

# 36. Final Acceptance باید Evidence-Based باشد

در پایان گزارش جدولی شبیه این داشته باش:

```text
Requirement | Status | Evidence
-------------|--------|--------
Initial index | PASS | ...
TSX support | PASS | ...
Server root | PASS | ...
Incremental update | PASS | ...
Create | PASS | ...
Modify | PASS | ...
Delete | PASS | ...
Rollback | PASS | ...
Repair | PASS | ...
Failure mutation | PASS | ...
PlanStep integration | PASS | ...
Planner consumption | PASS | ...
Executor consumption | PASS | ...
Bounded query | PASS | ...
Crash recovery | PASS | ...
No LLM hot path | PASS | ...
Real workspace | PASS | ...
Benchmark | PASS | ...
```

اما فقط زمانی `PASS` بنویس که evidence واقعی برای آن وجود داشته باشد.

---

# 37. Final Definition of Done

Knowledge System فقط وقتی Fixed است که تمام موارد زیر اثبات شده باشند:

### Architecture

* [ ] persistent structural graph exists
* [ ] filesystem remains source of truth
* [ ] graph is deterministic
* [ ] graph is incrementally maintainable
* [ ] no unnecessary external infrastructure

### Index

* [ ] initial indexing works
* [ ] TS works
* [ ] TSX works
* [ ] real source roots work
* [ ] server sources are handled
* [ ] StructuralAnalyzer is reused
* [ ] canonical hashing is reused

### Synchronization

* [ ] create
* [ ] modify
* [ ] delete
* [ ] rename/move correctness
* [ ] rollback
* [ ] repair
* [ ] failure with remaining mutations
* [ ] no-mutation optimization
* [ ] sync failure handling

### Runtime

* [ ] synchronization happens at PlanStep boundary
* [ ] synchronization happens before next execution unit consumes knowledge
* [ ] checkpoint ordering is correct
* [ ] crash/stale recovery exists

### Retrieval

* [ ] KnowledgeQuery exists
* [ ] queries are bounded
* [ ] planner consumes query
* [ ] executor consumes query
* [ ] entire graph is never dumped into prompt

### Architecture safety

* [ ] no per-step LLM indexing
* [ ] no KnowledgePipeline hot-path invocation
* [ ] no duplicate execution engine
* [ ] no duplicate structural analyzer
* [ ] no duplicate hashing implementation

### Validation

* [ ] unit tests
* [ ] integration tests
* [ ] runtime evidence
* [ ] real workspace validation
* [ ] before/after benchmark
* [ ] evidence stored under `knowledge-audit/`

### Acceptance

* [ ] all major phases have evidence
* [ ] no phase marked DONE without evidence
* [ ] final report exists
* [ ] final report references concrete evidence
* [ ] claims are reproducible
* [ ] benchmark shows whether exploration behavior actually changed

---

# 38. بسیار مهم: اگر چیزی اثبات نشد، ادعای موفقیت نکن

اگر implementation کامل شد ولی benchmark هنوز نشان نمی‌دهد که executor واقعاً از graph استفاده می‌کند، در final report بنویس:

```text
IMPLEMENTED BUT NOT PROVEN
```

نه:

```text
DONE
```

اگر test پاس است ولی real workspace fail است:

```text
NOT ACCEPTED
```

اگر graph update می‌شود ولی PlanStep بعدی آن را query نمی‌کند:

```text
NOT ACCEPTED
```

اگر همه چیز درست است ولی evidence ناقص است:

```text
NOT ACCEPTED
```

این پروژه باید با استاندارد **evidence-driven acceptance** جلو برود، نه optimism-driven completion.

---

# 39. روش اجرای کار

قبل از تغییر کد:

1. repository را inspect کن
2. runtime path را دقیق پیدا کن
3. baseline را بساز
4. baseline evidence را در `knowledge-audit/00-baseline` ذخیره کن

سپس implementation را phase-by-phase انجام بده.

بعد از هر phase:

```text
Implement
↓
Test
↓
Run
↓
Collect Evidence
↓
Audit
↓
PASS / FAIL
↓
Only then continue
```

اگر phase fail شد:

```text
STOP
FIX
RETEST
REGENERATE EVIDENCE
```

به phase بعدی نرو مگر اینکه acceptance gate phase فعلی پاس شده باشد.

---

# 40. مهم‌ترین معیار نهایی

این پروژه برای ساختن یک JSON قشنگ نیست.

هدف این است:

```text
Step 1 learns something about repository
        ↓
knowledge becomes persistent
        ↓
Step 2 can retrieve it
        ↓
Step 2 explores less
        ↓
Step 3 benefits from Step 2
```

اگر این رفتار واقعی اثبات نشود، Knowledge System هنوز مشکل اصلی را حل نکرده است.

معماری نهایی مورد انتظار:

```text
                ┌─────────────────────┐
                │    Repository       │
                │ filesystem = truth  │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Structural Analyzer │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Structural Graph    │
                │ persistent index    │
                └──────────┬──────────┘
                           │
                     bounded query
                           │
                           ▼
                ┌─────────────────────┐
                │ Relevant Context    │
                └──────────┬──────────┘
                           │
                           ▼
                       Planner
                           │
                           ▼
                       PlanStep
                           │
                           ▼
                     TaskExecutor
                           │
                           ▼
                       Mutation
                           │
                           ▼
                   Mutation Ledger
                           │
                           ▼
                KnowledgeSynchronizer
                           │
                           └──────────────┐
                                          │
                                          ▼
                                  Updated Graph
                                          │
                                          ▼
                                  Next PlanStep
```

اصل نهایی:

> **The graph is not the source of truth. The graph is a deterministic, incrementally maintained index of repository truth, optimized for bounded retrieval so the LLM does less repository exploration.**

و یک اصل اضافه برای این implementation:

> **Nothing is considered fixed until it is implemented, tested, observed in runtime, and supported by reproducible evidence stored under `knowledge-audit/`.**
