# Agent Note: Independent Minecraft development environment

Status: implemented

English | [中文](2026-09-20-independent-minecraft-development.zh.md)

## Problem

IDE and assistant runs can disagree because they select different JDKs, Gradle caches, repositories and launch gates. Bootstrap downloads are wasted when subsequent development runs select another Gradle User Home. Delegating execution to IDEA gives access to its live settings but makes the assistant depend on an installed, open IDE.

## Decision

The workbench executes project Wrapper tasks independently. A project environment record preserves the bootstrap cache location, verified JDK paths and discovered tasks. Build/environment fingerprints invalidate derived selection without deleting Gradle caches. Development launch executes the discovered runtime task and its dependencies. Build and static checks remain separate. Preparation uses a supported loader's JavaExec dependency graph and argument providers without invoking the launch actions; unresolved or custom runtime inputs remain unverified.

Preparation and builds reuse compatible Gradle daemons. Runtime retains an owned single-use daemon because process-tree cancellation cannot safely terminate a game hosted under a shared daemon. Model execution retains the mounted shell policy. Restart never automatically launches a game, EULA acceptance remains separate, and process initialization, world readiness and gameplay are distinct evidence.

The IDEA-only integration is absent from the product. Its original motivation—reading live RunManager settings instead of guessing from XML—remains valid for an optional future comparison feature. Reintroducing it requires an explicit product need, project-scoped authentication, redacted environment summaries, idempotent operation identities and real IDE compatibility/run evidence. A successful connection or plugin compilation cannot establish execution equivalence. Browser/model commands must not bypass approval through an IDE bridge.

This decision partially supersedes the launch preflight in the [workbench note](../feature/2026-09-16-minecraft-workbench.md); its dependency transactions, logs and editor ownership remain active.

## Alternatives considered

- Requiring IDEA provides actual IDE execution but conflicts with independent operation.
- Reconstructing IDEA XML cannot establish effective live configuration and is unnecessary for Wrapper execution.
- Running test/build/datagen before every launch adds failure paths and defeats focused incremental development.
- Deleting all caches or another process's lock destroys valid work; malformed Loom metadata is repaired only from validated local data, preserving corrupt bytes.

## Consequences

Preparation proves resolved inputs, not a title screen or gameplay. Custom JavaExec actions and runtime network access can require additional content. Runtime startup still pays the cost of an isolated daemon. Real offline launch, all loader/version combinations and server EULA acceptance require separate evidence; wiring tests cannot substitute for them. Independent stability is an acceptance goal, not a claim of identical IDE settings.

## Verification

Focused environment tests cover cache continuity, fingerprint invalidation, malformed records and bounded metadata repair. Lifecycle tests cover cancellation/log drain, sandbox denial and runtime tasks without extra build/test gates. Real acceptance records are kept separately from repository checks.
