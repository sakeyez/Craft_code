# Minecraft workbench host

English | [中文](README.zh.md)

The Minecraft workbench owns development processes, retained logs, dependency transactions and read-only dependency sources. The [workbench UI](../../client/ui-mcmod-workbench/README.md) consumes its loopback-only `/mc-workbench` RPC. It supports standard single-project Fabric and NeoForge Java workspaces in the existing Minecraft 1.20.1–1.21.x range.

## Environment and runs

The host discovers project facts through `tool-mc-project`, verifies the required Java major and uses the project's Gradle Wrapper. Preparation reuses an installed compatible JDK or downloads an official Adoptium release with SHA-256 verification. Java settings apply only to child processes. The New Mod wizard reuses this preparation capability.

Development operations run independently through the project Wrapper. Launch executes only the discovered client/server task and its Gradle dependencies; resource validation, test, build and datagen are separate checks. Preparation executes the selected client JavaExec task's actual dependencies, resolves its classpath and argument providers, and records verified inputs without executing the game task. Unsupported task types block preparation, not direct launch. Preparation does not prove offline launch or gameplay. The development offline option passes `--offline` to Gradle and refuses JDK downloads; it does not disconnect the OS or constrain arbitrary plugin/game network calls.

`.dsh/environment.json` records the Gradle User Home, verified JDK paths, build/environment fingerprint and discovered tasks. The New Mod builder records its cache location here, so later workbench operations reuse the same downloads. Build-input changes invalidate selections and task discovery without deleting caches. Missing pinned JDKs block execution. Existing Gradle daemon criteria and user-home Java properties take precedence. Preparation and builds reuse compatible daemons; runtime uses an owned single-use daemon so cancellation does not target shared daemons. A malformed Loom manifest can be replaced from a schema-validated local alternative with official metadata URLs; corrupt bytes are retained and locks are never removed.

One operation per project runs at a time. Snapshots and complete captured output live under `.dsh/runs/<id>/`; log cursors are UTF-8 byte offsets. Exit waits for output drain, cancellation terminates the process tree, and a restarted host labels old live operations interrupted. Raw files remain accessible after exit.

## Dependency transactions

Modrinth results are filtered by the detected game version and loader. Required published predecessors are recursively resolved and artifacts are hash-verified. Maven coordinates and local JARs expose actual archive metadata; unknown compatibility stays explicit. Required dependencies participate in compilation, development runtime and product metadata. Optional dependencies compile without requiring installation and have a test-install toggle. Test dependencies affect development runtime only.

A preview lists managed artifacts, dependency relations and every changed file. Applying checks original file revisions and journals Gradle, metadata and lockfile edits. Interrupted operations recover before subsequent reads; externally changed files block recovery. Removal only deletes unreferenced hash-named files owned by this service. Dynamic or unsupported Gradle layouts require manual assistance.

## Files and sources

Project file operations reject path escapes and symlink traversal. UTF-8 text editing is bounded to 2 MiB; saves check the read revision before replacing the disk file. A final external write racing the filesystem rename cannot be excluded without cooperation from that external writer.

Matching Maven source archives or explicitly associated archives take precedence over Vineflower 1.11.1. The engine download is pinned by SHA-256. Source caches identify the input artifact and source/engine hash, validate cached files before reuse, and remain read-only. Mapping names are not guessed or converted. Failed or cancelled decompilation does not publish a ready cache.

## Download and build network

The host stores `minecraft-network` preferences in the settings service: automatic (default), direct, or a custom HTTP/HTTPS proxy. `/mc-workbench` exposes `network-get`, `network-save`, and `network-check` without requiring an open project. Operations capture the settings at startup; changes clear the five-minute successful-route cache and apply to subsequent work.

Automatic downloads try explicitly mapped Chinese mirrors directly, then the official source through a detected proxy or directly. Electron resolves system proxies over its private child-process channel; other hosts use trusted process/user launch proxy values. TUN routing remains owned by the OS. Custom mode never switches to direct. Credentials, SOCKS and PAC URLs are rejected; HTTPS proxies work for Node downloads but Java requires an HTTP/mixed port and reports incompatibility explicitly.

Downloads have deadlines, cancellation, bounded retries (three per route), byte limits and publisher hash checks where provided. Verified downloads use atomic cache publication. JDK release metadata and checksums remain official. Gradle receives child-only JVM proxy properties and local bypass rules. Development execution retains project repositories and Loom endpoints; artifact installation and bootstrap may use an application-owned mirror init script. Fabric uses Loom's published mirror properties; NeoForge-specific downloads keep official endpoints. Arbitrary repository addresses and global Gradle settings are not rewritten. Network failures may retry against official sources, and automatic mode may then retry direct, within the original deadline; compilation errors and cancellation do not retry. Verified caches are retained without `--refresh-dependencies`.

## Artifact tests and evidence

Development mode uses discovered project tasks. Artifact mode builds, validates the unique publication from Gradle outputs and JAR metadata, and installs the exact Minecraft/loader versions through MIT-licensed `@xmcl/core@2.15.1` and `@xmcl/installer@6.1.2`. Verified game assets share a cache; client/server saves, configuration and mods live separately under `.dsh/instances`. Required dependencies, hashes, side constraints and incompatibilities are checked before journaled replacement of managed files. EULA acceptance is separate. Process start, world readiness and gameplay remain distinct; gameplay is unverified unless explicitly tested.

Run format 4 retains bounded steps, download progress, failure categories, retryability, mode and artifact evidence. Old records keep missing evidence unknown; client world-readiness timestamps from earlier formats are not trusted because advancement loading can occur before a world starts. Retry starts a fresh operation after checking project inputs and caches; restarting the host never launches a game. Gradle, compiler and game JVM selections carry separate reasons. Streaming downloads use incremental hashes, partial-file identity and Range validation; concurrent consumers share a transfer without sharing cancellation.

## Recovery, API and export

The `./tools` consumer registers `query_mc_api` and protects the first modifying or shell tool in each Minecraft turn with a complete checkpoint. Dependency commits create their own checkpoint. Content-addressed snapshots exclude credentials, Git internals, caches and instances, keep twenty automatic records, and retain manual records until deletion. Restore previews bind file differences to current revisions, save the current state and journal replacements; incomplete backups and external edits block protected operations.

API lookup verifies the last build's input and classpath hashes, reports exact version/namespace/provenance, and reuses matching sources or decompiler caches. Unknown or conflicting mappings and optional mappings.dev results stay unverified. PNG and bounded vanilla-model previews resolve local or verified exact-version vanilla resources; animation and custom rendering are unsupported. Drafts stay in the editor and generated resources remain read-only; text searches identify candidate generators.

CurseForge shares dependency previews and commits with Modrinth, Maven and local files. `CURSEFORGE_API_KEY` belongs to the credential service. Publisher project/file IDs and SHA-1 identify downloads; restricted files point to their source page and local import. Cross-source mod IDs are checked without name-based merging. Export revalidates source and artifact hashes and publishes the JAR, SHA-256 and a concise record with unknown runtime/gameplay evidence preserved.

## Model Experience

### Selected workbench evidence

#### What the model sees

The `/mc-workbench` RPC and logs do not append model context. Approved runtime checks use the existing run_mc_check tool through the mounted shell; its result identifies the retained log without inserting it. User-selected code, dependency facts and log excerpts enter through ordinary session messages from the UI.

#### Token effect

Only explicitly submitted excerpts and requested check results add tokens. Background polling adds none.

#### KV Cache effect

None for navigation, polling or log collection. Explicitly submitted excerpts extend the conversation prefix like other user messages.

## Known Limitations and Deferred Work

- Maven POM transitive resolution, arbitrary dynamic Gradle scripts and unknown mappings require manual assistance. Local artifact compatibility remains unverified where metadata cannot establish it. A vanilla client waiting at its title screen may remain running until world-load evidence appears. Automated browser and filesystem tests do not establish actual gameplay; real loader builds and approved launches provide separate evidence.
