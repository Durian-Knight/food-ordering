// Giao diện web đơn giản: mọi lời gọi đều đi qua API Gateway (/api/...)
const $ = (sel) => document.querySelector(sel);
const money = (n) => n.toLocaleString('vi-VN') + ' đ';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS_TEXT = {
  PENDING: 'Đang xử lý', STOCK_RESERVED: 'Đã giữ hàng', COMPENSATING: 'Đang hoàn tác',
  CONFIRMED: 'Thành công', CANCELLED: 'Đã hủy',
};
const REASON_TEXT = {
  PAYMENT_FAILED: 'Thanh toán thất bại, kho đã được hoàn lại',
  OUT_OF_STOCK: 'Món đã hết hàng',
  UNREACHABLE: 'Dịch vụ kho không phản hồi',
  TIMEOUT: 'Dịch vụ kho phản hồi quá lâu',
  RELEASE_FAILED: 'Hoàn kho thất bại, cần xử lý tay',
};

const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  stores: [],
  storeId: null,
  menu: [],
  cart: new Map(), // itemId -> qty
  authMode: 'login',
};

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(state.token && { authorization: 'Bearer ' + state.token }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) logout();
  return { status: res.status, ok: res.ok, data };
}

// ---------- Đăng nhập / đăng ký ----------

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  state.authMode = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('#nameRow').hidden = state.authMode !== 'register';
  $('#authSubmit').textContent = state.authMode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập';
  $('#authError').textContent = '';
}));

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const r = await api('POST', '/auth/' + state.authMode, f);
  if (!r.ok) {
    $('#authError').textContent = {
      INVALID_CREDENTIALS: 'Sai email hoặc mật khẩu',
      EMAIL_TAKEN: 'Email đã được dùng',
      INVALID_INPUT: r.data.message,
    }[r.data.error] || 'Có lỗi xảy ra';
    return;
  }
  state.token = r.data.accessToken;
  state.user = r.data.user;
  localStorage.setItem('token', state.token);
  localStorage.setItem('user', JSON.stringify(state.user));
  render();
});

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  render();
}

// ---------- Cửa hàng & menu ----------

const canManage = () => {
  const store = state.stores.find((s) => s.id === state.storeId);
  return state.user?.role === 'ADMIN' || (state.user?.role === 'STORE_OWNER' && store?.ownerId === state.user.id);
};

async function loadStores() {
  state.stores = (await api('GET', '/stores')).data;
  $('#stores').innerHTML = state.stores
    .map((s) => `<button data-id="${s.id}">${esc(s.name)}<br><small class="hint">${esc(s.address)}</small></button>`)
    .join('');
  $('#stores').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => selectStore(Number(b.dataset.id))));
  if (state.stores[0]) selectStore(state.storeId || state.stores[0].id);
}

function selectStore(id) {
  if (id !== state.storeId) state.cart.clear(); // 1 đơn = 1 cửa hàng
  state.storeId = id;
  $('#stores').querySelectorAll('button').forEach((b) => b.classList.toggle('active', Number(b.dataset.id) === id));
  $('#menuTitle').textContent = 'Menu: ' + (state.stores.find((s) => s.id === id)?.name || '');
  loadMenu();
  renderCart();
}

async function loadMenu() {
  state.menu = (await api('GET', `/stores/${state.storeId}/menu`)).data;
  const manage = canManage();
  $('#menu').innerHTML = state.menu.map((m) => `
    <tr>
      <td>${esc(m.name)}</td>
      <td class="num">${money(m.price)}</td>
      <td class="num ${m.available === 0 ? 'soldout' : ''}">${m.available === 0 ? 'Hết' : m.available}</td>
      <td class="num">${m.reserved}</td>
      <td>
        <button data-add="${m.id}" ${m.available === 0 ? 'disabled' : ''}>+ Thêm</button>
        ${manage ? `<button data-stock="${m.id}" title="Sửa tồn kho">✎</button>` : ''}
      </td>
    </tr>`).join('');
  $('#menu').querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.add);
    state.cart.set(id, (state.cart.get(id) || 0) + 1);
    renderCart();
  }));
  $('#menu').querySelectorAll('[data-stock]').forEach((b) => b.addEventListener('click', async () => {
    const item = state.menu.find((m) => m.id === Number(b.dataset.stock));
    const value = prompt(`Số lượng còn bán của "${item.name}":`, item.available);
    if (value === null) return;
    const r = await api('PUT', `/items/${item.id}/stock`, { available: Number(value) });
    if (!r.ok) alert('Không sửa được: ' + r.data.error);
    loadMenu();
  }));
}

// ---------- Giỏ hàng & đặt món ----------

function renderCart() {
  const lines = [...state.cart].map(([id, qty]) => ({ item: state.menu.find((m) => m.id === id), id, qty }));
  $('#cart').innerHTML = lines.length
    ? lines.map(({ item, id, qty }) => `
      <li>
        <span>${esc(item?.name || 'Món #' + id)}</span>
        <span class="qty">
          <button data-dec="${id}">−</button> ${qty} <button data-inc="${id}">+</button>
        </span>
      </li>`).join('')
    : '<li class="hint">Chưa có món nào</li>';
  const total = lines.reduce((s, l) => s + (l.item?.price || 0) * l.qty, 0);
  $('#cartTotal').textContent = money(total);
  $('#placeOrder').disabled = lines.length === 0;
  $('#cart').querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.inc);
    state.cart.set(id, state.cart.get(id) + 1);
    renderCart();
  }));
  $('#cart').querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.dec);
    const q = state.cart.get(id) - 1;
    q > 0 ? state.cart.set(id, q) : state.cart.delete(id);
    renderCart();
  }));
}

$('#placeOrder').addEventListener('click', async () => {
  $('#placeOrder').disabled = true;
  const simulatePaymentFail = document.querySelector('input[name=pay]:checked').value === 'fail';
  const items = [...state.cart].map(([itemId, qty]) => ({ itemId, qty }));
  const r = await api('POST', '/orders', { items, simulatePaymentFail });
  const ok = r.data.status === 'CONFIRMED';
  const msg = ok
    ? `Đặt món thành công! Đơn #${r.data.orderId}, tổng ${money(r.data.order.totalAmount)}`
    : `Đơn #${r.data.orderId ?? ''} ${STATUS_TEXT[r.data.status]?.toLowerCase() || 'lỗi'}: ${REASON_TEXT[r.data.reason] || r.data.reason || r.data.error}`;
  $('#orderResult').innerHTML = `<div class="result ${ok ? 'ok' : 'bad'}">${esc(msg)}
    ${r.data.orderId ? `<br><a href="#" data-order="${r.data.orderId}">Xem các bước Saga</a>` : ''}</div>`;
  $('#orderResult [data-order]')?.addEventListener('click', (e) => { e.preventDefault(); showOrder(r.data.orderId); });
  if (ok) state.cart.clear();
  renderCart();
  loadMenu();
  loadOrders();
});

// ---------- Đơn hàng ----------

async function loadOrders() {
  const orders = (await api('GET', '/orders')).data;
  $('#orders').innerHTML = orders.length
    ? orders.map((o) => `
      <li data-id="${o.id}">
        <span>#${o.id} · ${money(o.totalAmount)}<br><small class="hint">${new Date(o.createdAt).toLocaleString('vi-VN')}</small></span>
        <span class="badge ${o.status}">${STATUS_TEXT[o.status]}</span>
      </li>`).join('')
    : '<li class="hint">Chưa có đơn nào</li>';
  $('#orders').querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => showOrder(Number(li.dataset.id))));
}

async function showOrder(id) {
  const [o, p] = await Promise.all([api('GET', `/orders/${id}`), api('GET', `/payments/${id}`)]);
  const order = o.data;
  $('#orderDetail').innerHTML = `
    <h2>Đơn #${order.id} <span class="badge ${order.status}">${STATUS_TEXT[order.status]}</span></h2>
    ${order.cancelReason ? `<p class="error">${esc(REASON_TEXT[order.cancelReason] || order.cancelReason)}</p>` : ''}
    <ul>${order.items.map((i) => `<li>${esc(i.name)} × ${i.qty} = ${money(i.price * i.qty)}</li>`).join('') || '<li class="hint">Không giữ được món nào</li>'}</ul>
    <p>Tổng: <b>${money(order.totalAmount)}</b> · Thanh toán: <b>${p.ok ? esc(p.data.status) : 'chưa có'}</b></p>
    <h3>Nhật ký Saga</h3>
    <table class="saga">
      <tr><th>#</th><th>Bước</th><th>Hành động</th><th>Kết quả</th><th>Lỗi</th></tr>
      ${order.sagaLog.map((s, i) => `
        <tr><td>${i + 1}</td><td>${s.step}</td><td class="${s.action}">${s.action}</td>
        <td class="${s.result}">${s.result}</td><td>${esc(s.error || '')}</td></tr>`).join('')}
    </table>`;
  $('#orderDialog').showModal();
}

// ---------- Khởi động ----------

function render() {
  const loggedIn = Boolean(state.token);
  $('#authView').hidden = loggedIn;
  $('#appView').hidden = !loggedIn;
  $('#userBox').innerHTML = loggedIn
    ? `${esc(state.user.fullName)} <small class="hint">(${state.user.role})</small> <button id="logout" class="ghost">Đăng xuất</button>`
    : '';
  if (loggedIn) {
    $('#logout').addEventListener('click', logout);
    loadStores();
    loadOrders();
  }
}

$('#refreshMenu').addEventListener('click', loadMenu);
$('#refreshOrders').addEventListener('click', loadOrders);
render();
