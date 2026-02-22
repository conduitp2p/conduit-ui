# Conduit UI

**Web dashboard for Conduit nodes.**

A single-page application served by every Conduit node. Browse the content
catalog, buy digital assets with Lightning, manage your wallet, and visualize
the network — all from the browser.

## Features

- **Catalog** — browse and search registered content across the network
- **Buy** — one-click PRE purchases with real-time step-by-step progress (SSE)
- **Wallet** — check balance, generate addresses, view payment history
- **Creator** — register and price your content
- **Seeder** — monitor seeding status and chunk availability
- **Network** — D3.js force-directed graph of Lightning channel topology
- **Events** — live SSE event stream for debugging
- **Settings** — node configuration
- **Library** — view purchased content
- **Advertiser** — manage ad campaigns and creatives

## Two ways to run

### 1. Standalone HTML (no build step)

Open `dashboard.html` directly in a browser or serve it from any static
file server. All CSS and JS are embedded — works offline.

```bash
open dashboard.html
```

### 2. Vite dev server (for development)

```bash
npm install
npm run dev
```

This serves the modular ES module version from `src/` with hot reload.

### Production build

```bash
npm run build
```

Output goes to `dist/`, which is what gets deployed to nodes via GitHub Actions.

## Project structure

```
conduit-ui/
├── dashboard.html       Standalone single-file version
├── dashboard.css        Extracted stylesheet (standalone)
├── dashboard.js         Extracted JS (standalone)
├── index.html           Vite entry point
├── vite.config.js       Vite configuration
├── package.json
├── src/
│   ├── main.js          App entry point
│   ├── router.js        Tab navigation
│   ├── state.js         Shared application state
│   ├── sse.js           Server-Sent Events client
│   ├── onboarding.js    First-run onboarding flow
│   ├── utils.js         Shared utilities
│   ├── dashboard.css    Styles
│   ├── tabs/
│   │   ├── wallet.js
│   │   ├── creator.js
│   │   ├── seeder.js
│   │   ├── collection.js
│   │   ├── network.js
│   │   ├── events.js
│   │   ├── settings.js
│   │   ├── library.js
│   │   └── advertiser.js
│   └── buy/
│       ├── index.js     Buy flow orchestration
│       ├── pre.js       PRE purchase UI
│       ├── direct.js    Direct purchase UI
│       ├── chunked.js   Chunked/seeder purchase UI
│       └── ad.js        Ad-subsidized purchase UI
├── public/
│   ├── icon-192.png
│   └── icon-512.png
├── manifest.json        PWA manifest
└── sw.js                Service worker
```

## Deployment

Push to `main` on `conduitp2p/conduit-ui` triggers a GitHub Actions workflow
that copies static assets to all node droplets. The Conduit node binary
(`conduit-setup`) serves these files via `tower-http::ServeDir`.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT License ([LICENSE-MIT](LICENSE-MIT))

at your option.
