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

// TODO: API của Inventory/Catalog Service (giai đoạn sau)

await migrate();
app.listen(PORT, () => console.log(`${SERVICE} chạy ở cổng ${PORT}`));
