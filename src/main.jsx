import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/story.css'
import App from './App.jsx'

const root = document.getElementById('root')

// index.html ships a static intro inside #root (what visitors and crawlers see before any
// JavaScript runs). React renders the same hero markup in its place; App keeps a reference so it
// can wait for that intro's first paint before loading the AniBot chat.
const staticIntro = document.getElementById('static-intro')

createRoot(root).render(
  <StrictMode>
    <App staticIntro={staticIntro} />
  </StrictMode>,
)
