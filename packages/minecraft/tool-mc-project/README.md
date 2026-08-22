# dsh-tool-mc-project

English | [中文](README.zh.md)

Read-only model-facing Minecraft project detector. It registers `detect_mc_project`, which inspects the current session workspace through `ctx.fs` and returns structured JSON facts about Gradle files, mod metadata, source roots, resource roots, mixins, datagen clues, and validation commands.

The tool is evidence extraction, not Gradle evaluation. Missing files, parse failures, conflicting loader clues, and unknown fields are reported through `warnings`; the tool still returns a schema-valid result.

## Tool

| Tool | Purpose |
|---|---|
| `detect_mc_project` | Detects loader, Minecraft version, mappings, mod id candidates, Java/Kotlin use, source sets, resource roots, mixin configs, datagen clues, inspected files, warnings, and recommended Gradle validation commands. |

## Config

| Field | Default | Meaning |
|---|---:|---|
| `maxEntries` | `2000` | Maximum directory entries walked while discovering source/resource and metadata clues. |
| `maxFileBytes` | `524288` | Maximum bytes read from one candidate text file. Larger files are skipped with a warning. |

Both fields must be positive integers. The detector does not execute Gradle tasks or shell commands.

## Model Experience

### Minecraft Project Detection

#### What the model sees

The model sees the `detect_mc_project` tool schema. The tool has no parameters and returns one JSON object:

```json
{
  "workspace": "string",
  "loader": "fabric|forge|neoforge|quilt|unknown",
  "minecraftVersion": "string|null",
  "mappings": { "type": "string", "version": "string|null", "evidence": ["string"] },
  "modIdCandidates": [{ "id": "string", "source": "string", "confidence": "high|medium|low" }],
  "languages": { "java": "boolean", "kotlin": "boolean" },
  "mainSourceSets": [{ "name": "string", "java": ["string"], "kotlin": ["string"], "resources": ["string"] }],
  "resourceRoots": ["string"],
  "mixinConfigs": [{ "path": "string", "source": "string" }],
  "datagenClues": [{ "kind": "string", "source": "string", "detail": "string" }],
  "recommendedValidationCommands": ["string"],
  "inspected": { "gradleFiles": ["string"], "metadataFiles": ["string"], "sourceRoots": ["string"], "resourceRoots": ["string"] },
  "warnings": ["string"]
}
```

The Native render is the same object pretty-printed as JSON. `presentCall` labels the pending card `Detect Minecraft project`; `presentResult` shows the rendered JSON in a generic result card.

#### Token effect

One tool schema is added to every request made by an agent whose composition mounts this package. Tool results contain compact JSON facts and warning strings from the current workspace scan.

#### KV Cache effect

Prefix-stable for the life of the mounted composition. Result content is per-call workspace state and is not prefix-cacheable.

## Known Limitations and Deferred Work

- **No Gradle evaluation** - variables, convention plugins, included builds, and generated source-set declarations are recognized only when their text leaves direct clues.
- **Evidence conflicts stay explicit** - conflicting loader evidence returns `loader: "unknown"` with a warning instead of choosing a winner.
- **Validation commands are recommendations** - the detector names likely Gradle commands but never proves that a task exists by executing Gradle.
