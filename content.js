// content.js — cliente mínimo
// Só lê o DOM do TW e comunica com o servidor. Sem lógica de negócio.

const EOS_SERVER = 'https://eos-server-sooty.vercel.app';

// ── Utilitários ──────────────────────────────────────────────────────────────

function isUnitsPage() {
  const p = new URLSearchParams(window.location.search);
  return p.get('screen') === 'overview_villages' && p.get('mode') === 'units';
}

function isGroupsPage() {
  const p = new URLSearchParams(window.location.search);
  return p.get('screen') === 'overview_villages' && p.get('mode') === 'groups';
}

async function getStorage(...keys) {
  return chrome.storage.local.get(keys);
}

// ── Leitura de tropas ────────────────────────────────────────────────────────

function readTroops() {
  const table = document.querySelector('#units_table') || document.querySelector('table.vis');
  if (!table) return null;

  const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
  if (!headerRow) return null;

  const colMap = {};
  Array.from(headerRow.querySelectorAll('th,td')).forEach((cell, idx) => {
    const img = cell.querySelector('img');
    if (!img) return;
    const ref = [(img.src||''), (img.alt||''), (img.title||'')].join(' ').toLowerCase();
    const UNITS = {
      spear:['spear','lance'], sword:['sword','espada'], axe:['axe','machado'],
      archer:['archer','arqueiro'], spy:['spy','batedor','explorador'],
      marcher:['marcher'], light:['light','ligeira'], heavy:['heavy','pesada'],
      ram:['ram','ariete'], catapult:['catapult','catapulta'],
      knight:['knight','paladino'], snob:['snob','nobre']
    };
    for (const [unit, keys] of Object.entries(UNITS)) {
      if (keys.some(k => ref.includes(k))) { colMap[idx] = unit; break; }
    }
  });

  if (!Object.keys(colMap).length) return null;

  const totals = {};
  Array.from(table.querySelectorAll('tbody tr')).forEach(row => {
    Array.from(row.querySelectorAll('td')).forEach((cell, idx) => {
      if (colMap[idx]) {
        const v = parseInt((cell.textContent||'').replace(/\D/g,'')) || 0;
        totals[colMap[idx]] = (totals[colMap[idx]] || 0) + v;
      }
    });
  });

  return totals;
}

function waitForTable() {
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const check = () => {
      const t = document.querySelector('#units_table') || document.querySelector('table.vis');
      if (t && t.querySelectorAll('tr').length > 2) return resolve();
      if (elapsed >= 10000) return reject(new Error('Timeout'));
      elapsed += 300; setTimeout(check, 300);
    };
    check();
  });
}

// ── Extração de grupos do jogo ───────────────────────────────────────────────

function extractTWGroups() {
  const seen = new Set(); const groups = [];
  function add(id, name) {
    const sid = String(id);
    if (!sid || sid === '0' || seen.has(sid)) return;
    const n = (name||'').trim(); if (!n) return;
    seen.add(sid); groups.push({ id: sid, name: n });
  }

  const sel = document.querySelector('select#group_id, select[name="group_id"]');
  if (sel) Array.from(sel.options).filter(o => o.value && o.value!=='0').forEach(o => add(o.value, o.text));

  document.querySelectorAll('span.group-menu-item').forEach(span => {
    const m = (span.getAttribute('onclick')||'').match(/\b(\d+)\b/);
    if (m) add(m[1], span.textContent);
  });

  document.querySelectorAll('a[href*="group="]').forEach(a => {
    const m = (a.getAttribute('href')||'').match(/[?&]group=(\d+)/);
    const name = a.textContent.trim();
    if (m && name.length > 2) add(m[1], name);
  });

  return groups.length ? groups : null;
}

// ── Overlay ──────────────────────────────────────────────────────────────────

function showOverlay(msg, type = 'info') {
  let el = document.getElementById('eos-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'eos-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:2147483647;font-family:Segoe UI,sans-serif';
    document.body.appendChild(el);
  }
  const color = type==='error'?'#f44336':type==='ok'?'#4caf50':'#c0a060';
  el.innerHTML = `<div style="background:#1a1a2e;border:2px solid ${color};border-radius:8px;padding:24px 36px;text-align:center;color:${color};font-size:15px;font-weight:bold">${msg}</div>`;
}

// ── Clique de grupo ──────────────────────────────────────────────────────────

function waitForGroupLink(groupId) {
  return new Promise(resolve => {
    let elapsed = 0;
    const check = () => {
      const link = document.querySelector(`a[data-group-id="${groupId}"]`);
      if (link) return resolve(link);
      if (elapsed >= 8000) return resolve(null);
      elapsed += 200; setTimeout(check, 200);
    };
    check();
  });
}

// ── Injeção do botão EOS ─────────────────────────────────────────────────────

function injectEOSButton() {
  if (document.getElementById('eos-btn')) return;
  const container = document.getElementById('questlog_new');
  if (!container) return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:25px;margin:4px auto;display:block';

  const btn = document.createElement('div');
  btn.id = 'eos-btn';
  btn.title = 'Eye of Sauron';
  btn.style.cssText = `width:25px;height:25px;background-image:url('${chrome.runtime.getURL('background/eye_of_sauron.gif')}');background-size:cover;border-radius:4px;cursor:pointer;border:2px solid #c0a060;box-shadow:0 2px 8px rgba(0,0,0,0.6)`;

  btn.addEventListener('click', async () => {
    const { eosToken } = await getStorage('eosToken');
    if (!eosToken) { alert('Ainda não autenticado. Aguarda uns segundos e tenta novamente.'); return; }

    // Se já está aberto, fecha
    const existing = document.getElementById('eos-panel-overlay');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'eos-panel-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';

    const container = document.createElement('div');
    container.style.cssText = 'position:relative;width:98vw;max-width:1400px;height:90vh;background:#0d0d1a;border:2px solid #c0a060;border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.8)';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;z-index:1;background:none;border:none;color:#c0a060;font-size:20px;cursor:pointer;line-height:1';
    closeBtn.onclick = () => overlay.remove();

    const iframe = document.createElement('iframe');
    iframe.src = `${EOS_SERVER}/panel?token=${eosToken}`;
    iframe.style.cssText = 'width:100%;height:100%;border:none';

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    container.appendChild(closeBtn);
    container.appendChild(iframe);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
  });

  const badge = document.createElement('span');
  badge.id = 'eos-badge';
  badge.style.cssText = 'position:absolute;top:-5px;right:-5px;background:#f44336;color:#fff;border-radius:50%;min-width:14px;height:14px;font-size:9px;font-weight:bold;display:none;align-items:center;justify-content:center;pointer-events:none;font-family:Arial,sans-serif;line-height:14px;text-align:center;padding:0 2px;box-sizing:border-box;border:1px solid #1a1a2e';

  wrapper.appendChild(btn); wrapper.appendChild(badge);
  container.appendChild(wrapper);
}

function waitForQuestlog() {
  const el = document.getElementById('questlog_new');
  if (el) injectEOSButton();
  else setTimeout(waitForQuestlog, 300);
}

// ── Ponto de entrada ─────────────────────────────────────────────────────────

async function main() {
  // Página de grupos: extrai e guarda
  if (isGroupsPage()) {
    let attempts = 0;
    const tryExtract = async () => {
      const groups = extractTWGroups();
      if (groups) {
        await chrome.storage.local.set({ twGroups: groups });
        // Envia grupos para o servidor para o painel os mostrar
        const { eosToken } = await getStorage('eosToken');
        if (eosToken) {
          fetch(`${EOS_SERVER}/api/tw-groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eosToken}` },
            body: JSON.stringify({ groups })
          }).catch(() => {});
        }
        showOverlay(`✔ ${groups.length} grupos extraídos!`, 'ok');
        setTimeout(() => chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }), 1500);
      } else if (attempts++ < 20) setTimeout(tryExtract, 300);
    };
    tryExtract();
    return;
  }

  // Página de tropas: só corre se aberta pela extensão (eos=1 na URL ou flag em sessionStorage)
  if (!isUnitsPage()) return;
  const params = new URLSearchParams(window.location.search);
  const eosTriggered = params.get('eos') === '1' || sessionStorage.getItem('eos_triggered') === '1';
  if (!eosTriggered) return;
  // Propaga o flag para navegações internas (ex: clique de grupo)
  sessionStorage.setItem('eos_triggered', '1');

  const data = await getStorage('pendingTroopRequest', 'pendingTroopGroupId', 'pendingTroopGroupName', 'eosToken');
  if (!data.pendingTroopRequest) return;

  const groupId   = data.pendingTroopGroupId   || '0';
  const groupName = data.pendingTroopGroupName || 'Todos';
  const token     = data.eosToken;

  if (!token) return;

  showOverlay('⚔️ A ler tropas...');

  try {
    await waitForTable();
    const troops = readTroops();
    if (!troops) throw new Error('Não foi possível ler a tabela de tropas.');

    // Envia para o servidor — a chave Supabase nunca sai do servidor
    const res = await fetch(`${EOS_SERVER}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ troops, groupId, groupName })
    });

    if (!res.ok) throw new Error(`Servidor: ${res.status}`);

    await chrome.storage.local.set({ pendingTroopRequest: false });
    sessionStorage.removeItem('eos_triggered');
    showOverlay('✔ Tropas guardadas!', 'ok');
    setTimeout(() => { chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }); window.close(); }, 1000);

  } catch (err) {
    await chrome.storage.local.set({ pendingTroopRequest: false });
    sessionStorage.removeItem('eos_triggered');
    showOverlay('❌ ' + err.message, 'error');
    setTimeout(() => { chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }); window.close(); }, 4000);
  }
}

main();
waitForQuestlog();

// ── Recebe dados do page_reader (MAIN world) ─────────────────────────────────

window.addEventListener('message', (event) => {
  if (!event.data) return;

  // Mensagens do iframe do painel EOS
  if (event.data.type === 'EOS_SYNC_SCHEDULES') {
    getStorage('eosToken').then(({ eosToken }) => {
      if (eosToken) chrome.runtime.sendMessage({ type: 'SYNC_SCHEDULES', token: eosToken });
    });
    return;
  }

  if (event.data.type === 'EOS_EXTRACT_GROUPS_REQUEST') {
    const world = window.location.hostname.split('.')[0];
    const url = `https://${world}.tribalwars.com.pt/game.php?screen=overview_villages&mode=groups`;
    chrome.runtime.sendMessage({ type: 'CREATE_TAB', url, active: false });
    return;
  }

  if (event.data.type === 'EOS_FORCE_REPORT') {
    getStorage('eosToken', 'eosWorld').then(({ eosToken, eosWorld }) => {
      if (!eosToken || !eosWorld) return;
      const groupId   = event.data.groupId   || '0';
      const groupName = event.data.groupName || 'Todos';
      chrome.storage.local.set({ pendingTroopRequest: true, pendingTroopGroupId: groupId, pendingTroopGroupName: groupName });
      const url = `https://${eosWorld}.tribalwars.com.pt/game.php?screen=overview_villages&mode=units&type=own_home`;
      chrome.runtime.sendMessage({ type: 'CREATE_TAB', url, active: false });
    });
    return;
  }

  if (event.source !== window) return;

  if (event.data.type === 'EOS_GAME_DATA') {
    const { playerName, tribeName, allyId, hasTribe } = event.data;
    if (!playerName) return;
    // Envia para background que chama o servidor
    chrome.runtime.sendMessage({
      type: 'PLAYER_SEEN', playerName, tribeName, allyId, hasTribe,
      world: window.location.hostname.split('.')[0]
    });
  }

  if (event.data.type === 'EOS_GROUPS_DATA' && Array.isArray(event.data.groups)) {
    chrome.storage.local.set({ twGroups: event.data.groups });
    showOverlay(`✔ ${event.data.groups.length} grupos extraídos!`, 'ok');
    setTimeout(() => window.close(), 1500);
  }

});
