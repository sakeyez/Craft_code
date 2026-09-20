/** Deterministic Fabric/NeoForge project template and mirror configuration. */

import type { CatalogEntry } from './types.ts'

/** Text files generated before the wrapper jar is downloaded. */
export function projectFiles(input: {
  readonly modName: string
  readonly modId: string
  readonly packageName: string
  readonly entry: CatalogEntry
}): Record<string, string> {
  const { entry, modName, modId, packageName } = input
  const packagePath = packageName.replaceAll('.', '/')
  const mirrorRepositories = [
    'https://maven.aliyun.com/repository/gradle-plugin',
    'https://maven.aliyun.com/repository/public',
    'https://maven.aliyun.com/repository/central',
    ...(entry.loader === 'fabric' ? ['https://bmclapi2.bangbang93.com/maven'] : []),
  ]
  const officialRepository = entry.loader === 'fabric'
    ? 'https://maven.fabricmc.net/'
    : 'https://maven.neoforged.net/releases'
  const mirrorRepositoryLines = mirrorRepositories.map(url => `        maven { url = uri("${url}") }`).join('\n')
  const repositoryLines = [
    '    if (System.getProperty("dsh.bootstrap.officialOnly") != "true") {',
    mirrorRepositoryLines,
    '    }',
    `    maven { url = uri("${officialRepository}") }`,
    '    mavenCentral()',
  ].join('\n')
  const fabricPluginId = entry.requiredJdk === 17 ? 'fabric-loom' : 'net.fabricmc.fabric-loom-remap'
  const neoForgeLegacyMetadata = entry.minecraftVersion === '1.20.2' || entry.minecraftVersion === '1.20.4'
  const minecraftParts = entry.minecraftVersion.split('.').map(Number)
  const neoForgeMetadataWithoutLoader = minecraftParts[1] === 21 && (minecraftParts[2] ?? 0) >= 5
  const neoForgeMetadataFile = neoForgeLegacyMetadata ? 'mods.toml' : 'neoforge.mods.toml'
  const neoForgeVersionLine = entry.loaderVersion.split('.').slice(0, 2).join('.')
  const gradle = entry.loader === 'fabric'
    ? [
      'plugins {',
      `    id "${fabricPluginId}" version "${entry.pluginVersion}"`,
      '    id "maven-publish"',
      '}',
      'version = "1.0.0"',
      `group = "${packageName}"`,
      'base { archivesName = "' + modId + '" }',
      'repositories {',
      repositoryLines,
      '}',
      'dependencies {',
      `    minecraft "com.mojang:minecraft:${entry.minecraftVersion}"`,
      `    mappings "net.fabricmc:yarn:${entry.mappingsVersion}:v2"`,
      `    modImplementation "net.fabricmc:fabric-loader:${entry.loaderVersion}"`,
      `    modImplementation "net.fabricmc.fabric-api:fabric-api:${entry.apiVersion}"`,
      '}',
      `java.toolchain.languageVersion = JavaLanguageVersion.of(${String(entry.requiredJdk)})`,
      'java { withSourcesJar() }',
      'tasks.withType(JavaCompile).configureEach { options.encoding = "UTF-8" }',
      '',
    ].join('\n')
    : [
      'plugins {',
      '    id "java-library"',
      '    id "maven-publish"',
      `    id "net.neoforged.gradle.userdev" version "${entry.pluginVersion}"`,
      '}',
      'version = "1.0.0"',
      `group = "${packageName}"`,
      'base { archivesName = "' + modId + '" }',
      'repositories {',
      repositoryLines,
      '}',
      `java.toolchain.languageVersion = JavaLanguageVersion.of(${String(entry.requiredJdk)})`,
      'dependencies {',
      `    implementation "net.neoforged:neoforge:${entry.loaderVersion}"`,
      '}',
      'tasks.withType(JavaCompile).configureEach { options.encoding = "UTF-8" }',
      '',
    ].join('\n')
  const metadata = entry.loader === 'fabric'
    ? `${JSON.stringify({
      schemaVersion: 1,
      id: modId,
      version: '1.0.0',
      name: modName,
      description: 'A CraftCode Minecraft mod',
      environment: '*',
      entrypoints: { main: [`${packageName}.Mod`] },
      depends: {
        fabricloader: `>=${entry.loaderVersion}`,
        minecraft: entry.minecraftVersion,
        java: `>=${entry.requiredJdk}`,
        'fabric-api': '*',
      },
    }, null, 2)}\n`
    : [
      ...(neoForgeMetadataWithoutLoader ? [] : [
        'modLoader="javafml"',
        // NeoForge's earlier MDKs expose a broad loader range and pin the
        // actual NeoForge artifact in Gradle. The field was removed in 1.21.5.
        'loaderVersion="[1,)"',
      ]),
      'license="MIT"',
      '[[mods]]',
      `modId="${tomlString(modId)}"`,
      'version="1.0.0"',
      `displayName="${tomlString(modName)}"`,
      'description="A CraftCode Minecraft mod"',
      `[[dependencies.${modId}]]`,
      'modId="neoforge"',
      ...(entry.minecraftVersion === '1.20.2' ? ['mandatory=true'] : ['type="required"']),
      `versionRange="[${tomlString(neoForgeVersionLine)},)"`,
      'ordering="NONE"',
      'side="BOTH"',
      `[[dependencies.${modId}]]`,
      'modId="minecraft"',
      ...(entry.minecraftVersion === '1.20.2' ? ['mandatory=true'] : ['type="required"']),
      `versionRange="[${tomlString(entry.minecraftVersion)}]"`,
      'ordering="NONE"',
      'side="BOTH"',
      '',
    ].join('\n')
  const java = entry.loader === 'fabric'
    ? [
      `package ${packageName};`,
      '',
      'import net.fabricmc.api.ModInitializer;',
      '',
      'public final class Mod implements ModInitializer {',
      '    @Override',
      '    public void onInitialize() {',
      '    }',
      '}',
      '',
    ].join('\n')
    : [
      `package ${packageName};`,
      '',
      'import net.neoforged.bus.api.IEventBus;',
      '',
      `@net.neoforged.fml.common.Mod("${modId}")`,
      'public final class Mod {',
      '    public Mod(IEventBus modEventBus) {',
      '    }',
      '}',
      '',
    ].join('\n')
  return {
    'settings.gradle': [
      'pluginManagement {',
      '    repositories {',
      '        if (System.getProperty("dsh.bootstrap.officialOnly") != "true") {',
      '            maven { url = uri("https://mirrors.cloud.tencent.com/repository/gradle-plugin") }',
      mirrorRepositoryLines.replaceAll('        ', '            '),
      '        }',
      `        maven { url = uri("${officialRepository}") }`,
      '        mavenCentral()',
      '        gradlePluginPortal()',
      '    }',
      '}',
      `rootProject.name = "${tomlString(modId)}"`,
      '',
    ].join('\n'),
    'build.gradle': gradle,
    'gradle.properties': [
      `minecraft_version=${entry.minecraftVersion}`,
      `loader_version=${entry.loaderVersion}`,
      `mod_id=${modId}`,
      `mod_name=${modName.replace(/[\r\n]/gu, ' ')}`,
      `required_jdk=${String(entry.requiredJdk)}`,
      'systemProp.org.gradle.internal.http.connectionTimeout=10000',
      'systemProp.org.gradle.internal.http.socketTimeout=120000',
      '',
    ].join('\n'),
    'README.md': `# ${modName}\n\nGenerated by CraftCode's New Mod wizard.\n\n- Loader: ${entry.loader}\n- Minecraft: ${entry.minecraftVersion}\n- Required JDK: ${entry.requiredJdk}\n\nRun \`./gradlew build\` (or \`gradlew.bat build\` on Windows).\n`,
    [`src/main/resources/${entry.loader === 'fabric' ? 'fabric.mod.json' : `META-INF/${neoForgeMetadataFile}`}`]: metadata,
    [`src/main/java/${packagePath}/Mod.java`]: java,
  }
}

/** Gradle wrapper scripts are generated rather than copied from a mutable user tree. */
export function wrapperFiles(gradleVersion: string, checksum?: string): Record<string, string> {
  const distribution = `https://mirrors.cloud.tencent.com/gradle/gradle-${gradleVersion}-bin.zip`
  const fallback = `https://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip`
  const properties = [
    'distributionBase=GRADLE_USER_HOME',
    'distributionPath=wrapper/dists',
    'distributionUrl=' + distribution,
    `# Official fallback: ${fallback}`,
    'networkTimeout=120000',
    'validateDistributionUrl=true',
    ...(checksum === undefined ? [] : [`distributionSha256Sum=${checksum}`]),
    '',
  ].join('\n')
  const unix = [
    '#!/bin/sh',
    'set -eu',
    'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'if ! command -v java >/dev/null 2>&1; then',
    '  echo "Java is required to run the Gradle Wrapper (no system Gradle fallback)." >&2',
    '  exit 1',
    'fi',
    'if [ ! -f "$SCRIPT_DIR/gradle/wrapper/gradle-wrapper.jar" ]; then',
    '  echo "Gradle Wrapper jar is missing; refusing to run a system Gradle fallback." >&2',
    '  exit 1',
    'fi',
    'exec java -classpath "$SCRIPT_DIR/gradle/wrapper/gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain "$@"',
    '',
  ].join('\n')
  const windows = [
    '@echo off',
    'setlocal',
    'set SCRIPT_DIR=%~dp0',
    'where java >NUL 2>&1',
    'if errorlevel 1 (',
    '  echo Java is required to run the Gradle Wrapper; system Gradle fallback is disabled. 1>&2',
    '  exit /b 1',
    ')',
    'if not exist "%SCRIPT_DIR%gradle\\wrapper\\gradle-wrapper.jar" (',
    '  echo Gradle Wrapper jar is missing; system Gradle fallback is disabled. 1>&2',
    '  exit /b 1',
    ')',
    'java -classpath "%SCRIPT_DIR%gradle\\wrapper\\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*',
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n')
  return {
    'gradle/wrapper/gradle-wrapper.properties': properties,
    gradlew: unix,
    'gradlew.bat': windows,
  }
}

function tomlString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '\\r').replaceAll('\n', '\\n')
}
