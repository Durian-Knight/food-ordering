import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, migrate } from './db.js';

const SERVICE = 'auth-service';
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = process.env.TOKEN_TTL || '8h';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const toUser = (row) => ({ id: row.id, email: row.email, fullName: row.full_name, role: row.role });

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// Đăng ký luôn tạo tài khoản CUSTOMER; tài khoản STORE_OWNER/ADMIN lấy từ seed.
app.post('/auth/register', async (req, res) => {
  const { email, password, fullName } = req.body || {};
  if (!EMAIL_RE.test(email || '') || !password || password.length < 6 || !fullName) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Cần email hợp lệ, mật khẩu ≥ 6 ký tự và họ tên' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING *',
      [email.toLowerCase(), hash, fullName],
    );
    const user = toUser(rows[0]);
    res.status(201).json({ user, accessToken: issueToken(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'EMAIL_TAKEN' });
    throw err;
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [String(email || '').toLowerCase()]);
  if (!rows[0] || !(await bcrypt.compare(String(password || ''), rows[0].password_hash))) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }
  const user = toUser(rows[0]);
  res.json({ user, accessToken: issueToken(user) });
});

// Gateway đã kiểm tra JWT và gắn X-User-Id
app.get('/auth/me', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.headers['x-user-id']]);
  if (!rows[0]) return res.status(404).json({ error: 'USER_NOT_FOUND' });
  res.json(toUser(rows[0]));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

await migrate();
app.listen(PORT, () => console.log(`${SERVICE} chạy ở cổng ${PORT}`));
