# Agent Note: Minecraft bootstrap 与工作流技能

Status: implemented

[English](2026-09-13-minecraft-bootstrap-skills.md) | 中文

`mcmod` 预设通过 `bootstrap_mc_project` 在空目录中确定性创建受支持的 Fabric 或 NeoForge 项目。工具校验标识符与版本，通过 `ctx.fs` 将写入限制在会话工作区内，拒绝非空目标，生成完整的最小 Gradle、元数据和源码模板，并以分阶段结果报告 Java 就绪状态。项目创建、环境诊断、内容添加和构建诊断仍由独立技能负责；没有证据时工具不会声称 Gradle 构建或游戏运行成功。检测器对同一资源根只做一次有界遍历来收集 metadata 与 mixin 线索，无密钥工作流先检测项目事实再编辑。
