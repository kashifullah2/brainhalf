// worker/index.ts
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
function error(message, status = 400) {
  return json({ error: message }, status);
}
function uuid() {
  return crypto.randomUUID();
}
function getUserId(request, env) {
  if (env.BRAINHALF_MANAGED !== "true") {
    return null;
  }
  return request.headers.get("x-bh-user-id");
}
function requireUser(request, env) {
  const userId = getUserId(request, env);
  if (!userId) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  return userId;
}
function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const url = new URL(request.url);
  return origin === url.origin;
}
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw error("JSON object required");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 16384) {
      await reader.cancel();
      throw error("Request body too large", 413);
    }
    text += decoder.decode(part.value, { stream: true });
  }
  try {
    const value = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
}
async function ensureUser(env, userId) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)"
  ).bind(userId, `user-${userId}@example.com`, "").run();
}
async function isTripMember(env, tripId, userId) {
  const result = await env.DB.prepare(
    "SELECT 1 FROM trip_members WHERE trip_id = ? AND user_id = ?"
  ).bind(tripId, userId).first();
  return !!result;
}
async function isTripOwner(env, tripId, userId) {
  const trip = await env.DB.prepare(
    "SELECT owner_id FROM trips WHERE id = ?"
  ).bind(tripId).first();
  return trip?.owner_id === userId;
}
async function getTripDetail(env, tripId) {
  const trip = await env.DB.prepare(
    "SELECT * FROM trips WHERE id = ?"
  ).bind(tripId).first();
  if (!trip) return {};
  const members = await env.DB.prepare(
    "SELECT user_id, joined_at FROM trip_members WHERE trip_id = ? ORDER BY joined_at"
  ).bind(tripId).all();
  const bookings = await env.DB.prepare(
    "SELECT * FROM bookings WHERE trip_id = ? ORDER BY created_at"
  ).bind(tripId).all();
  const expenses = await env.DB.prepare(
    "SELECT * FROM expenses WHERE trip_id = ? ORDER BY created_at"
  ).bind(tripId).all();
  const spentResult = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) as total FROM expenses WHERE trip_id = ?"
  ).bind(tripId).first();
  return {
    trip,
    members: members.results || [],
    bookings: bookings.results || [],
    expenses: expenses.results || [],
    spentCents: spentResult?.total || 0
  };
}
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    try {
      if (method === "GET" && path === "/api/health") {
        return json({ status: "ok" });
      }
      if (method === "GET" && path === "/api/items") {
        const userId = requireUser(request, env);
        await ensureUser(env, userId);
        const items = await env.DB.prepare(
          "SELECT id, title, created_at FROM items WHERE user_id = ? ORDER BY created_at DESC"
        ).bind(userId).all();
        return json({ items: items.results || [] });
      }
      if (method === "POST" && path === "/api/items") {
        const userId = requireUser(request, env);
        if (!checkOrigin(request)) {
          return error("Origin not allowed", 403);
        }
        await ensureUser(env, userId);
        const body = await readBody(request);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title || title.length > 120) {
          return error("Title must be 1-120 characters");
        }
        const id = uuid();
        await env.DB.prepare(
          "INSERT INTO items (id, user_id, title) VALUES (?, ?, ?)"
        ).bind(id, userId, title).run();
        const item = await env.DB.prepare(
          "SELECT id, title, created_at FROM items WHERE id = ?"
        ).bind(id).first();
        return json({ item }, 201);
      }
      if (method === "DELETE" && path.startsWith("/api/items/")) {
        const userId = requireUser(request, env);
        if (!checkOrigin(request)) {
          return error("Origin not allowed", 403);
        }
        const itemId = path.split("/")[3];
        const result = await env.DB.prepare(
          "DELETE FROM items WHERE id = ? AND user_id = ?"
        ).bind(itemId, userId).run();
        if (result.meta.changes === 0) {
          return error("Item not found", 404);
        }
        return json({ success: true });
      }
      if (method === "POST" && path === "/api/trips") {
        const userId = requireUser(request, env);
        if (!checkOrigin(request)) {
          return error("Origin not allowed", 403);
        }
        await ensureUser(env, userId);
        const body = await readBody(request);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const capacity = typeof body.capacity === "number" ? body.capacity : NaN;
        const budgetCents = typeof body.budgetCents === "number" ? body.budgetCents : NaN;
        if (!title || title.length > 120) {
          return error("Title must be 1-120 characters");
        }
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
          return error("Capacity must be an integer 1-100");
        }
        if (!Number.isInteger(budgetCents) || budgetCents < 0 || budgetCents > 1e8) {
          return error("Budget must be an integer 0-100000000 cents");
        }
        const tripId = uuid();
        await env.DB.batch([env.DB.prepare(
          "INSERT INTO trips (id, owner_id, title, capacity, budget_cents) VALUES (?, ?, ?, ?, ?)"
        ).bind(tripId, userId, title, capacity, budgetCents), env.DB.prepare(
          "INSERT INTO trip_members (trip_id, user_id) VALUES (?, ?)"
        ).bind(tripId, userId)]);
        const trip = await env.DB.prepare(
          "SELECT * FROM trips WHERE id = ?"
        ).bind(tripId).first();
        return json({ trip }, 201);
      }
      if (method === "GET" && path === "/api/trips") {
        const userId = requireUser(request, env);
        await ensureUser(env, userId);
        const trips = await env.DB.prepare(
          `SELECT DISTINCT t.* FROM trips t
           LEFT JOIN trip_members tm ON t.id = tm.trip_id
           WHERE t.owner_id = ? OR tm.user_id = ?
           ORDER BY t.created_at DESC`
        ).bind(userId, userId).all();
        return json({ trips: trips.results || [] });
      }
      if (method === "GET" && /^\/api\/trips\/[^/]+$/.test(path)) {
        const userId = requireUser(request, env);
        const tripId = path.split("/")[3];
        if (!tripId) return error("Trip ID required");
        if (!await isTripMember(env, tripId, userId)) {
          return error("Not a member of this trip", 403);
        }
        const detail = await getTripDetail(env, tripId);
        if (!detail.trip) return error("Trip not found", 404);
        return json(detail);
      }
      if (method === "POST" && path.match(/^\/api\/trips\/[^/]+\/members$/)) {
        const userId = requireUser(request, env);
        if (!checkOrigin(request)) {
          return error("Origin not allowed", 403);
        }
        const tripId = path.split("/")[3];
        if (!await isTripOwner(env, tripId, userId)) {
          return error("Only trip owner can add members", 403);
        }
        const body = await readBody(request);
        const memberId = typeof body.userId === "string" ? body.userId : "";
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(memberId)) return error("A valid user ID is required");
        await ensureUser(env, memberId);
        await env.DB.prepare(
          "INSERT OR IGNORE INTO trip_members (trip_id, user_id) VALUES (?, ?)"
        ).bind(tripId, memberId).run();
        const member = await env.DB.prepare(
          "SELECT user_id, joined_at FROM trip_members WHERE trip_id = ? AND user_id = ?"
        ).bind(tripId, memberId).first();
        return json({ member }, 201);
      }
      if (method === "PATCH" && path.match(/^\/api\/trips\/[^/]+$/)) {
        const userId = requireUser(request, env);
        if (!checkOrigin(request)) {
          return error("Origin not allowed", 403);
        }
        const tripId = path.split("/")[3];
        if (!await isTripOwner(env, tripId, userId)) {
          return error("Only trip owner can update trip", 403);
        }
        const body = await readBody(request);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const version = typeof body.version === "number" ? body.version : NaN;
        if (!title || title.length > 120) {
          return error("Title must be 1-120 characters");
        }
        if (!Number.isInteger(version) || version < 1) {
          return error("Version must be a positive integer");
        }
        const result = await env.DB.prepare(
          "UPDATE trips SET title = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND version = ?"
        ).bind(title, tripId, version).run();
        if (result.meta.changes === 0) {
          const current = await env.DB.prepare(
            "SELECT version FROM trips WHERE id = ?"
          ).bind(tripId).first();
          if (!current) return error("Trip not found", 404);
          return error("Version conflict", 409);
        }
        const trip = await env.DB.prepare(
          "SELECT * FROM trips WHERE id = ?"
        ).bind(tripId).first();
        return json({ trip });
      }
      if (method === "POST" && path.match(/^\/api\/trips\/[^/]+\/bookings$/)) {
        const userId = requireUser(request, env);
        if (!checkOrigin(request)) {
          return error("Origin not allowed", 403);
        }
        const tripId = path.split("/")[3];
        if (!await isTripMember(env, tripId, userId)) {
          return error("Must be a trip member to book", 403);
        }
        const idempotencyKey = request.headers.get("Idempotency-Key");
        if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) {
          return error("Idempotency-Key must be 8-100 characters");
        }
        const body = await readBody(request);
        const seats = typeof body.seats === "number" ? body.seats : NaN;
        if (!Number.isSafeInteger(seats) || seats < 1 || seats > 100) {
          return error("Seats must be a positive integer");
        }
        const bookingId = uuid();
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO bookings (id,trip_id,user_id,seats,idempotency_key)
            SELECT ?,id,?,?,? FROM trips WHERE id=? AND capacity-reserved_seats>=?
            AND NOT EXISTS (SELECT 1 FROM bookings WHERE trip_id=? AND user_id=? AND idempotency_key=?)`).bind(bookingId, userId, seats, idempotencyKey, tripId, seats, tripId, userId, idempotencyKey),
          env.DB.prepare(`UPDATE trips SET reserved_seats=reserved_seats+?,updated_at=datetime('now')
            WHERE id=? AND EXISTS (SELECT 1 FROM bookings WHERE id=?)`).bind(seats, tripId, bookingId),
          env.DB.prepare(`INSERT INTO audit_events(id,trip_id,user_id,event_type,details)
            SELECT ?,trip_id,user_id,'booking_created',json_object('booking_id',id,'seats',seats) FROM bookings WHERE id=?`).bind(uuid(), bookingId)
        ]);
        const booking = await env.DB.prepare(
          "SELECT * FROM bookings WHERE trip_id=? AND user_id=? AND idempotency_key=?"
        ).bind(tripId, userId, idempotencyKey).first();
        if (!booking) return error("Not enough seats available", 409);
        if (booking.seats !== seats) return error("Idempotency key reused with different payload", 409);
        return json({ booking }, booking.id === bookingId ? 201 : 200);
      }
      if (method === "PATCH" && path.match(/^\/api\/trips\/[^/]+\/bookings\/[^/]+$/)) {
        const userId = requireUser(request, env);
        if (!checkOrigin(request)) {
          return error("Origin not allowed", 403);
        }
        const parts = path.split("/");
        const tripId = parts[3];
        const bookingId = parts[5];
        const booking = await env.DB.prepare(
          "SELECT * FROM bookings WHERE id = ? AND trip_id = ?"
        ).bind(bookingId, tripId).first();
        if (!booking) return error("Booking not found", 404);
        const isOwner = await isTripOwner(env, tripId, userId);
        if (booking.user_id !== userId && !isOwner) {
          return error("Can only cancel own booking or as trip owner", 403);
        }
        const body = await readBody(request);
        if (body.status !== "cancelled") {
          return error("Only cancellation supported");
        }
        if (booking.status === "cancelled") {
          return json({ booking });
        }
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO audit_events(id,trip_id,user_id,event_type,details)
            SELECT ?,trip_id,?,'booking_cancelled',json_object('booking_id',id,'seats',seats)
            FROM bookings WHERE id=? AND trip_id=? AND status='active'`).bind(uuid(), userId, bookingId, tripId),
          env.DB.prepare(`UPDATE trips SET reserved_seats=reserved_seats-
            (SELECT seats FROM bookings WHERE id=? AND trip_id=? AND status='active'),updated_at=datetime('now')
            WHERE id=? AND EXISTS (SELECT 1 FROM bookings WHERE id=? AND trip_id=? AND status='active')`).bind(bookingId, tripId, tripId, bookingId, tripId),
          env.DB.prepare(`UPDATE bookings SET status='cancelled',updated_at=datetime('now') WHERE id=? AND trip_id=? AND status='active'`).bind(bookingId, tripId)
        ]);
        const updated = await env.DB.prepare(
          "SELECT * FROM bookings WHERE id = ?"
        ).bind(bookingId).first();
        return json({ booking: updated });
      }
      if (method === "POST" && path.match(/^\/api\/trips\/[^/]+\/expenses$/)) {
        const userId = requireUser(request, env);
        if (!checkOrigin(request)) {
          return error("Origin not allowed", 403);
        }
        const tripId = path.split("/")[3];
        if (!await isTripMember(env, tripId, userId)) {
          return error("Must be a trip member to add expenses", 403);
        }
        const idempotencyKey = request.headers.get("Idempotency-Key");
        if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) {
          return error("Idempotency-Key must be 8-100 characters");
        }
        const body = await readBody(request);
        const description = typeof body.description === "string" ? body.description.trim() : "";
        const amountCents = typeof body.amountCents === "number" ? body.amountCents : NaN;
        if (!description || description.length > 500) {
          return error("Description required");
        }
        if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 1e8) {
          return error("Amount must be positive integer cents");
        }
        const expenseId = uuid();
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO expenses (id,trip_id,user_id,description,amount_cents,idempotency_key)
            VALUES (?,?,?,?,?,?) ON CONFLICT(trip_id,user_id,idempotency_key) DO NOTHING`).bind(expenseId, tripId, userId, description, amountCents, idempotencyKey),
          env.DB.prepare(`INSERT INTO audit_events(id,trip_id,user_id,event_type,details)
            SELECT ?,trip_id,user_id,'expense_created',json_object('expense_id',id,'amount_cents',amount_cents)
            FROM expenses WHERE id=?`).bind(uuid(), expenseId)
        ]);
        const expense = await env.DB.prepare(
          "SELECT * FROM expenses WHERE trip_id=? AND user_id=? AND idempotency_key=?"
        ).bind(tripId, userId, idempotencyKey).first();
        if (!expense) return error("Expense could not be saved", 503);
        if (expense.amount_cents !== amountCents || expense.description !== description) return error("Idempotency key reused with different payload", 409);
        return json({ expense }, expense.id === expenseId ? 201 : 200);
      }
      if (method === "GET" && path.match(/^\/api\/trips\/[^/]+\/audit$/)) {
        const userId = requireUser(request, env);
        const tripId = path.split("/")[3];
        if (!await isTripOwner(env, tripId, userId)) {
          return error("Only trip owner can view audit", 403);
        }
        const events = await env.DB.prepare(
          "SELECT * FROM audit_events WHERE trip_id = ? ORDER BY created_at DESC"
        ).bind(tripId).all();
        return json({ events: events.results || [] });
      }
      return error("Not found", 404);
    } catch (e) {
      if (e instanceof Response) return e;
      console.error("Unhandled error:", e);
      return error("Internal server error", 500);
    }
  }
};
export {
  index_default as default
};
