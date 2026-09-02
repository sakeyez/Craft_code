# Agent Note: CraftCode native menus and project commands

Status: implemented

English | [中文](2026-08-28-craftcode-native-menus.zh.md)

## Problem

The desktop shell needs native project and source-control actions without replacing the existing Web client or granting the renderer filesystem and process privileges. Project configuration, Gradle builds, and Git diagnostics also need a recoverable result surface rather than Electron-level failures.

## Decision

Electron owns four top-level Chinese menus and sends a closed action vocabulary through a sandboxed preload bridge. Windows and Linux use a frameless window with a 40px theme-aware Web menu bar: compact 14px labels, 10px horizontal button padding, 36px menu-button height, and 32px minimize, maximize/restore, and close controls. The topbar is the draggable title-bar region, while its controls opt out of dragging; Electron-native submenus remain underneath the Web entries. The bridge accepts only the four fixed menu ids and content-relative integer coordinates, and the main process validates the sender and window bounds before opening one. macOS retains its native window chrome and system application menu. The complete Electron application menu remains installed on every platform for native roles and accelerators.

Packaged Windows builds set `ai.deepseek.craftcode` before Electron readiness so installer shortcuts and taskbar grouping share an identity. Development runs leave the AppUserModelID unset because no installed shortcut owns that identity, allowing the window ICO to supply the taskbar button instead of a generic Shell fallback.

The main process validates project paths, runs Git directly, and bounds command output. On Windows, JAR export and Minecraft launch pass only the fixed `gradlew.bat` or `gradle` command and fixed arguments through `ComSpec`; other platforms spawn the available Gradle wrapper or global command directly. Project settings live in `.dsh/project.yaml`; the implementation writes a JSON-compatible YAML subset so it can be read without a second parser. JAR export uses native dialogs to select and copy a result after the build.

The project menu starts or stops the active mod project's development client. Electron parses complete bounded `tasks --all --console=plain` output and accepts exactly one unqualified `runClient` or `runGame` task; the same pure parser and candidate selector also serve `run_mc_check`. A canonical project path owns at most one client process. The main process keeps the menu label synchronized with the active project, retains bounded output for failed exits, terminates the complete Gradle/Java process tree after a five-second graceful deadline, and stops every owned client during application shutdown.

The renderer keeps the existing chat, plugin, API, workspace, and session composition. The `ui-desktop-menu` client plugin occupies the frame's single `shell.topbar` slot only for Web-presented desktop menus and its additive `shell.overlay` slot whenever Electron's preload bridge exists. It turns native menu and game-exit events into renderer-bound observables, invokes workspace/session services through injected callbacks, and presents controlled project, search, Git, and command-result dialogs with shared theme primitives. Ordinary command completion returns only through the invoke promise; a long-lived Minecraft process reports its later natural or failed exit through a dedicated event. When an agent is created, the agent-loop reads the project-local settings file on prompt assembly and adds the configured system prompt plus prerequisite paths as bounded reference guidance; it does not scan those paths.

Help actions use fixed HTTPS placeholder URLs until release links are supplied.

## Alternatives considered

**Replace the Web UI with a second Electron-specific client.** Rejected because it would fork chat, plugin, API, and workspace behavior that already runs through the Web profile.

**Expose Node or an unrestricted IPC command runner to the renderer.** Rejected because project and process authority belongs in the main process and the bridge needs a small auditable allowlist.

**Render the complete menu tree in Web content.** Rejected because native submenus preserve operating-system menu behavior, edit roles, and accelerators without duplicating their keyboard and focus mechanics in the renderer.

**Persist settings in a global user file.** Rejected because project prompts and prerequisite references must travel with the mod project and be applied consistently to sessions opened from that directory.

**Open an installed Minecraft launcher.** Rejected because it does not carry the current mod project's sources, mappings, run configuration, or development classpath; the declared Gradle client task is the project-owned launch contract.

## Consequences

Desktop actions are available only when the Web page is hosted by the Electron shell; ordinary browser tabs remain unchanged. Windows and Linux gain theme-consistent top-level controls while native submenu rows, macOS menus, directory dialogs, and JAR save dialogs retain operating-system styling. The desktop icon is packaged as a checked-in multi-size ICO generated from the canonical Web favicon. Command output is bounded and visible, while cancellation and missing-project errors remain recoverable. Game launch refuses missing, qualified, ambiguous, or truncated task evidence instead of guessing a Gradle target. The settings format is intentionally limited to the fields owned by this milestone, and release packaging, signing, updates, and installer work remain separate.
