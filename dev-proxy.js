// Local development proxy — runs the same /api handlers locally.
// Use during dev: npm run proxy (or npm run dev:full for both Vite + this).
//
// This file is NOT used in production — Vercel runs api/*.js as serverless
// functions automatically. This is just so localhost development works without
// deploying.

import express from 'express'
import { bistHandle } from './api/bist.js'
import { tefasHandle } from './api/tefas.js'
import { globalHandle } from './api/global.js'

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`\n🚀 Dev proxy listening on http://localhost:${PORT}`)
  console.log(`   • GET /api/bist?symbols=THYAO,AKBNK`)
  console.log(`   • GET /api/tefas?symbols=AFA,TI2`)
  console.log(`   • GET /api/global?symbols=AAPL,VOO`)
  console.log(`   • GET /api/health\n`)
})
