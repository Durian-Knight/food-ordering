-- UNIQUE(order_id): mỗi đơn chỉ thanh toán 1 lần, gọi lại trả kết quả cũ
CREATE TABLE IF NOT EXISTS payments (
  id             SERIAL PRIMARY KEY,
  order_id       INT NOT NULL UNIQUE,
  user_id        INT NOT NULL,
  amount         INT NOT NULL CHECK (amount >= 0),
  status         TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED')),
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
