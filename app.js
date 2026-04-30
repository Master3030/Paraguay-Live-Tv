// ═══════════════════════════════════════════
//  Paraguay Live TV — app.js (Versión Final)
// ═══════════════════════════════════════════

const CFG = {
  adminPass   : 'admin2024',        // Cambia esta contraseña para tu panel
  jsonUrl     : 'channels.json',    // Nombre del archivo en tu GitHub
  rewardSecs  : 30,                 // Segundos que dura el anuncio
  rewardMins  : 120,                // Minutos de premio (2 horas)
  maxCreditH  : 24,                 // Máximo de crédito acumulable
  logoTaps    : 7,                  // Taps en el logo para abrir admin
  syncInterval: 30000,              // Sincronización cada 30 segundos
};

// ── ESTADO GLOBAL ────────────────────────────
let channels = [], filtered = [], activeCat = 'Todos', hls = null;
let creditSec = 0, timerInt = null, rwInt = null, rwSec = 0;
let logoTaps = 0, tapTimer = null;

// ── INICIO DE LA APP ─────────────────────────
window.addEventListener('load', () => {
  loadCredit();
  loadLocal();
  fetchRemote();
  startTimer();
  applyBanner();
  setupLogo();
  setInterval(fetchRemote, CFG.syncInterval);
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// ── ACCESO OCULTO AL PANEL (Taps en Logo) ────
function setupLogo() {
  const logo = document.getElementById('logoBtn');
  if(logo) {
    logo.addEventListener('click', () => {
      logoTaps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => logoTaps = 0, 2000);
      if (logoTaps >= CFG.logoTaps) { 
        logoTaps = 0; 
        openLogin(); 
      }
    });
  }
}

// ── SISTEMA DE CRÉDITOS Y TIEMPO ─────────────
function loadCredit() {
  const saved = localStorage.getItem('pltv_credit');
  const ts    = parseInt(localStorage.getItem('pltv_ts') || '0');
  if (saved !== null) {
    const elapsed = Math.floor((Date.now() - ts) / 1000);
    creditSec = Math.max(0, parseInt(saved) - elapsed);
  } else {
    creditSec = CFG.rewardMins * 60; 
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
  
  const display = document.getElementById('creditDisplay');
  const clock = document.getElementById('timerClock');
  const prog = document.getElementById('timerProg');
  
  if(display) display.textContent = fmt;
  if(clock) clock.textContent = fmt;
  if(prog) prog.style.width = (creditSec / max * 100) + '%';
}

function onCreditEmpty() {
  showCreditWarning(true);
  closePlayer();
}

function showCreditWarning(show) {
  const el = document.getElementById('noCredit');
  if(el) el.style.display = show ? 'block' : 'none';
}

function pad(n) { return String(n).padStart(2,'0'); }

// ── MANEJO DE CANALES (LOCAL Y REMOTO) ───────
function loadLocal() {
  const d = localStorage.getItem('pltv_channels');
  if (d) { channels = JSON.parse(d); renderAll(); }
}

function saveLocal() {
  localStorage.setItem('pltv_channels', JSON.stringify(channels));
}

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

// ── RENDERIZADO DE INTERFAZ ──────────────────
function renderAll() { 
  renderCats(); 
  doFilter(); 
}

function renderCats() {
  const cats = ['Todos', ...new Set(channels.map(c => c.category))];
  const bar = document.getElementById('catsBar');
  if(bar) {
    bar.innerHTML = cats.map(c =>
      `<div class="cat ${c === activeCat ? 'on' : ''}" onclick="selCat('${c}')">${c}</div>`
    ).join('');
  }
}

function selCat(c) { 
  activeCat = c; 
  renderAll(); 
}

function doFilter() {
  const input = document.getElementById('searchQ');
  const q = input ? input.value.toLowerCase() : "";
  filtered = channels.filter(c =>
    (activeCat === 'Todos' || c.category === activeCat) &&
    (!q || c.name.toLowerCase().includes(q))
  );
  renderGrid();
}

function renderGrid() {
  const g = document.getElementById('grid');
  if (!g) return;
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

// ── REPRODUCTOR HLS AVANZADO ─────────────────
function play(id) {
  if (creditSec <= 0) { openReward(); return; }
  
  const ch = channels.find(c => c.id == id);
  if (!ch) return;

  const vid = document.getElementById('vid');
  const wrap = document.getElementById('playerWrap');
  const now = document.getElementById('nowPlaying');
  
  if(wrap) wrap.style.display = 'block';
  if(now) now.textContent = ch.name;
  showCreditWarning(false);

  if (hls) { hls.destroy(); hls = null; }

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    hls = new Hls({ 
        enableWorker: true,
        manifestLoadingTimeOut: 15000,
        levelLoadingTimeOut: 15000,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startLevel: -1
    });
    hls.loadSource(ch.url);
    hls.attachMedia(vid);
    hls.on(Hls.Events.MANIFEST_PARSED, () => vid.play().catch(() => {}));
    
    // Auto-recuperación para streams de SNT/Cloudfront
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
          case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
          default: hls.destroy(); toast('⚠️ Error en stream'); break;
        }
      }
    });
  } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
    vid.src = ch.url;
    vid.play().catch(() => {});
  } else {
    toast('⚠️ Formato no soportado');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closePlayer() {
  if (hls) { hls.destroy(); hls = null; }
  const vid = document.getElementById('vid');
  if(vid) { vid.pause(); vid.src = ''; }
  const wrap = document.getElementById('playerWrap');
  if(wrap) wrap.style.display = 'none';
}

// ── SISTEMA DE ANUNCIOS (REWARD) ─────────────
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
      document.getElementById('rwCount').textContent = '✓';
      document.getElementById('rwCountLabel').textContent = '¡Anuncio completado!';
      document.getElementById('claimBtn').style.display = 'inline-block';
      document.getElementById('rwSkip').style.display = 'none';
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
}

// Bridge para Android (Opcional)
window.onRewardGranted = function() { claimReward(); };

// ── GESTIÓN DE BANNERS ───────────────────────
function applyBanner() {
  const code = localStorage.getItem('pltv_banner');
  if (code) {
    const zone = document.getElementById('bannerAd');
    if(zone) zone.innerHTML = '<span class="ad-tag">Publicidad</span>' + code;
  }
}

function saveBanner() {
  const code = document.getElementById('fBanner').value.trim();
  localStorage.setItem('pltv_banner', code);
  applyBanner();
  toast('✅ Banner guardado');
}

// ── LOGIN Y PANEL ADMIN ──────────────────────
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

function openAdmin() {
  renderAdminList();
  document.getElementById('fBanner').value = localStorage.getItem('pltv_banner') || '';
  clearForm();
  document.getElementById('adminPanel').classList.add('show');
}
function closeAdmin() { document.getElementById('adminPanel').classList.remove('show'); }

function renderAdminList() {
  const el = document.getElementById('adminList');
  if (!channels.length) { el.innerHTML = '<p style="color:var(--text2);">Sin canales.</p>'; return; }
  el.innerHTML = channels.map(c => `
    <div class="ch-admin-item">
      <span class="ico">${(!c.logo || c.logo.startsWith('http')) ? '📺' : c.logo}</span>
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
  
  if (!name || !url) { toast('⚠️ Datos incompletos'); return; }
  
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
  toast('✅ Guardado correctamente');
}

function editChannel(id) {
  const c = channels.find(c => c.id == id);
  if (!c) return;
  document.getElementById('editId').value = c.id;
  document.getElementById('fName').value  = c.name;
  document.getElementById('fUrl').value   = c.url;
  document.getElementById('fCat').value   = c.category;
  document.getElementById('fLogo').value  = c.logo || '';
  toast('✏️ Editando: ' + c.name);
}

function delChannel(id) {
  if (!confirm('¿Eliminar canal?')) return;
  channels = channels.filter(c => c.id != id);
  saveLocal();
  renderAll();
  renderAdminList();
}

function exportJSON() {
  const json = JSON.stringify(channels, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'channels.json';
  a.click();
  toast('📤 Archivo descargado');
}

// ── TOAST NOTIFICACIÓN ───────────────────────
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
