import React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './studio/query-client'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import App from './App'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import './i18n'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute='class'
        defaultTheme='system'
        enableSystem
        disableTransitionOnChange
        storageKey='studio-theme'
      >
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
