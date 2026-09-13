# Agent Note: Minecraft 按需工作流

Status: implemented

[English](2026-09-11-minecraft-task-dependent-workflow.md) | 中文

## Problem

Minecraft 助手同时处理视觉问答、解释、诊断与开发。无条件项目检测和编码清单会让简单问题触发无关调查，也会让追问重复已经完成的工作。

## Decision

Minecraft 提示词包负责按任务选择证据、技能和验证。预设关闭通用编码流程注入，headless 与交互入口共享 Minecraft 段落。技能说明适用范围和相关证据，不要求逐项执行全部读取。已确认事实可复用，直到其输入变化或出现冲突。

[通用效率策略](2026-08-25-efficient-agent-workflow.zh.md)仍适用于其他预设；批量读取、聚焦验证及正确性保障保留在 Minecraft 规则中。[Minecraft 组合](2026-08-21-mcmod-agent.zh.md)仍负责工具暴露与支持的 loader；两项旧决策都未被完全替代。

## Alternatives considered

**修改全局编码策略。** 其他预设无需改变行为，Minecraft 已有专属提示词所有者，因此不采用。

**运行时分类或工具配额。** 必要调查取决于任务中发现的证据，因此不采用。提示词允许扩大调查，无需持久化模式或禁用工具。

## Consequences

简单问题可以利用已有证据，修改仍需相关验证及获授权的运行时检查。策略不能保证模型遵从，也无法修复缺失的图片载荷。提示词与组合测试证明规则送达；真实模型对照须同时评估答案质量、必要检查和工具活动。
