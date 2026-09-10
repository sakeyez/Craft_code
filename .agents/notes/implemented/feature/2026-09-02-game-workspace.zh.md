# Agent Note: 游戏工作区标注

Status: implemented

[English](2026-09-02-game-workspace.md) | 中文

## 问题

Minecraft 开发会话需要在保留原有工作区和对话的同时使用真实游戏窗口，并让标注始终对齐捕获的静帧。

## 决策

Shell 声明 session-maybe 的 `game` slot，并在根布局 store 中保存项目范围的捕获状态。桌面 preload 通过 `ctx.layout` 发布完整的 `{ cwd, state }` 替换；slot 为所选项目显示陪伴控件，连接后的专注布局由[自动并排布局](2026-09-07-game-side-by-side-layout.zh.md)记录负责。`starting`、`connected`、`failed`、`disconnected`、`reconnecting` 和 `unsupported` 都是 renderer 安全状态。多个项目的游戏可以继续运行，但只有所选项目控制陪伴面板。

Windows 使用仅在主进程中运行的 Koffi 提供方。它接收 Gradle 根 PID，通过 `GetProcessTimes` 创建身份追踪后代进程，并按 GLFW 类名、Minecraft 标题和可用尺寸对可见窗口排序。Minecraft 始终是原生顶层窗口，不调用 `SetParent`，不修改 `WS_CHILD`、`WS_POPUP` 或标题栏样式。最初的只观察决策通过侧边面板或紧凑覆盖来避免调整游戏窗口。[自动并排布局](2026-09-07-game-side-by-side-layout.zh.md)以经过验证且有界的游戏定位取代该放置方案；本记录保留原生所有权与标注边界。

标注模式通过 `desktopCapturer` 按 HWND 选择可见的 Minecraft 窗口并获取质量受限且不超过 1920x1080 的 JPEG。捕获过程不会重新挂接、改样式、隐藏、移动或提升 Minecraft；空源会返回可重试错误。`GameWorkspace` 显示 HTML 标注层时，静帧只保留在组件状态。保存成功、取消、切换项目、组件卸载、捕获失败和提供方 dispose 都会递增 generation、清理状态并调用 `endAnnotation`。标注几何始终归一化到捕获内容矩形，并通过 `session.annotate` 写入 `game/annotations` 全量快照事件；提示词序列化会把相同的结构化上下文附加到现有对话传输。

编辑描述不需要新静帧，因为已有标注已拥有其几何信息。编辑器独立于捕获状态挂载，只有持久化成功后才关闭。RPC 拒绝会转为操作错误，保存失败则保留草稿以便重试；传输完成本身不能证明请求已被接受。组件测试覆盖失败和取消，真实 Web 组合测试则对持久化会话事件验证编辑结果。

陪伴面板保存并关闭 renderer 后台节流，直到陪伴模式结束后恢复。否则隐藏窗口会暂停帧调度，使 Web 界面与游戏的最小化／恢复周期耦合。持续调度帧是缓解恢复卡住的措施，代价是额外的后台资源消耗。原生 fixture 使用生产 BrowserWindow 配置和硬件加速，检查隐藏期间帧计数是否增长，并验证紧凑面板多次恢复及游戏退出后的像素与输入。这不能确定 Minecraft 特有 GPU 卡顿的原因；诊断仍需真实游戏复现。桌面生命周期日志区分 renderer 无响应、renderer／Chromium 子进程退出与后端退出。

Linux 与 macOS 使用不支持跟踪的提供方，让 Minecraft 保持外部窗口，并发布带有独立窗口提示的 `unsupported`。PID、HWND 和 Win32 操作不会跨越 preload 边界。

本实现的标注事务在已验证的 Minecraft 客户区原位置创建无边框置顶覆盖层，以一次性静帧冻结视觉画面；它不挂起 Minecraft 进程，完成、取消或窗口变化后销毁覆盖层并恢复并排布局与游戏焦点。

## 考虑过的替代方案

**把视频流传入 HTML。** 对每一帧编码和传输会增加延迟、GPU 与 CPU 成本，还需要单独的输入转发协议。外部原生窗口保持 GLFW 渲染和直接 Windows 输入。

**重新挂接 GLFW 窗口。** 反复 `SetParent` 和样式转换可能让 OpenGL/GLFW 画面黑屏，即使 Java 与 LWJGL 渲染线程仍然正常。Minecraft 因此在整个生命周期保持原生所有权和顶层样式。

**Electron 子窗口或 owner 窗口。** BrowserWindow 无法接管任意 JVM HWND，owner 关系还会耦合关闭和最小化行为而不能解决 OpenGL 合成问题。侧边或紧凑陪伴面板使用普通 Electron 边界，不改变 Minecraft 身份。

**通过实时嵌入表面捕获标注。** Chromium 不会把外部 GLFW 表面公开为稳定 renderer 表面。按 HWND 选择桌面捕获源可在 Minecraft 完全不变的情况下提供受限静帧；交互结束后立即丢弃静帧。

## 结果

Windows 无需帧流传输或修改 Minecraft 窗口所有权即可获得直接的鼠标、键盘、缩放、项目切换和标注行为。相应代价是维护 Win32 进程／窗口观测与陪伴定位的 DPI 记账，且跟踪仅支持 Windows。GLFW 类名匹配带有同一进程树内可见窗口的回退，因此非常规 LWJGL 窗口类仍可使用，同时不会允许无关进程。原生 fixture 无需 Minecraft 即可验证顶层 parent／样式保持、边界跟踪、隐藏／显示、捕获和 dispose；真实 Fabric 与 NeoForge `runClient` 游戏行为仍需单独明确授权后验收。
