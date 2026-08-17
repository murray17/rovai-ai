import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PageZoomFeedback } from './PageZoomFeedback'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PageZoomFeedback />
  </StrictMode>
)
