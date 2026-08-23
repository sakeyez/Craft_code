# minecraft/ — Minecraft agent packages

English | [中文](README.zh.md)

Minecraft-domain packages for DeepSeek Harness agent compositions.

| Package | Role | ctx key |
|---|---|---|
| [`mcmod-agent/`](mcmod-agent/README.md) | Prompt-only Fabric and NeoForge Minecraft Java mod-development guidance for agent presets | — (prompt sections only) |
| [`tool-mc-project/`](tool-mc-project/README.md) | Minecraft project detection, static resource validation, and shell-backed Gradle check orchestration tools | — (tool only) |

The domain packages do not replace the core agent loop. They compose with profile bundles and presets, reusing the existing file, search, shell, LSP, skill, compaction, permission, and session-persistence capability families.

## Support Matrix

| Loader/project kind | Detection | Loader-specific edits and checks |
|---|---|---|
| Fabric Java | Supported | Supported, including `runDatagen` task selection when project evidence is unambiguous |
| NeoForge Java | Supported | Supported, including `runData` task selection when project evidence is unambiguous |
| Forge or Quilt | Diagnostic-only | Unsupported by this profile; generic build, test, and resource checks remain available |
| Architectury | Diagnostic-only | Unsupported by this profile; no loader-specific edits or checks, while generic checks remain available |
| Mixed-loader, multi-module, or non-mod projects | Partial evidence only | No loader-specific edits; the agent must report scope and ask for an explicit migration or project-specific workflow |
