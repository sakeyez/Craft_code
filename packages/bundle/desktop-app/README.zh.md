# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

私有 Electron 应用组合包。它在 [`dsh-base`](../base/README.zh.md) 之上叠加桌面宿主、API 网关、workspace 服务、客户端名录和 renderer 运行时。运行时解析 `apps/desktop/dist/index.html`，通过 [`dsh-host-frontend-static`](../../host/frontend-static/README.zh.md) 挂载，并在 Loader 配置树结算后打印 `dsh desktop: http://127.0.0.1:<port>` readiness 行供 Electron 使用。

组合包只绑定 loopback，绝不会打开外部浏览器，也不提供独立 Web 或 PWA 入口。`--port` 是桌面应用唯一的参数；省略时使用 `3080`，Electron 开发流程传入 `0` 让操作系统分配端口。`surfaceContext` 控制面向模型的桌面说明和 `DSH_DESKTOP_URL` shell 变量；`printUrl` 控制 readiness 输出。本地 HTTP 服务仅作为 Electron renderer 的内部传输实现。

客户端插件 HMR 接收端始终挂载，只有 `pnpm run dev:desktop-renderer` 重建客户端产物时才会工作。[`dsh-headless`](../headless/README.zh.md) 是同一 base 之上的同级 profile，不挂载本组合包。

## 模型体验

### 桌面表面

#### What the model sees

启用 `surfaceContext` 时，组合包向模型请求加入 Harness 源码位置和 `app:desktop-surface` 说明。该说明指出 loopback 桌面 renderer，并要求模型不要启动替代服务器。

#### Token effect

该说明是简短的固定前缀，只把渲染后的文本加入每次组装的请求。

#### KV Cache effect

固定说明可在请求前缀中复用；动态本地端口通过 shell 环境提供，不写入提示词。

## 已知限制与延期工作

- HTTP 载体明确限制为 Electron 内部实现，不提供远程认证或公开主机契约。
- 必须先构建 renderer 产物，组合包才能提供页面。
