/** Explicit Java selection evidence for a supported single-project build. */
export interface JavaSelection {
    gradle: number;
    compiler: number;
    game: number;
    gradleHome?: string;
    basis: {
        gradle: string;
        compiler: string;
        game: string;
    };
}
/**
 * Select supported JVM majors without changing a Wrapper, toolchain or global setting.
 * @param cwd - Absolute project root.
 * @param version - Exact Minecraft release.
 * @param gradleVersion - Pinned Wrapper version.
 * @param files - Detected project Gradle input paths.
 * @returns Separate JVM roles and their project evidence.
 */
export declare function selectJava(cwd: string, version: string, gradleVersion: string | undefined, files: string[]): Promise<JavaSelection>;
//# sourceMappingURL=java-selection.d.ts.map