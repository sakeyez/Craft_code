import type { ArtifactEvidence } from './artifact.ts';
import type { ProcessRunner } from './process.ts';
/** Side-specific instance state never shares saves, configs, mods or logs. */
export interface PreparedInstance {
    directory: string;
    relative: string;
    version: string;
    argv: string[];
}
/**
 * Install an exact validated build target using the existing operation's cancellation and process owner.
 * @param cwd - Absolute project root.
 * @param artifact - Accepted publication and pinned loader identity.
 * @param side - Requested local client or server.
 * @param java - Selected JVM executable or major required by this operation.
 * @param controller - Owning lifecycle cancellation controller.
 * @param runner - Mounted process runner preserving the host shell policy.
 * @param output - Awaited retained-log sink.
 * @param progress - Incremental received and total bytes callback.
 * @returns Isolated directory and exact Java launch arguments.
 */
export declare function prepareInstance(cwd: string, artifact: ArtifactEvidence, side: 'client' | 'server', java: string, controller: AbortController, runner: ProcessRunner, output: (text: string) => Promise<void>, progress: (received: number, total?: number) => void): Promise<PreparedInstance>;
//# sourceMappingURL=instances.d.ts.map