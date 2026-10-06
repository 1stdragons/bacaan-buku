/**
 * Reader - membaca teks/PDF dengan pelacakan progres ke server.
 * Progres teks = scroll maksimum yang dicapai; PDF = halaman terakhir.
 * Heartbeat tiap 5 detik mengirim persentase + delta waktu baca.
 */
const params = new URLSearchParams(location.search);
const docId = Number(params.get('id'));

let doc = null;
let me = null;
let lastPercent = 0;
let lastTick = Date.now();
let dirty = false;

function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('toast-err', isErr);
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 3000);
}

function setProgressLabel(pct) {
  document.getElementById('progressLabel').textContent = Math.round(pct) + '%';
  document.getElementById('stripFill').style.width = pct + '%';
}

async function sendProgress(force = false) {
  if (!me || me.kind !== 'mahasiswa') return;
  const now = Date.now();
  const delta = Math.round((now - lastTick) / 1000);
  lastTick = now;
  if (!dirty && !force) return;
  dirty = false;
  try {
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_id: docId,
        percent: lastPercent,
        last_position: window._lastPos || '',
        delta_seconds: delta
      })
    });
    const s = document.getElementById('saveState');
    s.textContent = 'tersimpan ✓';
    setTimeout(() => { s.textContent = ''; }, 2000);
  } catch (e) { dirty = true; } // offline: coba lagi tick berikutnya
}

async function init() {
  if (!docId) { location.href = '/app'; return; }
  try {
    me = await (await fetch('/api/me')).json();
  } catch (e) { location.href = '/'; return; }

  doc = await (await fetch('/api/documents/' + docId)).json();
  if (doc.error) { location.href = '/app'; return; }
  document.title = doc.judul + ' — Bacaan Buku';
  document.getElementById('docTitle').textContent = doc.judul;

  if (doc.tipe === 'teks') setupTextReader();
  else setupPdfReader();

  // heartbeat: kirim progres tiap 5 detik saat tab aktif
  setInterval(() => { if (!document.hidden) sendProgress(); }, 5000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sendProgress(true);
    else lastTick = Date.now();
  });

// ============== MODE TEKS ==============
function setupTextReader() {
  document.getElementById('textReader').classList.remove('hidden');
  const article = document.getElementById('articleBody');

  const paras = (doc.konten || '').split(/\r?\n/).filter(l => l.trim());
  article.innerHTML = paras.map(p => `<p>${escapeHtml(p)}</p>`).join('');

  const compute = () => {
    const scrollTop = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max <= 0 ? 100 : Math.min(100, (scrollTop / max) * 100);
    if (pct > lastPercent + 0.5 || pct >= 99.5) {
      lastPercent = pct >= 99.5 ? 100 : pct;
      dirty = true;
    }
    window._lastPos = 'scroll:' + Math.round(scrollTop);
    setProgressLabel(lastPercent);
  };

  window.addEventListener('scroll', compute, { passive: true });

  // restore posisi baca terakhir
  if (doc.last_position && me.kind === 'mahasiswa') {
    const m = /^scroll:(\d+)$/.exec(doc.last_position);
    if (m) {
      window.scrollTo(0, Number(m[1]));
      compute();
    }
  }
}

// ============== MODE PDF ==============
async function setupPdfReader() {
  document.getElementById('pdfReader').classList.remove('hidden');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const pdf = await pdfjsLib.getDocument('/api/documents/' + docId + '/pdf').promise;
  const total = pdf.numPages;
  let current = 1;

  // posisi awal dari progres tersimpan
  const m = /^page:(\d+)$/.exec(doc.last_position || '');
  if (m && me.kind === 'mahasiswa') current = Math.min(total, Math.max(1, Number(m[1])));

  const canvas = document.getElementById('pdfCanvas');
  const ctx = canvas.getContext('2d');

  function updateLabels() {
    const info = `Halaman ${current} / ${total}`;
    document.getElementById('pageInfo').textContent = info;
    document.getElementById('pageInfo2').textContent = info;
  }

  async function render() {
    const page = await pdf.getPage(current);
    const scale = Math.min(2, (window.innerWidth - 32) / page.getViewport({ scale: 1 }).width);
    const vp = page.getViewport({ scale });
    canvas.width = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    updateLabels();

    // progres = halaman terakhir yang dilihat
    const pct = (current / total) * 100;
    if (pct > lastPercent) lastPercent = pct;
    if (current === total) lastPercent = 100;
    window._lastPos = 'page:' + current;
    setProgressLabel(lastPercent);
    dirty = true;
    window.scrollTo(0, 0);
  }

  async function go(delta) {
    const next = current + delta;
    if (next < 1 || next > total) return;
    current = next;
    await render();
    sendProgress(true);
  }

  for (const [btnId, d] of [['prevPage', -1], ['prevPage2', -1], ['nextPage', 1], ['nextPage2', 1]]) {
    document.getElementById(btnId).addEventListener('click', () => go(d));
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
  });

  await render();
  sendProgress(true);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init();

}
