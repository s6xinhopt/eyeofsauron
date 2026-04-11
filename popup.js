const EOS_SERVER = 'https://eos-server-git-beta-s6xinhopts-projects.vercel.app';
let currentPlayer = null;

// --- API helper (usa servidor autenticado, não Supabase direto) ---
async function api(path, opts) {
  const { eosToken } = await chrome.storage.local.get('eosToken');
  if (!eosToken) throw new Error('Sem token');
  const res = await fetch(`${EOS_SERVER}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eosToken}`, ...(opts?.headers || {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- Inicialização ---
(async function init() {
  showView('viewLoading');

  const data = await chrome.storage.local.get([
    'eosPlayerName', 'eosTribeName', 'eosWorld',
    'webhookUrl', 'reportInterval'
  ]);

  // Preenche campos de config
  if (data.webhookUrl)     document.getElementById('webhookUrl').value     = data.webhookUrl;
  if (data.reportInterval) document.getElementById('reportInterval').value = data.reportInterval;

  if (!data.eosPlayerName) {
    const tabs = await chrome.tabs.query({ url: '*://*.tribalwars.com.pt/*' });
    if (tabs.length > 0) {
      showView('viewRefresh');
    } else {
      showView('viewNoGame');
    }
    return;
  }

  currentPlayer = { name: data.eosPlayerName, tribe: data.eosTribeName, world: data.eosWorld };
  const tribeLabel = data.eosTribeName ? ` · ${data.eosTribeName}` : ' · (sem tribo)';
  document.getElementById('headerSub').textContent =
    `${data.eosPlayerName} · ${(data.eosWorld || '').toUpperCase()}${tribeLabel}`;

  try {
    const result = await api('/api/members');

    if (!result.myName) {
      const localStatus = (await chrome.storage.local.get('eosStatus')).eosStatus;
      if (localStatus === 'no_tribe') { showView('viewNoTribe'); }
      else { showView('viewPending'); }
      return;
    }

    const me = result.members?.find(m => m.player_name === result.myName);
    if (!me) { showView('viewPending'); return; }

    await chrome.storage.local.set({ eosStatus: 'approved', eosIsLeader: result.myRole === 'leader' });

    // Painel principal
    document.getElementById('tribeDisplay').textContent = result.tribeName || '—';
    document.getElementById('worldDisplay').textContent = (result.world || '').toUpperCase();

    const isLeader = result.myRole === 'leader' || result.myRole === 'moderator';
    if (isLeader) {
      document.getElementById('tabPendingBtn').style.display = '';
    }

    setupTabs();
    showView('viewPanel');
    renderMembers(result.members);
    if (isLeader) loadPending();

  } catch (err) {
    console.error('[EOS Popup]', err);
    try {
      const parsed = JSON.parse(err.message);
      if (parsed.status === 'pending')  { showView('viewPending');  return; }
      if (parsed.status === 'rejected') { showView('viewRejected'); return; }
    } catch {}
    showView('viewNoGame');
  }
})();

// --- Membros ---
function renderMembers(members) {
  const el = document.getElementById('membersList');
  if (!members || members.length === 0) {
    el.innerHTML = '<div class="empty">Sem membros aprovados.</div>';
    return;
  }
  el.innerHTML = members.map(m => {
    const dotClass = onlineDot(m.last_seen);
    const badge = m.role === 'leader' ? '<span class="badge-leader">LÍDER</span>'
                : m.role === 'moderator' ? '<span class="badge-leader" style="background:#5a3418;color:#f0b868">MOD</span>'
                : '';
    return `
      <div class="member-row">
        <div class="member-dot ${dotClass}"></div>
        <div class="member-name">${escHtml(m.player_name)}${badge}</div>
        <div class="member-time">${timeAgo(m.last_seen)}</div>
      </div>`;
  }).join('');
}

// --- Pedidos pendentes (líder) ---
async function loadPending() {
  const listEl = document.getElementById('pendingList');
  const badge  = document.getElementById('pendingBadge');
  try {
    const result = await api('/api/pending');
    const rows = result.pending || [];

    if (rows.length === 0) {
      listEl.innerHTML = '<div class="empty">Sem pedidos pendentes.</div>';
      badge.style.display = 'none';
      return;
    }

    badge.textContent   = rows.length;
    badge.style.display = '';

    listEl.innerHTML = rows.map(m => `
      <div class="pending-card" id="pc-${escHtml(m.id)}">
        <div class="pending-card-name">${escHtml(m.player_name)}</div>
        <div class="pending-card-meta">Pedido em ${formatDate(m.created_at)}</div>
        <div class="btn-row">
          <button class="btn-approve" data-id="${escHtml(m.id)}" data-action="approved">✔ Aceitar</button>
          <button class="btn-reject"  data-id="${escHtml(m.id)}" data-action="rejected">✖ Rejeitar</button>
        </div>
      </div>`).join('');

    // Delegação de eventos (uma única vez)
    listEl.onclick = async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      btn.disabled = true;
      await decideMember(btn.dataset.id, btn.dataset.action);
    };

  } catch (err) {
    listEl.innerHTML = '<div class="empty">Erro ao carregar pedidos.</div>';
  }
}

async function decideMember(id, decision) {
  try {
    await api('/api/pending', {
      method: 'PATCH',
      body: JSON.stringify({ id, decision })
    });

    document.getElementById(`pc-${id}`)?.remove();

    const remaining = document.querySelectorAll('[id^="pc-"]').length;
    const badge = document.getElementById('pendingBadge');
    if (remaining === 0) {
      badge.style.display = 'none';
      document.getElementById('pendingList').innerHTML = '<div class="empty">Sem pedidos pendentes.</div>';
    } else {
      badge.textContent = remaining;
    }
  } catch (err) {
    console.error('[EOS] decideMember:', err);
  }
}

// --- Tabs ---
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      if (!target) return;
      document.querySelectorAll('.tab-btn').forEach(b  => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(target)?.classList.add('active');
    });
  });
}

// --- Discord ---
const webhookInput  = document.getElementById('webhookUrl');
const intervalInput = document.getElementById('reportInterval');
const sendBtn       = document.getElementById('sendBtn');
const sendStatusEl  = document.getElementById('sendStatus');

webhookInput.addEventListener('input', saveConfig);
intervalInput.addEventListener('change', saveConfig);

function saveConfig() {
  const interval = parseInt(intervalInput.value) || 60;
  chrome.storage.local.set({ webhookUrl: webhookInput.value.trim(), reportInterval: interval });
  chrome.runtime.sendMessage({ type: 'UPDATE_ALARM', interval });
}

sendBtn.addEventListener('click', async () => {
  const webhookUrl = webhookInput.value.trim();
  if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    setSendStatus('Webhook inválido.', 'err'); return;
  }

  const tabs = await chrome.tabs.query({ url: '*://*.tribalwars.com.pt/*' });
  if (tabs.length === 0) { setSendStatus('Abre o TribalWars primeiro!', 'err'); return; }

  const origin    = new URL(tabs[0].url).origin;
  const troopsUrl = `${origin}/game.php?screen=overview_villages&mode=units`;

  await chrome.storage.local.set({ pendingReport: true });
  sendBtn.disabled = true;
  setSendStatus('A abrir página de tropas...', 'info');
  chrome.tabs.create({ url: troopsUrl, active: true });

  const onMsg = (msg) => {
    if (msg.type === 'REPORT_SUCCESS') {
      setSendStatus('Tropas enviadas!', 'ok');
      sendBtn.disabled = false;
      chrome.runtime.onMessage.removeListener(onMsg);
    } else if (msg.type === 'REPORT_ERROR') {
      setSendStatus(`Erro: ${msg.error}`, 'err');
      sendBtn.disabled = false;
      chrome.runtime.onMessage.removeListener(onMsg);
    }
  };
  chrome.runtime.onMessage.addListener(onMsg);
  setTimeout(() => { sendBtn.disabled = false; chrome.runtime.onMessage.removeListener(onMsg); }, 30000);
});

// --- Utilitários ---
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function setSendStatus(msg, type) {
  sendStatusEl.textContent = msg;
  sendStatusEl.className   = `s-${type}`;
}

function escHtml(str) {
  return (str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const min = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (min < 2)   return 'agora';
  if (min < 60)  return `${min}m`;
  const h = Math.floor(min / 60);
  if (h  < 24)   return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function onlineDot(isoStr) {
  if (!isoStr) return 'dot-offline';
  const min = (Date.now() - new Date(isoStr).getTime()) / 60000;
  if (min < 15)  return 'dot-online';
  if (min < 120) return 'dot-recent';
  return 'dot-offline';
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('pt-PT', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}
