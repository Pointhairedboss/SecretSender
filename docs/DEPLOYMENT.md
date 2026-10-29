# SecretSender v1.1 setup and deployment

This guide describes the checked-in Worker implementation at `16921db57c285cd3fcdebd72243f04a1d7fb6557`. Repository source and local tests do not establish which revision is currently deployed. The documentation correction itself does not deploy anything or change production keys, bindings or the entropy pipeline.

## Prerequisites

- Node.js compatible with all dependencies. `package.json` says `>=20.0.0`, but `@noble/post-quantum@0.6.1` requires **>=20.19.0**. Use a supported Node version meeting that higher minimum.
- npm, and Wrangler for Worker development/deployment. Wrangler is invoked through `npx` by the package scripts and is **not pinned** in the package manifest or lockfile.
- A browser secure context: HTTPS or `http://localhost` for WebCrypto. Plain HTTP on a LAN IP is insufficient.
- A compatible BitBop Worker/coordinator for escrow operations. A static-only host cannot serve this application's API.
- Chromium installed for the complete E2E suite; a physical phone/ADB is optional and separate.

## Local setup

```bash
git clone https://github.com/Pointhairedboss/SecretSender.git
cd SecretSender
npm install --package-lock=false
npm run build:cf
npm start
```

Open `http://localhost:5179`. `npm start` builds the static assets and runs `npx wrangler dev --port 5179`. `npm run preview:cf` also builds and runs Wrangler but leaves its port at Wrangler's default. The build writes `public/index.html` from `scripts/client_template.mjs` and copies `mlkem.browser.js` into `public/`; edit the template rather than treating generated HTML as the source.

**Current installation discrepancy:** the committed lockfile omits `@noble/post-quantum` and its transitive dependencies. `npm ci` fails with an out-of-sync-lockfile error. The command above is an explicit local-development workaround that leaves the committed lockfile unchanged; it is not a reproducible release install. Repair and review the lockfile in a separate implementation change before relying on `npm ci` in a release pipeline.

### Bindings and environment

These are Worker `env` bindings, not a Node server's `process.env` listener configuration.

| Binding / variable | Current behavior |
| --- | --- |
| `ASSETS` | Required static-assets binding for UI/asset delivery; Wrangler supplies it from `public/` |
| `BITBOP_API` | Optional in code, configured in `wrangler.jsonc` as service `bitbop-api`. Its `fetch` takes priority over public HTTPS |
| `BITBOP_API_BASE` | Default `https://api.bitbop.dev`. Supplies upstream request URLs; without `BITBOP_API`, requests use ordinary HTTPS fetch |
| `PUBLIC_ORIGIN` | Optional base origin for returned claim links; defaults to the incoming request origin. Set only to the intended recipient-accessible application origin. `127.0.0.1` is normalized to `localhost` |
| `BITBOP_SAMPLE_API_KEY` | Optional server credential for `is_sample: true` requests without a caller bearer token |
| `BITBOP_API_KEY` | Fallback credential for samples, and for synthetic reflector sealing without a caller bearer token. Does **not** authorize ordinary `/api/share` calls without their own bearer token |
| `SERVICE_PUBLIC_KEY_MLDSA44_B64` | Optional Worker-side override for the public key at `mldsa44-release-2026-01`. It is public verification material, not a signing private key; the browser pin is independent |

`HOST` and `PORT` are not application runtime settings; use Wrangler CLI options for local listen addresses/ports. There is no root `server.mjs`, automatic startup key minting, systemd deployment or Node/Docker application-server path.

For isolated development, configure Wrangler's service binding to a **local compatible BitBop service**. The repository does not include or launch that service. `BITBOP_API_BASE` alone does not bypass a configured service binding: configure or remove that binding in an untracked local Wrangler config before selecting an HTTPS upstream. Without a service binding, the default upstream is public BitBop, so escrow operations can consume real quota/state.

If local values are needed, put them in an untracked `.dev.vars` file (or pass an untracked Wrangler config with `--config`). The repository's `.gitignore` does not currently exclude `.dev.vars`: add it to `.git/info/exclude` **before** creating it. Use development credentials, keep them out of source/generated assets, and use placeholders in shared examples.

The browser explicitly mints a key only when the user selects **Start Free Trial**, or accepts an entered key. Actual membership status and quotas come from BitBop; UI labels are not independent entitlement checks.

### Browser pins and upstream compatibility

Both `worker/index.mjs` and `mlkem.browser.js` contain the pinned public release-key map. Setting `SERVICE_PUBLIC_KEY_MLDSA44_B64` changes only the Worker verifier. A separately keyed development upstream needs matching **test-only** browser verification material too; the E2E harness injects its ephemeral test public key into served assets. Do not change a production pin simply to make a test pass. The app needs no signing private key or entropy-collector credentials.

### Optional USB phone access

With the local Worker running on port 5179 and an authorized Android device connected:

```bash
adb reverse tcp:5179 tcp:5179
adb shell am start -a android.intent.action.VIEW -d "http://localhost:5179" com.android.chrome
```

For several devices, select the intended serial with `adb -s <serial>`. This tests the local Worker over USB, not the current public deployment. The older hardware UAT runners require additional review described in [TEST_INFRA.md](../TEST_INFRA.md).

## Release preparation and deployment reference

The committed `wrangler.jsonc` declares:

- entrypoint `worker/index.mjs`, `nodejs_compat`, compatibility date `2026-10-01`;
- static assets in `public/` bound as `ASSETS`, with **`run_worker_first: true`**;
- the `BITBOP_API` service binding targeting `bitbop-api`;
- custom-domain route `secrets.bitbop.dev`.

Before a separately authorized release, verify the account, intended domain, service binding, upstream `secretsender-v2` support, matching public verification pins and required development/release credentials. Reconcile the lockfile and choose a reviewed Wrangler version. No SecretSender KV/database or entropy hardware binding is declared; upstream escrow state belongs to BitBop.

Build and inspect the bundle without publishing:

```bash
npm run build:cf
npx wrangler deploy --dry-run --outdir /tmp/secretsender-worker-preview
```

The package's actual publishing command is `npm run deploy`, which rebuilds assets and invokes `npx wrangler deploy`. It changes the remote service; run it only as a separate, authorized release operation. It is not a verification command. This documentation PR does not run it.

After an authorized deployment, `GET /health` can identify the application profile, and response-header checks can confirm edge behavior. Neither proves the deployed Git SHA, upstream availability, successful browser cryptography or entropy provenance. Record deployment-version evidence and run synthetic browser checks on a dedicated test target; never use a real recipient claim as a smoke test. Follow [TEST_INFRA.md](../TEST_INFRA.md).
