let me = null;

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { location.href = '/'; throw new Error('unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');
  return data;
}

function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('toast-err', isErr);
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 3000);
}

function fmtDuration(sec) {
  if (!sec) return '0 mnt';
  const m = Math.round(sec / 60);
  if (m < 60) return m + ' mnt';
  return Math.floor(m / 60) + ' jam ' + (m % 60) + ' mnt';
}

function statusBadge(p) {
  if (!p.updated_at) return '<span class="badge badge-none">Belum mulai</span>';
  if (p.percent >= 95) return '<span class="badge badge-done">Selesai</span>';
  return '<span class="badge badge-reading">Dibaca</span>';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Init ----------
(async function init() {
  try {
    me = await api('/api/me');
  } catch (e) { return; }
  document.getElementById('whoami').textContent = me.kind === 'dosen' ? 'Dosen' : me.nama;

  if (me.kind === 'dosen') {
    document.getElementById('dosenView').classList.remove('hidden');
    setupDosen();
    loadMonitor(); loadDocs(); loadStudents();
  } else {
    document.getElementById('mhsView').classList.remove('hidden');
    loadMhsDocs();
  }
  registerSW();
})();

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
});

function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ================= DOSEN =================
function setupDosen() {
  document.querySelectorAll('.tabs-nav .tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tabs-nav .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
      document.getElementById('page-' + t.dataset.page).classList.remove('hidden');
      if (t.dataset.page === 'monitor') loadMonitor();
      if (t.dataset.page === 'students') loadStudents();
      if (t.dataset.page === 'docs') loadDocs();
    });
  });

  // Dokumen teks
  document.getElementById('textDocForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judul: docJudul.value, konten: docIsi.value })
      });
      e.target.reset();
      toast('Dokumen teks tersimpan');
      loadDocs();
    } catch (err) { toast(err.message, true); }
  });

  // Upload PDF
  document.getElementById('pdfDocForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('judul', pdfJudul.value);
    fd.append('pdf', pdfFile.files[0]);
    try {
      await api('/api/documents/pdf', { method: 'POST', body: fd });
      e.target.reset();
      toast('PDF terunggah');
      loadDocs();
    } catch (err) { toast(err.message, true); }
  });

  // Tambah mahasiswa
  document.getElementById('studentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama: stNama.value, nim: stNim.value })
      });
      e.target.reset();
      toast('Mahasiswa ditambahkan');
      loadStudents();
    } catch (err) { toast(err.message, true); }
  });

  // Impor massal
  document.getElementById('importBtn').addEventListener('click', async () => {
    const lines = importArea.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return toast('Tidak ada data', true);
    try {
      const r = await api('/api/students/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines })
      });
      toast(`Tambah: ${r.added}, dilewati: ${r.skipped}`);
      importArea.value = '';
      loadStudents();
    } catch (err) { toast(err.message, true); }
  });

  // Modal edit
  document.getElementById('editCancel').addEventListener('click', () =>
    document.getElementById('editModal').classList.add('hidden'));
  document.getElementById('editSave').addEventListener('click', async () => {
    const id = document.getElementById('editModal').dataset.id;
    try {
      await api('/api/documents/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judul: editJudul.value, konten: editKonten.value })
      });
      document.getElementById('editModal').classList.add('hidden');
      toast('Dokumen diperbarui');
      loadDocs();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- Monitoring ----------
async function loadMonitor() {
  const data = await api('/api/monitor');
  const thead = document.querySelector('#monitorTable thead');
  const tbody = document.querySelector('#monitorTable tbody');
  const empty = document.getElementById('monitorEmpty');

  if (!data.documents.length && !data.students.length) {
    thead.innerHTML = ''; tbody.innerHTML = '';
    empty.textContent = 'Belum ada dokumen dan mahasiswa. Tambahkan di tab Dokumen dan Mahasiswa.';
    return;
  }
  empty.textContent = data.students.length ? '' : 'Belum ada mahasiswa. Tambahkan di tab Mahasiswa.';

  let h = '<tr><th>Nama</th><th>NIM</th>';
  for (const d of data.documents) h += `<th>${esc(d.judul)}<br><span class="th-sub">${d.tipe === 'pdf' ? 'PDF' : 'Teks'}</span></th>`;
  h += '</tr>';
  thead.innerHTML = h;

  tbody.innerHTML = data.students.map(row => {
    let c = `<td>${esc(row.student.nama)}</td><td>${esc(row.student.nim)}</td>`;
    for (const p of row.docs) {
      c += `<td>
        <div class="p-cell">
          <div class="p-bar"><div class="p-fill" style="width:${p.percent}%"></div></div>
          <span class="p-num">${p.percent.toFixed(0)}%</span> ${statusBadge(p)}
          <div class="p-meta">${p.updated_at ? `⏱ ${fmtDuration(p.seconds_read)} · ${p.updated_at}` : ''}</div>
        </div>
      </td>`;
    }
    return `<tr>${c}</tr>`;
  }).join('');
}


// ---------- Dokumen ----------
async function loadDocs() {
  const docs = await api('/api/documents');
  const el = document.getElementById('docList');
  if (!docs.length) { el.innerHTML = '<p class="muted">Belum ada dokumen.</p>'; return; }
  el.innerHTML = docs.map(d => `
    <div class="doc-item">
      <div class="doc-info">
        <strong>${esc(d.judul)}</strong>
        <span class="muted">${d.tipe === 'pdf' ? '📄 PDF — ' + esc(d.pdf_name || '') : '✍️ Teks'} · ${d.created_at}</span>
      </div>
      <div class="doc-actions">
        <a class="btn btn-ghost" href="/reader?id=${d.id}" target="_blank">Lihat</a>
        ${d.tipe === 'teks' ? `<button class="btn btn-ghost" onclick="editDoc(${d.id})">Edit</button>` : ''}
        <button class="btn btn-danger" onclick="deleteDoc(${d.id})">Hapus</button>
      </div>
    </div>`).join('');
}

async function editDoc(id) {
  const d = await api('/api/documents/' + id);
  const modal = document.getElementById('editModal');
  modal.dataset.id = id;
  editJudul.value = d.judul;
  editKonten.value = d.konten || '';
  modal.classList.remove('hidden');
}

async function deleteDoc(id) {
  if (!confirm('Hapus dokumen ini? Progres baca ikut terhapus.')) return;
  try {
    await api('/api/documents/' + id, { method: 'DELETE' });
    toast('Dokumen dihapus');
    loadDocs();
  } catch (err) { toast(err.message, true); }
}

// ---------- Mahasiswa ----------
async function loadStudents() {
  const list = await api('/api/students');
  const tbody = document.querySelector('#studentTable tbody');
  tbody.innerHTML = list.length ? list.map(s => `
    <tr>
      <td>${esc(s.nama)}</td><td>${esc(s.nim)}</td><td class="muted">${s.created_at}</td>
      <td><button class="btn btn-danger btn-sm" onclick="delStudent(${s.id})">Hapus</button></td>
    </tr>`).join('') : '<tr><td colspan="4" class="muted">Belum ada mahasiswa terdaftar.</td></tr>';
}

async function delStudent(id) {
  if (!confirm('Hapus mahasiswa ini?')) return;
  try {
    await api('/api/students/' + id, { method: 'DELETE' });
    toast('Mahasiswa dihapus');
    loadStudents();
  } catch (err) { toast(err.message, true); }
}

// ================= MAHASISWA =================
async function loadMhsDocs() {
  const docs = await api('/api/documents');
  const el = document.getElementById('mhsDocs');
  const empty = document.getElementById('mhsEmpty');
  if (!docs.length) { empty.textContent = 'Belum ada bacaan dari dosen.'; return; }
  el.innerHTML = docs.map(d => {
    const pct = Number(d.percent) || 0;
    const st = d.updated_at
      ? (pct >= 95 ? '<span class="badge badge-done">Selesai</span>' : '<span class="badge badge-reading">Dibaca</span>')
      : '<span class="badge badge-none">Belum mulai</span>';
    return `
    <a class="doc-card" href="/reader?id=${d.id}">
      <div class="doc-card-icon">${d.tipe === 'pdf' ? '📄' : '📖'}</div>
      <div class="doc-card-body">
        <strong>${esc(d.judul)}</strong>
        <span class="muted">${d.tipe === 'pdf' ? 'PDF' : 'Teks'}</span>
        <div class="p-bar"><div class="p-fill" style="width:${pct}%"></div></div>
        <span class="p-num">${pct.toFixed(0)}% ${st}</span>
      </div>
    </a>`;
  }).join('');
}
