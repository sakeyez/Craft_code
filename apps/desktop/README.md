# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Electron development shell for the existing DeepSeek Harness Web application. The renderer is the unchanged `apps/web` build served by `dsh web`; the desktop process supplies the window, application-menu commands, project/Git/Gradle commands, and backend-process lifecycle.

## Development

Install dependencies and build the repository artifacts once after a clean checkout, then launch the desktop shell:

```sh
pnpm install
pnpm run build
pnpm desktop:dev
```

`desktop:dev` refreshes the client libraries and Web dist, compiles the Electron main process, starts `apps/cli/src/bin.ts web --host 127.0.0.1 --port 0 --no-open`, waits for the Loader-settled `dsh web:` URL, and loads that URL in a `BrowserWindow`. The operating system assigns the port, so concurrent local services do not require a fixed desktop port.

The four top-level menus are 项目, 编辑, Git, and 帮助. Windows and Linux use a frameless window with a 40px CraftCode-themed Web topbar: the compact menu entries stay on the left, and minimize, maximize/restore, and close controls stay on the right. The topbar is also the draggable title-bar region; menu and window-control buttons opt out of dragging. Selecting a menu opens its native Electron submenu beneath the Web control, while macOS keeps the system application menu and native window chrome. The complete application menu remains installed for native roles and accelerators. Project settings are stored in `.dsh/project.yaml`; Git and Gradle output is shown in the desktop result panel.

The project menu can start or stop the active mod project's development client. The main process probes complete bounded `tasks --all --console=plain` output and launches only one unqualified `runClient` or `runGame` task through the project wrapper or global Gradle. Each canonical project path owns at most one client process. Natural exits are reported to the result panel, failures retain bounded output, and stopping or closing CraftCode terminates the complete Gradle/Java process tree with a bounded force-stop fallback.

On Windows 10/11, the Gradle launch lifecycle supplies its root process id to a main-process-only capture provider. The provider follows creation-time-fenced descendants and locates the Minecraft GLFW window, but never reparents it or changes its styles. Each project retains its own top-level window while running; only the selected project drives the existing CraftCode BrowserWindow companion, which follows Minecraft bounds, clips to the display work area, hides while Minecraft is minimized or hidden, and restores its saved CraftCode bounds when companion mode ends. A failed or timed-out discovery remains an explicit failed state with reconnect and reposition actions while the game continues externally. Linux and macOS report that Minecraft runs in an independent window and keep the ordinary CraftCode layout.

Annotation capture uses the main-process-owned Minecraft HWND to select a visible desktop-capture source and obtains a JPEG no larger than 1920×1080 through `desktopCapturer`. Capture never changes Minecraft's parent, styles, bounds, visibility, or z-order; an empty source is reported as a retryable error. The still image is component-local while the HTML annotation layer is active, and only normalized annotation geometry and descriptions enter session events.

Closing every Electron window requests the CLI's existing bounded Cordis disposal over the child-process IPC channel. The supervisor waits for exit, then escalates to process termination only after the graceful deadline. Desktop packaging uses the checked-in multi-size `src/CraftCode.ico` source, generated from the canonical Web favicon and copied into the compiled `lib` output.

## Security

The renderer has `contextIsolation`, Chromium sandboxing, and web security enabled, with Node integration disabled. The preload exposes only fixed menu, active-project, game-event, project-command, renderer-safe game-state, companion reposition/reconnect, and annotation-capture methods; it exposes no Node API, process id, HWND, Win32 operation, window geometry, or arbitrary IPC. Same-origin loopback navigation remains in Electron; external HTTP(S) links open in the system browser, while other protocols and webviews are denied.

## Current limits

This milestone is development-only. Help links currently point to `https://example.com/craftcode/docs` and `https://example.com/craftcode/sponsor` and must be replaced before release. It does not provide an installer, packaged Node runtime, automatic updates, code signing, JDK or Gradle packaging, or a `file://` renderer transport. Companion tracking supports Windows 10/11 only and assumes an LWJGL/GLFW desktop window; Linux and macOS leave Minecraft external, and exclusive fullscreen may not provide usable work-area placement. Game launch requires exactly one root `runClient` or `runGame` task; qualified multi-project tasks and installed Minecraft launchers are outside this command. A clean checkout must build the existing Host, client-plugin, and Web artifacts before `dsh web` can serve the complete application.
