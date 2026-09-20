import { describe, expect, it } from 'vitest'
import { gradleDistributionDownloadFailed, gradleFailureMessage } from '../src/gradle-failure.ts'

describe('bootstrap Gradle failure summary', () => {
  it('only switches the distribution source when the Wrapper download itself failed', () => {
    expect(gradleDistributionDownloadFailed('at org.gradle.wrapper.Install.forceFetch(SourceFile:2)')).toBe(true)
    expect(gradleDistributionDownloadFailed('at org.gradle.wrapper.Download.downloadInternal(Download.java:60)')).toBe(true)
    expect(gradleDistributionDownloadFailed('SSLHandshakeException\n at org.gradle.internal.resource.transport.http.HttpClientHelper.performRequest(HttpClientHelper.java:113)')).toBe(false)
    expect(gradleDistributionDownloadFailed('at org.gradle.wrapper.GradleWrapperMain.main(SourceFile:67)')).toBe(false)
  })

  it('explains handshake disconnects and distinguishes certificate errors', () => {
    expect(gradleFailureMessage('Caused by: javax.net.ssl.SSLHandshakeException: Remote host terminated the handshake', 1))
      .toBe('依赖下载的 TLS 连接被中断；检查代理或网络后重试')
    expect(gradleFailureMessage('PKIX path building failed', 1)).toContain('证书校验失败')
  })

  it('does not claim a missing plugin version is a transport failure', () => {
    expect(gradleFailureMessage("Plugin [id: 'net.neoforged.gradle.userdev', version: '7.1.38'] was not found", 1))
      .toBe('无法解析 Gradle 插件 net.neoforged.gradle.userdev:7.1.38；检查仓库连接与版本配置')
  })

  it('prioritizes compiler errors over earlier network output', () => {
    expect(gradleFailureMessage('Remote host terminated the handshake\nMod.java:4: error: Mod is already defined in this compilation unit\nCompilation failed', 1))
      .toBe('编译失败：Mod.java:4: error: Mod is already defined in this compilation unit')
  })

  it('keeps concrete Gradle reasons bounded and handles a missing diagnostic', () => {
    expect(gradleFailureMessage('* What went wrong:\nUnsupported class file major version 65\n* Try:', 1))
      .toBe('Gradle 构建失败：Unsupported class file major version 65')
    expect(gradleFailureMessage(`* What went wrong:\n${'x'.repeat(1000)}`, 1)).toHaveLength(400)
    expect(gradleFailureMessage('', 1)).toBe('Gradle 构建失败（退出码 1）')
  })
})
