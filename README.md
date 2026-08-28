# Portfolio Dashboard · FIRE Tracker

Multi-currency personal portfolio dashboard with live prices for Turkish stocks, Turkish funds, global equities and cash.

## Features

- 📊 **Multi-asset tracking**: BIST (Turkish stocks), TEFAS (Turkish funds), Global equities, Cash
- 💱 **Live currency rates** (Frankfurter / European Central Bank)
- 📈 **Live prices via public sources**:
  - 🇹🇷 BIST → İş Yatırım (no key)
  - 📊 TEFAS → tefas.gov.tr, falling back to FonBul (no key)
  - 🌐 Global → Finnhub (key on the server, nothing to enter)
- 🔄 **Automatic refresh** on a per-source schedule — equities while their
  markets are open, funds a few times a day (TEFAS publishes once each evening)
- 🎯 **5-stage FIRE journey**: Coast → Barista → Lean → Regular → Fat
- 💰 **Sub-portfolios** with custom names + colors
- 🌐 **Multi-currency display**: TRY / USD / EUR
- 🌓 **Dark + Light themes**, 🇬🇧 English + 🇹🇷 Turkish
- 💾 **JSON backup** + **CSV export** for transaction history
- 📱 **Installable as a PWA** — opens like a native app

## Quick install (use it like a desktop app)

You have two installation paths. **Pick one based on your situation:**

### Path A: Deploy to Vercel + install PWA (recommended)

Best for: anyone who wants the app **always available** without running terminal commands. Free for personal use.

1. **Get a GitHub account** at [github.com](https://github.com) if you don't have one
2. **Push this folder to a new GitHub repo:**
   ```bash
   cd portfolio-dashboard
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   # Create a new repo on github.com (no need to add a README — we have one)
   # Then connect it:
   git remote add origin https://github.com/YOUR_USERNAME/portfolio-dashboard.git
   git push -u origin main
   ```
3. **Deploy to Vercel:**
   - Go to [vercel.com](https://vercel.com) → Sign up with GitHub
   - Click **"Add New..." → "Project"**
   - Pick your `portfolio-dashboard` repo → click **Import**
   - Leave all settings as defaults — Vercel auto-detects Vite + the `api/` folder
   - Click **Deploy**
   - Wait ~30 seconds. You'll get a URL like `portfolio-dashboard-yourusername.vercel.app`
4. **Install as a PWA:**
   - Open the Vercel URL in **Chrome / Edge / Brave** (desktop) or **Chrome** on Android
   - You'll see an "Install as app" banner in the bottom-right corner → click **Install**
   - The app opens in its own window with no browser chrome
   - **Drag the icon to your Dock** (Mac) or pin to taskbar (Windows)

   On **iPhone/iPad** (Safari): tap the Share button → "Add to Home Screen"

5. **You're done.** Click the dock/home-screen icon anytime → instant dashboard. No terminal, no `npm` commands.

### Path B: Local-only (no GitHub, no Vercel)

Best for: keeping everything offline / private on your own machine.

```bash
cd portfolio-dashboard
npm install
npm run dev:full
```

Open http://localhost:5173. The PWA install prompt won't show on `localhost` (browsers don't allow PWAs from localhost), but the app works the same way.

To make local launch easier, see **"Easier local launch"** below.

## Easier local launch (Mac)

If you stay local-only, here's a one-click launcher to skip typing commands:

1. Open **TextEdit** → **Format menu → Make Plain Text**
2. Paste this, replacing `YOUR_PATH_HERE` with the full path to your project folder:
   ```bash
   #!/bin/bash
   cd "/Users/YOUR_USERNAME/Desktop/Desktop Folder/Bireysel Projeler/Hisse Projesi/Master Portfolio/portfolio-dashboard"
   npm run dev:full
   ```
3. Save as **portfolio.command** to your Desktop (uncheck "Hide Extension" if visible)
4. In Terminal, run: `chmod +x ~/Desktop/portfolio.command`
5. Now double-click `portfolio.command` on your Desktop → Terminal opens, app starts

To stop: just close the Terminal window.

## Update from a previous version

```bash
# Stop both servers (Ctrl+C in the terminal running npm run dev:full)
# Replace folder contents with new zip
npm install
npm run dev:full
```

Existing data persists in localStorage.

## Setup (first time)

Requires Node.js 22+. macOS: `brew install node@22`.

> Node 20 is not enough any more, for two separate reasons that happen to
> land together: `@supabase/supabase-js` declares `engines: node >=22`, and
> Vercel removes the Node 20 runtime on 1 October 2026 — after which the
> `api/*` functions stop building.

```bash
cd portfolio-dashboard
npm install
npm run dev:full
```

Open http://localhost:5173.

## Global stocks: the key lives on the server

Stooq closed its free CSV endpoint in March 2026, so global equities come from
Finnhub. **You do not enter a key in the app** — it is a server environment
variable (`FINNHUB_KEY`), read by `api/global.js` and `api/refresh-prices.js`.

That is deliberate. When the key was per-browser it had to be re-typed on every
device, it sat in plain view in the browser's network requests, and every device
spent the same quota fetching the same symbol.

For local development, put it in `.env.local`; `dev-proxy.js` picks it up. On
Vercel, add it under Settings → Environment Variables, marked **Sensitive**.

## Project structure

```
portfolio-dashboard/
├── api/                  # Vercel serverless functions / Express routes
│   ├── _http.js          # Shared timeout / CORS / cache helpers
│   ├── bist.js           # BIST stock prices via İş Yatırım
│   ├── tefas.js          # TEFAS fund prices via tefas.gov.tr → FonBul
│   ├── global.js         # Global equity prices via Finnhub
│   └── refresh-prices.js # Scheduled fetch → writes the shared prices table
├── public/               # Static assets (icons, manifest, service worker)
├── src/
│   ├── components/       # UI components
│   ├── lib/              # Business logic (calculations, store, API clients)
│   ├── pages/            # Route components
│   └── i18n/             # English + Turkish translations
├── dev-proxy.js          # Local dev: Express server mounting api/* handlers
├── vercel.json           # Vercel deploy config
└── vite.config.js        # Vite + /api proxy config
```

## How it works locally

Two servers run side-by-side during development:

- **Vite** on `:5173` → frontend with hot reload
- **Express** on `:3001` → mounts `api/bist.js`, `api/tefas.js`, `api/global.js` as routes

Vite's dev server proxies `/api/*` → `localhost:3001`, so the React app makes plain `fetch('/api/bist?...')` calls just as it would in production.

In production (Vercel), the same `api/*.js` files become serverless functions automatically. Same code, two deployment targets.

## Privacy

- All data stored in **browser localStorage** (your machine, your data)
- JSON backups **strip the Finnhub API key** before saving
- API calls go directly from your browser/serverless functions to public sources — no middleman
- No analytics, no tracking, no account required
