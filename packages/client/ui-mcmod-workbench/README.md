# Minecraft workbench UI

English | [中文](README.zh.md)

This plugin contributes code, dependencies and game-test navigation beside application menus. Opening any sidebar session, including the current one, returns to conversation. The test page retains the log console. Minecraft download settings live in application settings. Development controls work without an IDE connection. Narrow windows scroll navigation horizontally. The host owns operations; the client retains drafts, documents and log cursors across navigation.

## Interaction

The game-test page is available before launch. It shows detected environment facts, preparation/build/client/server controls, stop and retained run history. Logs support searching, error filtering, follow control, copying, export and opening the original file. Log content reaches the assistant only through the explicit send action.

Dependencies offer Modrinth search, Maven coordinates and local JAR imports. Changes require a file preview. Each dependency exposes source browsing and an ordinary session-message handoff for integration work.

The code page loads locally packaged Monaco on demand in a same-origin frame. It provides a file tree, document tabs, text search, disk/HEAD diffs and revision-checked saves. Read-only source tabs cannot save. Explain, modify and diagnose actions include the file path, selected line range, actual text and draft provenance.

Artifact/development selection stays in Game Tests; status shows the current step with details folded away. PNG/model previews and exact-version API search stay in Code. Checkpoints and export use the project menu, and CurseForge uses the existing dependency source selector. Recovery previews show current/target text when bounded text is available. About links the application license, third-party notices and source repository; generated mods choose their own license.

## Model Experience

### Selected workbench evidence

#### What the model sees

None for page navigation and editing. Explicit handoffs call `session.prompt` to append ordinary user messages containing selected evidence and current project facts; background logs are excluded.

#### Token effect

Only explicitly submitted excerpts and requested check results add tokens. Background polling adds none.

#### KV Cache effect

Only submitted messages change the conversation prefix. Monaco, source browsing and retained logs do not alter provider requests.

## Known Limitations and Deferred Work

- Drafts survive page/project switches within the current application instance. Java semantic completion, breakpoints, binary editing and editable decompiled projects are outside this editor. Large files use external tools. Source mapping uncertainty follows the host's provenance rather than inferred names.
