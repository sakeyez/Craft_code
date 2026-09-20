# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: three-column AppFrame (drag handles and concession chain) plus the `ctx.layout` panel service and external-game status/annotation entry. It registers into the runtime-owned `root` slot and declares the column, topbar, workbench and overlay slots.

AppFrame always mounts the conversation and details columns. The transient layout store owns only renderer geometry; it does not read or write `localStorage`. The top bar, sidebar, details, conversation, model picker, and composer remain mounted and interactive when Minecraft connects.

The selected project's `game` slot shows the game name, connection state, passive errors, and one annotation entry. Minecraft remains an independent top-level window on every desktop host; the host never repositions, resizes, hides, maximizes, or retunes CraftCode in response to game movement or minimize/restore. Clicking annotate creates a one-shot borderless overlay with a captured still frame. The overlay freezes only the visual surface and never suspends Minecraft.

At commit time the layout resolves the current session, so switching sessions during annotation is supported. An invalid, unsaved, or conflicting target returns an error and leaves the overlay and draft open; success closes and resets the transaction. The shortcut and page button share one operation, while stale operation ids and window-identity checks prevent late messages from affecting a newer transaction.

The game slot contains no chat, reposition, or reconnect controls. Saved annotations belong to the conversation that is current when completion is submitted. Native HWND and capture permissions remain main-process-only.

The layout consumes explicit client session navigation to select the target project’s conversation view, including reopening the current session. Workbench panels remain mounted so drafts and log positions survive. Background execution remains host-owned.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and details closed; switching between distinct Session ids closes details before paint.
- **External game tracking depends on the desktop host** — browser sessions never receive privileged game-window operations, and non-Windows hosts keep Minecraft external.

The topbar renders `shell.topbar`, `workbench.nav` and `shell.window-controls` in one row; absent entries take no space. Window hosts own their trailing drag region and controls. The layout declares project navigation and panel slots for the [Minecraft workbench](../ui-mcmod-workbench/README.md). Project view selection retains the conversation subtree while tools are visible.
