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
  // Soma as tropas próprias de todas as aldeias (linha "as suas próprias")
  // a partir dos dados per-village já lidos
  // Fallback: tenta #village_troup_list (mass support) ou tabela overview
  const villages = readPerVillageTroops();
  if (villages && villages.length > 0) {
    const totals = {};
    for (const unit of TROOP_NAMES) totals[unit] = 0;
    for (const v of villages) {
      const source = v.troops_own || v.troops_total || {};
      for (const unit of TROOP_NAMES) {
        totals[unit] += source[unit] || 0;
      }
    }
    for (const unit of TROOP_NAMES) { if (!totals[unit]) delete totals[unit]; }
    return Object.keys(totals).length ? totals : null;
  }
  return null;
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

// ── Leitura de tropas por aldeia (via overview_villages) ────────────────────

function readPerVillageTroops(onProgress) {
  const villages = [];
  const table = document.querySelector('#units_table') || document.querySelector('table.vis.overview_table')
    || document.querySelector('#content_value table.vis');
  if (!table) return null;

  // Descobre o mapeamento coluna → unidade a partir do header
  // O header pode ter colunas extra (checkbox, nome aldeia) que não existem nas data rows
  // As data rows têm 1 coluna a menos (sem o checkbox do header)
  const headerRow = table.querySelector('tr');
  if (!headerRow) return null;
  const headerCells = Array.from(headerRow.querySelectorAll('th, td'));

  // Conta quantas colunas "vazias" existem antes da primeira unidade
  // para calcular o offset entre header e data rows
  let firstUnitIdx = -1;
  const unitColMap = []; // { unit, index }
  headerCells.forEach((cell, idx) => {
    const img = cell.querySelector('img[src*="unit_"]');
    if (!img) return;
    if (firstUnitIdx === -1) firstUnitIdx = idx;
    const src = img.getAttribute('src') || '';
    for (const unit of TROOP_NAMES) {
      if (src.includes(`unit_${unit}`)) {
        unitColMap.push({ unit, headerIndex: idx });
        return;
      }
    }
  });
  if (!unitColMap.length) return null;

  // O header tem 13 colunas: [Aldeia][checkbox][spear][sword]...[militia][Ação]
  // Row "as suas próprias" (com link aldeia): 13 cells = [aldeia_link][label][spear][sword]...[militia][Ação]
  // Row "total": 12 cells = [label][spear][sword]...[militia][Ação]
  // A coluna "Ação" é a última. As unidades estão antes dela.
  // Usamos posição reversa: a última coluna (Ação) está em cells.length-1
  // A posição de cada unidade a partir do final é constante
  const headerLen = headerCells.length;
  // Para cada unidade, calcula quantas colunas está do FINAL do header
  for (const entry of unitColMap) {
    entry.fromEnd = headerLen - 1 - entry.headerIndex;
  }

  const allRows = Array.from(table.querySelectorAll('tr'));
  let currentVillage = null;

  function readTroopsFromRow(cells) {
    const troops = {};
    const len = cells.length;
    for (const { unit, fromEnd } of unitColMap) {
      const idx = len - 1 - fromEnd;
      if (idx >= 0 && idx < len) {
        const raw = (cells[idx].textContent || '').replace(/\./g, '').replace(/\s/g, '');
        const v = parseInt(raw.replace(/\D/g, '')) || 0;
        if (v > 0) troops[unit] = v;
      }
    }
    return Object.keys(troops).length > 0 ? troops : null;
  }

  // Conta total de aldeias primeiro (para a barra de progresso)
  let totalVillageCount = 0;
  for (const row of allRows) {
    const firstTd = row.querySelector('td');
    if (firstTd?.querySelector('a[href*="screen=info_village"], a[href*="village="]')) totalVillageCount++;
  }

  let villageIndex = 0;
  for (const row of allRows) {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length < 3) continue;

    // Row com link de aldeia = header de aldeia + "as suas próprias"
    // O link da aldeia está sempre na PRIMEIRA célula da row
    const firstCellLink = cells[0]?.querySelector('a[href*="screen=info_village"], a[href*="village="]');
    if (firstCellLink) {
      villageIndex++;
      if (onProgress) onProgress(villageIndex, totalVillageCount);
      const href = firstCellLink.getAttribute('href') || '';
      const idMatch = href.match(/village=(\d+)/) || href.match(/id=(\d+)/);
      if (idMatch) {
        if (currentVillage && (currentVillage.troops_total || currentVillage.troops_own)) {
          villages.push(currentVillage);
        }
        const text = (firstCellLink.textContent || '').trim();
        const coordMatch = text.match(/\((\d+\|\d+)\)/);
        currentVillage = {
          village_id: idMatch[1],
          village_name: text.replace(/\s*\(\d+\|\d+\)\s*/, '').trim(),
          village_coords: coordMatch ? coordMatch[1] : null,
          troops_total: null,
          troops_own: readTroopsFromRow(cells)
        };
        continue;
      }
    }

    if (!currentVillage) continue;

    // Row "total"
    const firstCell = (cells[0].textContent || '').replace(/\u00a0/g, ' ').trim().toLowerCase();
    if (firstCell === 'total') {
      currentVillage.troops_total = readTroopsFromRow(cells);
    }
  }

  if (currentVillage && (currentVillage.troops_total || currentVillage.troops_own)) {
    villages.push(currentVillage);
  }


  return villages.length > 0 ? villages : null;
}

function waitForOverviewTable() {
  return new Promise((resolve, reject) => {
    const ready = () => {
      const t = document.querySelector('#units_table') || document.querySelector('table.vis.overview_table')
        || document.querySelector('#content_value table.vis');
      return t && t.querySelectorAll('tr').length > 3;
    };
    if (ready()) return resolve();
    const observer = new MutationObserver(() => {
      if (ready()) { observer.disconnect(); resolve(); }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('Timeout overview')); }, 15000);
  });
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
  el.textContent = '';
  const inner = document.createElement('div');
  inner.style.cssText = `background:#1a1a2e;border:2px solid ${color};border-radius:8px;padding:24px 36px;text-align:center;color:${color};font-size:15px;font-weight:bold`;
  inner.textContent = msg;
  el.appendChild(inner);
}

// ── Clique de grupo ──────────────────────────────────────────────────────────

function findGroupsContainer() {
  for (const el of document.querySelectorAll('div, td, span, p')) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && /grupos:/i.test(node.textContent)) {
        return el;
      }
    }
  }
  return null;
}

// Verifica se o grupo já está selecionado
function isGroupAlreadySelected(groupId) {
  const urlGroup = new URLSearchParams(window.location.search).get('group');
  if (groupId === '0') {
    // Na overview_villages, sem group= na URL = "Todos" selecionado
    return !urlGroup || urlGroup === '0';
  }
  return urlGroup === groupId;
}

function findGroupElement(groupId) {
  const scope = findGroupsContainer() || document;

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
    // Polling leve em vez de MutationObserver (findGroupElement é pesado para correr a cada mutação)
    let attempts = 0;
    const check = setInterval(() => {
      const el = findGroupElement(groupId);
      if (el) { clearInterval(check); resolve(el); }
      else if (++attempts > 15) { clearInterval(check); resolve(null); } // 15 * 400ms = 6s
    }, 400);
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
    const { eosToken, eosSubscription, eosTribeName } = await getStorage('eosToken', 'eosSubscription', 'eosTribeName');
    if (!eosToken) { alert('Ainda não autenticado. Aguarda uns segundos e tenta novamente.'); return; }

    // Se já está aberto, fecha
    const existing = document.getElementById('eos-panel-overlay');
    if (existing) { existing.remove(); return; }

    // Verifica subscrição
    const sub = eosSubscription || {};
    if (!sub.active) {
      showSubscriptionOverlay(sub, eosTribeName || '');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'eos-panel-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';

    const container = document.createElement('div');
    container.style.cssText = 'position:relative;width:98vw;max-width:1400px;height:90vh;background:#24201a;border:2px solid #e8502040;border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.8)';

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

  const groupName = (data.pendingTroopConfirmGroupName || 'Todos').replace(/[<>"'&]/g, '');
  const bar = document.createElement('div');
  bar.id = 'eos-troop-confirm';
  bar.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:linear-gradient(135deg,#1a1008,#100c08);border:1px solid #3a2810;border-left:3px solid #e87830;border-radius:8px;padding:14px 18px;font-family:Segoe UI,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.8);max-width:320px';

  const title = document.createElement('div');
  title.style.cssText = 'color:#e8a030;font-weight:700;font-size:13px;margin-bottom:6px';
  title.textContent = '⚔️ Pedido de tropas';

  const desc = document.createElement('div');
  desc.style.cssText = 'color:#b09070;font-size:12px;margin-bottom:12px';
  desc.textContent = `A liderança pede a atualização das tuas tropas (${groupName})`;

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px';

  const acceptBtn = document.createElement('button');
  acceptBtn.id = 'eos-confirm-accept';
  acceptBtn.style.cssText = 'flex:1;padding:7px 0;background:linear-gradient(135deg,#e87830,#c06020);color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:700;cursor:pointer';
  acceptBtn.textContent = 'Aceitar';

  const refuseBtn = document.createElement('button');
  refuseBtn.id = 'eos-confirm-refuse';
  refuseBtn.style.cssText = 'flex:1;padding:7px 0;background:#1a1210;color:#807060;border:1px solid #3a2a1a;border-radius:5px;font-size:12px;cursor:pointer';
  refuseBtn.textContent = 'Recusar';

  btns.appendChild(acceptBtn);
  btns.appendChild(refuseBtn);
  bar.appendChild(title);
  bar.appendChild(desc);
  bar.appendChild(btns);
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
    const villageMatch = window.location.href.match(/village=(\d+)/);
    const vid = villageMatch ? villageMatch[1] : '';
    chrome.runtime.sendMessage({ type: 'CREATE_TAB', url: `https://${eosWorld}.tribalwars.com.pt/game.php?${vid ? `village=${vid}&` : ''}screen=overview_villages&mode=units`, active: false });
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

  // Página de tropas (overview_villages&mode=units): lê agregado + por aldeia
  if (!isUnitsPage()) return;

  const data = await getStorage('pendingTroopRequest', 'pendingTroopGroupId', 'pendingTroopGroupName', 'eosToken');
  if (!data.pendingTroopRequest) return;

  const groupId   = data.pendingTroopGroupId   || '0';
  const groupName = data.pendingTroopGroupName || 'Todos';
  const token     = data.eosToken;

  if (!token) return;

  showOverlay(`⚔️ A preparar (grupo: ${groupName})...`);

  // Passo 1: clica no grupo correto (skip se já está selecionado)
  const groupClicked = sessionStorage.getItem('eos_group_clicked') === groupId;
  if (!groupClicked && !isGroupAlreadySelected(groupId)) {
    showOverlay(`⚔️ A selecionar grupo "${groupName}"...`);
    const el = await waitForGroupElement(groupId);
    if (el) {
      sessionStorage.setItem('eos_group_clicked', groupId);
      el.click(); return;
    }
  }
  sessionStorage.removeItem('eos_group_clicked');

  // Passo 2: clica em [todos] da paginação para ver todas as aldeias
  const pagClicked = sessionStorage.getItem('eos_pagination_clicked') === '1';
  if (!pagClicked) {
    // Espera que a paginação apareça (pode não estar no DOM imediatamente)
    const pagTodos = await new Promise(resolve => {
      const find = () => Array.from(document.querySelectorAll('a.paged-nav-item'))
        .find(a => /todos/i.test(a.textContent.trim())) || null;
      const el = find();
      if (el) return resolve(el);
      let attempts = 0;
      const check = setInterval(() => {
        const el = find();
        if (el) { clearInterval(check); resolve(el); }
        else if (++attempts > 8) { clearInterval(check); resolve(null); } // 8 * 300ms = 2.4s
      }, 300);
    });
    if (pagTodos) {
      showOverlay('⚔️ A carregar todas as páginas...');
      sessionStorage.setItem('eos_pagination_clicked', '1');
      pagTodos.click(); return;
    }
  }
  sessionStorage.removeItem('eos_pagination_clicked');

  showOverlay('⚔️ A aguardar tabela...');

  try {
    await waitForOverviewTable();
    showOverlay('⚔️ A ler aldeias...');

    // Leitura única com progresso
    const villages = readPerVillageTroops((current, total) => {
      showOverlay(`⚔️ A ler aldeias ${current}/${total}`);
    });
    if (!villages || !villages.length) throw new Error('Não foi possível ler a tabela de tropas.');

    showOverlay(`⚔️ A calcular totais (${villages.length} aldeias)...`);

    // Deriva totais agregados (apenas tropas próprias, nunca fallback para total)
    const troops = {};
    for (const unit of TROOP_NAMES) troops[unit] = 0;
    for (const v of villages) {
      const src = v.troops_own || {};
      for (const unit of TROOP_NAMES) troops[unit] += src[unit] || 0;
    }
    for (const unit of TROOP_NAMES) { if (!troops[unit]) delete troops[unit]; }

    // Classifica aldeias
    const classification = { full_nuke: 0, semi_nuke: 0, full_def: 0, semi_def: 0, noble: 0, other: 0 };
    for (const v of villages) {
      const t = v.troops_own || {};
      if ((t['snob'] || 0) >= 1) { classification.noble++; continue; }
      let offPop = 0, defPop = 0;
      for (const u of OFFENSE_UNITS) offPop += (t[u] || 0) * (POP_COST[u] || 0);
      for (const u of DEFENSE_UNITS) defPop += (t[u] || 0) * (POP_COST[u] || 0);
      if      (offPop >= 20000) classification.full_nuke++;
      else if (offPop >= 15000) classification.semi_nuke++;
      else if (defPop >= 20000) classification.full_def++;
      else if (defPop >= 15000) classification.semi_def++;
      else                      classification.other++;
    }

    showOverlay(`⚔️ A enviar dados (${villages.length} aldeias)...`);

    // Envia agregado + por aldeia em paralelo
    const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const promises = [];

    if (Object.keys(troops).length > 0) {
      promises.push(fetch(`${EOS_SERVER}/api/report`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ troops, classification, groupId, groupName })
      }));
    }

    if (villages.length > 0) {
      promises.push(fetch(`${EOS_SERVER}/api/village-troops`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ villages })
      }));
    }

    const results = await Promise.all(promises);
    for (const res of results) {
      if (!res.ok) throw new Error(`Servidor: ${res.status}`);
    }

    await chrome.storage.local.set({ pendingTroopRequest: false });
    showOverlay(`✔ ${villages.length} aldeias guardadas!`, 'ok');
    setTimeout(() => { chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }); window.close(); }, 500);

  } catch (err) {
    await chrome.storage.local.set({ pendingTroopRequest: false });
    showOverlay('❌ ' + err.message, 'error');
    setTimeout(() => { chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }); window.close(); }, 3000);
  }
}

// Arranca o mais cedo possível
// ── Overlay do mapa: escudos em aldeias bunkadas + tooltip ──────────────────

function showSubscriptionOverlay(sub, tribeName) {
  const existing = document.getElementById('eos-sub-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'eos-sub-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const panel = document.createElement('div');
  panel.style.cssText = 'background:linear-gradient(135deg,#2a2018,#1e1a14);border:1px solid #e8502040;border-radius:12px;padding:30px 36px;max-width:420px;text-align:center;color:#f0e0c8;box-shadow:0 12px 48px rgba(0,0,0,0.9)';

  const isExpired = sub.status === 'expired';
  const isNone = !sub.status || sub.status === 'none';
  const isPending = sub.status === 'pending';

  let title = '';
  let message = '';
  let buttonText = '';

  if (isExpired) {
    title = '⏰ Subscrição Expirada';
    message = `A subscrição da tribo <strong style="color:#f8c850">${tribeName}</strong> expirou. Contacta o líder da tribo para renovar.`;
  } else if (isNone) {
    title = '🛡️ Tribo Detetada';
    message = `A tribo <strong style="color:#f8c850">${tribeName}</strong> ainda não tem uma subscrição ativa.`;
    buttonText = 'Ativar Subscrição';
  } else if (isPending) {
    title = '⏳ Pagamento Pendente';
    message = `A subscrição da tribo <strong style="color:#f8c850">${tribeName}</strong> está a aguardar confirmação de pagamento.`;
  }

  panel.innerHTML = `
    <div style="font-size:36px;margin-bottom:12px">${isExpired ? '⏰' : isNone ? '🛡️' : '⏳'}</div>
    <h2 style="font-size:18px;color:#f8c850;margin:0 0 12px;font-weight:700">${title}</h2>
    <p style="font-size:13px;color:#c0b090;line-height:1.6;margin:0 0 20px">${message}</p>
    ${buttonText ? `<button id="eos-subscribe-btn" style="padding:12px 28px;background:linear-gradient(135deg,#e87830,#c06020);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:.5px;box-shadow:0 4px 16px #e8502040">${buttonText}</button>` : ''}
    <div style="margin-top:16px;font-size:11px;color:#807060">Clica fora para fechar</div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Botão de subscrição abre o painel com a página de subscribe
  const subBtn = overlay.querySelector('#eos-subscribe-btn');
  if (subBtn) {
    subBtn.addEventListener('click', async () => {
      overlay.remove();
      const { eosPlayerName, eosWorld, eosTribeName } = await getStorage('eosPlayerName', 'eosWorld', 'eosTribeName');
      const tribe = encodeURIComponent(eosTribeName || tribeName);
      const world = encodeURIComponent(eosWorld || '');
      const player = encodeURIComponent(eosPlayerName || '');
      const url = `${EOS_SERVER}/subscribe?tribe=${tribe}&world=${world}&player=${player}`;

      // Abre no painel (iframe) — mesmo estilo do painel principal
      const panelOverlay = document.createElement('div');
      panelOverlay.id = 'eos-panel-overlay';
      panelOverlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';

      const container = document.createElement('div');
      container.style.cssText = 'position:relative;width:520px;max-width:95vw;height:520px;max-height:85vh;background:#24201a;border:2px solid #e8502040;border-radius:10px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.8)';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;z-index:1;background:none;border:none;color:#c0a060;font-size:20px;cursor:pointer;line-height:1';
      closeBtn.onclick = () => panelOverlay.remove();

      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.style.cssText = 'width:100%;height:100%;border:none';

      panelOverlay.addEventListener('click', (e) => { if (e.target === panelOverlay) panelOverlay.remove(); });

      container.appendChild(closeBtn);
      container.appendChild(iframe);
      panelOverlay.appendChild(container);
      document.body.appendChild(panelOverlay);
    });
  }
}

function isMapPage() {
  return new URLSearchParams(window.location.search).get('screen') === 'map';
}

let mapVillageData = null; // Map<coordKey, villageData>
let mapViewport = null;
let mapOverlayEl = null;
let shieldElements = {}; // coordKey → DOM element
let eosMapEnabled = true;

// Configuração de bunk types (guardada no storage)
// Pop defensiva por unidade: spear=1, sword=1, heavy=6
const DEF_POP = { spear: 1, sword: 1, heavy: 6 };

function calcDefPop(troops) {
  if (!troops) return 0;
  return (troops.spear || 0) * DEF_POP.spear + (troops.sword || 0) * DEF_POP.sword + (troops.heavy || 0) * DEF_POP.heavy;
}

const DEFAULT_BUNK_TYPES = [
  { id: 'light_bunk', name: 'Bunk Leve', color: '#4caf50', minDefPop: 20000, enabled: true },
  { id: 'medium_bunk', name: 'Bunk Médio', color: '#ff9800', minDefPop: 45000, enabled: true },
  { id: 'heavy_bunk', name: 'Bunk Pesado', color: '#f44336', minDefPop: 100000, enabled: true },
];
let bunkTypes = [...DEFAULT_BUNK_TYPES];

function makeShieldElement(color) {
  const el = document.createElement('div');
  el.textContent = '🛡️';
  el.style.cssText = `font-size:10px;line-height:16px;width:16px;height:16px;text-align:center;border-radius:50%;background:${color};box-shadow:0 1px 3px rgba(0,0,0,.5)`;
  return el;
}

function classifyVillageForMap(troopsTotal) {
  if (!troopsTotal) return null;
  const defPop = calcDefPop(troopsTotal);
  // Ranges: leve=[leve.min, medio.min), medio=[medio.min, pesado.min), pesado=[pesado.min, ∞)
  // bunkTypes está ordenado: [leve, médio, pesado]
  // Itera de trás para frente (pesado primeiro) para match do mais exigente
  for (let i = bunkTypes.length - 1; i >= 0; i--) {
    const bt = bunkTypes[i];
    if (!bt.enabled) continue;
    if (defPop >= (bt.minDefPop || 0)) return bt;
  }
  return null;
}

function injectShieldStyles() {
  if (document.getElementById('eos-shield-styles')) return;
  const style = document.createElement('style');
  style.id = 'eos-shield-styles';
  style.textContent = `
    @keyframes eos-float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-3px); }
    }
    .eos-shield-icon {
      animation: eos-float 2s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
}

async function initMapOverlay() {
  if (!isMapPage()) return;
  injectShieldStyles();

  const { eosToken, eosWorld } = await getStorage('eosToken', 'eosWorld');
  if (!eosToken || !eosWorld) return;

  // Carrega definições guardadas
  const { eosBunkTypes, eosMapEnabled: savedEnabled } = await getStorage('eosBunkTypes', 'eosMapEnabled');
  if (savedEnabled === false) eosMapEnabled = false;
  if (Array.isArray(eosBunkTypes) && eosBunkTypes.length > 0) bunkTypes = eosBunkTypes;

  // Observa o popup nativo do TW para injetar dados de tropas
  setupPopupObserver();

  // Injeta botão de settings do mapa
  injectMapSettingsButton();

  // Busca dados da tribo e coloca escudos
  await fetchMapData(eosToken);

  // Retry e inicia tracking
  setTimeout(() => { if (eosMapEnabled) { placeShields(); startShieldTracking(); } }, 2000);

  // Refresh a cada 5 minutos
  setInterval(() => fetchMapData(eosToken), 300000);

}

// ── Painel de definições do mapa ──────────────────────────────────────────

function injectMapSettingsButton() {
  // Espera pelo container de botões do mapa (ao lado do fullscreen)
  const waitBtn = setInterval(() => {
    // Procura a barra de ferramentas do mapa
    const toolbar = document.querySelector('#map_toolbar, .map_toolbar')
      || document.querySelector('#mapbig_container')?.parentElement;
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    clearInterval(waitBtn);

    // Cria botão EOS settings
    const btn = document.createElement('div');
    btn.id = 'eos-map-settings-btn';
    btn.title = 'Eye of Sauron - Definições do Mapa';
    btn.style.cssText = `position:absolute;top:4px;right:4px;width:28px;height:28px;z-index:99999;cursor:pointer;
      background:linear-gradient(135deg,#4a3828,#382818);border:1px solid #e8783050;border-radius:6px;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.4);transition:all .15s`;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e8a030" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#e87830'; btn.style.transform = 'scale(1.1)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#e8502040'; btn.style.transform = ''; });
    btn.addEventListener('click', toggleMapSettingsPanel);
    mapEl.style.position = 'relative';
    mapEl.appendChild(btn);
  }, 500);
}

function toggleMapSettingsPanel() {
  const existing = document.getElementById('eos-map-settings-overlay');
  if (existing) { existing.remove(); return; }

  // Backdrop escuro
  const overlay = document.createElement('div');
  overlay.id = 'eos-map-settings-overlay';
  overlay.style.cssText = `position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.6);
    display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const panel = document.createElement('div');
  panel.id = 'eos-map-settings-panel';
  panel.style.cssText = `width:360px;max-height:60vh;
    background:linear-gradient(135deg,#2a2018,#1e1a14);border:1px solid #e8502040;border-radius:10px;
    font-size:11px;color:#f0e0c8;display:flex;flex-direction:column;overflow:hidden;
    box-shadow:0 12px 48px rgba(0,0,0,0.9),0 0 0 1px #e8502020`;

  panel.innerHTML = `<style>.eos-scroll::-webkit-scrollbar{width:5px}.eos-scroll::-webkit-scrollbar-track{background:#1a1610;border-radius:3px}.eos-scroll::-webkit-scrollbar-thumb{background:#e8502040;border-radius:3px}.eos-scroll::-webkit-scrollbar-thumb:hover{background:#e8783060}</style>` + buildSettingsPanelHTML();
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  attachSettingsEvents(panel);
}

function buildSettingsPanelHTML() {
  const toggleColor = eosMapEnabled ? '#4caf50' : '#555';
  const toggleBg = eosMapEnabled ? 'linear-gradient(135deg,#e87830,#c06020)' : '#302820';

  const unitPng = (u) => chrome.runtime.getURL(`png/unit_${u}.png`);
  let html = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px;border-bottom:1px solid #e8502030;flex-shrink:0">
      <span style="font-size:13px;font-weight:700;color:#f8c850;letter-spacing:.5px;text-transform:uppercase">Definições do Mapa</span>
      <button id="eos-map-toggle" style="width:44px;height:24px;border-radius:12px;border:none;cursor:pointer;
        background:${toggleBg};position:relative;transition:background .3s">
        <div style="width:18px;height:18px;border-radius:50%;background:#f4e8d0;position:absolute;top:3px;
          left:${eosMapEnabled ? '23px' : '3px'};transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>
      </button>
    </div>

    <div style="flex:1;overflow-y:auto;padding:14px" class="eos-scroll">
    <div style="font-size:10px;color:#b09878;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;font-weight:700">
      Tipos de Bunk
    </div>
  `;

  for (let i = 0; i < bunkTypes.length; i++) {
    const bt = bunkTypes[i];
    // Range label
    const nextMin = i < bunkTypes.length - 1 ? bunkTypes[i + 1].minDefPop : null;
    const rangeLabel = nextMin ? `${fmtK(bt.minDefPop)} — ${fmtK(nextMin)}` : `${fmtK(bt.minDefPop)}+`;

    html += `
      <div style="background:linear-gradient(135deg,#322a22,#28221c);border:1px solid #e8502025;border-left:3px solid ${bt.color};
        border-radius:6px;padding:10px 12px;margin-bottom:8px" data-bunk-idx="${i}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <input type="color" value="${bt.color}" data-field="color" data-idx="${i}"
              style="width:24px;height:24px;border:1px solid #e8502030;border-radius:4px;cursor:pointer;background:#1a1a1a;padding:1px">
            <span style="color:#f0e0c8;font-size:13px;font-weight:700">${bt.name}</span>
          </div>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:10px;color:#b09878">
            <input type="checkbox" ${bt.enabled ? 'checked' : ''} data-field="enabled" data-idx="${i}"
              style="accent-color:#e8a030;cursor:pointer">
            Ativo
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="display:flex;align-items:center;gap:3px">
            <img src="${unitPng('spear')}" style="width:18px;height:18px;opacity:.7" title="Lanceiros (1 pop)">
            <img src="${unitPng('sword')}" style="width:18px;height:18px;opacity:.7" title="Espadachins (1 pop)">
            <img src="${unitPng('heavy')}" style="width:18px;height:18px;opacity:.7" title="Cavalaria Pesada (6 pop)">
          </div>
          <span style="font-size:12px;color:#c0b090;font-weight:600">Pop Def ≥</span>
          <input type="number" value="${bt.minDefPop || 0}" data-field="minDefPop" data-idx="${i}" min="0" step="5000"
            style="width:75px;background:#141010;border:1px solid #e8502020;border-radius:4px;color:#f0e0c8;
            font-size:13px;padding:4px 6px;outline:none;text-align:center;font-weight:700">
        </div>
        <div style="font-size:9px;color:#807060;margin-top:5px">Intervalo: ${rangeLabel} pop defensiva</div>
      </div>
    `;
  }

  html += `
    </div>
    <div style="padding:10px 14px;border-top:1px solid #e8502030;flex-shrink:0">
      <button id="eos-save-map-settings" style="width:100%;padding:10px;
        background:linear-gradient(135deg,#e87830,#c06020);color:#fff;border:none;border-radius:6px;
        font-size:13px;font-weight:700;cursor:pointer;letter-spacing:.5px;
        box-shadow:0 2px 12px #e8502040">
        Guardar definições
      </button>
    </div>
  `;

  return html;
}

function attachSettingsEvents(panel) {
  // Toggle EOS
  panel.querySelector('#eos-map-toggle')?.addEventListener('click', () => {
    eosMapEnabled = !eosMapEnabled;
    toggleMapSettingsPanel();
    toggleMapSettingsPanel(); // Re-render
    if (!eosMapEnabled) {
      document.querySelectorAll('[data-eos-shield]').forEach(el => el.remove());
      shieldElements = {};
    } else {
      placeShields();
    }
  });

  // Color/name/enabled/minDefPop changes
  panel.querySelectorAll('[data-idx]').forEach(input => {
    const idx = parseInt(input.dataset.idx);
    if (input.dataset.field === 'color') {
      input.addEventListener('input', () => { bunkTypes[idx].color = input.value; });
    } else if (input.dataset.field === 'name') {
      input.addEventListener('input', () => { bunkTypes[idx].name = input.value; });
    } else if (input.dataset.field === 'enabled') {
      input.addEventListener('change', () => { bunkTypes[idx].enabled = input.checked; });
    } else if (input.dataset.field === 'minDefPop') {
      input.addEventListener('change', () => { bunkTypes[idx].minDefPop = parseInt(input.value) || 0; });
    }
  });


  // Save
  panel.querySelector('#eos-save-map-settings')?.addEventListener('click', async () => {
    await chrome.storage.local.set({ eosBunkTypes: bunkTypes, eosMapEnabled });
    // Recria escudos com novas definições
    document.querySelectorAll('[data-eos-shield]').forEach(el => el.remove());
    shieldElements = {};
    if (eosMapEnabled) placeShields();
    document.getElementById('eos-map-settings-overlay')?.remove();
  });
}

async function fetchMapData(token) {
  try {
    const res = await fetch(`${EOS_SERVER}/api/village-troops?tribe=true`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const { villages } = await res.json();
    mapVillageData = new Map();
    for (const v of (villages || [])) {
      if (v.village_coords) {
        mapVillageData.set(v.village_coords, v);
      }
    }
    placeShields();
  } catch (_) {}
}

function getMapCenter() {
  const mapEl = document.getElementById('map');
  if (mapEl) {
    // page_reader escreve data-eos-cx e data-eos-cy
    const cx = parseInt(mapEl.getAttribute('data-eos-cx'));
    const cy = parseInt(mapEl.getAttribute('data-eos-cy'));
    if (cx > 0 && cy > 0) return [cx, cy];
  }
  // Fallback: hash da URL
  const hash = window.location.hash.replace('#', '');
  const hp = hash.split(';');
  if (hp.length === 2) {
    const cx = parseInt(hp[0]);
    const cy = parseInt(hp[1]);
    if (cx > 0 && cy > 0) return [cx, cy];
  }
  return null;
}

function placeShields() {
  if (!mapVillageData || mapVillageData.size === 0 || !eosMapEnabled) return;

  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  // Classifica aldeias por bunk type
  const bunkeredMap = new Map();
  for (const [coords, v] of mapVillageData) {
    const bt = classifyVillageForMap(v.troops_total);
    if (bt) bunkeredMap.set(coords, bt);
  }
  if (bunkeredMap.size === 0) return;

  // Lê mapeamento coord→id do page_reader
  const villageMapStr = mapEl.getAttribute('data-eos-villages');
  if (!villageMapStr) return;
  let villageIds;
  try { villageIds = JSON.parse(villageMapStr); } catch (_) { return; }

  // coord → TWMap.villages[id] → #map_village_${id} → posiciona escudo
  for (const [coordKey, bt] of bunkeredMap) {
    const vid = villageIds[coordKey];
    if (!vid) continue;

    const domVillage = document.getElementById('map_village_' + vid);
    if (!domVillage) continue;

    // Skip se já tem escudo neste sector para esta coordenada
    if (domVillage.parentNode.querySelector(`[data-eos-shield="${coordKey}"]`)) continue;

    const top = parseInt(domVillage.style.top, 10) || 0;
    const left = parseInt(domVillage.style.left, 10) || 0;

    const shield = makeShieldElement(bt.color);
    shield.dataset.eosShield = coordKey;
    shield.title = bt.name + ' (' + coordKey + ')';
    shield.className = 'eos-shield-icon';
    const delay = (Math.random() * 2).toFixed(1);
    shield.style.cssText += `;position:absolute;pointer-events:none;z-index:20;left:${left + 19}px;top:${top - 6}px;animation-delay:${delay}s`;
    domVillage.parentNode.insertBefore(shield, domVillage);
  }
}

function startShieldTracking() {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  // Primeiro render
  placeShields();

  // Observer: quando o TW adiciona/remove sectors (pan), adiciona escudos nos novos
  const container = document.getElementById('map_container');
  if (container) {
    let debounce = null;
    const obs = new MutationObserver(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(placeShields, 300);
    });
    obs.observe(container, { childList: true, subtree: true });
  }

  // Fallback periódico
  setInterval(placeShields, 5000);
}

function setupPopupObserver() {
  // Observa o popup nativo #map_popup para injetar dados de tropas
  const EOS_TROOP_ROW_ID = 'eos-troop-info';

  function injectTroopInfo() {
    if (!mapVillageData || mapVillageData.size === 0) return;

    const popup = document.getElementById('map_popup');
    if (!popup || popup.style.display === 'none') return;

    // Já injetámos?
    if (popup.querySelector('#' + EOS_TROOP_ROW_ID)) return;

    // Extrai coordenadas do titulo do popup (ex: "045 NÃO SEJAS SAPO (568|475) K45")
    const header = popup.querySelector('th');
    if (!header) return;
    const coordMatch = header.textContent.match(/\((\d+\|\d+)\)/);
    if (!coordMatch) return;
    const coordKey = coordMatch[1];

    const v = mapVillageData.get(coordKey);
    if (!v) return;

    const t = v.troops_total || {};
    const units = ['spear','sword','axe','spy','light','heavy','ram','catapult','snob'];
    const bt = classifyVillageForMap(t);

    // Cria a row de tropas
    const tbody = popup.querySelector('#info_content tbody');
    if (!tbody) return;

    const troopRow = document.createElement('tr');
    troopRow.id = EOS_TROOP_ROW_ID;

    const td = document.createElement('td');
    td.colSpan = 2;
    td.style.cssText = 'padding:4px 0;border-top:1px solid #ddd';

    // Badge do tipo de bunk
    let badgeHtml = '';
    if (bt) {
      badgeHtml = `<div style="display:inline-block;background:${bt.color};color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;margin-bottom:3px">${bt.name}</div><br>`;
    }

    // Tabela de tropas compacta com PNGs
    let troopHtml = '<table style="border-collapse:collapse;width:100%;margin-top:2px"><tr>';
    for (const u of units) {
      troopHtml += `<td style="text-align:center;padding:1px"><img src="/graphic/unit/unit_${u}.png" style="width:14px;height:14px;vertical-align:middle" title="${u}"></td>`;
    }
    troopHtml += '</tr><tr>';
    for (const u of units) {
      const val = t[u] || 0;
      troopHtml += `<td style="text-align:center;font-size:10px;font-weight:600;color:${val > 0 ? '#000' : '#bbb'};padding:1px">${val > 0 ? fmtK(val) : '-'}</td>`;
    }
    troopHtml += '</tr></table>';

    // Info do jogador e atualização
    const updatedAgo = v.updated_at ? timeAgoShort(v.updated_at) : '?';
    const ownerHtml = `<div style="font-size:9px;color:#888;margin-top:2px">👁 ${v.player_name} · atualizado ${updatedAgo}</div>`;

    td.innerHTML = badgeHtml + troopHtml + ownerHtml;
    troopRow.appendChild(td);
    tbody.appendChild(troopRow);
  }

  function timeAgoShort(iso) {
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 2) return 'agora';
    if (min < 60) return min + 'm';
    const h = Math.floor(min / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }

  // Observa document.body para apanhar quando o popup aparece/muda
  let lastPopupCoord = '';
  const obs = new MutationObserver(() => {
    const popup = document.getElementById('map_popup');
    if (!popup || popup.offsetHeight === 0) return;

    const th = popup.querySelector('th');
    if (!th) return;
    const coordMatch = th.textContent.match(/\((\d+\|\d+)\)/);
    if (!coordMatch) return;

    // Só injeta se mudou de aldeia ou ainda não tem a nossa row
    const coord = coordMatch[1];
    if (coord === lastPopupCoord && popup.querySelector('#' + EOS_TROOP_ROW_ID)) return;
    lastPopupCoord = coord;

    // Remove anterior e injeta
    const old = popup.querySelector('#' + EOS_TROOP_ROW_ID);
    if (old) old.remove();

    requestAnimationFrame(injectTroopInfo);
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

function fmtK(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
  return String(n);
}

function boot() { main(); waitForQuestlog(); checkTroopConfirmation(); initMapOverlay(); }
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
        const villageMatch = window.location.href.match(/village=(\d+)/);
        const vid = villageMatch ? villageMatch[1] : '';
        const url = `https://${eosWorld}.tribalwars.com.pt/game.php?${vid ? `village=${vid}&` : ''}screen=overview_villages&mode=units`;
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
  // Relança o fluxo principal — main() já lida com todo o fluxo de grupo/paginação/leitura
  await main();
}
