# Agent Note: Game workspace annotations

Status: implemented

English | [中文](2026-09-02-game-workspace.zh.md)

## Problem

Minecraft development sessions need the existing workspace and conversation alongside a real game surface, with annotations that remain aligned when the surface resizes.

## Decision

The shell declares a session-maybe `game` slot and switches the center/right occupants only while a desktop game state is active. `GameWorkspace` renders a real video URL when supplied and otherwise shows explicit lifecycle states. Annotation geometry is normalized to the surface content rectangle and persisted as a full-list `game/annotations` session event through `session.annotate`; prompt serialization appends the same structured context to the existing conversation transport.

## Consequences

Desktop builds without a capture provider report `unsupported` and never claim a connected stream. The UI keeps the original sidebar and conversation composition, adds independent game scrolling and mobile tabs, and exposes provider seams for a future Windows capture implementation.
