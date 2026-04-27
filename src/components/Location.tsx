import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { RefreshCw, Loader2, AlertCircle, AlertTriangle, Search, X, ChevronUp, ChevronDown as ChevronDownIcon, ChevronsUpDown, Filter, Check, Columns2, Info } from "lucide-react"
import { cn, parseSmartQuery } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RowInfoModal } from "@/components/RowInfoModal"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useEditMode } from "@/contexts/EditModeContext"

// ─── Types ────────────────────────────────────────────────────────────────────
interface DeliveryPoint {
  code: string
  name: string
  delivery: "Daily" | "Weekday" | "Alt 1" | "Alt 2" | string
  latitude: number
  longitude: number
  descriptions: { key: string; value: string }[]
  qrCodeImageUrl?: string
  qrCodeDestinationUrl?: string
}

interface Route {
  id: string
  name: string
  code: string
  shift: string
  deliveryPoints: DeliveryPoint[]
}

interface FlatPoint extends DeliveryPoint {
  routeId: string
  routeName: string
  routeCode: string
  routeShift: string
  _rowIndex: number
  _dupCode: boolean
  _dupName: boolean
}

type SortKey = "code" | "name" | "delivery" | "route"
type SortDir = "asc" | "desc"

interface SavedRowOrder {
  id: string
  label: string
  order: string[]  // array of point.code in order
}

const DEFAULT_MAP_CENTER = { lat: 3.06955, lng: 101.5469179 }

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} Km`
}

function areSetsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

// ─── Column definitions ───────────────────────────────────────────────────────
const ALL_COLUMNS = [
  { key: "no",       label: "#",             description: "Row number" },
  { key: "route",    label: "Route",         description: "Route name" },
  { key: "code",     label: "Code",          description: "Location code" },
  { key: "name",     label: "Name",          description: "Delivery point name" },
  { key: "delivery", label: "Delivery",      description: "Delivery schedule" },
  { key: "km",       label: "KM",            description: "Distance from start point" },
  { key: "action",   label: "Action",        description: "Open row information" },
] as const
type ColumnKey = typeof ALL_COLUMNS[number]["key"]

const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = ["no", "code", "name", "delivery", "action"]

// ─── Delivery active helper ─────────────────────────────────────────────────
function isDeliveryActive(delivery: string, date: Date = new Date()): boolean {
  const dayOfWeek = date.getDay()
  const localNoon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0)
  const epochDay  = Math.floor(localNoon.getTime() / 86400000)
  switch (delivery) {
    case 'Daily':     return true
    case 'Alt 1':     return epochDay % 2 !== 0
    case 'Alt 2':     return epochDay % 2 === 0
    case 'Weekday':   return dayOfWeek >= 0 && dayOfWeek <= 4
    case 'Weekday 2': return dayOfWeek >= 1 && dayOfWeek <= 5
    case 'Weekday 3': return [0, 2, 5].includes(dayOfWeek)
    default:          return true
  }
}

// ─── Delivery option definitions ─────────────────────────────────────────────
interface DeliveryItem {
  value: string
  label: string
  description: string
  color: string   // Tailwind bg class for the badge
  textColor: string
}

const DELIVERY_ITEMS: DeliveryItem[] = [
  {
    value: "Daily",
    label: "Daily",
    description: "Delivery every day",
    color: "bg-emerald-100 dark:bg-emerald-900/40",
    textColor: "text-emerald-700 dark:text-emerald-300",
  },
  {
    value: "Alt 1",
    label: "Alt 1",
    description: "Delivery on odd dates (1, 3, 5…)",
    color: "bg-violet-100 dark:bg-violet-900/40",
    textColor: "text-violet-700 dark:text-violet-300",
  },
  {
    value: "Alt 2",
    label: "Alt 2",
    description: "Delivery on even dates (2, 4, 6…)",
    color: "bg-fuchsia-100 dark:bg-fuchsia-900/40",
    textColor: "text-fuchsia-700 dark:text-fuchsia-300",
  },
  {
    value: "Weekday",
    label: "Weekday",
    description: "Sun – Thu",
    color: "bg-sky-100 dark:bg-sky-900/40",
    textColor: "text-sky-700 dark:text-sky-300",
  },
  {
    value: "Weekday 2",
    label: "Weekday 2",
    description: "Mon – Fri",
    color: "bg-blue-100 dark:bg-blue-900/40",
    textColor: "text-blue-700 dark:text-blue-300",
  },
  {
    value: "Weekday 3",
    label: "Weekday 3",
    description: "Sun, Tue & Fri only",
    color: "bg-indigo-100 dark:bg-indigo-900/40",
    textColor: "text-indigo-700 dark:text-indigo-300",
  },
]

const DELIVERY_MAP = new Map(DELIVERY_ITEMS.map(d => [d.value, d]))

// ─── Main Component ───────────────────────────────────────────────────────────
export function DeliveryTableDialog() {
  const { registerSaveHandler, setHasUnsavedChanges } = useEditMode()
  const [routes, setRoutes]   = useState<Route[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [activeActionPoint, setActiveActionPoint] = useState<FlatPoint | null>(null)

  // Pending edits: key = `${routeId}::${rowIndex}`, value = new delivery string
  const [pendingEdits, setPendingEdits] = useState<Map<string, string>>(new Map())
  const [isSaving, setIsSaving]         = useState(false)
  const [saveError, setSaveError]       = useState<string | null>(null)

  // Search & Filter
  const [search, setSearch]                     = useState("")
  const [filterRoutes, setFilterRoutes]         = useState<Set<string>>(new Set())
  const [filterDeliveries, setFilterDeliveries] = useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen]             = useState(false)
  const [draftFilterRoutes, setDraftFilterRoutes] = useState<Set<string>>(new Set())
  const [draftFilterDeliveries, setDraftFilterDeliveries] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen]         = useState(false)
  const [filterTab, setFilterTab]               = useState<"routes" | "delivery" | "columns">("routes")
  const [sortOpen, setSortOpen]                 = useState(false)
  const [visibleColumns, setVisibleColumns]     = useState<Set<ColumnKey>>(new Set(DEFAULT_VISIBLE_COLUMNS))
  const [draftVisibleColumns, setDraftVisibleColumns] = useState<Set<ColumnKey>>(new Set(DEFAULT_VISIBLE_COLUMNS))

  const toggleColumn = (key: ColumnKey, scope: "live" | "draft" = "live") => {
    const updateColumns = scope === "draft" ? setDraftVisibleColumns : setVisibleColumns
    updateColumns(prev => {
      if (prev.size === 1 && prev.has(key)) return prev // keep at least one
      const s = new Set(prev)
      s.has(key) ? s.delete(key) : s.add(key)
      return s
    })
  }

  const hiddenColCount = ALL_COLUMNS.length - visibleColumns.size
  const draftHiddenColCount = ALL_COLUMNS.length - draftVisibleColumns.size
  const hasDraftFilterChanges =
    !areSetsEqual(filterRoutes, draftFilterRoutes) ||
    !areSetsEqual(filterDeliveries, draftFilterDeliveries) ||
    !areSetsEqual(visibleColumns, draftVisibleColumns)

  // Sort — default: code asc
  const [sortKey, setSortKey] = useState<SortKey>("code")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [customSortOrders, setCustomSortOrders] = useState<SavedRowOrder[]>([])
  const [activeCustomSort, setActiveCustomSort] = useState<SavedRowOrder | null>(null)
  const prevFilterRoutesRef = useRef<Set<string>>(new Set())

  // Load saved row orders when exactly one route is filtered
  useEffect(() => {
    prevFilterRoutesRef.current = filterRoutes
    // Reset custom sort whenever filter changes
    setActiveCustomSort(null)
    if (filterRoutes.size === 1) {
      const [routeId] = filterRoutes
      try {
        const stored = localStorage.getItem(`fcalendar_my_sorts_${routeId}`)
        const parsed = stored ? JSON.parse(stored) : []
        setCustomSortOrders(Array.isArray(parsed) ? parsed : [])
      } catch {
        setCustomSortOrders([])
      }
    } else {
      setCustomSortOrders([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterRoutes])

  useEffect(() => {
    if (!filterOpen) return
    setDraftFilterRoutes(new Set(filterRoutes))
    setDraftFilterDeliveries(new Set(filterDeliveries))
    setDraftVisibleColumns(new Set(visibleColumns))
  }, [filterOpen, filterRoutes, filterDeliveries, visibleColumns])

  const fetchRoutes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/routes")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setRoutes(json.data ?? json ?? [])
      setPendingEdits(new Map())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRoutes() }, [fetchRoutes])

  // ── Pending-edit helpers ─────────────────────────────────────────────────
  const pointKey = (pt: FlatPoint) => `${pt.routeId}::${pt._rowIndex}`

  const effectiveDelivery = (pt: FlatPoint) =>
    pendingEdits.get(pointKey(pt)) ?? pt.delivery

  const saveChanges = useCallback(async () => {
    if (pendingEdits.size === 0 || isSaving) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const updatedRoutes = routes.map(route => ({
        ...route,
        deliveryPoints: (route.deliveryPoints ?? []).map((pt, i) => {
          const key = `${route.id}::${i}`
          return pendingEdits.has(key) ? { ...pt, delivery: pendingEdits.get(key)! } : pt
        }),
      }))
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes: updatedRoutes }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRoutes(updatedRoutes)
      setPendingEdits(new Map())
      setHasUnsavedChanges(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setIsSaving(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdits, isSaving, routes])

  // Register with global EditMode save
  useEffect(() => {
    if (pendingEdits.size === 0) return
    const unregister = registerSaveHandler(saveChanges)
    return unregister
  }, [pendingEdits.size, saveChanges, registerSaveHandler])

  // Notify context when pending edits change
  useEffect(() => {
    setHasUnsavedChanges(pendingEdits.size > 0)
  }, [pendingEdits.size, setHasUnsavedChanges])

  // ── Flatten all points + detect duplicates ───────────────────────────────
  const { flat, dupCodeCount, dupNameCount } = useMemo(() => {
    const all: FlatPoint[] = []
    routes.forEach(route => {
      (route.deliveryPoints ?? []).forEach((pt, i) => {
        all.push({ ...pt, routeId: route.id, routeName: route.name, routeCode: route.code, routeShift: route.shift ?? "", _rowIndex: i, _dupCode: false, _dupName: false })
      })
    })
    const codeCounts: Record<string, number> = {}
    const nameCounts: Record<string, number> = {}
    all.forEach(p => {
      codeCounts[p.code.trim().toLowerCase()] = (codeCounts[p.code.trim().toLowerCase()] ?? 0) + 1
      nameCounts[p.name.trim().toLowerCase()] = (nameCounts[p.name.trim().toLowerCase()] ?? 0) + 1
    })
    let dupCodeCount = 0
    let dupNameCount = 0
    all.forEach(p => {
      p._dupCode = codeCounts[p.code.trim().toLowerCase()] > 1
      p._dupName = nameCounts[p.name.trim().toLowerCase()] > 1
      if (p._dupCode) dupCodeCount++
      if (p._dupName) dupNameCount++
    })
    return { flat: all, dupCodeCount, dupNameCount }
  }, [routes])

  // ── Unique options for filters ─────────────────────────────────────────
  const routeOptions = useMemo(() =>
    [...new Map(routes.map(r => [r.id, `${r.name} (${r.code})`])).entries()],
  [routes])
  const deliveryOptions = useMemo(() => {
    const known = DELIVERY_ITEMS.map(d => d.value)
    const extra = flat.map(p => p.delivery).filter(v => !DELIVERY_MAP.has(v))
    return [...known, ...new Set(extra)]
  }, [flat])

  // ── Filter + Sort ──────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    let list = flat
    if (search.trim()) {
      const { nameQuery, shiftFilter } = parseSmartQuery(search)
      const q = nameQuery.toLowerCase()
      if (q) {
        list = list.filter(p =>
          p.code.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.routeName.toLowerCase().includes(q) ||
          p.routeCode.toLowerCase().includes(q) ||
          p.delivery.toLowerCase().includes(q)
        )
      }
      if (shiftFilter) {
        list = list.filter(p => p.routeShift.toUpperCase() === shiftFilter)
      }
    }
    if (filterRoutes.size > 0)     list = list.filter(p => filterRoutes.has(p.routeId))
    if (filterDeliveries.size > 0) list = list.filter(p => filterDeliveries.has(p.delivery))

    if (activeCustomSort) {
      const orderIndex = new Map(activeCustomSort.order.map((code, idx) => [code, idx]))
      return [...list].sort((a, b) => {
        const ai = orderIndex.get(a.code)
        const bi = orderIndex.get(b.code)

        if (ai == null && bi == null) {
          // Keep unsorted items deterministic at the bottom.
          return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" })
        }
        if (ai == null) return 1
        if (bi == null) return -1
        if (ai !== bi) return ai - bi

        // Fallback for duplicate codes in a route.
        return a._rowIndex - b._rowIndex
      })
    }

    return [...list].sort((a, b) => {
      let av = "", bv = ""
      if (sortKey === "code")     { av = a.code;      bv = b.code }
      if (sortKey === "name")     { av = a.name;      bv = b.name }
      if (sortKey === "delivery") { av = a.delivery;  bv = b.delivery }
      if (sortKey === "route")    { av = a.routeName; bv = b.routeName }
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" })
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [flat, search, filterRoutes, filterDeliveries, sortKey, sortDir, activeCustomSort])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("asc") }
  }

  const totalPoints = flat.length
  const pointDistances = useMemo(() => {
    const distances = new Map<string, string>()

    displayed.forEach((pt) => {
      const hasCoordinates = pt.latitude !== 0 || pt.longitude !== 0
      if (!hasCoordinates) return

      distances.set(
        pointKey(pt),
        formatKm(haversineKm(DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng, pt.latitude, pt.longitude))
      )
    })

    return distances
  }, [displayed])

  return (
    <div className="flex flex-col flex-1 min-h-0 border rounded-xl overflow-hidden shadow-sm bg-background">

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b bg-muted/40 shrink-0">
        <span className="font-bold text-muted-foreground" style={{ fontSize: "10px" }}>
          {!loading && !error && `${displayed.length} / ${totalPoints} point(s) · ${routes.length} route(s)`}
        </span>
        {!loading && !error && dupCodeCount > 0 && (
          <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-2 py-1 rounded-full">
            <AlertTriangle className="w-3 h-3" />{dupCodeCount} dup code
          </span>
        )}
        {!loading && !error && dupNameCount > 0 && (
          <span className="flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-700 px-2 py-1 rounded-full">
            <AlertTriangle className="w-3 h-3" />{dupNameCount} dup name
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={fetchRoutes} disabled={loading || isSaving} className="ml-auto h-7 gap-1.5 text-xs">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
        {saveError && (
          <span className="flex items-center gap-1 text-xs font-medium text-destructive">
            <AlertCircle className="w-3.5 h-3.5" />{saveError}
          </span>
        )}
      </div>

      {/* ── Search + Filter Bar ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/20 shrink-0">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <Input
            placeholder="Search code, name, route… (e.g. KL am)"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10 pr-10 h-11 text-[12px] md:text-[12px] rounded-lg"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setFilterOpen(true)}
          className={cn(
            "relative flex items-center gap-1.5 h-9 px-3 rounded-lg border text-xs font-medium transition-colors shrink-0",
            (filterRoutes.size > 0 || filterDeliveries.size > 0 || hiddenColCount > 0)
              ? "border-primary bg-primary/10 text-primary"
              : "border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          Filter
          {(filterRoutes.size + filterDeliveries.size + hiddenColCount) > 0 && (
            <span className="ml-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
              {filterRoutes.size + filterDeliveries.size + hiddenColCount}
            </span>
          )}
        </button>
        {/* ── Sort button ───────────────────────────────────────────── */}
        <div className="relative shrink-0">
          <button
            onClick={() => setSortOpen(v => !v)}
            className={cn(
              "flex items-center gap-1.5 h-9 px-3 rounded-lg border text-xs font-medium transition-colors",
              (activeCustomSort || sortKey !== "code" || sortDir !== "asc")
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
            Sort
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 bg-popover border border-border rounded-xl shadow-lg w-44 py-1 overflow-hidden">
                {([
                  { key: "code" as SortKey,     label: "Code" },
                  { key: "name" as SortKey,     label: "Name" },
                  { key: "route" as SortKey,    label: "Route" },
                  { key: "delivery" as SortKey, label: "Delivery" },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => { handleSort(key); setActiveCustomSort(null); setSortOpen(false) }}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/60 transition-colors",
                      !activeCustomSort && sortKey === key ? "text-primary font-semibold" : "text-foreground"
                    )}
                  >
                    {label}
                    {!activeCustomSort && sortKey === key
                      ? (sortDir === "asc"
                          ? <ChevronUp className="w-3 h-3" />
                          : <ChevronDownIcon className="w-3 h-3" />)
                      : <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40" />}
                  </button>
                ))}
                {customSortOrders.length > 0 && (
                  <>
                    <div className="mx-2 my-1 border-t border-border" />
                    <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">My Sort List</p>
                    {customSortOrders.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { setActiveCustomSort(s); setSortOpen(false) }}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/60 transition-colors",
                          activeCustomSort?.id === s.id ? "text-primary font-semibold" : "text-foreground"
                        )}
                      >
                        <span className="truncate">{s.label}</span>
                        {activeCustomSort?.id === s.id && <Check className="w-3 h-3 shrink-0" />}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Active Filters Row ──────────────────────────────────────── */}
      {(filterRoutes.size > 0 || filterDeliveries.size > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b bg-muted/10 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Active:</span>
          {[...filterRoutes].map(id => {
            const label = routeOptions.find(([rid]) => rid === id)?.[1] ?? id
            return (
              <span key={id} className="inline-flex items-center gap-1 h-5 pl-2 pr-1 rounded-full bg-primary/10 text-primary text-[10px] font-medium border border-primary/20">
                {label}
                <button onClick={() => setFilterRoutes(prev => { const s = new Set(prev); s.delete(id); return s })} className="rounded-full hover:bg-primary/20 p-0.5 transition-colors">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            )
          })}
          {[...filterDeliveries].map(d => {
            const item = DELIVERY_MAP.get(d)
            return (
              <span key={d} className="inline-flex items-center gap-1 h-5 pl-2 pr-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[10px] font-medium border border-violet-500/20">
                {item ? item.label : d}
                <button onClick={() => setFilterDeliveries(prev => { const s = new Set(prev); s.delete(d); return s })} className="rounded-full hover:bg-violet-500/20 p-0.5 transition-colors">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            )
          })}
          <button
            onClick={() => { setFilterRoutes(new Set()); setFilterDeliveries(new Set()) }}
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground underline shrink-0"
          >Clear all</button>
        </div>
      )}

      {/* ── Filter Modal ────────────────────────────────────────────── */}
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent className="w-[92vw] max-w-sm p-0 gap-0 overflow-hidden rounded-2xl">
          <DialogHeader className="px-5 pt-5 pb-3 text-center items-center">
            <DialogTitle className="text-sm font-bold">Filter</DialogTitle>
          </DialogHeader>
          {/* Tabs */}
          <div className="flex border-b border-border justify-center px-4">
            {(["routes", "delivery", "columns"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={cn(
                  "px-4 py-2.5 text-xs font-semibold capitalize border-b-2 transition-colors",
                  filterTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab === "routes"
                  ? `Routes${draftFilterRoutes.size > 0 ? ` (${draftFilterRoutes.size})` : ""}`
                  : tab === "delivery"
                  ? `Delivery${draftFilterDeliveries.size > 0 ? ` (${draftFilterDeliveries.size})` : ""}`
                  : <span className="flex items-center gap-1"><Columns2 className="w-3 h-3" />Columns{draftHiddenColCount > 0 ? ` (${draftHiddenColCount})` : ""}</span>}
              </button>
            ))}
          </div>
          {/* Tab content */}
          <div className="overflow-y-auto max-h-72 p-3 space-y-1.5">
            {filterTab === "routes" && routeOptions.map(([id, label]) => {
              const checked = draftFilterRoutes.has(id)
              return (
                <button
                  key={id}
                  onClick={() => setDraftFilterRoutes(prev => { const s = new Set(prev); checked ? s.delete(id) : s.add(id); return s })}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-xs text-left transition-colors",
                    checked ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/40"
                  )}
                >
                  <span className={cn("flex shrink-0 items-center justify-center w-4 h-4 rounded border", checked ? "bg-primary border-primary" : "border-muted-foreground/40")}>
                    {checked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </span>
                  <span className="font-medium">{label}</span>
                </button>
              )
            })}
            {filterTab === "delivery" && deliveryOptions.map(d => {
              const item = DELIVERY_MAP.get(d)
              const checked = draftFilterDeliveries.has(d)
              return (
                <button
                  key={d}
                  onClick={() => setDraftFilterDeliveries(prev => { const s = new Set(prev); checked ? s.delete(d) : s.add(d); return s })}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-xs text-left transition-colors",
                    checked ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/40"
                  )}
                >
                  <span className={cn("flex shrink-0 items-center justify-center w-4 h-4 rounded border", checked ? "bg-primary border-primary" : "border-muted-foreground/40")}>
                    {checked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </span>
                  <span className="font-medium">{item ? item.label : d}</span>
                  {item && <span className="ml-auto text-muted-foreground text-[10px]">{item.description}</span>}
                </button>
              )
            })}
            {filterTab === "columns" && (
              <>
                <p className="text-[10px] text-muted-foreground px-1 pb-1">Toggle which columns are visible in the table.</p>
                {ALL_COLUMNS.map(col => {
                  const visible = draftVisibleColumns.has(col.key)
                  return (
                    <button
                      key={col.key}
                      onClick={() => toggleColumn(col.key, "draft")}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-xs text-left transition-colors",
                        visible ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/40 text-muted-foreground"
                      )}
                    >
                      <span className={cn("flex shrink-0 items-center justify-center w-4 h-4 rounded border", visible ? "bg-primary border-primary" : "border-muted-foreground/40")}>
                        {visible && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </span>
                      <span className="font-medium">{col.label}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{col.description}</span>
                    </button>
                  )
                })}
              </>
            )}
          </div>
          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <button
              onClick={() => {
                if (filterTab === "columns") {
                  setDraftVisibleColumns(new Set(ALL_COLUMNS.map((col) => col.key)))
                } else {
                  setDraftFilterRoutes(new Set())
                  setDraftFilterDeliveries(new Set())
                }
              }}
              className="text-xs font-semibold text-orange-800 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300"
            >{filterTab === "columns" ? "Show all" : "Clear all"}</button>
            {hasDraftFilterChanges && (
              <button
                type="button"
                onClick={() => {
                  setFilterRoutes(new Set(draftFilterRoutes))
                  setFilterDeliveries(new Set(draftFilterDeliveries))
                  setVisibleColumns(new Set(draftVisibleColumns))
                  setFilterOpen(false)
                }}
                className="text-xs font-semibold text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300"
              >
                Apply
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {activeActionPoint && (
        <RowInfoModal
          open={!!activeActionPoint}
          onOpenChange={(open) => { if (!open) setActiveActionPoint(null) }}
          point={activeActionPoint}
          isEditMode={false}
        />
      )}

      {/* ── Loading ──────────────────────────────────────────────────── */}
      {loading && !flat.length && (
        <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
          <div className="loading-shell flex items-center gap-2.5 text-muted-foreground">
            <Loader2 className="loading-spinner size-5 animate-spin" />
            <span className="text-sm loading-text">Loading routes…</span>
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────── */}
      {error && !loading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-destructive">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* ── Table — fills remaining height, scrolls inside ── */}
      {(!loading || flat.length > 0) && !error && (
        <div className="flex-1 overflow-auto min-h-0">
          <table className="border-collapse text-xs whitespace-nowrap min-w-max w-full">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm text-[11px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border">
              <tr>
                {visibleColumns.has("no")       && <th className="px-3 py-3 text-center w-10">#</th>}
                {visibleColumns.has("route")    && <th className="px-3 py-3 text-center">Route</th>}
                {visibleColumns.has("code")     && <th className="px-3 py-3 text-center">Code</th>}
                {visibleColumns.has("name")     && <th className="px-3 py-3 text-center">Name</th>}
                {visibleColumns.has("delivery") && <th className="px-3 py-3 text-center">Delivery</th>}
                {visibleColumns.has("km")       && <th className="px-3 py-3 text-center">KM</th>}
                {visibleColumns.has("action")   && <th className="px-2 py-3 text-center w-12">Action</th>}
              </tr>
            </thead>
            <tbody className="font-semibold">
              {displayed.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.size} className="text-center py-16 text-muted-foreground">
                    No results found.
                  </td>
                </tr>
              ) : (
                displayed.map((pt, idx) => (
                  <tr
                    key={`${pt.routeId}-${pt.code}-${idx}`}
                    className={cn(
                      "transition-colors",
                      (pt._dupCode || pt._dupName)
                        ? "bg-amber-50/60 dark:bg-amber-900/10 hover:bg-amber-100/60 dark:hover:bg-amber-900/20"
                        : idx % 2 === 0 ? "hover:bg-muted/40" : "bg-muted/20 hover:bg-muted/40"
                    )}
                  >
                    {visibleColumns.has("no") && (
                      <td className="px-3 py-2 text-center text-muted-foreground w-10 text-[11px] tabular-nums">{idx + 1}</td>
                    )}
                    {visibleColumns.has("route") && (
                      <td className="px-3 py-2 text-center">
                        <span className="text-[11px] text-foreground">{pt.routeName}</span>
                      </td>
                    )}
                    {visibleColumns.has("code") && (
                      <td className="px-3 py-2 text-center">
                        <span className={cn("text-[11px] font-medium", pt._dupCode && "text-amber-600 dark:text-amber-400 font-bold")}>
                          {pt.code}
                        </span>
                        {pt._dupCode && <AlertTriangle className="inline w-3 h-3 ml-1 text-amber-500" />}
                      </td>
                    )}
                    {visibleColumns.has("name") && (
                      <td className="px-3 py-2 text-center">
                        <span className={cn("text-[11px]", pt._dupName && "text-rose-600 dark:text-rose-400 font-semibold")}>
                          {pt.name}
                        </span>
                        {pt._dupName && <AlertTriangle className="inline w-3 h-3 ml-1 text-rose-500" />}
                      </td>
                    )}
                    {visibleColumns.has("delivery") && (
                      <td className="px-3 py-2 text-center text-[11px]">
                        {effectiveDelivery(pt)}
                      </td>
                    )}
                    {visibleColumns.has("km") && (
                      <td className="px-3 py-2 text-center text-[11px] tabular-nums text-muted-foreground">
                        {pointDistances.get(pointKey(pt)) ?? ""}
                      </td>
                    )}
                    {visibleColumns.has("action") && (
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          className={`inline-flex size-6 items-center justify-center p-0 transition-colors ${
                            isDeliveryActive(pt.delivery)
                              ? 'text-emerald-600 hover:text-emerald-700'
                              : 'text-red-500 hover:text-red-600'
                          }`}
                          aria-label={`View info for ${pt.name}`}
                          title={`View info for ${pt.name}`}
                          onClick={() => setActiveActionPoint(pt)}
                        >
                          <Info className="size-3.5" />
                          <span className="sr-only">Info</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Settings Modal ──────────────────────────────────────────── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="w-[92vw] max-w-sm rounded-2xl p-0 gap-0 overflow-hidden">
          <div className="px-5 pt-5 pb-3 border-b border-border shrink-0">
            <DialogHeader className="text-center items-center">
              <DialogTitle className="text-sm font-bold">Display Settings</DialogTitle>
            </DialogHeader>
          </div>

          <div className="overflow-y-auto max-h-96 px-5 py-4 space-y-4">
            {/* Show/Hide Columns */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground">Visible Columns</p>
              <div className="space-y-2">
                {ALL_COLUMNS.map(col => {
                  const visible = visibleColumns.has(col.key)
                  return (
                    <button
                      key={col.key}
                      onClick={() => toggleColumn(col.key)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-xs text-left transition-colors",
                        visible ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/40 text-muted-foreground"
                      )}
                    >
                      <span className={cn("flex shrink-0 items-center justify-center w-4 h-4 rounded border", visible ? "bg-primary border-primary" : "border-muted-foreground/40")}>
                        {visible && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </span>
                      <span className="font-medium">{col.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Active Filters Info */}
            {(filterRoutes.size > 0 || filterDeliveries.size > 0) && (
              <div className="space-y-2.5 border-t border-border pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-foreground">Active Filters</p>
                <button
                  onClick={() => { setFilterRoutes(new Set()); setFilterDeliveries(new Set()) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors"
                >
                  Clear all filters
                </button>
              </div>
            )}

            <div className="space-y-2.5 border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground">Column Preset</p>
              <button
                onClick={() => setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS))}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-lg hover:bg-primary/15 transition-colors"
              >
                Reset to default columns
              </button>
            </div>
          </div>

          <div className="px-5 py-3 border-t border-border flex justify-end gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={() => setSettingsOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}

