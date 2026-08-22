# Agent Note: Minecraft project detector

Status: implemented

English | [中文](2026-08-22-minecraft-project-detector.zh.md)

## Problem

The Minecraft modding preset asks the model to identify loader, Minecraft version, mappings, source sets, resources, mixins, and datagen clues before editing. Prompt-only guidance still leaves those facts scattered across Gradle files, mod metadata, and directory layout, so the model can guess from incomplete reads or treat one common Fabric pattern as the current repository.

## Decision

`@deepseek-ai/dsh-tool-mc-project` registers the read-only `detect_mc_project` tool. It scans the current session workspace through `ctx.fs`, reads bounded Gradle and metadata files, walks bounded source/resource roots, and returns one structured JSON object with loader, Minecraft version, mappings, mod id candidates, Java/Kotlin use, source sets, resource roots, mixin configs, datagen clues, recommended validation commands, inspected paths, and warnings.

The detector extracts evidence; it does not evaluate Gradle or execute commands. Missing files, parse failures, oversized candidate files, scan caps, unknown facts, and conflicting loader evidence produce warnings while the tool still returns a schema-valid result. Conflicting loader evidence sets `loader` to `unknown` rather than selecting one API family.

The shipped `mcmod` Web preset and `mcmod-headless` profile mount the detector beside the existing file/search/shell/LSP/skill tools, so both Minecraft entrypoints can ask for the same project fact summary before edits.

## Alternatives considered

**Keep prompt-only detection.** Rejected because the model-visible request would still carry only instructions, not a repeatable fact extraction result. Prompt discipline cannot make loader conflicts, missing metadata, or scan limits visible as structured data.

**Run Gradle tasks to discover project state.** Rejected for the detector because Gradle can download dependencies, run arbitrary build logic, and take much longer than a cheap first read. The tool recommends validation commands and leaves execution to the ordinary shell path after the agent has context.

**Pick the strongest loader clue on conflicts.** Rejected because mixed evidence is exactly when choosing Fabric, Forge, NeoForge, or Quilt APIs is risky. Returning `unknown` with the conflicting loaders forces the next step to inspect or ask rather than silently mixing APIs.

## Consequences

Minecraft agents now have a deterministic first-pass project summary that is easy to test and replay. The summary remains conservative: convention plugins, generated Gradle source sets, and variable indirection are detected only when their text leaves direct clues. Future work can add more metadata readers or Gradle-text patterns without changing the core agent loop.
