import { networkFetch } from "./network.js";
/** Bounded HTTPS downloads and archive extraction into application-owned directories. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { hash, projectPath } from "./files.js";
import { downloadArtifact } from "./transfer.js";
/**
 * Download and parse bounded JSON from an HTTPS publication endpoint.
 * @param url - HTTPS publication URL without embedded credentials.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @returns Download and parse bounded JSON from an HTTPS publication endpoint.
 */
export async function fetchJson(url, signal) {
    const bytes = await download(url, signal, 8 * 1024 * 1024);
    return JSON.parse(bytes.toString('utf8'));
}
/**
 * Download a bounded HTTPS response with cancellation and a request deadline.
 * @param url - HTTPS publication URL without embedded credentials.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @param maxBytes - Maximum accepted complete response or uncompressed size in bytes.
 * @param sha256 - Optional publisher digest checked before accepting a source.
 * @returns Download a bounded HTTPS response with cancellation and a request deadline.
 */
export async function download(url, signal, maxBytes = 256 * 1024 * 1024, sha256) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
        throw new Error('下载地址必须是无凭据的 HTTPS 地址。');
    const response = await networkFetch(parsed.href, {
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15 * 60_000)]),
        headers: { 'User-Agent': 'CraftCode/0.1 (Minecraft development workbench)' },
    }, maxBytes, sha256);
    if (!response.ok || !response.body)
        throw new Error(`下载失败：HTTP ${response.status} (${parsed.hostname})`);
    if (Number(response.headers.get('content-length')) > maxBytes)
        throw new Error('下载超过大小限制。');
    return Buffer.from(await response.arrayBuffer());
}
/**
 * Read selected ZIP entries with an aggregate uncompressed-byte limit.
 * @param bytes - Archive or text bytes to inspect.
 * @param maxBytes - Maximum accepted complete response or uncompressed size in bytes.
 * @returns Read selected ZIP entries with an aggregate uncompressed-byte limit.
 */
export function zipEntries(bytes, maxBytes = 128 * 1024 * 1024) {
    let total = 0;
    let count = 0;
    return unzipSync(bytes, {
        filter: (entry) => {
            total += entry.originalSize;
            count++;
            if (count > 50_000 ||
                total > maxBytes ||
                entry.name.split(/[\\/]/u).includes('..') ||
                /^[\\/]|^[A-Za-z]:/u.test(entry.name))
                throw new Error('归档包含不安全路径或超过解压限制。');
            return true;
        },
    });
}
/**
 * Extract bounded safe ZIP entries into an application-owned directory.
 * @param bytes - Archive or text bytes to inspect.
 * @param destination - Application-owned extraction directory.
 * @param maxBytes - Maximum accepted complete response or uncompressed size in bytes.
 */
export async function extractZip(bytes, destination, maxBytes) {
    await mkdir(destination, { recursive: true });
    for (const [name, content] of Object.entries(zipEntries(bytes, maxBytes))) {
        const target = await projectPath(destination, name, true);
        if (name.endsWith('/')) {
            await mkdir(target, { recursive: true });
            continue;
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, { flag: 'wx' });
    }
}
/**
 * Reuse only verified cache files; the supplied hash comes from the publisher manifest.
 * @param directory - Application-owned cache directory.
 * @param url - HTTPS publication URL without embedded credentials.
 * @param sha256 - Expected publisher SHA-256 digest.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @returns Reuse only verified cache files; the supplied hash comes from the publisher manifest.
 */
export async function cachedDownload(directory, url, sha256, signal) {
    if (!/^[a-f\d]{64}$/iu.test(sha256))
        throw new Error('发布方未提供有效 SHA-256。');
    const path = join(directory, sha256.toLowerCase());
    const prior = await readFile(path).catch(() => undefined);
    if (prior && hash(prior) === sha256.toLowerCase())
        return prior;
    await downloadArtifact({
        url,
        destination: path,
        digest: { algorithm: 'sha256', value: sha256 },
        maxBytes: 512 * 1024 * 1024,
        ...(signal ? { signal } : {}),
    });
    return readFile(path);
}
//# sourceMappingURL=download.js.map