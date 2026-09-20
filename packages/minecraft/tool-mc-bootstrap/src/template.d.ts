/** Deterministic Fabric/NeoForge project template and mirror configuration. */
import type { CatalogEntry } from './types.ts';
/** Text files generated before the wrapper jar is downloaded. */
export declare function projectFiles(input: {
    readonly modName: string;
    readonly modId: string;
    readonly packageName: string;
    readonly entry: CatalogEntry;
}): Record<string, string>;
/** Gradle wrapper scripts are generated rather than copied from a mutable user tree. */
export declare function wrapperFiles(gradleVersion: string, checksum?: string): Record<string, string>;
//# sourceMappingURL=template.d.ts.map