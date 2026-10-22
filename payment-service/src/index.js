import express from 'express';
import { pool, migrate } from './db.js';

const SERVICE = 'payment-service';
const PORT = process.env.PORT || 3004;

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

const toPayment = (r) => ({
  id: r.id,
  orderId: r.order_id,
  amount: r.amount,
  status: r.status,
  failureReason: r.failure_reason,
  createdAt: r.created_at,
});

// API nội bộ, chỉ Order Service gọi trong Saga. Đây là thanh toán giả lập:
// simulateFail = true thì luôn thất bại để demo rollback.
app.post('/payments', async (req, res) => {
  const { orderId, userId, amount, simulateFail = false } = req.body || {};
  if (!Number.isInteger(orderId) || !Number.isInteger(userId) || !Number.isInteger(amount) || amount < 0) {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }

  const status = simulateFail ? 'FAILED' : 'SUCCESS';
  const reason = simulateFail ? 'CARD_DECLINED' : null;
  // ON CONFLICT DO NOTHING: đơn đã thanh toán rồi thì giữ nguyên kết quả cũ
  await pool.query(
    `INSERT INTO payments (order_id, user_id, amount, status, failure_reason)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (order_id) DO NOTHING`,
    [orderId, userId, amount, status, reason],
  );
  const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1', [orderId]);
  const payment = toPayment(rows[0]);
  if (payment.status === 'FAILED') return res.status(402).json({ error: 'PAYMENT_FAILED', payment });
  res.status(201).json(payment);
});

// Công khai qua Gateway: khách chỉ xem được thanh toán của đơn mình
app.get('/payments/:orderId', async (req, res) => {
  if (!/^\d+$/.test(req.params.orderId)) return res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });
  const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1', [req.params.orderId]);
  const p = rows[0];
  if (!p || (req.headers['x-user-role'] !== 'ADMIN' && p.user_id !== Number(req.headers['x-user-id']))) {
    return res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });
  }
  res.json(toPayment(p));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

await migrate();
app.listen(PORT, () => console.log(`${SERVICE} chạy ở cổng ${PORT}`));
