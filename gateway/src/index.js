import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware } from 'http-proxy-middleware';

const PORT = process.env.PORT || 8080;
const SERVICES = {
  auth: process.env.AUTH_URL || 'http://localhost:3001',
  inventory: process.env.INVENTORY_URL || 'http://localhost:3002',
  order: process.env.ORDER_URL || 'http://localhost:3003',
  payment: process.env.PAYMENT_URL || 'http://localhost:3004',
};

// Bảng định tuyến công khai. Đường dẫn không có ở đây (vd. /reservations, POST /payments)
// là API nội bộ giữa các service nên Gateway trả 404.
const ROUTES = [
  { prefix: '/api/auth/register', service: 'auth', methods: ['POST'], public: true },
  { prefix: '/api/auth/login', service: 'auth', methods: ['POST'], public: true },
  { prefix: '/api/auth/me', service: 'auth', methods: ['GET'] },
  { prefix: '/api/stores', service: 'inventory', methods: ['GET'], public: true },
  { prefix: '/api/stores', service: 'inventory', methods: ['POST', 'PUT'] },
  { prefix: '/api/items', service: 'inventory', methods: ['GET'], public: true },
  { prefix: '/api/items', service: 'inventory', methods: ['PUT'] },
  { prefix: '/api/orders', service: 'order', methods: ['GET', 'POST'] },
  { prefix: '/api/payments', service: 'payment', methods: ['GET'] },
];

function matchRoute(req) {
  return ROUTES.find(
    (r) => (req.path === r.prefix || req.path.startsWith(r.prefix + '/')) && r.methods.includes(req.method),
  );
}

const app = express();

app.use((req, res, next) => {
  req.headers['x-request-id'] ||= crypto.randomUUID();
  res.setHeader('X-Request-Id', req.headers['x-request-id']);
  // Không tin header danh tính do client tự gửi, Gateway sẽ tự gắn sau khi kiểm tra JWT
  delete req.headers['x-user-id'];
  delete req.headers['x-user-role'];
  next();
});

app.get('/health', async (req, res) => {
  const results = await Promise.all(
    Object.entries(SERVICES).map(async ([name, url]) => {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
        return [name, r.ok ? 'UP' : 'DOWN'];
      } catch {
        return [name, 'DOWN'];
      }
    }),
  );
  const services = Object.fromEntries(results);
  const allUp = Object.values(services).every((s) => s === 'UP');
  res.status(allUp ? 200 : 503).json({ gateway: 'UP', services });
});

app.use('/api', (req, res, next) => {
  const route = matchRoute({ path: req.originalUrl.split('?')[0], method: req.method });
  if (!route) return res.status(404).json({ error: 'NOT_FOUND' });
  req.route_ = route;
  if (route.public) return next();

  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.headers['x-user-id'] = String(payload.sub);
    req.headers['x-user-role'] = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'UNAUTHORIZED' });
  }
});

const proxy = createProxyMiddleware({
  router: (req) => SERVICES[req.route_.service],
  pathFilter: '/api',
  pathRewrite: { '^/api': '' },
  changeOrigin: true,
  on: {
    error: (err, req, res) => {
      res.writeHead?.(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'SERVICE_UNAVAILABLE', service: req.route_?.service }));
    },
  },
});
app.use(proxy);

app.listen(PORT, () => console.log(`gateway chạy ở cổng ${PORT}`));
