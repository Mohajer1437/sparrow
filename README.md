# Sparrow

**A Local-First Agentic Development Platform**

Sparrow is an experimental, local-first platform for building and orchestrating AI-powered development workflows.

It combines agent orchestration, role-based model assignment, context management, task planning, controlled execution, verification, checkpointing, and recovery in a modular TypeScript architecture.

Sparrow is designed around a central principle:

**An AI agent should not be trusted with unrestricted autonomy. Its decisions should operate within explicit execution boundaries, observable workflows, and recoverable state.**

> **Project status: Experimental**
>
> Sparrow is under active development. Some capabilities are implemented, while others still require broader validation. The current release should not be considered production-ready. See [Known Limitations](#known-limitations).

---

## Table of Contents

- [Overview](#overview)
- [Design Principles](#design-principles)
- [Key Capabilities](#key-capabilities)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI](#command-line-interface)
- [Interactive REPL](#interactive-repl)
- [Agent Orchestration](#agent-orchestration)
- [Model and Provider Management](#model-and-provider-management)
- [Workspace Management](#workspace-management)
- [Execution Recovery](#execution-recovery)
- [Runtime Protection](#runtime-protection)
- [Web UI](#web-ui)
- [Configuration](#configuration)
- [Project Data](#project-data)
- [Development](#development)
- [Security Considerations](#security-considerations)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

Most AI coding tools focus on generating code from prompts. Sparrow explores a broader problem: how to coordinate AI-driven development tasks while maintaining control over their execution.

Rather than treating an LLM as an unrestricted autonomous system, Sparrow separates responsibilities across distinct components:

- **Planning:** Translating development requests into structured tasks.
- **Context management:** Gathering and organizing relevant project information.
- **Orchestration:** Coordinating agents, roles, models, and execution workflows.
- **Execution:** Applying changes through controlled tools and execution components.
- **Verification:** Evaluating execution results.
- **Recovery:** Preserving execution state and supporting continuation after interruptions.
- **Observability:** Recording execution events and exposing workflow information.

Sparrow is built primarily with TypeScript and Node.js. It is designed for local execution and supports integration with LLM providers, including local model runtimes such as Ollama.

## Design Principles

### 1. Controlled Autonomy

AI-generated decisions should not automatically translate into unrestricted system actions.

Sparrow separates decision-making from execution and introduces explicit components for validation, tool execution, and workflow control.

### 2. Local-First Architecture

Sparrow is designed to run on a developer's own machine.

Local model providers can be used without requiring a cloud AI service. Cloud providers may also be configured where supported.

### 3. Separation of Responsibilities

Domain logic, application contracts, infrastructure implementations, and CLI interfaces are organized into separate architectural layers.

### 4. Observable Execution

Important execution events, checkpoints, and workflow states are recorded to make agent behavior easier to inspect and debug.

### 5. Recoverability

Long-running workflows can maintain execution checkpoints. Recovery operations are explicitly initiated rather than silently restarting interrupted work.

### 6. Resource Awareness

Runtime protection mechanisms are designed to monitor system resource conditions and control execution when configured thresholds are exceeded.

---

## Key Capabilities

| Capability | Description |
|---|---|
| Agent orchestration | Coordinate role-based development workflows |
| Model assignment | Configure models for different agent roles |
| Provider management | Resolve configured LLM providers and models |
| Context engineering | Gather and organize project context |
| Task planning | Convert development requests into structured plans |
| Controlled execution | Execute tasks through dedicated workflow components |
| Patch management | Apply changes through patch execution components |
| Verification | Evaluate execution and task outcomes |
| Checkpointing | Preserve workflow progress |
| Recovery | Resume eligible interrupted executions |
| Runtime protection | Monitor resource conditions during execution |
| Audit trail | Record structured execution events |
| Workspace management | Maintain project-specific configuration and state |
| Web observability | Inspect execution information through a read-only interface |

The availability and maturity of individual capabilities may differ. Not every capability is necessarily exposed through the same CLI execution path.

---

## Architecture

Sparrow follows a Clean Architecture-inspired structure.

The main architectural layers are:

```text
src/
├── domain/
│
├── contracts/
│
├── core/
│   ├── agent/
│   ├── audit/
│   ├── checkpoint/
│   ├── configuration/
│   ├── context/
│   ├── conversation/
│   ├── discovery/
│   ├── documentation/
│   ├── execution/
│   ├── git/
│   ├── health/
│   ├── knowledge/
│   ├── memory/
│   ├── observability/
│   ├── patch/
│   ├── planning/
│   ├── prompt/
│   ├── provider/
│   ├── recovery/
│   ├── reflection/
│   ├── review/
│   ├── runtime/
│   ├── session/
│   ├── tool/
│   ├── verification/
│   ├── workflow/
│   └── workspace/
│
├── cli/
│   ├── commands/
│   └── repl/
│
└── app-factory.ts
```

### Architectural Boundaries

The intended dependency direction is:

```text
Domain ← Contracts ← Core ← CLI
```

- **Domain:** Core business concepts and models.
- **Contracts:** Interfaces and abstractions used by application components.
- **Core:** Application and infrastructure implementations.
- **CLI:** User-facing commands and interactive interfaces.
- **AppFactory:** Composition root responsible for constructing application components.

The architecture aims to keep domain concepts independent of external providers, command-line interfaces, and infrastructure details.

### Execution Model

A simplified role-based workflow can be represented as:

```text
User Request
     |
     v
Role Resolution
     |
     v
Model / Provider Resolution
     |
     v
Configuration Validation
     |
     v
Context Preparation
     |
     v
Task Planning
     |
     v
Plan Validation
     |
     v
Execution Workflow
     |
     +----> Runtime Protection
     |
     +----> Checkpointing
     |
     +----> Audit Events
     |
     v
Verification
     |
     v
Execution Result
```

This is a conceptual representation, not a guarantee that every CLI command follows the exact same pipeline.

---

## Requirements

| Dependency | Requirement | Purpose |
|---|---|---|
| Node.js | 18 or later | JavaScript runtime |
| npm | 9 or later | Package management |
| Git | 2.x | Version control |
| Ollama | Optional | Local LLM runtime |

A compatible LLM provider and model are required for AI-powered operations.

### Local Model Runtime

To use Ollama:

1. Install Ollama from [ollama.com](https://ollama.com).
2. Start the Ollama service.
3. Download a model compatible with the required capabilities.

Example:

```bash
ollama serve
```

In another terminal:

```bash
ollama pull qwen3:8b
```

Model compatibility, tool-calling behavior, context capacity, and resource requirements depend on the selected model.

The example above is illustrative. It is not a guarantee that this model is suitable for every Sparrow workflow.

---

## Installation

Clone the repository:

```bash
git clone https://github.com/Mohajer1437/sparrow.git
cd sparrow
```

Install dependencies:

```bash
npm install
```

Build the project:

```bash
npm run build
```

The CLI entry point is generated under `dist/`.

---

## Quick Start

Start an interactive session:

```bash
node dist/cli/main.js repl
```

You can then interact with Sparrow:

```text
sparrow> Analyze the project structure.
sparrow> /status
sparrow> /help
sparrow> /exit
```

You can also submit a direct request:

```bash
node dist/cli/main.js ask "Analyze the project architecture"
```

Initialize a workspace:

```bash
node dist/cli/main.js init
```

Check the workspace:

```bash
node dist/cli/main.js doctor
```

Check the current application status:

```bash
node dist/cli/main.js status
```

---

## Command-Line Interface

Sparrow provides CLI commands for managing workspaces, sessions, models, roles, configuration, and execution state.

The following examples describe the documented command interface. Individual commands and options may evolve as the project develops.

### Workspace

```bash
# Initialize a workspace
node dist/cli/main.js init

# Check workspace health
node dist/cli/main.js doctor

# Show application status
node dist/cli/main.js status

# Show the current workspace
node dist/cli/main.js workspace

# Select another workspace
node dist/cli/main.js use /path/to/project
```

### Agent Interaction

```bash
# Submit a direct request
node dist/cli/main.js ask "Create a hello.ts file"

# Start the interactive REPL
node dist/cli/main.js repl

# Start the read-only Web UI
node dist/cli/main.js serve
```

### Sessions

```bash
# List sessions
node dist/cli/main.js sessions

# Resume an eligible session
node dist/cli/main.js resume sess-abc123

# Inspect a session patch status
node dist/cli/main.js patch-status sess-abc123
```

### Git

```bash
# Show Git status
node dist/cli/main.js git-status

# Show recent commits
node dist/cli/main.js commits 10

# Roll back to a commit
node dist/cli/main.js rollback abc1234
```

Git operations can modify the selected workspace. Review the target repository and its working tree before using commands that change files or history.

### Recovery

```bash
# List recoverable executions
node dist/cli/main.js recovery list

# Resume an execution
node dist/cli/main.js recovery resume exec-abc123
```

### Roles

```bash
# List available roles
node dist/cli/main.js role list

# Inspect a role
node dist/cli/main.js role show coder
```

### Models

```bash
# List available models
node dist/cli/main.js model list

# List local models
node dist/cli/main.js model list --local

# Inspect a model
node dist/cli/main.js model show qwen3:8b
```

### Role Assignments

```bash
# List current assignments
node dist/cli/main.js assign list

# Assign models to roles
node dist/cli/main.js assign set coder qwen3:8b
node dist/cli/main.js assign set reviewer qwen2.5-coder-7b
node dist/cli/main.js assign set planner qwen3:32b

# Reset assignments
node dist/cli/main.js assign reset
```

### Runtime Protection

```bash
# Inspect protection settings
node dist/cli/main.js protect status

# Change CPU threshold
node dist/cli/main.js protect set cpuThreshold 85

# Change pause duration
node dist/cli/main.js protect set pauseDuration 60000

# Reset protection settings
node dist/cli/main.js protect reset
```

---

## Interactive REPL

The REPL provides an interactive interface for communicating with Sparrow.

Start it with:

```bash
node dist/cli/main.js repl
```

### Built-in Commands

| Command | Description |
|---|---|
| `/help` | Show available REPL commands |
| `/status` | Display project and configuration status |
| `/protect` | Inspect runtime protection settings |
| `/recovery` | Inspect recoverable executions |
| `/role` | Manage agent roles |
| `/model` | Manage models |
| `/clear` | Clear the terminal |
| `/history` | Display command history |
| `/exit` | Exit the REPL |
| `/quit` | Exit the REPL |

Regular text is submitted as an agent request.

---

## Agent Orchestration

Sparrow includes a role-based orchestration architecture.

Roles define the responsibilities and execution configuration of individual agents.

### Default Roles

| Role | Responsibility |
|---|---|
| `coder` | Code implementation |
| `reviewer` | Code and change review |
| `planner` | Task and architectural planning |

Role configurations can define tool policies and context scopes.

### Model Assignment

Models can be assigned independently to different roles:

```bash
node dist/cli/main.js assign set coder qwen3:8b
node dist/cli/main.js assign set reviewer qwen2.5-coder-7b
node dist/cli/main.js assign set planner qwen3:32b
```

Inspect the assignments:

```bash
node dist/cli/main.js assign list
```

The actual model and provider resolution behavior depends on the configured profiles, available providers, and current implementation.

### Programmatic Usage

The application factory provides a composition entry point for constructing application components.

An example of the role-based orchestration API:

```typescript
import { AppFactory } from './core/app-factory';

const factory = new AppFactory(process.cwd(), logger);

const orchestrator =
  factory.createAgentOrchestrator(process.cwd());

const result = await orchestrator.execute({
  roleId: 'coder',
  task: 'Create a hello.ts file',
  targetFiles: ['src/hello.ts'],
});

console.log(result.success);
console.log(result.workflowResult);
```

This is an architectural usage example. The exact import path and constructor dependencies should be checked against the current build and public API before relying on it in an external integration.

---

## Model and Provider Management

Sparrow separates model selection from provider-specific implementations.

The intended architecture allows the application to resolve models through configured provider integrations rather than embedding a single LLM runtime into the entire application.

### Local Models

Local models can be accessed through supported local providers such as Ollama.

Example configuration:

```json
{
  "defaultModel": "qwen3:8b",
  "defaultProvider": "ollama"
}
```

### Cloud Models

Cloud-based providers may also be configured where their integrations are available.

Cloud usage generally requires provider credentials and network access.

**Important:** The existence of a model identifier in configuration or a model registry does not necessarily mean that the corresponding provider integration has been validated end to end.

---

## Workspace Management

A workspace represents the project Sparrow operates on.

Initialize a new workspace:

```bash
cd /path/to/my-project
node /path/to/sparrow/dist/cli/main.js init
```

Switch to another workspace:

```bash
node dist/cli/main.js use /path/to/my-project
```

Inspect the selected workspace:

```bash
node dist/cli/main.js workspace
```

### Workspace Structure

Sparrow stores project-specific data under `.ai/`.

A typical structure may include:

```text
.ai/
├── config.json
├── manifest/
├── knowledge/
├── sessions/
├── checkpoints/
├── audit/
├── documentation/
├── memory/
└── rules/
```

The actual directories created depend on the features used and the current application configuration.

---

## Execution Recovery

Sparrow includes checkpoint and recovery components intended to preserve progress across interrupted workflows.

The general recovery process is:

```text
Execution
    |
    v
Checkpoint Creation
    |
    v
Execution Interrupted
    |
    v
Recovery Discovery
    |
    v
User Selects Execution
    |
    v
Resume Preparation
    |
    v
Execution Continuation
```

Recovery is designed to be an explicit operation.

It should not be assumed that every interrupted execution is recoverable or that every external side effect can be safely repeated. Recovery behavior depends on checkpoint availability and the state of the underlying workflow.

List recoverable executions:

```bash
node dist/cli/main.js recovery list
```

Resume an eligible execution:

```bash
node dist/cli/main.js recovery resume exec-abc123
```

---

## Runtime Protection

Sparrow includes a runtime protection mechanism intended to monitor system resource conditions during execution.

Configurable parameters include:

| Parameter | Description |
|---|---|
| `cpuThreshold` | CPU usage threshold |
| `memoryThreshold` | Memory usage threshold |
| `temperatureThreshold` | Temperature threshold |
| `pauseDurationMs` | Pause duration |
| `healthCheckIntervalMs` | Health-check interval |
| `autoResume` | Whether execution can automatically resume after a pause |

Example:

```bash
node dist/cli/main.js protect status
```

Change a threshold:

```bash
node dist/cli/main.js protect set cpuThreshold 85
```

Change automatic resume behavior:

```bash
node dist/cli/main.js protect set autoResume false
```

Runtime protection is a resource-management mechanism, not a complete operating-system security boundary or a guarantee against resource exhaustion.

---

## Web UI

Sparrow includes a read-only Web UI for inspecting execution information.

It is designed for observability, not as a replacement for the CLI or REPL.

Start the server:

```bash
node dist/cli/main.js serve
```

Open:

```text
http://127.0.0.1:4177
```

The default binding is localhost.

### Available Views

| View | Information |
|---|---|
| Dashboard | Recent executions and their status |
| Task | Task description and execution metadata |
| Context | Context preparation and provenance |
| Skills | Resolved skills and their sources |
| Plan | Structured task plan |
| Execution | Execution steps, files, and errors |
| Verification | Verification results |
| Failure / Repair | Failure information and repair attempts |

The interface uses Server-Sent Events for live updates.

The Web UI is intended to read existing execution data rather than initiate new agent workflows.

**Security note:** Keep the Web UI bound to localhost unless a separately reviewed and secured deployment configuration is available. Do not expose it directly to the public internet.

---

## Configuration

Sparrow supports workspace-level and global configuration.

### Configuration Locations

| Location | Purpose |
|---|---|
| `.ai/config.json` | Workspace configuration |
| `~/.sparrow/config.json` | Global configuration |

### Example Workspace Configuration

```json
{
  "version": "0.1.0",
  "defaultModel": "qwen3:8b",
  "defaultProvider": "ollama",
  "ollamaBaseUrl": "http://localhost:11434",
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

This is an illustrative configuration. Supported fields and defaults are determined by the current configuration schema.

### Configuration Commands

```bash
# Display configuration
node dist/cli/main.js config show

# Change the default model
node dist/cli/main.js config set defaultModel qwen3:8b
```

### Environment Variables

The documented environment variables include:

| Variable | Purpose |
|---|---|
| `AGENT_WORKSPACE_ROOT` | Explicit workspace root |
| `AGENT_DEFAULT_MODEL` | Default model |
| `AGENT_DEFAULT_PROVIDER` | Default provider |
| `AGENT_OLLAMA_URL` | Ollama endpoint |

Environment variable names and precedence should be checked against the current configuration implementation.

---

## Project Data

Sparrow maintains several categories of project-specific data.

| Directory | Purpose |
|---|---|
| `.ai/manifest/` | Project manifest |
| `.ai/knowledge/` | Knowledge pipeline output |
| `.ai/sessions/` | Session state |
| `.ai/checkpoints/` | Execution checkpoints |
| `.ai/audit/` | Execution audit records |
| `.ai/documentation/` | Generated or managed documentation |
| `.ai/memory/` | Workspace and role memory |
| `.ai/rules/` | Workspace rules |

### Knowledge Pipeline

The project includes a knowledge pipeline intended to generate structured representations of a codebase.

Its documented outputs include:

- Architectural map
- Codebase map
- Knowledge base

The pipeline is intended to support context preparation and project understanding.

Its output should be treated as generated project information, not as a guaranteed complete or authoritative representation of the codebase.

---

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

For focused test execution, use the project's configured Jest tooling.

### Development Philosophy

Sparrow prioritizes:

- Explicit architectural boundaries
- Deterministic control where practical
- Testable application components
- Observable execution
- Controlled tool access
- Recoverable workflows
- Incremental stabilization

Contributions should preserve these principles and include appropriate tests and documentation.

---

## Security Considerations

Sparrow is an agentic development tool. Depending on the workflow and enabled tools, it may interact with project files, execute operations, or modify a workspace.

Use it with the same caution you would apply to any development tool with filesystem or command-execution access.

Recommended precautions:

1. Use a dedicated development workspace when evaluating Sparrow.
2. Keep backups or use version control before running modification workflows.
3. Review generated changes before accepting them.
4. Do not provide API keys, passwords, or other secrets in prompts.
5. Keep local observability interfaces bound to localhost.
6. Review provider credentials and permissions before enabling integrations.
7. Do not assume that an AI-generated plan or verification result is always correct.

Sparrow's execution controls and runtime protections should not be interpreted as a sandbox or a complete security isolation mechanism.

If you discover a security vulnerability, please report it privately to the repository maintainer rather than publishing exploit details in a public issue.

---

## Known Limitations

Sparrow is an experimental project, and several areas require further validation.

Known limitations include:

- Some automated tests currently fail.
- Integration tests may depend on external services or locally available models.
- Provider selection and failover behavior require broader real-world validation.
- Model compatibility and tool-calling reliability vary across providers and models.
- Different execution entry points may not expose identical orchestration capabilities.
- Recovery cannot guarantee safe repetition of every external side effect.
- The Web UI is an observability interface, not a secured remote control plane.
- Some APIs, configuration fields, and CLI behaviors may change.

The latest recorded test audit found four failing suites in the targeted test run. Eleven of the twelve failing assertions were attributed to test fixture, isolation, or expectation problems; one model-dependent integration test remained blocked by the local inference environment. This is not evidence that the entire application is production-ready or fully validated.

Sparrow is published to make its current implementation available for inspection, experimentation, testing, and further development.

---

## Roadmap

The broader development direction includes:

- Improving provider selection and compatibility validation
- Strengthening automatic provider failover
- Expanding model capability discovery
- Improving execution reliability and recovery
- Increasing test coverage and integration validation
- Strengthening security boundaries around tool execution
- Improving observability and execution diagnostics
- Simplifying installation and developer onboarding

The roadmap is subject to change as the project evolves and receives external feedback.

---

## License

Sparrow is licensed under the [Apache License 2.0](LICENSE).

Copyright © 2026 Ali Mohajeri.

The Apache License grants rights to use, modify, and distribute the software under its terms.

The Sparrow name, logo, and project branding are addressed separately in [TRADEMARKS.md](TRADEMARKS.md). The software license does not grant trademark rights.

---

## Acknowledgments

Sparrow is an independently developed project exploring practical approaches to controlled, local-first agentic software development.

Feedback, issue reports, testing, and thoughtful contributions are welcome.
