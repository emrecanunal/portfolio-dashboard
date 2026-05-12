import { useParams, Navigate } from 'react-router-dom'
import { usePortfolioStore } from '../lib/store.js'
import { PortfolioView } from './PortfolioView.jsx'

export default function SubPortfolioDetail() {
  const { id } = useParams()
  const subPortfolios = usePortfolioStore((s) => s.subPortfolios)
  const portfolio = subPortfolios.find((p) => p.id === id)

  if (!portfolio) {
    // ID not found → bounce to portfolios list
    return <Navigate to="/portfolios" replace />
  }

  return <PortfolioView scope={{ type: 'sub', portfolioId: id, portfolio }} />
}
