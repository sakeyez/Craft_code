# Agent Note: mcmod agent end-to-end fixture

Status: implemented

English | [中文](2026-08-22-mcmod-agent-e2e.zh.md)

## Problem

The mcmod profile had prompt, bundle, project-detection, resource-validation, and check-runner coverage, but no single test proved the shipped headless agent could modify a Minecraft project and then validate the result through its model-facing Minecraft tools. Unit tests could show each tool works, while still missing product CLI profile initialization, Loader composition, tool visibility, and filesystem effects in one run.

Real Fabric builds are a poor default keyless fixture because they can download Gradle, Minecraft jars, mappings, and loader dependencies. A CI-runnable proof needs the same agent and tool path without external dependency resolution.

## Decision

`examples/headless-agent/tests/mcmod.e2e.ts` creates a minimal Fabric workspace, boots `dsh --profile mcmod` through the product CLI, and verifies the resulting world outside the agent. The keyless case replaces the LLM route with a scripted adapter. Both cases replace the deployment-owned Java LSP executable with the current Node binary, while the CLI, profile initialization, Loader tree, file tools, `detect_mc_project`, `validate_mc_resources`, `run_mc_check`, sandbox mode, and session persistence stay real.

The fixture's Gradle wrapper is local and deterministic. `gradlew` and `gradlew.bat` delegate to `gradle-fixture-check.mjs`, which accepts the `build` task only after the agent-created Java registration, language file, item model, and placeholder texture are present and internally consistent. This keeps the check runner path honest without making CI depend on Gradle or Minecraft downloads.

A with-key e2e uses the real DeepSeek route when `DEEPSEEK_API_KEY` is available. It asserts the same external files and wrapper result, and also checks that the persisted log contains the Minecraft tool calls. Secretless environments skip only this live-model case.

## Alternatives considered

- **Only extending `tool-mc-project` unit tests** — rejected because those tests do not boot the product profile, exercise model-visible tool selection, persist a session, or prove the agent can edit a workspace before validation.
- **Running a real Fabric Gradle build in keyless CI** — rejected because dependency downloads and cache state would make the fixture slow, flaky, or network-dependent. The local wrapper proves command selection and post-edit validation; real project builds remain project-owned checks.
- **Committing a binary PNG fixture** — rejected because the static validator needs only a local texture path for this case. A text placeholder keeps the fixture small and diffable.

## Consequences

The mcmod profile now has an assembled, product-entry e2e that fails when the profile stops exposing the Minecraft tools, when the agent cannot create the expected files, or when `run_mc_check build` does not reach the wrapper. The keyless proof does not claim Minecraft runtime compatibility or dependency resolution; those remain the responsibility of real Gradle builds in concrete projects.
