<div dir="rtl">

# Sparrow — Context Engineering Platform

یک Agent CLI/REPL مبتنی بر معماری Clean Architecture که با LLM محلی (Ollama) کار می‌کند.

---

## فهرست

- [پیش‌نیازها](#پیش‌نیازها)
- [نصب](#نصب)
- [شروع سریع](#شروع-سریع)
- [دستورات CLI](#دستورات-cli)
- [محیط REPL](#محیط-repl)
- [Web UI (مشاهده‌پذیری)](#web-ui-مشاهدهپذیری)
- [سیستم Multi-Agent](#سیستم-multi-agent)
- [مدل‌ها](#مدل‌ها)
- [Knowledge Pipeline](#knowledge-pipeline)
- [Recovery](#recovery)
- [Runtime Protection](#runtime-protection)
- [Configuration](#configuration)
- [Workspace Management](#workspace-management)
- [Audit Trail](#audit-trail)
- [معماری](#معماری)
- [عیب‌یابی](#عیب‌یابی)
- [میانبرها](#میانبرها)

---

## پیش‌نیازها

| نرم‌افزار | نسخه | توضیح |
|-----------|------|-------|
| Node.js | 18+ | Runtime |
| npm | 9+ | Package manager |
| Ollama | آخرین نسخه | LLM Provider محلی |
| Git | 2.x | Version control |

### نصب Ollama

```bash
# دانلود از https://ollama.com و نصب

# اجرای Ollama
ollama serve

# در ترمینال دیگر، دانلود مدل
ollama pull qwen3-32b
```

---

## نصب

```bash
# ورود به پوشه پروژه
cd E:\agentic

# نصب وابستگی‌ها
npm install

# Build
npm run build

# اجرای تست‌ها (اختیاری — 730 تست)
npm test
```

---

## شروع سریع

```bash
# ترمینال ۱: اجرای Ollama
ollama serve

# ترمینال ۲: شروع REPL
node dist/cli/main.js repl
```

داخل REPL:

```
sparrow> سلام، پروژه رو بررسی کن
sparrow> /status
sparrow> /exit
```

---

## دستورات CLI

### Workspace

```bash
# ساخت workspace جدید (فقط اولین بار)
node dist/cli/main.js init

# بررسی سلامت workspace
node dist/cli/main.js doctor

# وضعیت پروژه
node dist/cli/main.js status

# نمایش workspace فعلی
node dist/cli/main.js workspace

# تغییر workspace
node dist/cli/main.js use E:\my-project
```

### Agent

```bash
# سوال مستقیم از agent
node dist/cli/main.js ask "یک فایل hello.ts بساز"

# شروع REPL
node dist/cli/main.js repl

# اجرای Web UI فقط-خواندنی (جزئیات در بخش Web UI)
node dist/cli/main.js serve
```

### Sessions

```bash
# لیست sessionها
node dist/cli/main.js sessions

# ادامه session قطع‌شده
node dist/cli/main.js resume sess-abc123

# وضعیت patch یک session
node dist/cli/main.js patch-status sess-abc123
```

### Git

```bash
# وضعیت git
node dist/cli/main.js git-status

# لیست commitها
node dist/cli/main.js commits 10

# بازگشت به commit خاص
node dist/cli/main.js rollback abc1234
```

### Recovery

```bash
# لیست executionهای قابل resume
node dist/cli/main.js recovery list

# resume یک execution
node dist/cli/main.js recovery resume exec-abc123
```

### Roles

```bash
# لیست roleها
node dist/cli/main.js role list

# جزئیات یک role
node dist/cli/main.js role show coder
```

### Models

```bash
# لیست همه مدل‌ها
node dist/cli/main.js model list

# فقط مدل‌های محلی
node dist/cli/main.js model list --local

# جزئیات یک مدل
node dist/cli/main.js model show qwen3-32b
```

### Assignments

```bash
# لیست assignmentها
node dist/cli/main.js assign list

# تخصیص مدل به role
node dist/cli/main.js assign set coder qwen3-8b
node dist/cli/main.js assign set reviewer qwen2.5-coder-7b
node dist/cli/main.js assign set planner qwen3-32b

# بازنشانی به پیش‌فرض
node dist/cli/main.js assign reset
```

### Configuration

```bash
# نمایش config
node dist/cli/main.js config show

# تنظیم config
node dist/cli/main.js config set defaultModel qwen3-8b
```

### Protection

```bash
# وضعیت محافظت
node dist/cli/main.js protect status

# تنظیم محافظت
node dist/cli/main.js protect set cpuThreshold 85
node dist/cli/main.js protect set pauseDuration 60000

# بازنشانی محافظت
node dist/cli/main.js protect reset
```

---

## محیط REPL

### شروع

```bash
node dist/cli/main.js repl
```

### دستورات REPL

| دستور | توضیح |
|-------|-------|
| `/help` | نمایش لیست دستورات |
| `/status` | وضعیت پروژه و config |
| `/protect` | تنظیمات محافظت سخت‌افزاری |
| `/recovery` | بازیابی executionهای interrupted |
| `/role` | مدیریت roleها |
| `/model` | مدیریت مدل‌ها |
| `/clear` | پاک کردن صفحه |
| `/history` | تاریخچه دستورات |
| `/exit` یا `/quit` | خروج |
| `<text>` | سوال مستقیم از agent |

### مثال

```
sparrow> سلام، ساختار پروژه رو بررسی کن
🤔 Thinking...
📁 Project structure analyzed...

sparrow> /status
📊 Project: my-project
   Model: qwen3-32b
   Provider: ollama
   Protection: enabled

sparrow> /protect status
🛡️ Runtime Protection:
   CPU Threshold:    90%
   Memory Threshold: 85%
   Pause Duration:   30s

sparrow> /recovery list
No interrupted executions found.

sparrow> /exit
👋 Goodbye!
```

---

## Web UI (مشاهده‌پذیری)

یک رابط وب **فقط-خواندنی** برای مشاهده‌ی pipeline. جایگزین CLI/REPL نیست؛
اجرای task فقط از طریق CLI/REPL انجام می‌شود و Web UI همان داده‌ی
Application Services را می‌خواند.

### شرایط استفاده

- ابتدا باید build انجام شده باشد (`npm run build`)، چون CLI از `dist/` اجرا می‌شود.
- سرور باید از داخل همان workspace پروژه اجرا شود؛ workspace root از همان
  resolver مشترک CLI گرفته می‌شود و هیچ درخواستی از مرورگر نمی‌تواند آن را تغییر دهد.
- داده‌ی UI از `.ai/runs/` (snapshotهای اجرا) و `.ai/logs/pipeline/` (رویدادهای
  ساخت‌یافته) خوانده می‌شود. اگر هنوز هیچ task‌ای اجرا نشده باشد، dashboard خالی است.
- هر task باید از طریق REPL و با پیشوند `/execute` اجرا شود تا ثبت و قابل مشاهده شود.
- سرور به‌صورت پیش‌فرض فقط روی `127.0.0.1` گوش می‌دهد و صرفاً به درخواست‌های
  `GET` پاسخ می‌دهد. آن را در شبکه‌ی عمومی expose نکنید.
- مقادیر حساس (token، API key، password، cookie و …) پیش از نمایش redact می‌شوند.

### اجرا

```bash
# ترمینال ۱: در ریشه پروژه‌ی هدف
cd /d E:\new-test-2
node E:\agentic\dist\cli\main.js serve

# ترمینال ۲: اجرای task
cd /d E:\new-test-2
node E:\agentic\dist\cli\main.js repl
agent> /execute یک کامنت توضیحی به ابتدای app/page.tsx اضافه کن
```

سپس `http://127.0.0.1:4177` را در مرورگر باز کنید.

گزینه‌ها:

| گزینه | پیش‌فرض | توضیح |
|-------|---------|-------|
| `--port <n>` | `4177` | پورت سرور |
| `--host <addr>` | `127.0.0.1` | آدرس bind |

### نماها

```text
Dashboard      لیست اجراهای اخیر + وضعیت و فاز جاری
Task           متن task، Execution Directive، Project Profile، workspace root
Context        Context Strategy → Gathered Context → PlannerContext (با provenance)
Skills         Skillهای resolve‌شده و منبع resolution
Plan           TodoPlan واقعی با Todo IDهای پایدار (todo-1، todo-2، …)
Execution      نگاشت todo → step، فایل‌ها، خطاها
Verification   نتیجه V&V (با تفکیک WHOLE_RUN / TODO_SPECIFIC / UNKNOWN)
Failure/Repair Failure Contract (PRIMARY/SECONDARY/INCIDENTAL) و تلاش‌های repair
```

بروزرسانی زنده با Server-Sent Events روی `/api/stream` انجام می‌شود؛ مرورگر
هیچ‌گاه باعث context gathering مجدد یا اسکن مخزن نمی‌شود.

### نکات

- وضعیت نهایی اعلام‌شده توسط Core همیشه معتبر است؛ UI آن را با رویدادهای میانی
  بازنویسی نمی‌کند.
- اگر V&V در سطح whole-run باشد، verdict مربوط به یک Todo خاص `UNKNOWN` نمایش
  داده می‌شود و به PASS جعلی تبدیل نمی‌شود.
- خطای مرورگر یا قطع اتصال، هیچ تأثیری روی اجرای pipeline ندارد.

---

## سیستم Multi-Agent

### Roleهای پیش‌فرض

| Role | توضیح | Tool Policy | Context Scope |
|------|-------|-------------|---------------|
| `coder` | نوشتن کد | default | full |
| `reviewer` | بررسی کد | read-only | limited |
| `planner` | طراحی معماری | default | full |

### تخصیص مدل به Role

```bash
# لیست assignmentهای فعلی
node dist/cli/main.js assign list

# تغییر مدل یک role
node dist/cli/main.js assign set coder qwen3-8b
node dist/cli/main.js assign set reviewer qwen2.5-coder-7b
node dist/cli/main.js assign set planner qwen3-32b

# بررسی نتیجه
node dist/cli/main.js assign list

# خروجی:
# ════════════════════════════════════════════════════════════
# ROLE ASSIGNMENTS (3)
# ════════════════════════════════════════════════════════════
#
#   coder
#     Model:    qwen3-8b
#     Provider: ollama
#     Source:   user
#
#   reviewer
#     Model:    qwen2.5-coder-7b
#     Provider: ollama
#     Source:   user
#
#   planner
#     Model:    qwen3-32b
#     Provider: ollama
#     Source:   user
```

### نحوه کار AgentOrchestrator

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
| Role | `DefaultCliRole` (ثابت) | قابل انتخاب (coder, reviewer, planner) |
| Model | `qwen2.5:3b` (hardcoded) | از RoleAssignment خوانده می‌شود |
| Pipeline | ConversationOrchestrator → TaskExecutor | WorkflowOrchestrator (10-step pipeline) |
| Planning | اختیاری (TaskPlanner) | اجباری (TaskPlanner + PlanValidator) |
| Review | ندارد | Reviewer (deterministic) |
| Patch | ندارد | SafePatchExecutor (retry + rollback) |
| Git | ندارد | GitManager (commit) |
| Checkpoint | ندارد | ResumeEngine (checkpoint after each step) |
| Audit | ندارد | AuditService (execution history) |

### استفاده از AgentOrchestrator در کد

```typescript
import { AppFactory } from './core/app-factory';

const factory = new AppFactory(process.cwd(), logger);
const orchestrator = factory.createAgentOrchestrator(process.cwd());

const result = await orchestrator.execute({
  roleId: 'coder',        // یا 'reviewer' یا 'planner'
  task: 'یک فایل hello.ts بساز',
  targetFiles: ['src/hello.ts'],
});

console.log(result.success);
console.log(result.workflowResult);
```

---

## مدل‌ها

### لیست مدل‌ها

```bash
node dist/cli/main.js model list
```

### مدل‌های محلی (Ollama)

| Model | Family | Context | Tools |
|-------|--------|---------|-------|
| `qwen3-32b` | Qwen | 32K | ✅ |
| `qwen3-8b` | Qwen | 32K | ✅ |
| `qwen2.5-coder-7b` | Qwen | 32K | ✅ |
| `deepseek-coder-v2` | DeepSeek | 128K | ✅ |
| `deepseek-r1-14b` | DeepSeek | 64K | ✅ |
| `llama3.3-70b` | Llama | 128K | ✅ |

### مدل‌های Cloud (نیاز به API key)

| Model | Provider |
|-------|----------|
| `gpt-4o` | OpenAI |
| `gpt-4o-mini` | OpenAI |
| `o3-mini` | OpenAI |
| `claude-sonnet-4` | Anthropic |
| `claude-haiku-3.5` | Anthropic |
| `gemini-2.5-pro` | Google |
| `gemini-2.5-flash` | Google |

### تغییر مدل پیش‌فرض

```bash
# روش ۱: CLI
node dist/cli/main.js config set defaultModel qwen3-8b

# روش ۲: فایل .ai/config.json
{
  "defaultModel": "qwen3-8b",
  "defaultProvider": "ollama"
}

# روش ۳: Environment Variable
set AGENT_DEFAULT_MODEL=qwen3-8b

# روش ۴: فقط برای Knowledge Pipeline
npx ts-node src/core/knowledge/__tests__/test-pipeline.ts qwen2.5:3b
```

---

## Knowledge Pipeline

### اجرا

```bash
# با مدل پیش‌فرض (qwen3-32b از configuration)
npx ts-node src/core/knowledge/__tests__/test-pipeline.ts

# با مدل خاص
npx ts-node src/core/knowledge/__tests__/test-pipeline.ts qwen2.5:3b
```

### مراحل

| Stage | توضیح | خروجی |
|-------|-------|-------|
| 1/3 | Architectural Map | `.ai/knowledge/architectural-map.json` |
| 2/3 | Codebase Map | `.ai/knowledge/codebase-map.json` |
| 3/3 | Knowledge Base | `.ai/knowledge/knowledge_base.json` |

### حالت‌ها

| حالت | توضیح |
|------|-------|
| `full` | اولین اجرا — تولید کامل |
| `incremental` | اجراهای بعدی — فقط تغییرات |
| `chunked` | fallback برای پروژه‌های بزرگ |

### خروجی نمونه

```
══════════════════════════════════════════════════════════
🚀 KNOWLEDGE PIPELINE
══════════════════════════════════════════════════════════

✅ AppFactory created
📋 Configuration loaded:
   Model:      qwen3-32b
   Ollama URL: http://localhost:11434

🔌 Checking Ollama connectivity...
   Available models: qwen3-32b, qwen3-8b, llama3.3-70b
✅ Ollama is running

📦 Creating Knowledge Pipeline...
✅ Pipeline created

🔄 Executing pipeline...
   Stage 1/3: Architectural Map
   Stage 2/3: Codebase Map
   Stage 3/3: Knowledge Base

──────────────────────────────────────────────────────────

⏱️  Duration: 145.3s

✅ SUCCESS! Knowledge Pipeline completed.

📁 Generated files:
   📄 knowledge/architectural-map.json
   📄 knowledge/codebase-map.json
   📄 knowledge/knowledge_base.json

📊 Generation modes:
   Architectural Map: full
   Codebase Map:      chunked
   Knowledge Base:    full

💡 Files are in .ai/knowledge/ directory
```

---

## Recovery

### سناریو: execution وسط کار قطع شده

```bash
# ۱. لیست executionهای قابل resume
node dist/cli/main.js recovery list

# خروجی:
# ════════════════════════════════════════════════════════════
# RECOVERABLE EXECUTIONS
# ════════════════════════════════════════════════════════════
#
#   Execution:  exec-abc123
#   Session:    sess-xyz789
#   Last Step:  step-3
#   Remaining:  2 step(s)
#   Checkpoint: 2026-07-24T18:00:00.000Z
#
# To resume: agent recovery resume <executionId>
# ════════════════════════════════════════════════════════════

# ۲. resume
node dist/cli/main.js recovery resume exec-abc123

# خروجی:
# ✓ Resume prepared for execution exec-abc123 from step 3 (2 steps remaining)
```

### نحوه کار

```
Execution → Checkpoint (بعد از هر step)
    ↓ (قطع شدن)
recovery list → شناسایی checkpoint active
    ↓ (انتخاب کاربر — هرگز خودکار نیست)
recovery resume → ادامه از step درست (نه از صفر)
    ↓
Completion → Checkpoint (status: completed)
```

### تضمین‌ها

- هرگز از step صفر شروع نمی‌کند
- هرگز execution completed را resume نمی‌کند
- هرگز execution abandoned را resume نمی‌کند
- executionId و sessionId حفظ می‌شود
- stepهای completed دوباره اجرا نمی‌شوند

---

## Runtime Protection

### وضعیت

```bash
node dist/cli/main.js protect status
```

### Parameterها

| Parameter | Default | توضیح |
|-----------|---------|-------|
| `cpuThreshold` | 90% | آستانه CPU |
| `memoryThreshold` | 85% | آستانه Memory |
| `temperatureThreshold` | 80°C | آستانه دما |
| `pauseDurationMs` | 30000 | مدت pause (میلی‌ثانیه) |
| `healthCheckIntervalMs` | 5000 | فاصله check (میلی‌ثانیه) |
| `autoResume` | true | resume خودکار بعد از pause |

### تغییر

```bash
node dist/cli/main.js protect set cpuThreshold 85
node dist/cli/main.js protect set pauseDuration 60000
node dist/cli/main.js protect set autoResume false
node dist/cli/main.js protect reset
```

### نحوه کار

```
هر step → Governor check
    ↓
CPU > threshold? → PAUSE → wait → RESUME → ادامه
CPU < threshold? → CONTINUE → ادامه
```

---

## Configuration

### فایل‌های Config

| فایل | محل | توضیح |
|------|-----|-------|
| Workspace config | `.ai/config.json` | تنظیمات پروژه |
| Global config | `~/.sparrow/config.json` | workspace selection |

### `.ai/config.json`

```json
{
  "version": "0.1.0",
  "defaultModel": "qwen3-32b",
  "defaultProvider": "ollama",
  "ollamaBaseUrl": "http://localhost:11434",
  "paths": {
    "manifestDir": "manifest",
    "rulesDir": "rules",
    "knowledgeDir": "knowledge",
    "memoryDir": "memory"
  },
  "protection": {
    "cpuThreshold": 90,
    "memoryThreshold": 85,
    "temperatureThreshold": 80,
    "pauseDurationMs": 30000,
    "healthCheckIntervalMs": 5000,
    "autoResume": true
  }
}
```

### Environment Variables

| Variable | توضیح | اولویت |
|----------|-------|--------|
| `AGENT_WORKSPACE_ROOT` | مسیر workspace | بالاترین |
| `AGENT_DEFAULT_MODEL` | مدل پیش‌فرض | متوسط |
| `AGENT_DEFAULT_PROVIDER` | provider پیش‌فرض | متوسط |
| `AGENT_OLLAMA_URL` | آدرس Ollama | متوسط |

### Workspace Resolution Priority

```
Priority 0: AGENT_WORKSPACE_ROOT env var
Priority 1: cwd دارای .ai/ باشد
Priority 2: agent use <path> (global config)
Priority 3: cwd (fallback)
```

---

## Workspace Management

### پروژه جدید

```bash
cd E:\my-new-project
node E:\agentic\dist\cli\main.js init
node E:\agentic\dist\cli\main.js repl
```

### تغییر workspace

```bash
node dist/cli/main.js use E:\my-project
node dist/cli/main.js repl
```

### بررسی workspace فعلی

```bash
node dist/cli/main.js workspace
```

### ساختار `.ai/`

```
.ai/
├── config.json              ← workspace configuration
├── manifest/manifest.json   ← project manifest
├── knowledge/               ← Knowledge Pipeline output
│   ├── architectural-map.json
│   ├── codebase-map.json
│   └── knowledge_base.json
├── sessions/                ← SessionStore
├── checkpoints/             ← CheckpointRepository
├── audit/                   ← AuditRepository
├── documentation/           ← DocumentationRepository
├── memory/                  ← MemoryStorage
└── rules/                   ← Rules
```

---

## Audit Trail

### محل ذخیره

```
.ai/audit/{executionId}.json
```

### Event Types

| Event | توضیح |
|-------|-------|
| `execution_started` | شروع execution |
| `execution_resumed` | resume از checkpoint |
| `step_started` | شروع step |
| `step_completed` | اتمام موفق step |
| `step_failed` | شکست step |
| `checkpoint_created` | ساخت checkpoint |
| `recovery_triggered` | trigger recovery |
| `execution_completed` | اتمام موفق execution |
| `execution_failed` | شکست execution |

### ویژگی‌ها

- **Append-only**: هرگز delete/update نمی‌شود
- **Fail-safe**: خطای audit هرگز execution را break نمی‌کند
- **Immutable**: همه eventها `Object.freeze` هستند

---

## معماری

### لایه‌ها

```
src/
├── domain/          ← 44 مدل immutable
├── contracts/       ← 57 اینترفیس
├── core/            ← 65+ کلاس implementation
│   ├── agent/       ← Role, Assignment, AgentOrchestrator
│   ├── audit/       ← AuditService, FileAuditRepository
│   ├── checkpoint/  ← CheckpointRepository, ResumeEngine
│   ├── configuration/ ← ConfigLoader, Migrator
│   ├── context/     ← ContextEngine, Optimizer
│   ├── conversation/ ← ConversationOrchestrator
│   ├── discovery/   ← ProjectDiscoveryService
│   ├── documentation/ ← DocumentationService
│   ├── execution/   ← TaskExecutor, StepExecutionEngine
│   ├── git/         ← GitManager
│   ├── health/      ← ExecutionGovernor, HealthProvider
│   ├── knowledge/   ← KnowledgePipeline, Stages
│   ├── memory/      ← WorkspaceMemory, RoleMemory
│   ├── observability/ ← Telemetry, Diagnostics
│   ├── patch/       ← PatchExecutor, BackupManager
│   ├── planning/    ← TaskPlanner, ExecutionPlanner
│   ├── prompt/      ← PromptBuilder
│   ├── provider/    ← OllamaProvider, ProviderRegistry
│   ├── recovery/    ← RecoveryService, RecoveryTrigger
│   ├── reflection/  ← ReflectionEngine
│   ├── review/      ← Reviewer
│   ├── runtime/     ← LocalRuntimeRepository
│   ├── session/     ← SessionManager, SessionStore
│   ├── tool/        ← ToolExecutor, ToolRegistry
│   ├── verification/ ← VerificationStrategyEngine
│   ├── workflow/    ← WorkflowOrchestrator
│   └── workspace/   ← LocalWorkspace
├── cli/             ← CLI commands + REPL
│   ├── commands/    ← ask, init, status, recovery, protect, ...
│   └── repl/        ← ReplSession, CommandParser
└── app-factory.ts   ← 65 create method (DI container)
```

### Dependency Rules

```
Domain ← Contracts ← Core ← CLI

✅ Domain: فقط از Domain import می‌کند
✅ Contracts: فقط از Domain import می‌کند
✅ Core: از Domain + Contracts import می‌کند
✅ CLI: از Core (via AppFactory) import می‌کند
```

### Execution Flow

```
CLI/REPL
  ↓
ConversationOrchestrator → TaskExecutor → Provider.generate()
  ↓
AgentOrchestrator (role resolution)
  ↓
WorkflowOrchestrator (10-step pipeline)
  ├── Step 1:  Start Session
  ├── Step 2:  Load Memory
  ├── Step 2.5: beforePlan Hook
  ├── Step 3:  Task Planning (LLM)
  ├── Step 3.5: Plan Validation
  ├── Step 3.6: afterPlan Hook
  ├── Step 4:  Impact Analysis
  ├── Step 5:  Deterministic Review
  ├── Step 5.5: Runtime Protection Check
  ├── Step 6:  Safe Patch Execution + Checkpoint + Audit
  ├── Step 7:  Git Commit
  ├── Step 8:  Reflection
  ├── Step 9:  Post Execution Pipeline
  └── Step 10: Complete Session
```

---

## عیب‌یابی

### Ollama وصل نیست

```bash
# بررسی
curl http://localhost:11434/api/tags

# حل
ollama serve
```

### مدل موجود نیست

```bash
# بررسی
ollama list

# حل
ollama pull qwen3-32b
```

### Build خطا دارد

```bash
rm -rf dist node_modules
npm install
npm run build
```

### تست‌ها fail هستند

```bash
npx jest tests/ --runInBand --forceExit --verbose
```

### مدل Tool Calling پشتیبانی نمی‌کند

```bash
# مدل‌هایی که tools پشتیبانی می‌کنند:
ollama pull qwen2.5:3b    # توصیه‌شده (~1.9GB)
ollama pull qwen2.5:7b    # (~4.7GB)
ollama pull llama3.1:8b   # (~4.7GB)
```

---

## میانبرها

### PowerShell Alias

```powershell
# اضافه به $PROFILE
Set-Alias agent "node E:\agentic\dist\cli\main.js"

# حالا:
agent repl
agent ask "سلام"
agent status
agent recovery list
agent assign set coder qwen3-8b
```

### npm scripts

```bash
npm run build     # tsc
npm start         # node dist/cli/main.js
npm test          # jest
```

---

## آمار

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
```