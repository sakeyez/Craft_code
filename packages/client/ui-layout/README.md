# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: three-column AppFrame (drag handles and concession chain) plus the `ctx.layout` panel service and external-game companion controls; it registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `game`, `details`, and `shell.overlay`. The sidebar resize boundary is an invisible hit strip, while the details boundary retains its floating pill; only details shrinks during concession and then auto-closes. A closed sidebar retains a 56px control rail while details closes to zero width. The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document (`html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background). Measuring after palette and token application keeps the rendered background as the single color authority; disposing the presenter removes its metadata node with its other global writes.

AppFrame always mounts the conversation and details columns; a connected Session renders through `SessionProvider`. The transient layout store starts the sidebar at its default width and details closed, and it never reads or writes `localStorage`. Hero and other unselected states also derive a zero rendered details width without changing that stored preference. AppFrame retains the last non-blank Session id across those states: the first Session remains closed, an explicit details action opens the contract default width, returning to the same Session restores its unchanged width, and selecting a different Session closes details before paint. The conversation owner share is empty, while the sidebar owner share contains only `collapsed` and `width`; registrants obtain business data from standard hooks and actions from their own inject faces.

The same transient store keeps strict external-game states by normalized project path. The selected project's `game` slot adds companion controls for `starting`, `connected`, `failed`, `disconnected`, `reconnecting`, or `unsupported`. A connected game hides project menus, the sidebar, details, and blank-session project selectors while keeping the conversation mounted; disconnecting restores the ordinary layout. Events from another project cannot change the selected project's controls. On Windows the desktop host arranges Minecraft and the CraftCode companion side by side and follows game movement or resize; Linux and macOS keep the ordinary layout and explain that Minecraft runs externally. Clicking annotate creates a one-shot, borderless overlay at the Minecraft client bounds with a captured still frame; the overlay freezes only the visual surface, never suspends the Minecraft process, and disappears back to the side-by-side layout on completion or cancellation. The injected `ctx.layout` operations reconnect or reposition the companion and bracket annotation capture; the still frame exists only for the active annotation transaction, while session annotation events retain normalized geometry and descriptions. Existing annotation descriptions can be edited without a captured frame. A failed save displays the error and preserves the draft for retry.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, and the four owner-share interfaces. AppFrame, the panel store, and the concession solver remain package-internal.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and details closed; switching between distinct Session ids also closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel restores itself when the window widens; consumers must not read the stored details width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
- **External game tracking depends on the desktop host** — browser sessions never receive privileged game-window operations, and non-Windows desktop hosts keep the ordinary layout.
