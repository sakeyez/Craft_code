# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

DeepSeek Harness 的 Electron 应用壳。renderer 从 `apps/desktop/renderer` 构建，并由 `dsh desktop` 启动的私有 loopback 运行时提供；桌面进程负责窗口、应用菜单命令、项目/Git/Gradle 命令和后端进程生命周期。

## 开发

全新检出后先安装依赖并构建一次仓库产物，再启动桌面壳：

```sh
pnpm install
pnpm run build
pnpm desktop:dev
```

`desktop:dev` 会先刷新客户端库和 renderer dist，再编译 Electron 主进程，在 loopback 上启动私有 `desktop` profile 并由操作系统分配端口，等待 Loader 完全结算后的 `dsh desktop:` URL，再用 `BrowserWindow` 加载该地址。

四个顶层菜单分别是项目、编辑、Git、帮助。Windows 和 Linux 使用无边框窗口，并在共享 CraftCode 主题的 40px Web 顶栏中显示菜单：左侧保留紧凑菜单入口，右侧放置最小化、最大化/还原和关闭按钮。顶栏同时是可拖拽的标题栏区域，菜单按钮和窗口控制按钮不会触发拖拽。选择菜单后，Electron 会在 Web 入口下方打开对应的原生子菜单；macOS 保留系统应用菜单和原生窗口边框。完整应用菜单仍会安装，以提供原生角色和快捷键。项目设置保存在 `.dsh/project.yaml`，Git 和 Gradle 输出显示在桌面结果面板。

项目菜单可以启动或停止当前模组项目的开发客户端。主进程探测完整且有界的 `tasks --all --console=plain` 输出，只通过项目 wrapper 或全局 Gradle 启动唯一且未限定的 `runClient` 或 `runGame` 任务。每个规范化项目路径最多持有一个客户端进程。客户端自行退出时结果面板会收到提示，失败时保留有界输出；停止游戏或关闭 CraftCode 会终止完整的 Gradle/Java 进程树，并在有界期限后强制停止。

在 Windows 10/11 上，Gradle 启动生命周期会把根进程 id 交给仅在主进程中运行的捕获提供方。该提供方持续追踪以创建时间为围栏的后代进程并定位 Minecraft GLFW 窗口，但不会重新挂接窗口或修改其样式。连续两次观测稳定后，提供方会在显示器工作区内将 Minecraft 放在左侧、CraftCode BrowserWindow 放在右侧，并在 Minecraft 移动或缩放后继续跟随，同时保留用户手动调整的面板宽度。Minecraft 最小化或隐藏时面板隐藏；右侧空间不足时暂停跟随，点击重新定位后恢复。Linux 与 macOS 会提示 Minecraft 在独立窗口运行并保持普通 CraftCode 布局。

标注开始时，主进程使用持有的 Minecraft HWND 选择可见的桌面捕获源，并通过 `desktopCapturer` 获取不超过 1920×1080 的 JPEG；随后在 Minecraft 客户区原位置创建无边框置顶窗口，用静帧覆盖整个游戏画面。覆盖层只冻结视觉，不挂起 Minecraft 进程；完成、取消或窗口变化后会销毁覆盖层并恢复游戏焦点和并排布局。捕获过程不会修改 Minecraft 的 parent、样式或边界，空源会返回可重试错误。标注成功后，静帧会作为当前会话授权的图片附件保存，后续提问会同时收到归一化坐标文本和实际图片；会话事件只保存附件引用和标注数据。

陪伴模式在游戏最小化／恢复期间关闭 renderer 后台节流，并在跟踪结束时恢复原设置。因此，隐藏的陪伴面板仍会调度帧，并产生相应的后台资源开销。renderer 无响应／恢复响应事件、renderer 退出及 Chromium 子进程退出均记录到 Electron 日志目录中的 `desktop.log`。

关闭所有 Electron 窗口会通过子进程 IPC 通道请求 CLI 执行现有的有界 Cordis dispose。监督器等待后端退出，只有超过优雅关闭期限后才升级为进程终止。桌面打包使用已提交的多尺寸 `src/CraftCode.ico` 源资源，该资源由 Web 端统一 favicon 生成，并在桌面构建时复制到 `lib`。

## 安全

renderer 开启 `contextIsolation`、Chromium 沙箱和 web security，关闭 Node integration。preload 只暴露固定的菜单、当前项目、游戏事件、项目命令、renderer 安全的游戏状态、陪伴面板重连／定位和标注捕获方法，不暴露 Node API、进程 id、HWND、Win32 操作、窗口几何或任意 IPC。同源 loopback 导航保留在 Electron 中；外部 HTTP(S) 链接交给系统浏览器，其他协议和 webview 均被拒绝。

项目 Git 命令、Gradle 任务发现、构建和游戏启动均使用共享的[子进程环境清理器](../../packages/subprocess/subprocess/README.zh.md)。启动前移除父进程凭据和 `DSH_*` 上下文，同时保留 `PATH`、`JAVA_HOME` 等普通环境变量。

## 当前限制

此里程碑仅提供开发版。帮助链接目前是 `https://example.com/craftcode/docs` 和 `https://example.com/craftcode/sponsor` 占位地址，发布前必须替换。不包含安装程序、打包后的 Node 运行时、自动更新、代码签名、JDK 或 Gradle 打包，也不包含 `file://` renderer 传输。陪伴跟踪仅支持 Windows 10/11，并假设游戏使用 LWJGL/GLFW 桌面窗口；Linux 和 macOS 保留 Minecraft 独立窗口，独占全屏也可能无法提供可用的工作区贴靠位置。游戏启动要求项目恰好提供一个根 `runClient` 或 `runGame` 任务；有限定的多项目任务和已安装的 Minecraft 启动器不属于此命令。全新检出必须先构建现有 Host、客户端插件和 Web 产物，`dsh desktop` 才能提供完整应用。
