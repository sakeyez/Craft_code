---
name: minecraft-project-create
description: Use when creating a Minecraft mod project from an empty directory; call bootstrap_mc_project before writing a Gradle template by hand.
---
# Minecraft Project Creation
Use `bootstrap_mc_project` for new Fabric or NeoForge Java projects. Confirm the target is empty, use a supported exact version, and distinguish generated files, environment readiness, build success, and unverified gameplay. After success run `detect_mc_project` and `validate_mc_resources`, then load the loader-specific development skill.
