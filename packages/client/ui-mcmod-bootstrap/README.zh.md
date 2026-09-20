# @deepseek-ai/dsh-client-ui-mcmod-bootstrap

[English](README.md) | 中文

本包是 Minecraft“新模组”向导的浏览器半边。它把 mcmod 侧栏主操作替换为项目新增图标、10px 圆角按钮以及“新模组”/“新建模组”文案，并为 Electron 与 loopback 浏览器预览贡献同一份全局弹窗。

## 向导行为

- 打开向导时刷新在线/缓存目录，并显示所选条目需要的 JDK 与缓存年龄；在线结果为空且没有缓存时会禁用创建，并提供刷新目录的重试操作。
- 表单默认选择 Fabric 和该 loader 可用的最高稳定条目，要求填写模组名称、父保存目录和项目目录；在用户修改前，会派生安全的小写 `modId` 与 `com.example.<modId>` 包名。
- 折叠的“高级选项”提供 `modId` 和 Java 包名覆盖；浏览器在发送请求前校验名称、Java 保留字、路径段和目录条目 ID。
- “创建并构建”只把目录条目 ID 和用户字段发送到 `/mc-bootstrap`；排队/运行中的快照展示 Java、生成、Wrapper、依赖、构建和提交阶段，禁止重复提交与普通关闭，只保留明确的“取消”操作。
- 空闲向导可以用 Escape 或关闭控件退出，焦点会回到主操作；工作进行时忽略 Escape 和关闭，确保取消是明确且可观察的操作。
- 失败或取消时保留弹窗与宿主提供的日志尾部，显示重试和打开目录操作，并保留带标记的 staging 树供检查；加入工作区失败时只重试登记，不重复构建。

## 交给宿主

动态 Web 插件轮询 `status`，并只接受当前操作的 `minecraft-bootstrap/progress` 快照，因此重连或其他宿主事件不会创建会话。收到 `ready` 快照后，它调用 `workspaces.create({ path })`，再调用 `workspaces.startSession(workspaceId)`；在宿主报告首次构建成功前，不会创建工作区会话或模型请求。宿主契约与信任边界见 [`dsh-tool-mc-bootstrap`](../../minecraft/tool-mc-bootstrap/README.zh.md)。

本包的 node 入口是空的 Loader 伴侣；文件系统、依赖、URL 和 Gradle 进程权限始终属于宿主包。侧栏契约由 [`dsh-client-ui-sidebar`](../ui-sidebar/README.zh.md) 声明，因此未组合本包的部署仍保留通用“新会话”回退和品牌 Logo 快捷方式。

版本直接通过下拉框选择，按 1.21.x、1.20.x 分组，没有搜索输入。切换加载器时保留兼容的游戏版本，否则选择最高受支持稳定版。缓存条目在刷新期间仍可选择，有效选择会跨刷新保留。输入框由外层统一绘制边框与焦点状态；错误保留在向导内，并提供重试和打开目录操作。

## 模型体验

无，因为浏览器向导在宿主构建成功前不会注册模型上下文或会话。

#### KV Cache 影响

无；本包不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **宿主前置条件保持显式** —— 宿主复用兼容 JDK 或准备已校验的 Adoptium 发行版；网络设置与子进程 Java 配置不修改全局 Gradle 设置。
- **构建证据保留在宿主** —— 浏览器最多收到 32 KiB UTF-8 日志尾部，完整 `.dsh/bootstrap.log` 会随 staging 树或原子提交后的项目保留。
- **加载器范围刻意收窄** —— 目录只提供 Fabric Java 与 NeoForge Java；其他 loader、Kotlin、datagen 以及游戏玩法/运行时模拟不在本向导范围内。
