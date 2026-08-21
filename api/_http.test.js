// The gate every price endpoint passes through.
//
// It is four lines of header-setting, which is exactly why it is worth pinning:
// a mistake here is invisible in the app — the endpoints keep working for the
// person testing them, and the failure only shows up as somebody else's traffic
// on your Alpha Vantage quota.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { applyCors, parseSymbols } from './_http.js'

const ORIGIN = 'https://portfolio-dashboard-eta-one.vercel.app'

function mockRes() {
  const res = {
    headers: {},
    statusCode: null,
    body: undefined,
    ended: false,
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    end() {
      this.ended = true
      return this
    },
  }
  return res
}

const req = (over = {}) => ({ method: 'GET', headers: {}, ...over })

describe('applyCors with ALLOWED_ORIGIN unset', () => {
  beforeEach(() => {
    delete process.env.ALLOWED_ORIGIN
  })

  it('allows anyone, so local dev and preview deployments keep working', () => {
    // Preview URLs are generated per deployment and cannot be listed ahead of
    // time. Locking them out would mean every branch deploy is broken on
    // arrival, which teaches people to ignore the setting entirely.
    const res = mockRes()
    expect(applyCors(req({ headers: { origin: 'https://somewhere-else.test' } }), res)).toBe(false)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
  })
})

describe('applyCors with ALLOWED_ORIGIN set', () => {
  beforeEach(() => {
    process.env.ALLOWED_ORIGIN = ORIGIN
  })
  afterEach(() => {
    delete process.env.ALLOWED_ORIGIN
  })

  it('lets the app itself through', () => {
    const res = mockRes()
    expect(applyCors(req({ headers: { origin: ORIGIN } }), res)).toBe(false)
    expect(res.headers['Access-Control-Allow-Origin']).toBe(ORIGIN)
  })

  it('lets a request with no Origin through', () => {
    // The app is served from this same domain, so its own fetch is same-origin
    // and the browser may send no Origin at all. Refusing that would take the
    // app down while stopping nobody: a script simply omits the header too.
    const res = mockRes()
    expect(applyCors(req(), res)).toBe(false)
    expect(res.statusCode).toBeNull()
  })

  it('refuses another site outright instead of only withholding the header', () => {
    // Withholding it lets the function run, call upstream and spend the quota,
    // and only then has the browser throw the answer away. All of the cost and
    // none of the protection.
    const res = mockRes()
    expect(applyCors(req({ headers: { origin: 'https://somewhere-else.test' } }), res)).toBe(true)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'Origin not allowed' })
  })

  it('refuses a preflight from another site too', () => {
    const res = mockRes()
    const stop = applyCors(
      req({ method: 'OPTIONS', headers: { origin: 'https://somewhere-else.test' } }),
      res
    )
    expect(stop).toBe(true)
    expect(res.statusCode).toBe(403)
  })

  it('always varies on Origin, or a CDN serves one caller the other reply', () => {
    // The responses carry s-maxage, so they sit in Vercel's edge cache. Without
    // Vary, the first caller's Access-Control-Allow-Origin is handed to the
    // next one — which either leaks access or denies it at random.
    const res = mockRes()
    applyCors(req({ headers: { origin: ORIGIN } }), res)
    expect(res.headers.Vary).toBe('Origin')
  })
})

describe('applyCors method guard', () => {
  it('answers a preflight and stops', () => {
    const res = mockRes()
    expect(applyCors(req({ method: 'OPTIONS' }), res)).toBe(true)
    expect(res.statusCode).toBe(204)
    expect(res.ended).toBe(true)
  })

  it('refuses anything that is not a GET', () => {
    const res = mockRes()
    expect(applyCors(req({ method: 'POST' }), res)).toBe(true)
    expect(res.statusCode).toBe(405)
  })
})

describe('parseSymbols', () => {
  it('upper-cases, trims and de-duplicates', () => {
    expect(parseSymbols(' thyao, akbnk ,THYAO', 10).symbols).toEqual(['THYAO', 'AKBNK'])
  })

  it('refuses an empty list rather than fetching nothing', () => {
    expect(parseSymbols('', 10).error).toBeTruthy()
    expect(parseSymbols(',, ,', 10).error).toBeTruthy()
  })

  it('caps the batch, since the whole list rides one upstream request', () => {
    expect(parseSymbols('A,B,C', 2).error).toBeTruthy()
    expect(parseSymbols('A,B', 2).symbols).toEqual(['A', 'B'])
  })
})
