# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

DeepSeek Harness 的 Electron 应用壳。renderer 从 `apps/desktop/renderer` 构建，并由 `dsh desktop` 启动的私有 loopback 运行时提供；桌面进程负责窗口、菜单、项目/Git/Gradle 命令、游戏生命周期和标注捕获。

Minecraft 始终作为独立顶层窗口运行。Windows 主进程提供方会追踪经过创建时间校验的后代进程并定位已验证的 GLFW HWND，但不会重新挂接、移动、调整大小、隐藏、最大化或修改其样式。它只在游戏可见时预热私有截图流；CraftCode 的原有边界、可见性、顶栏、侧栏、详情栏、对话、输入框和后台节流保持不变。Linux 与 macOS 使用相同的普通布局。

Ctrl+Shift+P 和页面中的“在游戏上标注”按钮打开同一个一次性无边框标注覆盖层。覆盖层只提供截图、点／框选标注、说明编辑及提交／取消，不包含聊天输入。提交瞬间解析当前会话，因此标注期间可以切换会话。会话不可用、不可保存、编号冲突、操作编号过期或 HWND 无效时，覆盖层和草稿保持打开以便重试。

preload 桥接只暴露固定的菜单、当前项目、游戏事件、项目命令、renderer 安全游戏状态和标注捕获方法；重新定位和重连 IPC 已移除。原生 HWND、进程和捕获权限只保留在主进程。

受监督宿主可通过 `dsh/network-proxy` 提交有界请求标识与无凭据的 HTTPS 地址。主进程调用 Electron `session.defaultSession.resolveProxy`，并返回 `dsh/network-proxy-result`；此私有子进程通道不暴露 renderer 下载或系统设置修改能力，查询错误会明确返回。Minecraft 网络策略见[工作台宿主](../../packages/minecraft/mc-workbench/README.zh.md)。

## 开发

```sh
pnpm install
pnpm run build
pnpm desktop:dev
```

`desktop:dev` 会构建客户端库和 renderer、编译 Electron 主进程，在 loopback 上启动私有 desktop profile，等待 Loader 完成后的 URL，再用 `BrowserWindow` 加载。

## 当前限制

此里程碑仅提供开发版，不包含安装程序、打包后的 Node 运行时、自动更新、代码签名、JDK 或 Gradle 打包，也不包含 `file://` renderer 传输。游戏启动要求项目恰好提供一个根 `runClient` 或 `runGame` 任务。实际游戏行为和 Minecraft 渲染仍依赖环境，必须显式运行客户端才能验证。

Minecraft 菜单启动使用[工作台宿主](../../packages/minecraft/mc-workbench/README.zh.md)；Electron 依据宿主管理的进程识别原生窗口，并继续负责截图标注。
