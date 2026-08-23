# dsh-tool-mc-project

English | [中文](README.zh.md)

Model-facing Minecraft project tools. The package registers `detect_mc_project`, which returns structured project facts; `validate_mc_resources`, which reports deterministic Minecraft asset/data resource problems that Gradle compilation may not catch; and `run_mc_check`, which chooses and runs focused Gradle checks when a shell executor is mounted.

`detect_mc_project` and `validate_mc_resources` read the current session workspace through `ctx.fs`. They extract evidence; they do not evaluate Gradle, execute shell commands, download dependencies, or emulate Minecraft resource loading. `run_mc_check` first reuses detection, then executes the selected Gradle commands through `ctx.shell`, so the mounted shell, subprocess, sandbox, timeout, and output-retention policies remain authoritative.

## Tool

| Tool | Purpose |
|---|---|
| `detect_mc_project` | Detects loader evidence, Minecraft version candidates, mappings candidates, mod id candidates, Java/Kotlin use, source sets, resource roots, mixin configs, datagen clues, declared Gradle task candidates, inspected files, warnings, and recommended Gradle validation commands. Version and mappings results preserve `determined`, `unknown`, or `conflict` status plus candidate evidence; an exact version is distinguished from a range. |
| `validate_mc_resources` | Validates language values, model, blockstate, recipe, tag, loot-table, advancement, predicate, item-modifier, and item-definition JSON files; checks bounded PNG signatures/chunks/CRCs, local model parents, local model texture and blockstate model references, suspicious namespaces, and asset namespace mismatches against detected metadata. |
| `run_mc_check` | Runs `build`, `test`, `datagen`, `resources`, `runtime`, or `all` by selecting Gradle wrapper or `gradle` commands from detected project facts. Datagen and runtime tasks are discovered from declared or bounded `tasks --all` output when necessary; runtime requires an explicit approved `runtimeMode`. |

## Config

| Field | Default | Meaning |
|---|---:|---|
| `maxEntries` | `2000` | Maximum directory entries walked while discovering source/resource and metadata clues. |
| `maxFileBytes` | `524288` | Maximum bytes read from one candidate text file. Larger files are skipped with a warning. |
| `maxOutputSummaryBytes` | `4096` | Maximum UTF-8 bytes retained inline from each `run_mc_check` stdout/stderr tail after shell-level truncation or spill. |
| `maxTaskDiscoveryBytes` | `65536` | Maximum stdout bytes captured while discovering Gradle tasks. Truncated output is inconclusive and never selects a task. |

All fields must be positive integers. The read-only tools do not execute Gradle tasks or shell commands.

## Model Experience

### Minecraft Project Detection

#### What the model sees

The model sees the [`detect_mc_project`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-mc-project) tool schema. The tool has no parameters; its canonical result includes workspace, loader and loader evidence, Minecraft version candidates, mappings candidates, mod id candidates, language flags, source/resource roots, mixin configs, datagen clues, recommended validation commands, inspected paths, and warnings. `minecraftVersion` and `mappings` explicitly report `determined`, `unknown`, or `conflict`; a determined version also reports `classification: exact` or `range`, and every candidate keeps its source and evidence. The Native render is the same object pretty-printed as JSON. `presentCall` labels the pending card `Detect Minecraft project`; `presentResult` shows the rendered JSON in a generic result card.

#### Token effect

One tool schema is added to every request made by an agent whose composition mounts this package. Tool results contain compact JSON facts and warning strings from the current workspace scan.

#### KV Cache effect

Prefix-stable for the life of the mounted composition. Result content is per-call workspace state and is not prefix-cacheable.

### Minecraft Check Runner

#### What the model sees

The model sees the [`run_mc_check`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-mc-project) tool schema only when this package is mounted in a composition that already provides `ctx.shell`. The tool accepts `target` (`build`, `test`, `datagen`, `resources`, `runtime`, or `all`), `runtimeMode` (`client` or `server`) for `runtime`, and optional per-command `timeoutMs`. Its canonical result contains `commands`, `exitCode`, `steps`, `failedStep`, and `suggestedNextAction`; each step carries command identity when applicable, status, exit data, stdout/stderr summaries, and sandbox facts from the shell result. Datagen and runtime tasks use declared candidates first and a bounded `tasks --all --console=plain` probe otherwise. `resources` runs static `validate_mc_resources` before Gradle `processResources`; `runtime` can launch a client or dedicated server and must follow user approval; `all` stops at the first failed step.

#### Token effect

When `ctx.shell` is present, one additional tool schema is added to every request made by an agent whose composition mounts this package. Results contain one compact JSON object with shell-output summaries rather than full Gradle logs.

#### KV Cache effect

Prefix-stable for the life of the mounted composition and the presence of `ctx.shell`. Result content is per-call workspace and process state and is not prefix-cacheable.

### Minecraft Resource Validation

#### What the model sees

The model sees the [`validate_mc_resources`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-mc-project) tool schema. The tool has no parameters; its canonical result contains `errors`, `warnings`, `checkedFiles`, and `detectedModId`, where each issue carries `code`, `path`, `message`, `reference`, and `expectedPath`. Static checks reject malformed or truncated PNGs and missing local model parents; existing item-definition JSON files are parsed and checked against the detected Minecraft version when it is exact. Vanilla and dependency namespaces remain outside the local-file check. The Native render is the same object pretty-printed as JSON. `presentCall` labels the pending card `Validate Minecraft resources`; `presentResult` shows the rendered JSON in a generic result card.

#### Token effect

One tool schema is added to every request made by an agent whose composition mounts this package. Tool results contain compact JSON issue arrays and checked-file paths from the current workspace scan.

#### KV Cache effect

Prefix-stable for the life of the mounted composition. Result content is per-call workspace state and is not prefix-cacheable.

## Known Limitations and Deferred Work

- **No Gradle evaluation** - variables, convention plugins, included builds, and generated source-set declarations are recognized only when their text leaves direct clues.
- **Evidence conflicts stay explicit** - conflicting loader evidence returns `loader: "unknown"` with a warning instead of choosing a winner; conflicting version or mappings candidates are returned as `conflict` with all candidate evidence preserved.
- **Gradle evaluation remains bounded** - `run_mc_check` probes `tasks --all --console=plain` only when a datagen or runtime task is not declared in the inspected text; variables, convention plugins, included builds, and generated source-set declarations still require project-specific inspection.
- **Root-project commands only** - `run_mc_check` refuses settings that declare subprojects or included builds because it cannot infer qualified task paths. Maven builds and custom launchers are unsupported.
- **Shell execution is composition-owned** - `run_mc_check` is absent without `ctx.shell`, and sandbox denials or timeout limits are reported from the mounted executor rather than bypassed.
- **Resource validation is static** - `validate_mc_resources` checks only workspace files under detected or conventional resource roots, including JSON root/value types, bounded PNG structure and CRCs, local model parents, and `assets/<namespace>/items` definitions. Missing vanilla, dependency, generated, or runtime-provided assets are ignored unless the reference targets the current mod namespace. Unknown, range-only, or conflicting versions produce warnings instead of an assumed item-definition format.
