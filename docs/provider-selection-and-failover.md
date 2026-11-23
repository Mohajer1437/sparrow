# Provider Selection and Runtime Failover

## Overview

Sparrow discovers configured provider profiles, selects a provider for the
current wrapper session, and can fail over during an LLM request. Provider
selection and runtime failover do not change the persisted profile catalog.

## Discovery

`ProviderAvailabilityService` loads provider profiles from `.ai/providers/`
and probes each constructed provider with `checkHealth()`.

A provider is healthy, and therefore eligible for selection, only when:

```text
health.status === "healthy"
```

API-key presence alone never makes a provider healthy. An
`openai-compatible` profile without a secret is unavailable.

## Selection

| Source | Trigger | Persistence |
| --- | --- | --- |
| Explicit | `agent provider use <name>` | Persists `activeProvider` in `providers.json` |
| Automatic | Exactly one healthy provider and no usable explicit provider | Session-only |
| Interactive | Multiple healthy providers and no usable explicit provider | Session-only |
| Runtime failover | The selected provider returns a failover-allowed failure | Session-only |

An existing persisted `activeProvider` is an explicit selection. If it is
healthy, it is used without prompting. If it is unavailable and multiple
healthy providers remain, interactive execution prompts for a provider.

Selection rules:

- Zero healthy providers stops startup with an actionable health-check error.
- Exactly one healthy provider is selected automatically without prompting
  when there is no healthy explicit selection.
- Multiple healthy providers require explicit selection in interactive mode.
- Multiple healthy providers in a non-interactive session fail with
  `ProviderSelectionRequiredError` and instruct the user to run
  `agent provider use <name>`.
- Prompting is allowed only when explicitly enabled or when both stdin and
  stdout are TTYs. Injected `options.lines` enables deterministic prompting
  for callers that do not have TTYs.
- Automatic and interactive choices are never written to
  `.ai/providers/providers.json`.
- Only `agent provider use <name>` persists `activeProvider`.

Candidates are ordered deterministically by provider profile name, with the
selected preferred provider moved to the first position. The effective
configuration returned to the caller is built in memory and contains the
selected provider type, base URL, model, and API key.

### Interactive prompt

The prompt is a numbered list of healthy provider profiles:

```text
Available providers:

1. Ollama
2. OmniRoute

Select provider [1-2]:
```

### CLI commands (unchanged)

These commands retain their existing semantics:

- `agent provider list`
- `agent provider current`
- `agent provider use <name>`
- `agent provider health`
- `agent provider test`
- `agent provider add`

## Runtime failover

`ResilientLlmProvider` wraps the ordered candidates. For each
`generate(request)` call:

1. It sends the original `ModelRequest` to the preferred provider.
2. If the failure is failover-allowed, it marks that provider unavailable for
   the rest of this wrapper session and retries the same `ModelRequest` on the
   next candidate.
3. It continues through the deterministic candidate order, without recreating
   Tasks, Plans, or tool executions.
4. A provider already marked unavailable is skipped for later calls in the
   same wrapper session.
5. If no candidate remains, it throws `ProviderExhaustedError`.

The retry is the same request object and payload; failover does not create a
new task, plan, tool execution, or modified prompt.

### Failover allowed

The exact provider error classes that permit failover are:

- `ProviderUnavailableError` (including connection failures, HTTP 502/503/504,
  and provider timeouts/aborts mapped to this class)
- `ProviderRateLimitError` (HTTP 429)

Equivalent transport failures such as a raw abort, connection-refused, or
network error may be classified into the same unavailable/timeout/rate-limit
categories by the failover policy.

### Failover forbidden

The following error classes do not trigger another provider attempt:

- `ProviderAuthenticationError`
- `ProviderModelNotFoundError`
- `ProviderContextLengthExceededError`
- `ProviderInvalidResponseError`
- generic `ProviderError` application/request failures
- unknown errors that are not classified as an allowed transport or rate-limit
  failure

Forbidden failures are returned to the caller immediately. Provider profiles
are not permanently disabled by runtime failures.

### Exhaustion

When every candidate has failed with a failover-allowed error, the wrapper
throws `ProviderExhaustedError`. Its attempt summaries contain provider names
and failure categories only; secrets are excluded.

## Session scope and security

Automatic selection, interactive selection, runtime failover, and the set of
providers skipped after failure are session-scoped. A new wrapper session
rediscovers providers and starts with the persisted explicit selection.

Logs and errors must never contain API keys, authorization headers, secret
file contents, or other provider secrets. Error response bodies are sanitized
before they are shown to users or retained in failover summaries.

## Architecture

```text
ProviderProfileStore
  -> ProviderAvailabilityService
  -> ProviderSelectionService + CLI prompt port
  -> ProviderRuntimeContext
  -> AppFactory
  -> ResilientLlmProvider
  -> Ollama / OpenAI-compatible providers
```

Core does not import CLI. Planner and Executor depend only on the provider
abstraction supplied by the registry.
