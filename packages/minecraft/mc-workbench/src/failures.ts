/** Stable failure categories shared by retained tasks and download consumers. */
import type { RunFailure } from './types.ts'

/**
 * Classify failures without retaining network credentials or arbitrary response bodies.
 * @param error - Failure raised by the owning operation.
 * @returns Failure category and whether explicit retry is useful.
 */
export function classifyFailure(error: unknown): RunFailure {
  const code = error instanceof Error && 'code' in error ? String(error.code) : ''
  switch (code) {
    case 'ENOSPC':
      return { kind: 'disk-full', retryable: true }
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return { kind: 'permission', retryable: true }
    case 'CHECKSUM':
      return { kind: 'checksum', retryable: true }
    case 'RATE_LIMIT':
      return { kind: 'rate-limit', retryable: true }
    case 'NETWORK':
      return { kind: 'network', retryable: true }
    case 'COMPILE':
      return { kind: 'build', retryable: false }
    default:
      return { kind: 'unknown', retryable: false }
  }
}
