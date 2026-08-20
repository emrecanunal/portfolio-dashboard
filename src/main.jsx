import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { ThemeProvider } from './components/ThemeProvider.jsx'
import { FxAutoRefresh } from './components/FxAutoRefresh.jsx'
import { PriceAutoRefresh } from './components/PriceAutoRefresh.jsx'
import { InstallPrompt } from './components/InstallPrompt.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <FxAutoRefresh />
        <PriceAutoRefresh />
        <App />
        <InstallPrompt />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
