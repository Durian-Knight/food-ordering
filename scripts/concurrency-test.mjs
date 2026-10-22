// Kịch bản 3: nhiều người đặt cùng lúc món cuối cùng.
// Chạy: node scripts/concurrency-test.mjs   (cần Node 18+, hệ thống đang chạy bằng docker compose)
// Đặt kho món "Phở bò tái" = 10, bắn 50 đơn đồng thời qua Gateway, mỗi đơn 1 phần.
// Kết quả đúng: 10 đơn CONFIRMED, 40 đơn CANCELLED (OUT_OF_STOCK), kho cuối = 0, không âm.

const GW = process.env.GATEWAY_URL || 'http://localhost:8080';
const ITEM_ID = 1;
const STOCK = 10;
const REQUESTS = 50;

async function api(method, path, body, token) {
  const res = await fetch(GW + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const login = async (email) => (await api('POST', '/api/auth/login', { email, password: '123456' })).body.accessToken;
const owner = await login('chuquan@food.vn');
const customer = await login('khach@food.vn');

await api('PUT', `/api/items/${ITEM_ID}/stock`, { available: STOCK }, owner);
const before = (await api('GET', `/api/items/${ITEM_ID}`)).body;
console.log(`Trước: "${before.name}" còn ${before.available}, đang giữ ${before.reserved}`);

console.time(`${REQUESTS} đơn đồng thời`);
const results = await Promise.all(
  Array.from({ length: REQUESTS }, () => api('POST', '/api/orders', { items: [{ itemId: ITEM_ID, qty: 1 }] }, customer)),
);
console.timeEnd(`${REQUESTS} đơn đồng thời`);

const tally = {};
for (const r of results) {
  const key = `${r.body.status} ${r.body.reason || ''}`.trim();
  tally[key] = (tally[key] || 0) + 1;
}
console.table(tally);

const after = (await api('GET', `/api/items/${ITEM_ID}`)).body;
console.log(`Sau: còn ${after.available}, đang giữ ${after.reserved}`);

const confirmed = tally.CONFIRMED || 0;
const pass = confirmed === STOCK && after.available === 0 && after.reserved === 0;
console.log(pass ? 'ĐẠT: không bán vượt' : 'KHÔNG ĐẠT');
process.exit(pass ? 0 : 1);
