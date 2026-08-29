# @deepseek-ai/dsh-client-ui-desktop-menu

English | [中文](README.zh.md)

Electron-only desktop menu UI over the shared Web shell. When the sandboxed preload bridge exists, the plugin registers one `shell.overlay` entry, converts native menu actions into a renderer-bound observable, and presents project settings, conversation search, Git inputs and confirmations, and command feedback with the shared theme primitives. On Windows and Linux it also registers a 40px `shell.topbar` menu with compact 14px labels, 10px horizontal button padding, and three 32px window controls. The topbar is the frameless window's draggable title-bar region; controls opt out of dragging, and the selected native submenu opens at the control's bounded renderer coordinates. macOS uses its system application menu and native window chrome, and an ordinary browser receives neither desktop entry.

The preload bridge exposes a closed menu-action subscription, the fixed-menu `openMenu` request, and one `invokeProjectCommand` request/response method. The main process validates popup sender identity, menu id, and content-relative integer coordinates before opening a native submenu. Command completion has one owner: the invoke result. Components receive menu presentation, workspace creation, project search, and command calls through their injected faces; they never read Cordis Context or Node APIs. Electron's main process retains filesystem and process authority, while directory, artifact, and save-location choices remain native operating-system dialogs.

Short successful and cancelled operations dismiss after four seconds. Failures and results with stdout or stderr remain until dismissed, and bounded process output is available through an expandable detail region. Every input is controlled, modal actions are keyboard-operable, and the status indicator pairs color with text and state glyphs.

## Model Experience

### Project settings

#### What the model sees

After a save, later requests include the configured `.dsh/project.yaml` `systemPrompt` and prerequisite mod paths through the owning agent-loop prompt integration; menu interaction, search, Git commands, and notification state remain outside model context.

#### Token effect

The configured text and prerequisite paths add their normal prompt tokens to each later request; the desktop UI itself adds none.

#### KV Cache effect

Changing either configured field changes the prompt prefix for later requests and can reduce provider-side cache reuse; UI-only interaction has no cache effect.

## Known Limitations and Deferred Work

- **Electron preload required** — browser tabs never receive the desktop menu entry or its privileged commands.
- **Native submenus and dialogs follow the operating system** — submenu rows, directory dialogs, and JAR save dialogs do not inherit Web theme tokens.
- **One visible command result** — a newer command replaces the prior notification; process output remains bounded by the Electron command runner.
