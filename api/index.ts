import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../lib/db';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── /api/calendar ─────────────────────────────────────────────────────────────
async function handleCalendar(req: VercelRequest, res: VercelResponse) {
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'DATABASE_URL not configured' });
  }
  await sql`CREATE TABLE IF NOT EXISTS calendar_events (
    id SERIAL PRIMARY KEY, title VARCHAR(500) NOT NULL, event_date DATE NOT NULL,
    type VARCHAR(50) DEFAULT 'event', created_at TIMESTAMP DEFAULT NOW()
  )`;
  await sql`DELETE FROM calendar_events WHERE event_date < CURRENT_DATE - INTERVAL '1 year'`;

  if (req.method === 'GET') {
    const events = await sql`SELECT id, title, event_date, type FROM calendar_events ORDER BY event_date ASC`;
    return res.status(200).json({ success: true, data: events });
  }
  if (req.method === 'POST') {
    const { id, title, event_date, type } = req.body;
    if (!title || !event_date) return res.status(400).json({ success: false, error: 'title dan event_date diperlukan' });
    let result;
    if (id) {
      result = await sql`UPDATE calendar_events SET title=${title}, event_date=${event_date}, type=${type ?? 'event'} WHERE id=${Number(id)} RETURNING id, title, event_date, type`;
    } else {
      result = await sql`INSERT INTO calendar_events (title, event_date, type) VALUES (${title}, ${event_date}, ${type ?? 'event'}) RETURNING id, title, event_date, type`;
    }
    return res.status(200).json({ success: true, data: result[0] });
  }
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: 'id diperlukan' });
    await sql`DELETE FROM calendar_events WHERE id = ${Number(id)}`;
    return res.status(200).json({ success: true });
  }
  return res.status(405).json({ success: false, error: `Method ${req.method} tidak dibenarkan` });
}

// ── /api/deliveries ───────────────────────────────────────────────────────────
async function handleDeliveries(req: VercelRequest, res: VercelResponse) {
  await sql`CREATE TABLE IF NOT EXISTS deliveries (
    id SERIAL PRIMARY KEY, tracking_no VARCHAR(100) UNIQUE NOT NULL,
    recipient_name VARCHAR(255), address TEXT, status VARCHAR(50) DEFAULT 'pending',
    delivery_date DATE, notes TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
  )`;
  if (req.method === 'GET') {
    const deliveries = await sql`SELECT * FROM deliveries ORDER BY created_at DESC`;
    return res.status(200).json({ success: true, data: deliveries });
  }
  if (req.method === 'POST') {
    const { tracking_no, recipient_name, address, status, delivery_date, notes } = req.body;
    if (!tracking_no) return res.status(400).json({ success: false, error: 'tracking_no diperlukan' });
    const result = await sql`
      INSERT INTO deliveries (tracking_no, recipient_name, address, status, delivery_date, notes)
      VALUES (${tracking_no}, ${recipient_name}, ${address}, ${status ?? 'pending'}, ${delivery_date}, ${notes})
      ON CONFLICT (tracking_no) DO UPDATE
        SET recipient_name=EXCLUDED.recipient_name, address=EXCLUDED.address, status=EXCLUDED.status,
            delivery_date=EXCLUDED.delivery_date, notes=EXCLUDED.notes, updated_at=NOW()
      RETURNING *`;
    return res.status(200).json({ success: true, data: result[0] });
  }
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: 'id diperlukan' });
    await sql`DELETE FROM deliveries WHERE id = ${Number(id)}`;
    return res.status(200).json({ success: true });
  }
  return res.status(405).json({ success: false, error: `Method ${req.method} tidak dibenarkan` });
}

// ── /api/notes ────────────────────────────────────────────────────────────────
async function handleNotes(req: VercelRequest, res: VercelResponse) {
  await sql`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, type VARCHAR(20) NOT NULL DEFAULT 'note', title VARCHAR(500) NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '', version VARCHAR(50) DEFAULT NULL, author VARCHAR(255) DEFAULT 'Admin',
    pinned BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
  )`;
  if (req.method === 'GET') {
    const { type } = req.query;
    let result;
    if (type === 'note') result = await sql`SELECT * FROM notes WHERE type='note' ORDER BY pinned DESC, created_at DESC`;
    else if (type === 'changelog') result = await sql`SELECT * FROM notes WHERE type='changelog' ORDER BY created_at DESC`;
    else result = await sql`SELECT * FROM notes ORDER BY type ASC, pinned DESC, created_at DESC`;
    return res.status(200).json({ success: true, data: result });
  }
  if (req.method === 'POST') {
    const { id, type, title, content, version, author, pinned } = req.body;
    if (!id || !type || !content) return res.status(400).json({ success: false, error: 'id, type dan content diperlukan' });
    await sql`
      INSERT INTO notes (id, type, title, content, version, author, pinned, updated_at)
      VALUES (${id}, ${type}, ${title ?? ''}, ${content}, ${version ?? null}, ${author ?? 'Admin'}, ${pinned ?? false}, NOW())
      ON CONFLICT (id) DO UPDATE
        SET title=EXCLUDED.title, content=EXCLUDED.content, version=EXCLUDED.version,
            author=EXCLUDED.author, pinned=EXCLUDED.pinned, updated_at=NOW()`;
    return res.status(200).json({ success: true });
  }
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id || typeof id !== 'string') return res.status(400).json({ success: false, error: 'id diperlukan' });
    await sql`DELETE FROM notes WHERE id = ${id}`;
    return res.status(200).json({ success: true });
  }
  return res.status(405).json({ success: false, error: `Method ${req.method} tidak dibenarkan` });
}

// ── /api/plano ────────────────────────────────────────────────────────────────
async function handlePlano(req: VercelRequest, res: VercelResponse) {
  await sql`CREATE TABLE IF NOT EXISTS plano_vm (id TEXT PRIMARY KEY, pages JSONB DEFAULT '[]', updated_at TIMESTAMP DEFAULT NOW())`;
  await sql`INSERT INTO plano_vm (id, pages) VALUES ('default', '[]') ON CONFLICT (id) DO NOTHING`;
  if (req.method === 'GET') {
    const result = await sql`SELECT pages FROM plano_vm WHERE id = 'default'`;
    return res.status(200).json({ success: true, data: result[0]?.pages ?? [] });
  }
  if (req.method === 'POST') {
    const { pages } = req.body;
    if (!Array.isArray(pages)) return res.status(400).json({ success: false, error: 'pages array diperlukan' });
    await sql`UPDATE plano_vm SET pages=${JSON.stringify(pages)}, updated_at=NOW() WHERE id='default'`;
    return res.status(200).json({ success: true });
  }
  return res.status(405).json({ success: false, error: `Method ${req.method} tidak dibenarkan` });
}

// ── /api/proxy-image ──────────────────────────────────────────────────────────
async function handleProxyImage(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL parameter required' });
  if (!url.match(/^https?:\/\//)) return res.status(400).json({ error: 'Only HTTP/HTTPS URLs allowed' });
  if (url.length > 2000) return res.status(400).json({ error: 'URL too long' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'QR-Scanner-Bot/1.0' } });
  clearTimeout(timeout);
  if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch image' });
  const contentType = response.headers.get('content-type');
  if (!contentType?.startsWith('image/')) return res.status(415).json({ error: 'Not an image' });
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) return res.status(413).json({ error: 'Image too large' });
  const buffer = await response.arrayBuffer();
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).send(Buffer.from(buffer));
}

// ── /api/rooster ──────────────────────────────────────────────────────────────
async function handleRooster(req: VercelRequest, res: VercelResponse) {
  await sql`CREATE TABLE IF NOT EXISTS rooster_resources (
    id TEXT PRIMARY KEY, name VARCHAR(200) NOT NULL, role VARCHAR(100) DEFAULT '',
    color VARCHAR(20) DEFAULT '#3B82F6', created_at TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS rooster_shifts (
    id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES rooster_resources(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL, shift_date DATE NOT NULL, start_hour INTEGER NOT NULL DEFAULT 8,
    end_hour INTEGER NOT NULL DEFAULT 16, color VARCHAR(20) NOT NULL DEFAULT '#3B82F6', created_at TIMESTAMP DEFAULT NOW()
  )`;
  if (req.method === 'GET') {
    const resources = await sql`SELECT id, name, role, color FROM rooster_resources ORDER BY created_at ASC`;
    const shifts = await sql`SELECT id, resource_id, title, shift_date, start_hour, end_hour, color FROM rooster_shifts ORDER BY shift_date ASC, start_hour ASC`;
    return res.status(200).json({ success: true, resources, shifts });
  }
  if (req.method === 'POST') {
    const { type } = req.body;
    if (type === 'resource') {
      const { id, name, role, color } = req.body;
      if (!id || !name) return res.status(400).json({ success: false, error: 'id and name required' });
      await sql`INSERT INTO rooster_resources (id, name, role, color) VALUES (${id}, ${name}, ${role ?? ''}, ${color ?? '#3B82F6'})
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, color=EXCLUDED.color`;
      return res.status(200).json({ success: true });
    }
    if (type === 'shift') {
      const { id, resource_id, title, shift_date, start_hour, end_hour, color } = req.body;
      if (!id || !resource_id || !title || !shift_date) return res.status(400).json({ success: false, error: 'id, resource_id, title, shift_date required' });
      await sql`INSERT INTO rooster_shifts (id, resource_id, title, shift_date, start_hour, end_hour, color)
        VALUES (${id}, ${resource_id}, ${title}, ${shift_date}, ${start_hour ?? 8}, ${end_hour ?? 16}, ${color ?? '#3B82F6'})
        ON CONFLICT (id) DO UPDATE SET resource_id=EXCLUDED.resource_id, title=EXCLUDED.title,
          shift_date=EXCLUDED.shift_date, start_hour=EXCLUDED.start_hour, end_hour=EXCLUDED.end_hour, color=EXCLUDED.color`;
      return res.status(200).json({ success: true });
    }
    return res.status(400).json({ success: false, error: 'type must be "resource" or "shift"' });
  }
  if (req.method === 'DELETE') {
    const { type, id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    if (type === 'resource') { await sql`DELETE FROM rooster_resources WHERE id = ${String(id)}`; return res.status(200).json({ success: true }); }
    if (type === 'shift') { await sql`DELETE FROM rooster_shifts WHERE id = ${String(id)}`; return res.status(200).json({ success: true }); }
    return res.status(400).json({ success: false, error: 'type must be "resource" or "shift"' });
  }
  return res.status(405).json({ success: false, error: `Method ${req.method} not allowed` });
}

// ── /api/route-notes ──────────────────────────────────────────────────────────
async function handleRouteNotes(req: VercelRequest, res: VercelResponse) {
  await sql`CREATE TABLE IF NOT EXISTS route_notes (
    id TEXT PRIMARY KEY, route_id TEXT NOT NULL, type VARCHAR(20) NOT NULL DEFAULT 'note',
    text TEXT NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_route_notes_route_id ON route_notes(route_id)`;
  if (req.method === 'GET') {
    const { routeId } = req.query;
    if (!routeId || typeof routeId !== 'string') return res.status(400).json({ success: false, error: 'routeId diperlukan' });
    const notes = await sql`SELECT * FROM route_notes WHERE route_id=${routeId} AND type='note' ORDER BY created_at DESC`;
    const changelog = await sql`SELECT * FROM route_notes WHERE route_id=${routeId} AND type='changelog' ORDER BY created_at DESC LIMIT 200`;
    return res.status(200).json({ success: true, notes, changelog });
  }
  if (req.method === 'POST') {
    const { id, routeId, type, text } = req.body;
    if (!id || !routeId || !type || !text) return res.status(400).json({ success: false, error: 'id, routeId, type, text diperlukan' });
    await sql`INSERT INTO route_notes (id, route_id, type, text) VALUES (${id}, ${routeId}, ${type}, ${text}) ON CONFLICT (id) DO NOTHING`;
    return res.status(200).json({ success: true });
  }
  if (req.method === 'DELETE') {
    const { id, routeId, type } = req.query;
    // Clear all changelog entries for a route
    if (routeId && type === 'changelog') {
      if (typeof routeId !== 'string') return res.status(400).json({ success: false, error: 'routeId diperlukan' });
      await sql`DELETE FROM route_notes WHERE route_id=${routeId} AND type='changelog'`;
      return res.status(200).json({ success: true });
    }
    if (!id || typeof id !== 'string') return res.status(400).json({ success: false, error: 'id diperlukan' });
    await sql`DELETE FROM route_notes WHERE id=${id} AND type='note'`;
    return res.status(200).json({ success: true });
  }
  return res.status(405).json({ success: false, error: `Method ${req.method} tidak dibenarkan` });
}

// ── /api/routes ───────────────────────────────────────────────────────────────
async function handleRoutes(req: VercelRequest, res: VercelResponse) {
  await sql`CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY, name VARCHAR(255) NOT NULL, code VARCHAR(100) NOT NULL,
    shift VARCHAR(50) DEFAULT 'AM', delivery_points JSONB DEFAULT '[]',
    color VARCHAR(20) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
  )`;
  await sql`ALTER TABLE routes ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT NULL`;
  if (req.method === 'GET') {
    const result = await sql`SELECT * FROM routes ORDER BY created_at ASC`;
    const routes = result.map((row: Record<string, unknown>) => ({
      id: row.id, name: row.name, code: row.code, shift: row.shift,
      color: row.color ?? null,
      deliveryPoints: row.delivery_points, updatedAt: row.updated_at,
    }));
    return res.status(200).json({ success: true, data: routes });
  }
  if (req.method === 'POST') {
    const { routes, changedRouteIds } = req.body;
    if (!Array.isArray(routes)) return res.status(400).json({ success: false, error: 'routes array diperlukan' });
    const changedIds: string[] = Array.isArray(changedRouteIds) ? changedRouteIds : [];
    const ids = routes.map((r: { id: string }) => r.id);
    if (ids.length > 0) { await sql`DELETE FROM routes WHERE id != ALL(${ids}::text[])`; }
    else { await sql`DELETE FROM routes`; }
    for (const route of routes) {
      const isChanged = changedIds.includes(route.id);
      await sql`INSERT INTO routes (id, name, code, shift, delivery_points, color, updated_at)
        VALUES (${route.id}, ${route.name}, ${route.code}, ${route.shift}, ${JSON.stringify(route.deliveryPoints)}, ${route.color ?? null}, NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, code=EXCLUDED.code, shift=EXCLUDED.shift,
          delivery_points=EXCLUDED.delivery_points, color=EXCLUDED.color,
          updated_at=CASE WHEN ${isChanged} THEN NOW() ELSE routes.updated_at END`;
    }
    return res.status(200).json({ success: true });
  }
  if (req.method === 'PATCH') {
    const { id, color } = req.body;
    if (!id || !color) return res.status(400).json({ success: false, error: 'id dan color diperlukan' });
    await sql`UPDATE routes SET color=${color}, updated_at=NOW() WHERE id=${id}`;
    return res.status(200).json({ success: true });
  }
  return res.status(405).json({ success: false, error: `Method ${req.method} tidak dibenarkan` });
}

// ── Main router ───────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Extract path segment after /api/
  const url = req.url ?? '';
  const segment = url.replace(/^\/api\//, '').split('?')[0].split('/')[0];

  try {
    switch (segment) {
      case 'calendar':    return await handleCalendar(req, res);
      case 'deliveries':  return await handleDeliveries(req, res);
      case 'notes':       return await handleNotes(req, res);
      case 'plano':       return await handlePlano(req, res);
      case 'proxy-image': return await handleProxyImage(req, res);
      case 'rooster':     return await handleRooster(req, res);
      case 'route-notes': return await handleRouteNotes(req, res);
      case 'routes':      return await handleRoutes(req, res);
      default:
        return res.status(404).json({ success: false, error: `Unknown endpoint: /api/${segment}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[api/${segment}]`, error);
    return res.status(500).json({ success: false, error: message });
  }
}
