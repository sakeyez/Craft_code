---
name: minecraft-environment-doctor
description: Use when the host's Minecraft project setup or a Gradle check fails because of Java, Gradle, dependency, cache, permission, or environment issues.
---
# Minecraft Environment Doctor
Diagnose the actual host setup or Gradle result. Classify Java availability/version, wrapper/dependency, cache, permission, template, and code failures. Reuse valid caches and environment settings; do not repeatedly guess versions or rewrite Gradle files without evidence.

The game-test page prepares the client runtime task dependencies without launching a game. Ordinary development launch runs only the discovered project runtime task; do not add test/build/datagen gates. Read the project environment record and compare Gradle User Home, Wrapper and JDK paths before diagnosing a cache miss. Preparation is not proof of offline completeness; verify an offline launch separately. It reuses a compatible JDK or downloads a hash-verified Adoptium JDK with child-process-only Java settings. Inspect the failed operation stage and retained log before retrying; preparation is not runtime evidence. User-approved startup checks share host run history while retaining the mounted shell policy. Account, audio, texture and window initialization are not world-readiness markers.

Distinguish Gradle JVM, compiler toolchain and game JVM from project evidence. Respect the pinned Wrapper and loader; a compilation error never justifies a mirror/version change. Do not delete another process's lock. Inspect the current run step and failure type before retrying. Artifact mode builds and validates the publication before syncing isolated client/server instances; missing required dependencies block readiness. A server EULA requires explicit acceptance. Interrupted runs stay stopped after restart.

Use query_mc_api after a current build for exact-version API evidence. Its namespace, source, cache flag and verification status must accompany conclusions; mappings.dev fallback is not proof of project compatibility. A failed automatic checkpoint blocks protected writes: resolve the concrete file or capacity error before continuing.
