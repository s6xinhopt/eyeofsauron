// content.js — cliente mínimo
// Só lê o DOM do TW e comunica com o servidor. Sem lógica de negócio.

const EOS_SERVER = 'https://eos-server-sooty.vercel.app';

// ── Utilitários ──────────────────────────────────────────────────────────────

function isUnitsPage() {
  const p = new URLSearchParams(window.location.search);
  return p.get('screen') === 'place' && p.get('mode') === 'call';
}

function isGroupsPage() {
  const p = new URLSearchParams(window.location.search);
  return p.get('screen') === 'overview_villages' && p.get('mode') === 'groups';
}


async function getStorage(...keys) {
  return chrome.storage.local.get(keys);
}

// ── Leitura de tropas (via página de Mass Support) ───────────────────────────

const TROOP_NAMES = ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob'];

// Custo de população por unidade (valores padrão TW)
const POP_COST = {
  spear:1, sword:1, axe:1, archer:1,
  spy:2, light:4, marcher:5, heavy:6,
  ram:5, catapult:8, knight:10, snob:100
};
// Unidades ofensivas e defensivas para cálculo de pop
const OFFENSE_UNITS = ['axe','light','ram','catapult','marcher'];
const DEFENSE_UNITS = ['spear','sword','heavy','catapult','archer'];

function readTroops() {
  // Mesmo método do Support Sender: lê #village_troup_list com data-unit
  const table = document.querySelector('#village_troup_list');
  if (!table) return null;

  const rows = Array.from(table.querySelectorAll('tbody tr'));
  if (!rows.length) return null;

  const totals = {};
  for (const unit of TROOP_NAMES) totals[unit] = 0;

  rows.forEach(row => {
    for (const unit of TROOP_NAMES) {
      const cell = row.querySelector(`[data-unit='${unit}']`);
      if (!cell) continue;
      const v = parseInt((cell.textContent || '').replace(/\D/g, '')) || 0;
      totals[unit] = (totals[unit] || 0) + v;
    }
  });

  // Remove unidades com 0 para não poluir o snapshot
  for (const unit of TROOP_NAMES) {
    if (!totals[unit]) delete totals[unit];
  }

  return Object.keys(totals).length ? totals : null;
}

// Classifica cada aldeia em categorias (mesma lógica do Troops Counter)
// Usa custo de população para determinar força ofensiva/defensiva
function classifyVillages() {
  const table = document.querySelector('#village_troup_list');
  if (!table) return null;

  const rows = Array.from(table.querySelectorAll('tbody tr'));
  if (!rows.length) return null;

  const result = { full_nuke: 0, semi_nuke: 0, full_def: 0, semi_def: 0, noble: 0, other: 0 };

  rows.forEach(row => {
    const counts = {};
    for (const unit of TROOP_NAMES) {
      const cell = row.querySelector(`[data-unit='${unit}']`);
      counts[unit] = cell ? (parseInt((cell.textContent || '').replace(/\D/g, '')) || 0) : 0;
    }

    // Aldeias com nobre → categoria "noble"
    if ((counts['snob'] || 0) >= 1) { result.noble++; return; }

    // Pop ofensiva e defensiva
    let offPop = 0, defPop = 0;
    for (const u of OFFENSE_UNITS) offPop += (counts[u] || 0) * (POP_COST[u] || 0);
    for (const u of DEFENSE_UNITS) defPop += (counts[u] || 0) * (POP_COST[u] || 0);

    if      (offPop >= 20000) result.full_nuke++;
    else if (offPop >= 15000) result.semi_nuke++;
    else if (defPop >= 20000) result.full_def++;
    else if (defPop >= 15000) result.semi_def++;
    else                      result.other++;
  });

  return result;
}

function waitForTable() {
  return new Promise((resolve, reject) => {
    const ready = () => {
      const t = document.querySelector('#village_troup_list');
      return t && t.querySelectorAll('tbody tr').length > 0;
    };
    if (ready()) return resolve();
    const observer = new MutationObserver(() => {
      if (ready()) { observer.disconnect(); resolve(); }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('Timeout')); }, 8000);
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

let _groupsContainerCache = null;
function findGroupsContainer() {
  if (_groupsContainerCache && _groupsContainerCache.isConnected) return _groupsContainerCache;
  // Seletores específicos primeiro (rápidos), fallback genérico limitado ao #content_value
  const scope = document.getElementById('content_value') || document;
  for (const el of scope.querySelectorAll('td, div')) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && /grupos:/i.test(node.textContent)) {
        _groupsContainerCache = el;
        return el;
      }
    }
  }
  return null;
}

// Verifica se o grupo já está selecionado — apenas pela URL
function isGroupAlreadySelected(groupId) {
  const urlGroup = new URLSearchParams(window.location.search).get('group');
  if (groupId === '0') return !urlGroup || urlGroup === '0';
  return urlGroup === groupId;
}

function findGroupElement(groupId) {
  const scope = findGroupsContainer() || document.getElementById('content_value') || document;

  if (groupId === '0') {
    return scope.querySelector('a[href*="group=0"]')
        || scope.querySelector('a[href*="mode=call"]:not([href*="group="])')
        || scope.querySelector('a[href*="mode=units"]:not([href*="group="])')
        || null;
  }

  return scope.querySelector(`a[href*="group=${groupId}"]`)
      || scope.querySelector(`a[data-group-id="${groupId}"]`)
      || scope.querySelector(`span.group-menu-item[onclick*="${groupId}"]`)
      || (() => {
           for (const el of scope.querySelectorAll('[onclick]')) {
             if ((el.getAttribute('onclick') || '').includes(groupId)) return el;
           }
           return null;
         })();
}

function waitForGroupElement(groupId) {
  return new Promise(resolve => {
    const el = findGroupElement(groupId);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const el = findGroupElement(groupId);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, 6000);
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
  if (el) { injectEOSButton(); return; }
  // Usa MutationObserver em vez de polling recursivo, com timeout de 10s
  const obs = new MutationObserver(() => {
    const el = document.getElementById('questlog_new');
    if (el) { obs.disconnect(); injectEOSButton(); }
  });
  const target = document.body || document.documentElement;
  if (target) obs.observe(target, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 10000);
}

// ── Ponto de entrada ─────────────────────────────────────────────────────────

// ── Notificação de pedido de tropas (aceitar/recusar) ───────────────────

async function checkTroopConfirmation() {
  const data = await getStorage('pendingTroopConfirm', 'pendingTroopConfirmGroupId', 'pendingTroopConfirmGroupName');
  if (!data.pendingTroopConfirm) return;
  if (document.getElementById('eos-troop-confirm')) return;

  const groupName = data.pendingTroopConfirmGroupName || 'Todos';
  const bar = document.createElement('div');
  bar.id = 'eos-troop-confirm';
  bar.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:linear-gradient(135deg,#1a1008,#100c08);border:1px solid #3a2810;border-left:3px solid #e87830;border-radius:8px;padding:14px 18px;font-family:Segoe UI,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.8);max-width:320px';
  bar.innerHTML = `
    <div style="color:#e8a030;font-weight:700;font-size:13px;margin-bottom:6px">⚔️ Pedido de tropas</div>
    <div style="color:#b09070;font-size:12px;margin-bottom:12px">A liderança pede a atualização das tuas tropas <strong style="color:#e8a030">(${groupName})</strong></div>
    <div style="display:flex;gap:8px">
      <button id="eos-confirm-accept" style="flex:1;padding:7px 0;background:linear-gradient(135deg,#e87830,#c06020);color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:700;cursor:pointer">Aceitar</button>
      <button id="eos-confirm-refuse" style="flex:1;padding:7px 0;background:#1a1210;color:#807060;border:1px solid #3a2a1a;border-radius:5px;font-size:12px;cursor:pointer">Recusar</button>
    </div>`;
  document.body.appendChild(bar);

  document.getElementById('eos-confirm-accept').addEventListener('click', async () => {
    await chrome.storage.local.set({ pendingTroopConfirm: false });
    bar.remove();
    const { eosWorld } = await getStorage('eosWorld');
    if (!eosWorld) return;
    chrome.storage.local.set({
      pendingTroopRequest: true,
      pendingTroopGroupId: data.pendingTroopConfirmGroupId || '0',
      pendingTroopGroupName: groupName
    });
    chrome.runtime.sendMessage({ type: 'CREATE_TAB', url: `https://${eosWorld}.tribalwars.com.pt/game.php?screen=place&mode=call`, active: false });
  });

  document.getElementById('eos-confirm-refuse').addEventListener('click', async () => {
    await chrome.storage.local.set({ pendingTroopConfirm: false });
    bar.remove();
    const { eosToken } = await getStorage('eosToken');
    if (eosToken) {
      fetch(`${EOS_SERVER}/api/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eosToken}` },
        body: JSON.stringify({ action: 'refuse_troop_request' })
      }).catch(() => {});
    }
  });
}

async function main() {
  // Página de grupos: só extrai se aberta pela extensão
  if (isGroupsPage()) {
    const { pendingGroupsExtract } = await getStorage('pendingGroupsExtract');
    if (!pendingGroupsExtract) return;

    let attempts = 0;
    const tryExtract = async () => {
      const groups = extractTWGroups();
      if (groups) {
        await chrome.storage.local.set({ twGroups: groups, pendingGroupsExtract: false });
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

  // Página de tropas: lê e envia para o servidor
  if (!isUnitsPage()) return;

  const data = await getStorage('pendingTroopRequest', 'pendingTroopGroupId', 'pendingTroopGroupName', 'eosToken');
  if (!data.pendingTroopRequest) return;

  const groupId   = data.pendingTroopGroupId   || '0';
  const groupName = data.pendingTroopGroupName || 'Todos';
  const token     = data.eosToken;

  if (!token) return;

  showOverlay('⚔️ A ler tropas...');
  await handleTroopReport(groupId, groupName, token);
}

async function handleTroopReport(groupId, groupName, token) {
  // Passo 1: selecionar grupo (skip se "Todos" ou já selecionado)
  if (groupId !== '0' && !isGroupAlreadySelected(groupId)) {
    if (sessionStorage.getItem('eos_group_clicked') !== groupId) {
      const el = findGroupElement(groupId);
      if (el) {
        sessionStorage.setItem('eos_group_clicked', groupId);
        el.click(); return;
      }
      // Elemento não encontrado ainda — espera brevemente
      const elWait = await waitForGroupElement(groupId);
      if (elWait) {
        sessionStorage.setItem('eos_group_clicked', groupId);
        elWait.click(); return;
      }
      // Grupo não encontrado — avança mesmo assim
    }
  }
  sessionStorage.removeItem('eos_group_clicked');

  // Passo 2: paginação — clica em [todos] se existir e se ainda não clicou
  // Verifica se a paginação existe primeiro; se não existe, não há delay
  if (sessionStorage.getItem('eos_pagination_clicked') !== '1') {
    const pagTodos = document.querySelector('a.paged-nav-item[href*="page=-1"]')
      || Array.from(document.querySelectorAll('a.paged-nav-item')).find(a => /todos/i.test(a.textContent.trim()));
    if (pagTodos) {
      sessionStorage.setItem('eos_pagination_clicked', '1');
      pagTodos.click(); return;
    }
  }
  sessionStorage.removeItem('eos_pagination_clicked');

  // Passo 3: ler tropas e enviar
  try {
    await waitForTable();
    const troops = readTroops();
    if (!troops) throw new Error('Não foi possível ler a tabela de tropas.');
    const classification = classifyVillages();

    // Envio em paralelo: limpa flag + envia para servidor
    const [res] = await Promise.all([
      fetch(`${EOS_SERVER}/api/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ troops, classification, groupId, groupName })
      }),
      chrome.storage.local.set({ pendingTroopRequest: false })
    ]);

    if (!res.ok) throw new Error(`Servidor: ${res.status}`);

    showOverlay('✔ Tropas guardadas!', 'ok');
    // Fecha tab imediatamente — não precisa de esperar
    chrome.runtime.sendMessage({ type: 'CLOSE_TAB' });

  } catch (err) {
    await chrome.storage.local.set({ pendingTroopRequest: false });
    showOverlay('❌ ' + err.message, 'error');
    setTimeout(() => chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }), 2000);
  }
}

// Arranca o mais cedo possível
function boot() { main(); waitForQuestlog(); checkTroopConfirmation(); }
if (document.readyState === 'loading') {
  // DOMContentLoaded é suficiente — não esperar por load (imagens/css)
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// ── Recebe dados do page_reader (MAIN world) ─────────────────────────────────

window.addEventListener('message', (event) => {
  if (!event.data) return;

  // Mensagens do iframe do painel EOS — validar origem
  const iframeOrigin = EOS_SERVER.replace(/\/$/, '');
  if (event.origin === iframeOrigin) {
    if (event.data.type === 'EOS_SYNC_SCHEDULES') {
      getStorage('eosToken').then(({ eosToken }) => {
        if (eosToken) chrome.runtime.sendMessage({ type: 'SYNC_SCHEDULES', token: eosToken });
      });
      return;
    }

    if (event.data.type === 'EOS_EXTRACT_GROUPS_REQUEST') {
      const world = window.location.hostname.split('.')[0];
      const url = `https://${world}.tribalwars.com.pt/game.php?screen=overview_villages&mode=groups`;
      chrome.storage.local.set({ pendingGroupsExtract: true });
      chrome.runtime.sendMessage({ type: 'CREATE_TAB', url, active: false });
      return;
    }

    if (event.data.type === 'EOS_FORCE_REPORT') {
      getStorage('eosToken', 'eosWorld').then(({ eosToken, eosWorld }) => {
        if (!eosToken || !eosWorld) return;
        const groupId   = event.data.groupId   || '0';
        const groupName = event.data.groupName || 'Todos';
        chrome.storage.local.set({ pendingTroopRequest: true, pendingTroopGroupId: groupId, pendingTroopGroupName: groupName });
        const url = `https://${eosWorld}.tribalwars.com.pt/game.php?screen=place&mode=call`;
        chrome.runtime.sendMessage({ type: 'CREATE_TAB', url, active: false });
      });
      return;
    }
  }

  // Mensagens do page_reader (mesmo window)
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

// Mensagem direta do background (fallback para race condition com storage)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'EOS_TRIGGER_REPORT') return;
  if (!isUnitsPage()) return;
  // Força o flag no storage e relança o fluxo principal
  chrome.storage.local.set({
    pendingTroopRequest:   true,
    pendingTroopGroupId:   msg.groupId   || '0',
    pendingTroopGroupName: msg.groupName || 'Todos'
  }).then(() => runTroopReport());
});

async function runTroopReport() {
  const data = await getStorage('pendingTroopRequest', 'pendingTroopGroupId', 'pendingTroopGroupName', 'eosToken');
  if (!data.pendingTroopRequest || !data.eosToken) return;
  showOverlay('⚔️ A ler tropas...');
  await handleTroopReport(data.pendingTroopGroupId || '0', data.pendingTroopGroupName || 'Todos', data.eosToken);
}
