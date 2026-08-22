# minecraft/ — Minecraft agent packages

English | [中文](README.zh.md)

Minecraft-domain packages for DeepSeek Harness agent compositions.

| Package | Role | ctx key |
|---|---|---|
| [`mcmod-agent/`](mcmod-agent/README.md) | Prompt-only Fabric-first Minecraft Java mod-development guidance for agent presets | — (prompt sections only) |
| [`tool-mc-project/`](tool-mc-project/README.md) | Read-only `detect_mc_project` tool that reports Gradle, metadata, source, resource, mixin, datagen, and validation-command clues | — (tool only) |

The domain packages do not replace the core agent loop. They compose with profile bundles and presets, reusing the existing file, search, shell, LSP, skill, compaction, permission, and session-persistence capability families.
