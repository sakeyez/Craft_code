import { describe, expect, it } from 'vitest'
import {
  catalogEntryId,
  deriveDirectoryName,
  isCatalogEntry,
  isSha256,
  isStableMinecraftVersion,
  isSupportedMinecraftVersion,
  isValidDirectoryName,
  isValidModId,
  isValidModName,
  isValidPackageName,
  jdkForMinecraft,
  recordPayload,
} from '../src/validation.ts'

describe('Minecraft bootstrap wire contracts', () => {
  it('maps the supported Minecraft ranges to the required JDK', () => {
    expect(jdkForMinecraft('1.20.1')).toBe(17)
    expect(jdkForMinecraft('1.20.4+build.1')).toBe(17)
    expect(jdkForMinecraft('1.20.5')).toBe(21)
    expect(jdkForMinecraft('1.21.8')).toBe(21)
    expect(jdkForMinecraft('1.21')).toBe(21)
    expect(jdkForMinecraft('26.1.0')).toBeUndefined()
    expect(jdkForMinecraft('1.19.4')).toBeUndefined()
    expect(isSupportedMinecraftVersion('1.20.1')).toBe(true)
    expect(isSupportedMinecraftVersion('1.21.10')).toBe(true)
    expect(isSupportedMinecraftVersion('1.21')).toBe(true)
    expect(isStableMinecraftVersion('1.21.10', false)).toBe(false)
    expect(isStableMinecraftVersion('26.1.0')).toBe(false)
    expect(isStableMinecraftVersion('1.21.10-pre1')).toBe(false)
  })

  it('accepts only safe identifiers and path components', () => {
    expect(isValidModId('my_mod2')).toBe(true)
    expect(isValidModId('MyMod')).toBe(false)
    expect(isValidModId('2mod')).toBe(false)
    expect(isValidModId('a-b')).toBe(false)

    expect(isValidPackageName('com.example.my_mod')).toBe(true)
    expect(isValidPackageName('example')).toBe(false)
    expect(isValidPackageName('com.java.mod')).toBe(false)
    expect(isValidPackageName('com.example/escape')).toBe(false)

    expect(isValidModName('A useful mod')).toBe(true)
    expect(isValidModName('  ')).toBe(false)
    expect(isValidModName('bad\u0000name')).toBe(false)

    expect(isValidDirectoryName('My Mod')).toBe(true)
    expect(isValidDirectoryName('..')).toBe(false)
    expect(isValidDirectoryName('nested/name')).toBe(false)
    expect(isValidDirectoryName('CON')).toBe(false)
    expect(isValidDirectoryName('name.')).toBe(false)
    expect(deriveDirectoryName('  Hello 世界  ', 'hello_mod')).toBe('Hello')
    expect(deriveDirectoryName('***', 'hello_mod')).toBe('hello_mod')
  })

  it('guards catalog records and opaque payloads at the boundary', () => {
    const entry = {
      entryId: catalogEntryId('fabric', '1.21.1', '0.16.5'),
      loader: 'fabric',
      minecraftVersion: '1.21.1',
      loaderVersion: '0.16.5',
      mappingsVersion: '1.21.1+build.3',
      apiVersion: '0.102.0+1.21.1',
      pluginVersion: '1.9.2',
      gradleVersion: '9.5.1',
      gradleSha256: 'a'.repeat(64),
      wrapperSha256: 'b'.repeat(64),
      requiredJdk: 21,
      stable: true,
    } as const
    expect(isCatalogEntry(entry)).toBe(true)
    expect(isCatalogEntry({ ...entry, stable: false })).toBe(false)
    expect(isCatalogEntry({ ...entry, wrapperSha256: undefined })).toBe(false)
    expect(isCatalogEntry({ ...entry, gradleSha256: 'not-a-hash' })).toBe(false)
    expect(isCatalogEntry({ ...entry, minecraftVersion: '26.1.0' })).toBe(false)
    expect(recordPayload({ value: 1 })).toEqual({ value: 1 })
    expect(recordPayload(null)).toBeUndefined()
    expect(recordPayload([])).toBeUndefined()
    expect(recordPayload('payload')).toBeUndefined()
    expect(isSha256('a'.repeat(64))).toBe(true)
    expect(isSha256('A'.repeat(64))).toBe(true)
    expect(isSha256('a'.repeat(63))).toBe(false)
  })
})
