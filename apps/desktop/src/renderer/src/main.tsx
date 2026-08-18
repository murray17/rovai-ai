import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PageZoomFeedback } from './PageZoomFeedback'
import { applyRendererPlatform } from './renderer-platform'
import './styles.css'

applyRendererPlatform(document.documentElement, window.rovai.platform)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PageZoomFeedback />
  </StrictMode>
)
