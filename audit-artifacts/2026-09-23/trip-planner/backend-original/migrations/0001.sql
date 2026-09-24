CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 100),
  budget_cents INTEGER NOT NULL CHECK (budget_cents BETWEEN 0 AND 100000000),
  version INTEGER NOT NULL DEFAULT 1,
  reserved_seats INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS trip_members (
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (trip_id, user_id),
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  seats INTEGER NOT NULL CHECK (seats > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (trip_id, user_id, idempotency_key),
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (trip_id, user_id, idempotency_key),
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_owner ON trips(owner_id);
CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_trip ON bookings(trip_id);
CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);
CREATE INDEX IF NOT EXISTS idx_audit_trip ON audit_events(trip_id);

CREATE TRIGGER IF NOT EXISTS booking_insert_trigger
BEFORE INSERT ON bookings
FOR EACH ROW
WHEN NEW.status = 'active'
BEGIN
  SELECT CASE
    WHEN (SELECT reserved_seats FROM trips WHERE id = NEW.trip_id) + NEW.seats > 
         (SELECT capacity FROM trips WHERE id = NEW.trip_id)
    THEN RAISE(ABORT, 'capacity_exceeded')
  END;
  
  UPDATE trips SET reserved_seats = reserved_seats + NEW.seats, updated_at = datetime('now')
  WHERE id = NEW.trip_id;
  
  INSERT INTO audit_events (id, trip_id, user_id, event_type, details)
  VALUES (
    lower(hex(randomblob(16))),
    NEW.trip_id,
    NEW.user_id,
    'booking_created',
    json_object('booking_id', NEW.id, 'seats', NEW.seats)
  );
END;

CREATE TRIGGER IF NOT EXISTS booking_cancel_trigger
AFTER UPDATE OF status ON bookings
FOR EACH ROW
WHEN NEW.status = 'cancelled' AND OLD.status = 'active'
BEGIN
  UPDATE trips SET reserved_seats = reserved_seats - OLD.seats, updated_at = datetime('now')
  WHERE id = OLD.trip_id;
  
  INSERT INTO audit_events (id, trip_id, user_id, event_type, details)
  VALUES (
    lower(hex(randomblob(16))),
    OLD.trip_id,
    OLD.user_id,
    'booking_cancelled',
    json_object('booking_id', OLD.id, 'seats', OLD.seats)
  );
END;

CREATE TRIGGER IF NOT EXISTS expense_insert_trigger
AFTER INSERT ON expenses
FOR EACH ROW
BEGIN
  INSERT INTO audit_events (id, trip_id, user_id, event_type, details)
  VALUES (
    lower(hex(randomblob(16))),
    NEW.trip_id,
    NEW.user_id,
    'expense_created',
    json_object('expense_id', NEW.id, 'amount_cents', NEW.amount_cents)
  );
END;