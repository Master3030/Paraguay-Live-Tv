// ═══════════════════════════════════════════
//  Paraguay Live TV — app.js
// ═══════════════════════════════════════════

const CFG = {
  adminPass   : 'admin2024',        // ← cambiá esto
  jsonUrl     : 'channels.json',   // relativo al repo GitHub
  rewardSecs  : 30,                // duración countdown anuncio
  rewardMins  : 120,               // minutos que gana por anuncio (2h)
  maxCreditH  : 24,                // máximo crédito acumulable
  logoTaps    : 7,                 // taps para abrir admin
  syncInterval: 30000,             // ms entre sync con GitHub
};

// ── STATE ────────────────────────────────────
let channels = [], filtered = [], activeCat = 'Todos', hls = null;
let creditSec = 0, timerInt = null, rwInt = null, rwSec = 0;
let logoTaps = 0, tapTimer = null;

// ── BOOT ─────────────────────────────────────
window.addEventListener('load', () => {
  loadCredit();
  loadLocal();
  fetchRemote();
  startTimer();
  applyBanner();
  setupLogo();
  setInterval(fetchRemote, CFG.syncInterval);
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('sw.js').catch(() => {});
});

// ── LOGO TAPS (admin oculto) ──────────────────
function setupLogo() {
  document.getElementById('logoBtn').addEventListener('click', () => {
    logoTaps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => logoTaps = 0, 2000);
    if (logoTaps >= CFG.logoTaps) { logoTaps = 0; openLogin(); }
  });
}

// ── CREDIT / TIMER ────────────────────────────
function loadCredit() {
  const saved = localStorage.getItem('pltv_credit');
  const ts    = parseInt(localStorage.getItem('pltv_ts') || '0');
  if (saved !== null) {
    const elapsed = Math.floor((Date.now() - ts) / 1000);
    creditSec = Math.max(0, parseInt(saved) - elapsed);
  } else {
    creditSec = CFG.rewardMins * 60; // 2h por defecto
  }
  updateCreditUI();
}

function saveCredit() {
  localStorage.setItem('pltv_credit', String(creditSec));
  localStorage.setItem('pltv_ts', String(Date.now()));
}

function startTimer() {
  clearInterval(timerInt);
  timerInt = setInterval(() => {
    if (creditSec > 0) {
      creditSec--;
      saveCredit();
      updateCreditUI();
      if (creditSec === 0) onCreditEmpty();
    }
  }, 1000);
}

function updateCreditUI() {
  const max = CFG.maxCreditH * 3600;
  const h = Math.floor(creditSec / 3600);
  const m = Math.floor((creditSec % 3600) / 60);
  const s = creditSec % 60;
  const fmt = `${pad(h)}:${pad(m)}:${pad(s)}`;
  document.getElementById('creditDisplay').textContent = fmt;
  document.getElementById('timerClock').textContent    = fmt;
  document.getElementById('timerProg').style.width     = (creditSec / max * 100) + '%';
}

function onCreditEmpty() {
  showCreditWarning(true);
  closePlayer();
}

function showCreditWarning(show) {
  document.getElementById('noCredit').style.display = show ? 'block' : 'none';
}

function pad(n) { return String(n).padStart(2,'0'); }

// ── CHANNELS LOCAL ────────────────────────────
function loadLocal() {
  const d = localStorage.getItem('pltv_channels');
  if (d) { channels = JSON.parse(d); renderAll(); }
}

function saveLocal() {
  localStorage.setItem('pltv_channels', JSON.stringify(channels));
}

// ── CHANNELS REMOTE (GitHub JSON) ─────────────
async function fetchRemote() {
  try {
    const r = await fetch(CFG.jsonUrl + '?_=' + Date.now());
    if (!r.ok) return;
    const data = await r.json();
    if (Array.isArray(data) && data.length) {
      channels = data;
      saveLocal();
      renderAll();
    }
  } catch (_) {}
}

// ── RENDER ────────────────────────────────────
function renderAll() { renderCats(); doFilter(); }

function renderCats() {
  const cats = ['Todos', ...new Set(channels.map(c => c.category))];
  document.getElementById('catsBar').innerHTML = cats.map(c =>
    `<div class="cat ${c===activeCat?'on':''}" onclick="selCat('${c}')">${c}</div>`
  ).join('');
}

function selCat(c) { activeCat = c; renderAll(); }

function doFilter() {
  const q = document.getElementById('searchQ').value.toLowerCase();
  filtered = channels.filter(c =>
    (activeCat === 'Todos' || c.category === activeCat) &&
    (!q || c.name.toLowerCase().includes(q))
  );
  renderGrid();
}

function renderGrid() {
  const g = document.getElementById('grid');
  if (!filtered.length) {
    g.innerHTML = '<div class="empty-msg">📭 No hay canales disponibles</div>';
    return;
  }
  g.innerHTML = filtered.map(c => {
    const thumb = c.logo && c.logo.startsWith('http')
      ? `<img src="${c.logo}" onerror="this.outerHTML='<span style=font-size:36px>${escHtml(c.logo||'📺')}</span>'"/>`
      : `<span style="font-size:36px">${c.logo || '📺'}</span>`;
    return `
    <div class="ch-card" onclick="play('${c.id}')">
      <div class="ch-thumb">${thumb}<span class="live-badge">EN VIVO</span></div>
      <div class="ch-info">
        <div class="ch-name">${escHtml(c.name)}</div>
        <div class="ch-cat">${escHtml(c.category)}</div>
      </div>
    </div>`;
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── PLAYER ────────────────────────────────────
function play(id) {
  if (creditSec <= 0) { openReward(); return; }
  const ch = channels.find(c => c.id == id);
  if (!ch) return;
  document.getElementById('playerWrap').style.display = 'block';
  document.getElementById('nowPlaying').textContent   = ch.name;
  showCreditWarning(false);
  const vid = document.getElementById('vid');
  if (hls) { hls.destroy(); hls = null; }
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true });
    hls.loadSource(ch.url);
    hls.attachMedia(vid);
    hls.on(Hls.Events.MANIFEST_PARSED, () => vid.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) toast('⚠️ Error al cargar el canal'); });
  } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
    vid.src = ch.url;
    vid.play().catch(() => {});
  } else {
    toast('⚠️ Tu navegador no soporta HLS');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closePlayer() {
  if (hls) { hls.destroy(); hls = null; }
  const vid = document.getElementById('vid');
  vid.pause(); vid.src = '';
  document.getElementById('playerWrap').style.display = 'none';
}

// ── REWARD MODAL ──────────────────────────────
function openReward() {
  document.getElementById('rewardModal').classList.add('show');
  document.getElementById('claimBtn').style.display = 'none';
  document.getElementById('rwSkip').style.display   = 'inline-block';
  startRewardCountdown();
}

function closeReward() {
  document.getElementById('rewardModal').classList.remove('show');
  clearInterval(rwInt);
}

function startRewardCountdown() {
  rwSec = CFG.rewardSecs;
  document.getElementById('rwCount').textContent = rwSec;
  clearInterval(rwInt);
  rwInt = setInterval(() => {
    rwSec--;
    document.getElementById('rwCount').textContent = rwSec;
    if (rwSec <= 0) {
      clearInterval(rwInt);
      document.getElementById('rwCount').textContent      = '✓';
      document.getElementById('rwCountLabel').textContent = '¡Anuncio completado!';
      document.getElementById('claimBtn').style.display  = 'inline-block';
      document.getElementById('rwSkip').style.display    = 'none';
      // Aquí Android puede llamar a: window.AndroidBridge.onRewardEarned()
    }
  }, 1000);
}

function claimReward() {
  const maxSec = CFG.maxCreditH * 3600;
  creditSec = Math.min(maxSec, creditSec + CFG.rewardMins * 60);
  saveCredit();
  updateCreditUI();
  showCreditWarning(false);
  closeReward();
  toast(`🏆 +${CFG.rewardMins / 60}h de crédito ganadas`);
  // Si hay canal parado, intentar retomar
}

// Llamado desde Android WebView cuando el anuncio rewarded se completa
window.onRewardGranted = function() { claimReward(); };

// ── BANNER ────────────────────────────────────
function applyBanner() {
  const code = localStorage.getItem('pltv_banner');
  if (code) {
    const zone = document.getElementById('bannerAd');
    zone.innerHTML = '<span class="ad-tag">Publicidad</span>' + code;
  }
}

function saveBanner() {
  const code = document.getElementById('fBanner').value.trim();
  localStorage.setItem('pltv_banner', code);
  applyBanner();
  toast('✅ Banner guardado');
}

// ── ADMIN LOGIN ───────────────────────────────
function openLogin() {
  document.getElementById('passInput').value = '';
  document.getElementById('adminLogin').classList.add('show');
}
function closeLogin() { document.getElementById('adminLogin').classList.remove('show'); }
function checkPass() {
  if (document.getElementById('passInput').value === CFG.adminPass) {
    closeLogin();
    openAdmin();
  } else {
    toast('❌ Contraseña incorrecta');
  }
}

// ── ADMIN PANEL ───────────────────────────────
function openAdmin() {
  renderAdminList();
  document.getElementById('fBanner').value = localStorage.getItem('pltv_banner') || '';
  clearForm();
  document.getElementById('adminPanel').classList.add('show');
}
function closeAdmin() { document.getElementById('adminPanel').classList.remove('show'); }

function renderAdminList() {
  const el = document.getElementById('adminList');
  if (!channels.length) { el.innerHTML = '<p style="color:var(--text2);font-size:13px;">Sin canales aún.</p>'; return; }
  el.innerHTML = channels.map(c => `
    <div class="ch-admin-item">
      <span class="ico">${(!c.logo||c.logo.startsWith('http')) ? '📺' : c.logo}</span>
      <div class="inf">
        <div class="n">${escHtml(c.name)}</div>
        <div class="u">${escHtml(c.url)}</div>
      </div>
      <button class="btn-e" onclick="editChannel('${c.id}')">✏️</button>
      <button class="btn-d" onclick="delChannel('${c.id}')">🗑</button>
    </div>
  `).join('');
}

function clearForm() {
  document.getElementById('editId').value = '';
  document.getElementById('fName').value  = '';
  document.getElementById('fUrl').value   = '';
  document.getElementById('fLogo').value  = '';
  document.getElementById('fCat').value   = 'Noticias';
}

function saveChannel() {
  const id   = document.getElementById('editId').value;
  const name = document.getElementById('fName').value.trim();
  const url  = document.getElementById('fUrl').value.trim();
  const cat  = document.getElementById('fCat').value;
  const logo = document.getElementById('fLogo').value.trim();
  if (!name || !url) { toast('⚠️ Nombre y URL requeridos'); return; }
  if (id) {
    const i = channels.findIndex(c => c.id == id);
    if (i >= 0) channels[i] = { id, name, url, category: cat, logo };
  } else {
    channels.push({ id: Date.now().toString(), name, url, category: cat, logo });
  }
  saveLocal();
  renderAll();
  renderAdminList();
  clearForm();
  toast(id ? '✅ Canal actualizado' : '✅ Canal agregado');
}

function editChannel(id) {
  const c = channels.find(c => c.id == id);
  if (!c) return;
  document.getElementById('editId').value = c.id;
  document.getElementById('fName').value  = c.name;
  document.getElementById('fUrl').value   = c.url;
  document.getElementById('fCat').value   = c.category;
  document.getElementById('fLogo').value  = c.logo || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('✏️ Editando: ' + c.name);
}

function delChannel(id) {
  if (!confirm('¿Eliminar este canal?')) return;
  channels = channels.filter(c => c.id != id);
  saveLocal();
  renderAll();
  renderAdminList();
  toast('🗑 Canal eliminado');
}

function exportJSON() {
  const json = JSON.stringify(channels, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'channels.json';
  a.click();
  toast('📤 channels.json descargado — subilo a GitHub');
}

// ── TOAST ─────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
