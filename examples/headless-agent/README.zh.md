# headless-agent

[English](README.md) | 中文

本目录负责 headless coding agent（智能体）的回放和真实模型测试组装：DeepSeek V4 + 本地 bash 与文件系统工具 + subagent 委托 + 工作流与全新 agent Ralph 迭代 + `todo_write` + JSONL 持久化。本目录显式挂载共享 agent 主干、一个根 agent、持久化和检查点策略；它不是第二个产品入口。

## 运行

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
pnpm dsh --profile headless "fix the failing test in this workspace"
```

产品命令是 [`dsh --profile headless`](../../apps/cli/README.zh.md)：它接受一项非空任务，创建并持久化新会话，打印最终 assistant 文本，然后退出。

快照套件通过 [`tests/fixtures/headless-driver.ts`](tests/fixtures/headless-driver.ts) 运行本目录的配置。这个未导出且仅供测试使用的进程会在结果记录之前，以 JSONL 发出规范会话事件。该事件流属于测试基础设施，不是受支持的 CLI（命令行界面）输出格式。子会话只通过父会话的工具事件和结果对外显示。

## Minecraft mcmod E2E

[`tests/mcmod.e2e.ts`](tests/mcmod.e2e.ts) 通过产品 CLI 证明 Fabric 与 NeoForge wiring 下的 `dsh --profile mcmod`。无密钥用例挂载脚本化 LLM 适配器，但保留真实 profile、Loader 树、文件系统工具、`detect_mc_project`、`validate_mc_resources` 和 `run_mc_check`；每个用例只把部署自有的 Java LSP executable 替换成当前 Node binary，所以测试不要求 PATH 上存在 `jdtls`。有密钥用例在存在 `DEEPSEEK_API_KEY` 时，用真实 DeepSeek route 运行 Fabric fixture。

```sh
pnpm exec vitest run examples/headless-agent/tests/mcmod.e2e.ts --config vitest.e2e.config.ts
```

每个 fixture 都会在测试的临时 cwd 中创建。它们的 `gradlew` 和 `gradlew.bat` 是本地 wiring wrapper，而不是 Gradle 实现，因此该 e2e 不会下载 Gradle 或 Minecraft 依赖；每个 wrapper 会检查 loader metadata、对应 loader 的 Java wiring、lang 条目、model 和真实二进制 PNG，然后分别接受 Fabric 的 `build` 或 NeoForge 的 `runData`。需要真实 Gradle build 的项目，应运行明确受环境控制的 fixture，或在该无密钥测试之外运行自己的缓存构建。

依赖驱动的 Fabric 与 NeoForge fixture 默认不运行；它们会在固定 plugin 与 dependency 版本上生成真实 Gradle wrapper：

```sh
pnpm run test:e2e:mcmod:gradle
```

### 重复运行的真实 agent benchmark

[Benchmark runner](../../scripts/mcmod-agent-benchmark.ts) 使用 [`scripts/fixtures/mcmod-agent-benchmark-prompts.md`](../../scripts/fixtures/mcmod-agent-benchmark-prompts.md) 中随仓库保存的三段提示词，以及一个真实且已经能够构建的 Minecraft 1.21.1 / NeoForge 21.1 / Java 21 MDK 目录。它为每次重复运行复制未改动的 MDK，按顺序让 `dsh --profile mcmod` 对每题至少运行三次，然后在 agent 外部独立执行 `gradlew build` 和静态验收检查。每次运行的 workspace 都会保留，并在全新的输出目录中写入 `report.md` 和 `report.json`。

在 Windows 上，用 VS Code 打开 [`scripts/start-mcmod-agent-benchmark.ps1`](../../scripts/start-mcmod-agent-benchmark.ps1)，选择“运行 PowerShell 文件”。首次运行会询问未改动的 MDK 目录与 agent 版本标签，将其保存到 Git 忽略的 `scripts/mcmod-agent-benchmark.local.json`，然后开始测试；以后运行会复用这些设置，并在完成后打开 `report.md`。使用 `-ResetSettings` 运行启动器可以替换已保存的值。

Codex 控制器或其他宿主自动化可以传入 `-Fixture`、`-AgentLabel`、`-OutputPath` 和 `-NoOpenReport`，在后台启动同一个 launcher 并监控其输出目录。这些控制器输入不会进入被测 agent 的工具集或提示词。

启动前需要在仓库根目录 `.env` 或当前环境中设置 `DEEPSEEK_API_KEY`。MDK 基线必须包含 Gradle wrapper，并且在 benchmark 开始前已经能够成功 build；依赖下载和缓存属于 benchmark 宿主环境，runner 不会修复它们。

```sh
pnpm run benchmark:mcmod-agent -- \
  --fixture /absolute/path/to/pristine-neoforge-mdk \
  --runs 3 \
  --agent-patch /absolute/path/to/model-version.patch.yml \
  --agent-label deepseek-v4-flash-<revision>
```

除非同时传入 `--allow-dirty` 和明确的 `--agent-label`，否则 runner 会拒绝有未提交改动的 harness 源码树；Windows 启动器会在需要时从已保存设置中提供两者。可重复传入的 `--agent-patch` 会固定模型或组合覆盖，并记录到报告。`--prompt-source` 可以替换仓库自带提示词；可选的 `--prices prices.json` 接受每百万 token 的 `input`、`output`、`cache` 和 `reasoning` 价格，不传时仍会记录 token 数量，成本显示为 `N/A`。自动成功要求独立 build 和全部自动验收检查通过。游戏玩法、世界重载、渲染、漏斗行为和 Dedicated Server 加载在 GameTest 或人工运行提供证据之前保持 `unverified`；报告不会把这些项目计为通过。

宿主缺少 Gradle 或依赖解析不可用时，测试会打印缺失前置条件并 skip；不会把 wiring wrapper 的通过当成 Gradle 构建。

## E2B POC overlay

[`e2b.cordis.yml`](e2b.cordis.yml) 使用一个共享 E2B 沙箱替换本地文件系统与子进程提供方，同时保留 `dsh-bash-local` 和相同的面向模型工具。请在 git 忽略的根目录 `.env` 中，将 `E2B_API_KEY` 与 `DEEPSEEK_API_KEY` 放在一起，然后运行凭据门控的实机组合测试；它在同一个沙箱中驱动 FS、Bash、PTY 和 LSP，并证明沙箱最终被删除：

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/e2b/e2b/tests/composition.e2e.ts
```

该 overlay 会在沙箱中创建相同的绝对 cwd，但不会上传或挂载宿主工作区。文件与 Bash 变更只存在于 E2B；Cordis、模型调用、agent／会话状态、会话日志、skill（技能）和 SDK 缓冲仍在宿主上。该组合会在超时和资源释放时终止其沙箱。它是提供方组合 POC，而不是完整 harness 迁移或工作区同步功能。

## 高级配置

[`advanced.cordis.yml`](advanced.cordis.yml) 在测试组装中添加 Code Mode 和 Cordis 工具。
