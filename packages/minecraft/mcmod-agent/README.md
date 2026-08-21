# dsh-mcmod-agent

English | [中文](README.zh.md)

Prompt-only guidance for a Fabric-first Minecraft mod-development agent. It contributes system-prompt sections and owns no model-facing tools, services, session state, filesystem access, shell access, LSP provider, or permission policy.

The package is meant to be mounted from an [agent preset](../../preset/agent-presets/README.md). The surrounding preset and profile bundle choose the tools and providers; this package teaches the model how to use those capabilities for Minecraft Java mod work.

## Prompt sections

| Section | Purpose |
|---|---|
| `minecraft:identity` | Anchors work in the project root and requires loader, version, mappings, Gradle plugin, source set, and resource-root discovery. |
| `minecraft:scope` | Uses Fabric + Java + Minecraft 1.21.x as the default prototype when the project has not already decided a loader or version. |
| `minecraft:workflow` | Requires Gradle files, mod metadata, main mod class, and mixin config reads before edits, then directs focused Gradle validation. |
| `minecraft:resources` | Keeps registry names, namespaces, assets, data files, language keys, and generated data aligned. |
| `minecraft:version-discipline` | Prevents version-mixed API guesses and prefers local project facts, sources, and LSP results. |

The sections render at orders `40` through `44`, after persona text and before tool guidance.

## Config

This package has no config. Loader, JDTLS command, tool exposure, skill roots, compaction thresholds, and permission choices belong to the profile bundle or agent preset.

## Model Experience

### Minecraft Modding Guidance

#### What the model sees

The model sees the fixed prompt guidance below.

##### Minecraft prompt sections

```markdown
minecraft:identity — Identify loader, Minecraft version, mappings, Gradle plugin, source sets, and resource roots before acting.
minecraft:scope — Default undecided prototypes to Fabric + Java + Minecraft 1.21.x while reading existing loader facts first.
minecraft:workflow — Read Gradle files, mod metadata, main mod class, and mixin config before edits; verify with focused Gradle tasks.
minecraft:resources — Keep Java registry names, namespaces, assets, data files, language keys, and generated data aligned.
minecraft:version-discipline — Do not mix Fabric, Forge, NeoForge, Architectury, or cross-version Minecraft APIs.
```

##### Tool schema

```markdown
This package contributes no tool schema.
```

#### Token effect

Fixed for every request made by an agent whose preset mounts this row. The token cost is the five prompt sections only; tool schemas and runtime context are owned by their own packages.

#### KV Cache effect

Prefix-stable for the life of the mounted preset. Different presets that omit or include this package establish different system-prompt prefixes from the first Minecraft section onward.

## Known Limitations and Deferred Work

- **Fabric-first v1** — Projects with no loader decision default to Fabric + Java + Minecraft 1.21.x. Existing Forge, NeoForge, Architectury, mixed-loader, and non-mod projects require the model to report the detected scope and avoid mixing APIs unless the user asks for migration or analysis.
- **No documentation retrieval** — this package does not enable web search or a Minecraft documentation index. Version-specific API facts must come from the project, local dependencies, local documentation, or explicit user-provided material.
- **No Minecraft-specific tools** — file, search, shell, LSP, skills, compaction, permissions, and persistence are reused from the harness rather than wrapped by Minecraft-specific tools.
