/** Validation for persisted runs and dependency manifests. */
import { z } from 'zod';
import type { WorkbenchId } from './types.ts';
/** Validate and brand an operation UUID at the wire or persistence boundary. */
export declare const workbenchIdSchema: z.ZodPipe<z.ZodUUID, z.ZodTransform<WorkbenchId, string>>;
/**
 * Validates persisted run identities and their corresponding log paths.
 */
export declare const runSchema: z.ZodObject<{
    format: z.ZodOptional<z.ZodLiteral<2>>;
    mode: z.ZodOptional<z.ZodEnum<{
        development: "development";
        artifact: "artifact";
    }>>;
    dependencies: z.ZodOptional<z.ZodEnum<{
        required: "required";
        selected: "selected";
    }>>;
    instance: z.ZodOptional<z.ZodString>;
    artifact: z.ZodOptional<z.ZodObject<{
        path: z.ZodString;
        sha256: z.ZodString;
        modId: z.ZodString;
        version: z.ZodString;
        loader: z.ZodEnum<{
            fabric: "fabric";
            neoforge: "neoforge";
        }>;
        minecraft: z.ZodString;
        loaderVersion: z.ZodString;
        inputFingerprint: z.ZodString;
        requirements: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>;
        nestedIds: z.ZodArray<z.ZodString>;
        nestedVersions: z.ZodRecord<z.ZodString, z.ZodString>;
        checkedAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    evidence: z.ZodOptional<z.ZodObject<{
        processStartedAt: z.ZodOptional<z.ZodISODateTime>;
        worldReadyAt: z.ZodOptional<z.ZodISODateTime>;
        gameplay: z.ZodLiteral<"unverified">;
        exitReason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    id: z.ZodPipe<z.ZodUUID, z.ZodTransform<WorkbenchId, string>>;
    cwd: z.ZodString;
    action: z.ZodEnum<{
        prepare: "prepare";
        build: "build";
        client: "client";
        server: "server";
    }>;
    phase: z.ZodEnum<{
        ready: "ready";
        cancelled: "cancelled";
        preparing: "preparing";
        validating: "validating";
        building: "building";
        starting: "starting";
        running: "running";
        stopping: "stopping";
        exited: "exited";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    startedAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    message: z.ZodString;
    exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    logPath: z.ZodString;
    eulaPath: z.ZodOptional<z.ZodString>;
    crashReports: z.ZodOptional<z.ZodArray<z.ZodString>>;
    steps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        phase: z.ZodEnum<{
            ready: "ready";
            cancelled: "cancelled";
            preparing: "preparing";
            validating: "validating";
            building: "building";
            starting: "starting";
            running: "running";
            stopping: "stopping";
            exited: "exited";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        message: z.ZodString;
        at: z.ZodISODateTime;
        received: z.ZodOptional<z.ZodNumber>;
        total: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    failure: z.ZodOptional<z.ZodObject<{
        kind: z.ZodEnum<{
            unknown: "unknown";
            build: "build";
            network: "network";
            "rate-limit": "rate-limit";
            checksum: "checksum";
            "disk-full": "disk-full";
            permission: "permission";
        }>;
        retryable: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * Validates locked dependency source coordinates at the storage boundary.
 */
export declare const dependencySourceSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"modrinth">;
    projectId: z.ZodString;
    versionId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"curseforge">;
    projectId: z.ZodNumber;
    fileId: z.ZodNumber;
    publisherHash: z.ZodOptional<z.ZodObject<{
        algorithm: z.ZodLiteral<"sha1">;
        value: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"maven">;
    repository: z.ZodURL;
    coordinate: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"local">;
    path: z.ZodString;
}, z.core.$strip>], "kind">;
/**
 * Validates dependency roles, graph references and content-addressed artifact paths.
 */
export declare const dependencySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    modId: z.ZodOptional<z.ZodString>;
    role: z.ZodEnum<{
        optional: "optional";
        required: "required";
        test: "test";
    }>;
    enabled: z.ZodBoolean;
    source: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"modrinth">;
        projectId: z.ZodString;
        versionId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"curseforge">;
        projectId: z.ZodNumber;
        fileId: z.ZodNumber;
        publisherHash: z.ZodOptional<z.ZodObject<{
            algorithm: z.ZodLiteral<"sha1">;
            value: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"maven">;
        repository: z.ZodURL;
        coordinate: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"local">;
        path: z.ZodString;
    }, z.core.$strip>], "kind">;
    sha256: z.ZodString;
    file: z.ZodString;
    dependencies: z.ZodArray<z.ZodString>;
    automatic: z.ZodBoolean;
    compatibility: z.ZodEnum<{
        unknown: "unknown";
        verified: "verified";
    }>;
    warnings: z.ZodArray<z.ZodString>;
    sourcesFile: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Validates the complete versioned dependency lockfile.
 */
export declare const manifestSchema: z.ZodObject<{
    format: z.ZodLiteral<1>;
    dependencies: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        version: z.ZodString;
        modId: z.ZodOptional<z.ZodString>;
        role: z.ZodEnum<{
            optional: "optional";
            required: "required";
            test: "test";
        }>;
        enabled: z.ZodBoolean;
        source: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"modrinth">;
            projectId: z.ZodString;
            versionId: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"curseforge">;
            projectId: z.ZodNumber;
            fileId: z.ZodNumber;
            publisherHash: z.ZodOptional<z.ZodObject<{
                algorithm: z.ZodLiteral<"sha1">;
                value: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"maven">;
            repository: z.ZodURL;
            coordinate: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"local">;
            path: z.ZodString;
        }, z.core.$strip>], "kind">;
        sha256: z.ZodString;
        file: z.ZodString;
        dependencies: z.ZodArray<z.ZodString>;
        automatic: z.ZodBoolean;
        compatibility: z.ZodEnum<{
            unknown: "unknown";
            verified: "verified";
        }>;
        warnings: z.ZodArray<z.ZodString>;
        sourcesFile: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * Validate a workbench response before browser or desktop consumers use its fields.
 * @param endpoint - Requested workbench operation.
 * @param value - Untrusted decoded response payload.
 * @returns The validated response, with unknown fields removed.
 */
export declare function parseWorkbenchResponse(endpoint: string, value: unknown): unknown;
//# sourceMappingURL=contracts.d.ts.map