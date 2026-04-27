import { useEffect, useState } from "react"
import { Download, Share, X, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [showIOSGuide, setShowIOSGuide] = useState(false)

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ((window.navigator as Navigator & { standalone?: boolean }).standalone ?? false)

    // Don't show if already installed (running as standalone)
    if (isStandalone) return

    // Don't show if user dismissed before
    if (localStorage.getItem("pwa-prompt-dismissed")) return

    const userAgent = window.navigator.userAgent.toLowerCase()
    const isIOS =
      /iphone|ipad|ipod/.test(userAgent) ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1)
    const isSafari =
      /safari/.test(userAgent) && !/crios|fxios|edgios|opr|chrome|android/.test(userAgent)

    if (isIOS && isSafari) {
      setShowIOSGuide(true)
      setTimeout(() => setVisible(true), 2000)
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      // Small delay so it doesn't show immediately on load
      setTimeout(() => setVisible(true), 2500)
    }

    const installedHandler = () => {
      setVisible(false)
      setDeferredPrompt(null)
      setShowIOSGuide(false)
    }

    window.addEventListener("beforeinstallprompt", handler)
    window.addEventListener("appinstalled", installedHandler)
    return () => {
      window.removeEventListener("beforeinstallprompt", handler)
      window.removeEventListener("appinstalled", installedHandler)
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    setInstalling(true)
    try {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === "accepted") {
        setVisible(false)
        setDeferredPrompt(null)
      }
    } finally {
      setInstalling(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem("pwa-prompt-dismissed", "1")
    setTimeout(() => setVisible(false), 300)
  }

  const canUseBrowserPrompt = deferredPrompt !== null
  const showingIOSGuide = showIOSGuide && !canUseBrowserPrompt

  if (!visible || (!canUseBrowserPrompt && !showingIOSGuide)) return null

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-[9998] px-4 pb-safe",
        "transition-all duration-300 ease-out",
        visible && !dismissed ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
      )}
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-sm rounded-2xl border border-border bg-background/95 backdrop-blur-xl shadow-2xl p-4">
        <div className="flex items-start gap-3">
          {/* App Icon */}
          <div className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-md">
            <Smartphone className="w-6 h-6 text-white" />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground leading-tight">Install DataxX</p>
            {showingIOSGuide ? (
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                On iPhone/iPad, tap <Share className="inline-block w-3.5 h-3.5 -mt-0.5" /> then choose Add to Home Screen.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                Add to home screen for faster access and offline support.
              </p>
            )}
          </div>

          {/* Dismiss */}
          <button
            onClick={handleDismiss}
            className="shrink-0 p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 mt-3">
          {showingIOSGuide ? (
            <Button
              size="sm"
              className="flex-1 h-9 text-xs bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleDismiss}
            >
              I understand
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 h-9 text-xs"
                onClick={handleDismiss}
              >
                Not now
              </Button>
              <Button
                size="sm"
                className="flex-1 h-9 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                onClick={handleInstall}
                disabled={installing}
              >
                <Download className="w-3.5 h-3.5" />
                {installing ? "Installing..." : "Install App"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
