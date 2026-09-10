# dsh-mcmod-bundle

English | [中文](README.zh.md)

Profile bundle for the shipped Minecraft mod-development Web agent. The bundle is a patch-list carrier: its manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, and the profile composer applies that patch after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-desktop-app`.

## Patch contents

The patch selects `mcmod` as the default agent preset and inserts the host-plane LSP rows used by that preset:

| Row | Package | Purpose |
|---|---|---|
| `agent-presets` | existing Web row | Sets the composition default to `mcmod`. |
| `lsp` | `@deepseek-ai/dsh-lsp` | Provides the `ctx.lsp` registry. |
| `lsp-stdio` | `@deepseek-ai/dsh-lsp-stdio` | Registers a Java provider for `.java` files with command `jdtls` and language id `java`. |

The Java command is deliberately plain `jdtls`. A profile that installs this bundle can override the full `lsp-stdio` row in its own `cordis.patch.yml` when JDTLS lives at a machine-specific path or needs arguments.

## Model Experience

### Minecraft Mod Profile Selection

#### What the model sees

Indirectly, new sessions in the profile compose from the shipped `mcmod` preset by default. The model sees that preset's shared Fabric and NeoForge Minecraft modding prompt sections, six scoped Minecraft skills, and the remaining tool schemas: filesystem read/write/edit/search, `detect_mc_project`, `validate_mc_resources`, `run_mc_check`, one foreground-only platform shell tool, `lsp`, `skill`, and `ask_user_question`. The bundle itself contributes no prompt text, skill body, or tool schema.

#### Token effect

No direct token cost. Token changes come from the selected preset, its skill catalog, and the tools mounted by that preset.

#### KV Cache effect

No direct request-prefix contribution. The selected preset decides the prompt prefix for a session.

## Known Limitations and Deferred Work

- **desktop profile surface** — this bundle expects the Web agent-preset roster supplied by `@deepseek-ai/dsh-desktop-app`; it is not the headless task surface.
- **JDTLS is deployment-owned and optional** — the default command name is resolved on the host PATH. If it is unavailable, the desktop profile reports a diagnostic and disables only Java LSP; project-specific or machine-specific launch details belong in the profile's own overlay.
- **No optional tool expansion** — the patch does not enable web search, workflows, Ralph, subagents, background job controls, todo, or goal tools.
