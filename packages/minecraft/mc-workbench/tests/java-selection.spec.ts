import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { selectJava } from '../src/java-selection.ts'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craftcode-java-roles-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it('separates an older Wrapper JVM from a declared Java 21 toolchain', async () => {
  await writeFile(join(root, 'build.gradle'), 'java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }')
  expect(await selectJava(root, '1.20.1', '8.4', ['build.gradle'])).toMatchObject({
    gradle: 17,
    compiler: 21,
    game: 21,
  })
})
it('honors daemon JVM criteria and rejects a Wrapper conflict', async () => {
  await mkdir(join(root, 'gradle'))
  await writeFile(join(root, 'gradle/gradle-daemon-jvm.properties'), 'toolchainVersion=21\n')
  await expect(selectJava(root, '1.21.1', '8.4', [])).rejects.toThrow('不兼容')
  expect(await selectJava(root, '1.21.1', '8.8', [])).toMatchObject({ gradle: 21, compiler: 21, game: 21 })
})
it('rejects conflicting declarations and missing Wrapper facts', async () => {
  await writeFile(join(root, 'build.gradle'), 'JavaLanguageVersion.of(17)\nJavaLanguageVersion.of(21)')
  await expect(selectJava(root, '1.20.1', '8.8', ['build.gradle'])).rejects.toThrow('冲突')
  await expect(selectJava(root, '1.20.1', undefined, [])).rejects.toThrow('Wrapper')
})

it('uses the pinned Gradle home without conflating bytecode targets with the compiler toolchain', async () => {
  await mkdir(join(root, 'jdk17'))
  await writeFile(join(root, 'jdk17/release'), 'JAVA_VERSION="17.0.12"\n')
  await writeFile(join(root, 'gradle.properties'), 'org.gradle.java.home=jdk17\n')
  await writeFile(join(root, 'build.gradle'), 'sourceCompatibility=JavaVersion.VERSION_17\njava.toolchain.languageVersion=JavaLanguageVersion.of(21)')
  expect(await selectJava(root, '1.21.1', '8.8', ['gradle.properties', 'build.gradle'])).toMatchObject({
    gradle: 17, compiler: 21, game: 21, gradleHome: join(root, 'jdk17'),
  })
  await mkdir(join(root, 'gradle'))
  await writeFile(join(root, 'gradle/gradle-daemon-jvm.properties'), 'toolchainVersion=21\n')
  expect(await selectJava(root, '1.21.1', '8.8', ['gradle.properties', 'build.gradle'])).toMatchObject({ gradle: 21 })
  expect((await selectJava(root, '1.21.1', '8.8', ['gradle.properties', 'build.gradle'])).gradleHome).toBeUndefined()
})

it('validates only the effective user-home JDK when project properties are overridden', async () => {
  const userHome = join(root, 'user-gradle')
  await mkdir(userHome)
  await mkdir(join(root, 'jdk21'))
  await writeFile(join(root, 'jdk21/release'), 'JAVA_VERSION="21.0.12"\n')
  await writeFile(join(root, 'gradle.properties'), 'org.gradle.java.home=missing-jdk\n')
  await writeFile(join(userHome, 'gradle.properties'), 'org.gradle.java.home=jdk21\n')
  expect(await selectJava(root, '1.21.1', '9.2.1', ['gradle.properties'], userHome))
    .toMatchObject({ gradle: 21, gradleHome: join(root, 'jdk21') })
})
