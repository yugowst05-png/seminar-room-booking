const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'bookings.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );
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
  );
`);

const seedRooms = ['セミナールーム'];
const insertRoom = db.prepare('INSERT OR IGNORE INTO rooms (name) VALUES (?)');
for (const name of seedRooms) insertRoom.run(name);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/rooms', (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY id').all();
  res.json(rooms);
});

app.get('/api/bookings', (req, res) => {
  const { date } = req.query;
  let rows;
  if (date) {
    rows = db.prepare(`
      SELECT b.*, r.name as room_name FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      WHERE b.date = ?
      ORDER BY r.id, b.start_time
    `).all(date);
  } else {
    rows = db.prepare(`
      SELECT b.*, r.name as room_name FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      ORDER BY b.date, r.id, b.start_time
    `).all();
  }
  res.json(rows);
});

function findConflicts(roomId, date, startTime, endTime, excludeId) {
  const rows = db.prepare(`
    SELECT * FROM bookings
    WHERE room_id = ? AND date = ?
      AND start_time < ? AND end_time > ?
      ${excludeId ? 'AND id != ?' : ''}
  `).all(...(excludeId
    ? [roomId, date, endTime, startTime, excludeId]
    : [roomId, date, endTime, startTime]));
  return rows;
}

app.post('/api/bookings', (req, res) => {
  const { room_id, date, start_time, end_time, title, booked_by } = req.body;

  if (!room_id || !date || !start_time || !end_time || !title || !booked_by) {
    return res.status(400).json({ error: '全ての項目を入力してください。' });
  }
  if (start_time >= end_time) {
    return res.status(400).json({ error: '終了時刻は開始時刻より後にしてください。' });
  }

  const conflicts = findConflicts(room_id, date, start_time, end_time);
  if (conflicts.length > 0) {
    return res.status(409).json({
      error: 'この時間帯は既に予約されています（ブッキング重複）。',
      conflicts,
    });
  }

  const info = db.prepare(`
    INSERT INTO bookings (room_id, date, start_time, end_time, title, booked_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(room_id, date, start_time, end_time, title, booked_by);

  const created = db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

app.delete('/api/bookings/:id', (req, res) => {
  const info = db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '予約が見つかりません。' });
  res.status(204).end();
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
