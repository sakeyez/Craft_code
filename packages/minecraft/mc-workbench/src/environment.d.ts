/** Project-local Java selection and verified Adoptium installation. */
import type { Context } from '@deepseek-ai/cordis';
import type { JavaEnvironment } from './types.ts';
/**
 * Locate application-managed Minecraft caches without using the project tree.
 * @returns Locate application-managed Minecraft caches without using the project tree.
 */
export declare const cacheRoot: () => string;
/**
 * Select the supported Java major from an exact Minecraft release.
 * @param version - Exact supported Minecraft release.
 * @returns Select the supported Java major from an exact Minecraft release.
 */
export declare function requiredJava(version: string): 17 | 21;
/**
 * Verify the declared executable and adjacent compiler without changing global Java settings.
 * @param ctx - Host context with filesystem and managed subprocess services.
 * @param executable - Explicit Java executable to validate.
 * @param major - Required JDK major.
 * @param signal - Caller cancellation signal.
 * @param managed - Whether the executable belongs to application-managed storage.
 * @returns Verified JDK identity, or undefined when unavailable or incompatible.
 */
export declare function probe(ctx: Context, executable: string, major: number, signal: AbortSignal, managed: boolean): Promise<JavaEnvironment | undefined>;
/**
 * Locate an exact-major JDK; never change PATH or JAVA_HOME in the parent process.
 * @param ctx - Host context providing the required capabilities.
 * @param major - Required JDK major version.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @returns Locate an exact-major JDK without changing the parent environment.
 */
export declare function findJava(ctx: Context, major: number, signal?: AbortSignal): Promise<JavaEnvironment>;
/**
 * Download a verified JDK when none matches; cancellation leaves the previous installation intact.
 * @param ctx - Host context providing the required capabilities.
 * @param major - Required JDK major version.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @param progress - Awaited environment progress callback.
 * @returns Reuse a matching JDK or install a hash-verified official Adoptium release.
 * @param bytes - Archive content or incremental download progress callback.
 */
export declare function ensureJava(ctx: Context, major: number, signal: AbortSignal, progress: (text: string) => Promise<void>, bytes?: (received: number, total?: number) => void): Promise<JavaEnvironment>;
/**
 * Construct Java settings for the owned child process only.
 * @param java - Verified JDK identity used only for this child.
 * @returns Construct Java settings for the owned child process only.
 */
export declare function javaEnv(java: JavaEnvironment): NodeJS.ProcessEnv;
//# sourceMappingURL=environment.d.ts.map