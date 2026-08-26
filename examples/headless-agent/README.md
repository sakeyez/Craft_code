# headless-agent

English | [中文](README.zh.md)

This directory owns the replay and real-model test composition for a headless coding agent: DeepSeek V4 + local bash and filesystem tools + subagent delegation + workflows and fresh-agent Ralph iteration + `todo_write` + JSONL persistence. It explicitly mounts the shared agent spine, one root agent, persistence, and checkpoint policy; it is not a second product entry point.

## Run it

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
pnpm dsh --profile headless "fix the failing test in this workspace"
```

The product command is [`dsh --profile headless`](../../apps/cli/README.md): it accepts one nonblank task, creates and persists a fresh session, prints the final assistant text, and exits.

Snapshot suites run this directory's configuration through [`tests/fixtures/headless-driver.ts`](tests/fixtures/headless-driver.ts), an unexported test-only process that emits canonical session events as JSONL before its result record. That stream is test infrastructure, not a supported CLI output format. Child sessions surface only through parent tool events and results.

## Minecraft mcmod E2E

[`tests/mcmod.e2e.ts`](tests/mcmod.e2e.ts) proves `dsh --profile mcmod` through the product CLI for both Fabric and NeoForge wiring. The keyless cases mount a scripted LLM adapter but keep the real profile, Loader tree, filesystem tools, `detect_mc_project`, `validate_mc_resources`, and `run_mc_check`; each replaces only the deployment-owned Java LSP executable with the current Node binary so the test does not require `jdtls` on PATH. The with-key case runs the Fabric fixture with the real DeepSeek route when `DEEPSEEK_API_KEY` is present.

```sh
pnpm exec vitest run examples/headless-agent/tests/mcmod.e2e.ts --config vitest.e2e.config.ts
```

The fixtures are created in each test's temporary cwd. Their `gradlew` and `gradlew.bat` are local wiring wrappers, not Gradle implementations, so the e2e does not download Gradle or Minecraft dependencies; each wrapper checks loader metadata, loader-specific Java wiring, lang entry, model, and a real binary PNG before accepting `build` (Fabric) or `runData` (NeoForge). A project that needs a real Gradle build should run the explicit environment-gated fixture or its own cached build outside this keyless test.

The dependency-backed Fabric and NeoForge fixtures are opt-in and use a real generated Gradle wrapper with pinned plugin and dependency versions:

```sh
pnpm run test:e2e:mcmod:gradle
```

### Repeated live-agent benchmark

[The benchmark runner](../../scripts/mcmod-agent-benchmark.ts) uses the three repository-owned prompts in [`scripts/fixtures/mcmod-agent-benchmark-prompts.md`](../../scripts/fixtures/mcmod-agent-benchmark-prompts.md) with one real, already-buildable Minecraft 1.21.1 / NeoForge 21.1 / Java 21 MDK directory. It copies the unchanged MDK for every repetition, runs `dsh --profile mcmod` serially at least three times per task, then runs an independent `gradlew build` and static acceptance checks outside the agent. It retains every workspace and writes `report.md` plus `report.json` under a fresh output directory.

On Windows, open [`scripts/start-mcmod-agent-benchmark.ps1`](../../scripts/start-mcmod-agent-benchmark.ps1) in VS Code and choose **Run PowerShell File**. The first run asks for the pristine MDK directory and an agent version label, saves them in the gitignored `scripts/mcmod-agent-benchmark.local.json`, and starts the benchmark; later runs reuse those settings and open `report.md` when complete. Run the launcher with `-ResetSettings` to replace the saved values.

A Codex controller or other host automation can pass `-Fixture`, `-AgentLabel`, `-OutputPath`, and `-NoOpenReport` to start the same launcher in the background and monitor its output directory. These controller inputs never enter the tested agent's tool set or prompt.

Set `DEEPSEEK_API_KEY` in the root `.env` or the ambient environment before starting. The MDK baseline must include its Gradle wrapper and must build successfully before the benchmark; dependency downloads and caches are part of the benchmark host, not repaired by the runner.

```sh
pnpm run benchmark:mcmod-agent -- \
  --fixture /absolute/path/to/pristine-neoforge-mdk \
  --runs 3 \
  --agent-patch /absolute/path/to/model-version.patch.yml \
  --agent-label deepseek-v4-flash-<revision>
```

The runner refuses a dirty harness tree unless `--allow-dirty` and an explicit `--agent-label` are both supplied; the Windows launcher supplies both from its saved settings when needed. Repeatable `--agent-patch` values pin model or composition overrides and are recorded in the report. `--prompt-source` can replace the repository prompts, and optional `--prices prices.json` accepts per-million-token `input`, `output`, `cache`, and `reasoning` prices; without it, token counts remain available and cost is `N/A`. Automated success means the independent build and every automated acceptance check pass. Gameplay, world reload, rendering, hopper behavior, and Dedicated Server loading remain `unverified` until a GameTest or manual run provides evidence; the report never counts those items as passed.

When Gradle or dependency resolution is unavailable, the tests print the missing prerequisite and skip; they do not treat a wiring wrapper as a Gradle build.

## E2B POC overlay

[`e2b.cordis.yml`](e2b.cordis.yml) replaces the local filesystem and subprocess providers with one shared E2B sandbox while retaining `dsh-bash-local` and the same model-facing tools. Put `E2B_API_KEY` beside `DEEPSEEK_API_KEY` in the gitignored root `.env`, then run the credential-gated live composition, which drives FS, Bash, PTY, and LSP in one sandbox and proves final deletion:

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/e2b/e2b/tests/composition.e2e.ts
```

The overlay creates the same absolute cwd inside the sandbox, but it does not upload or mount the host workspace. File and Bash mutations exist only in E2B; Cordis, model calls, agent/session state, session logs, skills, and SDK buffers remain on the host. The composition kills its sandbox on timeout and disposal. It is a provider-composition POC, not a whole-harness migration or a workspace-sync feature.

## Advanced configuration

[`advanced.cordis.yml`](advanced.cordis.yml) adds Code Mode and the Cordis tools to the test composition.
