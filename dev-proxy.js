// Local development proxy — runs the same /api handlers locally.
// Use during dev: npm run proxy (or npm run dev:full for both Vite + this).
//
// This file is NOT used in production — Vercel runs api/*.js as serverless
// functions automatically. This is just so localhost development works without
// deploying.

import express from 'express'
import { readFileSync } from 'node:fs'

// Vercel injects environment variables; locally they come from .env.local,
// which .gitignore already covers. ALPHAVANTAGE_KEY is read server-side on
// purpose, so without this the local /api/history would answer AV_NO_KEY
// while the deployed one worked — the most confusing kind of difference.
try {
  for (const line of readFileSync(new URL('./.env.local', import.meta.url), 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const value = match[2].replace(/^['"]|['"]$/g, '').trim()
    if (value && !process.env[match[1]]) process.env[match[1]] = value
  }
} catch {
  // No .env.local is normal.
}
import { bistHandle } from './api/bist.js'
import { tefasHandle } from './api/tefas.js'
import { globalHandle } from './api/global.js'
import { historyHandle } from './api/history.js'

const PORT = 3001
const app = express()

// CORS — allow Vite (5173) and any other localhost origins
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

// Mount the handlers
app.get('/api/bist', async (req, res) => {
  try {
    const data = await bistHandle(req.query.symbols || '')
    res.json(data)
  } catch (err) {
    console.error('BIST error:', err)
    res.status(500).json({ error: err.message || 'Internal error' })
  }
})

app.get('/api/tefas', async (req, res) => {
  try {
    const data = await tefasHandle(req.query.symbols || '')
    res.json(data)
  } catch (err) {
    console.error('TEFAS error:', err)
    res.status(500).json({ error: err.message || 'Internal error' })
  }
})

app.get('/api/global', async (req, res) => {
  try {
    const data = await globalHandle(req.query.symbols || '')
    res.json(data)
  } catch (err) {
    console.error('Global error:', err)
    res.status(500).json({ error: err.message || 'Internal error' })
  }
})

app.get('/api/history', async (req, res) => {
  try {
    const data = await historyHandle(req.query.type || '', req.query.symbols || '', req.query.months)
    res.json(data)
  } catch (err) {
    console.error('History error:', err)
    res.status(500).json({ error: err.message || 'Internal error' })
  }
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`\n🚀 Dev proxy listening on http://localhost:${PORT}`)
  console.log(`   • GET /api/bist?symbols=THYAO,AKBNK`)
  console.log(`   • GET /api/tefas?symbols=AFA,TI2`)
  console.log(`   • GET /api/global?symbols=AAPL,VOO`)
  console.log(`   • GET /api/history?type=bist&symbols=THYAO&months=24`)
  console.log(`   • GET /api/health\n`)
})
