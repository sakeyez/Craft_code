# dsh-minecraft-neoforge-headless-bundle

English | [中文](README.zh.md)

Headless profile bundle for the shipped Minecraft NeoForge mod-development agent. It is intended to sit after [`dsh-base`](../base/README.md) and [`dsh-headless`](../headless/README.md), so `dsh --profile minecraft-neoforge "task"` runs the existing one-shot headless runner with a NeoForge-focused prompt, Java LSP, and a narrow tool set.

The package is a patch-list carrier. Its manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`; the profile composer resolves that patch through the manifest and applies it over the profile's earlier bundle layers.

## Patch Contents

The patch keeps the `headless-runner` from `dsh-headless` and the base services for filesystem access, platform shell execution, skill loading, compaction, permissions, credentials, model routing, and session persistence. It adds:

| Row | Package | Purpose |
|---|---|---|
| `minecraft-neoforge-agent` | `@deepseek-ai/dsh-minecraft-neoforge-agent` | Registers the NeoForge prompt sections on the global headless agent scope. |
| `lsp` | `@deepseek-ai/dsh-lsp` | Provides the `ctx.lsp` registry. |
| `lsp-stdio` | `@deepseek-ai/dsh-lsp-stdio` | Registers a Java provider for `.java` files with command `jdtls` and language id `java`. |
| `tool-lsp` | `@deepseek-ai/dsh-tool-lsp` | Exposes the read-only `lsp` tool to the model. |
| `skill-filesystem` | existing base row | Adds the bundled `neoforge-modding` skill directory while retaining normal project and user skill roots. |

The Java command is deliberately plain `jdtls`. A profile can replace the full `lsp-stdio` row in its own `cordis.patch.yml` when JDTLS lives at a machine-specific path or needs arguments.

The patch disables web retrieval, workflow orchestration, Ralph, general subagents, jobs, goals, todos, plan mode, and the legacy str-replace editor row. Those rows are inherited from `dsh-base`; they stay available to other profiles and to user-authored copies that choose to re-enable them. The first version keeps only file/search tools, the platform shell tool, `lsp`, `skill`, compaction, permissions, and session persistence.

## Model Experience

### Headless NeoForge agent

#### What the model sees

The model sees the headless persona, the five NeoForge prompt sections from `@deepseek-ai/dsh-minecraft-neoforge-agent`, and the remaining model-facing tool schemas: filesystem read/write/edit/search, one platform shell tool, `lsp`, and `skill`.

#### Token effect

The request prefix gains the NeoForge prompt sections and the LSP tool guidance. The bundled skill appears in the skill catalog and is loaded only when the model calls the skill tool.

#### KV Cache effect

The profile has a stable prefix for a given installed patch and skill catalog. Changing the bundle patch, the NeoForge prompt package, or the bundled skill catalog changes the prefix for new requests in that profile.

## Known Limitations and Deferred Work

- **Headless only** - this bundle does not mount Web Host rows or the Web agent-preset roster. Use [`minecraft-neoforge/`](../minecraft-neoforge/README.md) for the Web profile layer.
- **JDTLS is deployment-owned** - the default command name must resolve on the host PATH. Project-specific or machine-specific JDTLS launch details belong in the profile's own overlay.
- **No background jobs in v1** - long-running Gradle commands run through the ordinary shell tool, so callers should prefer bounded checks or re-enable jobs in a profile overlay when they need background process controls.
