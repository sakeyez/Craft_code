# Agent Note: Desktop owns the renderer entry

Status: implemented

English | [中文](2026-09-10-desktop-owns-the-renderer-entry.zh.md)

## Problem

The repository carried an Electron shell and a separately packaged Web application over the same renderer. That exposed two product entry points, two application bundles, browser-opening behavior, and PWA metadata even though CraftCode is distributed and operated as a desktop application.

## Decision

`apps/desktop` owns the only interactive product entry. Its renderer source lives under `apps/desktop/renderer` and builds to `apps/desktop/dist`; it has no workspace package or publication identity. `@deepseek-ai/dsh-desktop-app` owns the host composition and serves that dist on loopback only so Electron can retain the existing HTTP, API, and session transports.

The public `dsh web` command and Web profile do not exist. The private `dsh desktop` command selects the desktop profile, accepts only an optional port, never opens a browser, and prints `dsh desktop:` readiness for the Electron supervisor. Headless profiles contain no desktop bundle.

## Verification

Profile and CLI tests reject `dsh web` and pin the desktop/headless bundle tuples. Desktop supervisor tests cover readiness, graceful shutdown, and abnormal termination. Renderer browser tests remain under the desktop application to cover UI behavior, while standalone browser and PWA tests are absent. Workspace constraints, Cordis config validation, TypeScript builds, renderer builds, and documentation synchronization cover the remaining package and path references.

## Alternatives considered

- Keep `dsh web` as a compatibility alias. Rejected because the product is pre-release and the alias would preserve a second supported entry point.
- Replace the local HTTP transport with Electron IPC. Rejected because it would require an unrelated rewrite of the API, session, and plugin transport layers; loopback-only serving provides the required ownership boundary.
- Keep the renderer as a nested publishable package. Rejected because the renderer is an application-owned build input, not an independently versioned product.

## Consequences

Electron packaging and development must build the renderer before starting the backend. Reintroducing a standalone browser product requires a new ownership, authentication, publication, and test decision rather than enabling Vite serve or exposing the desktop loopback endpoint.
