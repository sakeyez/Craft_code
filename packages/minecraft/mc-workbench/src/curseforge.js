import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { z } from 'zod';
import { networkFetch } from "./network.js";
const fileSchema = z.object({
    id: z.number().int().positive(),
    modId: z.number().int().positive(),
    displayName: z.string(),
    fileName: z.string(),
    downloadUrl: z.url().nullable().optional(),
    gameVersions: z.array(z.string()),
    hashes: z.array(z.object({ value: z.string(), algo: z.number().int() })),
    dependencies: z.array(z.object({ modId: z.number().int().positive(), relationType: z.number().int() })),
    isAvailable: z.boolean(),
});
/** Resolve credentials only for a bounded metadata request; callers receive publication data alone. */
export class CurseForge {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    async request(path, signal) {
        const key = await this.ctx.get('credentials')?.resolve(credentialRef('CURSEFORGE_API_KEY'));
        if (!key)
            throw new Error('未配置 CurseForge API 密钥。');
        const response = await networkFetch(`https://api.curseforge.com/v1/${path}`, {
            headers: { 'x-api-key': key.value, Accept: 'application/json' },
            redirect: 'error',
            ...(signal ? { signal } : {}),
        });
        return response.json();
    }
    filter(project) {
        if (project.minecraftVersion.status !== 'determined' ||
            project.minecraftVersion.classification !== 'exact' ||
            !['fabric', 'neoforge'].includes(project.loader))
            throw new Error('CurseForge 查询需要精确游戏版本与受支持加载器。');
        return `gameVersion=${encodeURIComponent(project.minecraftVersion.value)}&modLoaderType=${project.loader === 'fabric' ? 4 : 6}`;
    }
    /**
     * Search only Minecraft mods for the pinned project version and loader.
     * @param project - Detected loader, version and mappings evidence.
     * @param query - Literal search text.
     * @param signal - Caller cancellation signal.
     * @returns Compatible publication search results.
     */
    async search(project, query, signal) {
        const value = z
            .object({ data: z.array(z.object({ id: z.number().int(), name: z.string(), summary: z.string() })) })
            .parse(await this.request(`mods/search?gameId=432&classId=6&${this.filter(project)}&searchFilter=${encodeURIComponent(query.slice(0, 200))}&pageSize=25`, signal));
        return value.data.map(row => ({ id: String(row.id), name: row.name, description: row.summary }));
    }
    /**
     * Read an available exact file; never constructs an alternative CDN URL.
     * @param project - Detected loader, version and mappings evidence.
     * @param projectId - CurseForge publication project ID.
     * @param fileId - Exact CurseForge publication file ID.
     * @param signal - Caller cancellation signal.
     * @returns Validated exact publication metadata with an allowed download URL.
     */
    async file(project, projectId, fileId, signal) {
        const value = z
            .object({ data: fileSchema })
            .parse(await this.request(`mods/${projectId}/files/${fileId}`, signal)).data;
        this.compatible(project, value);
        if (value.modId !== projectId || value.id !== fileId)
            throw new Error('CurseForge 文件身份不一致。');
        if (!value.downloadUrl) {
            const publication = z
                .object({ data: z.object({ links: z.object({ websiteUrl: z.url() }) }) })
                .parse(await this.request(`mods/${projectId}`, signal));
            const page = new URL(publication.data.links.websiteUrl);
            const source = page.protocol === 'https:' && (page.hostname === 'www.curseforge.com' || page.hostname === 'curseforge.com')
                ? page.href
                : 'https://www.curseforge.com/minecraft';
            throw new Error(`发布方未允许 API 下载。请从 ${source} 获取文件后本地导入。`);
        }
        return value;
    }
    compatible(project, file) {
        if (!file.isAvailable ||
            project.minecraftVersion.status !== 'determined' ||
            !file.gameVersions.includes(project.minecraftVersion.value) ||
            !file.gameVersions.some(value => value.toLowerCase() === project.loader))
            throw new Error('CurseForge 文件与当前项目不兼容或已不可用。');
    }
    /**
     * Compatible publication list; required dependency resolution uses these exact file IDs.
     * @param project - Detected loader, version and mappings evidence.
     * @param projectId - CurseForge publication project ID.
     * @param signal - Caller cancellation signal.
     * @returns Compatible available publication files.
     */
    async files(project, projectId, signal) {
        const rows = z
            .object({ data: z.array(fileSchema) })
            .parse(await this.request(`mods/${projectId}/files?${this.filter(project)}&pageSize=50`, signal)).data;
        return rows.filter((row) => {
            try {
                this.compatible(project, row);
                return true;
            }
            catch {
                return false;
            }
        });
    }
}
//# sourceMappingURL=curseforge.js.map