# dsh-tool-mc-bootstrap

English | [中文](README.zh.md)

This package is a host-only deterministic service used by the Minecraft “New Mod” wizard; it registers no model-facing tool or prompt and keeps filesystem, network, and process authority out of browser and model code.

## RPC contract

The host mounts the service after both `connection` and `subprocess` are injected, so shared Java preparation can resolve and probe the JDK. It registers one `loopback` Connection channel at `/mc-bootstrap`; LAN clients cannot reach it, and the channel accepts the endpoints below.

| Endpoint | Request | Result |
|---|---|---|
| `catalog-cache` | `{}` | Cached `CatalogSnapshot` or `null`, without network work |
| `catalog` | `{}` | `CatalogSnapshot` with entries, cache provenance, and the detected Java |
| `start` | `entryId`, `parentDirectory`, `directoryName`, `modName`, `modId`, and `packageName` | An `operationId`, returned before catalog refresh and build work begins |
| `status` | `operationId` | The complete reconnectable `OperationSnapshot` |
| `cancel` | `operationId` | Whether cancellation was accepted and the latest snapshot |

The browser submits only a catalog entry id and user fields; dependency versions, repository URLs, commands, and generated paths are selected and validated by the host.

Each operation snapshot is also emitted as `minecraft-bootstrap/progress`; clients call `status` after reconnecting because event delivery is best effort. Snapshot statuses are `queued`, `running`, `ready`, `failed`, or `cancelled`, and `logTail` is capped at 32 KiB.

The first build records its Gradle User Home and verified JDK in the [project environment](../mc-workbench/README.md#environment-and-runs), allowing later preparation, build and runtime operations to reuse the same cache. Failure is published only after log cleanup, so an immediate retry cannot race that cleanup.

## Catalog

- The catalog offers stable Fabric Java and NeoForge Java combinations from Minecraft `1.20.1` through stable `1.21.x` and excludes the `26.x` family; NeoForge is never inferred for `1.20.1` when no official publication exists.
- Required Java is fixed by the game line: JDK 17 for `1.20.1`–`1.20.4`, and JDK 21 for `1.20.5`–`1.21.x`; the exact runtime is checked before any staging file is written.
- Fabric game and Yarn data try BMCLAPI before Fabric Meta, while Fabric API metadata tries Aliyun Maven before the Fabric repository; malformed, empty, or failed mirror responses fall back to the authoritative source.
- NeoForge first reads official Maven metadata or its directory index, then uses the official [NeoForgeMDKs organization](https://github.com/NeoForgeMDKs) when Maven is unavailable. Each candidate is admitted only after the host reads the official MDK’s `build.gradle`, wrapper properties, `gradle.properties`, and metadata, confirms the pinned `net.neoforged.gradle.userdev` and supported Gradle recipe, matches `neo_version` to the game line, and (when Maven data exists) confirms that loader publication; ModDevGradle and incomplete recipes are excluded.
- Online refresh has a 45-second overall budget and each request is bounded to 20 seconds. Successful loader families replace only their own cached entries; failed families retain their entries. Partial merges keep the older freshness bound. A cache older than 24 hours is marked stale. `catalog-cache` exposes usable entries immediately while refresh proceeds.
- Every `CatalogEntry` carries the resolved loader, mappings, API, plugin, Gradle version, required JDK, and official SHA-256 values for both the Gradle distribution and wrapper JAR; malformed or incomplete cached entries are ignored.

## Build and recovery

- The service validates absolute, non-symlink parent paths and safe identifiers, rejects existing or non-empty targets, and writes beside the target in an operation-marked staging directory containing `.dsh/bootstrap-state.json`; only a successful first build atomically renames staging to the final directory.
- Generated Gradle settings and projects use Tencent’s Gradle mirror first, Aliyun Maven mirrors next, and the loader’s official repository plus Maven Central as fallback; Fabric also includes BMCLAPI’s Maven mirror. The wrapper starts from Tencent’s distribution URL, carries the official `distributionSha256Sum`, and the downloaded wrapper JAR must match its catalog `wrapperSha256` before use or cache insertion.
- Download and Java/Gradle transport policy is owned by the [workbench network service](../mc-workbench/README.md). The first build retains its 30-minute deadline across network-only retries and preserves verified caches. TLS peer disconnects qualify for the bounded retry; a missing plugin alone does not. Failed operations show the captured cause instead of only an exit code.
- The child process is spawned with an argument array and `shell: false`. Cancellation terminates the entire process tree, waits for termination and pending log writes to drain, and keeps the operation busy until cleanup completes; the marked staging tree, state marker, and full `.dsh/bootstrap.log` remain available for inspection.
- A retry resumes only when every generated file still matches the recorded SHA-256 set and current template. An untouched older template is retained and a fresh staging tree is generated; user modifications, symlinks, path escapes, or concurrent operations fail closed and never overwrite player files. RPC log tails are capped at 32 KiB while the disk log remains complete.
- NeoForge staging accepts NeoGradle's `runs/junit/junit_jvm_args.txt` and `junit_test_args.txt` build outputs. Other files under `runs/` remain rejected, and accepted paths cannot be symlinks.

## Model Experience

None, as this host service exposes only a loopback RPC and registers no model-facing tool or prompt.

#### KV Cache effect

None; the service runs before a model session is created and does not assemble provider requests.

## Known Limitations and Deferred Work

- **Host prerequisites remain explicit** — the assembled host reuses compatible JDKs or prepares a verified Adoptium JDK through the [workbench environment service](../mc-workbench/README.md#environment-and-runs); child-only Java settings do not edit global Gradle settings.
- **Initialization scope is narrow** — only Fabric Java and NeoForge Java are generated; Forge, Quilt, Architectury, multi-loader, Kotlin, datagen, and runtime/gameplay emulation are outside this service.
- **Catalog and build evidence are bounded at the wire** — no online result or cache disables creation, while a stale or partial catalog is surfaced with its provenance and error for the wizard to explain.
