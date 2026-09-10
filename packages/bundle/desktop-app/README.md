# `@deepseek-ai/dsh-desktop-app`

English | [中文](README.zh.md)

The private Electron application bundle. It layers the desktop host, API gateway, workspace services, client roster, and renderer runtime over [`dsh-base`](../base/README.md). The runtime resolves `apps/desktop/dist/index.html`, mounts it through [`dsh-host-frontend-static`](../../host/frontend-static/README.md), and prints a `dsh desktop: http://127.0.0.1:<port>` readiness line for Electron after the Loader tree settles.

The bundle binds loopback only. It never opens an external browser and exposes no standalone Web or PWA entry. `--port` is the only desktop application flag; omitted values use port `3080`, while Electron development passes `0` for an OS-assigned port. `surfaceContext` controls the model-facing desktop orientation and `DSH_DESKTOP_URL` shell variable; `printUrl` controls readiness output. The local HTTP server remains an internal transport for the Electron renderer.

The client-plugin HMR receiver is always mounted and stays idle until `pnpm run dev:desktop-renderer` rebuilds the client artifacts. [`dsh-headless`](../headless/README.md) is a sibling profile over the same base and does not mount this bundle.

## Model Experience

### Desktop surface

#### What the model sees

When `surfaceContext` is enabled, the bundle adds the Harness source location and `app:desktop-surface` orientation to model requests. The orientation identifies the loopback desktop renderer and tells the model not to start a replacement server.

#### Token effect

The orientation is a short fixed prefix and adds only its rendered text to each assembled request.

#### KV Cache effect

The fixed orientation remains reusable in the request prefix; the dynamic local port is supplied through the shell environment instead of the prompt.

## Known Limitations and Deferred Work

- The HTTP carrier is intentionally private to Electron and has no remote-authentication or public-hosting contract.
- Renderer artifacts must be built before the bundle can serve them.
