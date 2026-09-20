import type { ArtifactEvidence } from './artifact.ts';
import type { Dependency } from './types.ts';
/**
 * Recover an interrupted replacement only if each target still matches one side of its journal.
 * @param directory - Isolated side-specific instance directory.
 */
export declare function recoverInstanceMods(directory: string): Promise<void>;
/**
 * Verify the complete selected dependency closure before replacing any managed JAR.
 * @param cwd - Absolute project root.
 * @param directory - Isolated side-specific instance directory.
 * @param artifact - Accepted publication and pinned loader identity.
 * @param dependencies - Committed dependency lock entries.
 * @param side - Requested local client or server.
 * @param selection - Required-only or currently enabled test dependencies.
 * @param java - Selected JVM executable or major required by this operation.
 */
export declare function syncInstanceMods(cwd: string, directory: string, artifact: ArtifactEvidence, dependencies: Dependency[], side: 'client' | 'server', selection: 'required' | 'selected', java: number): Promise<void>;
//# sourceMappingURL=instance-mods.d.ts.map