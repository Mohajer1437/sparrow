# Provider Discovery, Selection, and Runtime Failover Acceptance

Status values are evidence-based. `PASS` means the source/documentation path
was inspected for the criterion. `NOT_RUN` is used for criteria that require
test execution; no tests were run for this change. `INVALID_INFRA` is reserved
for a correctly implemented real-provider check that cannot run because the
Ollama or other provider infrastructure is unavailable.

| ID | Short description | Relevant source file or evidence path | Status |
| --- | --- | --- | --- |
| AC-01 | Zero healthy providers stops startup with an actionable error. | `src/cli/commands/provider-selection.ts:84` | PASS |
| AC-02 | Exactly one healthy provider is selected automatically without prompting. | `src/core/provider/provider-selection-service.ts:79` | PASS |
| AC-03 | Multiple healthy providers without an explicit selection require selection. | `src/core/provider/provider-selection-service.ts:91` | PASS |
| AC-04 | Interactive selection chooses the requested healthy provider. | `src/cli/commands/provider-selection.ts:174` | PASS |
| AC-05 | A healthy persisted `activeProvider` is used without prompting. | `src/core/provider/provider-selection-service.ts:66` | PASS |
| AC-06 | An unavailable explicit provider is not used as the preferred candidate. | `src/core/provider/provider-selection-service.ts:66` | PASS |
| AC-07 | Automatic selection is session-only and does not persist `activeProvider`. | `src/cli/commands/provider-selection.ts:91` | PASS |
| AC-08 | Interactive selection is session-only and does not persist `activeProvider`. | `src/cli/commands/provider-selection.ts:91` | PASS |
| AC-09 | Prompting requires explicit permission, injected lines, or both TTYs. | `src/cli/commands/provider-selection.ts:94` | PASS |
| AC-10 | Non-interactive multi-provider selection raises `ProviderSelectionRequiredError`. | `src/cli/commands/provider-selection.ts:106` | PASS |
| AC-11 | Injected prompt lines work for deterministic non-TTY callers. | `src/cli/commands/provider-selection.ts:184` | PASS |
| AC-12 | Candidate ordering is deterministic with the preferred provider first. | `src/core/provider/provider-selection-service.ts:135` | PASS |
| AC-13 | Discovery eligibility requires `health.status === "healthy"`. | `src/core/provider/provider-availability-service.ts:120` | PASS |
| AC-14 | Missing API keys do not make an OpenAI-compatible profile healthy. | `src/core/provider/provider-availability-service.ts:43` | PASS |
| AC-15 | Selected effective configuration contains type, base URL, model, and API key. | `src/cli/commands/provider-selection.ts:141` | PASS |
| AC-16 | The selected effective configuration is built in memory. | `src/cli/commands/provider-selection.ts:162` | PASS |
| AC-17 | Only `agent provider use <name>` changes the persisted active selection. | `src/cli/commands/provider.ts:96` | PASS |
| AC-18 | `ask` uses the selected configured provider ID. | `src/cli/commands/ask.ts:66` | PASS |
| AC-19 | `ask` uses the selected effective model. | `src/cli/commands/ask.ts:74` | PASS |
| AC-20 | `ask` preserves existing output and provider error handling. | `src/cli/commands/ask.ts:78` | PASS |
| AC-21 | `ask` sanitizes provider errors before displaying them. | `src/cli/commands/ask.ts:80` | PASS |
| AC-22 | REPL startup uses provider discovery and selection. | `src/cli/repl/repl.ts:271` | PASS |
| AC-23 | `/use` reruns discovery and selection for the new workspace. | `src/cli/repl/repl.ts:129` | PASS |
| AC-24 | `/use` reruns discovery and selection when reverting. | `src/cli/repl/repl.ts:144` | PASS |
| AC-25 | `/use` preserves session initialization and revert behavior. | `src/cli/repl/repl.ts:133` | PASS |
| AC-26 | Failover is allowed for `ProviderUnavailableError`. | `src/core/provider/provider-failover-policy.ts:93` | PASS |
| AC-27 | Failover is allowed for `ProviderRateLimitError`. | `src/core/provider/provider-failover-policy.ts:54` | PASS |
| AC-28 | Authentication, model, context, invalid-response, and application errors forbid failover. | `src/core/provider/provider-failover-policy.ts:55` | PASS |
| AC-29 | The identical `ModelRequest` is sent to the next provider. | `src/core/provider/resilient-llm-provider.ts:99` | PASS |
| AC-30 | Failed providers are skipped for the remainder of the wrapper session. | `src/core/provider/resilient-llm-provider.ts:131` | PASS |
| AC-31 | Exhaustion raises `ProviderExhaustedError`. | `src/core/provider/resilient-llm-provider.ts:159` | PASS |
| AC-32 | Runtime failover does not permanently disable provider profiles. | `src/core/provider/resilient-llm-provider.ts:42` | PASS |
| AC-33 | Real-provider health/smoke checks behave correctly with available infrastructure. | `scripts/proof-provider-cli-selection.last.json.txt` | NOT_RUN |
| AC-34 | Runtime failover works against real provider infrastructure without leaking secrets. | `scripts/proof-provider-cli-selection.last.json.txt` | NOT_RUN |

No status is a claim that automated tests passed. If AC-33 or AC-34 is later
executed and the implementation is correct but Ollama/provider infrastructure
is unavailable, record `INVALID_INFRA` with the command output as evidence.
