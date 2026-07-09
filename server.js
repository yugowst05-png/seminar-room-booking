const express = require('express');
const { createClient } = require('@libsql/client');
const path = require('path');

const app = express();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'bookings.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      title TEXT NOT NULL,
      booked_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    )
  `);

  const seedRooms = ['セミナールーム'];
  for (const name of seedRooms) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO rooms (name) VALUES (?)', args: [name] });
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/rooms', async (req, res) => {
  const result = await db.execute('SELECT * FROM rooms ORDER BY id');
  res.json(result.rows);
});

app.get('/api/bookings', async (req, res) => {
  const { date } = req.query;
  let result;
  if (date) {
    result = await db.execute({
      sql: `
        SELECT b.*, r.name as room_name FROM bookings b
        JOIN rooms r ON r.id = b.room_id
        WHERE b.date = ?
        ORDER BY r.id, b.start_time
      `,
      args: [date],
    });
  } else {
    result = await db.execute(`
      SELECT b.*, r.name as room_name FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      ORDER BY b.date, r.id, b.start_time
    `);
  }
  res.json(result.rows);
});

async function findConflicts(roomId, date, startTime, endTime, excludeId) {
  const result = await db.execute({
    sql: `
      SELECT * FROM bookings
      WHERE room_id = ? AND date = ?
        AND start_time < ? AND end_time > ?
        ${excludeId ? 'AND id != ?' : ''}
    `,
    args: excludeId
      ? [roomId, date, endTime, startTime, excludeId]
      : [roomId, date, endTime, startTime],
  });
  return result.rows;
}

app.post('/api/bookings', async (req, res) => {
  const { room_id, date, start_time, end_time, title, booked_by } = req.body;

  if (!room_id || !date || !start_time || !end_time || !title || !booked_by) {
    return res.status(400).json({ error: '全ての項目を入力してください。' });
  }
  if (start_time >= end_time) {
    return res.status(400).json({ error: '終了時刻は開始時刻より後にしてください。' });
  }

  const conflicts = await findConflicts(room_id, date, start_time, end_time);
  if (conflicts.length > 0) {
    return res.status(409).json({
      error: 'この時間帯は既に予約されています（ブッキング重複）。',
      conflicts,
    });
  }

  const insertResult = await db.execute({
    sql: `
      INSERT INTO bookings (room_id, date, start_time, end_time, title, booked_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [room_id, date, start_time, end_time, title, booked_by],
  });

  const created = await db.execute({
    sql: 'SELECT * FROM bookings WHERE id = ?',
    args: [insertResult.lastInsertRowid],
  });
  res.status(201).json(created.rows[0]);
});

app.delete('/api/bookings/:id', async (req, res) => {
  const result = await db.execute({
    sql: 'DELETE FROM bookings WHERE id = ?',
    args: [req.params.id],
  });
  if (result.rowsAffected === 0) return res.status(404).json({ error: '予約が見つかりません。' });
  res.status(204).end();
});

const PORT = process.env.PORT || 3003;
initDb().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});
