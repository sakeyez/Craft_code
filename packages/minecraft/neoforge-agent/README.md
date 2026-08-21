# dsh-minecraft-neoforge-agent

English | [中文](README.zh.md)

Prompt-only guidance for a Minecraft NeoForge mod-development agent. It contributes NeoForge-specific system-prompt sections and owns no model-facing tools, services, session state, filesystem access, shell access, LSP provider, or permission policy.

The package is meant to be mounted from an [agent preset](../../preset/agent-presets/README.md). The surrounding preset and profile bundle choose the tools and providers; this package only teaches the model how to use those capabilities for NeoForge Java mod work.

## Prompt sections

| Section | Purpose |
|---|---|
| `minecraft:identity` | Identifies the agent as a NeoForge mod-development agent and anchors work in the project root. |
| `minecraft:scope` | Limits v1 to NeoForge Java mods and names the project files used for loader detection. |
| `minecraft:workflow` | Directs Gradle, Java toolchain, version, source, LSP, and verification discovery before edits. |
| `minecraft:resources` | Keeps registry names, namespaces, assets, data files, language keys, and generated data aligned. |
| `minecraft:version-discipline` | Prevents version-mixed API guesses and prefers local project facts, sources, and LSP results. |

The sections render at orders `40` through `44`, after persona text and before tool guidance.

## Config

This package has no config. Loader, JDTLS command, tool exposure, skill roots, compaction thresholds, and permission choices belong to the profile bundle or agent preset.

## Model Experience

### NeoForge guidance

#### What the model sees

The model sees the fixed prompt guidance below.

##### NeoForge prompt sections

```markdown
minecraft:identity — Treat the working directory as the NeoForge mod project root and follow local Gradle, Java, resource, and data-generation conventions.
minecraft:scope — Detect NeoForge from Gradle and mod metadata; report non-NeoForge projects as outside the preset's v1 scope unless the user asks for migration or analysis.
minecraft:workflow — Use file reads, search, and LSP facts before editing; verify with project Gradle tasks and explain risk before expensive runs.
minecraft:resources — Keep Java registry names, namespaces, assets, data files, language keys, and generated data aligned.
minecraft:version-discipline — Derive API usage from pinned project versions, local source, dependency sources, and LSP results instead of cross-version memory.
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

- **NeoForge-only v1** — Fabric, Forge, Architectury, mixed-loader projects, and non-mod projects are outside the supported implementation scope unless the user explicitly asks for analysis or migration.
- **No documentation retrieval** — this package does not enable web search or a NeoForge documentation index. Version-specific API facts must come from the project, local dependencies, local documentation, or explicit user-provided material.
- **No Minecraft-specific tools** — file, search, shell, LSP, skills, compaction, permissions, and persistence are reused from the harness rather than wrapped by Minecraft-specific tools.
