# Agent Note: Host-owned Minecraft workbench

Status: implemented

English | [中文](2026-09-16-minecraft-workbench.zh.md)

## Problem

Minecraft development needs retained execution evidence and coherent dependency edits across Gradle, mod metadata and test installation. A desktop window handle alone cannot establish game readiness, and editor saves can overwrite concurrent assistant changes.

## Decision

The [workbench host](../../../../packages/minecraft/mc-workbench/README.md) owns project operations, journaled dependency edits, source provenance and revision-checked filesystem access. The [client plugin](../../../../packages/client/ui-mcmod-workbench/README.md) contributes slots and keeps drafts locally. Logs remain outside model context until a user submits an excerpt through the existing session-message path.

The [bootstrap decision](2026-09-14-minecraft-host-bootstrap.md) continues to own catalogs, staging and first-build publication; Java preparation is shared with the workbench. The [independent game-window decision](2026-09-14-independent-game-window-current-session-annotation.md) continues to own native window identification and annotations. These records remain active because neither mechanism is wholly superseded.

Project navigation shares the application-menu row so changing tools does not consume a second header. The layout owns menu, navigation and trailing-window-control slots; the desktop plugin owns the draggable remainder. Separate slots keep browser navigation independent of Electron and preserve mounted panel state.

The host network service captures settings per operation so proxy changes cannot split a running download/build across policies. Exact mirror mappings and publisher checksums preserve artifact identity; Java uses subprocess properties rather than global configuration. PAC/SOCKS and authenticated proxies are not silently converted. Network preferences stay outside model context.

Explicit client session navigation restores conversation even when the current session id stays unchanged. This preserves drafts and retained logs while allowing the topbar to contain only project tools.

Checkpoint capture fails closed before protected tools and dependency commits, because a partial backup cannot justify a safe restore. Content hashes deduplicate source state; journaled restoration checks revisions instead of resetting Git. Exact input and artifact hashes invalidate stale acceptance and export records. API lookups enter normal tool logs; background previews and polling do not enter model context.

The [independent development decision](../architecture/2026-09-20-independent-minecraft-development.md) owns the project environment, focused launch and preparation semantics. Network preferences are accessible through application settings.

## Alternatives considered

**Copy ModMind's implementation.** CraftCode uses AGPL-3.0-only and retains upstream MIT notices. ModMind workflows inform this independent implementation; no ModMind or PCL source is imported. Exact-version installation uses the pinned MIT XMCL packages rather than PCL code.

**Let each UI control own a process.** This loses logs and stop authority on navigation or reconnect. Host ownership makes operation state durable independently of window attachment.

**Overwrite files from an editor snapshot.** Revision checks preserve external and assistant changes and require a user to inspect a conflict before reloading.

## Consequences

Single-project adapters reject layouts they cannot edit reliably. Unknown compatibility and mappings remain explicit. Dependency and source caches are bounded and hash-identified. Java semantic editing remains outside the workbench. Independent local test instances share verified assets but isolate mutable game state by project and side.

Filesystem and transaction tests cover conflicts and recovery. The real application browser test exercises retained Unicode logs, local Monaco, navigation drafts and external-save refusal. These checks do not prove a Minecraft client or server launch; real Gradle builds and separately authorized runtime verification remain distinct evidence.
