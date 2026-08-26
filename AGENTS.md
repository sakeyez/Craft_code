# AGENTS.md

This repository is a customized Minecraft Java mod-development assistant built on DeepSeek Harness and Cordis. The product-facing behavior lives in the `mcmod` preset, the Minecraft prompt package, the bundled skills, and the Minecraft project tools. This file governs changes to the assistant and its harness; it is not a replacement for the model prompt. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`, and follow [docs/AGENTS.md](docs/AGENTS.md) for documentation.

## Pre-release stance: foundation over blast radius

This customized assistant is still pre-release. Prefer the correct Minecraft-specific design over compatibility shims, and update every in-repository reference when a package, profile, event, or persisted format changes. Do not preserve an upstream Harness behavior merely because it is historical.

## Product scope

- The supported project targets are Fabric Java and NeoForge Java. Forge, Quilt, Architectury, mixed-loader, multi-module, convention-plugin-heavy, and non-mod projects may be diagnosed, but the assistant must not invent loader-specific edits for them.
- A genuinely blank project with no loader decision may use Fabric + Java + Minecraft 1.21.x as a provisional default. Existing project evidence always wins; `unknown`, `conflict`, and `unsupported` are distinct states.
- Minecraft version, loader, mappings, Java version, Gradle plugin, source sets, resource roots, and declared tasks are facts to discover from the project. Never infer a version-sensitive API from memory or from another loader.
- `detect_mc_project` extracts evidence, `validate_mc_resources` performs bounded static checks, and `run_mc_check` executes focused Gradle checks through the mounted shell. None of them emulates Minecraft runtime loading. Runtime checks require an explicit user-approved client or server launch.

## Where behavior lives

| Area | Owner |
|---|---|
| Model guidance and loader/version policy | `packages/minecraft/mcmod-agent/` |
| Project detection, resource validation, and Gradle checks | `packages/minecraft/tool-mc-project/` |
| Web and headless compositions | `packages/bundle/mcmod*/` and `apps/cli/config/agent-presets/mcmod/` |
| Minecraft skills | `apps/cli/config/agent-presets/mcmod/skills/` and the synchronized headless bundle skills |
| Assembled product evidence | `examples/headless-agent/tests/mcmod*.e2e.ts` and `headless.snapshot.ts` |
| Repeated real-agent measurement | `scripts/mcmod-agent-benchmark.ts` and its fixture prompts |

When changing model-visible behavior, update the owning prompt, skill, tool schema, README, and assembled test surface together. Do not put product behavior in this root file.

## Minecraft change workflow

1. Identify the current workspace and run `detect_mc_project` before selecting a loader API, mapping name, resource namespace, or datagen task.
2. Read the pinned Gradle files (`settings.gradle[.kts]`, `build.gradle[.kts]`, `gradle.properties`, version catalogs, included-build declarations), loader metadata, entrypoint, registries, event wiring, side configuration, mixin configuration, source sets, and existing tests.
3. Load the applicable skill before editing: `fabric-mod-dev`, `fabric-datagen`, `neoforge-mod-dev`, `neoforge-datagen`, `minecraft-resources`, or `mixin-debugging`. Follow the project's existing naming, registration, generated-output, and package conventions.
4. Keep Java registrations, mod metadata, identifiers, namespaces, language keys, models, blockstates, recipes, loot, tags, textures, and generated resources consistent. Change the generator or provider when generated output is involved; do not make a generated file the only source of truth.
5. Run `validate_mc_resources`, then the narrowest loader-appropriate Gradle check through `run_mc_check`: `resources`, `test`, `datagen`, `build`, `runtime`, or `all`. Treat a static pass or wiring fixture as weaker evidence than a real Gradle build, and label runtime-only behavior as unverified without a client/server run.
6. Inspect the complete diff and the relevant game or Gradle logs. Report unsupported loaders, missing JDTLS, unavailable Gradle/dependency caches, skipped tests, and unverified gameplay instead of claiming success.

## Repository layout

```
packages/minecraft/       Minecraft prompt and project-tool packages
packages/bundle/          installable profile patch layers, including mcmod
apps/cli/                 source CLI and agent preset composition
examples/headless-agent/  runnable profile snapshots and keyless/real E2E
scripts/                  generators, repository checks, and mcmod benchmark
docs/                     architecture, package references, and user docs
.agents/notes/             active decision records; archived notes are frozen
vendor/                   pinned Cordis source; update only through vendor/README.md
```

Nested `AGENTS.md` files add rules for `packages/`, `examples/`, docs, notes, scripts, and vendored code. Apply the most specific file in addition to this one.

## Conventions

- Everything is an ESM plugin. Contributions use `ctx.effect()` or `ctx.on()`, and registry `register()` methods return disposers. Keep service definition, provider, and consumer responsibilities separate.
- Use strict TypeScript with explicit types and package imports. Trust typed same-process values; validate parser/config, model/tool JSON, filesystem, process, worker, and wire inputs at their actual boundary. Use branded ids for opaque cross-boundary values.
- Keep source-plane tests and static gates on `src`; built-artifact checks must state their `lib` dependency. Switch on discriminants and use `assertNever` for closed unions. Waterfall listeners must call `next()` unless deliberately short-circuiting.
- Model-visible input must be reconstructable from the session log. Changes to agent-loop, session lifecycle, or session events require the corresponding TypeScript and Python SDK projections and assembled snapshot coverage.
- Public exports and non-obvious contracts need concise JSDoc. Update package README contracts, generated catalogs through their generators, and bilingual counterparts in the same change. One fact has one documentation home; use links instead of copied inventories.
- Non-trivial behavior, architecture, process, configuration, or testing changes require an active Agent Note in the same change. Keep implemented notes in present tense and never edit `.agents/notes/archived/`.
- Preserve unrelated user changes in a dirty worktree. Do not use destructive reset/checkout commands. Keep credentials in the ignored `.env`; never commit API keys or machine-specific paths.

## Run relevant checks locally

Use focused checks that match the change rather than reflexively running the entire suite:

## Commands

```sh
pnpm install
pnpm run test -- packages/minecraft/mcmod-agent packages/minecraft/tool-mc-project
pnpm exec vitest run examples/headless-agent/tests/mcmod.e2e.ts --config vitest.e2e.config.ts
pnpm run test:e2e:mcmod:gradle       # opt-in; requires Gradle/dependencies
pnpm run test:snapshot                # update only with an explicit snapshot change
pnpm run typecheck
pnpm run lint
pnpm run doc-sync
pnpm run verify-mcmod-skills
```

The keyless Minecraft E2E uses deterministic wiring wrappers and does not claim compilation or gameplay. The real Gradle fixture is environment-gated. A real model test requires `DEEPSEEK_API_KEY`; use the repository `.env` or the ambient environment and do not add secrets to fixtures or snapshots. Windows-specific benchmark execution uses `scripts/start-mcmod-agent-benchmark.ps1`.

## Documentation and vendoring

Keep root instructions short and operational. Put architecture in `docs/architecture.md`, package contracts in package READMEs, procedures in `docs/cookbook/`, product guidance in `docs/user/`, rationale in Agent Notes, and generated reference data in the owning generator. Run `git diff --check`; files end with exactly one trailing newline. Never hand-edit vendored source or generated catalog regions.
