# Agent Note: 宿主拥有 Minecraft 项目初始化

Status: implemented

[English](2026-09-14-minecraft-host-bootstrap.md) | 中文

## Problem

创建空白 Minecraft 项目需要由宿主决定版本、loader、Java、依赖、镜像、staging 和首次构建。面向模型的搭建工具与项目创建技能会让 agent 在宿主完成这些检查前写入状态，并让未验证构建的新会话看起来已经就绪。

## Decision

本地“新模组”向导是新 Minecraft 项目的唯一初始化路径。宿主解析受支持的 Fabric 或 NeoForge 目录项，校验所需 Java 运行时，在受保护的 staging 目录生成项目、创建 Gradle Wrapper、应用项目范围的镜像策略，并在登记工作区和启动空白会话前完成首次构建。mcmod 桌面、CLI 与 headless 组合只向模型提供项目检测、资源校验和聚焦检查，不提供 `bootstrap_mc_project` 或 `minecraft-project-create`。Minecraft 提示词会在空目录时引导模型使用向导；宿主构建成功后，模型可以检查和修改已有项目。

## 宿主契约

- `catalog` 在 45 秒总预算与 20 秒请求时限内独立解析加载器家族。成功结果合并到缓存，不丢弃另一家族；部分合并保留较早的缓存时间。`catalog-cache` 支持刷新期间立即选择版本。
- Fabric 的游戏和 Yarn 数据按 BMCLAPI、Fabric Meta 顺序请求，API 元数据按阿里云 Maven、Fabric 仓库顺序请求。NeoForge 先使用官方 Maven 元数据或目录索引，Maven 不可用时再使用官方 [NeoForgeMDKs 组织](https://github.com/NeoForgeMDKs)；每个候选都必须与官方 MDK 的 `neo_version`、`net.neoforged.gradle.userdev` 插件、受支持的 Gradle wrapper 配方和 metadata 一致后才能进入目录。解析器不会虚构 NeoForge `1.20.1` 支持，也不会用 ModDevGradle 替代。
- 目录项携带 Gradle 分发包和 wrapper JAR 的官方 SHA-256。生成的 wrapper 写入 `distributionSha256Sum`，宿主在使用和写入应用缓存前都会校验 wrapper 字节。
- 生成项目保留仓库声明；共享工作台网络服务提供操作级下载路径和仅用于子进程的 Java 代理属性。明确网络故障在原始时限内重试，不刷新依赖缓存；编译错误与取消不重试。
- `start` 通过 loopback `/mc-bootstrap` 只接受目录项 ID 和用户字段。宿主拒绝不安全路径、符号链接、非空目标和被修改的 staging 文件，并串行执行操作。取消会终止进程树，等待进程结束并排空待写日志后才发布 `cancelled`；staging 标记和完整 `.dsh/bootstrap.log` 会保留，线路日志尾部保持有界。

## 验证

复用 staging 时同时比较记录的内容哈希与当前模板。经校验的旧模板保持完整，创建操作使用新的目录，因此模板修正不会覆盖用户编辑，也不会阻断未经修改的失败项目再次创建。网络重试分类要求传输故障证据，包括 TLS 对端断连；单独的插件未找到提示不足以触发重试或改变版本。失败摘要保留这一区分。

NeoGradle 在普通构建期间会向 `runs/junit/` 写入两个 JUnit 参数文件。NeoForge 的暂存校验在续跑和提交时接受这两个确切输出，不放行整个运行目录。测试保留对其他文件和符号链接的拒绝，避免识别构建输出时掩盖用户编辑。

契约由[目录测试](../../../../packages/minecraft/tool-mc-bootstrap/tests/catalog.spec.ts)、[服务测试](../../../../packages/minecraft/tool-mc-bootstrap/tests/service.spec.ts)和[组装向导 E2E](../../../../apps/desktop/renderer/tests/mcmod-bootstrap.e2e.ts)覆盖；后者固定构建成功前不存在会话或模型请求的顺序。环境门控的[真实构建套件](../../../../packages/minecraft/tool-mc-bootstrap/tests/real-build.e2e.ts)从在线目录选择 Fabric `1.20.1`、最高稳定 Fabric `1.21.x`、最早可解析 NeoForge `1.20.x`和最高稳定 NeoForge `1.21.x`。

## Alternatives considered

**仅通过提示词隐藏搭建工具。** 否决，因为面向模型的写文件和进程能力仍可能绕过向导的目录、staging、镜像和构建不变量。

**让模型先生成模板，再由宿主构建。** 否决，因为版本敏感的项目状态仍由模型拥有，且可能创建未验证的工作区会话。

**完全移除新项目创建。** 否决，因为产品需要为尚无模组工作区的用户提供可用的本地入口。

## Consequences

未构建的空目录不能开启新会话，headless 模型运行也不能初始化空目录。宿主搭建服务拥有网络、文件系统、进程、取消和重试安全；模型工作流聚焦于编辑和校验已经建立环境的项目。已有项目及其用户修改仍可通过常规 Minecraft 工具编辑。

现有项目工具保持文件系统访问限制在 workspace 内、检测有界且先取事实，并将静态检查与运行时构建明确区分。只有在经过认证的宿主 API 强制执行同样的目录、JDK、staging、进程和首次构建门禁，并由组装测试证明构建成功前不存在会话或模型请求时，才可重新考虑面向模型的初始化器。

## Related

当前 Minecraft 项目事实与校验边界见 [Minecraft 项目工具](../../../../packages/minecraft/tool-mc-project/README.zh.md)；本记录负责宿主专用初始化边界。

[工作台决策](2026-09-16-minecraft-workbench.zh.md)管理共用的环境准备和保留运行状态。搭建宿主在创建服务前同时注入 Connection 和 subprocess：通过 `ctx.get()` 找到服务，不代表辅助代码可以经该插件上下文的属性访问它。Loader 挂载的回归测试执行 Java 准备，再在文件生成阶段取消。
