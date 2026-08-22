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

[`tests/mcmod.e2e.ts`](tests/mcmod.e2e.ts) proves `dsh --profile mcmod` through the product CLI. The keyless case mounts a scripted LLM adapter but keeps the real profile, Loader tree, filesystem tools, `detect_mc_project`, `validate_mc_resources`, and `run_mc_check`; both cases replace only the deployment-owned Java LSP executable with the current Node binary so the test does not require `jdtls` on PATH. The with-key case runs the same fixture with the real DeepSeek route when `DEEPSEEK_API_KEY` is present.

```sh
pnpm exec vitest run examples/headless-agent/tests/mcmod.e2e.ts --config vitest.e2e.config.ts
```

The Fabric fixture is created in the test's temporary cwd. Its `gradlew` and `gradlew.bat` are tiny local wrappers around `gradle-fixture-check.mjs`, so the e2e does not download Gradle or Minecraft dependencies; the wrapper is an offline build gate that checks the item registration, lang entry, model, and placeholder texture produced by the agent. A project that needs a real Gradle build should run its own cached or credentialed build outside this keyless fixture.

## E2B POC overlay

[`e2b.cordis.yml`](e2b.cordis.yml) replaces the local filesystem and subprocess providers with one shared E2B sandbox while retaining `dsh-bash-local` and the same model-facing tools. Put `E2B_API_KEY` beside `DEEPSEEK_API_KEY` in the gitignored root `.env`, then run the credential-gated live composition, which drives FS, Bash, PTY, and LSP in one sandbox and proves final deletion:

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/e2b/e2b/tests/composition.e2e.ts
```

The overlay creates the same absolute cwd inside the sandbox, but it does not upload or mount the host workspace. File and Bash mutations exist only in E2B; Cordis, model calls, agent/session state, session logs, skills, and SDK buffers remain on the host. The composition kills its sandbox on timeout and disposal. It is a provider-composition POC, not a whole-harness migration or a workspace-sync feature.

## Advanced configuration

[`advanced.cordis.yml`](advanced.cordis.yml) adds Code Mode and the Cordis tools to the test composition.
