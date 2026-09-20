# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Electron application shell for DeepSeek Harness. The renderer is built from `apps/desktop/renderer` and served by the private loopback runtime started through `dsh desktop`; the desktop process supplies the window, menus, project/Git/Gradle commands, game lifecycle, and annotation capture.

Minecraft runs as an independent top-level window. On Windows the main-process provider follows creation-time-fenced descendants and locates the verified GLFW HWND without reparenting, moving, resizing, hiding, maximizing, or changing its styles. It only warms a private screenshot stream while the game is visible; CraftCode keeps its original bounds, visibility, top bar, sidebars, details, conversation, composer, and background throttling. Linux and macOS keep the same ordinary layout.

Ctrl+Shift+P and the page's “在游戏上标注” button open the same one-shot borderless annotation overlay. The overlay provides only screenshot, point/rectangle marking, description editing, and submit/cancel controls; it has no chat input. At submit time the renderer resolves the current conversation, so switching sessions during annotation is supported. Unavailable sessions, unsaved sessions, label conflicts, stale operation ids, or invalid HWNDs leave the overlay and draft open for retry.

The preload bridge exposes fixed menu, active-project, game-event, project-command, renderer-safe game-state, and annotation-capture methods. Reposition and reconnect IPC are intentionally absent. Native HWND, process, and capture permissions remain main-process-only.

The supervised host can request `dsh/network-proxy` with a bounded request id and credential-free HTTPS URL. The main process calls Electron `session.defaultSession.resolveProxy` and returns `dsh/network-proxy-result`; this private child channel exposes no renderer fetch or system-setting mutation. Resolution errors are explicit. Minecraft network policy is documented in the [workbench host](../../packages/minecraft/mc-workbench/README.md).

## Development

```sh
pnpm install
pnpm run build
pnpm desktop:dev
```

`desktop:dev` builds the client libraries and renderer, compiles the Electron main process, starts the private desktop profile on loopback, waits for the Loader-settled URL, and loads it in a `BrowserWindow`.

## Current limits

This milestone is development-only. It does not provide an installer, packaged Node runtime, automatic updates, code signing, JDK or Gradle packaging, or a `file://` renderer transport. Game launch requires exactly one root `runClient` or `runGame` task. Runtime gameplay and real Minecraft rendering remain environment-dependent and require an explicit client run.

Minecraft menu launches use the [workbench host](../../packages/minecraft/mc-workbench/README.md); Electron discovers native windows from the host-owned process and retains its screenshot annotation role.
