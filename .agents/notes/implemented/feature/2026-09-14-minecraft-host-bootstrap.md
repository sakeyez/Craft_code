# Agent Note: Host-owned Minecraft project initialization

Status: implemented

English | [中文](2026-09-14-minecraft-host-bootstrap.zh.md)

## Problem

Creating a blank Minecraft project requires version, loader, Java, dependency, mirror, staging, and first-build decisions that must be made by the host. A model-facing bootstrap tool and project-creation skill let an agent write that state before the host had completed those checks, and made a new session appear ready without a verified build.

## Decision

The local New Mod wizard is the only initialization path for a new Minecraft project. The host resolves a supported Fabric or NeoForge catalog entry, validates the required Java runtime, generates into a guarded staging directory, creates the Gradle Wrapper, applies the project-scoped mirror policy, and completes the first build before registering the workspace and starting its blank session. The mcmod desktop, CLI, and headless compositions expose project detection, resource validation, and focused checks to the model, but do not expose `bootstrap_mc_project` or `minecraft-project-create`. The Minecraft prompt directs the model to the wizard for a blank directory; after a successful host build, the model may inspect and modify the existing project.

## Host contract

- `catalog` resolves loader families independently within a 45-second budget and 20-second request bounds. Successful families merge into the cache without discarding the other family; partial merges retain the older freshness bound. `catalog-cache` allows immediate selection while refresh runs.
- Fabric uses BMCLAPI before Fabric Meta for game and Yarn data and Aliyun Maven before the Fabric repository for API metadata. NeoForge uses official Maven metadata or its directory index, then the official [NeoForgeMDKs organization](https://github.com/NeoForgeMDKs) when Maven is unavailable; each candidate must match an official MDK’s `neo_version`, `net.neoforged.gradle.userdev` plugin, supported Gradle wrapper recipe, and metadata before it enters the catalog. The resolver never invents NeoForge `1.20.1` support or accepts ModDevGradle as a substitute.
- A catalog entry carries official SHA-256 values for the Gradle distribution and wrapper JAR. The generated wrapper records `distributionSha256Sum`, and the host verifies the wrapper bytes before use and before inserting them into the application cache.
- Generated projects retain their repository declarations. The shared workbench network service supplies operation-scoped download routes and child-only Java proxy properties. Explicit network failures retry within the original deadline without refreshing dependency caches; compilation errors and cancellation do not retry.
- `start` accepts only the catalog id and user fields over the loopback `/mc-bootstrap` channel. The host rejects unsafe paths, symlinks, non-empty targets, and modified staging files, and serializes operations. Cancellation terminates the process tree and waits for termination and pending log writes to drain before publishing `cancelled`; the staging marker and complete `.dsh/bootstrap.log` remain available, while wire log tails stay bounded.

## Verification

Staging reuse compares both recorded content hashes and the current template. Verified older templates remain intact while creation uses a fresh tree, so a template correction cannot overwrite user edits or strand an untouched failed project. Network retry classification requires transport evidence, including a TLS peer disconnect; a missing plugin message alone cannot justify a retry or a version change. Failure summaries preserve this distinction.

NeoGradle writes its two JUnit argument files under `runs/junit/` during a plain build. Staging validation accepts these exact outputs for NeoForge on both resume and commit; it does not admit the entire runtime tree. Tests preserve rejection of unexpected files and symlinks so recognizing build outputs cannot conceal user edits.

The contract is covered by [catalog tests](../../../../packages/minecraft/tool-mc-bootstrap/tests/catalog.spec.ts), [service tests](../../../../packages/minecraft/tool-mc-bootstrap/tests/service.spec.ts), and the [assembled wizard E2E](../../../../apps/desktop/renderer/tests/mcmod-bootstrap.e2e.ts), which pins the no-session/no-model ordering before build success. The environment-gated [real-build suite](../../../../packages/minecraft/tool-mc-bootstrap/tests/real-build.e2e.ts) selects Fabric `1.20.1`, the highest stable Fabric `1.21.x`, the earliest resolvable NeoForge `1.20.x`, and the highest stable NeoForge `1.21.x` from the live catalog.

## Alternatives considered

**Keep the bootstrap tool behind a prompt-only restriction.** Rejected because a model-visible write and process capability could still bypass the wizard's catalog, staging, mirror, and build invariants.

**Let the model generate a template and ask the host to build it afterward.** Rejected because the model would still own version-sensitive project state and could create an unverified workspace session.

**Remove new-project creation entirely.** Rejected because the product needs a usable local path for users who do not already have a mod workspace.

## Consequences

New sessions cannot be opened for an unbuilt blank directory, and headless model runs cannot initialize one. The host bootstrap service owns network, filesystem, process, cancellation, and retry safety; the model workflow remains focused on editing and validating a project whose environment is already established. Existing projects and their user changes remain editable through the normal Minecraft tools.

The existing-project tools keep filesystem access workspace-scoped, detection bounded and fact-first, and static checks distinct from a runtime build. A model-facing initializer is eligible for reconsideration only if an authenticated host API enforces the same catalog, JDK, staging, process, and first-build gates, with assembled coverage proving that no session or model request exists before build success.

## Related

The current Minecraft project facts and validation boundaries live in [Minecraft project tools](../../../../packages/minecraft/tool-mc-project/README.md); this note owns the host-only initialization boundary.

The [workbench decision](2026-09-16-minecraft-workbench.md) owns shared environment preparation and retained run state. The bootstrap host injects both Connection and subprocess before constructing the service: finding a service with `ctx.get()` does not authorize helper code to access its property through that plugin context. A Loader-mounted regression exercises Java preparation before cancelling at file generation.
