# Agent Note: Fail-closed Minecraft startup gate

Status: implemented

English | [中文](2026-09-14-minecraft-startup-gate.zh.md)

## Problem

A successful compile or Gradle build does not prove that Minecraft can finish mod discovery and initialisation. Launching a broken client/server directly exposes the user to the first failure at the game-start boundary.

## Decision

`run_mc_check` exposes a `startup` target that requires an explicit client/server mode and approval. It runs static resource validation, optional datagen, `processResources`, `test`, and `build` in order, stopping at the first failure. Only then does it run a bounded runtime probe. The probe is accepted after a conservative vanilla readiness marker (or a timeout after that marker); a clean exit without a marker is failed. The model must classify the failed phase, make an evidence-based correction, and rerun the complete gate before presenting the game.

## Alternatives considered

**Treat a successful build as launch proof.** Rejected because compilation does not exercise mod discovery, metadata loading, or runtime initialisation.

**Always launch the game directly after edits.** Rejected because it exposes predictable failures to the user and makes environment/dependency errors harder to classify before the launch boundary.

## Consequences

The user sees a structured blocked result instead of a game window that immediately fails. Runtime markers are intentionally conservative and may require a project-specific follow-up when a loader emits a different log format; a passing gate is evidence of startup readiness, not a guarantee of later gameplay correctness.
