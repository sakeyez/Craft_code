# dsh-tool-mc-project

[English](README.md) | 中文

模型可见的 Minecraft 项目工具。该包注册 `detect_mc_project` 返回结构化项目事实，注册 `validate_mc_resources` 报告 Gradle 编译不一定能抓到的确定性 Minecraft asset/data 资源问题，并在 shell executor 已挂载时注册 `run_mc_check` 来选择并运行聚焦 Gradle 检查。

`detect_mc_project` 与 `validate_mc_resources` 通过 `ctx.fs` 读取当前 session workspace。它们提取证据，不求值 Gradle，不执行 shell 命令，不下载依赖，也不模拟 Minecraft 资源加载。`run_mc_check` 先复用检测结果，再通过 `ctx.shell` 执行选中的 Gradle 命令，因此已挂载的 shell、subprocess、sandbox、timeout 与输出保留策略仍是权威执行路径。

## Tool

| Tool | 用途 |
|---|---|
| `detect_mc_project` | 检测 loader 证据、Minecraft 版本候选、mappings 候选、mod id 候选、Java/Kotlin 使用、source set、resource root、mixin config、datagen 线索、已声明的 Gradle task 候选、已检查文件、warning 与推荐 Gradle 验证命令。`loaderSupport` 明确表示当前 profile 是否支持该 loader；Forge、Quilt 和 Architectury 等 loader 可被识别，但不会被当成 Fabric/NeoForge 目标执行 loader-specific 检查。版本与 mappings 结果保留 `determined`、`unknown` 或 `conflict` 状态及候选证据；精确版本与范围版本明确区分。 |
| `validate_mc_resources` | 校验语言值、model、blockstate、recipe、tag、loot table、advancement、predicate、item modifier 与 item-definition JSON 文件；检查有界 PNG 签名/分块/CRC、本地 model parent、本地 model texture 与 blockstate model 引用、可疑 namespace，以及 asset namespace 与 metadata mod id 不一致。 |
| `run_mc_check` | 根据检测到的项目事实选择 Gradle wrapper 或 `gradle` 命令，并运行 `build`、`test`、`datagen`、`resources`、`runtime` 或 `all`。需要时从声明或有界的 `tasks --all` 输出发现 datagen/runtime task；runtime 必须提供明确且已获批准的 `runtimeMode`。 |

## Config

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `maxEntries` | `2000` | 发现 source/resource 与 metadata 线索时最多遍历的目录项数量。 |
| `maxFileBytes` | `524288` | 单个候选文本文件最多读取的字节数。更大的文件会跳过并写入 warning。 |
| `maxOutputSummaryBytes` | `4096` | shell 已完成截断或 spill 后，`run_mc_check` 每个 stdout/stderr tail 最多内联保留的 UTF-8 字节数。 |
| `maxTaskDiscoveryBytes` | `65536` | 发现 Gradle task 时最多捕获的 stdout 字节数。输出被截断时视为无法确定，不会选择 task。 |

所有字段都必须是正整数。只读工具不执行 Gradle task 或 shell 命令。

## Library API

`./gradle-tasks` 导出为已经持有 Gradle 执行权的可信调用方提供纯 `parseGradleTaskNames()` 与 `runtimeTaskCandidates()` 辅助方法。解析要求完整且未截断的纯文本 task 输出；运行任务选择只返回约定且未限定的客户端候选（`runClient`、`runGame`）或服务器候选（`runServer`、`runDedicatedServer`），歧义由调用方处理。

## Model Experience

### Minecraft Project Detection

#### What the model sees

模型会看到 [`detect_mc_project`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-mc-project) 工具 schema。该工具没有参数；其规范结果包含 workspace、loader、`loaderSupport` 与 loader evidence、Minecraft 版本候选、mappings 候选、mod id 候选、语言标志、source/resource root、mixin config、datagen 线索、推荐验证命令、已检查路径和 warnings。`loaderSupport` 为 `supported`、`unsupported` 或 `unknown`；当前 profile 只支持 Fabric 与 NeoForge，Forge、Quilt 和 Architectury 仅用于诊断。`minecraftVersion` 与 `mappings` 明确返回 `determined`、`unknown` 或 `conflict`；已确定版本还返回 `classification: exact` 或 `range`，每个候选都保留 source 与 evidence。Native render 是同一个对象的格式化 JSON。`presentCall` 把 pending card 标为 `Detect Minecraft project`；`presentResult` 在 generic result card 中展示渲染后的 JSON。

#### Token effect

每个挂载此包的 agent composition 请求都会增加一个工具 schema。工具结果包含当前 workspace 扫描得到的紧凑 JSON 事实和 warning 字符串。

#### KV Cache effect

挂载的 composition 生命周期内前缀稳定。结果内容是每次调用的 workspace 状态，不能作为前缀缓存。

### Minecraft Check Runner

#### What the model sees

只有当该包挂载在已提供 `ctx.shell` 的 composition 中时，模型才会看到 [`run_mc_check`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-mc-project) 工具 schema。该工具接受 `target`（`build`、`test`、`datagen`、`resources`、`runtime` 或 `all`），`runtime` 需要 `runtimeMode`（`client` 或 `server`），以及可选的单命令 `timeoutMs`。规范结果包含 `commands`、`exitCode`、`steps`、`failedStep` 和 `suggestedNextAction`；每个 step 在适用时携带 command、status、退出信息、stdout/stderr 摘要以及来自 shell 结果的 sandbox facts。datagen 与 runtime 会优先使用已声明候选，必要时执行有界的 `tasks --all --console=plain` 探测。`resources` 会先运行静态 `validate_mc_resources`，`runtime` 可启动客户端或专用服务器且必须遵循用户批准；`all` 在第一处失败后停止。

#### Token effect

当 `ctx.shell` 存在时，每个挂载此包的 agent composition 请求都会增加一个工具 schema。结果是一个紧凑 JSON 对象，包含 shell 输出摘要，而不是完整 Gradle 日志。

#### KV Cache effect

在挂载的 composition 生命周期和 `ctx.shell` 存在状态下前缀稳定。结果内容是每次调用的 workspace 与进程状态，不能作为前缀缓存。

### Minecraft Resource Validation

#### What the model sees

模型会看到 [`validate_mc_resources`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-mc-project) 工具 schema。该工具没有参数；其规范结果包含 `errors`、`warnings`、`checkedFiles` 和 `detectedModId`，每个 issue 都携带 `code`、`path`、`message`、`reference` 和 `expectedPath`。静态检查会拒绝格式错误或截断的 PNG 与缺失的本地 model parent；已有的 item-definition JSON 文件会被解析，并在检测到确定版本时检查其 Minecraft 版本兼容性。vanilla 与依赖 namespace 不纳入本地文件缺失检查。Native render 是同一个对象的格式化 JSON。`presentCall` 把 pending card 标为 `Validate Minecraft resources`；`presentResult` 在 generic result card 中展示渲染后的 JSON。

#### Token effect

每个挂载此包的 agent composition 请求都会增加一个工具 schema。工具结果包含当前 workspace 扫描得到的紧凑 JSON issue 数组和 checked-file 路径。

#### KV Cache effect

挂载的 composition 生命周期内前缀稳定。结果内容是每次调用的 workspace 状态，不能作为前缀缓存。

## Known Limitations and Deferred Work

- **不求值 Gradle** — 变量、convention plugin、included build 与生成的 source-set 声明，只有在文本里留下直接线索时才会被识别。
- **证据冲突与 unsupported 保持显式** — loader 证据冲突时返回 `loader: "unknown"` 并附 warning，而不是任选一个；Forge、Quilt 和 Architectury 等可检测但不支持的 loader 返回 `loaderSupport: "unsupported"`；版本或 mappings 候选冲突时返回 `conflict` 并保留全部候选证据。
- **Gradle 求值仍受限** — 只有在 inspected 文本没有 datagen/runtime task 时，`run_mc_check` 才探测 `tasks --all --console=plain`；变量、convention plugin、included build 与生成的 source-set 仍需要项目级检查。
- **只支持根项目命令** — `run_mc_check` 会拒绝声明 subproject 或 included build 的 settings，因为它无法推断限定 task path。不支持 Maven build 与自定义 launcher。
- **shell 执行由 composition 负责** — 没有 `ctx.shell` 时不会出现 `run_mc_check`；sandbox denial 与 timeout limit 来自已挂载 executor，工具不会绕过它们。
- **资源校验是静态检查** — `validate_mc_resources` 只检查检测到或约定资源根下的 workspace 文件，包括 JSON 根和值类型、有界 PNG 结构与 CRC、本地 model parent 与 `assets/<namespace>/items` 定义。缺失的 vanilla、依赖、生成或运行时提供 asset 会被忽略，除非引用目标属于当前 mod namespace。版本未知、只有范围或存在冲突时只产生 warning，不臆断 item-definition 格式。
