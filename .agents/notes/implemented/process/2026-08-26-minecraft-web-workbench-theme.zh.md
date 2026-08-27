# Agent Note: Minecraft workbench web theme

Status: implemented

[English](2026-08-26-minecraft-web-workbench-theme.md) | 中文

## Problem

浏览器客户端当前呈现的是通用 DeepSeek 界面，而仓库的主要产品方向包含 Minecraft mod 开发。界面需要具有明确的 Minecraft 工作台识别度，同时不能把视觉表现耦合到会话状态，也不能改变 Web 协议。

## Decision

`ui-theme` 在现有 `--dsw-*` token 系统之上提供 Minecraft 皮肤。浅色和深色调色板分别使用石材、深板岩、苔藓、矿石、金锭和红石角色。本地发布的 Press Start 2P 字体只用于短标题和短标签；正文与 CJK 继续使用现有可读字体栈。侧栏、对话区、输入框、设置表面、菜单以及加载/失败状态共享这些 token，并使用无像素阴影的平面物品栏式边框。大部分界面保持方形；未选择 Workspace 的输入框入口使用 `8px` 圆角与更浅的 l2 边框，以区别其选择器入口语义。加号和发送控件共用选择器填充色，并在悬停时使用金色；发送控件向下偏移 `1px` 以改善视觉对齐。关键空状态和加载文案采用打造语气，但功能标签和无障碍名称保持明确。

CraftCode 项目标记在浏览器 favicon、PWA 元数据、侧栏和空会话 Hero 中统一使用用户提供的 Minecraft 方块与蓝色鱼尾图案。Web public 的 `/favicon.svg` 内嵌由该图片确定性生成的透明 PNG，共享 `FishLogo` atom 以稳定方形尺寸渲染同一个 URL。Hero 持有标记的悬停 transform，并在 `prefers-reduced-motion: reduce` 下禁用该动效。

其余皮肤在表现层保持纯 CSS。现有 React 树、slot contract、会话事件、输入框滚动所有权、主题偏好处理和模块清单均保持不变。字体从 Web public 资源路径提供，并附带 SIL Open Font License 声明。

## Alternatives considered

**单独的 Minecraft preset 主题：** 拒绝，因为请求覆盖整个 Web 客户端，单独主题会重复 token 和组件表面。

**用游戏 HUD 重写组件树：** 拒绝，因为纯视觉改动不应冒险破坏键盘、响应式和无障碍契约。

**外部字体或纹理 CDN：** 拒绝，因为 Web 客户端必须在离线和本地部署中可用。

**为 favicon 和应用内图标维护不同素材：** 拒绝，因为独立副本容易漂移，也会增加不必要的浏览器负载。

## Consequences

所有 Web 客户端都使用 Minecraft 工作台外观和项目标记，并继续支持浅色和深色模式。边框与颜色层级在不使用硬边像素阴影的情况下表达层次；焦点环与按压位移反馈保持可见。视觉快照和样式顺序测试需要包含新增的全局样式表。设计保持长文本可读，并保留几何敏感的交互行为。本地字体和内嵌彩色标记会增加 Web public 负载，但不会引入运行时网络依赖或重复品牌资源。

## Verification

现有 `ui-theme` 生命周期测试验证样式表的挂载和卸载。加载页与对话 locale 测试固定关键可见文案。组件与 PWA 测试固定共享标记 URL、方形尺寸、内嵌透明 PNG，并确认旧单色 path 不再存在。焦点、减少动效、Hero 悬停动效、侧栏折叠、输入框几何、主题切换和 Web 构建检查覆盖表现契约；浏览器截图提供桌面/移动端浅色/深色证据。
