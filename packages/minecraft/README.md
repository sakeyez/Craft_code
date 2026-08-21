# minecraft/ — Minecraft agent packages

English | [中文](README.zh.md)

Minecraft-domain packages for DeepSeek Harness agent compositions.

| Package | Role | ctx key |
|---|---|---|
| [`mcmod-agent/`](mcmod-agent/README.md) | Prompt-only Fabric-first Minecraft Java mod-development guidance for agent presets | — (prompt sections only) |

The domain packages do not replace the core agent loop. They compose with profile bundles and presets, reusing the existing file, search, shell, LSP, skill, compaction, permission, and session-persistence capability families.
