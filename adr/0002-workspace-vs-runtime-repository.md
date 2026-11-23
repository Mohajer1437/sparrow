# ADR-0002: Separation of Workspace (User Space) and RuntimeRepository (Platform State)

## Context
The platform manages two fundamentally different types of files:
1. User Project Files (source code, assets, etc.) which the AI agent reads and modifies.
2. Platform Runtime State (configuration, manifests, rules, memory, sessions) stored in the `.ai` directory.

Initially, the `Workspace` abstraction was used for both, with `.ai` marked as a protected directory to prevent the AI from modifying platform state. However, this created an architectural conflict: the Discovery layer (which needs to read platform state) was forced to either bypass `Workspace` (violating abstraction rules) or use `Workspace` and trigger access denied errors.

## Decision
We strictly separate these two bounded contexts into independent abstractions:
- `Workspace`: Represents **User Space**. Responsible for user project files. Enforces strict security boundaries, explicitly blocking access to `.ai`.
- `RuntimeRepository`: Represents **Platform Runtime State**. Responsible exclusively for the `.ai` directory and platform persistence.

## Consequences
- `Workspace` and `RuntimeRepository` are completely decoupled.
- The Discovery layer and other platform services use `RuntimeRepository` to access `.ai` state.
- `Workspace` security guarantees remain intact; user-space operations can never accidentally or maliciously access `.ai`.
- Future milestones can swap `RuntimeRepository` implementations (e.g., to SQLite or cloud storage) without affecting `Workspace` or user-space logic.
