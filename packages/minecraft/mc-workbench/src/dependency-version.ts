/** Version constraints declared by Fabric metadata or NeoForge Maven ranges. */
import { coerce, satisfies, validRange } from 'semver'

/**
 * Match a declared dependency version without selecting or upgrading a publication.
 * @param actual - Exact version reported by the installed JAR or runtime.
 * @param ranges - Alternative allowed constraints from loader metadata.
 * @returns Whether one supported constraint contains the actual version.
 */
export function matchesDependencyVersion(actual: string, ranges: string[]): boolean {
  return ranges.some((range) => {
    if (range === '*' || range === actual) return true
    if (range === `[${actual}]`) return true
    const maven = /^(\[|\()([^,]*),([^\])]*)(\]|\))$/u.exec(range)
    if (maven)
      range =
        `${maven[2] ? `${maven[1] === '[' ? '>=' : '>'}${maven[2]}` : ''} ${maven[3] ? `${maven[4] === ']' ? '<=' : '<'}${maven[3]}` : ''}`.trim()
    const version = coerce(actual)
    return !!version && !!validRange(range) && satisfies(version, range, { includePrerelease: true })
  })
}
