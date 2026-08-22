import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/AppLayout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Transactions from './pages/Transactions.jsx'
import PortfoliosIndex from './pages/PortfoliosIndex.jsx'
import SubPortfolioDetail from './pages/SubPortfolioDetail.jsx'
import FirePage from './pages/FirePage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import { requestPersistence } from './lib/persistence.js'

export default function App() {
  // Ask once per load for exemption from automatic eviction. Chrome decides
  // silently, Firefox may prompt, Safari does not implement it — the answer is
  // reported in Settings rather than assumed here, and nothing depends on it.
  useEffect(() => {
    requestPersistence()
  }, [])

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/portfolios" element={<PortfoliosIndex />} />
        <Route path="/portfolios/:id" element={<SubPortfolioDetail />} />
        <Route path="/fire" element={<FirePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
