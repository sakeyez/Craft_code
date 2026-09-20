/**
 * Summarize captured Gradle diagnostics without treating missing coordinates as a network error.
 * @param output - Bounded process output containing the failure.
 * @param code - Process exit code, or null after signal termination.
 * @returns A concise cause for the failed operation.
 */
export function gradleFailureMessage(output, code) {
    const compilation = /Compilation failed|\bcompile(?:Java|Kotlin) FAILED|\berror: (?:cannot find symbol|incompatible types)/iu.test(output);
    if (!compilation) {
        if (/Remote host terminated the handshake|SSL peer shut down incorrectly/iu.test(output)) {
            return '依赖下载的 TLS 连接被中断；检查代理或网络后重试';
        }
        if (/PKIX path building failed/iu.test(output))
            return '依赖仓库证书校验失败；检查代理证书配置';
        if (/UnknownHostException/iu.test(output))
            return '依赖仓库域名解析失败；检查网络后重试';
        if (/Connection (?:timed out|reset|refused)|SocketTimeoutException|Read timed out/iu.test(output)) {
            return '依赖下载连接失败或超时；检查代理或网络后重试';
        }
        const plugin = /Plugin \[id: '([^'\r\n]+)', version: '([^'\r\n]+)'\] was not found/u.exec(output);
        if (plugin !== null)
            return `无法解析 Gradle 插件 ${plugin[1]}:${plugin[2]}；检查仓库连接与版本配置`.slice(0, 400);
    }
    const compilerError = output.match(/[^\r\n]*\berror: [^\r\n]+/u)?.[0]?.trim();
    if (compilation && compilerError !== undefined)
        return `编译失败：${compilerError}`.slice(0, 400);
    const reason = output.match(/\* What went wrong:\s*([^\r\n]+)/u)?.[1]?.trim();
    return reason === undefined
        ? `Gradle 构建失败（退出码 ${String(code)}）`
        : `Gradle 构建失败：${reason}`.slice(0, 400);
}
/**
 * Identify a failed distribution transfer before Gradle has started.
 * @param output - Captured Wrapper failure stack.
 * @returns Whether retry needs to change the Wrapper distribution source.
 */
export function gradleDistributionDownloadFailed(output) {
    return /at org\.gradle\.wrapper\.(?:Install|Download)[.$]/u.test(output);
}
//# sourceMappingURL=gradle-failure.js.map