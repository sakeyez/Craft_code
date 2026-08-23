# dsh-mcmod-headless-bundle

English | [中文](README.zh.md)

Headless profile bundle for the shipped Minecraft mod-development agent. It is intended to sit after [`dsh-base`](../base/README.md) and [`dsh-headless`](../headless/README.md), so `dsh --profile mcmod "task"` runs the existing one-shot headless runner with shared Fabric and NeoForge guidance, optional Java LSP, and a narrow tool set.

The package is a patch-list carrier. Its manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`; the profile composer resolves that patch through the manifest and applies it over the profile's earlier bundle layers.

## Patch Contents

The patch keeps the `headless-runner` from `dsh-headless` and the base services for filesystem access, platform shell execution, skill loading, compaction, permissions, credentials, model routing, and session persistence. It adds:

| Row | Package | Purpose |
|---|---|---|
| `mcmod-agent` | `@deepseek-ai/dsh-mcmod-agent` | Registers the Minecraft modding prompt sections on the global headless agent scope. |
| `tool-mc-project` | `@deepseek-ai/dsh-tool-mc-project` | Exposes Minecraft project detection, static resource validation, and shell-backed check orchestration tools to the model. |
| `lsp` | `@deepseek-ai/dsh-lsp` | Provides the `ctx.lsp` registry. |
| `lsp-stdio` | `@deepseek-ai/dsh-lsp-stdio` | Attempts an optional Java provider for `.java` files with command `jdtls` and language id `java`; missing JDTLS is diagnosed and does not block other tools. |
| `tool-lsp` | `@deepseek-ai/dsh-tool-lsp` | Exposes the read-only `lsp` tool to the model. |
| `skill-filesystem` | existing base row | Adds the bundled Minecraft skill directory while retaining normal project and user skill roots. |

The Java command is deliberately plain `jdtls` and marked optional. Startup logs report the unavailable command; files, search, shell, and Minecraft tools remain usable. A profile can replace the full `lsp-stdio` row in its own `cordis.patch.yml` when JDTLS lives at a machine-specific path or needs arguments.

## Loader Scope and Validation

The profile supports Fabric Java and NeoForge Java. Forge and Quilt are detected for diagnostics only; they do not receive loader-specific edits, datagen, or runtime task execution. Architectury, mixed-loader, multi-module, convention-plugin-heavy, and non-mod projects are outside the complete profile scope. Generic `build`, `test`, and resource checks remain available when their Gradle layout is unambiguous.

`validate_mc_resources` is a bounded static file check, not Minecraft runtime verification. Gradle text inspection is also evidence extraction, not complete Gradle semantic evaluation; variables, convention plugins, included builds, and generated task wiring may require manual inspection. The dependency-backed real Gradle fixtures live in `examples/headless-agent/tests/mcmod-real-gradle.e2e.ts` and run only when explicitly enabled with `pnpm run test:e2e:mcmod:gradle`. They are environment-gated because Gradle, network access, and dependency caches are deployment prerequisites, and are distinct from the keyless wiring E2E.

The patch disables web retrieval, workflow orchestration, Ralph, general subagents, jobs, goals, todos, plan mode, and the legacy str-replace editor row. Those rows are inherited from `dsh-base`; they stay available to other profiles and to user-authored copies that choose to re-enable them. The first version keeps only file/search tools, the Minecraft project tools, one foreground-only platform shell tool, `lsp`, `skill`, compaction, permissions, and session persistence.

## Model Experience

### Headless Minecraft Mod Agent

#### What the model sees

The model sees the headless persona, the five shared Fabric/NeoForge Minecraft modding prompt sections from `@deepseek-ai/dsh-mcmod-agent`, six bundled Minecraft skills (`fabric-mod-dev`, `fabric-datagen`, `minecraft-resources`, `mixin-debugging`, `neoforge-mod-dev`, and `neoforge-datagen`) in the skill catalog, and the remaining model-facing tool schemas: filesystem read/write/edit/search, `detect_mc_project`, `validate_mc_resources`, `run_mc_check`, one foreground-only platform shell tool, `lsp`, and `skill`. The shell schema omits `run_in_background`; long validation should use bounded foreground calls or `run_mc_check`.

#### Token effect

The request prefix gains the Minecraft modding prompt sections, the LSP tool guidance, and skill catalog summaries. Each bundled skill body is loaded only when the model calls the skill tool for that skill.

#### KV Cache effect

The profile has a stable prefix for a given installed patch and skill catalog. Changing the bundle patch, the Minecraft modding prompt package, or the bundled skill catalog changes the prefix for new requests in that profile.

## Known Limitations and Deferred Work

- **Headless only** - this bundle does not mount Web Host rows or the Web agent-preset roster. Use [`mcmod/`](../mcmod/README.md) for the Web profile layer.
- **JDTLS is deployment-owned and optional** - the default command name is resolved at startup. Missing JDTLS produces a diagnostic and disables only the Java provider; project-specific launch details belong in the profile's own overlay.
- **No background jobs in v1** - shell tools omit `run_in_background`, so callers should prefer bounded checks or re-enable jobs and shell background support together in a profile overlay when they need background process controls.
