# Agent Note: Restore desktop clipboard copy controls

Status: implemented

English | [中文](2026-09-14-desktop-clipboard-copy.zh.md)

## Problem

The desktop shell denied every Electron permission request. Chromium therefore refused `navigator.clipboard.writeText` from the renderer, leaving every copy control apparently clickable but ineffective. The JSON tree also called the browser API directly, so it did not share the UI's fallback behavior.

## Decision

The desktop session remains deny-by-default, with one narrow exception: same-origin main-frame pages owned by the launch may request Electron's `clipboard-sanitized-write` permission. The permission check and request handlers apply the same origin and frame checks. All JSON tree copy actions use the shared `writeClipboard` helper, keeping async API and `execCommand` fallback behavior consistent with other copy controls.

## Alternatives considered

**Allow every permission request.** Rejected because the desktop shell must not grant unrelated capabilities to renderer content or navigated frames.

**Allow clipboard reads as well as writes.** Rejected because copy controls only need to write, and read access would expand the renderer's ability to inspect user clipboard contents.

**Keep JSON tree on the raw Clipboard API.** Rejected because it bypasses the fallback path and gives that control different failure behavior from the rest of the UI.

## Consequences

Copy controls work in the Electron desktop renderer while external, sub-frame, read, and unrelated permission requests continue to fail closed. The shared helper still reports refusal rather than claiming success, so controls can present their failure state when the host rejects a write.

## Testing

The desktop window-policy unit suite covers the same-origin main-frame permission predicate. The UI primitives clipboard, terminal, diff, and JSON tree tests pass together, and the desktop main process compiles successfully.
