import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const root = document.getElementById('root')

// index.html ships a static intro inside #root (what visitors and crawlers see before any
// JavaScript runs). Keep a reference before React empties #root: App shows this same element in
// the hero spot until the hero's 3D chunk has loaded.
const staticIntro = document.getElementById('static-intro')

createRoot(root).render(
  <StrictMode>
    <App staticIntro={staticIntro} />
  </StrictMode>,
)
