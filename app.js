// ═══════════════════════════════════════════
//  Paraguay Live TV — app.js (MEJORADO)
// ═══════════════════════════════════════════

const CFG = {
  adminPass   : 'admin2024',        // ← cambiá esto
  jsonUrl     : 'channels.json',   // relativo al repo GitHub
  rewardSecs  : 30,                // duración countdown anuncio
  rewardMins  : 120,               // minutos que gana por anuncio (2h)
  maxCreditH  : 24,                // máximo crédito acumulable
  logoTaps    : 7,                 // taps para abrir admin
  syncInterval: 30000,             // ms entre sync con GitHub
  useCorsProxy: true,              // ← Activar proxy CORS para streams bloqueados
  corsProxyUrl: 'https://corsproxy.io/?', // Proxy CORS público
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  console.log('📺 Paraguay Live TV - Iniciado');
  console.log('💡 Tip: Usa debugStream("url") en consola para probar streams');
});

// ── HELPER PARA DEBUG ──────────────────────────
window.debugStream = function(url) {
  console.log('🔍 Probando stream:', url);
  fetch(url, { method: 'HEAD', mode: 'no-cors' })
    .then(r => console.log('✅ Stream accesible', r))
    .catch(e => console.error('❌ Stream no accesible:', e));
};

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
  if (d) { 
    try {
      channels = JSON.parse(d); 
      console.log('📦 Canales cargados del localStorage:', channels.length);
      renderAll(); 
    } catch(e) {
      console.error('Error al cargar canales locales:', e);
    }
  }
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
      console.log('🔄 Canales sincronizados desde GitHub:', channels.length);
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
      ? `<img src="${c.logo}" onerror="this.outerHTML='<span style=font-size:36px>${escHtml(c.logo||'📺')}</span>'" alt="${escHtml(c.name)}"/>`
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

// ── PLAYER (MEJORADO) ────────────────────────────────────
function play(id) {
  if (creditSec <= 0) { openReward(); return; }
  const ch = channels.find(c => c.id == id);
  if (!ch) {
    toast('⚠️ Canal no encontrado');
    return;
  }
  
  console.log('▶️ Reproduciendo:', ch.name);
  console.log('📡 URL original:', ch.url);
  
  document.getElementById('playerWrap').style.display = 'block';
  document.getElementById('nowPlaying').innerHTML = 
    '<span class="live-indicator"><span class="live-dot"></span>EN VIVO</span> ' + escHtml(ch.name);
  showCreditWarning(false);
  
  const vid = document.getElementById('vid');
  
  // Limpiar instancia anterior
  if (hls) { 
    hls.destroy(); 
    hls = null; 
  }
  
  // Detener y limpiar video
  vid.pause();
  vid.removeAttribute('src');
  vid.load();
  
  // Aplicar proxy CORS si está activado
  let playUrl = ch.url;
  if (CFG.useCorsProxy && (ch.url.includes('cloudfront.net') || ch.url.includes('akamai'))) {
    playUrl = CFG.corsProxyUrl + encodeURIComponent(ch.url);
    console.log('🔧 Usando proxy CORS:', playUrl);
  }
  
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    initializeHls(playUrl, vid, ch);
  } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
    // Para Safari/iOS
    console.log('📱 Usando reproductor nativo de Safari');
    vid.src = playUrl;
    vid.play().catch(() => {});
  } else {
    toast('⚠️ Tu navegador no soporta HLS');
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initializeHls(url, vid, channel) {
  hls = new Hls({
    enableWorker: true,
    debug: false, // Cambiar a true para depuración detallada
    lowLatencyMode: false,
    backBufferLength: 90,
    maxBufferLength: 30,
    maxMaxBufferLength: 600,
    // Timeouts más largos para streams problemáticos
    manifestLoadingTimeOut: 20000,
    manifestLoadingMaxRetry: 3,
    levelLoadingTimeOut: 20000,
    levelLoadingMaxRetry: 4,
    fragLoadingTimeOut: 20000,
    fragLoadingMaxRetry: 6,
    // Configuración CORS
    xhrSetup: function(xhr, url) {
      xhr.withCredentials = false;
    }
  });
  
  // Manejo detallado de errores
  hls.on(Hls.Events.ERROR, function (event, data) {
    console.error('❌ Error HLS:', data.type, data.details, data.fatal);
    
    if (data.fatal) {
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          console.error('🔴 Error de red fatal');
          if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
            toast('⚠️ No se puede acceder al stream. Probando método alternativo...');
            tryAlternativePlayback(channel, vid);
          } else {
            hls.recoverMediaError();
          }
          break;
          
        case Hls.ErrorTypes.MEDIA_ERROR:
          console.error('🔴 Error de medio fatal');
          if (data.details === Hls.ErrorDetails.BUFFER_APPENDING_ERROR ||
              data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            toast('⚠️ Problema de buffer. Reintentando...');
          }
          hls.recoverMediaError();
          break;
          
        default:
          console.error('🔴 Error fatal desconocido');
          hls.destroy();
          hls = null;
          tryAlternativePlayback(channel, vid);
          break;
      }
    }
  });
  
  // Evento cuando el manifiesto se carga correctamente
  hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
    console.log('✅ Stream cargado:', data.levels.length, 'calidades disponibles');
    vid.play().catch(e => {
      console.log('🔇 Autoplay bloqueado:', e);
      toast('▶️ Presiona play para iniciar');
    });
  });
  
  // Evento cuando comienza a reproducir fragmentos
  hls.on(Hls.Events.FRAG_BUFFERED, function () {
    console.log('📦 Fragmento cargado exitosamente');
  });
  
  // Evento cuando cambia de nivel de calidad
  hls.on(Hls.Events.LEVEL_SWITCHED, function (event, data) {
    console.log('📊 Cambio de calidad al nivel:', data.level);
  });
  
  console.log('🔄 Cargando stream...');
  hls.loadSource(url);
  hls.attachMedia(vid);
}

// Función alternativa para streams con problemas
function tryAlternativePlayback(channel, vid) {
  console.log('🔧 Intentando método alternativo para:', channel.name);
  
  // Primero verificar si el stream es accesible
  fetch(channel.url, { 
    method: 'HEAD',
    mode: 'no-cors',
    cache: 'no-cache'
  })
  .then(response => {
    console.log('✅ Stream accesible, reintentando con nueva configuración...');
    
    // Limpiar instancia anterior
    if (hls) { hls.destroy(); hls = null; }
    
    // Crear nueva instancia con configuración más permisiva
    hls = new Hls({
      enableWorker: true,
      debug: true, // Activar debug para ver qué falla
      lowLatencyMode: false,
      // Configuración CORS más agresiva
      xhrSetup: function(xhr, url) {
        xhr.withCredentials = false;
        xhr.setRequestHeader('Access-Control-Request-Headers', '*');
        xhr.setRequestHeader('Origin', window.location.origin);
      },
      // Reintentos más agresivos
      manifestLoadingMaxRetry: 5,
      levelLoadingMaxRetry: 5,
      fragLoadingMaxRetry: 5
    });
    
    hls.loadSource(channel.url);
    hls.attachMedia(vid);
    
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('✅ Stream alternativo cargado exitosamente');
      vid.play().catch(() => {});
      toast('✅ Stream conectado exitosamente');
    });
    
    hls.on(Hls.Events.ERROR, (event, data) => {
      console.error('❌ Error en método alternativo:', data);
      if (data.fatal) {
        toast('❌ No se pudo reproducir el stream. Intenta más tarde.');
        closePlayer();
      }
    });
  })
  .catch(() => {
    console.error('❌ Stream completamente inaccesible');
    toast('❌ Stream no disponible. Verifica tu conexión o intenta más tarde.');
    closePlayer();
  });
}

function closePlayer() {
  console.log('🛑 Cerrando reproductor');
  if (hls) { 
    hls.destroy(); 
    hls = null; 
  }
  const vid = document.getElementById('vid');
  vid.pause();
  vid.removeAttribute('src');
  vid.load();
  document.getElementById('playerWrap').style.display = 'none';
  document.getElementById('nowPlaying').textContent = 'CANAL';
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
  if (!channels.length) { 
    el.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">Sin canales aún.</p>'; 
    return; 
  }
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

// ── CONSOLA DE BIENVENIDA ──────────────────────
console.log('🎬 Paraguay Live TV - Sistema de TV en Vivo');
console.log('📋 Comandos disponibles:');
console.log('  debugStream("url") - Probar si un stream es accesible');
console.log('  channels - Ver lista de canales cargados');
console.log('  creditSec - Ver crédito actual en segundos');
