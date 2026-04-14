
window.__catalogCacheVersion = null;
window.__catalogLastUpdatedAt = null;

function cacheBustValue() {
  return window.__catalogCacheVersion || Date.now();
}
function withCacheBust(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(cacheBustValue())}`;
}
async function fetchJsonNoCache(url, options = {}) {
  const response = await fetch(withCacheBust(url), {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.headers || {}),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}
async function refreshCatalogVersion() {
  try {
    const data = await fetchJsonNoCache('/api/admin/cache-info');
    window.__catalogCacheVersion = data.cacheVersion || Date.now();
    window.__catalogLastUpdatedAt = data.lastUpdatedAt || null;
    const infoEl = document.getElementById('cache-info-inline');
    if (infoEl) {
      infoEl.textContent = `Versión catálogo: ${window.__catalogCacheVersion} · Última actualización: ${window.__catalogLastUpdatedAt ? new Date(window.__catalogLastUpdatedAt).toLocaleString() : '-'}`;
    }
    return data;
  } catch (e) {
    const infoEl = document.getElementById('cache-info-inline');
    if (infoEl) infoEl.textContent = 'No se pudo leer la versión de caché.';
    return null;
  }
}
async function forceRefreshCatalog() {
  const btn = document.getElementById('btn-force-refresh');
  const old = btn ? btn.textContent : '';
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Actualizando...'; }
    const response = await fetch('/api/admin/refresh-cache', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    window.__catalogCacheVersion = data.cacheVersion || Date.now();
    window.__catalogLastUpdatedAt = data.lastUpdatedAt || new Date().toISOString();
    await refreshCatalogVersion();
    if (typeof loadAll === 'function') await loadAll(true);
    alert('Catálogo actualizado. Cierra y abre Stremio si seguía mostrando datos antiguos.');
  } catch (e) {
    alert(`No se pudo forzar la actualización: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old || 'Actualizar catálogo'; }
  }
}


const state = {
  authed: false,
  demoMode: false,
  users: [],
  catalog: { items: [] },
  editingToken: null,
};

const $ = (s) => document.querySelector(s);
const msg = (id, text, good=false) => {
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
  el.style.color = good ? '#8ff6b1' : '#b6c2e1';
};
function escapeHtml(value) {
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function dtLocalFromIso(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isoFromLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
async function api(path, opts={}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type':'application/json', ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const txt = await res.text();
  let data = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) throw new Error(data.error || data.raw || `Error ${res.status}`);
  return data;
}
async function checkAuth() {
  try {
    await api('/api/admin/system');
    state.authed = true;
  } catch {
    state.authed = false;
  }
  renderShell();
  if (state.authed) await refreshAll();
}
function renderShell() {
  $('#login-view').classList.toggle('hidden', state.authed);
  $('#app-view').classList.toggle('hidden', !state.authed);
}
async function doLogin() {
  msg('#login-msg', 'Entrando...');
  try {
    await api('/api/admin/login', { method:'POST', body:{ username: $('#login-user').value, password: $('#login-pass').value } });
    state.authed = true;
    renderShell();
    await refreshAll();
  } catch (e) {
    msg('#login-msg', e.message);
  }
}
async function doLogout() {
  await api('/api/admin/logout', { method:'POST' }).catch(()=>{});
  location.reload();
}
async function refreshAll() {
  await Promise.all([loadSystem(), loadUsers(), loadCatalog()]);
}
async function loadSystem() {
  try {
    const s = await api('/api/admin/system');
    const pill = $('#redis-pill');
    pill.textContent = s.redisOk ? 'Redis OK' : 'Redis Error';
    pill.className = 'pill ' + (s.redisOk ? 'ok' : 'bad');
    $('#system-box').innerHTML = `
      <div>Storage: upstash</div>
      <div>Redis: ${s.redisOk ? 'OK' : 'ERROR'}</div>
      <div>Detalle Redis: ${escapeHtml(s.detail || '-')}</div>
      <div>Usuarios: ${s.users}</div>
      <div>Items: ${s.items}</div>
      <div>Caducan pronto: ${s.soon}</div>
      <div>Caducados: ${s.expired}</div>
      <div>ENV Upstash URL: ${s.hasUrl ? 'sí' : 'no'}</div>
      <div>ENV Upstash Token: ${s.hasToken ? 'sí' : 'no'}</div>
    `;
  } catch (e) {
    $('#redis-pill').textContent = 'Redis Error';
    $('#redis-pill').className = 'pill bad';
    $('#system-box').textContent = e.message;
  }
}
async function loadUsers() {
  const data = await api('/api/admin/users');
  state.users = data.users || [];
  renderUsersList(state.users, state.demoMode);
}
async function loadCatalog() {
  const data = await api('/api/admin/catalog');
  state.catalog = data.catalog || { items: [] };
  renderCatalog(state.catalog);
}
function clearUserForm() {
  state.editingToken = null;
  $('#u-name').value = '';
  $('#u-token').value = '';
  $('#u-plan').value = 'monthly';
  $('#u-max').value = '1';
  $('#u-exp').value = '';
  $('#u-active').checked = true;
  $('#u-notes').value = '';
  msg('#user-msg','');
}
function fillUserForm(user) {
  state.editingToken = user.token;
  $('#u-name').value = user.name || '';
  $('#u-token').value = user.token || '';
  $('#u-plan').value = user.plan || 'custom';
  $('#u-max').value = user.maxConnections || 1;
  $('#u-exp').value = dtLocalFromIso(user.expiresAt);
  $('#u-active').checked = user.active !== false;
  $('#u-notes').value = user.notes || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function saveUser() {
  const body = {
    token: $('#u-token').value.trim(),
    name: $('#u-name').value.trim(),
    plan: $('#u-plan').value,
    maxConnections: Number($('#u-max').value || 1),
    expiresAt: isoFromLocal($('#u-exp').value),
    active: $('#u-active').checked,
    notes: $('#u-notes').value
  };
  if (!body.name) return msg('#user-msg', 'Pon un nombre');
  try {
    if (state.editingToken) {
      body.token = state.editingToken;
      await api('/api/admin/users', { method:'PUT', body });
      msg('#user-msg', 'Usuario actualizado', true);
    } else {
      await api('/api/admin/users', { method:'POST', body });
      msg('#user-msg', 'Usuario guardado', true);
    }
    clearUserForm();
    await Promise.all([loadUsers(), loadSystem()]);
  } catch (e) { msg('#user-msg', e.message); }
}
async function saveCatalogJson() {
  try {
    const payload = JSON.parse($('#catalog-json').value);
    await api('/api/admin/catalog', { method:'POST', body: payload });
    msg('#catalog-msg', 'Catálogo guardado', true);
    await Promise.all([loadCatalog(), loadSystem()]);
  } catch (e) { msg('#catalog-msg', e.message); }
}
async function loadCatalogJson() {
  $('#catalog-json').value = JSON.stringify(state.catalog || {items:[]}, null, 2);
}
async function clearCatalog() {
  if (!confirm('¿Vaciar catálogo?')) return;
  try {
    await api('/api/admin/catalog/clear', { method:'POST', body:{} });
    msg('#catalog-msg', 'Catálogo vaciado', true);
    await Promise.all([loadCatalog(), loadSystem()]);
  } catch (e) { msg('#catalog-msg', e.message); }
}
async function uploadM3u() {
  const file = $('#m3u-file').files[0];
  if (!file) return msg('#catalog-msg', 'Selecciona un archivo M3U');
  const text = await file.text();
  try {
    const data = await api('/api/admin/catalog/import-m3u', { method:'POST', body:{ text } });
    msg('#catalog-msg', `M3U importado: ${data.count} canales`, true);
    $('#catalog-json').value = JSON.stringify(data.catalog, null, 2);
    await Promise.all([loadCatalog(), loadSystem()]);
  } catch (e) { msg('#catalog-msg', e.message); }
}
function renderCatalog(catalog) {
  const items = Array.isArray(catalog.items) ? catalog.items : [];
  const grid = $('#catalog-grid');
  if (!items.length) return grid.innerHTML = '<div class="empty-state">No hay elementos en catálogo.</div>';
  grid.innerHTML = items.slice(0, 120).map(item => `
    <div class="item-card">
      <div class="item-poster">${escapeHtml(item.name || '')}</div>
      <div class="item-body">
        <div><strong>${escapeHtml(item.name || '')}</strong></div>
        <div class="muted">${escapeHtml(item.genre || item.description || '')}</div>
        <div class="muted">${escapeHtml(item.id || '')}</div>
      </div>
    </div>
  `).join('');
}
function formatDateTime(value) {
  if (!value) return 'Sin caducidad';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('es-ES');
}
function getRemainingParts(expiresAt) {
  if (!expiresAt) return null;
  const now = Date.now();
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return null;
  let diff = end - now;
  const expired = diff <= 0;
  diff = Math.abs(diff);
  const days = Math.floor(diff / 86400000); diff -= days * 86400000;
  const hours = Math.floor(diff / 3600000); diff -= hours * 3600000;
  const minutes = Math.floor(diff / 60000);
  return { expired, days, hours, minutes };
}
function getRemainingText(expiresAt) {
  const p = getRemainingParts(expiresAt);
  if (!p) return 'Sin caducidad';
  const t = `${p.days}d ${p.hours}h ${p.minutes}m`;
  return p.expired ? `Caducado hace ${t}` : `${t} restantes`;
}
function getAlertBadge(expiresAt) {
  const p = getRemainingParts(expiresAt);
  if (!p) return '';
  if (p.expired) return `<span class="badge badge-red">CADUCADO</span>`;
  const total = p.days*24*60 + p.hours*60 + p.minutes;
  if (total <= 24*60) return `<span class="badge badge-orange">VENCE HOY</span>`;
  if (total <= 3*24*60) return `<span class="badge badge-yellow">CADUCA MUY PRONTO</span>`;
  if (total <= 7*24*60) return `<span class="badge badge-blue">CADUCA PRONTO</span>`;
  return `<span class="badge badge-green">ACTIVO</span>`;
}
function maskToken(token) { return token ? '*'.repeat(Math.max(8, token.length)) : ''; }
function maskIp(_) { return '***.***.***.***'; }
function maskUrl(url) { return url ? url.replace(/\/u\/([^/]+)\//, '/u/********/') : ''; }
function normalizePlanBrand(plan) {
  const value = String(plan || '').toLowerCase().trim();
  if (value === 'quarterly' || value === 'trimestral' || value === '3 meses') return 'quarterly';
  if (value === 'annual' || value === 'anual' || value === '12 meses') return 'annual';
  return 'monthly';
}
function getBrandPlanClass(plan) {
  const p = normalizePlanBrand(plan);
  if (p === 'quarterly') return 'plan-quarter';
  if (p === 'annual') return 'plan-year';
  return 'plan-month';
}
function getBrandPlanLabel(plan) {
  const p = normalizePlanBrand(plan);
  if (p === 'quarterly') return 'PLAN TRIMESTRAL';
  if (p === 'annual') return 'PLAN ANUAL';
  return 'PLAN MENSUAL';
}
function getBrandDeviceClass(maxConnections) {
  const n = Number(maxConnections || 1);
  if (n <= 1) return 'device-green';
  if (n === 2) return 'device-orange';
  return 'device-red';
}
function getBrandDeviceLabel(maxConnections) {
  const n = Number(maxConnections || 1);
  return n <= 1 ? '1 DISPOSITIVO' : `${n} DISPOSITIVOS`;
}
function renderUserQr(containerId, text) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  if (!text) return el.innerHTML = '<div class="qr-fallback">QR no disponible</div>';
  if (typeof QRCode === 'undefined') return el.innerHTML = '<div class="qr-fallback qr-error">Librería QR no cargada</div>';
  QRCode.toCanvas(text, { width: 116, margin: 1, errorCorrectionLevel: 'M' }, (err, canvas) => {
    if (err) { el.innerHTML = '<div class="qr-fallback qr-error">Error QR</div>'; return; }
    canvas.style.width = '116px'; canvas.style.height = '116px'; canvas.style.display = 'block';
    el.appendChild(canvas);
  });
}
function buildUserCard(user, demoMode=false) {
  const rawIps = Array.isArray(user.ips) ? user.ips.join(', ') : '';
  const safeIps = demoMode ? maskIp(rawIps) : (rawIps || '-');
  const installUrl = `${location.origin}/u/${encodeURIComponent(user.token)}/manifest.json`;
  const visibleUrl = demoMode ? maskUrl(installUrl) : installUrl;
  const visibleToken = demoMode ? maskToken(user.token || '') : (user.token || '');
  const currentConnections = Array.isArray(user.ips) ? user.ips.length : 0;
  const qrId = `qr-${String(user.token || '').replace(/[^a-zA-Z0-9_-]/g,'_')}`;
  return `
    <div class="user-card">
      <div class="user-card-main">
        <div class="user-card-top">
          <div>
            <div class="user-name">${escapeHtml(user.name || '')}</div>
            <div class="user-token">${escapeHtml(visibleToken)}</div>
          </div>
          <div class="user-badges">
            <span class="badge badge-plan">Plan: ${escapeHtml(labelPlan(user.plan))}</span>
            ${getAlertBadge(user.expiresAt)}
            <span class="badge badge-muted">${escapeHtml(getRemainingText(user.expiresAt))}</span>
          </div>
        </div>
        <div class="user-meta">
          <div><strong>Caduca:</strong> ${escapeHtml(formatDateTime(user.expiresAt))}</div>
          <div><strong>Conexiones/IPs:</strong> ${currentConnections}/${Number(user.maxConnections || 1)}</div>
          <div><strong>Último acceso:</strong> ${demoMode ? 'Oculto' : escapeHtml(formatDateTime(user.lastAccess))}</div>
          <div><strong>IPs:</strong> ${escapeHtml(safeIps)}</div>
          <div><strong>Notas:</strong> ${demoMode ? 'Oculto' : escapeHtml(user.notes || '-')}</div>
        </div>
        <div class="user-url-box">${escapeHtml(visibleUrl)}</div>
        <div class="user-actions ${demoMode ? 'is-hidden' : ''}">
          <button class="btn" onclick="window.editUser('${escapeJs(user.token)}')">Editar</button>
          <button class="btn primary" onclick="window.copyInstallUrl('${escapeJs(user.token)}')">Copiar enlace</button>
          <button class="btn" onclick="window.resetUserIps('${escapeJs(user.token)}')">Reset IPs</button>
          <button class="btn danger" onclick="window.deleteUser('${escapeJs(user.token)}')">Eliminar</button>
          <button class="btn success" onclick="window.renewUser('${escapeJs(user.token)}','monthly')">Renovar mes</button>
          <button class="btn success" onclick="window.renewUser('${escapeJs(user.token)}','quarterly')">Renovar trimestre</button>
          <button class="btn success" onclick="window.renewUser('${escapeJs(user.token)}','annual')">Renovar año</button>
          <button class="btn warning" onclick="window.showClientCard('${escapeJs(user.token)}')">Tarjeta + QR</button>
        </div>
      </div>
      <div class="user-card-qr-col">
        <div class="user-brand-card ${getBrandPlanClass(user.plan)}">
          <div class="brand-top">MoiStremioTV</div>
          <div class="brand-main">${getBrandPlanLabel(user.plan)}</div>
          <div class="brand-device ${getBrandDeviceClass(user.maxConnections)}">${getBrandDeviceLabel(user.maxConnections)}</div>
        </div>
      </div>
    </div>
  `;
}
function renderUsersList(users, demoMode=false) {
  const container = $('#users-list');
  if (!Array.isArray(users) || !users.length) {
    container.innerHTML = '<div class="empty-state">No hay usuarios.</div>';
    return;
  }
  container.innerHTML = users.map(u => buildUserCard(u, demoMode)).join('');
  }
function labelPlan(plan) {
  return ({monthly:'Mensual', quarterly:'Trimestral', annual:'Anual', custom:'Personalizado'})[plan] || 'Personalizado';
}
function escapeJs(s) {
  return String(s || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}
window.editUser = function(token) {
  const u = state.users.find(x => x.token === token);
  if (u) fillUserForm(u);
};
window.copyInstallUrl = async function(token) {
  const url = `${location.origin}/u/${encodeURIComponent(token)}/manifest.json`;
  await navigator.clipboard.writeText(url);
  alert('Enlace copiado');
};
window.resetUserIps = async function(token) {
  if (!confirm('¿Resetear IPs?')) return;
  await api('/api/admin/users/reset-ips', { method:'POST', body:{ token } });
  await Promise.all([loadUsers(), loadSystem()]);
};
window.deleteUser = async function(token) {
  if (!confirm('¿Eliminar usuario?')) return;
  await api('/api/admin/users', { method:'DELETE', body:{ token } });
  await Promise.all([loadUsers(), loadSystem()]);
};
window.renewUser = async function(token, plan) {
  await api('/api/admin/users/renew', { method:'POST', body:{ token, plan } });
  await Promise.all([loadUsers(), loadSystem()]);
};
window.showClientCard = function(token) {
  const u = state.users.find(x => x.token === token);
  if (!u) return;
  const installUrl = `${location.origin}/u/${encodeURIComponent(token)}/manifest.json`;
  $('#client-modal').classList.remove('hidden');
  $('#client-card').innerHTML = `
    <div class="client-card">
      <div>
        <h2>MoiStremioTV</h2>
        <div class="muted" style="margin-bottom:14px">Perfil de cliente · Acceso privado Stremio</div>
        <div class="client-line"><span class="client-label">Usuario</span><span class="client-value">${escapeHtml(u.name || '')}</span></div>
        <div class="client-line"><span class="client-label">Plan</span><span class="client-value">${escapeHtml(labelPlan(u.plan))}</span></div>
        <div class="client-line"><span class="client-label">Caduca</span><span class="client-value">${escapeHtml(formatDateTime(u.expiresAt))}</span></div>
        <div class="client-line"><span class="client-label">Conexiones</span><span class="client-value">${Number(u.maxConnections || 1)}</span></div>
        <div class="client-line"><span class="client-label">Estado</span><span class="client-value">${getRemainingParts(u.expiresAt)?.expired ? 'Caducado' : 'Activo'}</span></div>
        <div class="client-line"><span class="client-label">Restante</span><span class="client-value">${escapeHtml(getRemainingText(u.expiresAt))}</span></div>
        <div class="actions wrap"><button class="btn primary" onclick="window.copyInstallUrl('${escapeJs(token)}')">Copiar acceso</button></div>
      </div>
      <div class="client-qr" id="client-qr-box"><div class="qr-fallback">Generando QR...</div></div>
    </div>
  `;
  renderUserQr('client-qr-box', installUrl);
};
$('#btn-close-modal').onclick = () => $('#client-modal').classList.add('hidden');
$('#btn-login').onclick = doLogin;
$('#btn-logout').onclick = doLogout;
$('#btn-refresh').onclick = refreshAll;
$('#btn-test').onclick = loadSystem;
$('#btn-save-user').onclick = saveUser;
$('#btn-clear-user').onclick = clearUserForm;
$('#btn-save-json').onclick = saveCatalogJson;
$('#btn-load-json').onclick = loadCatalogJson;
$('#btn-clear-catalog').onclick = clearCatalog;
$('#btn-upload-m3u').onclick = uploadM3u;
$('#btn-demo').onclick = () => { state.demoMode = !state.demoMode; renderUsersList(state.users, state.demoMode); $('#btn-demo').textContent = state.demoMode ? 'Modo demo ON' : 'Modo demo'; };
checkAuth();
