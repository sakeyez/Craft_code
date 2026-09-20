# dsh-tool-mc-bootstrap

[English](README.md) | 中文

本包是 Minecraft“新模组”向导使用的宿主确定性服务；它不注册模型可见的 Tool 或 prompt，并把文件系统、网络和进程权限留在宿主，不交给浏览器或模型代码。

## RPC 契约

宿主在 `connection` 和 `subprocess` 均完成注入后挂载服务，确保共用的 Java 准备逻辑能查找并检查 JDK。服务在 `/mc-bootstrap` 注册一个 `loopback` Connection 通道；LAN 客户端无法访问该通道，通道接受以下端点。

| 端点 | 请求 | 结果 |
|---|---|---|
| `catalog-cache` | `{}` | 缓存的 `CatalogSnapshot` 或 `null`，不发起网络请求 |
| `catalog` | `{}` | 带条目、缓存来源和检测到的 Java 的 `CatalogSnapshot` |
| `start` | `entryId`、`parentDirectory`、`directoryName`、`modName`、`modId` 和 `packageName` | 在目录刷新和构建工作开始前立即返回 `operationId` |
| `status` | `operationId` | 可重连的完整 `OperationSnapshot` |
| `cancel` | `operationId` | 是否接受取消以及最新快照 |

浏览器只提交目录条目 ID 和用户字段；依赖版本、仓库 URL、命令和生成路径都由宿主选择并校验。

每个操作快照还会以 `minecraft-bootstrap/progress` 事件发送；事件投递是尽力而为，客户端重连后必须调用 `status` 补齐状态。快照状态为 `queued`、`running`、`ready`、`failed` 或 `cancelled`，`logTail` 上限为 32 KiB。

首次构建将 Gradle User Home 与验证过的 JDK 写入[项目环境](../mc-workbench/README.zh.md#environment-and-runs)，后续准备、构建和运行复用同一缓存。失败状态在日志收尾后发布，立即重试不会与收尾竞争。

## 目录

- 目录提供 Minecraft `1.20.1` 至稳定 `1.21.x` 的 Fabric Java 与 NeoForge Java 组合，并排除 `26.x` 家族；没有官方发布物时，绝不会为 NeoForge 推断 `1.20.1` 支持。
- 所需 Java 按游戏线固定：`1.20.1`–`1.20.4` 使用 JDK 17，`1.20.5`–`1.21.x` 使用 JDK 21；宿主在写入任何 staging 文件前检查精确运行时。
- Fabric 游戏与 Yarn 数据先请求 BMCLAPI，再请求 Fabric Meta；Fabric API 元数据先请求阿里云 Maven，再请求 Fabric 仓库；镜像响应为空、格式错误或请求失败时回退到权威源。
- NeoForge 先读取官方 Maven 元数据或目录索引，Maven 不可用时再读取官方 [NeoForgeMDKs 组织](https://github.com/NeoForgeMDKs)。每个候选都必须读取官方 MDK 的 `build.gradle`、wrapper 属性、`gradle.properties` 和 metadata，确认固定的 `net.neoforged.gradle.userdev` 与受支持的 Gradle 配方，使 `neo_version` 与游戏线匹配，并在有 Maven 数据时确认 loader 发布物；ModDevGradle 和不完整配方会被排除。
- 在线刷新总预算为 45 秒，每次请求最多 20 秒。成功的加载器结果只替换自己的缓存条目，失败家族保留旧条目；部分合并沿用较早的缓存时间。超过 24 小时标记为过期。`catalog-cache` 在后台刷新期间立即提供可用条目。
- 每个 `CatalogEntry` 都携带解析后的 loader、映射、API、插件、Gradle 版本、所需 JDK，以及 Gradle 分发包和 wrapper JAR 的官方 SHA-256；格式错误或不完整的缓存条目会被忽略。

## 构建与恢复

- 服务校验绝对且不经过符号链接的父路径与安全标识符，拒绝已有或非空目标，并在目标旁创建带操作标记的 staging 目录，其中包含 `.dsh/bootstrap-state.json`；只有首次构建成功后才会把 staging 原子改名为最终目录。
- 生成的 Gradle settings 和项目按腾讯 Gradle 镜像、阿里云 Maven 镜像、loader 官方仓库与 Maven Central 的顺序解析；Fabric 还包含 BMCLAPI Maven 镜像。Wrapper 从腾讯分发 URL 开始并写入官方 `distributionSha256Sum`，下载的 wrapper JAR 在使用或写入缓存前必须匹配目录项的 `wrapperSha256`。
- 下载和 Java/Gradle 传输策略由[工作台网络服务](../mc-workbench/README.zh.md)统一拥有。首次构建的网络重试共享 30 分钟总时限，并保留已验证缓存。TLS 对端断连可触发有限重试；仅凭插件未找到不会重试。失败操作显示捕获到的具体原因，而非只有退出码。
- 子进程使用参数数组和 `shell: false` 启动。取消会终止整个进程树，等待进程结束并排空待写日志；清理完成前操作保持忙碌，带标记的 staging 树、状态标记和完整 `.dsh/bootstrap.log` 会保留供检查。
- 只有所有生成文件仍匹配记录的 SHA-256 集合与当前模板时才会续跑。未经修改的旧模板会保留，并在新的 staging 树中重新生成；任何用户修改、符号链接、路径越界或并发操作都会 fail closed，绝不覆盖玩家文件。RPC 日志尾部上限为 32 KiB，磁盘日志保持完整。
- NeoForge staging 接受 NeoGradle 构建生成的 `runs/junit/junit_jvm_args.txt` 和 `junit_test_args.txt`。`runs/` 下其他文件仍被拒绝，允许的路径也不能是符号链接。

## 模型体验

无，因为本宿主服务只提供 loopback RPC，不注册模型可见的 Tool 或 prompt。

#### KV Cache 影响

无；服务在创建模型会话前运行，也不组装 provider 请求。

## 已知限制与暂缓事项

- **宿主前置条件保持显式** —— 应用宿主复用兼容 JDK，或通过[工作台环境服务](../mc-workbench/README.zh.md#environment-and-runs)准备经过校验的 Adoptium JDK；Java 设置仅对子进程生效，不修改全局 Gradle 设置。
- **初始化范围刻意收窄** —— 只生成 Fabric Java 与 NeoForge Java；Forge、Quilt、Architectury、多 loader、Kotlin、datagen 以及运行时/游戏玩法模拟都不在本服务范围内。
- **目录与构建证据在线路上有界** —— 没有在线结果或缓存时会禁用创建；过期或部分目录会连同来源和错误一起暴露，由向导解释。
