/** Streaming ZIP extraction with bounded entries and output; archive paths never choose an external destination. */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { projectPath } from "./files.js";
/**
 * Extract a verified ZIP to a new owned directory, rejecting links, path escapes and oversized output.
 * @param file - Verified archive path.
 * @param destination - Application-owned output path.
 * @param signal - Caller cancellation signal.
 * @param maxBytes - Maximum accepted output or response bytes.
 */
export async function extractZipFile(file, destination, signal, maxBytes = 1024 * 1024 * 1024) {
    await mkdir(destination, { recursive: true });
    const zip = await new Promise((accept, reject) => {
        yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (error, opened) => {
            if (error)
                reject(error);
            else
                accept(opened);
        });
    });
    let total = 0;
    let count = 0;
    try {
        await new Promise((accept, reject) => {
            const abort = () => {
                zip.close();
                reject(signal.reason instanceof Error ? signal.reason : new Error('解压已取消。'));
            };
            signal.addEventListener('abort', abort, { once: true });
            zip.once('end', () => {
                signal.removeEventListener('abort', abort);
                accept();
            });
            zip.once('error', (error) => {
                signal.removeEventListener('abort', abort);
                reject(error);
            });
            zip.on('entry', (entry) => {
                void (async () => {
                    signal.throwIfAborted();
                    total += entry.uncompressedSize;
                    const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
                    if (++count > 50_000 ||
                        total > maxBytes ||
                        unixType === 0xa000 ||
                        /(^[\\/]|^[a-z]:|(?:^|[\\/])\.\.(?:[\\/]|$))/iu.test(entry.fileName))
                        throw new Error('归档包含不安全路径或超过解压限制。');
                    const target = await projectPath(destination, entry.fileName, true);
                    if (entry.fileName.endsWith('/'))
                        await mkdir(target, { recursive: true });
                    else {
                        await mkdir(dirname(target), { recursive: true });
                        const stream = await new Promise((resolve, fail) => {
                            zip.openReadStream(entry, (error, value) => {
                                if (error)
                                    fail(error);
                                else
                                    resolve(value);
                            });
                        });
                        await pipeline(stream, createWriteStream(target, { flags: 'wx' }), { signal });
                    }
                    zip.readEntry();
                })().catch((error) => {
                    signal.removeEventListener('abort', abort);
                    zip.close();
                    reject(error instanceof Error ? error : new Error(String(error)));
                });
            });
            if (signal.aborted)
                abort();
            else
                zip.readEntry();
        });
    }
    finally {
        zip.close();
    }
}
//# sourceMappingURL=archive.js.map