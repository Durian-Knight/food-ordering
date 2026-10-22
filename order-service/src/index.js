import express from 'express';
import { pool, migrate } from './db.js';
import { placeOrder } from './saga.js';

const SERVICE = 'order-service';
const PORT = process.env.PORT || 3003;

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

const toOrder = (r) => ({
  id: r.id,
  userId: r.user_id,
  storeId: r.store_id,
  totalAmount: r.total_amount,
  status: r.status,
  cancelReason: r.cancel_reason,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function orderDetail(id) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const items = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY item_id', [id]);
  const saga = await pool.query('SELECT * FROM saga_log WHERE order_id = $1 ORDER BY id', [id]);
  return {
    ...toOrder(rows[0]),
    items: items.rows.map((i) => ({ itemId: i.item_id, name: i.name_snapshot, price: i.price_snapshot, qty: i.qty })),
    sagaLog: saga.rows.map((s) => ({ step: s.step, action: s.action, result: s.result, error: s.error, at: s.created_at })),
  };
}

const HTTP_STATUS = { CONFIRMED: 201, CANCELLED: 409, COMPENSATING: 502 };

app.post('/orders', async (req, res) => {
  const { items, simulatePaymentFail } = req.body || {};
  if (!Array.isArray(items) || items.length === 0 ||
      items.some((i) => !Number.isInteger(i?.itemId) || !Number.isInteger(i?.qty) || i.qty <= 0)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'items: [{ itemId, qty }]' });
  }
  const userId = Number(req.headers['x-user-id']);
  const result = await placeOrder({ userId, items, simulatePaymentFail });
  res.status(HTTP_STATUS[result.status]).json({ ...result, order: await orderDetail(result.orderId) });
});

app.get('/orders', async (req, res) => {
  const all = req.headers['x-user-role'] === 'ADMIN';
  const { rows } = all
    ? await pool.query('SELECT * FROM orders ORDER BY id DESC LIMIT 100')
    : await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC', [req.headers['x-user-id']]);
  res.json(rows.map(toOrder));
});

app.get('/orders/:id', async (req, res) => {
  const order = /^\d+$/.test(req.params.id) ? await orderDetail(req.params.id) : null;
  if (!order || (req.headers['x-user-role'] !== 'ADMIN' && order.userId !== Number(req.headers['x-user-id']))) {
    return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
  }
  res.json(order);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

await migrate();
app.listen(PORT, () => console.log(`${SERVICE} chạy ở cổng ${PORT}`));
