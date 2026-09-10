# Agent Note: Desktop 持有 renderer 入口

Status: implemented

[English](2026-09-10-desktop-owns-the-renderer-entry.md) | 中文

## 问题

仓库同时包含 Electron 壳和基于同一 renderer 的独立 Web 应用包。因此，即使 CraftCode 作为桌面应用发布和运行，仓库仍暴露两个产品入口、两个应用组合包、浏览器打开行为和 PWA 元数据。

## 决策

`apps/desktop` 持有唯一的交互产品入口。renderer 源码位于 `apps/desktop/renderer`，构建到 `apps/desktop/dist`，不具有 workspace 包或发布身份。`@deepseek-ai/dsh-desktop-app` 持有宿主组合，并且只在 loopback 上提供该 dist，使 Electron 能继续使用现有 HTTP、API 和会话传输。

公开的 `dsh web` 命令和 Web profile 不存在。私有 `dsh desktop` 命令选择 desktop profile，只接受可选端口，绝不打开浏览器，并向 Electron 监督器打印 `dsh desktop:` readiness。headless profile 不包含 desktop 组合包。

## 验证

Profile 和 CLI 测试拒绝 `dsh web` 并固定 desktop/headless 组合包 tuple。桌面监督器测试覆盖 readiness、优雅关闭和异常终止。renderer 浏览器测试保留在桌面应用下以覆盖 UI 行为，而独立浏览器和 PWA 测试不存在。Workspace 约束、Cordis 配置校验、TypeScript 构建、renderer 构建和文档同步覆盖其余包名与路径引用。

## 考虑过的替代方案

- 保留 `dsh web` 兼容别名。否决，因为产品仍处于预发布阶段，该别名会继续保留第二个受支持入口。
- 用 Electron IPC 替换本地 HTTP 传输。否决，因为这会无关地重写 API、会话和插件传输层；仅限 loopback 的服务已经提供所需的所有权边界。
- 将 renderer 保留为嵌套可发布包。否决，因为 renderer 是应用持有的构建输入，不是独立版本化产品。

## 后果

Electron 打包和开发流程必须在启动后端前构建 renderer。重新引入独立浏览器产品需要重新决定所有权、认证、发布与测试，不能仅通过启用 Vite serve 或暴露 desktop loopback endpoint 实现。
