# Portfolio Dashboard · FIRE Tracker

Multi-currency personal portfolio dashboard with **live prices for ALL asset classes — no API keys required**.

## Features

- 📊 **Multi-asset tracking**: BIST (Turkish stocks), TEFAS (Turkish funds), Global equities, Cash
- 💱 **Live currency rates** (Frankfurter / European Central Bank)
- 📈 **Live prices via free public sources** (no signups required):
  - 🇹🇷 BIST → İş Yatırım
  - 📊 TEFAS → FonBul (Halk Yatırım)
  - 🌐 Global → Stooq
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

Requires Node.js 20+. macOS: `brew install node@20`.

```bash
cd portfolio-dashboard
npm install
npm run dev:full
```

Open http://localhost:5173.

## Optional: intraday prices via Finnhub

By default, global stocks use end-of-day prices via Stooq (no key needed). If you want **intraday** (live during market hours):

1. Sign up free at [finnhub.io](https://finnhub.io) (no credit card)
2. Copy your API key
3. In the app: **Settings → Asset prices → Finnhub API key** → paste it
4. Click "Refresh all prices" — global stocks now use Finnhub

You can clear the field anytime to fall back to Stooq.

## Project structure

```
portfolio-dashboard/
├── api/                  # Vercel serverless functions / Express routes
│   ├── bist.js           # BIST stock prices via İş Yatırım
│   ├── tefas.js          # TEFAS fund prices via FonBul
│   └── global.js         # Global equity prices via Stooq
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
