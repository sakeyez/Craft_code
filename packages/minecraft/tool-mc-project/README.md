# dsh-tool-mc-project

English | [中文](README.zh.md)

Read-only model-facing Minecraft project tools. The package registers `detect_mc_project`, which returns structured project facts, and `validate_mc_resources`, which reports deterministic Minecraft asset/data resource problems that Gradle compilation may not catch.

Both tools read the current session workspace through `ctx.fs`. They extract evidence; they do not evaluate Gradle, execute shell commands, download dependencies, or emulate Minecraft resource loading. Missing files, parse failures, conflicting loader clues, and unknown fields are reported through structured warnings or errors while the tools still return schema-valid results.

## Tool

| Tool | Purpose |
|---|---|
| `detect_mc_project` | Detects loader, Minecraft version, mappings, mod id candidates, Java/Kotlin use, source sets, resource roots, mixin configs, datagen clues, inspected files, warnings, and recommended Gradle validation commands. |
| `validate_mc_resources` | Validates lang, model, blockstate, recipe, and tag JSON files; checks local model texture and blockstate model references; reports suspicious namespaces and asset namespace mismatches against detected metadata. |

## Config

| Field | Default | Meaning |
|---|---:|---|
| `maxEntries` | `2000` | Maximum directory entries walked while discovering source/resource and metadata clues. |
| `maxFileBytes` | `524288` | Maximum bytes read from one candidate text file. Larger files are skipped with a warning. |

Both fields must be positive integers. The detector does not execute Gradle tasks or shell commands.

## Model Experience

### Minecraft Project Detection

#### What the model sees

The model sees the [`detect_mc_project`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-mc-project) tool schema. The tool has no parameters; its canonical result includes workspace, loader, Minecraft version, mappings, mod id candidates, language flags, source/resource roots, mixin configs, datagen clues, recommended validation commands, inspected paths, and warnings. The Native render is the same object pretty-printed as JSON. `presentCall` labels the pending card `Detect Minecraft project`; `presentResult` shows the rendered JSON in a generic result card.

#### Token effect

One tool schema is added to every request made by an agent whose composition mounts this package. Tool results contain compact JSON facts and warning strings from the current workspace scan.

#### KV Cache effect

Prefix-stable for the life of the mounted composition. Result content is per-call workspace state and is not prefix-cacheable.

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
- **Validation commands are recommendations** - the detector names likely Gradle commands but never proves that a task exists by executing Gradle.
- **Resource validation is static** - `validate_mc_resources` checks only workspace files under detected or conventional resource roots. Missing vanilla, dependency, generated, or runtime-provided assets are ignored unless the reference targets the current mod namespace.
