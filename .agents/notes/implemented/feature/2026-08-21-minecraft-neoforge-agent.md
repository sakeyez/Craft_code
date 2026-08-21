# Agent Note: Minecraft NeoForge agent preset

Status: implemented

English | [中文](2026-08-21-minecraft-neoforge-agent.zh.md)

## Problem

Minecraft mod development needs domain-specific behavior, but the existing harness already owns the general agent loop, filesystem tools, shell tools, LSP capability, skill loading, compaction, permissions, and session persistence as plugins. Forking `agent-loop` for one modding domain would duplicate those extension points and create a second place where model-visible tool and prompt composition can drift.

The domain is also loader-sensitive. NeoForge, Fabric, Forge, and Architectury use different Gradle plugins, metadata files, mappings, registry APIs, and generated-data conventions. One first-version prompt that covers every loader would encourage the model to mix APIs from different ecosystems and Minecraft versions.

## Decision

Minecraft support ships as a Web profile and agent-preset composition:

- `@deepseek-ai/dsh-minecraft-neoforge-agent` contributes only five prompt sections: `minecraft:identity`, `minecraft:scope`, `minecraft:workflow`, `minecraft:resources`, and `minecraft:version-discipline`.
- `@deepseek-ai/dsh-minecraft-neoforge-bundle` is a profile patch layer that selects `minecraft-neoforge` as the default preset and inserts the host-plane `ctx.lsp` and stdio Java provider rows.
- The shipped `minecraft-neoforge` preset mounts the prompt package plus existing file, search, platform shell, jobs, `lsp`, skill, ask-user, and compaction rows. Its bundled `neoforge-modding` skill travels with the preset through a `customSkillDirs` entry resolved from the preset's `baseUrl`.

The v1 scope is NeoForge Java mods. The prompt tells the model to detect NeoForge from Gradle and mod metadata, to report non-NeoForge projects as outside the v1 implementation scope, and to avoid version-mixed API guesses. The preset intentionally omits web search, workflow, Ralph, general subagents, todo, and goal tools. Those capabilities remain available to other presets and to user-authored copies that choose to add them.

Java LSP is deployment-owned. The bundle's default stdio command is `jdtls`, with `.java` mapped to language id `java`; a profile overlay can replace the full `lsp-stdio` row when a machine needs an absolute JDTLS path or arguments.

## Alternatives considered

**Forking `agent-loop`.** Rejected because the desired behavior is prompt and composition policy, not loop semantics. The existing plugin architecture already provides the required extension points, while a loop fork would need its own tool, prompt, session, and compaction integration.

**One loader-agnostic Minecraft preset.** Rejected for v1 because loader APIs and metadata differ enough that broad guidance would be less reliable than a single NeoForge target.

**Enabling web search by default.** Rejected for v1 because Minecraft and NeoForge API facts are version-sensitive. The first preset prefers local project facts, dependencies, sources, and explicit user-provided documentation over general web results.

**Adding Minecraft-specific tools.** Rejected for v1 because existing file/search/shell/LSP/skill tools cover the first workflow. New tools remain addable if a later feature needs model-visible persisted state or structured Minecraft operations.

## Consequences

The shipped preset is a narrow domain agent that remains inside the normal harness composition model. Model-visible behavior is fully reconstructable from existing prompt sections and tool schemas, so no new session event is required. The Web profile surface can select the preset through the bundle; headless remains a separate composition decision.

The implementation depends on a host Java language server being available when the profile enables the bundle. A missing or misconfigured JDTLS affects only LSP queries; file, search, shell, skills, jobs, ask-user, permissions, compaction, and session persistence continue to come from their existing packages.
