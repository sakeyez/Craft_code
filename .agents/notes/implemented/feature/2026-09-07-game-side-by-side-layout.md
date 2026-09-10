# Agent Note: Automatic game and companion layout

Status: implemented

English | [中文](2026-09-07-game-side-by-side-layout.zh.md)

## Problem

A narrow companion beside a large Minecraft window leaves more room for game inspection and conversation. Placing only CraftCode cannot guarantee that both windows fit, and an overlay can obscure game controls.

## Decision

The Windows desktop provider arranges the selected project's game and companion as independent top-level windows. This partially supersedes the observation-only placement decision in [game workspace annotations](2026-09-02-game-workspace.md); native ownership, styles, direct game input, and annotation capture remain owned by that record.

The first visible window is arranged after two stable polls. Its display work area supplies 8-DIP outer margins and an 8-DIP gap. CraftCode takes about 26% of the available width, clamped to 360-520 DIP while reserving at least 640x480 DIP for Minecraft. Both windows share the work-area height minus 16 DIP. Insufficient space leaves independent windows. Ordinary maximized game windows are restored; fullscreen windows wait for windowed mode.

When the game window is connected, the renderer enters focus mode and hides project chrome (top menu, sidebar rail, and blank-session project selectors) while keeping the conversation mounted. Disconnecting or stopping the game removes the focus marker and restores the chrome.

The provider revalidates HWND, PID, and process creation identity before requesting an asynchronous native move. Electron converts physical screen coordinates to and from DIP, and visible frame offsets account for Windows resize borders. A bounded result check stops failed arrangements and permits explicit retry. Renderer IPC exposes only project selection and reposition commands.

Game movement and resize update the companion's right-side position and height while preserving its manual width. Insufficient right-side space pauses following without moving or raising the panel. Reposition arranges both windows and resumes following. Project selection, reconnect, and minimize/restore preserve an already arranged game window. Game exit restores CraftCode bounds, maximization, minimum size, topmost state, and background throttling.

## Alternatives considered

**Observation-only placement.** Avoiding all game moves cannot provide a predictable large game viewport beside a narrow panel. Explicit reposition and one automatic arrangement bound the native changes.

**Temporary annotation overlay.** A borderless overlay is used only for the one-shot still-frame annotation transaction at verified Minecraft client bounds. It freezes the visual surface without suspending the process, then is destroyed to restore the side-by-side layout; ordinary browsing and conversation remain independent windows.

**Size settings in the first version.** Fixed defaults cover the requested workflow; manual panel resizing retains user control without a separate settings contract.

## Consequences

The desktop gains predictable geometry at the cost of permission to resize its verified game window. Geometry, ownership, timeout, switching, and native minimize/restore tests cover this boundary. Real Minecraft checks and narrow-panel inspection remain necessary; passing layout tests does not establish the cause of a blank renderer after restore.
