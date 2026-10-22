import fs from 'node:fs';
import express from 'express';
import { pool, migrate } from './db.js';

const SERVICE = 'inventory-service';
const PORT = process.env.PORT || 3002;

const app = express();
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ service: SERVICE, status: 'UP', db: 'UP' });
  } catch (err) {
    res.status(503).json({ service: SERVICE, status: 'DOWN', db: err.message });
  }
});

const ITEM_SELECT = `
  SELECT m.id, m.store_id, m.name, m.price, m.is_active, s.available, s.reserved
  FROM menu_items m JOIN stock s ON s.item_id = m.id`;

const toItem = (r) => ({
  id: r.id,
  storeId: r.store_id,
  name: r.name,
  price: r.price,
  isActive: r.is_active,
  available: r.available,
  reserved: r.reserved,
});

// ---------- Catalog (công khai qua Gateway) ----------

app.get('/stores', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM stores ORDER BY id');
  res.json(rows.map((r) => ({ id: r.id, name: r.name, address: r.address, ownerId: r.owner_id, isOpen: r.is_open })));
});

app.get('/stores/:id/menu', async (req, res) => {
  const { rows } = await pool.query(`${ITEM_SELECT} WHERE m.store_id = $1 ORDER BY m.id`, [req.params.id]);
  res.json(rows.map(toItem));
});

app.get('/items/:id', async (req, res) => {
  const { rows } = await pool.query(`${ITEM_SELECT} WHERE m.id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'ITEM_NOT_FOUND' });
  res.json(toItem(rows[0]));
});

// ---------- Quản lý (STORE_OWNER của cửa hàng hoặc ADMIN) ----------

async function canManageStore(req, storeId) {
  const role = req.headers['x-user-role'];
  if (role === 'ADMIN') return true;
  if (role !== 'STORE_OWNER') return false;
  const { rows } = await pool.query('SELECT owner_id FROM stores WHERE id = $1', [storeId]);
  return rows[0]?.owner_id === Number(req.headers['x-user-id']);
}

app.post('/stores/:id/items', async (req, res) => {
  const { name, price, available = 0 } = req.body || {};
  if (!name || !Number.isInteger(price) || price < 0 || !Number.isInteger(available) || available < 0) {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }
  if (!(await canManageStore(req, req.params.id))) return res.status(403).json({ error: 'FORBIDDEN' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO menu_items (store_id, name, price) VALUES ($1, $2, $3) RETURNING id',
      [req.params.id, name, price],
    );
    await client.query('INSERT INTO stock (item_id, available) VALUES ($1, $2)', [rows[0].id, available]);
    await client.query('COMMIT');
    const item = await pool.query(`${ITEM_SELECT} WHERE m.id = $1`, [rows[0].id]);
    res.status(201).json(toItem(item.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Đặt lại số lượng còn bán được (không đụng tới phần đang giữ chỗ)
app.put('/items/:id/stock', async (req, res) => {
  const { available } = req.body || {};
  if (!Number.isInteger(available) || available < 0) return res.status(400).json({ error: 'INVALID_INPUT' });
  const found = await pool.query('SELECT store_id FROM menu_items WHERE id = $1', [req.params.id]);
  if (!found.rows[0]) return res.status(404).json({ error: 'ITEM_NOT_FOUND' });
  if (!(await canManageStore(req, found.rows[0].store_id))) return res.status(403).json({ error: 'FORBIDDEN' });

  await pool.query('UPDATE stock SET available = $1 WHERE item_id = $2', [available, req.params.id]);
  const { rows } = await pool.query(`${ITEM_SELECT} WHERE m.id = $1`, [req.params.id]);
  res.json(toItem(rows[0]));
});

// ---------- API nội bộ cho Saga (Gateway không mở ra ngoài) ----------

class HttpError extends Error {
  constructor(status, body) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

// Giữ chỗ: trừ available, cộng reserved trong 1 transaction.
// Chống bán vượt bằng UPDATE có điều kiện available >= qty (nguyên tử ở mức dòng).
app.post('/reservations', async (req, res) => {
  const { orderId, items } = req.body || {};
  if (!Number.isInteger(orderId) || !Array.isArray(items) || items.length === 0 ||
      items.some((i) => !Number.isInteger(i.itemId) || !Number.isInteger(i.qty) || i.qty <= 0)) {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }

  // Gộp món trùng và sắp xếp item_id tăng dần để các transaction khóa dòng theo cùng thứ tự (tránh deadlock)
  const merged = new Map();
  for (const i of items) merged.set(i.itemId, (merged.get(i.itemId) || 0) + i.qty);
  const sorted = [...merged.entries()].sort((a, b) => a[0] - b[0]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Đơn này đã giữ chỗ trước đó thì trả lại kết quả cũ, không trừ kho lần 2
    const existing = await client.query('SELECT * FROM reservations WHERE order_id = $1', [orderId]);
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(200).json(await reservationDetail(existing.rows[0]));
    }

    const lines = [];
    let storeId = null;
    for (const [itemId, qty] of sorted) {
      const item = await client.query('SELECT store_id, name, price, is_active FROM menu_items WHERE id = $1', [itemId]);
      if (!item.rows[0] || !item.rows[0].is_active) throw new HttpError(404, { error: 'ITEM_NOT_FOUND', itemId });
      if (storeId !== null && item.rows[0].store_id !== storeId) throw new HttpError(400, { error: 'MULTIPLE_STORES' });
      storeId = item.rows[0].store_id;

      const upd = await client.query(
        `UPDATE stock SET available = available - $2, reserved = reserved + $2
         WHERE item_id = $1 AND available >= $2`,
        [itemId, qty],
      );
      if (upd.rowCount === 0) throw new HttpError(409, { error: 'OUT_OF_STOCK', itemId, name: item.rows[0].name });
      lines.push({ itemId, qty, name: item.rows[0].name, price: item.rows[0].price });
    }

    const r = await client.query(
      `INSERT INTO reservations (order_id, status) VALUES ($1, 'RESERVED') RETURNING *`,
      [orderId],
    );
    for (const l of lines) {
      await client.query('INSERT INTO reservation_items (reservation_id, item_id, qty) VALUES ($1, $2, $3)', [r.rows[0].id, l.itemId, l.qty]);
    }
    await client.query('COMMIT');
    res.status(201).json({ orderId, storeId, status: 'RESERVED', items: lines });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof HttpError) return res.status(err.status).json(err.body);
    // 2 request cùng orderId chạy song song: request sau vấp UNIQUE(order_id)
    if (err.code === '23505') return res.status(409).json({ error: 'DUPLICATE_RESERVATION' });
    throw err;
  } finally {
    client.release();
  }
});

async function reservationDetail(r) {
  const { rows } = await pool.query(
    `SELECT ri.item_id, ri.qty, m.name, m.price, m.store_id
     FROM reservation_items ri JOIN menu_items m ON m.id = ri.item_id
     WHERE ri.reservation_id = $1 ORDER BY ri.item_id`,
    [r.id],
  );
  return {
    orderId: r.order_id,
    storeId: rows[0]?.store_id,
    status: r.status,
    items: rows.map((x) => ({ itemId: x.item_id, qty: x.qty, name: x.name, price: x.price })),
  };
}

// Chuyển reservation từ RESERVED sang trạng thái mới và cập nhật kho tương ứng.
// Gọi lại nhiều lần vẫn an toàn: đã ở trạng thái đích thì trả OK, không cộng/trừ lần 2.
async function finishReservation(req, res, target) {
  const orderId = Number(req.params.orderId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FOR UPDATE: release và confirm cho cùng 1 đơn không chạy chồng lên nhau
    const { rows } = await client.query('SELECT * FROM reservations WHERE order_id = $1 FOR UPDATE', [orderId]);
    const r = rows[0];
    if (!r) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
    }
    if (r.status === target) {
      await client.query('ROLLBACK');
      return res.json({ orderId, status: target });
    }
    if (r.status !== 'RESERVED') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'INVALID_STATE', status: r.status });
    }

    const stockSql = target === 'RELEASED'
      ? 'UPDATE stock SET available = available + $2, reserved = reserved - $2 WHERE item_id = $1'
      : 'UPDATE stock SET reserved = reserved - $2 WHERE item_id = $1';
    const items = await client.query('SELECT item_id, qty FROM reservation_items WHERE reservation_id = $1 ORDER BY item_id', [r.id]);
    for (const i of items.rows) await client.query(stockSql, [i.item_id, i.qty]);

    await client.query('UPDATE reservations SET status = $1, updated_at = now() WHERE id = $2', [target, r.id]);
    await client.query('COMMIT');
    res.json({ orderId, status: target });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

app.post('/reservations/:orderId/release', (req, res) => finishReservation(req, res, 'RELEASED'));
app.post('/reservations/:orderId/confirm', (req, res) => finishReservation(req, res, 'CONFIRMED'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

await migrate();
const { rows } = await pool.query('SELECT count(*)::int AS n FROM stores');
if (rows[0].n === 0) {
  await pool.query(fs.readFileSync(new URL('./db/seed.sql', import.meta.url), 'utf8'));
  console.log('Đã nạp dữ liệu mẫu');
}
app.listen(PORT, () => console.log(`${SERVICE} chạy ở cổng ${PORT}`));
