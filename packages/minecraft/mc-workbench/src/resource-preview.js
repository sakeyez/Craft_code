import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import yauzl from 'yauzl';
import { inspectMinecraftProject, validateMinecraftProject } from '@deepseek-ai/dsh-tool-mc-project';
import { projectPath, hash, searchFiles } from "./files.js";
import { cacheRoot } from "./environment.js";
import { fileDigest } from "./transfer.js";
const vector = z.tuple([z.number().min(-16).max(32), z.number().min(-16).max(32), z.number().min(-16).max(32)]);
const face = z.object({
    texture: z.string(),
    uv: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    rotation: z.number().optional(),
    tintindex: z.number().optional(),
});
const element = z.object({
    from: vector,
    to: vector,
    rotation: z.unknown().optional(),
    faces: z.record(z.string(), face),
});
const modelSchema = z.object({
    parent: z.string().optional(),
    textures: z.record(z.string(), z.string()).default({}),
    elements: z.array(element).max(128).optional(),
    loader: z.unknown().optional(),
    overrides: z.unknown().optional(),
});
async function archiveEntry(file, name) {
    return new Promise((accept, reject) => {
        yauzl.open(file, { lazyEntries: true }, (error, zip) => {
            if (error) {
                accept(undefined);
                return;
            }
            let result;
            zip.on('error', reject);
            zip.on('end', () => {
                accept(result);
            });
            zip.on('entry', (entry) => {
                if (entry.fileName !== name) {
                    zip.readEntry();
                    return;
                }
                if (entry.uncompressedSize > 4 * 1024 ** 2) {
                    zip.close();
                    reject(new Error('原版预览资源超过大小限制。'));
                    return;
                }
                zip.openReadStream(entry, (error, stream) => {
                    if (error) {
                        zip.close();
                        reject(error);
                        return;
                    }
                    const parts = [];
                    stream.on('data', (part) => parts.push(part));
                    stream.on('error', reject);
                    stream.on('end', () => {
                        result = Buffer.concat(parts);
                        zip.close();
                        accept(result);
                    });
                });
            });
            zip.readEntry();
        });
    });
}
/**
 * Resolve PNG or vanilla JSON model inheritance without writing drafts or generated output.
 * @param ctx - Host context with filesystem and managed subprocess services.
 * @param cwd - Absolute project root.
 * @param input - Untrusted query or preview payload.
 * @param signal - Caller cancellation signal.
 * @returns Bounded preview data, missing references and draft provenance.
 */
export async function previewResource(ctx, cwd, input, signal) {
    const request = z
        .object({
        path: z.string().max(4096),
        draft: z
            .string()
            .max(2 * 1024 ** 2)
            .optional(),
    })
        .parse(input);
    const path = await projectPath(cwd, request.path);
    if ((await stat(path)).size > 4 * 1024 ** 2)
        throw new Error('预览文件超过 4 MiB。');
    const bytes = await readFile(path);
    const result = {
        path: request.path,
        revision: hash(bytes),
        draft: request.draft !== undefined && request.draft !== bytes.toString('utf8'),
        kind: 'unsupported',
        images: {},
        elements: [],
        missing: [],
        unsupported: [],
        references: [],
        issues: [],
        generatedSources: [],
    };
    const png = (value) => {
        if (value.length < 24 ||
            value.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
            value.readUInt32BE(16) > 4096 ||
            value.readUInt32BE(20) > 4096)
            throw new Error('PNG 格式或尺寸不受支持。');
        return `data:image/png;base64,${value.toString('base64')}`;
    };
    if (request.path.endsWith('.png')) {
        result.kind = 'png';
        result.images.layer0 = png(bytes);
        if (await stat(path + '.mcmeta').catch(() => undefined)) {
            result.kind = 'unsupported';
            result.unsupported.push('动画贴图不支持预览。');
        }
    }
    const project = await inspectMinecraftProject(ctx, cwd, signal);
    const asset = /(?:^|\/)assets\/([^/]+)\/(?:models|textures)\/(.+)\.(?:json|png)$/u.exec(request.path);
    if (!asset) {
        result.unsupported.push('仅支持 PNG 和原版 JSON 模型。');
        return result;
    }
    const namespace = asset[1];
    const resourceName = asset[2];
    if (!namespace || !resourceName)
        throw new Error('资源路径缺少命名空间或名称。');
    let retainedBytes = bytes.length;
    let vanillaVerified = false;
    const resource = async (id, kind) => {
        if (!/^(?:[a-z\d_.-]+:)?[a-z\d_./-]+$/u.test(id) || id.includes('..'))
            throw new Error('资源引用无效。');
        const [ns, name] = id.includes(':') ? id.split(':') : ['minecraft', id];
        const relative = `assets/${ns}/${kind}/${name}.${kind === 'models' ? 'json' : 'png'}`;
        for (const root of project.resourceRoots) {
            const file = await projectPath(cwd, `${root}/${relative}`, true);
            const info = await stat(file).catch(() => undefined);
            if (!info)
                continue;
            if (!info.isFile() || info.size > 4 * 1024 ** 2)
                throw new Error('引用资源超过预览限制。');
            if (kind === 'textures' && (await stat(file + '.mcmeta').catch(() => undefined)))
                result.unsupported.push(`动画贴图不支持预览：${id}`);
            return readFile(file);
        }
        if (ns === 'minecraft' &&
            project.minecraftVersion.status === 'determined' &&
            project.minecraftVersion.classification === 'exact') {
            const version = project.minecraftVersion.value;
            const directory = join(cacheRoot(), 'game', 'versions', version);
            const jar = join(directory, `${version}.jar`);
            if (!vanillaVerified) {
                const metadata = await readFile(join(directory, `${version}.json`), 'utf8').catch(() => undefined);
                if (!metadata)
                    return undefined;
                const info = z
                    .object({ downloads: z.object({ client: z.object({ sha1: z.string().regex(/^[a-f\d]{40}$/u) }) }) })
                    .parse(JSON.parse(metadata));
                if ((await fileDigest(jar, 'sha1')) !== info.downloads.client.sha1)
                    throw new Error('原版资源缓存校验失败，请修复实例。');
                vanillaVerified = true;
            }
            if (kind === 'textures' && (await archiveEntry(jar, relative + '.mcmeta')))
                result.unsupported.push(`动画贴图不支持预览：${id}`);
            return archiveEntry(jar, relative);
        }
        return undefined;
    };
    if (request.path.endsWith('.json')) {
        const seen = new Set();
        const resolveModel = async (text, depth) => {
            if (depth > 16)
                throw new Error('模型继承超过 16 层。');
            const own = modelSchema.parse(JSON.parse(text));
            if (own.loader || own.overrides)
                result.unsupported.push('自定义加载器或动态覆盖不支持预览。');
            if (!own.parent)
                return { ...own, generated: false };
            if (['item/generated', 'minecraft:item/generated', 'builtin/generated', 'minecraft:builtin/generated'].includes(own.parent))
                return { ...own, generated: true };
            if (seen.has(own.parent))
                throw new Error('模型继承包含循环。');
            seen.add(own.parent);
            const parent = await resource(own.parent, 'models');
            if (!parent) {
                result.missing.push(own.parent);
                return { ...own, generated: false };
            }
            const base = await resolveModel(parent.toString(), depth + 1);
            return {
                ...base,
                ...own,
                textures: { ...base.textures, ...own.textures },
                elements: own.elements ?? base.elements,
            };
        };
        const model = await resolveModel(request.draft ?? bytes.toString('utf8'), 0);
        result.elements = model.elements ?? [];
        if (result.elements.some(item => item.rotation !== undefined ||
            Object.values(item.faces).some(face => face.rotation || face.tintindex !== undefined)))
            result.unsupported.push('旋转元素、旋转 UV 或生物群系染色不支持预览。');
        for (const [key, value] of Object.entries(model.textures)) {
            let id = value;
            const aliases = new Set();
            while (id?.startsWith('#')) {
                if (aliases.has(id)) {
                    id = undefined;
                    break;
                }
                aliases.add(id);
                id = model.textures[id.slice(1)];
            }
            if (!id) {
                result.missing.push(value);
                continue;
            }
            const texture = await resource(id, 'textures');
            if (!texture) {
                result.missing.push(id);
                continue;
            }
            retainedBytes += texture.length;
            if (retainedBytes > 8 * 1024 ** 2)
                throw new Error('预览引用超过 8 MiB。');
            result.images[key] = png(texture);
        }
        for (const part of result.elements)
            for (const face of Object.values(part.faces)) {
                if (!face.texture.startsWith('#')) {
                    const id = face.texture;
                    const texture = await resource(id, 'textures');
                    if (texture) {
                        retainedBytes += texture.length;
                        if (retainedBytes > 8 * 1024 ** 2)
                            throw new Error('预览引用超过 8 MiB。');
                        const key = `direct_${Object.keys(result.images).length}`;
                        result.images[key] = png(texture);
                        face.texture = `#${key}`;
                    }
                    else
                        result.missing.push(id);
                }
                else if (!result.images[face.texture.slice(1)])
                    result.missing.push(face.texture);
            }
        result.kind =
            result.unsupported.length || result.missing.length
                ? 'unsupported'
                : model.generated
                    ? 'generated'
                    : result.elements.length
                        ? 'model'
                        : 'unsupported';
        if (result.kind === 'unsupported' && !result.missing.length && !result.unsupported.length)
            result.unsupported.push('此资源不包含可预览的原版模型元素。');
    }
    const id = `${namespace}:${asset[2]}`;
    const search = await searchFiles(cwd, id);
    result.references = search.hits.filter(hit => hit.path !== request.path);
    if (search.truncated)
        result.unsupported.push('引用结果不完整，请缩小项目范围。');
    const validation = await validateMinecraftProject(ctx, cwd, signal);
    result.issues = validation.errors
        .filter(issue => issue.path === request.path)
        .map(issue => ({ path: issue.path, message: issue.message }));
    if (/(?:^|\/)(?:generated|generated-resources)(?:\/|$)/u.test(request.path)) {
        const name = resourceName.split('/').at(-1) ?? resourceName;
        const sources = await searchFiles(cwd, `"${name}"`);
        result.generatedSources = sources.hits.filter(hit => /\.java$/u.test(hit.path)).map(hit => hit.path);
    }
    result.missing = [...new Set(result.missing)];
    return result;
}
//# sourceMappingURL=resource-preview.js.map