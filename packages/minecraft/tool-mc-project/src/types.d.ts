/** Serializable project detection and static validation facts. */
import type { Loader, LoaderSupport } from './loader-support.ts';
/**
 * Strength of a mod-id candidate extracted from project evidence.
 */
export type Confidence = 'high' | 'medium' | 'low';
/**
 * Whether version evidence identifies an exact release or a constraint.
 */
export type VersionClassification = 'exact' | 'range';
/**
 * Minecraft version text and the project evidence that supplies it.
 */
export interface MinecraftVersionCandidate {
    value: string;
    classification: VersionClassification;
    source: string;
    evidence: string;
}
/**
 * Determined, unknown or conflicting Minecraft version evidence.
 */
export type MinecraftVersionResult = {
    status: 'unknown';
    candidates: [];
} | {
    status: 'determined';
    value: string;
    classification: VersionClassification;
    candidates: MinecraftVersionCandidate[];
} | {
    status: 'conflict';
    candidates: MinecraftVersionCandidate[];
};
/**
 * Mapping family, version and the project evidence that supplies it.
 */
export interface MappingsCandidate {
    type: string;
    version: string | null;
    source: string;
    evidence: string;
}
/**
 * Determined, unknown or conflicting mapping evidence.
 */
export type MappingsResult = {
    status: 'unknown';
    candidates: [];
} | {
    status: 'determined';
    type: string;
    version: string | null;
    candidates: MappingsCandidate[];
} | {
    status: 'conflict';
    candidates: MappingsCandidate[];
};
/**
 * Loader-specific clues used to diagnose project support.
 */
export interface LoaderEvidence {
    loader: Exclude<Loader, 'unknown'>;
    evidence: string[];
}
/**
 * A candidate mod identifier with its source and confidence.
 */
export interface ModIdCandidate {
    id: string;
    source: string;
    confidence: Confidence;
}
/**
 * Java, Kotlin and resource roots belonging to a discovered source set.
 */
export interface SourceSetInfo {
    name: string;
    java: string[];
    kotlin: string[];
    resources: string[];
}
/**
 * Mixin configuration path and its metadata source.
 */
export interface MixinConfig {
    path: string;
    source: string;
}
/**
 * Evidence for data-generation wiring in the project.
 */
export interface DatagenClue {
    kind: string;
    source: string;
    detail: string;
}
/**
 * Serializable project facts discovered without choosing version-sensitive APIs.
 */
export interface DetectionResult {
    workspace: string;
    loader: Loader;
    loaderSupport: LoaderSupport;
    loaderEvidence: LoaderEvidence[];
    minecraftVersion: MinecraftVersionResult;
    mappings: MappingsResult;
    modIdCandidates: ModIdCandidate[];
    languages: {
        java: boolean;
        kotlin: boolean;
    };
    mainSourceSets: SourceSetInfo[];
    resourceRoots: string[];
    mixinConfigs: MixinConfig[];
    datagenClues: DatagenClue[];
    recommendedValidationCommands: string[];
    gradleTaskCandidates: string[];
    inspected: {
        gradleFiles: string[];
        metadataFiles: string[];
        sourceRoots: string[];
        resourceRoots: string[];
    };
    warnings: string[];
    scanComplete: boolean;
}
/**
 * A bounded static resource diagnostic and its related location.
 */
export interface ResourceIssue {
    code: string;
    path: string;
    message: string;
    reference: string | null;
    expectedPath: string | null;
}
/**
 * Static resource findings and scan completeness; not runtime loading evidence.
 */
export interface ResourceValidationResult {
    errors: ResourceIssue[];
    warnings: ResourceIssue[];
    checkedFiles: string[];
    detectedModId: string | null;
    scanComplete: boolean;
}
//# sourceMappingURL=types.d.ts.map