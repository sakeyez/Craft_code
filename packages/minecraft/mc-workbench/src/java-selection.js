/** Resolve JVM roles from pinned Gradle files, separately from JDK installation. */
import { readText } from "./files.js";
import { requiredJava } from "./environment.js";
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
/**
 * Select supported JVM majors without changing a Wrapper, toolchain or global setting.
 * @param cwd - Absolute project root.
 * @param version - Exact Minecraft release.
 * @param gradleVersion - Pinned Wrapper version.
 * @param files - Detected project Gradle input paths.
 * @returns Separate JVM roles and their project evidence.
 */
export async function selectJava(cwd, version, gradleVersion, files) {
    const minimum = requiredJava(version);
    if (!gradleVersion || !/^\d+\.\d+(?:\.\d+)?$/u.test(gradleVersion))
        throw new Error('无法确定项目 Wrapper 的 Gradle 版本。');
    const [major = 0, minor = 0] = gradleVersion.split('.').map(Number);
    if (major < 7 || (major === 7 && minor < 3))
        throw new Error(`Gradle ${gradleVersion} 不支持 JDK 17，请核对项目 Wrapper。`);
    const supports21 = major > 8 || (major === 8 && minor >= 5);
    const declarations = new Map();
    let gradleHome;
    let homeMajor;
    for (const path of files) {
        const file = await readText(cwd, path);
        for (const match of file.text.matchAll(/JavaLanguageVersion\.of\(\s*(\d+)\s*\)|(?:java_version|javaVersion)\s*=\s*["']?(\d+)/gu)) {
            const value = Number(match[1] ?? match[2] ?? match[3]);
            declarations.set(value, [...(declarations.get(value) ?? []), path]);
        }
        const home = /^\s*org\.gradle\.java\.home\s*=\s*(.+)$/mu.exec(file.text)?.[1];
        if (home) {
            gradleHome = resolve(cwd, home.trim().replace(/\\([\\: ])/gu, '$1'));
            const release = await readFile(join(gradleHome, 'release'), 'utf8').catch(() => undefined);
            const version = release && /^JAVA_VERSION="(\d+)/mu.exec(release)?.[1];
            if (!version)
                throw new Error('org.gradle.java.home 未指向可识别的 JDK，请检查路径和 release 文件。');
            homeMajor = Number(version);
        }
    }
    if (declarations.size > 1)
        throw new Error('项目声明了冲突的 Java 版本，请先核对 Gradle。');
    const compiler = [...declarations.keys()][0] ?? minimum;
    if (![17, 21].includes(compiler) || compiler < minimum)
        throw new Error(`项目编译 JDK ${compiler} 与 Minecraft ${version} 所需 JDK ${minimum} 不兼容。`);
    const criteria = await readText(cwd, 'gradle/gradle-daemon-jvm.properties').catch(() => undefined);
    const pinned = criteria && /^toolchainVersion\s*=\s*(\d+)\s*$/mu.exec(criteria.text)?.[1];
    if (criteria && !pinned)
        throw new Error('无法解析 Gradle daemon JVM 声明。');
    const gradle = pinned ? Number(pinned) : (homeMajor ?? (supports21 ? compiler : 17));
    if (pinned && homeMajor && Number(pinned) !== homeMajor)
        throw new Error('Gradle daemon JVM 声明与 org.gradle.java.home 冲突。');
    if (![17, 21].includes(gradle) || (gradle === 21 && !supports21))
        throw new Error(`Gradle ${gradleVersion} 与声明的 daemon JDK ${gradle} 不兼容。`);
    return {
        gradle,
        compiler,
        game: Math.max(minimum, compiler),
        ...(gradleHome ? { gradleHome } : {}),
        basis: {
            gradle: pinned
                ? 'gradle/gradle-daemon-jvm.properties'
                : gradleHome
                    ? 'org.gradle.java.home'
                    : `Gradle Wrapper ${gradleVersion}`,
            compiler: declarations.size
                ? [...(declarations.get(compiler) ?? [])].join(', ')
                : `Minecraft ${version}（未声明编译 toolchain）`,
            game: `Minecraft ${version} 最低 JDK ${minimum}；项目编译 JDK ${compiler}`,
        },
    };
}
//# sourceMappingURL=java-selection.js.map