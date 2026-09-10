# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Electron application shell for DeepSeek Harness. The renderer is built from `apps/desktop/renderer` and served by the private loopback runtime started through `dsh desktop`; the desktop process supplies the window, application-menu commands, project/Git/Gradle commands, and backend-process lifecycle.

## Development

Install dependencies and build the repository artifacts once after a clean checkout, then launch the desktop shell:

```sh
pnpm install
pnpm run build
pnpm desktop:dev
```

`desktop:dev` refreshes the client libraries and renderer dist, compiles the Electron main process, starts the private `desktop` profile on loopback with an OS-assigned port, waits for the Loader-settled `dsh desktop:` URL, and loads that URL in a `BrowserWindow`. Concurrent local services therefore do not require a fixed desktop port.

The four top-level menus are 项目, 编辑, Git, and 帮助. Windows and Linux use a frameless window with a 40px CraftCode-themed Web topbar: the compact menu entries stay on the left, and minimize, maximize/restore, and close controls stay on the right. The topbar is also the draggable title-bar region; menu and window-control buttons opt out of dragging. Selecting a menu opens its native Electron submenu beneath the Web control, while macOS keeps the system application menu and native window chrome. The complete application menu remains installed for native roles and accelerators. Project settings are stored in `.dsh/project.yaml`; Git and Gradle output is shown in the desktop result panel.

The project menu can start or stop the active mod project's development client. The main process probes complete bounded `tasks --all --console=plain` output and launches only one unqualified `runClient` or `runGame` task through the project wrapper or global Gradle. Each canonical project path owns at most one client process. Natural exits are reported to the result panel, failures retain bounded output, and stopping or closing CraftCode terminates the complete Gradle/Java process tree with a bounded force-stop fallback.

On Windows 10/11, the Gradle launch lifecycle supplies its root process id to a main-process-only capture provider. The provider follows creation-time-fenced descendants and locates the Minecraft GLFW window without reparenting it or changing its styles. After two stable observations it arranges Minecraft on the left and the CraftCode BrowserWindow on the right within the display work area, then follows game movement and resize while preserving a manually chosen panel width. Minimized or hidden Minecraft hides the panel; insufficient space pauses following until reposition is requested. Linux and macOS report that Minecraft runs in an independent window and keep the ordinary CraftCode layout.

When annotation starts, the main process selects a visible desktop-capture source by the owned Minecraft HWND and obtains a JPEG no larger than 1920×1080 through `desktopCapturer`, then creates a borderless always-on-top window at the Minecraft client bounds to cover the game with that still frame. The overlay freezes only the visual surface and never suspends the Minecraft process; completion, cancellation, or window changes destroy it and restore game focus and the side-by-side layout. Capture never changes Minecraft's parent, styles, or bounds; an empty source is reported as a retryable error. A successful annotation stores the still frame as a session-authorized image attachment, so later prompts receive both the normalized geometry text and the actual image; only the attachment reference and annotation data enter session events.

Companion mode disables renderer background throttling across game minimize/restore transitions and restores the previous setting when tracking ends. Hidden companions therefore continue scheduling frames, with a corresponding background resource cost. Renderer unresponsive/responsive events, renderer exits, and Chromium child-process exits are recorded in Electron's log directory in `desktop.log`.

Closing every Electron window requests the CLI's existing bounded Cordis disposal over the child-process IPC channel. The supervisor waits for exit, then escalates to process termination only after the graceful deadline. Desktop packaging uses the checked-in multi-size `src/CraftCode.ico` source, generated from the canonical Web favicon and copied into the compiled `lib` output.

## Security

The renderer has `contextIsolation`, Chromium sandboxing, and web security enabled, with Node integration disabled. The preload exposes only fixed menu, active-project, game-event, project-command, renderer-safe game-state, companion reposition/reconnect, and annotation-capture methods; it exposes no Node API, process id, HWND, Win32 operation, window geometry, or arbitrary IPC. Same-origin loopback navigation remains in Electron; external HTTP(S) links open in the system browser, while other protocols and webviews are denied.

Project Git commands, Gradle task discovery, builds, and game launches use the shared [subprocess environment scrubber](../../packages/subprocess/subprocess/README.md). Parent credentials and `DSH_*` context are removed before spawning, while ordinary environment variables such as `PATH` and `JAVA_HOME` remain available.

## Current limits

This milestone is development-only. Help links currently point to `https://example.com/craftcode/docs` and `https://example.com/craftcode/sponsor` and must be replaced before release. It does not provide an installer, packaged Node runtime, automatic updates, code signing, JDK or Gradle packaging, or a `file://` renderer transport. Companion tracking supports Windows 10/11 only and assumes an LWJGL/GLFW desktop window; Linux and macOS leave Minecraft external, and exclusive fullscreen may not provide usable work-area placement. Game launch requires exactly one root `runClient` or `runGame` task; qualified multi-project tasks and installed Minecraft launchers are outside this command. A clean checkout must build the existing Host, client-plugin, and Web artifacts before `dsh desktop` can serve the complete application.
