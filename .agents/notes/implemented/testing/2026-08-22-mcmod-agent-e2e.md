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

The on-demand repeated benchmark in `scripts/mcmod-agent-benchmark.ts` measures a named agent revision on three repository-owned NeoForge tasks. Every repetition starts from a copy whose digest matches one real MDK baseline. The runner preserves the generated project, folds the durable Session log into timing, token, retry, step, tool-call, duplicate-read, and build-attempt evidence, and independently runs the Gradle wrapper after the agent exits. Its Markdown and JSON reports define success as an independent build plus every automated static acceptance check; runtime-only acceptance items remain explicitly unverified. The Windows launcher persists machine-local inputs outside Git and accepts explicit output plus report-opening controls, so interactive and background Codex controllers use the same execution path without exposing benchmark controls to the tested agent.

## Alternatives considered

- **Only extending `tool-mc-project` unit tests** — rejected because those tests do not boot the product profile, exercise model-visible tool selection, persist a session, or prove the agent can edit a workspace before validation.
- **Running a real Fabric or NeoForge Gradle build in every keyless CI run** — rejected because dependency downloads and cache state would make the fixture slow, flaky, or network-dependent. The local wiring wrappers prove command selection and post-edit validation; real project builds remain an explicit environment-gated scenario.
- **Using text placeholders for textures** — rejected because the validator must reject disguised PNGs. The keyless fixtures carry one tiny valid binary PNG.
- **Treating the agent's final response or its own build result as benchmark truth** — rejected because a model can omit work or misreport success. The benchmark retains the transcript but derives success from an independent build and filesystem inspection.

## Consequences

The mcmod profile has an assembled, product-entry e2e that fails when the profile stops exposing the Minecraft tools, when the agent cannot create the expected files, or when `run_mc_check build` does not reach the wrapper. The repeated benchmark provides comparative correctness, stability, duration, token, tool-use, recovery, and efficiency evidence for one named revision. Static inspection and compilation do not prove gameplay, rendering, world reload, hopper behavior, or Dedicated Server loading, so the report keeps those results unverified rather than inflating its success rate.
