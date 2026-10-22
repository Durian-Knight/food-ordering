CREATE TABLE IF NOT EXISTS stores (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  address  TEXT,
  owner_id INT,
  is_open  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS menu_items (
  id        SERIAL PRIMARY KEY,
  store_id  INT NOT NULL REFERENCES stores(id),
  name      TEXT NOT NULL,
  price     INT NOT NULL CHECK (price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- available: còn bán được; reserved: đang giữ chỗ cho đơn chưa thanh toán xong
CREATE TABLE IF NOT EXISTS stock (
  item_id   INT PRIMARY KEY REFERENCES menu_items(id),
  available INT NOT NULL CHECK (available >= 0),
  reserved  INT NOT NULL DEFAULT 0 CHECK (reserved >= 0)
);

-- UNIQUE(order_id): mỗi đơn chỉ giữ chỗ 1 lần, release/confirm gọi lại không bị trừ/cộng 2 lần
CREATE TABLE IF NOT EXISTS reservations (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL UNIQUE,
  status     TEXT NOT NULL CHECK (status IN ('RESERVED', 'CONFIRMED', 'RELEASED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservation_items (
  reservation_id INT NOT NULL REFERENCES reservations(id),
  item_id        INT NOT NULL REFERENCES menu_items(id),
  qty            INT NOT NULL CHECK (qty > 0),
  PRIMARY KEY (reservation_id, item_id)
);
