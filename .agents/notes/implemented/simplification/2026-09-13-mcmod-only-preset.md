# Agent Note: Minecraft-only preset roster

Status: implemented

English | [中文](2026-09-13-mcmod-only-preset.zh.md)

## Problem

General-purpose and user-defined presets can bypass the Minecraft guidance selected by the mcmod composition.

## Decision

The [mcmod bundle](../../../../packages/bundle/mcmod/cordis.patch.yml) exposes only the `mcmod` preset. The agent-presets `allowedIds` allowlist filters discovery, resolution, and mounting; `includeUserRoot: false` excludes the user preset directory. Compositions without this restriction retain their preset roster.

## Alternatives considered

Setting only the default preset leaves other presets selectable. Restricting only the UI does not constrain resolution and mounting. The restriction therefore belongs in the bundle's agent-presets configuration.

## Consequences

The mcmod composition consistently selects Minecraft guidance, at the cost of excluding general-purpose and user-defined presets. The restriction remains local to that composition rather than changing the shared preset service's defaults.
