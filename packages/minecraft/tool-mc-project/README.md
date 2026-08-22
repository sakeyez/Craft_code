# dsh-tool-mc-project

English | [中文](README.zh.md)

Model-facing Minecraft project tools. The package registers `detect_mc_project`, which returns structured project facts; `validate_mc_resources`, which reports deterministic Minecraft asset/data resource problems that Gradle compilation may not catch; and `run_mc_check`, which chooses and runs focused Gradle checks when a shell executor is mounted.

`detect_mc_project` and `validate_mc_resources` read the current session workspace through `ctx.fs`. They extract evidence; they do not evaluate Gradle, execute shell commands, download dependencies, or emulate Minecraft resource loading. `run_mc_check` first reuses detection, then executes the selected Gradle commands through `ctx.shell`, so the mounted shell, subprocess, sandbox, timeout, and output-retention policies remain authoritative.

## Tool

| Tool | Purpose |
|---|---|
| `detect_mc_project` | Detects loader, Minecraft version, mappings, mod id candidates, Java/Kotlin use, source sets, resource roots, mixin configs, datagen clues, inspected files, warnings, and recommended Gradle validation commands. |
| `validate_mc_resources` | Validates lang, model, blockstate, recipe, and tag JSON files; checks local model texture and blockstate model references; reports suspicious namespaces and asset namespace mismatches against detected metadata. |
| `run_mc_check` | Runs `build`, `test`, `datagen`, `resources`, or `all` by selecting Gradle wrapper or `gradle` commands from detected project facts and returning structured step results. |

## Config

| Field | Default | Meaning |
|---|---:|---|
| `maxEntries` | `2000` | Maximum directory entries walked while discovering source/resource and metadata clues. |
| `maxFileBytes` | `524288` | Maximum bytes read from one candidate text file. Larger files are skipped with a warning. |
| `maxOutputSummaryBytes` | `4096` | Maximum UTF-8 bytes retained inline from each `run_mc_check` stdout/stderr tail after shell-level truncation or spill. |

All fields must be positive integers. The read-only tools do not execute Gradle tasks or shell commands.

## Model Experience

### Minecraft Project Detection

#### What the model sees

The model sees the [`detect_mc_project`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-mc-project) tool schema. The tool has no parameters; its canonical result includes workspace, loader, Minecraft version, mappings, mod id candidates, language flags, source/resource roots, mixin configs, datagen clues, recommended validation commands, inspected paths, and warnings. The Native render is the same object pretty-printed as JSON. `presentCall` labels the pending card `Detect Minecraft project`; `presentResult` shows the rendered JSON in a generic result card.

#### Token effect

One tool schema is added to every request made by an agent whose composition mounts this package. Tool results contain compact JSON facts and warning strings from the current workspace scan.

#### KV Cache effect

Prefix-stable for the life of the mounted composition. Result content is per-call workspace state and is not prefix-cacheable.

### Minecraft Check Runner

#### What the model sees

The model sees the [`run_mc_check`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-mc-project) tool schema only when this package is mounted in a composition that already provides `ctx.shell`. The tool accepts `target` (`build`, `test`, `datagen`, `resources`, or `all`) and optional per-command `timeoutMs`. Its canonical result contains `commands`, `exitCode`, `steps`, `failedStep`, and `suggestedNextAction`; each step carries command identity when applicable, status, exit data, stdout/stderr summaries, and sandbox facts from the shell result. `resources` runs static `validate_mc_resources` before Gradle `processResources`; `all` stops at the first failed step.

#### Token effect

When `ctx.shell` is present, one additional tool schema is added to every request made by an agent whose composition mounts this package. Results contain one compact JSON object with shell-output summaries rather than full Gradle logs.

#### KV Cache effect

Prefix-stable for the life of the mounted composition and the presence of `ctx.shell`. Result content is per-call workspace and process state and is not prefix-cacheable.

### Minecraft Resource Validation

#### What the model sees

The model sees the [`validate_mc_resources`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-mc-project) tool schema. The tool has no parameters; its canonical result contains `errors`, `warnings`, `checkedFiles`, and `detectedModId`, where each issue carries `code`, `path`, `message`, `reference`, and `expectedPath`. The Native render is the same object pretty-printed as JSON. `presentCall` labels the pending card `Validate Minecraft resources`; `presentResult` shows the rendered JSON in a generic result card.

#### Token effect

One tool schema is added to every request made by an agent whose composition mounts this package. Tool results contain compact JSON issue arrays and checked-file paths from the current workspace scan.

#### KV Cache effect

Prefix-stable for the life of the mounted composition. Result content is per-call workspace state and is not prefix-cacheable.

## Known Limitations and Deferred Work

- **No Gradle evaluation** - variables, convention plugins, included builds, and generated source-set declarations are recognized only when their text leaves direct clues.
- **Evidence conflicts stay explicit** - conflicting loader evidence returns `loader: "unknown"` with a warning instead of choosing a winner.
- **Gradle task availability is not probed** - `run_mc_check` does not execute `gradle tasks`; a missing task is reported as that Gradle command's failure.
- **Root-project commands only** - v1 does not infer subproject task paths, included builds, Maven builds, or custom launchers.
- **Shell execution is composition-owned** - `run_mc_check` is absent without `ctx.shell`, and sandbox denials or timeout limits are reported from the mounted executor rather than bypassed.
- **Resource validation is static** - `validate_mc_resources` checks only workspace files under detected or conventional resource roots. Missing vanilla, dependency, generated, or runtime-provided assets are ignored unless the reference targets the current mod namespace.
