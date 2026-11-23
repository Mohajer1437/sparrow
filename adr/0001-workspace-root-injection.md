# ADR-0001: Workspace Root Path Injection

## Context
The Workspace module needs to know the root directory of the project to resolve paths, enforce security boundaries, and prevent path traversal attacks. Using implicit environment variables like `process.cwd()` inside the Workspace implementation couples it to the execution environment and makes unit testing with isolated directories difficult.

## Decision
The Workspace implementation (`LocalWorkspace`) receives the root path strictly through constructor injection (`new LocalWorkspace(rootPath)`). The caller (e.g., the CLI layer) owns the responsibility of determining the correct root directory and passing it to the Workspace.

## Consequences
- The Workspace module is completely decoupled from the Node.js execution environment.
- Unit testing is simplified, as tests can inject temporary directories.
- Security is improved by explicitly defining the boundary at instantiation.
- The CLI layer remains the single source of truth for environment-specific context.
