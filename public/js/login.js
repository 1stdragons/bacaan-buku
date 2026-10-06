let role = 'mahasiswa';

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    role = t.dataset.role;
    const dosen = role === 'dosen';
    document.getElementById('lblUser').textContent = dosen ? 'Email' : 'Nama';
    document.getElementById('lblPass').textContent = dosen ? 'Password' : 'NIM';
    document.getElementById('username').placeholder = dosen ? 'Email dosen' : 'Nama lengkap';
    document.getElementById('password').placeholder = dosen ? 'Password' : 'NIM';
    document.getElementById('errMsg').textContent = '';
  });
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('errMsg');
  err.textContent = '';
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role,
      username: document.getElementById('username').value,
      password: document.getElementById('password').value
    })
  });
  const data = await res.json();
  if (res.ok) {
    location.href = '/app';
  } else {
    err.textContent = data.error || 'Gagal login';
  }
});

// sudah login? langsung ke app
fetch('/api/me').then(r => { if (r.ok) location.href = '/app'; }).catch(() => {});
