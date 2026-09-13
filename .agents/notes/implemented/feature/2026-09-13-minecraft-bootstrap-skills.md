# Minecraft bootstrap and workflow skills

The mcmod profile exposes `bootstrap_mc_project` for deterministic creation of a supported Fabric or NeoForge project in an empty directory. The operation validates identifiers and versions, refuses non-empty targets, generates a small pinned metadata/source skeleton, and reports Java readiness in phase-structured output. Project creation, environment diagnosis, standard content addition, and build diagnosis are separate skills; the tool does not claim a Gradle build or gameplay run without evidence.
