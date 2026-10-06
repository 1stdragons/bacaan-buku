/**
 * Bacaan Buku - Aplikasi bacaan kelas dengan monitoring progres
 * Backend: Express + node:sqlite (bawaan Node 24)
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Kredensial dosen (hard-coded, plaintext sesuai permintaan) ----------
const DOSEN_USER = 'fardian.poltas@gmail.com';
const DOSEN_PASS = 'rahasia';

// ---------- Database ----------
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'bacaan.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    nim TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'mahasiswa',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    judul TEXT NOT NULL,
    tipe TEXT NOT NULL CHECK (tipe IN ('teks','pdf')),
    konten TEXT,
    pdf_path TEXT,
    pdf_name TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL,
    doc_id INTEGER NOT NULL,
    percent REAL NOT NULL DEFAULT 0,
    last_position TEXT NOT NULL DEFAULT '',
    seconds_read INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (user_id, doc_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
  );
`);

// ---------- Sesi (cookie token di memori) ----------
const sessions = new Map(); // token -> { kind: 'dosen'|'mahasiswa', id?, nama?, nim? }

// ---------- Middleware ----------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!m) return null;
  return sessions.get(decodeURIComponent(m[1])) || null;
}
function requireDosen(req, res, next) {
  const s = getSession(req);
  if (!s || s.kind !== 'dosen') return res.status(401).json({ error: 'Belum login sebagai dosen' });
  req.session = s; next();
}
function requireUser(req, res, next) {
  const s = getSession(req);
  if (!s || s.kind !== 'mahasiswa') return res.status(401).json({ error: 'Belum login' });
  req.session = s; next();
}

// ---------- Upload PDF ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-() ]+/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Hanya file PDF yang diizinkan'));
  }
});

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body || {};
  if (role === 'dosen') {
    if (username === DOSEN_USER && password === DOSEN_PASS) {
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { kind: 'dosen', nama: 'Dosen' });
      res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
      return res.json({ ok: true, kind: 'dosen' });
    }
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  // mahasiswa: nama + nim
  const row = db.prepare('SELECT * FROM users WHERE nim = ?').get(String(password || '').trim());
  if (row && row.nama.toLowerCase() === String(username || '').trim().toLowerCase()) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { kind: 'mahasiswa', id: row.id, nama: row.nama, nim: row.nim });
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
    return res.json({ ok: true, kind: 'mahasiswa', nama: row.nama });
  }
  return res.status(401).json({ error: 'Nama atau NIM salah' });
});

app.post('/api/logout', (req, res) => {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (m) sessions.delete(decodeURIComponent(m[1]));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Belum login' });
  res.json(s);
});

// ---------- Kelola mahasiswa (dosen) ----------
app.get('/api/students', requireDosen, (req, res) => {
  res.json(db.prepare('SELECT id, nama, nim, created_at FROM users ORDER BY nama').all());
});

app.post('/api/students', requireDosen, (req, res) => {
  const { nama, nim } = req.body || {};
  if (!nama || !nim) return res.status(400).json({ error: 'Nama dan NIM wajib diisi' });
  try {
    const info = db.prepare('INSERT INTO users (nama, nim) VALUES (?, ?)')
      .run(String(nama).trim(), String(nim).trim());
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    res.status(400).json({ error: 'NIM sudah terdaftar' });
  }
});

app.post('/api/students/import', requireDosen, (req, res) => {
  const { lines } = req.body || {}; // ["Nama, NIM", ...]
  if (!Array.isArray(lines)) return res.status(400).json({ error: 'Format tidak valid' });
  const ins = db.prepare('INSERT OR IGNORE INTO users (nama, nim) VALUES (?, ?)');
  let added = 0, skipped = 0;
  for (const line of lines) {
    const parts = String(line).split(/[,\t;]/).map(p => p.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) { skipped++; continue; }
    const r = ins.run(parts[0], parts[1]);
    if (r.changes) added++; else skipped++;
  }
  res.json({ ok: true, added, skipped });
});

app.delete('/api/students/:id', requireDosen, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});


// ---------- Dokumen ----------
app.get('/api/documents', (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Belum login' });
  if (s.kind === 'dosen') {
    return res.json(db.prepare('SELECT * FROM documents ORDER BY created_at DESC').all());
  }
  // mahasiswa + progresnya
  const rows = db.prepare(`
    SELECT d.id, d.judul, d.tipe, d.pdf_name, d.created_at,
           COALESCE(p.percent, 0) AS percent,
           p.last_position, p.seconds_read, p.updated_at
    FROM documents d
    LEFT JOIN progress p ON p.doc_id = d.id AND p.user_id = ?
    ORDER BY d.created_at DESC
  `).all(s.id);
  res.json(rows);
});

app.get('/api/documents/:id', (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Belum login' });
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
  res.json(doc);
});

app.post('/api/documents', requireDosen, (req, res) => {
  const { judul, konten } = req.body || {};
  if (!judul || !konten) return res.status(400).json({ error: 'Judul dan isi wajib diisi' });
  const info = db.prepare(`INSERT INTO documents (judul, tipe, konten, created_by) VALUES (?, 'teks', ?, ?)`)
    .run(String(judul).trim(), String(konten), DOSEN_USER);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.post('/api/documents/pdf', requireDosen, upload.single('pdf'), (req, res) => {
  const judul = (req.body.judul || '').trim();
  if (!req.file) return res.status(400).json({ error: 'File PDF wajib diunggah' });
  if (!judul) return res.status(400).json({ error: 'Judul wajib diisi' });
  const info = db.prepare(`INSERT INTO documents (judul, tipe, pdf_path, pdf_name, created_by) VALUES (?, 'pdf', ?, ?, ?)`)
    .run(judul, req.file.filename, req.file.originalname, DOSEN_USER);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.put('/api/documents/:id', requireDosen, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
  const { judul, konten } = req.body || {};
  if (doc.tipe === 'teks') {
    db.prepare('UPDATE documents SET judul = ?, konten = ? WHERE id = ?')
      .run(String(judul ?? doc.judul).trim(), String(konten ?? doc.konten), doc.id);
  } else if (judul) {
    db.prepare('UPDATE documents SET judul = ? WHERE id = ?').run(String(judul).trim(), doc.id);
  }
  res.json({ ok: true });
});

app.delete('/api/documents/:id', requireDosen, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (doc) {
    if (doc.pdf_path) {
      const f = path.join(UPLOAD_DIR, path.basename(doc.pdf_path));
      fs.rm(f, { force: true }, () => {});
    }
    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  }
  res.json({ ok: true });
});


// Stream PDF (login saja)
app.get('/api/documents/:id/pdf', (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Belum login' });
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc || !doc.pdf_path) return res.status(404).json({ error: 'PDF tidak ditemukan' });
  const file = path.join(UPLOAD_DIR, path.basename(doc.pdf_path));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File hilang di server' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.pdf_name || 'dokumen.pdf')}"`);
  fs.createReadStream(file).pipe(res);
});

// ---------- Progres baca ----------
app.post('/api/progress', requireUser, (req, res) => {
  const { doc_id, percent, last_position, delta_seconds } = req.body || {};
  const docId = Number(doc_id);
  if (!docId) return res.status(400).json({ error: 'doc_id wajib' });
  const doc = db.prepare('SELECT id FROM documents WHERE id = ?').get(docId);
  if (!doc) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });

  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const delta = Math.max(0, Math.min(120, Number(delta_seconds) || 0)); // batasi per ping
  const pos = String(last_position || '');

  db.prepare(`
    INSERT INTO progress (user_id, doc_id, percent, last_position, seconds_read, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(user_id, doc_id) DO UPDATE SET
      percent = MAX(percent, excluded.percent),
      last_position = CASE WHEN excluded.percent >= percent THEN excluded.last_position ELSE last_position END,
      seconds_read = seconds_read + excluded.seconds_read,
      updated_at = datetime('now','localtime')
  `).run(req.session.id, docId, pct, pos, delta);
  res.json({ ok: true });
});

// ---------- Monitoring (dosen) ----------
app.get('/api/monitor', requireDosen, (req, res) => {
  const docs = db.prepare('SELECT id, judul, tipe FROM documents ORDER BY created_at DESC').all();
  const students = db.prepare('SELECT id, nama, nim FROM users ORDER BY nama').all();
  const prog = db.prepare('SELECT * FROM progress').all();
  const map = {};
  for (const p of prog) map[p.user_id + '_' + p.doc_id] = p;
  const matrix = students.map(st => ({
    student: st,
    docs: docs.map(d => {
      const p = map[st.id + '_' + d.id];
      return p
        ? { doc_id: d.id, percent: p.percent, last_position: p.last_position,
            seconds_read: p.seconds_read, updated_at: p.updated_at }
        : { doc_id: d.id, percent: 0, last_position: '', seconds_read: 0, updated_at: null };
    })
  }));
  res.json({ documents: docs, students: matrix });
});


app.get('/api/monitor/export', requireDosen, (req, res) => {
  const docs = db.prepare('SELECT id, judul FROM documents ORDER BY created_at DESC').all();
  const students = db.prepare('SELECT id, nama, nim FROM users ORDER BY nama').all();
  const prog = db.prepare('SELECT * FROM progress').all();
  const map = {};
  for (const p of prog) map[p.user_id + '_' + p.doc_id] = p;
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  let csv = '\uFEFFNama;NIM';
  for (const d of docs) csv += `;${esc(d.judul + ' (%)')};${esc(d.judul + ' (menit)')};${esc(d.judul + ' (terakhir)')}`;
  csv += '\n';
  for (const st of students) {
    csv += `${esc(st.nama)};${esc(st.nim)}`;
    for (const d of docs) {
      const p = map[st.id + '_' + d.id];
      csv += `;${p ? p.percent.toFixed(1) : '0'};${p ? Math.round(p.seconds_read / 60) : '0'};${p ? esc(p.updated_at) : '-'}`;
    }
    csv += '\n';
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="monitoring-bacaan.csv"');
  res.send(csv);
});

// ---------- Static ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/reader', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reader.html')));

// Error handler (multer dll)
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(400).json({ error: err.message || 'Terjadi kesalahan' });
});

app.listen(PORT, () => {
  console.log(`Bacaan Buku berjalan di http://localhost:${PORT}`);
  console.log(`Login dosen: ${DOSEN_USER}`);
});
