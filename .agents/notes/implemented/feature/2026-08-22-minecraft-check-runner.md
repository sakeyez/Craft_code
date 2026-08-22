# Agent Note: Minecraft check runner

Status: implemented

English | [中文](2026-08-22-minecraft-check-runner.zh.md)

## Problem

Minecraft modding agents need repeatable validation choices after project detection. The detector can recommend likely Gradle commands, but leaving command selection to each model turn makes the agent restate wrapper, loader, datagen, and resource-check rules by hand, and failures return as unstructured shell text.

## Decision

`@deepseek-ai/dsh-tool-mc-project` registers `run_mc_check` when the mounted composition provides `ctx.shell`. The tool first calls the package's detector logic, selects the Gradle wrapper or `gradle` from workspace evidence, maps the requested target to loader-aware tasks, and runs each Gradle command through `ctx.shell.run(ctx.shell.resolve(...))`.

The runner supports `build`, `test`, `datagen`, `resources`, and `all`. Fabric and Quilt datagen use `runDatagen`; Forge and NeoForge use `runData`; unknown loader evidence fails before execution. `resources` runs the static `validate_mc_resources` check before Gradle `processResources`, and `all` runs datagen only when detection found datagen clues, then resources, test, and build, stopping at the first failed step.

The result is one structured JSON object with planned `commands`, per-step exit and sandbox facts, stdout/stderr summaries, `failedStep`, and `suggestedNextAction`. Shell-level timeout, sandbox, subprocess, and spill behavior remain owned by the mounted shell executor; `run_mc_check` only summarizes the already-collected stream tails with its own inline byte cap.

## Alternatives considered

**Keep validation as shell guidance.** Rejected because the agent would still need to translate detector facts into commands every time and would receive failures as ordinary shell output rather than a stable step record.

**Probe the Gradle task graph before choosing commands.** Rejected for v1 because `gradle tasks` can run build logic, download dependencies, and be nearly as expensive as the selected check. Missing tasks surface as the selected command's failure.

**Run through `ctx.subprocess` directly.** Rejected because it would bypass the configured shell executor's sandbox, timeout, environment, and output-retention policies. The runner is an orchestrator over the existing shell capability, not a process provider.

**Make `resources` only a Gradle task.** Rejected because this package already owns deterministic resource-reference checks that Gradle compilation can miss. Running static validation before `processResources` gives the agent a precise resource failure before a broader build step.

## Consequences

Minecraft agents now have a single tool for common verification targets with consistent failure localization. The tool is absent in detection-only compositions without `ctx.shell`, so read-only deployments keep their smaller dependency set. The first version does not infer subproject task paths, included builds, Maven builds, custom launchers, or dynamic Gradle tasks; those cases fail as unavailable project evidence or ordinary Gradle command failures.
