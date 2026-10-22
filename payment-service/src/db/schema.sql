CREATE TABLE IF NOT EXISTS payments (
  id             SERIAL PRIMARY KEY,
  order_id       INT NOT NULL UNIQUE,
  amount         INT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
