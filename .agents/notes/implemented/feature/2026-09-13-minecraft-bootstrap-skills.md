# Minecraft bootstrap and workflow skills

English | [中文](2026-09-13-minecraft-bootstrap-skills.zh.md)

The mcmod profile exposes `bootstrap_mc_project` for deterministic creation of a supported Fabric or NeoForge project in an empty directory. The operation validates identifiers and versions, confines all writes to the session workspace through `ctx.fs`, refuses non-empty targets, generates a complete minimal Gradle/metadata/source template, and reports Java readiness in phase-structured output. Project creation, environment diagnosis, standard content addition, and build diagnosis are separate skills; the tool does not claim a Gradle build or gameplay run without evidence. Detection reuses one bounded resource-root walk for metadata and mixin clues, and the keyless workflow detects project facts before edits.
