/**
 * Match a declared dependency version without selecting or upgrading a publication.
 * @param actual - Exact version reported by the installed JAR or runtime.
 * @param ranges - Alternative allowed constraints from loader metadata.
 * @returns Whether one supported constraint contains the actual version.
 */
export declare function matchesDependencyVersion(actual: string, ranges: string[]): boolean;
//# sourceMappingURL=dependency-version.d.ts.map