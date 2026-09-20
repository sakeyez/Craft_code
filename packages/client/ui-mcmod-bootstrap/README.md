# @deepseek-ai/dsh-client-ui-mcmod-bootstrap

English | [中文](README.zh.md)

This package is the browser half of the Minecraft New Mod wizard. It replaces the mcmod sidebar primary action with the project-add icon, a 10px rounded button, and the `New Mod`/`Create a mod` labels, while contributing the same frame overlay to Electron and loopback web previews.

## Wizard behavior

- Opening the wizard refreshes the online/cache catalog and shows the selected entry’s required JDK and cache age; an empty online result with no cache disables creation and offers catalog retry.
- The form starts with Fabric and the highest available stable entry for that loader, asks for a mod name, parent save directory, and project directory, and derives a safe lowercase `modId` and `com.example.<modId>` package until the user edits them.
- The collapsed Advanced options section exposes `modId` and Java package overrides; the browser validates names, Java reserved words, path segments, and the selected catalog id before sending the request.
- `Create and build` sends only the catalog entry id and user fields to `/mc-bootstrap`; queued/running snapshots render Java, generation, wrapper, dependency, build, and finalize phases, disable duplicate submission and ordinary close, and leave an explicit Cancel action.
- Escape and the close control dismiss an idle wizard, and focus returns to the primary action; while work is active Escape and close are ignored so cancellation is deliberate and observable.
- Failed or cancelled operations keep the modal and host-provided log tail, offer retry and open-directory actions, and leave the marked staging tree for inspection; a workspace-registration failure retries registration without rebuilding.

## Host handoff

The dynamic web plugin polls `status` and accepts `minecraft-bootstrap/progress` snapshots only for its current operation, so reconnecting or unrelated host events cannot create a session. After a `ready` snapshot it calls `workspaces.create({ path })`, then `workspaces.startSession(workspaceId)`; no workspace session or model request is created before the host reports a successful first build. The host contract and trust boundary are documented in [`dsh-tool-mc-bootstrap`](../../minecraft/tool-mc-bootstrap/README.md).

The package’s node entry is an empty loader companion; all filesystem, dependency, URL, and Gradle-process authority remains in the host package. The sidebar contract is declared by [`dsh-client-ui-sidebar`](../ui-sidebar/README.md), so deployments without this package retain the generic New Session fallback and the brand-logo shortcut.

Version selection is a grouped dropdown (1.21.x, then 1.20.x) without a search field. Switching loaders retains a compatible game version, otherwise selects the highest supported stable version. Cached entries are selectable during refresh; a valid selection survives catalog updates. Inputs use one outer border and focus ring. Errors remain in the wizard alongside its retry and directory actions.

## Model Experience

None, as the browser wizard registers no model context or session before the host build succeeds.

#### KV Cache effect

None; this package does not assemble or send provider requests.

## Known Limitations and Deferred Work

- **Host prerequisites remain explicit** — the host reuses compatible JDKs or prepares a verified Adoptium release; network settings and child Java configuration do not modify global Gradle settings.
- **Build evidence is host-local** — the browser receives at most a 32 KiB UTF-8 log tail, while the complete `.dsh/bootstrap.log` stays with the staging tree or its atomically committed project.
- **Loader scope is intentionally narrow** — only Fabric Java and NeoForge Java catalog entries are offered; other loaders, Kotlin, datagen, and gameplay/runtime emulation are outside this wizard.
