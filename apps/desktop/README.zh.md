# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

现有 DeepSeek Harness Web 应用的 Electron 开发壳。renderer 使用由 `dsh web` 提供服务且未经改写的 `apps/web` 构建产物；桌面进程负责窗口、应用菜单命令、项目/Git/Gradle 命令和后端进程生命周期。

## 开发

全新检出后先安装依赖并构建一次仓库产物，再启动桌面壳：

```sh
pnpm install
pnpm run build
pnpm desktop:dev
```

`desktop:dev` 会先刷新客户端库和 Web dist，再编译 Electron 主进程，启动 `apps/cli/src/bin.ts web --host 127.0.0.1 --port 0 --no-open`，等待 Loader 完全结算后的 `dsh web:` URL，再用 `BrowserWindow` 加载该地址。端口由操作系统分配，因此并行本机服务不需要共用固定桌面端口。

四个顶层菜单分别是项目、编辑、Git、帮助。Windows 和 Linux 使用无边框窗口，并在共享 CraftCode 主题的 40px Web 顶栏中显示菜单：左侧保留紧凑菜单入口，右侧放置最小化、最大化/还原和关闭按钮。顶栏同时是可拖拽的标题栏区域，菜单按钮和窗口控制按钮不会触发拖拽。选择菜单后，Electron 会在 Web 入口下方打开对应的原生子菜单；macOS 保留系统应用菜单和原生窗口边框。完整应用菜单仍会安装，以提供原生角色和快捷键。项目设置保存在 `.dsh/project.yaml`，Git 和 Gradle 输出显示在桌面结果面板。

项目菜单可以启动或停止当前模组项目的开发客户端。主进程探测完整且有界的 `tasks --all --console=plain` 输出，只通过项目 wrapper 或全局 Gradle 启动唯一且未限定的 `runClient` 或 `runGame` 任务。每个规范化项目路径最多持有一个客户端进程。客户端自行退出时结果面板会收到提示，失败时保留有界输出；停止游戏或关闭 CraftCode 会终止完整的 Gradle/Java 进程树，并在有界期限后强制停止。

关闭所有 Electron 窗口会通过子进程 IPC 通道请求 CLI 执行现有的有界 Cordis dispose。监督器等待后端退出，只有超过优雅关闭期限后才升级为进程终止。桌面打包使用已提交的多尺寸 `src/CraftCode.ico` 源资源，该资源由 Web 端统一 favicon 生成，并在桌面构建时复制到 `lib`。

## 安全

renderer 开启 `contextIsolation`、Chromium 沙箱和 web security，关闭 Node integration。preload 只暴露固定的菜单、当前项目、游戏事件和项目命令方法，不暴露 Node API 或任意 IPC。同源 loopback 导航保留在 Electron 中；外部 HTTP(S) 链接交给系统浏览器，其他协议和 webview 均被拒绝。

## 当前限制

此里程碑仅提供开发版。帮助链接目前是 `https://example.com/craftcode/docs` 和 `https://example.com/craftcode/sponsor` 占位地址，发布前必须替换。不包含安装程序、打包后的 Node 运行时、自动更新、代码签名、JDK 或 Gradle 打包，也不包含 `file://` renderer 传输。游戏启动要求项目恰好提供一个根 `runClient` 或 `runGame` 任务；有限定的多项目任务和已安装的 Minecraft 启动器不属于此命令。全新检出必须先构建现有 Host、客户端插件和 Web 产物，`dsh web` 才能提供完整应用。
