# dsh-minecraft-neoforge-bundle

English | [中文](README.zh.md)

Profile bundle for the shipped Minecraft NeoForge Web agent. The bundle is a patch-list carrier: its manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, and the profile composer applies that patch after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`.

## Patch contents

The patch selects `minecraft-neoforge` as the default agent preset and inserts the host-plane LSP rows used by that preset:

| Row | Package | Purpose |
|---|---|---|
| `agent-presets` | existing Web row | Sets the composition default to `minecraft-neoforge`. |
| `lsp` | `@deepseek-ai/dsh-lsp` | Provides the `ctx.lsp` registry. |
| `lsp-stdio` | `@deepseek-ai/dsh-lsp-stdio` | Registers a Java provider for `.java` files with command `jdtls` and language id `java`. |

The Java command is deliberately plain `jdtls`. A profile that installs this bundle can override the full `lsp-stdio` row in its own `cordis.patch.yml` when JDTLS lives at a machine-specific path or needs arguments.

## Model Experience

### NeoForge profile selection

#### What the model sees

Indirectly, new sessions in the profile compose from the shipped `minecraft-neoforge` preset by default. The model sees that preset's NeoForge prompt sections and tool schemas. The bundle itself contributes no prompt text or tool schema.

#### Token effect

No direct token cost. Token changes come from the selected preset and the tools mounted by that preset.

#### KV Cache effect

No direct request-prefix contribution. The selected preset decides the prompt prefix for a session.

## Known Limitations and Deferred Work

- **Web profile surface** — this bundle expects the Web agent-preset roster supplied by `@deepseek-ai/dsh-web-app`; it is not the headless task surface.
- **JDTLS is deployment-owned** — the default command name must resolve on the host PATH. Project-specific or machine-specific JDTLS launch details belong in the profile's own overlay.
- **No optional tool expansion** — the patch does not enable web search, workflows, Ralph, subagents, todo, or goal tools.
