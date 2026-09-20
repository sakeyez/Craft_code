import { describe, expect, it } from 'vitest'
import { fabricEntry, neoForgeEntry } from '../src/catalog.ts'
import { projectFiles, wrapperFiles } from '../src/template.ts'

describe('Minecraft bootstrap templates', () => {
  it('generates a Fabric project with consistent identifiers and mirror order', () => {
    const entry = fabricEntry('1.21.1', '0.16.5', 'intermediary', '1.21.1+build.3', '0.102.0+1.21.1')
    const files = projectFiles({
      modName: 'Copper Tools', modId: 'copper_tools', packageName: 'com.example.copper_tools', entry,
    })
    const metadata = JSON.parse(files['src/main/resources/fabric.mod.json'] ?? '{}') as Record<string, unknown>
    expect(metadata.id).toBe('copper_tools')
    expect(metadata.name).toBe('Copper Tools')
    expect(metadata.entrypoints).toEqual({ main: ['com.example.copper_tools.Mod'] })
    expect(files['src/main/java/com/example/copper_tools/Mod.java']).toContain('package com.example.copper_tools;')
    expect(files['build.gradle']).toContain('maven.aliyun.com/repository/gradle-plugin')
    expect(files['build.gradle']).toContain('maven.fabricmc.net')
    expect(files['build.gradle']).toContain('mavenCentral()')
    expect(files['build.gradle']).toContain('dsh.bootstrap.officialOnly')
    expect(files['build.gradle']).toContain('net.fabricmc.fabric-loom-remap')
    expect(files['settings.gradle']).toContain('mirrors.cloud.tencent.com/repository/gradle-plugin')
    expect(files['gradle.properties']).toContain('required_jdk=21')
    expect(files['gradle.properties']).toContain('connectionTimeout=10000')
    expect(files['gradle.properties']).toContain('socketTimeout=120000')
    expect(entry.gradleVersion).toBe('9.5.1')
    expect(entry.gradleSha256).toBe('bafc141b619ad6350fd975fc903156dd5c151998cc8b058e8c1044ab5f7b031f')
    expect(entry.wrapperSha256).toBe('497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7')
  })

  it('generates NeoForge metadata and the Java 17 toolchain for 1.20.4', () => {
    const entry = neoForgeEntry('1.20.4', '20.4.237')
    const files = projectFiles({
      modName: 'Copper Tools', modId: 'copper_tools', packageName: 'com.example.copper_tools', entry,
    })
    expect(files['build.gradle']).toContain('id "net.neoforged.gradle.userdev"')
    expect(files['build.gradle']).toContain('implementation "net.neoforged:neoforge:20.4.237"')
    expect(files['build.gradle']).toContain('JavaLanguageVersion.of(17)')
    expect(files['src/main/resources/META-INF/mods.toml']).toContain('modId="copper_tools"')
    expect(files['src/main/resources/META-INF/mods.toml']).toContain('modId="neoforge"')
    expect(entry.gradleVersion).toBe('9.2.1')
    expect(entry.gradleSha256).toBe('72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f')
    expect(entry.wrapperSha256).toBe('423cb469ccc0ecc31f0e4e1c309976198ccb734cdcbb7029d4bda0f18f57e8d9')
    expect(files['src/main/java/com/example/copper_tools/Mod.java']).toContain('@net.neoforged.fml.common.Mod("copper_tools")')
  })

  it('uses the 1.20.2 NeoForge MDK recipe and legacy metadata syntax', () => {
    const entry = neoForgeEntry('1.20.2', '20.2.93')
    const files = projectFiles({
      modName: 'Copper Tools', modId: 'copper_tools', packageName: 'com.example.copper_tools', entry,
    })
    expect(entry.gradleVersion).toBe('8.14.5')
    expect(entry.gradleSha256).toBe('6f74b601422d6d6fc4e1f9a1ab6522f642c2fdcbc15ae33ebd30ba3d7198e854')
    expect(entry.pluginVersion).toBe('7.0.116')
    expect(files['build.gradle']).toContain('id "net.neoforged.gradle.userdev"')
    expect(files['build.gradle']).toContain('implementation "net.neoforged:neoforge:20.2.93"')
    expect(files['src/main/resources/META-INF/mods.toml']).toContain('mandatory=true')
    expect(files['src/main/resources/META-INF/mods.toml']).not.toContain('type="required"')
  })

  it('keeps the NeoGradle userdev recipe for the 1.21.x MDK', () => {
    const entry = neoForgeEntry('1.21.1', '21.1.176')
    const files = projectFiles({
      modName: 'Copper Tools', modId: 'copper_tools', packageName: 'com.example.copper_tools', entry,
    })
    expect(entry.pluginVersion).toBe('7.1.38')
    expect(files['build.gradle']).toContain('id "net.neoforged.gradle.userdev"')
    expect(files['build.gradle']).toContain('implementation "net.neoforged:neoforge:21.1.176"')
    expect(files['build.gradle']).not.toContain('net.neoforged.moddev')
    expect(files['src/main/resources/META-INF/neoforge.mods.toml']).toContain('type="required"')
    expect(files['src/main/resources/META-INF/neoforge.mods.toml']).toContain('modLoader="javafml"')
  })

  it('uses the loader-free metadata schema from NeoForge 1.21.5 onward', () => {
    const entry = neoForgeEntry('1.21.11', '21.11.45')
    const files = projectFiles({
      modName: 'Copper Tools', modId: 'copper_tools', packageName: 'com.example.copper_tools', entry,
    })
    const metadata = files['src/main/resources/META-INF/neoforge.mods.toml']
    expect(metadata).toContain('license="MIT"')
    expect(metadata).not.toContain('modLoader=')
    expect(metadata).not.toContain('loaderVersion=')
  })

  it('pins the Tencent distribution first and preserves the official checksum fallback', () => {
    const checksum = 'a'.repeat(64)
    const files = wrapperFiles('9.5.1', checksum)
    const properties = files['gradle/wrapper/gradle-wrapper.properties']
    if (properties === undefined) throw new Error('wrapper properties were not generated')
    expect(properties.indexOf('mirrors.cloud.tencent.com')).toBeGreaterThanOrEqual(0)
    expect(properties.indexOf('services.gradle.org')).toBeGreaterThanOrEqual(0)
    expect(properties).toContain(`distributionSha256Sum=${checksum}`)
    expect(files.gradlew).toContain('#!/bin/sh')
    expect(files['gradlew.bat']).toContain('gradle-wrapper.jar')
  })
})
