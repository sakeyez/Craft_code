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
- The shipped `mcmod` preset mounts the prompt package plus existing file, search, platform shell, jobs, `lsp`, skill, ask-user, and compaction rows. Its bundled `minecraft-modding` skill travels with the preset through a `customSkillDirs` entry resolved from the preset's `baseUrl`.
- `@deepseek-ai/dsh-mcmod-headless-bundle` is a profile patch layer applied after `dsh-base` and `dsh-headless`. The shipped `mcmod` profile template uses those three bundles to run the existing one-shot headless runner with Fabric-first Minecraft modding prompt sections, the bundled `minecraft-modding` skill, Java LSP, and a first-version code-development tool set.

The v1 default is Fabric + Java + Minecraft 1.21.x when a project has not already made a loader or version decision. The prompt tells the model to detect existing loader facts from Gradle, metadata, dependency coordinates, main mod class, and mixin config before choosing APIs, and to avoid mixing Fabric, Forge, NeoForge, Architectury, or cross-version Minecraft APIs. The preset intentionally omits web search, workflow, Ralph, general subagents, todo, and goal tools. Those capabilities remain available to other presets and to user-authored copies that choose to add them.

Java LSP is deployment-owned. Both bundle defaults use stdio command `jdtls`, with `.java` mapped to language id `java`; a profile overlay can replace the full `lsp-stdio` row when a machine needs an absolute JDTLS path or arguments.

## Alternatives considered

**Forking `agent-loop`.** Rejected because the desired behavior is prompt and composition policy, not loop semantics. The existing plugin architecture already provides the required extension points, while a loop fork would need its own tool, prompt, session, and compaction integration.

**One loader-agnostic Minecraft preset with no default.** Rejected for v1 because users need a concrete prototype when the project is blank or undecided. Fabric + Java + Minecraft 1.21.x is the default target, while existing loader facts still override guesses.

**Enabling web search by default.** Rejected for v1 because Minecraft loader API facts are version-sensitive. The first preset prefers local project facts, dependencies, sources, and explicit user-provided documentation over general web results.

**Adding Minecraft-specific tools.** Rejected for v1 because existing file/search/shell/LSP/skill tools cover the first workflow. New tools remain addable if a later feature needs model-visible persisted state or structured Minecraft operations.

## Consequences

The shipped preset and headless profile are narrow domain agents that remain inside the normal harness composition model. Model-visible behavior is fully reconstructable from existing prompt sections and tool schemas, so no new session event is required. The Web profile surface can select the preset through its bundle; `dsh --profile mcmod "task"` uses the headless bundle stack.

The implementation depends on a host Java language server being available when the profile enables the bundle. A missing or misconfigured JDTLS affects only LSP queries; file, search, shell, skills, jobs, ask-user, permissions, compaction, and session persistence continue to come from their existing packages.
