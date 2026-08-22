# dsh-tool-mc-project

[English](README.md) | 中文

模型可见的 Minecraft 项目工具。该包注册 `detect_mc_project` 返回结构化项目事实，注册 `validate_mc_resources` 报告 Gradle 编译不一定能抓到的确定性 Minecraft asset/data 资源问题，并在 shell executor 已挂载时注册 `run_mc_check` 来选择并运行聚焦 Gradle 检查。

`detect_mc_project` 与 `validate_mc_resources` 通过 `ctx.fs` 读取当前 session workspace。它们提取证据，不求值 Gradle，不执行 shell 命令，不下载依赖，也不模拟 Minecraft 资源加载。`run_mc_check` 先复用检测结果，再通过 `ctx.shell` 执行选中的 Gradle 命令，因此已挂载的 shell、subprocess、sandbox、timeout 与输出保留策略仍是权威执行路径。

## Tool

| Tool | 用途 |
|---|---|
| `detect_mc_project` | 检测 loader、Minecraft 版本、mappings、mod id 候选、Java/Kotlin 使用、source set、resource root、mixin config、datagen 线索、已检查文件、warning 与推荐 Gradle 验证命令。 |
| `validate_mc_resources` | 校验 lang、model、blockstate、recipe 与 tag JSON 文件；检查本地 model texture 和 blockstate model 引用；报告可疑 namespace 以及 asset namespace 与 metadata mod id 不一致。 |
| `run_mc_check` | 根据检测到的项目事实选择 Gradle wrapper 或 `gradle` 命令，并运行 `build`、`test`、`datagen`、`resources` 或 `all`，返回结构化步骤结果。 |

## Config

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `maxEntries` | `2000` | 发现 source/resource 与 metadata 线索时最多遍历的目录项数量。 |
| `maxFileBytes` | `524288` | 单个候选文本文件最多读取的字节数。更大的文件会跳过并写入 warning。 |
| `maxOutputSummaryBytes` | `4096` | shell 已完成截断或 spill 后，`run_mc_check` 每个 stdout/stderr tail 最多内联保留的 UTF-8 字节数。 |

所有字段都必须是正整数。只读工具不执行 Gradle task 或 shell 命令。

## Model Experience

### Minecraft Project Detection

#### What the model sees

模型会看到 [`detect_mc_project`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-mc-project) 工具 schema。该工具没有参数；其规范结果包含 workspace、loader、Minecraft 版本、mappings、mod id 候选、语言标志、source/resource root、mixin config、datagen 线索、推荐验证命令、已检查路径和 warnings。Native render 是同一个对象的格式化 JSON。`presentCall` 把 pending card 标为 `Detect Minecraft project`；`presentResult` 在 generic result card 中展示渲染后的 JSON。

#### Token effect

每个挂载此包的 agent composition 请求都会增加一个工具 schema。工具结果包含当前 workspace 扫描得到的紧凑 JSON 事实和 warning 字符串。

#### KV Cache effect

挂载的 composition 生命周期内前缀稳定。结果内容是每次调用的 workspace 状态，不能作为前缀缓存。

### Minecraft Check Runner

#### What the model sees

只有当该包挂载在已提供 `ctx.shell` 的 composition 中时，模型才会看到 [`run_mc_check`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-mc-project) 工具 schema。该工具接受 `target`（`build`、`test`、`datagen`、`resources` 或 `all`）以及可选的单命令 `timeoutMs`。规范结果包含 `commands`、`exitCode`、`steps`、`failedStep` 和 `suggestedNextAction`；每个 step 在适用时携带 command、status、退出信息、stdout/stderr 摘要以及来自 shell 结果的 sandbox facts。`resources` 会先运行静态 `validate_mc_resources`，再运行 Gradle `processResources`；`all` 在第一处失败后停止。

#### Token effect

当 `ctx.shell` 存在时，每个挂载此包的 agent composition 请求都会增加一个工具 schema。结果是一个紧凑 JSON 对象，包含 shell 输出摘要，而不是完整 Gradle 日志。

#### KV Cache effect

在挂载的 composition 生命周期和 `ctx.shell` 存在状态下前缀稳定。结果内容是每次调用的 workspace 与进程状态，不能作为前缀缓存。

### Minecraft Resource Validation

#### What the model sees

模型会看到 [`validate_mc_resources`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-mc-project) 工具 schema。该工具没有参数；其规范结果包含 `errors`、`warnings`、`checkedFiles` 和 `detectedModId`，每个 issue 都携带 `code`、`path`、`message`、`reference` 和 `expectedPath`。Native render 是同一个对象的格式化 JSON。`presentCall` 把 pending card 标为 `Validate Minecraft resources`；`presentResult` 在 generic result card 中展示渲染后的 JSON。

#### Token effect

每个挂载此包的 agent composition 请求都会增加一个工具 schema。工具结果包含当前 workspace 扫描得到的紧凑 JSON issue 数组和 checked-file 路径。

#### KV Cache effect

挂载的 composition 生命周期内前缀稳定。结果内容是每次调用的 workspace 状态，不能作为前缀缓存。

## Known Limitations and Deferred Work

- **不求值 Gradle** — 变量、convention plugin、included build 与生成的 source-set 声明，只有在文本里留下直接线索时才会被识别。
- **证据冲突保持显式** — loader 证据冲突时返回 `loader: "unknown"` 并附 warning，而不是任选一个。
- **不探测 Gradle task 可用性** — `run_mc_check` 不执行 `gradle tasks`；缺失 task 会作为对应 Gradle 命令失败返回。
- **只支持根项目命令** — v1 不推断 subproject task path、included build、Maven build 或自定义 launcher。
- **shell 执行由 composition 负责** — 没有 `ctx.shell` 时不会出现 `run_mc_check`；sandbox denial 与 timeout limit 来自已挂载 executor，工具不会绕过它们。
- **资源校验是静态检查** — `validate_mc_resources` 只检查检测到或约定资源根下的 workspace 文件。缺失的 vanilla、依赖、生成或运行时提供 asset 会被忽略，除非引用目标属于当前 mod namespace。
