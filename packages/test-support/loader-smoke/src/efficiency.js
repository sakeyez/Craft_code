/** Replay-derived efficiency metrics for fixed loader tasks. */
import { createHash } from 'node:crypto';
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function dataRecord(record) {
    return isRecord(record.data) ? record.data : {};
}
function parseArguments(value) {
    if (typeof value !== 'string')
        return isRecord(value) ? value : {};
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function stable(value) {
    if (Array.isArray(value))
        return `[${value.map(stable).join(',')}]`;
    if (!isRecord(value)) {
        if (value === undefined)
            return 'null';
        return JSON.stringify(value);
    }
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function readKey(data) {
    const name = typeof data.name === 'string' ? data.name : '';
    const args = parseArguments(data.arguments);
    const lower = name.toLowerCase();
    let category;
    if (lower.includes('search') || lower.includes('glob') || lower.includes('list'))
        category = 'search';
    else if (lower.includes('read') || lower.includes('view') || lower.includes('file'))
        category = 'read';
    else if (lower.includes('detect') || lower.includes('resource'))
        category = 'resource';
    if (category === undefined)
        return undefined;
    const path = args.path ?? args.pattern ?? args.query ?? args.glob ?? args;
    return { category, key: `${name}:${stable(path)}` };
}
function validationKey(data) {
    const name = typeof data.name === 'string' ? data.name.toLowerCase() : '';
    const args = parseArguments(data.arguments);
    const text = `${name} ${stable(args)}`.toLowerCase();
    return /(?:compile|build|test|check|validate|verification|typecheck|gradle)/.test(text)
        ? `${name}:${stable(args)}`
        : undefined;
}
function usageFrom(data) {
    const usage = isRecord(data.usage)
        ? data.usage
        : isRecord(data.chunk) && isRecord(data.chunk.usage) ? data.chunk.usage : undefined;
    if (usage === undefined)
        return undefined;
    const result = {};
    for (const [key, value] of Object.entries(usage)) {
        if (typeof value === 'number' && Number.isFinite(value))
            result[key] = value;
    }
    return result;
}
function addToken(current, next) {
    return next === undefined ? current : (current ?? 0) + next;
}
/**
 * Parse existing session JSONL/replay text without adding a session event.
 * @param rawJsonl - complete or partial session JSONL text.
 * @param options - optional required validation event types.
 * @returns folded efficiency metrics and a stable transcript digest.
 */
export function parseEfficiencyMetrics(rawJsonl, options = {}) {
    const records = rawJsonl.split(/\r?\n/).flatMap((line) => {
        if (line.trim() === '')
            return [];
        try {
            const parsed = JSON.parse(line);
            return isRecord(parsed) ? [parsed] : [];
        }
        catch {
            return [];
        }
    });
    const toolCalls = records.filter(record => record.type === 'tool/call');
    const readSeen = new Map();
    const validationSeen = new Set();
    const duplicateReadsByCategory = {};
    let duplicateReads = 0;
    let repeatedValidationCalls = 0;
    for (const record of toolCalls) {
        const data = dataRecord(record);
        const read = readKey(data);
        if (read !== undefined) {
            const count = (readSeen.get(read.key) ?? 0) + 1;
            readSeen.set(read.key, count);
            if (count > 1) {
                duplicateReads++;
                duplicateReadsByCategory[read.category] = (duplicateReadsByCategory[read.category] ?? 0) + 1;
            }
        }
        const validation = validationKey(data);
        if (validation !== undefined) {
            if (validationSeen.has(validation))
                repeatedValidationCalls++;
            validationSeen.add(validation);
        }
    }
    const totals = {
        input: undefined,
        output: undefined,
        // oxlint-disable-next-line typescript/no-deprecated
        ['cache']: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
        reasoning: undefined,
    };
    for (const record of records) {
        if (record.type !== 'assistant/message')
            continue;
        const usage = usageFrom(dataRecord(record));
        if (usage === undefined)
            continue;
        totals.input = addToken(totals.input, usage.inputTokens);
        totals.output = addToken(totals.output, usage.outputTokens);
        const cacheRead = usage.cacheReadTokens ?? usage.cacheTokens;
        totals.cacheRead = addToken(totals.cacheRead, cacheRead);
        // Compatibility alias retained for older benchmark reports.
        // oxlint-disable-next-line typescript/no-deprecated
        totals.cache = addToken(totals.cache, cacheRead);
        totals.cacheWrite = addToken(totals.cacheWrite, usage.cacheWriteTokens);
        totals.reasoning = addToken(totals.reasoning, usage.reasoningTokens);
    }
    const required = [...new Set(options.requiredValidationTypes ?? [])];
    const observed = required.filter(type => records.some(record => record.type === type));
    const digestInput = records.map(record => ({
        type: record.type,
        data: record.type === 'tool/call'
            ? { name: dataRecord(record).name, arguments: parseArguments(dataRecord(record).arguments) }
            : record.data,
    }));
    const transcriptDigest = createHash('sha256').update(stable(digestInput)).digest('hex');
    const sourceKind = (record) => {
        const source = dataRecord(record).source;
        return isRecord(source) ? source.kind : undefined;
    };
    return {
        toolCalls: toolCalls.length,
        duplicateReads,
        duplicateReadsByCategory,
        skillCatalogInjections: records.filter(record => sourceKind(record) === 'skill-catalog').length,
        skillLoads: records.filter(record => sourceKind(record) === 'skill-invocation').length,
        retries: records.filter(record => record.type === 'llm/retry').length,
        repeatedValidationCalls,
        tokens: totals,
        requiredValidationEvents: observed,
        transcriptDigest,
    };
}
//# sourceMappingURL=efficiency.js.map