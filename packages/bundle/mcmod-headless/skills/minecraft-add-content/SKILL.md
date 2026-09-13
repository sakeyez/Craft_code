---
name: minecraft-add-content
description: Use for standard Minecraft item or block additions, including registration and matching resources.
---
# Minecraft Content Addition
Detect loader, version, mod id, registration conventions, and generated-resource ownership first. For standard items or blocks keep Java registration, language keys, models, blockstates, recipes, tags, and loot consistent. Run `validate_mc_resources` and the narrowest `run_mc_check`; route entities, complex block entities, and cross-loader abstractions to the loader skill.
