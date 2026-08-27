# Web UI 样式参考

[English](web-styling.md) | 中文

本文规定浏览器客户端包的样式职责归属与组件规则。当前 token 值位于 [`packages/client/ui-theme/src/styles/`](../packages/client/ui-theme/src/styles/)；本文不重复这份由源码生成的清单。

## 职责归属

[`ui-theme`](../packages/client/ui-theme/README.zh.md) 负责 `--dsw-*` 静态色阶、语义别名、排版、动效、渐变、阴影、滚动条样式以及明暗主题偏好。[`ui-layout`](../packages/client/ui-layout/README.zh.md) 将解析后的主题快照应用到文档。功能包使用语义别名，不得另行定义全局主题。

全局样式表归 `ui-theme/src/styles/` 所有。组件样式以 CSS Modules 形式放在组件旁。当某个值属于该组件的布局或呈现约定时，组件可以定义局部自定义属性；共享颜色、排版、层级和动效属于主题包。

## Minecraft 工作台皮肤

`minecraft.css` 在同一套 `--dsw-*` 别名之上为所有 Web 客户端叠加 Minecraft 工作台配色。它提供石材/深板岩表面、苔藓/矿石/金锭/红石状态、无像素阴影的平面物品栏边框和本地标题字体。大部分界面保持方形；未选择 Workspace 的输入框入口使用 `8px` 圆角与更浅的 l2 边框，以区别其选择器入口语义。功能组件只消费这些别名，并保留现有 slot、会话、输入框、焦点和响应式契约；设计理由与验证证据记录在 [Minecraft 工作台 Agent Note](../.agents/notes/implemented/process/2026-08-26-minecraft-web-workbench-theme.zh.md)。

## 组件规则

- 使用 CSS Modules 和 `clsx`；不得添加组件库或 Tailwind。
- 功能组件使用 `--dsw-alias-*` 语义 token。不得复制静态色板值或在其中写入颜色字面量。
- 功能组件 CSS 不得包含主题选择器。明暗主题覆盖属于主题所有方。
- 字体大小必须与行高配对；已有角色匹配时使用主题排版变量。
- 当组件约定要求保留列结构时，源码文本、终端输出和 diff 行不得换行；使用共享滚动条样式，不得定义组件专用滚动条选择器。
- 呈现规则写在 CSS 中。React 内联样式可以传递组件局部自定义属性值，但不得编码主题分支。
- 添加过渡动画或仅悬停可见的控件时，保留清晰可见的键盘焦点和减少动态效果行为。

## 变更系统

在所属 `ui-theme` 样式表中添加或修改共享 token，然后在功能包中使用其语义别名。公共样式约定发生变化时，更新所属包的参考文档。视觉行为遵循[测试策略](testing.zh.md)；[样式系统 Agent Note](../.agents/notes/implemented/process/2026-07-19-web-styling-system.zh.md) 记录框架依据。
