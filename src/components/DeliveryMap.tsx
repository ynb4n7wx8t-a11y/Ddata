import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet"
import L from "leaflet"

const INITIAL_MARKER_RENDER = 64
const MARKER_RENDER_CHUNK = 96

const DELIVERY_COLORS: Record<string, string> = {
  Daily:      "#22c55e",
  "Alt 1":    "#f59e0b",
  "Alt 2":    "#a855f7",
  Weekday:   "#3b82f6",
  "Weekday 2": "#3b82f6",
  "Weekday 3": "#6366f1",
}

interface DeliveryPoint {
  code: string
  name: string
  delivery: string
  latitude: number
  longitude: number
  descriptions: { key: string; value: string }[]
  markerColor?: string
  routeLabel?: string
  routeId?: string
}

interface DeliveryMapProps {
  deliveryPoints: DeliveryPoint[]
  scrollZoom?: boolean
  showPolyline?: boolean
  markerStyle?: "pin" | "dot" | "ring"
  mapStyle?: "google-streets" | "google-satellite" | "osm"
  startPoint?: { lat: number; lng: number }
  includeStartInBounds?: boolean
  refitToken?: number
  resizeToken?: number
}

interface TileConfigItem {
  attribution: string
  url: string
  subdomains: string[]
  maxZoom: number
  maxNativeZoom: number
}

function isDeliveryOnToday(delivery: string, date: Date = new Date()): boolean {
  const dayOfWeek = date.getDay() // 0=Sun, 1=Mon, ...
  const localNoon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0)
  const epochDay = Math.floor(localNoon.getTime() / 86400000)

  switch (delivery) {
    case "Daily":
      return true
    case "Alt 1":
      return epochDay % 2 !== 0
    case "Alt 2":
      return epochDay % 2 === 0
    case "Weekday":
      return dayOfWeek >= 0 && dayOfWeek <= 4
    case "Weekday 2":
      return dayOfWeek >= 1 && dayOfWeek <= 5
    case "Weekday 3":
      return [0, 2, 5].includes(dayOfWeek)
    default:
      return true
  }
}

const TILE_CONFIG: Record<"google-streets" | "google-satellite" | "osm", TileConfigItem> = {
  "google-streets": {
    attribution: "Map data © Google",
    url: "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 20,
    maxNativeZoom: 20,
  },
  "google-satellite": {
    attribution: "Map data © Google",
    url: "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 20,
    maxNativeZoom: 20,
  },
  osm: {
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    subdomains: ["a", "b", "c", "d"],
    maxZoom: 20,
    maxNativeZoom: 19,
  },
}

function createPinIcon(color: string, active = false): L.Icon {
  // Use the standard Leaflet marker images but tinted via a coloured shadow trick
  // with a compact size (12×20 instead of default 25×41)
  const size: [number, number]   = active ? [16, 27] : [12, 20]
  const anchor: [number, number] = [size[0] / 2, size[1]]

  // Build a data-URI that recolours the default Leaflet pin SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 41" width="${size[0]}" height="${size[1]}">
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
    <circle cx="12.5" cy="12.5" r="4.5" fill="white" opacity="0.9"/>
  </svg>`
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

  return L.icon({
    iconUrl:    url,
    iconSize:   size,
    iconAnchor: anchor,
    popupAnchor: [0, -(size[1] + 4)],
  })
}

function createDotIcon(color: string, active = false): L.DivIcon {
  const size = active ? 10 : 8
  return L.divIcon({
    className: "",
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size + 4)],
    html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px ${color}88,0 2px 6px #00000030"></div>`,
  })
}

function createRingIcon(color: string, active = false): L.DivIcon {
  const outer = active ? 14 : 10
  const inner = active ? 6 : 4
  return L.divIcon({
    className: "",
    iconAnchor: [outer / 2, outer / 2],
    popupAnchor: [0, -(outer + 4)],
    html: `<div style="width:${outer}px;height:${outer}px;border-radius:999px;border:2px solid ${color};background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px #00000020"><div style="width:${inner}px;height:${inner}px;border-radius:999px;background:${color}"></div></div>`,
  })
}

function createMarkerIcon(style: "pin" | "dot" | "ring", color: string, active = false): L.Icon | L.DivIcon {
  if (style === "dot") return createDotIcon(color, active)
  if (style === "ring") return createRingIcon(color, active)
  return createPinIcon(color, active)
}

const markerIconCache = new Map<string, L.Icon | L.DivIcon>()

function getCachedMarkerIcon(style: "pin" | "dot" | "ring", color: string, active = false): L.Icon | L.DivIcon {
  const key = `${style}|${color}|${active ? 1 : 0}`
  const cached = markerIconCache.get(key)
  if (cached) return cached
  const created = createMarkerIcon(style, color, active)
  markerIconCache.set(key, created)
  return created
}

// Badge html shown on grouped markers (count > 1)
const stackBadge = (count: number) =>
  `<div style="position:absolute;top:-5px;right:-7px;background:#1d4ed8;color:#fff;border-radius:999px;font-size:8px;font-weight:700;padding:1px 3.5px;line-height:1.4;border:1.5px solid #fff;min-width:14px;text-align:center;pointer-events:none">${count}</div>`

function createGroupedIcon(
  style: "pin" | "dot" | "ring",
  color: string,
  count: number,
  active = false
): L.Icon | L.DivIcon {
  if (count <= 1) return getCachedMarkerIcon(style, color, active)

  const badge = stackBadge(count)

  if (style === "dot") {
    const size = active ? 10 : 8
    return L.divIcon({
      className: "",
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -(size + 4)],
      html: `<div style="position:relative;display:inline-block"><div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px ${color}88,0 2px 6px #00000030"></div>${badge}</div>`,
    })
  }

  if (style === "ring") {
    const outer = active ? 14 : 10
    const inner = active ? 6 : 4
    return L.divIcon({
      className: "",
      iconAnchor: [outer / 2, outer / 2],
      popupAnchor: [0, -(outer + 4)],
      html: `<div style="position:relative;display:inline-block"><div style="width:${outer}px;height:${outer}px;border-radius:999px;border:2px solid ${color};background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px #00000020"><div style="width:${inner}px;height:${inner}px;border-radius:999px;background:${color}"></div></div>${badge}</div>`,
    })
  }

  // pin
  const w = active ? 16 : 12
  const h = active ? 27 : 20
  const svgPin = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 41" width="${w}" height="${h}"><path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="12.5" cy="12.5" r="4.5" fill="white" opacity="0.9"/></svg>`
  return L.divIcon({
    className: "",
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -(h + 4)],
    html: `<div style="position:relative;display:inline-block">${svgPin}${badge}</div>`,
  })
}

const groupedIconCache = new Map<string, L.Icon | L.DivIcon>()

function getCachedGroupedIcon(style: "pin" | "dot" | "ring", color: string, count: number, active = false): L.Icon | L.DivIcon {
  const key = `${style}|${color}|${count}|${active ? 1 : 0}`
  const cached = groupedIconCache.get(key)
  if (cached) return cached
  const created = createGroupedIcon(style, color, count, active)
  groupedIconCache.set(key, created)
  return created
}

/** Fits map bounds whenever validPoints changes */
function BoundsController({ points, startPoint, includeStartInBounds = true, refitToken }: { points: DeliveryPoint[]; startPoint?: { lat: number; lng: number }; includeStartInBounds?: boolean; refitToken?: number }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0 && !startPoint) return

    if (points.length === 0 && startPoint) {
      map.setView([startPoint.lat, startPoint.lng], 14)
      return
    }

    const bounds = L.latLngBounds(points.map(p => [p.latitude, p.longitude] as [number, number]))
    if (startPoint && includeStartInBounds) bounds.extend([startPoint.lat, startPoint.lng])

    if (bounds.isValid() && bounds.getSouthWest().equals(bounds.getNorthEast())) {
      map.setView([points[0].latitude, points[0].longitude], 14)
    } else {
      map.fitBounds(bounds, { padding: [40, 40] })
    }
  }, [points, startPoint, includeStartInBounds, refitToken])
  return null
}

function ResizeController({ resizeToken }: { resizeToken?: number }) {
  const map = useMap()

  useEffect(() => {
    // Fullscreen/container transitions need delayed invalidation so Leaflet recalculates final size.
    map.invalidateSize(false)
    const t1 = window.setTimeout(() => map.invalidateSize(false), 120)
    const t2 = window.setTimeout(() => map.invalidateSize(false), 280)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [map, resizeToken])

  return null
}

interface GroupedMarkerItemProps {
  points: DeliveryPoint[]
  markerStyle: "pin" | "dot" | "ring"
  color: string
  isActive: boolean
  groupKey: string
  onToggleActive: (groupKey: string) => void
}

const GroupedMarkerItem = memo(function GroupedMarkerItem({ points, markerStyle, color, isActive, groupKey, onToggleActive }: GroupedMarkerItemProps) {
  const markerRef = useRef<L.Marker | null>(null)
  const first = points[0]

  useEffect(() => {
    if (!markerRef.current) return
    if (isActive) {
      markerRef.current.openPopup()
    } else {
      markerRef.current.closePopup()
    }
  }, [isActive])

  return (
    <Marker
      ref={markerRef}
      position={[first.latitude, first.longitude]}
      icon={getCachedGroupedIcon(markerStyle, color, points.length, isActive)}
      eventHandlers={{
        click: () => onToggleActive(groupKey),
        popupopen: () => onToggleActive(groupKey),
        popupclose: () => onToggleActive(""),
      }}
    >
      <Popup autoPan={false}>
        <div style={{ fontFamily: "system-ui, sans-serif", minWidth: 160, padding: "2px 0" }}>
          {points.map((p, i) => (
            <div
              key={`${p.routeId ?? ""}-${p.code}`}
              style={i > 0 ? { marginTop: 6, paddingTop: 6, borderTop: "1px solid #e5e7eb" } : undefined}
            >
              <p style={{ margin: 0, fontWeight: 700, fontSize: 12, color: "#111", lineHeight: 1.35 }}>
                {p.code} — {p.name}
              </p>
              {p.routeLabel && (
                <p style={{ margin: "2px 0 0", fontSize: 10, color: "#6b7280" }}>{p.routeLabel}</p>
              )}
            </div>
          ))}
        </div>
      </Popup>
    </Marker>
  )
}, (prev, next) => (
  prev.points === next.points
  && prev.markerStyle === next.markerStyle
  && prev.color === next.color
  && prev.isActive === next.isActive
  && prev.groupKey === next.groupKey
  && prev.onToggleActive === next.onToggleActive
))

export function DeliveryMap({ deliveryPoints, scrollZoom = false, showPolyline = false, markerStyle = "pin", mapStyle = "google-streets", startPoint, includeStartInBounds = true, refitToken = 0, resizeToken = 0 }: DeliveryMapProps) {
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null)
  const [renderedMarkerCount, setRenderedMarkerCount] = useState(INITIAL_MARKER_RENDER)
  const tiles = TILE_CONFIG[mapStyle]

  const toggleActive = useCallback((key: string) => {
    if (key === "") {
      setActiveGroupKey(null)
      return
    }
    setActiveGroupKey((prev) => (prev === key ? null : key))
  }, [])

  const validPoints = useMemo(
    () => deliveryPoints.filter(p => p.latitude !== 0 && p.longitude !== 0),
    [deliveryPoints]
  )
  const deferredPoints = useDeferredValue(validPoints)

  // Render marker nodes progressively to avoid long first-paint stalls on large routes.
  useEffect(() => {
    setRenderedMarkerCount(INITIAL_MARKER_RENDER)
  }, [deferredPoints.length, mapStyle, markerStyle])

  useEffect(() => {
    if (renderedMarkerCount >= deferredPoints.length) return

    let cancelled = false
    const schedule =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? (cb: () => void) => (window as Window & { requestIdleCallback: (fn: () => void) => number }).requestIdleCallback(cb)
        : (cb: () => void) => window.setTimeout(cb, 16)
    const cancel =
      typeof window !== "undefined" && "cancelIdleCallback" in window
        ? (id: number) => (window as Window & { cancelIdleCallback: (x: number) => void }).cancelIdleCallback(id)
        : (id: number) => window.clearTimeout(id)

    const id = schedule(() => {
      if (cancelled) return
      setRenderedMarkerCount((prev) => Math.min(prev + MARKER_RENDER_CHUNK, deferredPoints.length))
    })

    return () => {
      cancelled = true
      cancel(id)
    }
  }, [renderedMarkerCount, deferredPoints.length])

  const renderedPoints = useMemo(
    () => deferredPoints.slice(0, Math.min(renderedMarkerCount, deferredPoints.length)),
    [deferredPoints, renderedMarkerCount]
  )

  // Group co-located points (same lat/lng) into a single marker
  const groupedMarkers = useMemo(() => {
    const map = new Map<string, { points: DeliveryPoint[]; color: string }>()
    renderedPoints.forEach((p) => {
      const key = `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`
      const color = p.markerColor ?? DELIVERY_COLORS[p.delivery] ?? "#6b7280"
      if (!map.has(key)) map.set(key, { points: [], color })
      map.get(key)!.points.push(p)
    })
    return Array.from(map.entries()).map(([key, { points, color }]) => ({ key, points, color }))
  }, [renderedPoints])

  const center = useMemo((): [number, number] => {
    if (startPoint) return [startPoint.lat, startPoint.lng]
    if (deferredPoints.length === 0) return [3.15, 101.65]
    return [
      deferredPoints.reduce((s, p) => s + p.latitude,  0) / deferredPoints.length,
      deferredPoints.reduce((s, p) => s + p.longitude, 0) / deferredPoints.length,
    ]
  }, [deferredPoints, startPoint])

  const polylineGroups = useMemo(() => {
    if (!showPolyline) return [] as Array<{ id: string; positions: [number, number][] }>

    // Polyline follows only locations that are active for today's delivery schedule.
    const polylinePoints = deferredPoints.filter((point) => isDeliveryOnToday(point.delivery))

    const grouped = new Map<string, [number, number][]>();
    polylinePoints.forEach((point) => {
      const groupId = point.routeId ?? "single-route"
      const positions = grouped.get(groupId) ?? (startPoint ? [[startPoint.lat, startPoint.lng]] as [number, number][] : [])
      positions.push([point.latitude, point.longitude])
      grouped.set(groupId, positions)
    })

    return Array.from(grouped.entries())
      .map(([id, positions]) => ({ id, positions }))
      .filter((item) => item.positions.length >= 2)
  }, [deferredPoints, showPolyline, startPoint])

  return (
    <MapContainer
      center={center}
      zoom={13}
      preferCanvas={true}
      zoomAnimation={false}
      fadeAnimation={false}
      markerZoomAnimation={false}
      scrollWheelZoom={scrollZoom}
      style={{ width: "100%", height: "100%" }}
    >
      <TileLayer
        attribution={tiles.attribution}
        url={tiles.url}
        subdomains={tiles.subdomains}
        maxZoom={tiles.maxZoom}
        maxNativeZoom={tiles.maxNativeZoom}
        updateWhenIdle={false}
        updateWhenZooming={false}
        keepBuffer={4}
        detectRetina={false}
        crossOrigin={true}
      />
      <ResizeController resizeToken={resizeToken} />
      <BoundsController points={deferredPoints} startPoint={startPoint} includeStartInBounds={includeStartInBounds} refitToken={refitToken} />
      {startPoint && (
        <Marker
          key="start-point"
          position={[startPoint.lat, startPoint.lng]}
          icon={getCachedMarkerIcon(markerStyle, "#111111", false)}
        >
          <Popup autoPan={false}>
            <div style={{ fontFamily: "system-ui, sans-serif", minWidth: 120 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#111" }}>Starting Point</p>
            </div>
          </Popup>
        </Marker>
      )}
      {polylineGroups.map((group) => (
        <Polyline
          key={group.id}
          positions={group.positions}
          pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.75 }}
        />
      ))}
      {groupedMarkers.map(({ key, points, color }) => (
        <GroupedMarkerItem
          key={key}
          points={points}
          markerStyle={markerStyle}
          color={color}
          isActive={activeGroupKey === key}
          groupKey={key}
          onToggleActive={toggleActive}
        />
      ))}
    </MapContainer>
  )
}
