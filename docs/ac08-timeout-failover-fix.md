# AC-08 Timeout Failover Fix — Evidence Report

**Date:** 2026-10-01
**Workspace:** `E:\agentic`
**Real-project revalidation:** `E:\agentic-r9-real-project` (harness under `E:\agentic-validation-tmp`)
**Final classification:** **VALIDATED**

---

## 1. Root cause

`ResilientLlmProvider.generate()` forwarded the **same** `ModelRequest` (including `request.signal`) to every candidate.

When Provider A’s attempt timed out, the shared `AbortSignal` became aborted. Provider B then received that already-aborted signal, so `fetch` failed immediately with no HTTP request. Failover *appeared* to run (log lines) but did not continue execution.

Caller cancellation and attempt timeout were conflated onto one signal.

---

## 2. Exact implementation change

**File:** `src/core/provider/resilient-llm-provider.ts`

- Treat `request.signal` as **caller cancellation only**.
- For each candidate attempt, build a **fresh** attempt signal via `createAttemptRequest()`:
  - Bridge that aborts if the caller aborts.
  - Optional fresh `AbortSignal.timeout(attemptTimeoutMs)` per attempt (`AbortSignal.any` when both apply).
- If `callerSignal.aborted` before/after an attempt → **rethrow, no failover**.
- Attempt timeout leaves the caller signal intact → next candidate gets a new timeout lifecycle.
- Same logical payload (messages/model/tools/options/observability); only attempt-specific `signal` differs.

**Also:**

- `ProviderRuntimeContext.attemptTimeoutMs` + `AppFactory` pass-through.
- Architecture allowlist for `tests/core/provider/resilient-llm-provider-timeout.test.ts`.

Timeout remains a failover category in `provider-failover-policy` (not weakened).

---

## 3. Tests added/changed

| File | Change |
|------|--------|
| `tests/core/provider/resilient-llm-provider-timeout.test.ts` | **New** — A–I including real HTTP hang→B request |
| `tests/core/provider/resilient-llm-provider.test.ts` | AC-18 asserts logical payload equality (signal may differ) |
| `tests/architecture/llm-provider-boundary.test.ts` | Allowlist timeout HTTP test’s `OllamaProvider` import |

Coverage:

- A: timeout → B success (fresh non-aborted signal)
- B: A→B timeout → C success (one attempt each)
- C: all timeout → `ProviderExhaustedError`
- D: caller cancel → no failover; already-aborted caller starts nothing
- E: conn/429/502/503/504 still failover
- F: 400 / auth / model-not-found no failover
- G: logical request identity
- H: TaskExecutionService one `runId` / one orchestrator call; only provider generate retries
- I: real HTTP hang on A; B receives actual `/api/chat`

---

## 4. Full test results

Relevant regression command (same set as prior validation):

```text
npx jest tests/core/provider … tests/architecture … tests/core/planning
  tests/core/execution tests/app/task-execution-service.test.ts …
```

| | Suites | Tests |
|--|--------|-------|
| Before AC-08 fix (prior validation) | 2 failed / 55 passed / 57 | 2 failed / 448 passed / 450 |
| After AC-08 fix | 2 failed / 56 passed / 58 | 2 failed / 458 passed / 460 |

The two failures are **pre-existing** (unchanged):

1. `task-execution-service.test.ts` — mid-run status `PLANNING` vs `EXECUTION`
2. `provider-selection.test.ts` — `upsertProfile` sets active → `explicit` vs expected `automatic`

New AC-08 suite: **10/10 passed**. Focused resilient + policy + boundary: **38/38 passed**.

---

## 5. Real HTTP timeout evidence

Unit test **I** and real revalidation `1_timeout_A_to_B` / `2_timeout_ABC`:

- A accepts `/api/chat` and hangs.
- Attempt timeout aborts A only.
- B (or C) receives a real HTTP `/api/chat` and returns `PONG`.
- Evidence: `E:\agentic-validation-tmp\evidence\ac08-real-revalidation.json`

```json
"1_timeout_A_to_B": { "aHits": 1, "bHits": 1, "content": "PONG", "pass": true }
"2_timeout_ABC": { "hits": { "a": 1, "b": 1, "c": 1 }, "pass": true }
```

Before (broken): B HTTP hits = **0**, shared signal aborted, `ProviderExhaustedError`.

---

## 6. Caller-cancellation evidence

Revalidation `4_caller_cancel` and unit test D:

- Caller `AbortController.abort()` mid-hang on A.
- B HTTP hits = **0**; no failover messages.
- Operation throws; does not cascade.

---

## 7. Task / Plan / PlanStep / Tool duplication evidence

Unit test H: `TaskExecutionService.execute` → orchestrator once; one `runId`/`taskId` in store; resilient `generate` performs A timeout + B success **inside** that single outer call. Failover does not re-enter TES.

---

## 8. Regression comparison

- Provider / CLI / architecture / planner / executor / tool / REPL suites: no new failures.
- Architecture boundary green after allowlisting the intentional HTTP timeout test.
- +10 new passing tests for AC-08.

---

## 9. Remaining risks

1. **`attemptTimeoutMs` is opt-in** (via `ResilientLlmProvider` / `ProviderRuntimeContext`). Without it, callers that use a single overall `AbortSignal.timeout` on `request.signal` still cancel the **whole** `generate` (no failover) — by design (caller cancel). Production AppFactory does not set a default attempt timeout, so long-running planner calls are unchanged unless configured.
2. Node `fetch` + `AbortSignal.timeout` may surface as “Failed to connect … aborted due to timeout” rather than named `AbortError`; policy still classifies via message text.
3. Dual `console.warn` + logger for failover messages (pre-existing cosmetic).

---

## 10. Final classification

**VALIDATED**

AC-08 is fixed: attempt timeouts no longer poison subsequent candidates; caller cancellation remains non-failover; real HTTP B receives a request after A hangs; relevant regression matches baseline aside from new AC-08 coverage.
