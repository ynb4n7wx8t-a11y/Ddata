import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { registerServiceWorker } from "./lib/pwa"
import { DEFAULT_APP_FONT, FONT_OPTIONS } from "./hooks/use-theme"

// ── Apply persisted display settings before first paint ──────────────────────
;(function applyStoredDisplaySettings() {
  try {
    // Color mode — apply immediately to avoid flash
    const colorMode = localStorage.getItem("colorMode") ?? "dark"
    document.documentElement.classList.toggle("dark", colorMode === "dark")
    localStorage.removeItem("eye-comfort")

    // App zoom
    const rawZoom = localStorage.getItem("app-zoom")
    const allowedZooms = new Set(["80", "85", "90", "95", "100", "105", "110", "115", "120"])
    const zoom = rawZoom !== null && allowedZooms.has(rawZoom) ? rawZoom : "120"
    if (zoom !== rawZoom) localStorage.setItem("app-zoom", zoom)
    document.body.style.zoom = `${zoom}%`

    // Text size (root scale via CSS variable)
    const textSize = localStorage.getItem("text-size") ?? "14"
    document.documentElement.style.setProperty("--text-size-base", `${textSize}px`)

    // Font family
    const storedFont = localStorage.getItem("app-font")
    const hasValidStoredFont = storedFont !== null && FONT_OPTIONS.some(f => f.id === storedFont)
    const fontId = hasValidStoredFont ? storedFont : DEFAULT_APP_FONT
    if (!hasValidStoredFont) localStorage.setItem("app-font", DEFAULT_APP_FONT)
    const fontOpt = FONT_OPTIONS.find(f => f.id === fontId)
    if (fontOpt) {
      // Inject Google Fonts link if needed
      if (fontOpt.googleId) {
        const link = document.createElement("link")
        link.rel  = "stylesheet"
        link.href = `https://fonts.googleapis.com/css2?family=${fontOpt.googleId}&display=swap`
        document.head.appendChild(link)
      }
      // Optionally preload the configured default app font when it is a Google font.
      const defaultFont = FONT_OPTIONS.find(f => f.id === DEFAULT_APP_FONT)
      if (defaultFont?.googleId && fontOpt.googleId !== defaultFont.googleId) {
        const preload = document.createElement("link")
        preload.rel  = "stylesheet"
        preload.href = `https://fonts.googleapis.com/css2?family=${defaultFont.googleId}&display=swap`
        document.head.appendChild(preload)
      }
      document.documentElement.style.setProperty("--app-font", fontOpt.family)
      document.body.style.fontFamily = fontOpt.family
    }
  } catch { /* localStorage may be unavailable */ }
})()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
      <App />
  </StrictMode>
)

// Register service worker for PWA functionality
registerServiceWorker()
