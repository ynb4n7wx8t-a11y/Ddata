import { useState, useMemo, useEffect, useCallback } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Users,
  Clock,
  Loader2,
  Settings2,
  Search,
  CalendarDays,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { useEditMode } from "@/contexts/EditModeContext"
import { getRouteColorPalette } from "@/lib/route-colors"

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Resource {
  id: string
  name: string
  role: string
  color: string
}

interface Shift {
  id: string
  resourceId: string
  title: string
  date: string   // "YYYY-MM-DD"
  startHour: number  // 0-23, supports .5 for :30
  endHour: number    // 1-24.5
  color: string
}

interface RouteRef {
  id: string
  name: string
  code: string
  shift: string  // "AM" | "PM" | etc
  color?: string
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
]

// Half-hour options for shift time selects
const HOUR_OPTIONS = Array.from({ length: 49 }, (_, i) => {
  const h = i * 0.5
  const hInt = Math.floor(h)
  const mins = h % 1 !== 0 ? "30" : "00"
  if (h === 0)    return { value: 0,    label: "12:00 AM" }
  if (h === 0.5)  return { value: 0.5,  label: "12:30 AM" }
  if (h < 12)     return { value: h,    label: `${hInt}:${mins} AM` }
  if (h === 12)   return { value: 12,   label: "12:00 PM" }
  if (h === 12.5) return { value: 12.5, label: "12:30 PM" }
  if (h < 24)     return { value: h,    label: `${hInt - 12}:${mins} PM` }
  if (h === 24)   return { value: 24,   label: "12:00 AM (+1)" }
  return { value: 24.5, label: "12:30 AM (+1)" }
})

// Returns {startHour, endHour} preset based on route shift type
function getShiftPreset(shiftType: string): { startHour: number; endHour: number } {
  if (shiftType?.toUpperCase() === "AM") return { startHour: 4, endHour: 12.5 }
  if (shiftType?.toUpperCase() === "PM") return { startHour: 16, endHour: 24.5 }
  return { startHour: 8, endHour: 16 }
}

const RESOURCE_COLORS = [
  "#3B82F6", "#F97316", "#22C55E", "#A855F7",
  "#EC4899", "#EAB308", "#14B8A6", "#EF4444",
]

const OFF_SUB_TYPES = [
  { id: "off",     label: "Off",            color: "#6B7280" },
  { id: "absent",  label: "Absent",         color: "#6B7280" },
  { id: "public",  label: "Public Holiday", color: "#6B7280" },
  { id: "mc",      label: "MC",             color: "#6B7280" },
] as const
type OffSubTypeId = typeof OFF_SUB_TYPES[number]["id"]
type ShiftTypeId = "route" | "off"
const OFF_LABELS: ReadonlySet<string> = new Set(OFF_SUB_TYPES.map(t => t.label))

function detectShiftType(title: string): ShiftTypeId {
  return OFF_LABELS.has(title) ? "off" : "route"
}

function detectOffSubType(title: string): OffSubTypeId {
  return (OFF_SUB_TYPES.find(t => t.label === title)?.id ?? "off") as OffSubTypeId
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getWeekDates(baseDate: Date): Date[] {
  const d = new Date(baseDate)
  const day = d.getDay() // 0=Sun
  d.setDate(d.getDate() - day) // go to Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const nd = new Date(d)
    nd.setDate(d.getDate() + i)
    return nd
  })
}

function toDateKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function formatHour(h: number) {
  const mins = h % 1 !== 0 ? "30" : "00"
  if (h === 0)    return `12:${mins} AM`
  if (h < 12)     return `${Math.floor(h)}:${mins} AM`
  if (h === 12)   return `12:${mins} PM`
  if (h < 24)     return `${Math.floor(h) - 12}:${mins} PM`
  return `12:${mins} AM`  // 24 / 24.5 = next day
}

function addDaysToDateKey(dateKey: string, daysToAdd: number): string {
  const d = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateKey
  d.setDate(d.getDate() + daysToAdd)
  return toDateKey(d)
}

function getInclusiveDurationDays(startDateKey: string, endDateKey: string): number {
  const start = new Date(`${startDateKey}T00:00:00`)
  const end = new Date(`${endDateKey}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
}

function getDateKeysInRange(startDateKey: string, endDateKey: string): string[] {
  const start = new Date(`${startDateKey}T00:00:00`)
  const end = new Date(`${endDateKey}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [startDateKey]

  const out: string[] = []
  const cur = new Date(start)
  while (cur <= end) {
    out.push(toDateKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

// ─── API HELPERS ──────────────────────────────────────────────────────────────

async function apiFetchAll(): Promise<{ resources: Resource[]; shifts: Shift[] }> {
  try {
    const res = await fetch("/api/rooster")
    const json = await res.json()
    if (!json.success) return { resources: [], shifts: [] }
    const resources: Resource[] = json.resources.map((r: Record<string, string>) => ({
      id: r.id, name: r.name, role: r.role, color: r.color,
    }))
    const shifts: Shift[] = json.shifts.map((s: Record<string, string | number>) => ({
      id: String(s.id),
      resourceId: String(s.resource_id),
      title: String(s.title),
      date: String(s.shift_date).slice(0, 10),
      startHour: Number(s.start_hour),
      endHour: Number(s.end_hour),
      color: String(s.color),
    }))
    return { resources, shifts }
  } catch {
    return { resources: [], shifts: [] }
  }
}

async function apiSaveResource(r: Resource): Promise<boolean> {
  try {
    const res = await fetch("/api/rooster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "resource", id: r.id, name: r.name, role: r.role, color: r.color }),
    })
    const json = await res.json()
    return json.success === true
  } catch { return false }
}

async function apiDeleteResource(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/rooster?type=resource&id=${encodeURIComponent(id)}`, { method: "DELETE" })
    const json = await res.json()
    return json.success === true
  } catch { return false }
}

async function apiSaveShift(s: Shift): Promise<boolean> {
  try {
    const res = await fetch("/api/rooster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "shift",
        id: s.id,
        resource_id: s.resourceId,
        title: s.title,
        shift_date: s.date,
        start_hour: s.startHour,
        end_hour: s.endHour,
        color: s.color,
      }),
    })
    const json = await res.json()
    return json.success === true
  } catch { return false }
}

async function apiDeleteShift(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/rooster?type=shift&id=${encodeURIComponent(id)}`, { method: "DELETE" })
    const json = await res.json()
    return json.success === true
  } catch { return false }
}

// ─── SEED DATA ────────────────────────────────────────────────────────────────

const SEED_RESOURCES: Resource[] = [
  { id: "r1", name: "Ahmad Faris",    role: "Driver",    color: RESOURCE_COLORS[0] },
  { id: "r2", name: "Siti Aminah",    role: "Operator",  color: RESOURCE_COLORS[1] },
  { id: "r3", name: "Mohd Hazwan",    role: "Driver",    color: RESOURCE_COLORS[2] },
  { id: "r4", name: "Nurul Izzati",   role: "Supervisor",color: RESOURCE_COLORS[3] },
  { id: "r5", name: "Khairul Azman",  role: "Operator",  color: RESOURCE_COLORS[4] },
]

function makeSeedShifts(resources: Resource[]): Shift[] {
  const today = new Date()
  const week = getWeekDates(today)
  const shifts: Shift[] = []
  let sid = 1
  const shiftTemplates = [
    { title: "Morning",   startHour: 7,  endHour: 15, color: "#3B82F6" },
    { title: "Afternoon", startHour: 12, endHour: 20, color: "#F97316" },
    { title: "Night",     startHour: 20, endHour: 24, color: "#A855F7" },
    { title: "Morning",   startHour: 6,  endHour: 14, color: "#22C55E" },
  ]
  resources.forEach((res, ri) => {
    ;[1, 2, 3, 4, 5].forEach((dayOffset) => {
      const date = toDateKey(week[dayOffset])
      const tmpl = shiftTemplates[ri % shiftTemplates.length]
      shifts.push({
        id: `seed_s${sid++}`,
        resourceId: res.id,
        title: tmpl.title,
        date,
        startHour: tmpl.startHour,
        endHour: tmpl.endHour,
        color: tmpl.color,
      })
    })
  })
  return shifts
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

type ViewMode = "month" | "week"

function getMonthDates(baseDate: Date): Date[] {
  const year = baseDate.getFullYear()
  const month = baseDate.getMonth()
  const days = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: days }, (_, i) => new Date(year, month, i + 1))
}

export function Rooster({ viewMode: viewModeProp = "week" }: { viewMode?: ViewMode }) {
  const today = new Date()
  const { isEditMode } = useEditMode()

  const [viewMode, setViewMode] = useState<ViewMode>(viewModeProp)
  const [viewModeTransition, setViewModeTransition] = useState<"idle" | "out" | "in">("idle")

  useEffect(() => { setViewMode(viewModeProp) }, [viewModeProp])
  useEffect(() => {
    if (viewModeTransition === "out") {
      const timeout = window.setTimeout(() => {
        setViewMode((value) => (value === "month" ? "week" : "month"))
        setViewModeTransition("in")
      }, 140)
      return () => window.clearTimeout(timeout)
    }

    if (viewModeTransition === "in") {
      const timeout = window.setTimeout(() => setViewModeTransition("idle"), 180)
      return () => window.clearTimeout(timeout)
    }
  }, [viewModeTransition])

  const [currentDate, setCurrentDate] = useState(new Date())
  const [resources, setResources] = useState<Resource[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [routes, setRoutes] = useState<RouteRef[]>([])
  const [loading, setLoading] = useState(true)
  const [routeColorPalette, setRouteColorPalette] = useState<string[]>(getRouteColorPalette)

  // Maps route name → effective colour (route.color overrides palette fallback)
  const routeEffectiveColorMap = useMemo(() => {
    const map = new Map<string, string>()
    routes.forEach((r, i) => {
      const c = r.color || routeColorPalette[i % routeColorPalette.length]
      map.set(r.id, c)
      map.set(r.name, c)
    })
    return map
  }, [routes, routeColorPalette])

  // Dialogs
  const [shiftDialog, setShiftDialog] = useState<{
    open: boolean
    mode: "add" | "edit"
    shift?: Shift
    resourceId?: string
    date?: string
  }>({ open: false, mode: "add" })

  const [resourceDialog, setResourceDialog] = useState<{
    open: boolean
    mode: "add" | "edit"
    resource?: Resource
  }>({ open: false, mode: "add" })

  // Manage modal
  const [manageOpen, setManageOpen] = useState(false)
  const [manageTab, setManageTab] = useState<"staff" | "shift">("staff")
  const [historyQuery, setHistoryQuery] = useState("")

  // Selected shifts for bulk actions
  const [selectedShifts, setSelectedShifts] = useState<string[]>([])

  // Bulk action dialogs
  const [changeStaffDialog, setChangeStaffDialog] = useState<{
    open: boolean
    selectedResourceId?: string
  }>({ open: false })
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState(false)
  const [deleteShiftConfirmOpen, setDeleteShiftConfirmOpen] = useState(false)
  const [deleteStaffConfirmDialog, setDeleteStaffConfirmDialog] = useState<{
    open: boolean
    resourceId?: string
    resourceName?: string
  }>({ open: false })

  // ── Load from DB on mount ──────────────────────────────────────────────────

  // ── Load from DB on mount ──────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    const { resources: dbRes, shifts: dbShifts } = await apiFetchAll()
    // Also fetch routes for shift type select
    try {
      const rr = await fetch("/api/routes")
      const rd = await rr.json()
      if (rd.success) setRoutes(rd.data as RouteRef[])
    } catch { /* ignore */ }
    if (dbRes.length === 0) {
      // Seed default data on first launch
      for (const r of SEED_RESOURCES) await apiSaveResource(r)
      const seedShifts = makeSeedShifts(SEED_RESOURCES)
      for (const s of seedShifts) await apiSaveShift(s)
      setResources(SEED_RESOURCES)
      setShifts(seedShifts)
    } else {
      setResources(dbRes)
      setShifts(dbShifts)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Clear selection when edit mode is turned off
  useEffect(() => {
    if (!isEditMode) {
      setSelectedShifts([])
    }
  }, [isEditMode])

  // Sync palette whenever Settings saves new route colours
  useEffect(() => {
    const handler = () => setRouteColorPalette(getRouteColorPalette())
    window.addEventListener('fcalendar_route_colors_changed', handler)
    return () => window.removeEventListener('fcalendar_route_colors_changed', handler)
  }, [])

  // Shift type selector state (dialog UI only)
  const [shiftType, setShiftType] = useState<ShiftTypeId>("route")
  const [offSubType, setOffSubType] = useState<OffSubTypeId>("off")
  const [manageTimeEnabled, setManageTimeEnabled] = useState(false)
  const [dialogTimeEnabled, setDialogTimeEnabled] = useState(false)
  const [shiftEndDate, setShiftEndDate] = useState(toDateKey(today))
  const [shiftDurationDays, setShiftDurationDays] = useState("1")
  const [endDateMode, setEndDateMode] = useState<"date" | "duration">("date")

  const resourceById = useMemo(() => {
    const map = new Map<string, Resource>()
    resources.forEach((resource) => map.set(resource.id, resource))
    return map
  }, [resources])

  const routeByName = useMemo(() => {
    const map = new Map<string, RouteRef>()
    routes.forEach((route) => map.set(route.name, route))
    return map
  }, [routes])

  const historyResults = useMemo(() => {
    const q = historyQuery.trim().toLowerCase()
    if (!q) return []

    return [...shifts]
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date)
        return b.startHour - a.startHour
      })
      .filter((shift) => {
        const resource = resourceById.get(shift.resourceId)
        const route = routeByName.get(shift.title)
        const haystack = [
          shift.title,
          shift.date,
          String(shift.startHour),
          String(shift.endHour),
          resource?.name ?? "",
          resource?.role ?? "",
          route?.code ?? "",
          route?.shift ?? "",
        ]
          .join(" ")
          .toLowerCase()

        return haystack.includes(q)
      })
      .slice(0, 30)
  }, [historyQuery, shifts, resourceById, routeByName])

  // Shift form state
  const [shiftForm, setShiftForm] = useState({
    title: "Morning",
    resourceId: resources[0]?.id ?? "",
    date: toDateKey(today),
    startHour: 8,
    endHour: 16,
    color: "#3B82F6",
  })

  const isManageShiftReady = useMemo(() => {
    if (!shiftForm.resourceId || !shiftForm.date) return false
    if (shiftType === "route") return shiftForm.title.trim().length > 0
    return true
  }, [shiftForm, shiftType, offSubType])

  // Resource form state
  const [resForm, setResForm] = useState({
    name: "",
    role: "",
    color: RESOURCE_COLORS[0],
  })

  // Derived week dates
  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate])

  const headerLabel = useMemo(() => {
    if (viewMode === "month") {
      return `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    }
    const start = weekDates[0]
    const end = weekDates[6]
    const sameMo = start.getMonth() === end.getMonth()
    if (sameMo) {
      return `${start.getDate()}–${end.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`
    }
    return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
  }, [viewMode, currentDate, weekDates])

  // Navigation
  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate)
    if (viewMode === "month") d.setMonth(d.getMonth() + dir)
    else d.setDate(d.getDate() + dir * 7)
    setCurrentDate(d)
  }

  const goToday = () => setCurrentDate(new Date())

  // Column dates for current view
  const monthDates = useMemo(() => getMonthDates(currentDate), [currentDate])
  const colDates: Date[] = viewMode === "month" ? monthDates : weekDates
  const staffColWidth = 104
  const dayColWidth = viewMode === "month" ? 73 : 103

  // ── Shift CRUD ────────────────────────────────────────────────────────────

  const openAddShift = (resourceId?: string, date?: string) => {
    if (resourceId && date) {
      const existing = shifts.filter(s => s.resourceId === resourceId && s.date === date)
      if (existing.length >= 2) { toast.error("Maximum 2 shifts per day"); return }
    }
    setShiftType("route")
    setOffSubType("off")
    setDialogTimeEnabled(false)
    setEndDateMode("date")
    const startDate = date ?? toDateKey(currentDate)
    setShiftEndDate(startDate)
    setShiftDurationDays("1")
    setShiftForm({
      title: "",
      resourceId: resourceId ?? resources[0]?.id ?? "",
      date: startDate,
      startHour: 8,
      endHour: 16,
      color: "#3B82F6",
    })
    setShiftDialog({ open: true, mode: "add", resourceId, date })
  }

  const openEditShift = (shift: Shift) => {
    const detected = detectShiftType(shift.title)
    setShiftType(detected)
    setOffSubType(detected === "off" ? detectOffSubType(shift.title) : "off")
    setDialogTimeEnabled(false)
    setEndDateMode("date")
    setShiftEndDate(shift.date)
    setShiftDurationDays("1")
    setShiftForm({
      title: shift.title,
      resourceId: shift.resourceId,
      date: shift.date,
      startHour: shift.startHour,
      endHour: shift.endHour,
      color: shift.color,
    })
    setShiftDialog({ open: true, mode: "edit", shift })
  }

  const saveShift = async () => {
    if (shiftType === "route" && !shiftForm.title.trim()) { toast.error("Please select a route"); return }
    if (shiftType === "route" && dialogTimeEnabled && shiftForm.endHour <= shiftForm.startHour) { toast.error("End time must be after start time"); return }
    const finalTitle = shiftType === "off"
      ? (OFF_SUB_TYPES.find(t => t.id === offSubType)?.label ?? "Off")
      : shiftForm.title.trim()
    const finalColor = shiftType === "off"
      ? (OFF_SUB_TYPES.find(t => t.id === offSubType)?.color ?? "#6B7280")
      : shiftForm.color
    if (shiftDialog.mode === "add") {
      const durationNum = Number(shiftDurationDays)
      const resolvedEndDate = Number.isFinite(durationNum) && durationNum > 0
        ? addDaysToDateKey(shiftForm.date, Math.floor(durationNum) - 1)
        : shiftEndDate
      const dateKeys = getDateKeysInRange(shiftForm.date, resolvedEndDate)

      const blockedDate = dateKeys.find(dateKey =>
        shifts.filter(s => s.resourceId === shiftForm.resourceId && s.date === dateKey).length >= 2
      )
      if (blockedDate) { toast.error(`Maximum 2 shifts reached on ${blockedDate}`); return }

      const batchId = Date.now()
      const newShifts: Shift[] = dateKeys.map((dateKey, idx) => ({
        id: `s${batchId}_${idx}`,
        ...shiftForm,
        date: dateKey,
        title: finalTitle,
        color: finalColor,
      }))

      const results = await Promise.all(newShifts.map(s => apiSaveShift(s)))
      if (results.every(Boolean)) {
        setShifts(prev => [...prev, ...newShifts])
        toast.success(newShifts.length > 1 ? `${newShifts.length} shifts added` : "Shift added")
      } else toast.error("Failed to save shift")
    } else {
      const updated: Shift = { ...shiftDialog.shift!, ...shiftForm, title: finalTitle, color: finalColor }
      const ok = await apiSaveShift(updated)
      if (ok) {
        setShifts(prev => prev.map(s => s.id === updated.id ? updated : s))
        toast.success("Shift updated")
      } else toast.error("Failed to update shift")
    }
    setShiftDialog({ open: false, mode: "add" })
  }

  const deleteShift = async (id: string) => {
    const ok = await apiDeleteShift(id)
    if (ok) { setShifts(prev => prev.filter(s => s.id !== id)); toast.success("Shift removed") }
    else toast.error("Failed to delete shift")
  }

  // ── Resource CRUD ─────────────────────────────────────────────────────────

  const openAddResource = () => {
    setResForm({ name: "", role: "", color: RESOURCE_COLORS[resources.length % RESOURCE_COLORS.length] })
    setResourceDialog({ open: true, mode: "add" })
  }

  const openEditResource = (r: Resource) => {
    setResForm({ name: r.name, role: r.role, color: r.color })
    setResourceDialog({ open: true, mode: "edit", resource: r })
  }

  const saveResource = async () => {
    if (!resForm.name.trim()) { toast.error("Please enter a name"); return }
    if (resourceDialog.mode === "add") {
      const nr: Resource = { id: `r${Date.now()}`, name: resForm.name.trim(), role: resForm.role.trim(), color: RESOURCE_COLORS[resources.length % RESOURCE_COLORS.length] }
      const ok = await apiSaveResource(nr)
      if (ok) { setResources(prev => [...prev, nr]); toast.success("Staff added") }
      else toast.error("Failed to save staff")
    } else {
      const updated: Resource = { ...resourceDialog.resource!, ...resForm, name: resForm.name.trim(), role: resForm.role.trim() }
      const ok = await apiSaveResource(updated)
      if (ok) {
        setResources(prev => prev.map(r => r.id === updated.id ? updated : r))
        toast.success("Staff updated")
      } else toast.error("Failed to update staff")
    }
    setResourceDialog({ open: false, mode: "add" })
  }

  const deleteResource = async (id: string) => {
    const ok = await apiDeleteResource(id)
    if (ok) {
      setResources(prev => prev.filter(r => r.id !== id))
      setShifts(prev => prev.filter(s => s.resourceId !== id))
      toast.success("Staff removed")
    } else toast.error("Failed to delete staff")
  }

  // ── Bulk Actions ──────────────────────────────────────────────────────────

  const toggleShiftSelection = (shiftId: string) => {
    setSelectedShifts(prev => 
      prev.includes(shiftId) 
        ? prev.filter(id => id !== shiftId)
        : [...prev, shiftId]
    )
  }

  const clearSelection = () => setSelectedShifts([])

  const bulkChangeStaff = async (newResourceId: string) => {
    const selectedShiftObjects = shifts.filter(s => selectedShifts.includes(s.id))
    
    // Check if any target dates already have 2 shifts for the new staff
    const conflicts = selectedShiftObjects.filter(shift => {
      const existingShifts = shifts.filter(s => 
        s.resourceId === newResourceId && 
        s.date === shift.date &&
        !selectedShifts.includes(s.id) // Don't count shifts being moved
      )
      return existingShifts.length >= 2
    })
    
    if (conflicts.length > 0) {
      toast.error(`Cannot move shifts: ${conflicts[0].date} already has 2 shifts for the selected staff`)
      return
    }

    const results = await Promise.all(
      selectedShiftObjects.map(shift => 
        apiSaveShift({ ...shift, resourceId: newResourceId })
      )
    )
    if (results.every(Boolean)) {
      setShifts(prev => prev.map(s => 
        selectedShifts.includes(s.id) 
          ? { ...s, resourceId: newResourceId }
          : s
      ))
      toast.success(`${selectedShifts.length} shift${selectedShifts.length > 1 ? 's' : ''} moved to ${resources.find(r => r.id === newResourceId)?.name}`)
      clearSelection()
    } else {
      toast.error("Failed to update some shifts")
    }
  }

  const bulkDeleteShifts = async () => {
    const results = await Promise.all(
      selectedShifts.map(id => apiDeleteShift(id))
    )
    if (results.every(Boolean)) {
      setShifts(prev => prev.filter(s => !selectedShifts.includes(s.id)))
      toast.success(`${selectedShifts.length} shift${selectedShifts.length > 1 ? 's' : ''} deleted`)
      clearSelection()
    } else {
      toast.error("Failed to delete some shifts")
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
        <div className="loading-shell flex items-center gap-2.5 text-muted-foreground">
          <Loader2 className="loading-spinner size-5 animate-spin" />
          <span className="text-sm loading-text">Loading Rooster...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Page heading ────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-5 lg:px-6 pt-4 sm:pt-5 pb-2 shrink-0">
        <div className="mb-2 flex items-center gap-2.5 sm:gap-3">
          <Users className="size-3.5 text-primary" />
          <h1 className="text-[13px] font-semibold tracking-tight text-foreground">Rooster</h1>
        </div>
        <p className="ml-6 text-[11px] leading-relaxed text-muted-foreground/90 sm:ml-7">Staff scheduling &amp; shift overview</p>
      </div>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 sm:px-5 lg:px-6 py-3 border-b border-border shrink-0 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => navigate(-1)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            onClick={goToday}
            className={`h-7 px-2.5 text-[11px] font-semibold rounded-lg transition-colors ${
              (viewMode === "month"
                ? currentDate.getFullYear() === today.getFullYear() && currentDate.getMonth() === today.getMonth()
                : isSameDay(weekDates[0], getWeekDates(today)[0]))
                ? "text-muted-foreground/40 cursor-default"
                : "text-foreground hover:text-primary"
            }`}
          >
            Today
          </button>
          <button onClick={() => navigate(1)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3.5" />
          </button>
        </div>

        <h2 className="text-[13px] font-bold flex-1 truncate">{headerLabel}</h2>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => { if (viewModeTransition === "idle") setViewModeTransition("out") }}
            disabled={viewModeTransition !== "idle"}
            className={`h-7 px-3 text-xs font-semibold rounded-lg border border-border bg-card transition-colors shrink-0 ${viewModeTransition !== "idle" ? "opacity-60 cursor-not-allowed" : "hover:bg-muted"}`}
          >
            {viewMode === "month" ? "Month" : "Week"}
          </button>

          {isEditMode && (
            <button
              onClick={() => { setManageOpen(true); setManageTab("staff") }}
              className="flex items-center gap-1 h-7 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-[11px] font-semibold transition-colors shrink-0"
            >
              <Settings2 className="size-3" />Manage
            </button>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-5 lg:px-6 py-3 border-b border-border/70 bg-background/70">
        <div className="flex items-center gap-2">
          <div className="relative w-full max-w-2xl">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="Search history: staff, route, code, date (YYYY-MM-DD)"
              className="h-10 sm:h-11 pl-9 pr-24 text-xs sm:text-sm"
            />
            {historyQuery.trim() && (
              <button
                type="button"
                onClick={() => setHistoryQuery("")}
                className="absolute right-11 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600"
                title="Clear search"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <label
              title="Pick a date"
              className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-blue-500 transition-colors hover:bg-blue-500/10 hover:text-blue-600"
              aria-label="Pick a date"
            >
              <CalendarDays className="w-5 h-5" />
              <input
                type="date"
                className="sr-only"
                onChange={(e) => {
                  if (e.target.value) setHistoryQuery(e.target.value)
                  e.target.value = ""
                }}
              />
            </label>
          </div>

          {isEditMode && selectedShifts.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 h-7 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-[11px] font-semibold transition-colors shrink-0">
                  <Settings2 className="size-3" />
                  Action ({selectedShifts.length})
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setChangeStaffDialog({ open: true })}>
                  <Users className="size-4 mr-2" />
                  Change Staff
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setDeleteConfirmDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-4 mr-2" />
                  Delete Events
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

        </div>

        {historyQuery.trim() && (
          <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-border bg-card/80">
            {historyResults.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">No history match found.</p>
            ) : (
              historyResults.map((shift) => {
                const resource = resourceById.get(shift.resourceId)
                const route = routeByName.get(shift.title)
                return (
                  <button
                    key={shift.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/40"
                    onClick={() => setCurrentDate(new Date(`${shift.date}T12:00:00`))}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold text-foreground">{shift.title}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {resource?.name ?? "Unknown staff"}
                        {route?.code ? ` · ${route.code}` : ""}
                        {route?.shift ? ` · ${route.shift}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] font-semibold text-foreground">{shift.date}</p>
                      <p className="text-[10px] text-muted-foreground">{formatHour(shift.startHour)} - {formatHour(shift.endHour)}</p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* ── Grid ─────────────────────────────────────────────────────────────── */}
      <div className={`flex-1 min-h-0 overflow-auto transition-all duration-200 ease-out ${viewModeTransition === "out" ? "opacity-0 scale-[0.98]" : "opacity-100 scale-100"}`}>
        {resources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-5 h-full text-muted-foreground py-20">
            <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center">
              <Users className="size-7 opacity-30" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-foreground">No staff yet</p>
              <p className="text-xs text-muted-foreground mt-1">Add staff to start building the roster</p>
            </div>
            {isEditMode && (
              <button
                onClick={openAddResource}
                className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Plus className="size-3.5" />Add Staff
              </button>
            )}
          </div>
        ) : (
          <table className="border-collapse text-center w-full" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: `${staffColWidth}px`, minWidth: `${staffColWidth}px` }} />
              {colDates.map(d => (
                <col key={toDateKey(d)} style={{ width: `${dayColWidth}px`, minWidth: `${dayColWidth}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 border-b border-l border-r border-border bg-card px-2 py-2 text-center" style={{ width: `${staffColWidth}px`, minWidth: `${staffColWidth}px` }}>
                  <span className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-foreground/80">
                    <Users className="size-3" />Staff
                  </span>
                </th>
                {colDates.map(date => {
                  const isToday = isSameDay(date, today)
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6
                  return (
                    <th
                      key={toDateKey(date)}
                      className={`sticky top-0 z-20 border-b border-r border-border px-1 py-1.5 text-center font-normal ${
                        isToday ? "bg-primary/10" : "bg-muted/55"
                      }`}
                      style={{ width: `${dayColWidth}px`, minWidth: `${dayColWidth}px` }}
                    >
                      <div className={`text-[9px] font-bold uppercase tracking-widest mb-1.5 ${
                        isToday ? "text-primary" : isWeekend ? "text-red-500" : "text-muted-foreground"
                      }`}>
                        {DAYS_SHORT[date.getDay()]}
                      </div>
                      <div className={`text-xs font-bold ${
                        isToday ? "text-primary" : isWeekend ? "text-red-500" : "text-foreground/80"
                      }`}>
                        {date.getDate()}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {resources.map((resource, ri) => {
                const rowShifts = shifts.filter(s => s.resourceId === resource.id)
                return (
                  <tr key={resource.id} className={ri % 2 !== 0 ? "bg-muted/[0.025]" : ""}>

                    {/* ── Staff cell ── */}
                    <td className="sticky left-0 z-10 border-b border-l border-r border-border bg-card p-2 align-top">
                      <div className="flex flex-col items-center text-center">
                          <p className="text-xs font-semibold text-foreground leading-tight whitespace-nowrap">{resource.name}</p>
                          {resource.role && (
                            <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 whitespace-nowrap">{resource.role}</p>
                          )}
                      </div>
                      {isEditMode && (
                        <div className="flex items-center gap-0.5 mt-2.5">
                          <button
                            onClick={e => { e.stopPropagation(); openEditResource(resource) }}
                            className="h-5 px-1.5 flex items-center gap-1 rounded border-0 bg-transparent text-[9px] font-medium text-red-600 hover:bg-transparent hover:text-red-700 transition-colors"
                          >
                            <Pencil className="size-2.5" />Edit
                          </button>
                        </div>
                      )}
                    </td>

                    {/* ── Day cells ── */}
                    {isEditMode ? (
                      colDates.map(date => {
                        const dateKey = toDateKey(date)
                        const dayShifts = rowShifts.filter(s => s.date === dateKey)
                        const orderedDayShifts = [...dayShifts].sort((a, b) => {
                          const aPeriod = routes.find(r => r.name === a.title)?.shift?.toUpperCase()
                          const bPeriod = routes.find(r => r.name === b.title)?.shift?.toUpperCase()

                          const periodRank = (period?: string) => {
                            if (period === "AM") return 0
                            if (period === "PM") return 1
                            return 2
                          }

                          const rankDiff = periodRank(aPeriod) - periodRank(bPeriod)
                          if (rankDiff !== 0) return rankDiff

                          const startDiff = a.startHour - b.startHour
                          if (startDiff !== 0) return startDiff

                          return a.title.localeCompare(b.title)
                        })
                        const isToday = isSameDay(date, today)
                        return (
                          <td
                            key={dateKey}
                            className={`cursor-pointer border-b border-r border-border p-1 text-center align-middle transition-colors ${
                              isToday ? "bg-primary/[0.04]" : ""
                            } hover:bg-muted/30`}
                            style={{ width: `${dayColWidth}px`, minWidth: `${dayColWidth}px`, minHeight: "74px" }}
                            onClick={() => openAddShift(resource.id, dateKey)}
                          >
                            <div className="flex flex-col items-center gap-1.5">
                              {orderedDayShifts.map(shift => (
                                <ShiftBlock
                                  key={shift.id}
                                  shift={shift}
                                  shiftType={routes.find(r => r.name === shift.title)?.shift ?? ""}
                                  routeColor={routeEffectiveColorMap.get(shift.title)}
                                  isEditMode={isEditMode}
                                  onEdit={() => openEditShift(shift)}
                                  isSelected={selectedShifts.includes(shift.id)}
                                  onToggleSelect={() => toggleShiftSelection(shift.id)}
                                />
                              ))}
                            </div>
                          </td>
                        )
                      })
                    ) : (
                      (() => {
                        const sortDayShifts = (list: Shift[]) =>
                          [...list].sort((a, b) => {
                            const aPeriod = routes.find(r => r.name === a.title)?.shift?.toUpperCase()
                            const bPeriod = routes.find(r => r.name === b.title)?.shift?.toUpperCase()

                            const periodRank = (period?: string) => {
                              if (period === "AM") return 0
                              if (period === "PM") return 1
                              return 2
                            }

                            const rankDiff = periodRank(aPeriod) - periodRank(bPeriod)
                            if (rankDiff !== 0) return rankDiff

                            const startDiff = a.startHour - b.startHour
                            if (startDiff !== 0) return startDiff

                            return a.title.localeCompare(b.title)
                          })

                        const descriptors: Array<{ start: number; span: number; orderedShifts: Shift[] }> = []
                        let start = 0

                        while (start < colDates.length) {
                          const dateKey = toDateKey(colDates[start])
                          const orderedShifts = sortDayShifts(rowShifts.filter(s => s.date === dateKey))
                          let span = 1

                          if (orderedShifts.length === 1) {
                            const base = orderedShifts[0]
                            const baseColor = routeEffectiveColorMap.get(base.title) || base.color

                            while (start + span < colDates.length) {
                              const nextDateKey = toDateKey(colDates[start + span])
                              const nextShifts = sortDayShifts(rowShifts.filter(s => s.date === nextDateKey))
                              if (nextShifts.length !== 1) break

                              const next = nextShifts[0]
                              const nextColor = routeEffectiveColorMap.get(next.title) || next.color
                              const sameShift =
                                next.title === base.title &&
                                next.startHour === base.startHour &&
                                next.endHour === base.endHour &&
                                nextColor === baseColor

                              if (!sameShift) break
                              span += 1
                            }
                          }

                          descriptors.push({ start, span, orderedShifts })
                          start += span
                        }

                        return descriptors.map(({ start: startIndex, span, orderedShifts }) => {
                          const date = colDates[startIndex]
                          const dateKey = toDateKey(date)
                          const isTodaySpan = colDates
                            .slice(startIndex, startIndex + span)
                            .some(d => isSameDay(d, today))

                          return (
                            <td
                              key={dateKey}
                              colSpan={span}
                              className={`border-b border-r border-border p-1 align-top transition-colors ${
                                isTodaySpan ? "bg-primary/[0.04]" : ""
                              }`}
                              style={{ minHeight: "74px" }}
                            >
                              <div className="flex flex-col gap-1.5">
                                {orderedShifts.map(shift => (
                                  <ShiftBlock
                                    key={shift.id}
                                    shift={shift}
                                    shiftType={routes.find(r => r.name === shift.title)?.shift ?? ""}
                                    routeColor={routeEffectiveColorMap.get(shift.title)}
                                    isEditMode={isEditMode}
                                    onEdit={() => openEditShift(shift)}
                                    isSelected={selectedShifts.includes(shift.id)}
                                    onToggleSelect={() => toggleShiftSelection(shift.id)}
                                  />
                                ))}
                              </div>
                            </td>
                          )
                        })
                      })()
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Manage Modal ─────────────────────────────────────────────────────── */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-primary/10 rounded-lg text-primary">
                <Settings2 className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">Manage</DialogTitle>
            </div>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex border-b border-border px-5">
            {(["staff", "shift"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setManageTab(tab)}
                className={`h-9 px-4 text-xs font-semibold border-b-2 transition-colors ${
                  manageTab === tab
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "staff"
                  ? <span className="flex items-center gap-1.5"><Users className="size-3" />Staff</span>
                  : <span className="flex items-center gap-1.5"><Clock className="size-3" />Shift</span>}
              </button>
            ))}
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
            {/* ── Staff Tab ── */}
            {manageTab === "staff" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Name</label>
                  <Input placeholder="e.g. Ahmad Faris" value={resForm.name} onChange={e => setResForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Role</label>
                  <Input placeholder="e.g. Driver, Operator" value={resForm.role} onChange={e => setResForm(p => ({ ...p, role: e.target.value }))} />
                </div>
                <div className="flex justify-end pt-1">
                  <Button size="sm" onClick={async () => {
                    if (!resForm.name.trim()) { toast.error("Please enter a name"); return }
                    const nr: Resource = { id: `r${Date.now()}`, name: resForm.name.trim(), role: resForm.role.trim(), color: RESOURCE_COLORS[resources.length % RESOURCE_COLORS.length] }
                    const ok = await apiSaveResource(nr)
                    if (ok) {
                      setResources(prev => [...prev, nr])
                      setResForm({ name: "", role: "", color: "" })
                      toast.success("Staff added")
                    } else toast.error("Failed to save staff")
                  }}><Plus className="size-3.5 mr-1" />Add Staff</Button>
                </div>
              </>
            )}

            {/* ── Shift Tab ── */}
            {manageTab === "shift" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["route", "off"] as ShiftTypeId[]).map(tid => (
                      <button
                        key={tid}
                        type="button"
                        onClick={() => {
                          setShiftType(tid)
                          if (tid === "off") {
                            const offDefault = OFF_SUB_TYPES.find(t => t.id === "off")!
                            setOffSubType("off")
                            setManageTimeEnabled(false)
                            setShiftForm(p => ({ ...p, title: offDefault.label, color: offDefault.color }))
                          } else {
                            setShiftForm(p => ({ ...p, title: "", color: "#3B82F6" }))
                          }
                        }}
                        className={`py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                          shiftType === tid
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40"
                        }`}
                      >
                        {tid === "route" ? "Route" : "Off"}
                      </button>
                    ))}
                  </div>
                </div>

                {shiftType === "route" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">Route</label>
                    <select
                      value={shiftForm.title}
                      onChange={e => {
                        const selected = routes.find(r => r.name === e.target.value)
                        const preset = getShiftPreset(selected?.shift ?? "")
                        const effectiveColor = selected ? (routeEffectiveColorMap.get(selected.name) ?? "#3B82F6") : shiftForm.color
                        setShiftForm(p => ({ ...p, title: e.target.value, color: effectiveColor, ...preset }))
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        <option value="">-- Select Route --</option>
                      {routes.map(r => (
                        <option key={r.id} value={r.name}>{r.name}{r.code ? ` (${r.code})` : ""} — {r.shift}</option>
                      ))}
                    </select>
                  </div>
                )}

                {shiftType === "off" && (
                  <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium">Subtype</label>
                    <select
                      value={offSubType}
                      onChange={e => {
                        const selected = OFF_SUB_TYPES.find(st => st.id === e.target.value)
                        if (!selected) return
                        setOffSubType(selected.id as OffSubTypeId)
                        setShiftForm(p => ({ ...p, title: selected.label, color: selected.color }))
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {OFF_SUB_TYPES.map(st => (
                        <option key={st.id} value={st.id}>{st.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Staff</label>
                  <select value={shiftForm.resourceId} onChange={e => setShiftForm(p => ({ ...p, resourceId: e.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                    {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Start Date</label>
                  <div className="relative w-fit">
                    <input
                      type="date"
                      value={shiftForm.date}
                      onChange={e => {
                        const nextStart = e.target.value
                        setShiftForm(p => ({ ...p, date: nextStart }))
                        const durationNum = Number(shiftDurationDays)
                        if (Number.isFinite(durationNum) && durationNum > 0) {
                          setShiftEndDate(addDaysToDateKey(nextStart, Math.floor(durationNum) - 1))
                        } else if (shiftEndDate < nextStart) {
                          setShiftEndDate(nextStart)
                        }
                      }}
                      className="h-9 rounded-md border border-input bg-background pl-3 pr-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">End Date</label>
                  <div className="flex border border-border rounded-md overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setEndDateMode("date")}
                      className={`flex-1 h-7 text-[10px] font-medium transition-colors ${
                        endDateMode === "date"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Pick Date
                    </button>
                    <button
                      type="button"
                      onClick={() => setEndDateMode("duration")}
                      className={`flex-1 h-7 text-[10px] font-medium transition-colors ${
                        endDateMode === "duration"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Set Duration
                    </button>
                  </div>
                  {endDateMode === "date" ? (
                    <input
                      type="date"
                      value={shiftEndDate}
                      min={shiftForm.date}
                      onChange={e => {
                        const nextEnd = e.target.value
                        setShiftEndDate(nextEnd)
                        setShiftDurationDays(String(getInclusiveDurationDays(shiftForm.date, nextEnd)))
                      }}
                      className="h-9 rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium">End Date</label>
                        <input
                          type="date"
                          value={shiftEndDate}
                          readOnly
                          className="h-9 rounded-md border border-input bg-muted/50 px-3 text-[11px] md:text-[11px] cursor-not-allowed [color-scheme:light] dark:[color-scheme:dark]"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium">Duration (days)</label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={shiftDurationDays}
                          onChange={e => {
                            const next = e.target.value
                            setShiftDurationDays(next)
                            const durationNum = Number(next)
                            if (Number.isFinite(durationNum) && durationNum > 0) {
                              setShiftEndDate(addDaysToDateKey(shiftForm.date, Math.floor(durationNum) - 1))
                            }
                          }}
                          className="h-9 rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="e.g. 5"
                        />
                      </div>
                    </div>
                  )}
                </div>
                {shiftType === "route" && (
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => setManageTimeEnabled(prev => !prev)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors ${
                        manageTimeEnabled
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Clock className="size-3.5" />
                      {manageTimeEnabled ? "Hide Time" : "Set Time (Optional)"}
                    </button>
                  </div>
                )}
                {shiftType === "route" && manageTimeEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium">Start</label>
                      <select value={shiftForm.startHour} onChange={e => setShiftForm(p => ({ ...p, startHour: Number(e.target.value) }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                        {HOUR_OPTIONS.slice(0, 48).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium">End</label>
                      <select value={shiftForm.endHour} onChange={e => setShiftForm(p => ({ ...p, endHour: Number(e.target.value) }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                        {HOUR_OPTIONS.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                <div className="flex justify-end pt-1">
                  {isManageShiftReady && (
                    <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={async () => {
                      if (!shiftForm.resourceId) { toast.error("Please select staff"); return }
                      if (!shiftForm.date) { toast.error("Please pick a date"); return }
                      const finalTitle = shiftType === "off"
                        ? (OFF_SUB_TYPES.find(t => t.id === offSubType)?.label ?? "Off")
                        : shiftForm.title.trim()
                      const finalColor = shiftType === "off"
                        ? (OFF_SUB_TYPES.find(t => t.id === offSubType)?.color ?? "#6B7280")
                        : shiftForm.color
                      if (shiftType === "route" && !finalTitle) { toast.error("Please select a route"); return }
                      if (shiftType === "route" && manageTimeEnabled && shiftForm.endHour <= shiftForm.startHour) { toast.error("End time must be after start time"); return }
                      const durationNum = Number(shiftDurationDays)
                      const resolvedEndDate = Number.isFinite(durationNum) && durationNum > 0
                        ? addDaysToDateKey(shiftForm.date, Math.floor(durationNum) - 1)
                        : shiftEndDate
                      const dateKeys = getDateKeysInRange(shiftForm.date, resolvedEndDate)
                      const blockedDate = dateKeys.find(dateKey =>
                        shifts.filter(s => s.resourceId === shiftForm.resourceId && s.date === dateKey).length >= 2
                      )
                      if (blockedDate) { toast.error(`Maximum 2 shifts reached on ${blockedDate}`); return }

                      const batchId = Date.now()
                      const newShifts: Shift[] = dateKeys.map((dateKey, idx) => ({
                        id: `s${batchId}_${idx}`,
                        ...shiftForm,
                        date: dateKey,
                        title: finalTitle,
                        color: finalColor,
                      }))

                      const results = await Promise.all(newShifts.map(s => apiSaveShift(s)))
                      if (results.every(Boolean)) {
                        setShifts(prev => [...prev, ...newShifts])
                        if (shiftType === "route") {
                          setShiftForm(p => ({ ...p, title: "" }))
                        }
                        toast.success(newShifts.length > 1 ? `${newShifts.length} shifts added` : "Shift added")
                      } else toast.error("Failed to save shift")
                    }}><Plus className="size-3.5 mr-1" />Add Shift</Button>
                  )}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Shift Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={shiftDialog.open} onOpenChange={o => !o && setShiftDialog(p => ({ ...p, open: false }))}>
        <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-primary/10 rounded-lg text-primary">
                <Clock className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                {shiftDialog.mode === "add" ? "Add Shift" : "Edit Shift"}
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto max-h-[60vh]">

            {/* ── Type: Route / Off ── */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Type</label>
              <div className="grid grid-cols-2 gap-2">
                {(["route", "off"] as ShiftTypeId[]).map(tid => (
                  <button
                    key={tid}
                    type="button"
                    onClick={() => {
                      setShiftType(tid)
                      if (tid === "off") {
                        setOffSubType("off")
                        setDialogTimeEnabled(false)
                        setShiftForm(p => ({ ...p, title: "Off", color: "#6B7280" }))
                      } else {
                        setShiftForm(p => ({ ...p, title: "", color: "#3B82F6" }))
                      }
                    }}
                    className={`py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                      shiftType === tid
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40"
                    }`}
                  >
                    {tid === "route" ? "Route" : "Off"}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Route dropdown grouped by AM/PM ── */}
            {shiftType === "route" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Route</label>
                <select
                  value={shiftForm.title}
                  onChange={e => {
                    const selected = routes.find(r => r.name === e.target.value)
                    if (!selected) {
                      setShiftForm(p => ({ ...p, title: "" }))
                      return
                    }
                    const preset = getShiftPreset(selected.shift ?? "")
                    const effectiveColor = routeEffectiveColorMap.get(selected.name) ?? "#3B82F6"
                    setShiftForm(p => ({ ...p, title: selected.name, color: effectiveColor, ...preset }))
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">-- Select Route --</option>
                  {routes.map(r => (
                    <option key={r.id} value={r.name}>{r.name}{r.code ? ` (${r.code})` : ""} — {r.shift}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ── Off sub-types ── */}
            {shiftType === "off" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Subtype</label>
                <select
                  value={offSubType}
                  onChange={e => {
                    const selected = OFF_SUB_TYPES.find(st => st.id === e.target.value)
                    if (!selected) return
                    setOffSubType(selected.id as OffSubTypeId)
                    setShiftForm(p => ({ ...p, title: selected.label, color: selected.color }))
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {OFF_SUB_TYPES.map(st => (
                    <option key={st.id} value={st.id}>{st.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ── Staff ── */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Staff</label>
              <select value={shiftForm.resourceId} onChange={e => setShiftForm(p => ({ ...p, resourceId: e.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>

            {/* ── Date Range ── */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Start Date</label>
              <div className="relative w-fit">
                <input
                  type="date"
                  value={shiftForm.date}
                  onChange={e => {
                    const nextStart = e.target.value
                    setShiftForm(p => ({ ...p, date: nextStart }))
                    const durationNum = Number(shiftDurationDays)
                    if (Number.isFinite(durationNum) && durationNum > 0) {
                      setShiftEndDate(addDaysToDateKey(nextStart, Math.floor(durationNum) - 1))
                    } else if (shiftEndDate < nextStart) {
                      setShiftEndDate(nextStart)
                    }
                  }}
                  className="h-9 rounded-md border border-input bg-background pl-3 pr-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">End Date</label>
              <div className="flex border border-border rounded-md overflow-hidden">
                <button
                  type="button"
                  onClick={() => setEndDateMode("date")}
                  className={`flex-1 h-7 text-[10px] font-medium transition-colors ${
                    endDateMode === "date"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Pick Date
                </button>
                <button
                  type="button"
                  onClick={() => setEndDateMode("duration")}
                  className={`flex-1 h-7 text-[10px] font-medium transition-colors ${
                    endDateMode === "duration"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Set Duration
                </button>
              </div>
              {endDateMode === "date" ? (
                <input
                  type="date"
                  value={shiftEndDate}
                  min={shiftForm.date}
                  onChange={e => {
                    const nextEnd = e.target.value
                    setShiftEndDate(nextEnd)
                    setShiftDurationDays(String(getInclusiveDurationDays(shiftForm.date, nextEnd)))
                  }}
                  className="h-9 rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">End Date</label>
                    <input
                      type="date"
                      value={shiftEndDate}
                      readOnly
                      className="h-9 rounded-md border border-input bg-muted/50 px-3 text-[11px] md:text-[11px] cursor-not-allowed [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">Duration (days)</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={shiftDurationDays}
                      onChange={e => {
                        const next = e.target.value
                        setShiftDurationDays(next)
                        const durationNum = Number(next)
                        if (Number.isFinite(durationNum) && durationNum > 0) {
                          setShiftEndDate(addDaysToDateKey(shiftForm.date, Math.floor(durationNum) - 1))
                        }
                      }}
                      className="h-9 rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="e.g. 5"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── Time — only for Route ── */}
            {shiftType === "route" && (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setDialogTimeEnabled(prev => !prev)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors ${
                    dialogTimeEnabled
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Clock className="size-3.5" />
                  {dialogTimeEnabled ? "Hide Time" : "Set Time (Optional)"}
                </button>
              </div>
            )}

            {shiftType === "route" && dialogTimeEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Start</label>
                  <select value={shiftForm.startHour} onChange={e => setShiftForm(p => ({ ...p, startHour: Number(e.target.value) }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                    {HOUR_OPTIONS.slice(0, 48).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">End</label>
                  <select value={shiftForm.endHour} onChange={e => setShiftForm(p => ({ ...p, endHour: Number(e.target.value) }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                    {HOUR_OPTIONS.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <div>
              {shiftDialog.mode === "edit" && shiftDialog.shift && (
                <Button variant="destructive" size="sm" onClick={() => setDeleteShiftConfirmOpen(true)} className="gap-1.5">
                  <Trash2 className="size-3.5" />Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShiftDialog(p => ({ ...p, open: false }))}>Cancel</Button>
              <Button
                size="sm"
                className={shiftDialog.mode === "add" ? "bg-emerald-600 text-white hover:bg-emerald-700" : undefined}
                onClick={saveShift}
              >
                {shiftDialog.mode === "add" ? "Add Shift" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Resource Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={deleteShiftConfirmOpen} onOpenChange={setDeleteShiftConfirmOpen}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-red-500/10 rounded-lg text-red-500">
                <Trash2 className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                Delete Shift
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete this shift?
              {shiftDialog.shift && (
                <><br /><strong>{shiftDialog.shift.title}</strong> on <strong>{shiftDialog.shift.date}</strong></>
              )}
            </p>
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteShiftConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (shiftDialog.shift) {
                  await deleteShift(shiftDialog.shift.id)
                }
                setDeleteShiftConfirmOpen(false)
                setShiftDialog({ open: false, mode: "add" })
              }}
            >
              Delete Shift
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={resourceDialog.open} onOpenChange={o => !o && setResourceDialog(p => ({ ...p, open: false }))}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-primary/10 rounded-lg text-primary">
                <Users className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                {resourceDialog.mode === "add" ? "Add Staff" : "Edit Staff"}
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input placeholder="e.g. Ahmad Faris" value={resForm.name} onChange={e => setResForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Role</label>
              <Input placeholder="e.g. Driver, Operator" value={resForm.role} onChange={e => setResForm(p => ({ ...p, role: e.target.value }))} />
            </div>
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <div>
              {resourceDialog.mode === "edit" && resourceDialog.resource && (
                <Button variant="destructive" size="sm" onClick={() => setDeleteStaffConfirmDialog({ open: true, resourceId: resourceDialog.resource!.id, resourceName: resourceDialog.resource!.name })} className="gap-1.5">
                  <Trash2 className="size-3.5" />Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setResourceDialog(p => ({ ...p, open: false }))}>Cancel</Button>
              <Button size="sm" onClick={saveResource}>{resourceDialog.mode === "add" ? "Add" : "Save"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Change Staff Dialog ───────────────────────────────────────────────── */}
      <Dialog open={changeStaffDialog.open} onOpenChange={o => !o && setChangeStaffDialog({ open: false })}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-primary/10 rounded-lg text-primary">
                <Users className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                Change Staff
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Move {selectedShifts.length} selected shift{selectedShifts.length > 1 ? 's' : ''} to another staff member.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Select Staff</label>
              <select
                value={changeStaffDialog.selectedResourceId || ""}
                onChange={e => setChangeStaffDialog(prev => ({ ...prev, selectedResourceId: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">-- Select Staff --</option>
                {resources.map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.role})</option>
                ))}
              </select>
            </div>
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setChangeStaffDialog({ open: false })}>
              Cancel
            </Button>
            <Button 
              size="sm" 
              onClick={async () => {
                if (!changeStaffDialog.selectedResourceId) {
                  toast.error("Please select a staff member")
                  return
                }
                await bulkChangeStaff(changeStaffDialog.selectedResourceId)
                setChangeStaffDialog({ open: false })
              }}
            >
              Change Staff
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ────────────────────────────────────────── */}
      <Dialog open={deleteConfirmDialog} onOpenChange={setDeleteConfirmDialog}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-red-500/10 rounded-lg text-red-500">
                <Trash2 className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                Delete Events
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete {selectedShifts.length} selected shift{selectedShifts.length > 1 ? 's' : ''}? 
              This action cannot be undone.
            </p>
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={async () => {
                await bulkDeleteShifts()
                setDeleteConfirmDialog(false)
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Staff Confirmation Dialog ──────────────────────────────────── */}
      <Dialog open={deleteStaffConfirmDialog.open} onOpenChange={o => !o && setDeleteStaffConfirmDialog({ open: false })}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-red-500/10 rounded-lg text-red-500">
                <Trash2 className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                Delete Staff
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{deleteStaffConfirmDialog.resourceName}</strong>? 
              This will also remove all their assigned shifts. This action cannot be undone.
            </p>
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteStaffConfirmDialog({ open: false })}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={async () => {
                if (deleteStaffConfirmDialog.resourceId) {
                  await deleteResource(deleteStaffConfirmDialog.resourceId)
                  setDeleteStaffConfirmDialog({ open: false })
                  setResourceDialog({ open: false, mode: "add" })
                }
              }}
            >
              Delete Staff
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}

// ─── SHIFT BLOCK ──────────────────────────────────────────────────────────────

function ShiftBlock({
  shift,
  shiftType,
  routeColor,
  isEditMode,
  onEdit,
  isSelected,
  onToggleSelect,
}: {
  shift: Shift
  shiftType: string
  routeColor?: string
  isEditMode: boolean
  onEdit: () => void
  isSelected?: boolean
  onToggleSelect?: () => void
}) {
  // Use live route colour from Settings palette; fall back to the colour saved on the shift
  const displayColor = routeColor || shift.color
  const startLabel = formatHour(shift.startHour)
  const endLabel = formatHour(shift.endHour)
  const duration = shift.endHour - shift.startHour
  const textColor = getEventTextColor(displayColor)

  return (
    <div
      className={`select-none rounded-[4px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-all relative ${
        isEditMode ? "cursor-pointer hover:brightness-95 active:scale-[0.98]" : "cursor-default"
      }`}
      style={{
        backgroundColor: displayColor,
        borderColor: "rgba(0, 0, 0, 0.16)",
      }}
      onClick={e => { 
        e.stopPropagation(); 
        if (isEditMode) onEdit()
      }}
      title={`${shift.title}${shiftType ? ` — ${shiftType}` : ""}: ${startLabel} – ${endLabel} (${duration}h)`}
    >
      {isEditMode && onToggleSelect && (
        <div className="absolute -top-1 -right-0 z-10">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            onClick={e => e.stopPropagation()}
            className="w-4 h-4 rounded border-2 border-gray-300 bg-white/95 hover:border-primary focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      )}
      <div className="px-2 py-1.5 flex flex-col items-center text-center">
        {isEditMode ? (
          <>
            <div className="max-w-[104px] truncate text-[10px] font-semibold leading-tight tracking-[0.01em]" style={{ color: textColor }}>
              {shift.title}{shiftType ? ` — ${shiftType}` : ""}
            </div>
            <div className="text-[9px] leading-tight whitespace-nowrap mt-0.5" style={{ color: textColor, opacity: 0.92 }}>
              {startLabel} – {endLabel}
            </div>
          </>
        ) : (
          <div className="max-w-[104px] truncate text-[10px] font-semibold leading-tight tracking-[0.01em]" style={{ color: textColor }}>
            {shift.title}{shiftType ? ` — ${shiftType}` : ""}
          </div>
        )}
      </div>
    </div>
  )
}

function getEventTextColor(color: string): string {
  const normalized = color.trim().replace("#", "")
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return "#FFFFFF"

  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

  return luminance > 0.62 ? "#111827" : "#FFFFFF"
}

export default Rooster
