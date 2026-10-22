CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER', 'STORE_OWNER', 'ADMIN')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
