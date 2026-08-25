import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { ThemeProvider } from './components/ThemeProvider.jsx'
import { FxAutoRefresh } from './components/FxAutoRefresh.jsx'
import { PriceAutoRefresh } from './components/PriceAutoRefresh.jsx'
import { InstallPrompt } from './components/InstallPrompt.jsx'
import { AuthGate } from './components/AuthGate.jsx'
import './index.css'

// AuthGate, otomatik yenileyicileri de KAPSIYOR. Dışarıda bıraksaydık giriş
// ekranında öylece beklerken beş dakikada bir fiyat ve kur çekilirdi — kotası
// olan, sözleşmesi olmayan kaynaklara, henüz kim olduğunu bilmediğimiz biri
// için. ThemeProvider ise dışarıda kalıyor; giriş ekranının da bir teması var.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthGate>
          <FxAutoRefresh />
          <PriceAutoRefresh />
          <App />
          <InstallPrompt />
        </AuthGate>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
