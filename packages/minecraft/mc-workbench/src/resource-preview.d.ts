/** Read-only vanilla resource resolution, including draft provenance and missing references. */
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
declare const element: z.ZodObject<{
    from: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
    to: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
    rotation: z.ZodOptional<z.ZodUnknown>;
    faces: z.ZodRecord<z.ZodString, z.ZodObject<{
        texture: z.ZodString;
        uv: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>>;
        rotation: z.ZodOptional<z.ZodNumber>;
        tintindex: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Bounded preview data; all image URLs contain validated local PNG bytes. */
export interface ResourcePreview {
    path: string;
    revision: string;
    draft: boolean;
    kind: 'png' | 'generated' | 'model' | 'unsupported';
    images: Record<string, string>;
    elements: z.infer<typeof element>[];
    missing: string[];
    unsupported: string[];
    references: {
        path: string;
        line: number;
        text: string;
    }[];
    issues: {
        path: string;
        message: string;
    }[];
    generatedSources: string[];
}
/**
 * Resolve PNG or vanilla JSON model inheritance without writing drafts or generated output.
 * @param ctx - Host context with filesystem and managed subprocess services.
 * @param cwd - Absolute project root.
 * @param input - Untrusted query or preview payload.
 * @param signal - Caller cancellation signal.
 * @returns Bounded preview data, missing references and draft provenance.
 */
export declare function previewResource(ctx: Context, cwd: string, input: unknown, signal: AbortSignal): Promise<ResourcePreview>;
export {};
//# sourceMappingURL=resource-preview.d.ts.map