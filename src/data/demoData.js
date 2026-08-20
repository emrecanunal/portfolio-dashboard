// Realistic demo data so the app shows something interesting on first launch.
//
// KEEP IT INTERNALLY CONSISTENT: every portfolio must deposit at least as much
// as it spends. The dashboard now runs computeDataWarnings() over whatever is
// loaded, so a demo portfolio that buys more than it deposits greets every new
// user with "cash is below zero — a deposit is probably missing". It did
// exactly that until August 2026 (Global deposited $4,000 and bought $8,652).
// demoData.test.js fails if this drifts again.

export const demoSubPortfolios = [
  { id: 'sub-mixed', name: 'Mixed', color: '#10b981' },
  { id: 'sub-t3', name: 'T3', color: '#3b82f6' },
  { id: 'sub-claude-t3', name: 'Claude T3', color: '#a855f7' },
  { id: 'sub-global', name: 'Global', color: '#f59e0b' },
]

// Static price cache. In Phase 6+ this becomes live data from APIs.
// Keys are symbols. For BIST/TEFAS: prices in TRY. For global equities: USD.
export const demoPriceCache = {
  ASELS: { price: 78.40, currency: 'TRY' },
  THYAO: { price: 312.50, currency: 'TRY' },
  AKBNK: { price: 67.20, currency: 'TRY' },
  KCHOL: { price: 198.30, currency: 'TRY' },
  EREGL: { price: 52.10, currency: 'TRY' },
  AFA: { price: 0.045, currency: 'TRY' },
  TI2: { price: 1.823, currency: 'TRY' },
  GAF: { price: 2.156, currency: 'TRY' },
  VOO: { price: 542.30, currency: 'USD' },
  AAPL: { price: 224.50, currency: 'USD' },
  MSFT: { price: 415.80, currency: 'USD' },
  NVDA: { price: 138.20, currency: 'USD' },
  GOOGL: { price: 178.90, currency: 'USD' },
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export const demoTransactions = [
  { id: 't1',  date: daysAgo(180), type: 'deposit',  assetType: 'cash',   symbol: 'CASH', quantity: 1, price: 200000, fee: 0, currency: 'TRY', portfolioId: 'sub-mixed',     notes: 'Initial deposit' },
  { id: 't2',  date: daysAgo(180), type: 'deposit',  assetType: 'cash',   symbol: 'CASH', quantity: 1, price: 150000, fee: 0, currency: 'TRY', portfolioId: 'sub-t3',         notes: 'Initial deposit' },
  { id: 't3',  date: daysAgo(180), type: 'deposit',  assetType: 'cash',   symbol: 'CASH', quantity: 1, price: 200000, fee: 0, currency: 'TRY', portfolioId: 'sub-claude-t3',  notes: 'Initial deposit' },
  { id: 't4',  date: daysAgo(180), type: 'deposit',  assetType: 'cash',   symbol: 'CASH', quantity: 1, price: 9500,   fee: 0, currency: 'USD', portfolioId: 'sub-global',     notes: 'Initial USD deposit' },

  { id: 't5',  date: daysAgo(170), type: 'buy', assetType: 'bist', symbol: 'ASELS', quantity: 800,  price: 62.50, fee: 35,  currency: 'TRY', portfolioId: 'sub-mixed',    notes: '' },
  { id: 't6',  date: daysAgo(160), type: 'buy', assetType: 'bist', symbol: 'THYAO', quantity: 200,  price: 245.00, fee: 28, currency: 'TRY', portfolioId: 'sub-mixed',    notes: '' },
  { id: 't7',  date: daysAgo(150), type: 'buy', assetType: 'bist', symbol: 'AKBNK', quantity: 1500, price: 52.30, fee: 42,  currency: 'TRY', portfolioId: 'sub-t3',       notes: '' },
  { id: 't8',  date: daysAgo(140), type: 'buy', assetType: 'bist', symbol: 'KCHOL', quantity: 300,  price: 165.00, fee: 30, currency: 'TRY', portfolioId: 'sub-t3',       notes: '' },
  { id: 't9',  date: daysAgo(120), type: 'buy', assetType: 'bist', symbol: 'EREGL', quantity: 1000, price: 44.20, fee: 38,  currency: 'TRY', portfolioId: 'sub-claude-t3',notes: '' },

  { id: 't10', date: daysAgo(165), type: 'buy', assetType: 'tefas', symbol: 'AFA', quantity: 2000000, price: 0.038, fee: 0, currency: 'TRY', portfolioId: 'sub-mixed',     notes: 'Equity fund' },
  { id: 't11', date: daysAgo(130), type: 'buy', assetType: 'tefas', symbol: 'TI2', quantity: 50000,   price: 1.520, fee: 0, currency: 'TRY', portfolioId: 'sub-claude-t3', notes: '' },
  { id: 't12', date: daysAgo(90),  type: 'buy', assetType: 'tefas', symbol: 'GAF', quantity: 30000,   price: 1.980, fee: 0, currency: 'TRY', portfolioId: 'sub-claude-t3', notes: '' },

  { id: 't13', date: daysAgo(175), type: 'buy', assetType: 'global', symbol: 'VOO',   quantity: 5,  price: 480.00, fee: 1, currency: 'USD', portfolioId: 'sub-global', notes: '' },
  { id: 't14', date: daysAgo(155), type: 'buy', assetType: 'global', symbol: 'AAPL',  quantity: 8,  price: 195.00, fee: 1, currency: 'USD', portfolioId: 'sub-global', notes: '' },
  { id: 't15', date: daysAgo(125), type: 'buy', assetType: 'global', symbol: 'MSFT',  quantity: 4,  price: 380.00, fee: 1, currency: 'USD', portfolioId: 'sub-global', notes: '' },
  { id: 't16', date: daysAgo(95),  type: 'buy', assetType: 'global', symbol: 'NVDA',  quantity: 10, price: 110.00, fee: 1, currency: 'USD', portfolioId: 'sub-global', notes: '' },
  { id: 't17', date: daysAgo(60),  type: 'buy', assetType: 'global', symbol: 'GOOGL', quantity: 6,  price: 165.00, fee: 1, currency: 'USD', portfolioId: 'sub-global', notes: '' },

  { id: 't18', date: daysAgo(45), type: 'deposit', assetType: 'cash', symbol: 'CASH', quantity: 1, price: 25000, fee: 0, currency: 'TRY', portfolioId: 'sub-mixed',    notes: 'Monthly savings' },
  { id: 't19', date: daysAgo(30), type: 'deposit', assetType: 'cash', symbol: 'CASH', quantity: 1, price: 25000, fee: 0, currency: 'TRY', portfolioId: 'sub-t3',       notes: 'Monthly savings' },
  { id: 't20', date: daysAgo(15), type: 'buy', assetType: 'bist', symbol: 'ASELS', quantity: 200, price: 76.00, fee: 18, currency: 'TRY', portfolioId: 'sub-t3',       notes: '' },
  { id: 't21', date: daysAgo(8),  type: 'buy', assetType: 'global', symbol: 'VOO', quantity: 2, price: 538.00, fee: 1, currency: 'USD', portfolioId: 'sub-global', notes: '' },
  { id: 't22', date: daysAgo(3),  type: 'sell', assetType: 'bist', symbol: 'THYAO', quantity: 40, price: 308.00, fee: 12, currency: 'TRY', portfolioId: 'sub-mixed',    notes: 'Partial profit-taking' },
]
