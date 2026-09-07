# Agent Note: Game workspace annotations

Status: implemented

English | [中文](2026-09-02-game-workspace.zh.md)

## Problem

Minecraft development sessions need the existing workspace and conversation alongside a real game window, with annotations that remain aligned to a captured frame.

## Decision

The shell declares a session-maybe `game` slot and keeps project-scoped capture states in the root layout store. The desktop preload publishes complete `{ cwd, state }` replacements through `ctx.layout`; AppFrame always keeps the ordinary sidebar, conversation, and details layout, while the selected project's slot renders companion controls. `starting`, `connected`, `failed`, `disconnected`, `reconnecting`, and `unsupported` are renderer-safe states. Multiple project games may continue running, but only the selected project controls the companion.

Windows uses a main-process Koffi provider that receives the Gradle root PID, follows descendant processes with `GetProcessTimes` creation identities, and ranks visible windows by GLFW class, Minecraft title, and usable size. Minecraft remains a native top-level window: the provider only reads HWND validity, bounds, visibility, and minimized state. It never calls `SetParent`, changes `WS_CHILD`/`WS_POPUP` or title-bar styles, moves Minecraft, or changes its z-order. The provider reuses the existing CraftCode BrowserWindow as a companion, placing a 480-DIP panel to the right or left and falling back to a clipped 420x560-DIP top-right overlay. Bounds are applied only when observations change, and only the selected project drives the panel. The panel hides with a hidden/minimized game and restores saved CraftCode bounds, maximization, minimum size, and always-on-top state when companion mode ends.

Annotation mode addresses the visible Minecraft HWND through Electron `desktopCapturer` and captures a quality-limited JPEG no larger than 1920x1080. Capture never reparents, styles, hides, moves, or raises Minecraft; an empty source is a retryable error. The still image remains component-local while `GameWorkspace` renders the HTML annotation layer. Save, cancel, project switch, unmount, capture failure, and provider disposal clear the generation and call `endAnnotation`. Annotation geometry is normalized to the captured content rectangle and persisted as a full-list `game/annotations` session event through `session.annotate`; prompt serialization appends the same structured context to the existing conversation transport.

Linux and macOS use an unsupported provider that leaves Minecraft external and publishes `unsupported` with an independent-window message. PID, HWND, and Win32 operations never cross the preload boundary.

## Alternatives considered

**Video streaming into HTML.** Encoding and transporting every frame would add latency, GPU and CPU cost, and a separate input-forwarding protocol. The external native window keeps GLFW rendering and direct Windows input intact.

**Reparenting the GLFW window.** Repeated `SetParent` and style transitions can leave an OpenGL/GLFW surface black even while Java and LWJGL render threads remain healthy. Minecraft therefore keeps native ownership and top-level styles throughout its lifetime.

**Electron child or owner windows.** BrowserWindow ownership cannot adopt an arbitrary JVM HWND, and an owner relationship would couple close/minimize behavior without solving OpenGL composition. A side or compact companion uses ordinary Electron bounds without changing Minecraft identity.

**Capturing annotations through a live embedded surface.** Chromium does not expose a foreign GLFW surface as a stable renderer surface. A desktop-capture source selected by HWND provides a bounded still frame while Minecraft remains untouched; the frame is discarded after the annotation interaction.

## Consequences

Windows gains direct mouse, keyboard, resize, project-switch, and annotation behavior without a frame-stream transport or Minecraft window mutation. The accepted costs are Win32 process/window observation, DPI bookkeeping for companion placement, and Windows-only tracking. GLFW class matching has a same-process-tree visible-window fallback, so unusual LWJGL window classes remain usable without permitting unrelated processes. The native fixture verifies top-level parent/style preservation, bounds tracking, hide/show, capture, and disposal without requiring Minecraft; real Fabric and NeoForge `runClient` gameplay remains a separate, explicitly authorized acceptance run.
