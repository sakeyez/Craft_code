# Agent Note: Minecraft check runner and runtime validation

Status: implemented

English | [中文](2026-08-23-minecraft-check-runner-and-runtime.zh.md)

## Problem

Minecraft projects use loader-specific and project-defined Gradle tasks. A fixed `runDatagen` or `runData` guess can run the wrong task or hide a project configuration error, while the agent had no explicit client/server runtime check. Static resource checks also needed bounded handling for common load-time failures without claiming to emulate Minecraft.

## Decision

`detect_mc_project` records declared Gradle task candidates and preserves loader, Minecraft-version, and mappings evidence. `run_mc_check` uses those facts first, then runs a bounded `tasks --all --console=plain` discovery command only when a datagen or approved runtime task is unresolved. Truncated or ambiguous discovery fails closed with a task-specific diagnostic. The `runtime` target requires an explicit `runtimeMode` of `client` or `server` and selects only the corresponding conventional or discovered task. Resource validation remains deterministic and bounded, covering JSON relationships and PNG structure without executing Minecraft.

## Alternatives considered

**Always run conventional task names.** Rejected because custom tasks are common and a guessed task can produce a misleading result.

**Parse or execute the complete Gradle model in-process.** Rejected because it would require project-specific build evaluation, downloads, and arbitrary build logic; the bounded task listing keeps discovery observable and resource use controlled.

**Treat runtime launch as an implicit all-check step.** Rejected because launching a client or server is costly and side-effectful; the user must choose and approve the runtime mode.

The tool's `tools/pre-execute` waterfall returns a Harness approval request for client/server launches; rejection happens before any Gradle command is started. The keyless headless snapshots use a constrained Windows-only `bash` compatibility fixture so their command round-trip remains portable without adding arbitrary shell execution.

## Consequences

The MC agent can validate more real project layouts and reports uncertainty instead of guessing. Runtime checks are available as an explicit, user-approved operation, and a rejected approval leaves the project untouched. The checks still do not replace a real Minecraft load, gameplay test, or loader-version-specific integration suite, and real Gradle behavior must be verified in an environment with the project wrapper and dependencies.
