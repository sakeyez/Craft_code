# Agent Note: Minecraft mod-development agent preset

Status: implemented

English | [中文](2026-08-21-mcmod-agent.zh.md)

## Problem

Minecraft mod development needs domain-specific behavior, but the existing harness already owns the general agent loop, filesystem tools, shell tools, LSP capability, skill loading, compaction, permissions, and session persistence as plugins. Forking `agent-loop` for one modding domain would duplicate those extension points and create a second place where model-visible tool and prompt composition can drift.

The domain is loader-sensitive. Fabric, Forge, NeoForge, and Architectury use different Gradle plugins, metadata files, mappings, registry APIs, and generated-data conventions. A first-version prompt that treats every loader as interchangeable would encourage the model to mix APIs from different ecosystems and Minecraft versions.

## Decision

Minecraft support ships as a Web preset composition and a headless profile composition:

- `@deepseek-ai/dsh-mcmod-agent` contributes only five prompt sections: `minecraft:identity`, `minecraft:scope`, `minecraft:workflow`, `minecraft:resources`, and `minecraft:version-discipline`.
- `@deepseek-ai/dsh-mcmod-bundle` is a profile patch layer that selects `mcmod` as the default preset and inserts the host-plane `ctx.lsp` and stdio Java provider rows.
- The shipped `mcmod` preset mounts the prompt package plus existing file, search, foreground-only platform shell, Minecraft project tools, `lsp`, skill, ask-user, and compaction rows. Its bundled Minecraft skills (`fabric-mod-dev`, `fabric-datagen`, `minecraft-resources`, `mixin-debugging`, `neoforge-mod-dev`, and `neoforge-datagen`) travel with the preset through a `customSkillDirs` entry resolved from the preset's `baseUrl`.
- `@deepseek-ai/dsh-mcmod-headless-bundle` is a profile patch layer applied after `dsh-base` and `dsh-headless`. The shipped `mcmod` profile template uses those three bundles to run the existing one-shot headless runner with shared Fabric and NeoForge Minecraft modding prompt sections, the same six bundled Minecraft skills, optional Java LSP, and a first-version code-development tool set.

The v1 default is Fabric + Java + Minecraft 1.21.x only for a genuinely blank project with no loader decision. The prompt tells the model to detect existing loader, version, and mappings facts from Gradle, metadata, dependency coordinates, main mod class, and mixin config before choosing APIs, and to stop on unknown or conflicting evidence instead of guessing. It explicitly avoids mixing Fabric, Forge, NeoForge, Architectury, or cross-version Minecraft APIs. The preset intentionally omits web search, workflow, Ralph, general subagents, background job controls, todo, and goal tools. Shell tools also omit `run_in_background`, so a model cannot start background shell work without the `job_*` controls needed to collect or stop it. Those capabilities remain available to other presets and to user-authored copies that choose to add them.

Java LSP is deployment-owned. Both bundle defaults use stdio command `jdtls`, with `.java` mapped to language id `java`; a profile overlay can replace the full `lsp-stdio` row when a machine needs an absolute JDTLS path or arguments.

Release identity remains upstream-compatible during the pre-release phase: package names stay under `@deepseek-ai/*`, and the upstream repository metadata is retained. Craft_code branding and an npm-scope migration are deferred to a later release decision; this change does not perform a repository-wide rename.

## Alternatives considered

**Forking `agent-loop`.** Rejected because the desired behavior is prompt and composition policy, not loop semantics. The existing plugin architecture already provides the required extension points, while a loop fork would need its own tool, prompt, session, and compaction integration.

**One loader-agnostic Minecraft preset with no blank-project default.** Rejected for v1 because users need a concrete prototype for a genuinely blank workspace. Fabric + Java + Minecraft 1.21.x is provisional only in that case; existing or conflicting loader facts override guesses and require inspection.

**Enabling web search by default.** Rejected for v1 because Minecraft loader API facts are version-sensitive. The first preset prefers local project facts, dependencies, sources, and explicit user-provided documentation over general web results.

**A single all-purpose Minecraft skill.** Rejected because it would load code, resource, datagen, and mixin guidance together for tasks that need only one slice. Separate skills keep the catalog discoverable while loading detailed instructions only when the task matches that workflow.

**Adding broad Minecraft-specific tools.** Rejected for v1 because the first domain package should only replace guess-prone project fact extraction and validation routing. The accepted `@deepseek-ai/dsh-tool-mc-project` tools stay bounded to detection, static resource validation, and foreground shell-backed checks; broader structured Minecraft operations remain addable if a later feature needs them.

## Consequences

The shipped preset and headless profile are narrow domain agents that remain inside the normal harness composition model. Model-visible behavior is fully reconstructable from existing prompt sections, skill catalogs, skill loads, and tool schemas, so no new session event is required. The Web profile surface can select the preset through its bundle; `dsh --profile mcmod "task"` uses the headless bundle stack.

The implementation depends on a host Java language server being available when the profile enables the bundle. A missing or misconfigured JDTLS affects only LSP queries; file, search, foreground shell, Minecraft project tools, skills, ask-user, permissions, compaction, and session persistence continue to come from their existing packages. Without background job controls, long-running Gradle work must be bounded in foreground calls or re-enabled through an explicit profile overlay that also restores shell background support.
