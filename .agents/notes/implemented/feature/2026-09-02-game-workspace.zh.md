# Agent Note：游戏工作区标注

Status: implemented

[English](2026-09-02-game-workspace.md) | 中文

## 问题

Minecraft 开发会话需要在保留原有工作区和对话框的同时显示真实游戏画面，并在画面缩放后保持标注位置准确。

## 决策

Shell 增加 session-maybe 的 `game` 槽，仅在桌面游戏状态激活时切换中间和右侧内容。`GameWorkspace` 有真实视频 URL 时才渲染视频，否则显示明确生命周期状态。标注几何始终归一化到画面内容矩形，并通过 `session.annotate` 写入 `game/annotations` 全量快照事件；发送消息继续沿用现有对话链，同时附加相同的结构化标注上下文。

## 结果

没有画面 provider 的桌面版本会报告 `unsupported`，不会伪造已连接状态。UI 保留原侧栏和对话组合，游戏区域独立滚动并在移动端使用标签页，同时为后续 Windows 捕获实现保留 provider 接口。
