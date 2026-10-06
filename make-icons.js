// Membuat ikon PNG sederhana (bentuk buku sederhana di latar biru) tanpa dependensi.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

function makeIcon(size, file) {
  const bg = [26, 95, 180];      // --primary
  const white = [255, 255, 255];
  const dark = [20, 71, 140];

  // gambar: latar + bentuk buku (persegi putih dengan garis punggung)
  const px = Buffer.alloc(size * size * 3);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 3;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) set(x, y, bg);

  const m = Math.round(size * 0.22);          // margin
  const w = size - 2 * m, h = size - 2 * m;
  // badan buku putih
  for (let y = m; y < m + h; y++)
    for (let x = m; x < m + w; x++) set(x, y, white);
  // punggung buku
  const spine = Math.round(size * 0.06);
  for (let y = m; y < m + h; y++)
    for (let x = m; x < m + spine; x++) set(x, y, dark);
  // garis teks
  const lineH = Math.max(2, Math.round(size * 0.03));
  const gap = Math.round(size * 0.09);
  for (let g = 0; g < 4; g++) {
    const y0 = m + Math.round(h * 0.2) + g * gap;
    for (let y = y0; y < y0 + lineH; y++)
      for (let x = m + spine + Math.round(size * 0.06); x < m + w - Math.round(size * 0.08); x++)
        set(x, y, [180, 195, 215]);
  }

  // PNG encode
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter none
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  console.log('created', file);
}

const dir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
makeIcon(192, path.join(dir, 'icon-192.png'));
makeIcon(512, path.join(dir, 'icon-512.png'));
