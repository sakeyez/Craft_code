# Agent Note: Minecraft validation evidence boundaries

Status: implemented

English | [中文](2026-09-13-minecraft-validation-evidence.zh.md)

## Problem

Bounded project scans and process exit codes can look successful while files or runtime tests remain unexamined. Minecraft Gradle builds also commonly declare resource roots outside the conventional source-set directory.

## Decision

Minecraft project detection reports scan completeness, includes statically declared Gradle resource directories, and treats deterministic version-incompatible resource locations as errors. Resource validation reuses a detection snapshot within one check, but invalidates it after datagen or another operation that can change project inputs. Benchmark runtime success requires named GameTest evidence in a report; missing or ambiguous evidence is inconclusive. Gradle output retains a bounded head-and-tail summary while preserving a spill path when supplied by the shell.

## Alternatives considered

**Treat bounded scans and zero-exit processes as passing.** Rejected because omitted resources and empty runtime processes create false confidence.

**Evaluate every Gradle DSL declaration.** Rejected because full Gradle evaluation would duplicate the build system and introduce uncontrolled execution; static literals are supported and dynamic declarations remain explicitly incomplete.

**Cache detection across independent tool calls.** Rejected because filesystem mutations between calls cannot be observed safely without a durable fingerprint; reuse is limited to one check invocation with invalidation after mutating steps.

## Consequences

False passes become inconclusive or failed when evidence is incomplete, while ordinary projects avoid duplicate detection work. Dynamic Gradle configuration and runtime output formats still require a project-specific check when they do not expose static evidence.
