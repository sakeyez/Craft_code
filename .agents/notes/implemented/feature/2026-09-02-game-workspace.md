# Agent Note: Game workspace annotations

Status: implemented

English | [中文](2026-09-02-game-workspace.zh.md)

## Problem

Minecraft development sessions need the existing workspace and conversation alongside a real game window, with annotations that remain aligned to a captured frame.

## Decision

The shell declares a session-maybe `game` slot and keeps project-scoped capture states in the root layout store. The desktop preload publishes complete `{ cwd, state }` replacements through `ctx.layout`; the selected project's slot renders companion controls, with the connected focus layout owned by [automatic side-by-side layout](2026-09-07-game-side-by-side-layout.md). `starting`, `connected`, `failed`, `disconnected`, `reconnecting`, and `unsupported` are renderer-safe states. Multiple project games may continue running, but only the selected project controls the companion.

Windows uses a main-process Koffi provider that receives the Gradle root PID, follows descendant processes with `GetProcessTimes` creation identities, and ranks visible windows by GLFW class, Minecraft title, and usable size. Minecraft remains a native top-level window: the provider never reparents it or changes `WS_CHILD`/`WS_POPUP` or title-bar styles. The original observation-only decision avoided game mutation by placing CraftCode beside the game or in a compact overlay. [Automatic side-by-side layout](2026-09-07-game-side-by-side-layout.md) supersedes that placement decision with verified, bounded game positioning; this record retains the native ownership and annotation boundaries.

Annotation mode addresses the visible Minecraft HWND through Electron `desktopCapturer` and captures a quality-limited JPEG no larger than 1920x1080. Capture never reparents, styles, hides, moves, or raises Minecraft; an empty source is a retryable error. The still image remains component-local while `GameWorkspace` renders the HTML annotation layer. Successful save, cancel, project switch, unmount, capture failure, and provider disposal clear the generation and call `endAnnotation`. Annotation geometry is normalized to the captured content rectangle and persisted as a full-list `game/annotations` session event through `session.annotate`; prompt serialization appends the same structured context to the existing conversation transport.

Description editing does not require a new frame because the existing annotation already owns its geometry. The editor mounts independently of capture state and closes only after persistence succeeds. RPC refusals become action errors, and failed saves retain the draft for retry; transport completion alone does not establish acceptance. Component tests cover failure and cancellation, and the real web composition verifies edits against persisted session events.

The companion saves and disables renderer background throttling until companion mode ends. Hidden-window frame scheduling otherwise pauses, coupling the Web UI to the game's minimize/restore cycle. Keeping frames scheduled is a mitigation for restore stalls, with additional background resource use. The native fixture uses production BrowserWindow preferences and hardware acceleration, checks frame progression while hidden, and verifies restored pixels and input across repeated compact-panel restores and game exit. This does not establish the cause of a Minecraft-specific GPU stall; real-game reproduction remains required for that diagnosis. Desktop lifecycle logs distinguish unresponsive renderers and renderer/Chromium child-process exits from backend exits.

Linux and macOS use an unsupported provider that leaves Minecraft external and publishes `unsupported` with an independent-window message. PID, HWND, and Win32 operations never cross the preload boundary.

The annotation transaction creates a borderless always-on-top overlay at the verified Minecraft client bounds and uses a one-shot still frame to freeze the visual surface. It never suspends the Minecraft process; completion, cancellation, or window changes destroy the overlay and restore the side-by-side layout and game focus.

## Alternatives considered

**Video streaming into HTML.** Encoding and transporting every frame would add latency, GPU and CPU cost, and a separate input-forwarding protocol. The external native window keeps GLFW rendering and direct Windows input intact.

**Reparenting the GLFW window.** Repeated `SetParent` and style transitions can leave an OpenGL/GLFW surface black even while Java and LWJGL render threads remain healthy. Minecraft therefore keeps native ownership and top-level styles throughout its lifetime.

**Electron child or owner windows.** BrowserWindow ownership cannot adopt an arbitrary JVM HWND, and an owner relationship would couple close/minimize behavior without solving OpenGL composition. A side or compact companion uses ordinary Electron bounds without changing Minecraft identity.

**Capturing annotations through a live embedded surface.** Chromium does not expose a foreign GLFW surface as a stable renderer surface. A desktop-capture source selected by HWND provides a bounded still frame while Minecraft remains untouched; the frame is discarded after the annotation interaction.

## Consequences

Windows gains direct mouse, keyboard, resize, project-switch, and annotation behavior without a frame-stream transport or Minecraft ownership changes. The accepted costs are Win32 process/window observation, DPI bookkeeping for companion placement, and Windows-only tracking. GLFW class matching has a same-process-tree visible-window fallback, so unusual LWJGL window classes remain usable without permitting unrelated processes. The native fixture verifies top-level parent/style preservation, bounds tracking, hide/show, capture, and disposal without requiring Minecraft; real Fabric and NeoForge `runClient` gameplay remains a separate, explicitly authorized acceptance run.
