CREATE TABLE app.fps_rooms (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  host_token text NOT NULL,
  guest_token text,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX fps_rooms_expires_idx ON app.fps_rooms (expires_at);

CREATE TABLE app.fps_signals (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES app.fps_rooms (id),
  sender text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX fps_signals_room_idx ON app.fps_signals (room_id);
CREATE INDEX fps_signals_expires_idx ON app.fps_signals (expires_at);
