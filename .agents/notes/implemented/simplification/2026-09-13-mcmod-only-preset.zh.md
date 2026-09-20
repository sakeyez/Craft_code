# Agent Note：Minecraft 专用预设列表

状态：已实现

[English](2026-09-13-mcmod-only-preset.md) | 中文

## 问题

通用预设和用户自定义预设可能绕过 mcmod 组合选定的 Minecraft 指导。

## 决策

[mcmod bundle](../../../../packages/bundle/mcmod/cordis.patch.yml) 仅暴露 `mcmod` 预设。agent-presets 的 `allowedIds` 白名单过滤发现、解析与挂载入口；`includeUserRoot: false` 排除用户预设目录。未配置此限制的组合保留其预设列表。

## 考虑过的替代方案

仅设置默认预设仍允许选择其他预设。仅限制界面无法约束解析和挂载。因此，限制由 bundle 的 agent-presets 配置负责。

## 影响

mcmod 组合统一选择 Minecraft 指导，代价是无法使用通用预设和用户自定义预设。限制只作用于该组合，不改变共享预设服务的默认行为。
