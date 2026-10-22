CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL,
  store_id     INT,             -- biết sau khi Inventory giữ chỗ xong
  total_amount INT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL CHECK (status IN ('PENDING', 'STOCK_RESERVED', 'COMPENSATING', 'CONFIRMED', 'CANCELLED')),
  cancel_reason TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lưu tên và giá tại thời điểm đặt (snapshot), không phụ thuộc Catalog về sau
CREATE TABLE IF NOT EXISTS order_items (
  order_id       INT NOT NULL REFERENCES orders(id),
  item_id        INT NOT NULL,
  name_snapshot  TEXT NOT NULL,
  price_snapshot INT NOT NULL,
  qty            INT NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, item_id)
);

-- Nhật ký từng bước Saga, dùng để cho thầy xem EXECUTE / COMPENSATE khi demo
CREATE TABLE IF NOT EXISTS saga_log (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id),
  step       TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('EXECUTE', 'COMPENSATE')),
  result     TEXT NOT NULL CHECK (result IN ('OK', 'FAIL')),
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
