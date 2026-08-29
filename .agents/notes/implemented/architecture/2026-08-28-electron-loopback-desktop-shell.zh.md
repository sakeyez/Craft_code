# Agent Note: Electron loopback 桌面壳

Status: implemented

[English](2026-08-28-electron-loopback-desktop-shell.md) | 中文

## Problem

`apps/web` 是运行时客户端插件图之上的 Vite 入口，不是独立静态页面：`dsh web` 注入启动 manifest、提供插件 bundle，并负责 HTTP API 和 WebSocket 下行链路。桌面开发应用必须在拥有原生窗口的同时保留这套组装行为，并确保正常关闭窗口后后端不会继续存活。

## Decision

`apps/desktop` 是进程监督器和 Electron 壳，不是另一套客户端实现。它以 `dsh web --host 127.0.0.1 --port 0 --no-open` 启动现有源码 CLI，只接受 Loader 完全结算后的 `dsh web: http://127.0.0.1:<port>` 就绪行，再为该 origin 创建 `BrowserWindow`。浏览器客户端因此继续使用已交付的同源 HTTP API、WebSocket 事件流、插件加载、会话行为和项目操作。

端口由操作系统分配。Electron 不会在子进程绑定前预留候选端口，因此启动过程不存在释放后重新绑定的竞争。就绪 URL 仅接受普通 HTTP、字面量 loopback 地址和非零有效端口。

只有当 `DSH_SUPERVISOR_IPC=1` 且存在 Node IPC 通道时，CLI 才安装父级监督器消息监听器。精确的 `dsh/supervisor-shutdown` 消息进入启动器现有的 `ProcessShutdown.shutdown(0)` 路径，dispose Cordis 树，并在完全停稳后断开 IPC。Electron 合并窗口和应用关闭请求，等待该进程退出；子进程未结算时才按 SIGTERM、SIGKILL 的期限逐级升级。

每个桌面壳拥有的窗口都开启 context isolation、Chromium 沙箱和 web security，同时关闭 Node integration。固定 preload 桥接只暴露封闭的菜单动作订阅与请求／响应式项目命令调用，invoke 返回值是唯一的命令完成通道；它不暴露 Node API、任意 IPC 通道或任意命令执行。同源导航保留在桌面壳内；外部 HTTP(S) 导航交给操作系统浏览器，其他 scheme 和 webview 均被拒绝。

此决策局部取代 [GUI 分层与 RPC 协议](2026-07-19-gui-layering-and-rpc-protocol.zh.md)中的 Electron 传输假设：开发壳直接使用 Web 载体。该记录仍保持 active，因为其中的 host/client 分层和通道无关 RPC 规则继续约束应用；有独立依据的打包桌面壳以后仍可替换载体。

## Verification

纯测试固定启动参数、就绪 URL 限制、隔离窗口偏好和导航策略。进程测试覆盖优雅 IPC 关闭、启动超时清理和后端提前失败。CLI 适配器测试固定显式启用条件和消息合并。桌面冒烟测试启动真实命令、等待现有 Web UI、执行一项主要操作、关闭窗口，并验证后端 PID 和绑定端口均已消失。

## Alternatives considered

**用 `file://` 加载 Vite dist，并以 Electron IPC 替换 HTTP/WebSocket。** 此里程碑不采用，因为 dist 缺少 Host 注入的启动图，而新载体会在没有新增必要能力的情况下复制可用的本机传输。如果打包或隔离以后形成具体需求，客户端传输 hook 仍可使用。

**在 Electron 主进程内运行 Cordis Host。** 不采用，因为它会把 Electron 生命周期和模块解析耦合到 CLI 组装，绕过受支持的 `dsh web` 入口，并失去后端故障的进程隔离。

**选择固定桌面端口。** 不采用，因为多次启动和无关本机服务都可能占用它；WebServer 已支持操作系统分配端口，并会在完全结算后报告实际绑定值。

**关闭最后一个窗口时直接终止子进程。** 不作为正常路径，因为会话持久化、WebSocket 清理和插件 disposer 已有一个有界的完全停稳关闭所有者。强制终止只保留为监督器兜底。

## Consequences

桌面开发壳继承 Web profile 的全部行为和当前限制，包括对已构建 Web 与客户端插件产物的要求。安装程序必须提供 Node/运行时闭包和可写 Harness home，因此打包仍是独立里程碑。Electron 硬崩溃仍可能需要操作系统清理；正常窗口关闭与应用关闭则会合并并保持有界。
