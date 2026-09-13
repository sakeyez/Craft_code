# Agent Note: Task-dependent Minecraft workflow

Status: implemented

English | [中文](2026-09-11-minecraft-task-dependent-workflow.zh.md)

## Problem

A Minecraft assistant serves visual questions, explanations, diagnosis, and development. Unconditional project discovery and coding checklists encourage unrelated investigation during simple questions and repeat completed work on follow-ups.

## Decision

The Minecraft prompt package owns task-dependent evidence, skill, and verification guidance. Its preset disables generic coding workflow injection; headless and interactive compositions share the Minecraft sections. Skills describe their applicability and relevant evidence instead of requiring every listed read. Current project facts can be reused until their inputs change or conflict.

The [generic efficiency policy](2026-08-25-efficient-agent-workflow.md) remains active for other presets. Its batching, focused validation, and correctness protections remain represented in the Minecraft guidance. The [Minecraft composition](2026-08-21-mcmod-agent.md) still owns tool exposure and supported loaders; neither older decision is fully superseded.

## Alternatives considered

**Global coding-policy changes.** Rejected because unrelated presets need no behavior change and Minecraft has a dedicated prompt owner.

**Runtime classification or tool quotas.** Rejected because the needed investigation depends on evidence found during the task. Prompt guidance permits escalation without adding persisted modes or disabling tools.

## Consequences

Simple questions can use existing evidence while changes retain relevant validation and authorized runtime checks. The policy cannot guarantee model compliance or repair missing image payloads. Prompt and composition tests verify delivery; live-model comparisons must assess answer quality and necessary checks alongside tool activity.
