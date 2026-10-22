import { pool } from './db.js';

const INVENTORY_URL = process.env.INVENTORY_URL || 'http://localhost:3002';
const PAYMENT_URL = process.env.PAYMENT_URL || 'http://localhost:3004';
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS || 5000);

// Gọi service khác. Lỗi mạng / timeout trả status 0 để Saga xử lý như một lần thất bại.
async function call(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    return { status: res.status, ok: res.ok, body: await res.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, ok: false, body: { error: err.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE' } };
  }
}

async function log(orderId, step, action, result, error = null) {
  await pool.query(
    'INSERT INTO saga_log (order_id, step, action, result, error) VALUES ($1, $2, $3, $4, $5)',
    [orderId, step, action, result, error],
  );
}

async function setStatus(orderId, status, cancelReason = null) {
  await pool.query(
    'UPDATE orders SET status = $2, cancel_reason = COALESCE($3, cancel_reason), updated_at = now() WHERE id = $1',
    [orderId, status, cancelReason],
  );
}

// Bù trừ bước 1: hủy đơn
async function cancelOrder(orderId, reason) {
  await setStatus(orderId, 'CANCELLED', reason);
  await log(orderId, 'CREATE_ORDER', 'COMPENSATE', 'OK', reason);
}

/**
 * Saga đặt món (Orchestration). Các bước:
 *   1. CREATE_ORDER   tạo đơn PENDING             bù trừ: đơn → CANCELLED
 *   2. RESERVE_STOCK  Inventory giữ chỗ (trừ kho)  bù trừ: Inventory release (hoàn kho)
 *   3. PAYMENT        Payment thu tiền             bước quyết định, không cần bù trừ
 *   4. CONFIRM_STOCK  Inventory chốt reservation   không có
 * Trả về { orderId, status, reason }.
 */
export async function placeOrder({ userId, items, simulatePaymentFail }) {
  // Bước 1
  const { rows } = await pool.query(`INSERT INTO orders (user_id, status) VALUES ($1, 'PENDING') RETURNING id`, [userId]);
  const orderId = rows[0].id;
  await log(orderId, 'CREATE_ORDER', 'EXECUTE', 'OK');

  // Bước 2
  const reserve = await call(`${INVENTORY_URL}/reservations`, { orderId, items });
  if (!reserve.ok) {
    await log(orderId, 'RESERVE_STOCK', 'EXECUTE', 'FAIL', reserve.body.error);
    if (reserve.status === 0) {
      // Không biết Inventory đã kịp trừ kho chưa → gọi hoàn kho cho chắc (404 = chưa giữ gì)
      const rel = await call(`${INVENTORY_URL}/reservations/${orderId}/release`);
      await log(orderId, 'RESERVE_STOCK', 'COMPENSATE', rel.ok || rel.status === 404 ? 'OK' : 'FAIL', rel.body.error);
    }
    await cancelOrder(orderId, reserve.body.error || 'RESERVE_FAILED');
    return { orderId, status: 'CANCELLED', reason: reserve.body.error, detail: reserve.body };
  }

  const reserved = reserve.body;
  const total = reserved.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  for (const i of reserved.items) {
    await pool.query(
      'INSERT INTO order_items (order_id, item_id, name_snapshot, price_snapshot, qty) VALUES ($1, $2, $3, $4, $5)',
      [orderId, i.itemId, i.name, i.price, i.qty],
    );
  }
  await pool.query('UPDATE orders SET store_id = $2, total_amount = $3 WHERE id = $1', [orderId, reserved.storeId, total]);
  await setStatus(orderId, 'STOCK_RESERVED');
  await log(orderId, 'RESERVE_STOCK', 'EXECUTE', 'OK');

  // Bước 3
  const pay = await call(`${PAYMENT_URL}/payments`, {
    orderId,
    userId,
    amount: total,
    simulateFail: Boolean(simulatePaymentFail),
  });
  if (!pay.ok) {
    // Payment lỗi sau khi kho đã bị trừ → bù trừ ngược lại từng bước đã làm
    await log(orderId, 'PAYMENT', 'EXECUTE', 'FAIL', pay.body.error);
    await setStatus(orderId, 'COMPENSATING');

    const rel = await call(`${INVENTORY_URL}/reservations/${orderId}/release`);
    if (!rel.ok) {
      // Bản đơn giản không có job tự phục hồi: đơn dừng ở COMPENSATING để người vận hành xử lý
      await log(orderId, 'RESERVE_STOCK', 'COMPENSATE', 'FAIL', rel.body.error);
      return { orderId, status: 'COMPENSATING', reason: 'RELEASE_FAILED' };
    }
    await log(orderId, 'RESERVE_STOCK', 'COMPENSATE', 'OK');
    await cancelOrder(orderId, 'PAYMENT_FAILED');
    return { orderId, status: 'CANCELLED', reason: 'PAYMENT_FAILED' };
  }
  await log(orderId, 'PAYMENT', 'EXECUTE', 'OK');

  // Bước 4: tiền đã thu nên đơn coi như thành công; confirm lỗi chỉ ghi log để xử lý tay
  const confirm = await call(`${INVENTORY_URL}/reservations/${orderId}/confirm`);
  await log(orderId, 'CONFIRM_STOCK', 'EXECUTE', confirm.ok ? 'OK' : 'FAIL', confirm.body.error);
  await setStatus(orderId, 'CONFIRMED');
  return { orderId, status: 'CONFIRMED' };
}
