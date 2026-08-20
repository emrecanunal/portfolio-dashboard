// The TEFAS endpoint returns a MONTH of daily rows, oldest first. Reading
// resultList[0] gives you a four-week-old price that looks entirely plausible
// on screen — the kind of wrong number nobody catches. These tests pin down
// which row gets picked.
//
// The payloads below are shaped from a real response (fund AFA, August 2026):
//   { fonKodu, fonUnvan, kategoriDerece, kategoriFonSay, tarih: '2026-07-20', fiyat: 1.209905 }

import { describe, it, expect } from 'vitest'
import { pickLatest } from './tefas.js'

const row = (tarih, fiyat) => ({
  fonKodu: 'AFA',
  fonUnvan: 'AK PORTFÖY AMERİKA YABANCI HİSSE SENEDİ FONU',
  tarih,
  fiyat,
})

describe('pickLatest', () => {
  it('takes the newest row when they arrive oldest first', () => {
    const { latest, previous } = pickLatest([
      row('2026-07-20', 1.209905),
      row('2026-07-21', 1.22),
      row('2026-08-19', 1.27),
      row('2026-08-20', 1.278562),
    ])
    expect(latest.price).toBeCloseTo(1.278562, 6)
    expect(previous.price).toBeCloseTo(1.27, 6)
  })

  it('takes the newest row when they arrive newest first', () => {
    const { latest } = pickLatest([row('2026-08-20', 1.278562), row('2026-07-20', 1.209905)])
    expect(latest.price).toBeCloseTo(1.278562, 6)
  })

  it('handles day-first dates, whatever the separator', () => {
    for (const [older, newer] of [
      ['20.07.2026', '20.08.2026'],
      ['20/07/2026', '20/08/2026'],
      ['20-07-2026', '20-08-2026'],
    ]) {
      const { latest } = pickLatest([row(older, 1.2), row(newer, 1.9)])
      expect(latest.price).toBeCloseTo(1.9, 6)
    }
  })

  it('handles epoch milliseconds', () => {
    const { latest } = pickLatest([
      row(Date.UTC(2026, 6, 20), 1.2),
      row(Date.UTC(2026, 7, 20), 1.9),
    ])
    expect(latest.price).toBeCloseTo(1.9, 6)
  })

  it('falls back to the documented oldest-first order when no date parses', () => {
    // If TEFAS ships a format we don't recognise, every row scores 0 and a
    // stable sort would quietly return the OLDEST price. Trust the ordering.
    const { latest, previous } = pickLatest([
      row('gecersiz', 1.2),
      row('gecersiz', 1.25),
      row('gecersiz', 1.278562),
    ])
    expect(latest.price).toBeCloseTo(1.278562, 6)
    expect(previous.price).toBeCloseTo(1.25, 6)
  })

  it('skips rows with no usable price', () => {
    const { latest } = pickLatest([
      row('2026-08-20', 0),
      row('2026-08-19', null),
      row('2026-08-18', 1.27),
    ])
    expect(latest.price).toBeCloseTo(1.27, 6)
  })

  it('accepts Turkish-formatted price strings', () => {
    const { latest } = pickLatest([row('2026-08-20', '1,27856')])
    expect(latest.price).toBeCloseTo(1.27856, 6)
  })

  it('reports nothing usable rather than guessing', () => {
    expect(pickLatest([]).latest).toBeNull()
    expect(pickLatest([row('2026-08-20', 0)]).latest).toBeNull()
  })

  it('leaves previous null on a single row, so day change reads as flat', () => {
    const { latest, previous } = pickLatest([row('2026-08-20', 1.27)])
    expect(latest.price).toBeCloseTo(1.27, 6)
    expect(previous).toBeNull()
  })
})
