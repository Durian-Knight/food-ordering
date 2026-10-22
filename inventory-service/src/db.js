import fs from 'node:fs';
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Tạo bảng khi service khởi động (schema.sql viết dạng IF NOT EXISTS nên chạy lại không sao).
export async function migrate() {
  const sql = fs.readFileSync(new URL('./db/schema.sql', import.meta.url), 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(sql);
      return;
    } catch (err) {
      if (attempt >= 10) throw err;
      console.log(`DB chưa sẵn sàng (${err.message}), thử lại sau 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
