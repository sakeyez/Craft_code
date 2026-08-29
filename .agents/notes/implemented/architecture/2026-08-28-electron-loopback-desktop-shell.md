# Agent Note: Electron loopback desktop shell

Status: implemented

English | [中文](2026-08-28-electron-loopback-desktop-shell.zh.md)

## Problem

`apps/web` is a Vite entry over the runtime client-plugin graph, not a standalone static page: `dsh web` injects its boot manifest, serves plugin bundles, and owns the HTTP API and WebSocket downlinks. A desktop development application must preserve that assembled behavior while owning a native window and ensuring the backend cannot outlive an ordinary window close.

## Decision

`apps/desktop` is a process supervisor and Electron shell, not another client implementation. It starts the existing source CLI as `dsh web --host 127.0.0.1 --port 0 --no-open`, accepts only the Loader-settled `dsh web: http://127.0.0.1:<port>` readiness line, and creates a `BrowserWindow` for that origin. The browser client therefore keeps the shipped same-origin HTTP API, WebSocket event streams, plugin loading, session behavior, and project operations.

The operating system allocates the port. Electron never reserves a candidate port before the child binds, so startup has no release-and-rebind race. The accepted readiness URL is restricted to plain HTTP, the literal loopback address, and a nonzero valid port.

The CLI installs a parent-supervisor message listener only when `DSH_SUPERVISOR_IPC=1` and a Node IPC channel exists. The exact `dsh/supervisor-shutdown` message enters the launcher's existing `ProcessShutdown.shutdown(0)` path, disposes the Cordis tree, and disconnects IPC after quiescence. Electron coalesces window and application shutdown, waits for that exit, then escalates through SIGTERM and SIGKILL deadlines if the child does not settle.

Every desktop-owned window enables context isolation, Chromium sandboxing, and web security while disabling Node integration. A fixed preload bridge exposes only a closed menu-action subscription and request/response project-command invocation; the invoke result is the sole command-completion channel. It exposes no Node API, arbitrary IPC channel, or arbitrary command execution. Same-origin navigation stays inside the shell; external HTTP(S) navigation uses the operating-system browser, and other schemes and webviews are refused.

This decision partially supersedes the Electron transport assumption in [GUI layering and the RPC protocol](2026-07-19-gui-layering-and-rpc-protocol.md): the development shell uses the Web carrier directly. That note remains active because its host/client layering and channel-independent RPC rules still govern the application, and an independently justified packaged shell may still replace the carrier later.

## Verification

Pure tests pin the launch arguments, readiness URL restrictions, isolated window preferences, and navigation policy. Process tests cover graceful IPC shutdown, startup timeout cleanup, and early backend failure. The CLI adapter tests pin the opt-in and message coalescing. A desktop smoke launches the real command, waits for the existing Web UI, exercises a primary operation, closes the window, and verifies that the backend PID and bound port are gone.

## Alternatives considered

**Load the Vite dist with `file://` and replace HTTP/WebSocket with Electron IPC.** Rejected for this milestone because the dist lacks the Host-injected boot graph and a new carrier would duplicate a working local transport without adding a required capability. The client transport hook remains available if packaging or isolation later supplies a concrete need.

**Run the Cordis Host inside Electron's main process.** Rejected because it would couple Electron lifetime and module resolution to the CLI assembly, bypass the supported `dsh web` entry, and lose process isolation for backend failures.

**Select a fixed desktop port.** Rejected because multiple launches and unrelated local services can occupy it; WebServer already supports an operating-system-assigned port and reports the bound value after settlement.

**Kill the child whenever the last window closes.** Rejected as the normal path because session persistence, WebSocket cleanup, and plugin disposers already have a bounded quiescent shutdown owner. Forced termination remains only the supervisor fallback.

## Consequences

The desktop development shell inherits all behavior and current limitations of the Web profile, including its requirement for built Web and client-plugin artifacts. Packaging remains a separate milestone because an installer must supply a Node/runtime closure and writable Harness homes. A hard Electron crash can still require operating-system cleanup; ordinary window and application shutdown are joined and bounded.
