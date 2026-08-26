# Agent Note: Web profiles include the Minecraft Mod host bundle

Status: implemented

English | [中文](2026-08-24-web-mcmod-profile-bundle.zh.md)

## Problem

The Web roster exposed the shipped `mcmod` preset even when the Web profile did not load its host-side bundle. Selecting the preset then failed because the preset's LSP tool had no `lsp` service, and the browser returned to the standard preset.

## Decision

The shipped Web profile includes `@deepseek-ai/dsh-mcmod-bundle` after the base and Web bundles. Its Java LSP server is optional, so an installation without `jdtls` still boots the Web profile and disables only Java LSP. The launcher upgrades only an exact old installation-owned Web tuple; profiles with additional bundle entries remain user-owned and are not rewritten.

## Alternatives considered

**Hide `mcmod` from the Web roster.** Rejected because Minecraft Mod is a supported Web preset and its prompt and tools are already shipped.

**Always overwrite the Web profile manifest.** Rejected because users may add custom bundles, and those entries must remain under their control.

**Fix only the current profile directory.** Rejected because a fresh installation would reproduce the same incomplete Web composition.

## Consequences

New Web installations can mount the Minecraft Mod preset with its required LSP host rows. Existing untouched Web profiles are upgraded on the next load. Customized Web profiles retain their bundle list and may opt into the Minecraft bundle explicitly. Missing `jdtls` is a diagnostic rather than a Web startup failure.

## Testing

Profile tests cover the new Web template, exact old-tuple upgrade, and preservation of a customized Web tuple. The live Web profile is verified separately by selecting `mcmod` through the local API.
