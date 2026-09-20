/** Build output selection and immutable evidence for an independently tested mod JAR. */
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { inspectJar } from "./dependencies.js";
import { zipEntries } from "./download.js";
import { projectPath, hash } from "./files.js";
import { projectInputs } from "./project-inputs.js";
/** Resolved Gradle facts, written by an application-owned inspection task after a successful build. */
export const buildFactsSchema = z.object({
    artifacts: z.array(z.object({ task: z.string(), path: z.string(), classifier: z.string() })).max(100),
    modules: z.array(z.object({ group: z.string(), name: z.string(), version: z.string() })).max(5000),
    classpath: z.array(z.string()).max(5000),
    resources: z.array(z.string()).max(20000).optional(),
});
/**
 * Reject ambiguous, development or mismatched artifacts rather than guessing from file modification time.
 * @param cwd - Absolute project root.
 * @param project - Detected loader, version and mappings evidence.
 * @param facts - Resolved Gradle archive and classpath facts.
 * @param fingerprint - Expected hash of the protected project input inventory.
 * @returns Validated artifact bound to current project inputs.
 */
export async function acceptArtifact(cwd, project, facts, fingerprint) {
    const published = facts.artifacts.filter(row => !/sources|javadoc|dev|test/iu.test(row.classifier) &&
        !/-(?:sources|javadoc|dev|dev-shadow|test)\.jar$/iu.test(row.path));
    const remapped = published.filter(row => row.task === 'remapJar');
    const candidates = remapped.length ? remapped : published;
    if (candidates.length !== 1)
        throw new Error(`发布产物不唯一：${candidates.map(row => row.path).join('、') || '没有候选 JAR'}`);
    const selected = candidates[0];
    if (!selected)
        throw new Error('没有候选 JAR。');
    const file = await projectPath(cwd, selected.path);
    if ((await stat(file)).size > 256 * 1024 ** 2)
        throw new Error('产物超过 256 MiB 验收限制。');
    const bytes = await readFile(file);
    const metadata = inspectJar(bytes);
    if ((project.loader !== 'fabric' && project.loader !== 'neoforge') ||
        metadata.loader !== project.loader ||
        !metadata.modId ||
        !metadata.version ||
        /\$\{|@VERSION@/u.test(metadata.version))
        throw new Error('产物缺少明确的模组 ID、版本或对应加载器描述。');
    const ids = project.modIdCandidates.filter(row => row.confidence === 'high').map(row => row.id);
    if (!ids.includes(metadata.modId))
        throw new Error(`产物模组 ID ${metadata.modId} 与项目不一致。`);
    if (project.minecraftVersion.status !== 'determined' || project.minecraftVersion.classification !== 'exact')
        throw new Error('缺少精确 Minecraft 版本。');
    const coordinates = facts.modules.filter(row => project.loader === 'fabric'
        ? row.group === 'net.fabricmc' && row.name === 'fabric-loader'
        : row.group === 'net.neoforged' && row.name === 'neoforge');
    const versions = [...new Set(coordinates.map(row => row.version))];
    const loaderVersion = versions[0];
    if (versions.length !== 1 || !loaderVersion || !/^[\d][\w.+-]*$/u.test(loaderVersion))
        throw new Error('Gradle 未解析出唯一的精确加载器版本。');
    const entries = zipEntries(bytes);
    for (const resource of facts.resources ?? [])
        if (!entries[resource])
            throw new Error(`产物缺少 Gradle 输出资源：${resource}`);
    const nestedIds = [];
    const nestedVersions = {};
    if (project.loader === 'fabric') {
        const fabric = z
            .object({
            jars: z
                .array(z.object({ file: z.string() }))
                .max(100)
                .default([]),
            mixins: z.array(z.union([z.string(), z.object({ config: z.string() })])).default([]),
            entrypoints: z
                .record(z.string(), z.array(z.union([z.string(), z.object({ value: z.string(), adapter: z.string().optional() })])))
                .default({}),
        })
            .parse(JSON.parse(new TextDecoder().decode(entries['fabric.mod.json'])));
        for (const item of fabric.jars) {
            const nested = entries[item.file];
            if (!nested)
                throw new Error(`产物缺少嵌套依赖：${item.file}`);
            const descriptor = inspectJar(nested);
            if (descriptor.modId && descriptor.version) {
                nestedIds.push(descriptor.modId);
                nestedVersions[descriptor.modId] = descriptor.version;
            }
        }
        for (const mixin of fabric.mixins) {
            const path = typeof mixin === 'string' ? mixin : mixin.config;
            if (!entries[path])
                throw new Error(`产物缺少 Mixin 配置：${path}`);
        }
        for (const item of Object.values(fabric.entrypoints).flat()) {
            if (typeof item !== 'string' && item.adapter && item.adapter !== 'default')
                throw new Error('产物包含尚未支持验收的入口适配器。');
            const entry = (typeof item === 'string' ? item : item.value).split('::', 1).join('');
            if (!entries[entry.replaceAll('.', '/') + '.class'])
                throw new Error(`产物缺少入口类：${entry}`);
        }
    }
    if (project.loader === 'neoforge' && entries['META-INF/jarjar/metadata.json']) {
        const nested = z
            .object({ jars: z.array(z.object({ path: z.string() })).max(100) })
            .parse(JSON.parse(new TextDecoder().decode(entries['META-INF/jarjar/metadata.json'])));
        for (const item of nested.jars) {
            const bytes = entries[item.path];
            if (!bytes)
                throw new Error(`产物缺少嵌套依赖：${item.path}`);
            const descriptor = inspectJar(bytes);
            if (descriptor.modId && descriptor.version) {
                nestedIds.push(descriptor.modId);
                nestedVersions[descriptor.modId] = descriptor.version;
            }
        }
    }
    if ((await projectInputs(cwd)).fingerprint !== fingerprint)
        throw new Error('源码或构建配置在构建期间发生变化，请重新构建。');
    return {
        path: selected.path,
        sha256: hash(bytes),
        modId: metadata.modId,
        version: metadata.version,
        loader: project.loader,
        minecraft: project.minecraftVersion.value,
        loaderVersion,
        inputFingerprint: fingerprint,
        requirements: metadata.requirements,
        nestedIds,
        nestedVersions,
        checkedAt: new Date().toISOString(),
    };
}
/**
 * Generate a Gradle task that records actual archive outputs and resolved dependency coordinates.
 * @param task - Unique Gradle inspection task name.
 * @param destination - Application-owned output path.
 * @returns Gradle script that writes bounded build facts.
 */
export function buildInspectionScript(task, destination) {
    if (!/^[a-zA-Z0-9]+$/u.test(task) || !/^\.dsh\/runs\/[a-f\d-]{36}\/build-facts\.json$/u.test(destination))
        throw new Error('构建证据路径无效。');
    return `gradle.projectsEvaluated {
  gradle.rootProject.tasks.register('${task}') {
    doLast {
      def root = project.rootDir.toPath()
      def archives = project.tasks.withType(org.gradle.api.tasks.bundling.AbstractArchiveTask).findAll { it.archiveFile.get().asFile.exists() && it.archiveExtension.get() == 'jar' }.collect {
        [task: it.name, path: root.relativize(it.archiveFile.get().asFile.toPath()).toString().replace('\\\\', '/'), classifier: it.archiveClassifier.orNull ?: '']
      }
      def modules = []; def paths = []
      def neo = project.extensions.findByName('neoForge')
      if (neo != null && neo.hasProperty('version')) {
        def pinned = neo.version
        if (pinned instanceof org.gradle.api.provider.Provider) pinned = pinned.orNull
        if (pinned != null) modules.add([group: 'net.neoforged', name: 'neoforge', version: pinned.toString()])
      }
      ['compileClasspath', 'runtimeClasspath'].each { name ->
        def conf = project.configurations.findByName(name)
        if (conf != null && conf.canBeResolved) {
          conf.resolvedConfiguration.resolvedArtifacts.each { artifact ->
            def id = artifact.moduleVersion.id
            modules.add([group: id.group, name: id.name, version: id.version])
          }
          paths.addAll(conf.files.collect { it.absolutePath })
        }
      }
      def resources = []
      def sourceSets = project.extensions.findByName('sourceSets')
      ['main', 'client'].each { name ->
        def directory = sourceSets?.findByName(name)?.output?.resourcesDir
        if (directory != null && directory.exists()) {
          project.fileTree(directory).files.each { file ->
            resources.add(directory.toPath().relativize(file.toPath()).toString().replace('\\\\', '/'))
          }
        }
      }
      project.file('${destination}').text = groovy.json.JsonOutput.toJson([artifacts: archives, modules: modules.unique(), classpath: paths.unique(), resources: resources.unique()])
    }
  }
}
`;
}
//# sourceMappingURL=artifact.js.map