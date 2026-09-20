# dsh-mcmod-agent

English | [中文](README.zh.md)

Prompt-only guidance for a Fabric and NeoForge Minecraft Java mod-development agent. It contributes system-prompt sections and owns no model-facing tools, services, session state, filesystem access, shell access, LSP provider, or permission policy.

The package is meant to be mounted from an [agent preset](../../preset/agent-presets/README.md). The surrounding preset and profile bundle choose the tools and providers; this package teaches the model how to use those capabilities for Minecraft Java mod work.


The mounted Minecraft workbench adds exact-classpath `query_mc_api` evidence and automatic project checkpoints before modifying tools. `run_mc_check` accepts `testMode: development | artifact` (default development); artifact runtime checks require the workbench, preserve shell policy and runtime approval, and never accept a server EULA automatically. See the [workbench contract](../mc-workbench/README.md).

## Prompt sections

| Section | Purpose |
|---|---|
| `minecraft:identity` | Matches work to the current request and anchors project tasks in the project root. |
| `minecraft:scope` | Supports Fabric and NeoForge in one workflow; the host-local New Mod wizard initializes new projects, and the model detects loader facts before APIs or datagen in existing projects. |
| `minecraft:workflow` | Selects evidence, skills, edits, and validation by task; reuses valid facts and requires approved game launches. |
| `minecraft:resources` | Keeps registry names, namespaces, version-appropriate assets, data files, language keys, and generated data aligned while stating static-check limits. |
| `minecraft:version-discipline` | Prevents loader/version/mappings conflicts from becoming API guesses and prefers project facts, sources, and LSP results. |

The sections render at orders `40` through `44`, after persona text and before tool guidance.

## Task-dependent workflow

The Minecraft preset uses this package instead of the generic coding workflow. General questions can be answered directly. Visual questions start with the attached image and selected region; missing images are reported rather than searched for across temporary directories, session logs, or game saves. Code explanations and diagnoses follow relevant evidence. Changes require applicable skills and focused verification; explicit full-development and audit requests retain their complete acceptance checks.

Previously confirmed project facts remain usable until the project, relevant configuration, or evidence changes. A follow-up does not restart completed development, and historical procedures apply only to matching tasks. Necessary loader/version research, resource validation, high-risk checks, and game-launch authorization remain required. Ordinary launch uses the independent project runtime task without additional test/build/datagen gates or an IDEA dependency. A client waiting at its title screen is not a startup failure and does not prove gameplay. This is model guidance, not a runtime tool restriction or a guarantee of model compliance.

## Config

This package has no config. Loader, JDTLS command, tool exposure, skill roots, compaction thresholds, and permission choices belong to the profile bundle or agent preset.

## Model Experience

### Minecraft Modding Guidance

#### What the model sees

The model sees the fixed prompt guidance below.

##### Minecraft prompt sections

```markdown
minecraft:identity — Match work to the current request and unfinished objective; general and visual questions do not require a development workflow.
minecraft:scope — New projects are initialized only by the host-local New Mod wizard; after its successful first build, detect Fabric or NeoForge and report determined, unknown, conflicting, or unsupported loader/version/mappings evidence before choosing APIs. Forge, Quilt, Architectury, and other loaders are diagnostic-only in this profile.
minecraft:workflow — Choose only the steps needed for the current request; inspect images first for visual questions, investigate relevant code for diagnosis, and verify changes with focused checks.
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

- **Supported loaders** — Fabric and NeoForge Java projects are supported by the shared guidance. Forge, Architectury, mixed-loader, multi-module, convention-plugin, and non-mod projects require explicit scope reporting; the agent must not invent support from a partial scan.
- **New-project ownership** — The host-local New Mod wizard resolves versions, generates the project, creates the Gradle Wrapper, and completes the first build. The model edits the resulting project but does not initialize a blank directory.
- **No documentation retrieval** — this package does not enable web search or a Minecraft documentation index. Version-specific API facts must come from the project, local dependencies, local documentation, or explicit user-provided material.
- **No Minecraft-specific tools** — file, search, shell, LSP, skills, compaction, permissions, and persistence are reused from the harness rather than wrapped by Minecraft-specific tools.

Workbench excerpts retain draft, file/line, dependency-role and source-mapping provenance. Read the disk version before editing a draft and keep optional integrations valid without the target mod. [Workbench contract](../mc-workbench/README.md).
