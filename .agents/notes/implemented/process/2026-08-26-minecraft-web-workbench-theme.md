# Agent Note: Minecraft workbench web theme

Status: implemented

English | [中文](2026-08-26-minecraft-web-workbench-theme.zh.md)

## Problem

The browser client presents a general-purpose DeepSeek surface, while this repository's primary product direction includes Minecraft mod development. The interface needs a recognizable Minecraft workbench identity without coupling presentation to session state or changing the Web protocol.

## Decision

`ui-theme` owns a Minecraft skin layered over the existing `--dsw-*` token system. Light and dark palettes use stone, deepslate, moss, ore, gold, and redstone roles. A locally published Press Start 2P face is limited to short display labels; body text and CJK use the existing readable stacks. Sidebar, conversation, composer, settings surfaces, menus, and boot/failure states consume the shared tokens and use flat inventory-style chrome without pixel shadows. Most chrome stays square; the no-Workspace composer trigger uses an 8px radius and a lighter l2 border to distinguish the picker affordance. The attach and send controls share the selector fill, with a gold hover state; the send control sits 1px lower for visual alignment. Key empty and loading copy uses crafting language while functional labels and accessibility names remain explicit.

The CraftCode project mark uses the supplied Minecraft-block and blue-tail artwork across browser favicon, PWA metadata, sidebar, and empty-session Hero. The Web public `/favicon.svg` embeds a transparent PNG derived from the supplied image, and the shared `FishLogo` atom renders that same URL at a stable square size. The Hero owns the mark's hover transform and disables it under `prefers-reduced-motion: reduce`.

The remaining skin is CSS-only at the presentation boundary. Existing React trees, slot contracts, session events, composer scroll ownership, theme preference handling, and module manifests remain unchanged. The font is served from the Web public asset path and carries its SIL Open Font License notice.

## Alternatives considered

**A separate Minecraft preset theme:** rejected because the requested identity applies to the whole Web client and would duplicate the token and component surface.

**Replacing the component trees with a game HUD:** rejected because it would risk keyboard, responsive, and accessibility contracts for a visual change.

**An external font or texture CDN:** rejected because the Web client must remain usable in offline and local deployments.

**Separate favicon and in-app artwork:** rejected because independent copies can drift and add avoidable browser payload.

## Consequences

All Web clients receive the Minecraft workbench appearance and project mark, including light and dark modes. Borders and color layers communicate elevation without hard-edged pixel shadows; focus rings and pressed-position feedback remain visible. Visual snapshots and style-order tests must account for the added global sheet. The design deliberately keeps long-form content readable and preserves existing geometry-sensitive interaction behavior. The local font and embedded color mark increase the Web public payload but avoid runtime network dependencies and duplicate brand assets.

## Verification

The theme sheet is mounted and disposed through the existing `ui-theme` lifecycle test. Boot-page and conversation locale tests pin the key visible copy. Component and PWA tests pin the shared mark URL, square sizing, embedded transparent PNG, and the absence of the former monochrome path. Focus, reduced-motion, Hero hover motion, sidebar collapse, composer geometry, theme switching, and Web build checks cover the presentation contract; browser screenshots provide desktop/mobile light/dark evidence.
