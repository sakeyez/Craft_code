/** Runtime guards for Minecraft bootstrap inputs and cached wire records. */
/** Event name forwarded over the host event stream. */
export const BOOTSTRAP_PROGRESS_EVENT = 'minecraft-bootstrap/progress';
const JAVA_RESERVED_WORDS = new Set([
    '_', 'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
    'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
    'extends', 'false', 'final', 'finally', 'float', 'for', 'goto', 'if',
    'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
    'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short',
    'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw',
    'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while',
]);
/** Return the JDK required by a supported Minecraft version. */
export function jdkForMinecraft(version) {
    // Fabric names the first 1.21 release `1.21` (there is no `.0` suffix),
    // while later releases use `1.21.x`. The 1.20 line always carries a patch
    // component and starts at 1.20.1 for this product.
    const match = /^1\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/u.exec(version.trim());
    if (match === null)
        return undefined;
    const minor = Number(match[1]);
    const patch = match[2] === undefined ? undefined : Number(match[2]);
    if (minor === 21 && (patch === undefined || patch >= 0))
        return 21;
    if (patch === undefined)
        return undefined;
    if (minor === 20 && patch >= 1 && patch <= 4)
        return 17;
    if (minor === 20 && patch >= 5)
        return 21;
    return undefined;
}
/** Stable Minecraft versions visible in v1 (1.20.1 through stable 1.21.x). */
export function isSupportedMinecraftVersion(version) {
    const normalized = version.trim();
    return jdkForMinecraft(normalized) !== undefined
        && (/^1\.20\.\d+$/u.test(normalized) || /^1\.21(?:\.\d+)?$/u.test(normalized));
}
/** Reject prereleases and the accidental 26.x API family. */
export function isStableMinecraftVersion(version, stable = true) {
    return stable && isSupportedMinecraftVersion(version) && !version.startsWith('26.');
}
/**
 * Return whether a Minecraft line has an official NeoForge MDK in v1.
 *
 * NeoForge's published lines do not include 1.20.1.  Keep this policy in one
 * guard so Maven rows, GitHub MDK names, cache records, and RPC entries cannot
 * drift into presenting an inferred 1.20.1 target.
 */
export function isSupportedNeoForgeMinecraftVersion(version) {
    const normalized = version.trim();
    return normalized !== '1.20.1' && isStableMinecraftVersion(normalized);
}
/** Canonical, collision-resistant catalog id. */
export function catalogEntryId(loader, minecraftVersion, loaderVersion) {
    return `${loader}:${minecraftVersion}:${loaderVersion}`;
}
/** Safe model/package identifier. */
export function isValidModId(value) {
    return /^[a-z][a-z0-9_]{0,63}$/u.test(value);
}
/** Conservative Java package syntax accepted by the generated template. */
export function isValidPackageName(value) {
    const segments = value.split('.');
    return segments.length >= 2
        && segments.every(segment => /^[a-zA-Z][a-zA-Z0-9_]*$/u.test(segment)
            && !JAVA_RESERVED_WORDS.has(segment)
            && !['java', 'javax', 'sun'].includes(segment));
}
/** Human-facing name bound to a small, deterministic input. */
export function isValidModName(value) {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(trimmed);
}
/** Directory names are a single non-special path component. */
export function isValidDirectoryName(value) {
    return value.length > 0 && value.length <= 96
        && value !== '.' && value !== '..'
        && !/[\\/\u0000]/u.test(value)
        && !/[<>:"|?*]/u.test(value)
        && !/[ .]$/u.test(value)
        && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(value);
}
/** Derive the default final directory name from a mod id/name. */
export function deriveDirectoryName(modName, modId) {
    const ascii = modName.trim().normalize('NFKD')
        .replace(/[^a-zA-Z0-9._-]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 80);
    const candidate = ascii || modId;
    return isValidDirectoryName(candidate) ? candidate : modId;
}
/** Type guard for the small RPC payload objects. */
export function recordPayload(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    return value;
}
/** Hexadecimal SHA-256 values accepted at the catalog/download boundary. */
export function isSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/iu.test(value);
}
/** Defensive runtime check for cached or remotely parsed catalog entries. */
export function isCatalogEntry(value) {
    const row = recordPayload(value);
    if (row === undefined || (row.loader !== 'fabric' && row.loader !== 'neoforge'))
        return false;
    const minecraftVersion = row.minecraftVersion;
    const loaderVersion = row.loaderVersion;
    const mappingsVersion = row.mappingsVersion;
    const apiVersion = row.apiVersion;
    const pluginVersion = row.pluginVersion;
    const gradleVersion = row.gradleVersion;
    if (typeof row.entryId !== 'string' || typeof minecraftVersion !== 'string'
        || typeof loaderVersion !== 'string' || typeof mappingsVersion !== 'string'
        || typeof apiVersion !== 'string' || typeof pluginVersion !== 'string'
        || typeof gradleVersion !== 'string')
        return false;
    if (!isSupportedMinecraftVersion(minecraftVersion) || !/^\d+(?:\.\d+){1,3}$/u.test(loaderVersion))
        return false;
    if (row.loader === 'neoforge' && !isSupportedNeoForgeMinecraftVersion(minecraftVersion))
        return false;
    if (!/^\d+(?:\.\d+){1,3}$/u.test(pluginVersion) || !/^\d+(?:\.\d+){1,3}$/u.test(gradleVersion))
        return false;
    if (row.loader === 'fabric') {
        if (mappingsVersion !== `${minecraftVersion}+build.${mappingsVersion.split('+build.')[1] ?? ''}`
            || !/^\d+(?:\.\d+){1,3}\+1\.2[01](?:\.\d+)?$/u.test(apiVersion))
            return false;
    }
    else if (mappingsVersion !== 'official' || apiVersion !== 'neoforge')
        return false;
    if (row.requiredJdk !== 17 && row.requiredJdk !== 21 || row.stable !== true)
        return false;
    if (row.requiredJdk !== jdkForMinecraft(minecraftVersion))
        return false;
    if (row.entryId !== catalogEntryId(row.loader, minecraftVersion, loaderVersion))
        return false;
    if (!isSha256(row.gradleSha256) || !isSha256(row.wrapperSha256))
        return false;
    return true;
}
//# sourceMappingURL=validation.js.map