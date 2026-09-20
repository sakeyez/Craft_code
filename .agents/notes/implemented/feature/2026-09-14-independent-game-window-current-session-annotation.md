# Agent Note: Independent Minecraft window and current-session annotation

Status: implemented

English | [中文](2026-09-14-independent-game-window-current-session-annotation.zh.md)

## Problem

Automatic side-by-side companion layout changed the user's CraftCode window and removed ordinary conversation chrome while Minecraft was running. Annotation completion also remained tied to the session that was active when capture started.

## Decision

Minecraft remains an independently owned top-level window. The Windows capture provider only discovers the verified HWND, observes visibility/minimize state, and manages the private screenshot stream; it never repositions, resizes, hides, maximizes, or changes CraftCode bounds, chrome, or throttling. The renderer keeps its original top bar, sidebar, details, conversation, and composer mounted after connection. The game slot exposes only the game name, passive status/error, and annotation entry.

Annotation requests retain an operation id, project path, start-session id, and labels for shortcut binding, project validation, and initial numbering. The preload routes completion by operation id only. At completion, `ui-layout` resolves the session that is current at that instant and invokes its annotation binding. A session switch during the overlay is allowed; an unavailable or conflicting target leaves the overlay and draft open. Success is the only path that closes and resets the overlay.

This supersedes the automatic side-by-side companion layout and its reposition/reconnect contract. Native window ownership stays in the desktop main process, while session ownership is resolved at submit time in the renderer layout service.

## Verification

Provider unit and native fixture checks assert unchanged CraftCode geometry and visibility through discovery, movement, minimize/restore, selection, stop, and game exit. Layout and workspace tests assert that connected games do not add focus-mode attributes or companion controls. The preload contract and renderer tests cover operation-scoped delivery and the persistent original page.

## Alternatives considered

Keeping the companion layout would preserve automatic placement but violate the requirement that the original page remain unchanged. Cancelling an overlay on every session switch would avoid ambiguous ownership but lose the requested submit-time current-session behavior.

## Consequences

Users arrange the two independent windows themselves. The game slot is intentionally passive except for annotation, and a failed current-session save keeps the overlay open so the user can correct the session or retry.

The [workbench decision](2026-09-16-minecraft-workbench.md) owns shared environment preparation and retained run state.
