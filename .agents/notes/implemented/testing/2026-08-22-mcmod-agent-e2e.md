# Agent Note: mcmod agent end-to-end fixture

Status: implemented

English | [中文](2026-08-22-mcmod-agent-e2e.zh.md)

## Problem

The mcmod profile had prompt, bundle, project-detection, resource-validation, and check-runner coverage, but no single test proved the shipped headless agent could modify a Minecraft project and then validate the result through its model-facing Minecraft tools. Unit tests could show each tool works, while still missing product CLI profile initialization, Loader composition, tool visibility, and filesystem effects in one run.

Real Fabric or NeoForge builds are a poor default keyless fixture because they can download Gradle, Minecraft jars, mappings, and loader dependencies. A CI-runnable proof needs the same agent and tool path without external dependency resolution, while a separate real-build scenario must report an explicit environment skip when Gradle or dependencies are unavailable.

## Decision

`examples/headless-agent/tests/mcmod.e2e.ts` creates minimal Fabric and NeoForge workspaces, boots `dsh --profile mcmod` through the product CLI, and verifies the resulting world outside the agent. The keyless cases replace the LLM route with scripted adapters. Each case replaces the deployment-owned Java LSP executable with the current Node binary, while the CLI, profile initialization, Loader tree, file tools, `detect_mc_project`, `validate_mc_resources`, `run_mc_check`, sandbox mode, and session persistence stay real.

The keyless fixtures use local deterministic wiring wrappers, not Gradle implementations. `gradlew` and `gradlew.bat` delegate to a Node check that accepts the requested build or `runData` task only after the agent-created Java registration, loader metadata, language file, item model, and binary PNG are present and internally consistent. This keeps the check-runner path honest without claiming compilation or Minecraft runtime compatibility. A separate real Gradle fixture uses pinned wrapper/plugin/dependency versions when the host supplies Gradle and its dependency cache; otherwise the test is skipped with the missing prerequisite named.

A with-key e2e uses the real DeepSeek route when `DEEPSEEK_API_KEY` is available. It asserts the same external files and wrapper result, and also checks that the persisted log contains the Minecraft tool calls. Secretless environments skip only this live-model case.

## Alternatives considered

- **Only extending `tool-mc-project` unit tests** — rejected because those tests do not boot the product profile, exercise model-visible tool selection, persist a session, or prove the agent can edit a workspace before validation.
- **Running a real Fabric or NeoForge Gradle build in every keyless CI run** — rejected because dependency downloads and cache state would make the fixture slow, flaky, or network-dependent. The local wiring wrappers prove command selection and post-edit validation; real project builds remain an explicit environment-gated scenario.
- **Using text placeholders for textures** — rejected because the validator must reject disguised PNGs. The keyless fixtures carry one tiny valid binary PNG.

## Consequences

The mcmod profile now has an assembled, product-entry e2e that fails when the profile stops exposing the Minecraft tools, when the agent cannot create the expected files, or when `run_mc_check build` does not reach the wrapper. The keyless proof does not claim Minecraft runtime compatibility or dependency resolution; those remain the responsibility of real Gradle builds in concrete projects.
