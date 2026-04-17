// content.js — cliente mínimo
// Só lê o DOM do TW e comunica com o servidor. Sem lógica de negócio.

const EOS_SERVER = 'https://eos-server-sooty.vercel.app';

// ── Mundo atual (extraído do hostname, ex: "pt111") ─────────────────────────
const CURRENT_WORLD = window.location.hostname.split('.')[0];

// ── Config remota (fetched do servidor, cache local) ────────────────────────
// Fallback defaults caso o servidor não responda na primeira carga
const DEFAULT_CONFIG = {
  version: 0,
  selectors: {
    villageUnitsTable: '#units_table, table.vis.overview_table, #content_value table.vis',
    villageLink:       'a[href*="screen=info_village"], a[href*="village="]',
    paginationTodos:   'a.paged-nav-item',
    reportContent:     '#content_value',
    reportAttBlock:    '#attack_info_att, #attack_info_attacker',
    reportDefBlock:    '#attack_info_def, #attack_info_defender',
    reportAttUnits:    '#attack_info_att_units',
    reportDefUnits:    '#attack_info_def_units',
    reportSpyAway:     '#attack_spy_away, #attack_spy_away_units, #attack_info_away',
    reportBuildings:   '#attack_spy_building_data, #attack_info_building',
    mapContainer:      '#map_container',
    mapElement:        '#map',
    mapPopup:          '#map_popup',
    mapPopupHeader:    '#map_popup th',
    mapPopupTbody:     '#map_popup #info_content tbody',
    groupSelect:       'select#group_id, select[name="group_id"]',
    groupMenuItem:     'span.group-menu-item',
    placeForm:         'form#command-data-form, form[action*="place"]',
    questlog:          '#questlog_new',
  },
  thresholds: {
    ally:  { light: 20000, medium: 45000, heavy: 100000 },
    enemy: { weak: 1, light: 3000, medium: 10000, heavy: 20000 },
    fullNukePop: 17000, semiNukePop: 10000, fullDefPop: 17000, semiDefPop: 10000,
  },
  unitPop: {
    def: { spear: 1, sword: 1, heavy: 6 },
    off: { axe: 1, light: 4, ram: 5, catapult: 8, marcher: 5 },
    all: { spear:1, sword:1, axe:1, archer:1, spy:2, light:4, marcher:5, heavy:6, ram:5, catapult:8, knight:10, snob:100 },
  },
  urls: {
    villageTxt:    'https://{world}.tribalwars.com.pt/map/village.txt',
    allyTxt:       'https://{world}.tribalwars.com.pt/map/ally.txt',
    overviewUnits: 'https://{world}.tribalwars.com.pt/game.php?screen=overview_villages&mode=units',
    placeCall:     'https://{world}.tribalwars.com.pt/game.php?screen=place&mode=call&target={targetVid}',
  },
  intervals: {
    mapDataRefreshMs:      5 * 60 * 1000,
    enemyReportsRefreshMs: 5 * 60 * 1000,
    configRefreshMs:       30 * 60 * 1000,
  },
  features: { enemyReports: true, supportRequests: true, mapShields: true, autoSyncReports: false },
};

let EOS_CONFIG = DEFAULT_CONFIG;

async function loadCachedConfig() {
  try {
    const { eosConfig, eosConfigTime } = await chrome.storage.local.get(['eosConfig', 'eosConfigTime']);
    if (eosConfig && eosConfig.version) {
      EOS_CONFIG = eosConfig;
      // Refresh em background se for antigo
      if (!eosConfigTime || Date.now() - eosConfigTime > EOS_CONFIG.intervals.configRefreshMs) {
        fetchRemoteConfig();
      }
      return;
    }
  } catch (_) {}
  // Primeira carga: tenta ir buscar já
  fetchRemoteConfig();
}

async function fetchRemoteConfig() {
  try {
    const res = await fetch(`${EOS_SERVER}/api/extension-config`, { cache: 'no-store' });
    if (!res.ok) return;
    const cfg = await res.json();
    if (cfg && cfg.version) {
      EOS_CONFIG = cfg;
      await chrome.storage.local.set({ eosConfig: cfg, eosConfigTime: Date.now() });
      console.log('[EOS] Config atualizada, version:', cfg.version);
    }
  } catch (e) { console.warn('[EOS] Falha a carregar config:', e); }
}

// Helper: resolve URL template com {world}, {targetVid}, etc.
function eosUrl(key, vars = {}) {
  let url = EOS_CONFIG.urls[key] || '';
  url = url.replace('{world}', CURRENT_WORLD);
  for (const [k, v] of Object.entries(vars)) url = url.replace(`{${k}}`, v);
  return url;
}

// Helper: resolve config selector. Se tem vírgulas, tenta cada um EM ORDEM
// (não usa querySelector com lista porque isso retorna o primeiro na DOM, não o primeiro selector)
function eosSel(key, root) {
  const s = EOS_CONFIG.selectors[key];
  if (!s) return null;
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  const r = root || document;
  for (const p of parts) {
    const el = r.querySelector(p);
    if (el) return el;
  }
  return null;
}

function eosSelAll(key, root) {
  const s = EOS_CONFIG.selectors[key];
  if (!s) return [];
  return Array.from((root || document).querySelectorAll(s));
}

// ═════════════════════════════════════════════════════════════════════════════
// RECIPE EXECUTOR
// Interpreta recipes JSON enviadas do servidor para extrair dados do DOM.
// Formato documentado em eos-server/RECIPES.md
// ═════════════════════════════════════════════════════════════════════════════

const RECIPE_BUILTIN_FNS = {};  // funções complexas que permanecem em código

function registerRecipeFn(name, fn) { RECIPE_BUILTIN_FNS[name] = fn; }

function runRecipe(recipe, initialVars) {
  const vars = { ...(initialVars || {}) };
  const ctx = { vars, returned: null, hasReturned: false };
  try {
    if (Array.isArray(recipe?.steps)) runRecipeSteps(recipe.steps, ctx);
  } catch (e) {
    console.error('[EOS recipe]', recipe?.name || '?', 'erro:', e);
  }
  return ctx.hasReturned ? ctx.returned : null;
}

function runRecipeSteps(steps, ctx) {
  for (const step of steps) {
    if (ctx.hasReturned) return;
    runRecipeStep(step, ctx);
  }
}

function resolveValue(val, vars) {
  if (val == null) return val;
  if (typeof val === 'string') {
    if (val.startsWith('$')) {
      const path = val.slice(1).split('.');
      let v = vars[path[0]];
      for (let i = 1; i < path.length && v != null; i++) v = v[path[i]];
      return v;
    }
    return val;
  }
  if (Array.isArray(val)) return val.map(x => resolveValue(x, vars));
  if (typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = resolveValue(v, vars);
    return out;
  }
  return val;
}

function evalCondition(cond, vars) {
  if (!cond) return false;
  if (cond.has !== undefined) {
    const v = resolveValue(cond.has, vars);
    return v != null && !(Array.isArray(v) && v.length === 0);
  }
  if (cond.missing !== undefined) {
    const v = resolveValue(cond.missing, vars);
    return v == null;
  }
  if (cond.equals) {
    return resolveValue(cond.equals.a, vars) === resolveValue(cond.equals.b, vars);
  }
  if (cond.matches) {
    const v = String(resolveValue(cond.matches.value, vars) || '');
    try { return new RegExp(cond.matches.regex, cond.matches.flags || '').test(v); }
    catch { return false; }
  }
  if (cond.and) return cond.and.every(c => evalCondition(c, vars));
  if (cond.or)  return cond.or.some(c => evalCondition(c, vars));
  if (cond.not) return !evalCondition(cond.not, vars);
  return false;
}

// Resolve string de selector (suporta múltiplos por vírgula, tenta em ordem)
function queryFirst(selector, root) {
  const parts = String(selector).split(',').map(s => s.trim()).filter(Boolean);
  const r = root || document;
  for (const p of parts) {
    try { const el = r.querySelector(p); if (el) return el; } catch {}
  }
  return null;
}

function runRecipeStep(step, ctx) {
  const { vars } = ctx;

  switch (step.op) {
    case 'select': {
      const root = step.from ? resolveValue(step.from, vars) : document;
      if (root) vars[step.as] = queryFirst(step.selector, root);
      else vars[step.as] = null;
      return;
    }

    case 'selectAll': {
      const root = step.from ? resolveValue(step.from, vars) : document;
      if (!root) { vars[step.as] = []; return; }
      const parts = String(step.selector).split(',').map(s => s.trim()).filter(Boolean);
      // selectAll: junta resultados de todos os selectors
      const seen = new Set();
      const out = [];
      for (const p of parts) {
        try {
          for (const el of root.querySelectorAll(p)) {
            if (!seen.has(el)) { seen.add(el); out.push(el); }
          }
        } catch {}
      }
      vars[step.as] = out;
      return;
    }

    case 'set': {
      vars[step.as] = resolveValue(step.value, vars);
      return;
    }

    case 'extractText': {
      const el = resolveValue(step.from, vars);
      const text = el ? (el.textContent || '') : '';
      if (step.regex) {
        try {
          const m = text.match(new RegExp(step.regex, step.flags || ''));
          vars[step.as] = m ? (step.group != null ? m[step.group] : m[0]) : null;
        } catch { vars[step.as] = null; }
      } else {
        vars[step.as] = text.trim();
      }
      return;
    }

    case 'extractAttr': {
      const el = resolveValue(step.from, vars);
      const attr = el ? (el.getAttribute(step.attr) || '') : '';
      if (step.regex) {
        try {
          const m = attr.match(new RegExp(step.regex, step.flags || ''));
          vars[step.as] = m ? (step.group != null ? m[step.group] : m[0]) : null;
        } catch { vars[step.as] = null; }
      } else {
        vars[step.as] = attr;
      }
      return;
    }

    case 'if': {
      if (evalCondition(step.cond, vars)) {
        if (step.then) runRecipeSteps(step.then, ctx);
      } else if (step.else) {
        runRecipeSteps(step.else, ctx);
      }
      return;
    }

    case 'forEach': {
      const arr = resolveValue(step.in, vars) || [];
      for (const item of arr) {
        vars[step.as] = item;
        if (step.do) runRecipeSteps(step.do, ctx);
        if (ctx.hasReturned) return;
      }
      return;
    }

    case 'append': {
      const arr = resolveValue(step.to, vars);
      if (Array.isArray(arr)) arr.push(resolveValue(step.value, vars));
      return;
    }

    case 'setKey': {
      const obj = resolveValue(step.on, vars);
      if (obj && typeof obj === 'object') obj[step.key] = resolveValue(step.value, vars);
      return;
    }

    case 'call': {
      const fn = RECIPE_BUILTIN_FNS[step.fn];
      if (typeof fn === 'function') {
        const args = (step.args || []).map(a => resolveValue(a, vars));
        try { vars[step.as] = fn.apply(null, args); }
        catch (e) { console.error('[EOS recipe] call', step.fn, 'falhou:', e); vars[step.as] = null; }
      } else {
        console.warn('[EOS recipe] função não registada:', step.fn);
        vars[step.as] = null;
      }
      return;
    }

    case 'return': {
      ctx.returned = resolveValue(step.value, vars);
      ctx.hasReturned = true;
      return;
    }

    default:
      console.warn('[EOS recipe] operação desconhecida:', step.op);
  }
}

// Carrega config imediatamente
loadCachedConfig();

function wk(key) { return `eos.${CURRENT_WORLD}.${key}`; }

// Lê chaves world-scoped do storage
async function getWorldStorage(...keys) {
  const mapped = keys.map(k => wk(k));
  const data = await chrome.storage.local.get(mapped);
  const result = {};
  for (const k of keys) {
    result[k] = data[wk(k)] ?? null;
  }
  return result;
}

// Escreve chaves world-scoped no storage
async function setWorldStorage(obj) {
  const mapped = {};
  for (const [k, v] of Object.entries(obj)) {
    mapped[wk(k)] = v;
  }
  await chrome.storage.local.set(mapped);
}

// ── Utilitários ──────────────────────────────────────────────────────────────

function isUnitsPage() {
  const p = new URLSearchParams(window.location.search);
  return p.get('screen') === 'overview_villages' && p.get('mode') === 'units';
}

function isGroupsPage() {
  const p = new URLSearchParams(window.location.search);
  return p.get('screen') === 'overview_villages' && p.get('mode') === 'groups';
}

function isReportPage() {
  const p = new URLSearchParams(window.location.search);
  return p.get('screen') === 'report' && !!p.get('view');
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

    if      (offPop >= EOS_CONFIG.thresholds.fullNukePop) result.full_nuke++;
    else if (offPop >= EOS_CONFIG.thresholds.semiNukePop) result.semi_nuke++;
    else if (defPop >= EOS_CONFIG.thresholds.fullDefPop)  result.full_def++;
    else if (defPop >= EOS_CONFIG.thresholds.semiDefPop)  result.semi_def++;
    else                      result.other++;
  });

  return result;
}

// ── Leitura de tropas por aldeia (via overview_villages) ────────────────────

function readPerVillageTroops(onProgress) {
  const villages = [];
  const table = eosSel('villageUnitsTable');
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
    return troops;
  }

  // Helper: devolve o link da aldeia olhando as primeiras 2 células
  function findVillageLink(cells) {
    for (let i = 0; i < Math.min(2, cells.length); i++) {
      const a = cells[i]?.querySelector('a[href*="screen=info_village"], a[href*="village="]');
      if (a) return a;
    }
    return null;
  }

  // Conta total de aldeias primeiro (para a barra de progresso)
  let totalVillageCount = 0;
  for (const row of allRows) {
    const cells = Array.from(row.querySelectorAll('td'));
    if (findVillageLink(cells)) totalVillageCount++;
  }

  let villageIndex = 0;
  for (const row of allRows) {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length < 3) continue;

    // Row com link de aldeia = header de aldeia + "as suas próprias"
    // Procura nas 2 primeiras células (algumas variantes têm checkbox antes do link)
    const firstCellLink = findVillageLink(cells);
    if (firstCellLink) {
      villageIndex++;
      if (onProgress) onProgress(villageIndex, totalVillageCount);
      const href = firstCellLink.getAttribute('href') || '';
      const idMatch = href.match(/village=(\d+)/) || href.match(/id=(\d+)/);
      if (idMatch) {
        if (currentVillage) {
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

  console.log(`[EOS troops] scan: ${villages.length}/${totalVillageCount} aldeias processadas`);
  if (villages.length < totalVillageCount) {
    console.warn('[EOS troops] ⚠ algumas aldeias não foram lidas. allRows:', allRows.length);
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
  // Se há recipe, usa-o (Phase 2). Senão cai no código JS legado.
  const recipe = EOS_CONFIG.recipes?.extractTWGroups;
  let raw;
  if (recipe) {
    raw = runRecipe(recipe) || [];
  } else {
    raw = [];
    const sel = document.querySelector('select#group_id, select[name="group_id"]');
    if (sel) Array.from(sel.options).filter(o => o.value && o.value!=='0').forEach(o => raw.push({ id: o.value, name: o.text }));
    document.querySelectorAll('span.group-menu-item').forEach(span => {
      const m = (span.getAttribute('onclick')||'').match(/\b(\d+)\b/);
      if (m) raw.push({ id: m[1], name: span.textContent });
    });
    document.querySelectorAll('a[href*="group="]').forEach(a => {
      const m = (a.getAttribute('href')||'').match(/[?&]group=(\d+)/);
      const name = a.textContent.trim();
      if (m && name.length > 2) raw.push({ id: m[1], name });
    });
  }

  // Dedup e validação (fica em código — mais simples que fazer no recipe)
  const seen = new Set(); const groups = [];
  for (const g of raw) {
    const sid = String(g.id || ''); const n = (g.name || '').trim();
    if (!sid || sid === '0' || seen.has(sid) || !n) continue;
    seen.add(sid); groups.push({ id: sid, name: n });
  }
  return groups.length ? groups : null;
}

// ── Overlay ──────────────────────────────────────────────────────────────────

function showOverlay(msg, type = 'info', progress = -1) {
  // Keyframes de fogo/brasa (inject once)
  if (!document.getElementById('eos-overlay-fx')) {
    const st = document.createElement('style');
    st.id = 'eos-overlay-fx';
    st.textContent = `
      @keyframes eos-ember-rise { 0%{transform:translateY(0) scale(1);opacity:.9} 100%{transform:translateY(-140px) scale(.2);opacity:0} }
      @keyframes eos-flame-flicker { 0%,100%{filter:brightness(1) hue-rotate(0deg)} 50%{filter:brightness(1.25) hue-rotate(-6deg)} }
      @keyframes eos-glow-border { 0%,100%{box-shadow:0 0 0 1px #e8502060,0 0 24px rgba(232,120,48,.4),0 8px 32px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,180,80,.15)} 50%{box-shadow:0 0 0 1px #f0a03080,0 0 36px rgba(240,160,48,.55),0 8px 32px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,200,120,.25)} }
      @keyframes eos-bar-shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
      @keyframes eos-eye-pulse { 0%,100%{text-shadow:0 0 12px rgba(232,120,48,.6)} 50%{text-shadow:0 0 24px rgba(255,180,80,.9),0 0 8px rgba(255,200,120,.7)} }
    `;
    document.head.appendChild(st);
  }

  let el = document.getElementById('eos-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'eos-overlay';
    el.style.cssText = `position:fixed;inset:0;
      background:radial-gradient(ellipse at center,rgba(40,16,8,.82),rgba(0,0,0,.88));
      display:flex;align-items:center;justify-content:center;z-index:2147483647;
      font-family:Segoe UI,sans-serif;backdrop-filter:blur(2px)`;
    document.body.appendChild(el);
  }

  const accent = type==='error' ? '#e05050' : type==='ok' ? '#6fcf6f' : '#f0a030';
  const flameBot = type==='error' ? '#c03030' : type==='ok' ? '#3a9a3a' : '#c06020';
  el.textContent = '';

  // Wrapper com brasas animadas
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:420px;max-width:92vw';

  // Brasas (emberów) atrás do card
  const emberContainer = document.createElement('div');
  emberContainer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:14px';
  for (let i = 0; i < 8; i++) {
    const ember = document.createElement('div');
    const sz = 2 + Math.random() * 4;
    const delay = Math.random() * 3;
    const dur = 2 + Math.random() * 2;
    const left = 10 + Math.random() * 80;
    ember.style.cssText = `position:absolute;bottom:-10px;left:${left}%;
      width:${sz}px;height:${sz}px;border-radius:50%;
      background:radial-gradient(circle,${accent},${flameBot}00);
      box-shadow:0 0 6px ${accent};
      animation:eos-ember-rise ${dur}s ease-in ${delay}s infinite`;
    emberContainer.appendChild(ember);
  }
  wrap.appendChild(emberContainer);

  const inner = document.createElement('div');
  inner.style.cssText = `position:relative;
    background:
      radial-gradient(ellipse at 50% 0%, ${accent}18, transparent 60%),
      linear-gradient(180deg,#2a1a10 0%,#1a0f08 100%);
    border:1px solid ${accent}60;border-radius:14px;padding:28px 36px;
    text-align:center;color:#f4e0c0;font-size:15px;font-weight:700;
    animation:eos-glow-border 3s ease-in-out infinite`;

  // Glyph temático
  const eye = document.createElement('div');
  eye.textContent = type === 'error' ? '⚠' : type === 'ok' ? '✔' : '🔥';
  eye.style.cssText = `font-size:34px;margin-bottom:10px;color:${accent};
    animation:eos-eye-pulse 2s ease-in-out infinite,eos-flame-flicker 1.8s ease-in-out infinite`;
  inner.appendChild(eye);

  const txt = document.createElement('div');
  txt.textContent = msg;
  txt.style.cssText = `color:#f4e0c0;font-size:15px;font-weight:600;letter-spacing:.3px;
    text-shadow:0 1px 4px rgba(0,0,0,.6),0 0 8px ${accent}30`;
  inner.appendChild(txt);

  // Barra de progresso com flame
  if (progress >= 0) {
    const p = Math.min(Math.max(progress, 0), 100);
    const barBg = document.createElement('div');
    barBg.style.cssText = `margin-top:18px;height:10px;background:#100806;
      border-radius:5px;overflow:hidden;border:1px solid #3a2418;
      box-shadow:inset 0 2px 4px rgba(0,0,0,.6)`;
    const barFill = document.createElement('div');
    barFill.style.cssText = `height:100%;width:${p}%;position:relative;
      background:linear-gradient(90deg,#c04010,${accent},#ffd060);
      box-shadow:0 0 12px ${accent}cc,inset 0 1px 0 rgba(255,220,160,.5);
      transition:width .4s cubic-bezier(.4,0,.2,1);border-radius:5px`;
    // Overlay shimmer
    const shimmer = document.createElement('div');
    shimmer.style.cssText = `position:absolute;inset:0;
      background:linear-gradient(90deg,transparent,rgba(255,240,200,.4),transparent);
      background-size:200% 100%;
      animation:eos-bar-shimmer 1.4s linear infinite`;
    barFill.appendChild(shimmer);
    barBg.appendChild(barFill);
    inner.appendChild(barBg);

    const pct = document.createElement('div');
    pct.style.cssText = `margin-top:8px;font-size:11px;color:${accent};
      font-weight:800;letter-spacing:2px;text-transform:uppercase;
      font-variant-numeric:tabular-nums`;
    pct.textContent = `${Math.round(p)}%`;
    inner.appendChild(pct);
  }

  wrap.appendChild(inner);
  el.appendChild(wrap);
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

// Verifica se o grupo já está selecionado (URL + DOM)
function isGroupAlreadySelected(groupId) {
  const urlGroup = new URLSearchParams(window.location.search).get('group');
  // URL explícita ganha prioridade
  if (urlGroup) return urlGroup === groupId;
  // Sem group= na URL → verifica o DOM (o TW pode ter grupo selecionado por sessão)
  // Se groupId é '0' e há elemento com classe ativa doutro grupo, NÃO está selecionado
  if (groupId === '0') {
    // Procura o link "Todos" e vê se está ativo (class selected/active)
    const scope = findGroupsContainer() || document;
    const todosLink = scope.querySelector('a[href*="group=0"], a[href*="mode=units"]:not([href*="group="])');
    if (todosLink && /selected|active/i.test(todosLink.className)) return true;
    // Se há outro grupo com class active/selected, não está em "Todos"
    const anyActive = scope.querySelector('a.selected, a.active, a[class*="selected"], a[class*="active"]');
    if (anyActive && !/group=0/.test(anyActive.getAttribute('href') || '')) return false;
    // Sem pistas claras — assume não selecionado para forçar click em Todos
    return false;
  }
  return false;
}

function findGroupElement(groupId) {
  const scope = findGroupsContainer() || document;

  if (groupId === '0') {
    // "Todos" pode ter várias formas no TW: group=0, group_id=0, sem group=, ou texto "Todos"
    return scope.querySelector('a[href*="group=0"]')
        || scope.querySelector('a[href*="group_id=0"]')
        || scope.querySelector('a[href*="mode=units"]:not([href*="group="])')
        || scope.querySelector('a[href*="mode=call"]:not([href*="group="])')
        || (() => {
             // Fallback: procura link com texto "Todos" na zona de grupos
             for (const a of scope.querySelectorAll('a')) {
               if (/^\s*todos\s*$/i.test(a.textContent)) return a;
             }
             return null;
           })()
        || null;
  }

  return scope.querySelector(`a[href*="group=${groupId}"]`)
      || scope.querySelector(`a[href*="group_id=${groupId}"]`)
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
    const { token: eosToken, subscription: eosSubscription, tribeName: eosTribeName } = await getWorldStorage('token', 'subscription', 'tribeName');
    if (!eosToken) { alert('Ainda não autenticado. Aguarda uns segundos e tenta novamente.'); return; }

    // Se já está aberto, fecha
    const existing = document.getElementById('eos-panel-overlay');
    if (existing) { existing.remove(); return; }
    const existingSub = document.getElementById('eos-sub-overlay');
    if (existingSub) { existingSub.remove(); return; }

    // Nome da tribo: apenas do storage (guardado pelo page_reader → background)
    const tribe = eosTribeName || '';

    // Verifica versão obrigatória
    const { eosOutdated, eosUpdateVersion, eosUpdateUrl } = await getStorage('eosOutdated', 'eosUpdateVersion', 'eosUpdateUrl');
    if (eosOutdated) {
      showUpdateRequiredOverlay(eosUpdateVersion || '', eosUpdateUrl || '');
      return;
    }

    // Verifica subscrição
    const sub = eosSubscription || {};
    if (!sub.active) {
      showSubscriptionOverlay(sub, tribe);
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'eos-panel-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:transparent;display:flex;align-items:center;justify-content:center';

    const container = document.createElement('div');
    container.style.cssText = 'position:relative;width:98vw;max-width:1400px;height:90vh;background:#24201a;border:2px solid #e85020;border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.6)';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;z-index:1;background:none;border:none;color:#c0a060;font-size:20px;cursor:pointer;line-height:1';
    closeBtn.onclick = () => overlay.remove();

    const iframe = document.createElement('iframe');
    iframe.src = `${EOS_SERVER}/panel?token=${eosToken}&v=${chrome.runtime.getManifest().version}`;
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
  const data = await getWorldStorage('pendingTroopConfirm', 'pendingTroopConfirmGroupId', 'pendingTroopConfirmGroupName');
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
    await setWorldStorage({ pendingTroopConfirm: false });
    bar.remove();
    await setWorldStorage({
      pendingTroopRequest: true,
      pendingTroopGroupId: data.pendingTroopConfirmGroupId || '0',
      pendingTroopGroupName: groupName
    });
    const villageMatch = window.location.href.match(/village=(\d+)/);
    const vid = villageMatch ? villageMatch[1] : '';
    chrome.runtime.sendMessage({ type: 'CREATE_TAB', url: `https://${CURRENT_WORLD}.tribalwars.com.pt/game.php?${vid ? `village=${vid}&` : ''}screen=overview_villages&mode=units`, active: false });
  });

  document.getElementById('eos-confirm-refuse').addEventListener('click', async () => {
    await setWorldStorage({ pendingTroopConfirm: false });
    bar.remove();
    const { token: eosToken } = await getWorldStorage('token');
    if (eosToken) {
      fetch(`${EOS_SERVER}/api/members`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eosToken}`,
          'X-EOS-Version': chrome.runtime.getManifest().version,
        },
        body: JSON.stringify({ action: 'refuse_troop_request' })
      }).catch(() => {});
    }
  });
}

async function main() {
  console.log('[EOS] v' + chrome.runtime.getManifest().version + ' main() start');
  // Diagnostico: imprime SEMPRE (mesmo vazio)
  try {
    const d = await getStorage('eosLastGroupsSync', 'twGroups');
    console.log('[EOS groups] último sync:', d.eosLastGroupsSync || '(nenhum)',
                '| twGroups local:', Array.isArray(d.twGroups) ? d.twGroups.length : '(vazio)');
  } catch (e) { console.warn('[EOS groups] diagnostic err:', e); }

  // Página de grupos: só extrai se aberta pela extensão
  if (isGroupsPage()) {
    const { pendingGroupsExtract } = await getStorage('pendingGroupsExtract');
    if (!pendingGroupsExtract) return;

    // Aguarda 3s para page_reader (document_idle) guardar grupos no storage
    await new Promise(r => setTimeout(r, 3000));

    let attempts = 0;
    const tryExtract = async () => {
      // Union: combinar recipe (DOM) com twGroups já guardados por page_reader
      const recipeGroups = extractTWGroups() || [];
      const stored = await getStorage('twGroups');
      const prev = Array.isArray(stored.twGroups) ? stored.twGroups : [];
      const merged = [];
      const seen = new Set();
      for (const g of [...prev, ...recipeGroups]) {
        const sid = String(g.id || '');
        if (!sid || sid === '0' || seen.has(sid) || !g.name) continue;
        seen.add(sid);
        merged.push({ id: sid, name: String(g.name).trim() });
      }
      const groups = merged.length > 0 ? merged : null;
      if (groups) {
        await chrome.storage.local.set({ twGroups: groups, pendingGroupsExtract: false });
        const { token: eosToken } = await getWorldStorage('token');
        let postStatus = 'no-token';
        if (eosToken) {
          try {
            const res = await fetch(`${EOS_SERVER}/api/tw-groups`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${eosToken}`,
                'X-EOS-Version': chrome.runtime.getManifest().version,
              },
              body: JSON.stringify({ groups })
            });
            postStatus = `recipe HTTP ${res.status}`;
            console.log('[EOS groups]', postStatus);
          } catch (e) {
            postStatus = `recipe ERROR ${e.message}`;
            console.warn('[EOS groups]', postStatus);
          }
        }
        await chrome.storage.local.set({
          eosLastGroupsSync: { ts: Date.now(), source: 'recipe', count: groups.length, status: postStatus }
        });
        showOverlay(`✔ ${groups.length} grupos extraídos!`, 'ok');
        setTimeout(() => chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }), 2500);
      } else if (attempts++ < 20) setTimeout(tryExtract, 300);
    };
    tryExtract();
    return;
  }

  // Página de tropas (overview_villages&mode=units): lê agregado + por aldeia
  if (!isUnitsPage()) return;

  const data = await getWorldStorage('pendingTroopRequest', 'pendingTroopGroupId', 'pendingTroopGroupName', 'token');
  if (!data.pendingTroopRequest) return;

  const groupId   = data.pendingTroopGroupId   || '0';
  const groupName = data.pendingTroopGroupName || 'Todos';
  const token     = data.token;

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

  showOverlay('⚔️ A aguardar tabela...', 'info', 0);

  try {
    await waitForOverviewTable();
    showOverlay('⚔️ A ler aldeias...', 'info', 5);

    // Leitura única com progresso
    const villages = readPerVillageTroops((current, total) => {
      const pct = 5 + (current / total) * 55; // 5% → 60%
      showOverlay(`⚔️ A ler aldeias ${current}/${total}`, 'info', pct);
    });
    if (!villages || !villages.length) throw new Error('Não foi possível ler a tabela de tropas.');

    showOverlay(`⚔️ A calcular totais (${villages.length} aldeias)...`, 'info', 65);

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
      if      (offPop >= 17000) classification.full_nuke++;
      else if (offPop >= 10000) classification.semi_nuke++;
      else if (defPop >= 17000) classification.full_def++;
      else if (defPop >= 10000) classification.semi_def++;
      else                      classification.other++;
    }

    const ver = chrome.runtime.getManifest().version;
    const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-EOS-Version': ver };

    // Enviar report agregado (70% → 85%)
    if (Object.keys(troops).length > 0) {
      showOverlay(`⚔️ A enviar tropas agregadas...`, 'info', 70);
      const res = await fetch(`${EOS_SERVER}/api/report`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ troops, classification, groupId, groupName })
      });
      if (!res.ok) throw new Error(`Servidor: ${res.status}`);
    }

    // Enviar aldeias (85% → 98%)
    if (villages.length > 0) {
      showOverlay(`⚔️ A enviar ${villages.length} aldeias...`, 'info', 85);
      const res = await fetch(`${EOS_SERVER}/api/village-troops`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ villages, groupId })
      });
      if (!res.ok) throw new Error(`Servidor: ${res.status}`);
    }

    showOverlay(`⚔️ A finalizar...`, 'info', 100);
    await setWorldStorage({ pendingTroopRequest: false });
    showOverlay(`✔ ${villages.length} aldeias guardadas!`, 'ok');
    setTimeout(() => { chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }); window.close(); }, 500);

  } catch (err) {
    await setWorldStorage({ pendingTroopRequest: false });
    showOverlay('❌ ' + err.message, 'error');
    setTimeout(() => { chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }); window.close(); }, 3000);
  }
}

// Arranca o mais cedo possível
// ── Overlay do mapa: escudos em aldeias bunkadas + tooltip ──────────────────

function showUpdateRequiredOverlay(version, downloadUrl) {
  const existing = document.getElementById('eos-update-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'eos-update-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif';

  const panel = document.createElement('div');
  panel.style.cssText = 'background:linear-gradient(135deg,#2a2018,#1e1a14);border:1px solid #e8502040;border-radius:12px;padding:30px 36px;max-width:420px;text-align:center;color:#f0e0c8;box-shadow:0 12px 48px rgba(0,0,0,0.9)';

  panel.innerHTML = `
    <div style="font-size:36px;margin-bottom:12px">⚠️</div>
    <h2 style="font-size:18px;color:#f8c850;margin:0 0 12px;font-weight:700">Atualização Obrigatória</h2>
    <p style="font-size:13px;color:#c0b090;line-height:1.6;margin:0 0 20px">
      A tua versão do Eye of Sauron está desatualizada.<br>
      Faz download da versão <strong style="color:#f8c850">v${version}</strong> para continuar a usar.
    </p>
    <button id="eos-download-update-btn" style="padding:12px 28px;background:linear-gradient(135deg,#e87830,#c06020);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px #e8502040">
      Descarregar Atualização
    </button>
    <div style="margin-top:12px;font-size:10px;color:#706050">
      Após descarregar, extrai e substitui os ficheiros da extensão.
    </div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  panel.querySelector('#eos-download-update-btn')?.addEventListener('click', () => {
    if (downloadUrl) window.open(downloadUrl, '_blank');
  });
}

function showSubscriptionOverlay(sub, tribeName) {
  const existing = document.getElementById('eos-sub-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'eos-sub-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:transparent;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif';
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
    message = tribeName
      ? `A subscrição da tribo <strong style="color:#f8c850">${tribeName}</strong> expirou. Contacta o líder da tribo para renovar.`
      : 'A subscrição da tua tribo expirou. Contacta o líder para renovar.';
  } else if (isNone) {
    title = tribeName ? `Tribo: ${tribeName}` : 'Tribo Detetada';
    message = 'A tua tribo ainda não tem uma subscrição ativa.';
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

  // Botão de subscrição abre a página de planos no painel (iframe)
  const subBtn = overlay.querySelector('#eos-subscribe-btn');
  if (subBtn) {
    subBtn.addEventListener('click', async () => {
      overlay.remove();
      const { playerName: eosPlayerName, tribeName: eosTribeName } = await getWorldStorage('playerName', 'tribeName');
      const tribe = encodeURIComponent(eosTribeName || tribeName);
      const world = encodeURIComponent(CURRENT_WORLD);
      const player = encodeURIComponent(eosPlayerName || '');
      const url = `${EOS_SERVER}/subscribe?tribe=${tribe}&world=${world}&player=${player}`;

      const panelOverlay = document.createElement('div');
      panelOverlay.id = 'eos-panel-overlay';
      panelOverlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:transparent;display:flex;align-items:center;justify-content:center';

      const container = document.createElement('div');
      container.style.cssText = 'position:relative;width:520px;max-width:95vw;height:520px;max-height:85vh;background:#24201a;border:2px solid #e8502040;border-radius:10px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.8)';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;z-index:1;background:none;border:none;color:#c0a060;font-size:20px;cursor:pointer;line-height:1';
      closeBtn.onclick = () => panelOverlay.remove();

      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.style.cssText = 'width:100%;height:100%;border:none;overflow:hidden';
      iframe.scrolling = 'no';

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
let enemyReportsData = null; // Map<coordKey, reportData>
let mapViewport = null;
let mapOverlayEl = null;
let shieldElements = {}; // coordKey → DOM element
let eosMapEnabled = true;

// Configuração de bunk types (guardada no storage)
// Pop defensiva por unidade: spear=1, sword=1, heavy=6
// Nota: militia NÃO conta para bunker — é temporária (ativa durante defesas)
// e levaria a classificar aldeias normais como bunks quando o jogador está
// sob ataque.
const DEF_POP = { spear: 1, sword: 1, archer: 1, heavy: 6 };

function calcDefPop(troops) {
  if (!troops) return 0;
  let sum = 0;
  for (const [u, pop] of Object.entries(DEF_POP)) sum += (troops[u] || 0) * pop;
  return sum;
}

const DEFAULT_BUNK_TYPES = [
  { id: 'light_bunk', name: 'Bunk Leve', color: '#4caf50', minDefPop: 20000, enabled: true },
  { id: 'medium_bunk', name: 'Bunk Médio', color: '#ff9800', minDefPop: 45000, enabled: true },
  { id: 'heavy_bunk', name: 'Bunk Pesado', color: '#f44336', minDefPop: 100000, enabled: true },
];
const DEFAULT_ENEMY_BUNK_TYPES = [
  { id: 'enemy_weak',   name: 'Fraca',   color: '#ffffff', minDefPop: 1,    enabled: true },
  { id: 'enemy_light',  name: 'Leve',    color: '#4caf50', minDefPop: 3000, enabled: true },
  { id: 'enemy_medium', name: 'Média',   color: '#ff9800', minDefPop: 10000, enabled: true },
  { id: 'enemy_heavy',  name: 'Pesada',  color: '#f44336', minDefPop: 20000, enabled: true },
];
let bunkTypes = [...DEFAULT_BUNK_TYPES];
let enemyBunkTypes = [...DEFAULT_ENEMY_BUNK_TYPES];
let showAllyBunks = true;
let showEnemyBunks = true;
let bunksAnimated = true;
let showSkullIcon  = true;
let showAxeIcon    = true;
let showSwordIcon  = true;
let iconSize       = 18;   // 14-28px
let skullDays      = 5;    // 1-14 dias
let mapAnimation   = 'float';  // 'none'|'float'|'pulse'|'shake'|'glow'|'spin'|'breathe'
let colorSkull     = '#2a1010';
let colorAxe       = '#c02020';
let colorSword     = '#20305a';
let streamerMode   = false;
const STREAMER_SHIELD_COLOR = '#5a5a5a';  // cinza neutro para ocultar tier

function makeShieldElement(color, size = 18) {
  const el = document.createElement('div');
  const fs = Math.round(size * 0.6);
  el.style.cssText = `font-size:${fs}px;line-height:${size}px;width:${size}px;height:${size}px;text-align:center;border-radius:50%;background:${color};border:1.5px solid rgba(255,255,255,0.7);box-shadow:0 0 4px ${color}88,0 1px 3px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center`;
  const inner = document.createElement('span');
  inner.textContent = '🛡️';
  inner.style.cssText = 'display:inline-block';
  el.appendChild(inner);
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

// Pop ofensiva por unidade (mesma lógica do content.js original)
const OFF_POP = { axe: 1, light: 4, ram: 5, catapult: 8, marcher: 5 };
function calcOffPop(troops) {
  if (!troops) return 0;
  let sum = 0;
  for (const [u, pop] of Object.entries(OFF_POP)) {
    sum += (troops[u] || 0) * pop;
  }
  return sum;
}

// Classifica tropas inimigas por força defensiva usando a config enemyBunkTypes
// Classificação tática para o ícone do mapa:
//   - 💀 skull  → pertencentes confirmado 0 há ≤5 dias (troops_wiped_at)
//   - 🗡 axe    → pertencentes maioritariamente ofensivas (offPop > defPop)
//   - 🛡 spear  → pertencentes maioritariamente defensivas (defPop >= offPop)
// Devolve { title, bg, imgSrc, emoji } ou null se sem info útil
function classifyEnemyTactical(report) {
  if (!report) return null;
  // 💀 Wiped (usa skullDays configurável)
  if (showSkullIcon && report.troops_wiped_at) {
    const age = Date.now() - new Date(report.troops_wiped_at).getTime();
    if (age <= skullDays * 24 * 60 * 60 * 1000) {
      return { title: 'Tropas pertencentes eliminadas', bg: colorSkull, emoji: '💀' };
    }
  }
  const outside = report.troops_outside;
  if (!outside || Object.keys(outside).length === 0) return null;
  const offPop = calcOffPop(outside);
  const defPop = calcDefPop(outside);
  if (offPop === 0 && defPop === 0) return null;
  if (offPop > defPop) {
    if (!showAxeIcon) return null;
    return {
      title: `Pertencentes ofensivas (off pop ${offPop})`,
      bg: colorAxe,
      imgSrc: '/graphic/unit/unit_axe.png',
    };
  }
  if (!showSwordIcon) return null;
  return {
    title: `Pertencentes defensivas (def pop ${defPop})`,
    bg: colorSword,
    imgSrc: '/graphic/unit/unit_sword.png',
  };
}

function classifyEnemyTroops(troopsOwned) {
  if (!troopsOwned) return { offSize: null, defSize: null, defColor: null, offPop: 0, defPop: 0 };
  const offPop = calcOffPop(troopsOwned);
  const defPop = calcDefPop(troopsOwned);

  let offSize = null;
  if (offPop >= EOS_CONFIG.thresholds.fullNukePop) offSize = 'full';
  else if (offPop >= EOS_CONFIG.thresholds.semiNukePop) offSize = 'semi';
  else if (offPop > 0) offSize = 'small';

  // Itera do maior threshold para o menor (o maior match ganha)
  let defSize = null, defColor = null;
  const sorted = [...enemyBunkTypes].sort((a, b) => (b.minDefPop || 0) - (a.minDefPop || 0));
  for (const bt of sorted) {
    if (!bt.enabled) continue;
    if (defPop >= (bt.minDefPop || 0)) {
      defSize = bt.id;
      defColor = bt.color;
      break;
    }
  }

  return { offSize, defSize, defColor, offPop, defPop };
}

function injectShieldStyles() {
  let style = document.getElementById('eos-shield-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'eos-shield-styles';
    document.head.appendChild(style);
  }
  style.textContent = `
    @keyframes eos-float   { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
    @keyframes eos-pulse   { 0%,100% { transform: scale(1); } 50% { transform: scale(1.18); } }
    @keyframes eos-shake   { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-6deg); } 75% { transform: rotate(6deg); } }
    @keyframes eos-glow    { 0%,100% { filter: brightness(1) drop-shadow(0 0 2px rgba(255,200,120,.4)); } 50% { filter: brightness(1.35) drop-shadow(0 0 6px rgba(255,180,80,.9)); } }
    @keyframes eos-spin    { 0% { transform: rotateY(0deg); } 100% { transform: rotateY(360deg); } }
    @keyframes eos-breathe { 0%,100% { transform: scale(1); opacity: .85; } 50% { transform: scale(1.08); opacity: 1; } }

    .eos-anim-float   { animation: eos-float   2s ease-in-out infinite; }
    .eos-anim-pulse   { animation: eos-pulse   1.6s ease-in-out infinite; }
    .eos-anim-shake   { animation: eos-shake   .6s ease-in-out infinite; }
    .eos-anim-glow    { animation: eos-glow    1.8s ease-in-out infinite; }
    .eos-anim-spin img, .eos-anim-spin > span { animation: eos-spin 3s linear infinite; }
    .eos-anim-breathe { animation: eos-breathe 2.4s ease-in-out infinite; }
  `;
}

function animClassName() {
  if (!bunksAnimated || mapAnimation === 'none') return '';
  const map = { float:'eos-anim-float', pulse:'eos-anim-pulse', shake:'eos-anim-shake',
                glow:'eos-anim-glow', spin:'eos-anim-spin', breathe:'eos-anim-breathe' };
  return map[mapAnimation] || 'eos-anim-float';
}

let currentPlayerName = null;
async function initMapOverlay() {
  if (!isMapPage()) return;
  injectShieldStyles();

  // Tenta obter o token; se ainda não existe (migração pendente), retry até 10s
  let eosToken = null;
  for (let i = 0; i < 10; i++) {
    const { token, playerName } = await getWorldStorage('token', 'playerName');
    if (token) { eosToken = token; currentPlayerName = playerName; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!eosToken) return;

  // Carrega definições guardadas
  const { eosBunkTypes, eosEnemyBunkTypes, eosMapEnabled: savedEnabled,
          eosShowAllyBunks, eosShowEnemyBunks, eosBunksAnimated,
          eosShowSkull, eosShowAxe, eosShowSword, eosIconSize, eosSkullDays,
          eosMapAnimation, eosColorSkull, eosColorAxe, eosColorSword,
          eosStreamerMode } = await getStorage(
    'eosBunkTypes', 'eosEnemyBunkTypes', 'eosMapEnabled',
    'eosShowAllyBunks', 'eosShowEnemyBunks', 'eosBunksAnimated',
    'eosShowSkull', 'eosShowAxe', 'eosShowSword', 'eosIconSize', 'eosSkullDays',
    'eosMapAnimation', 'eosColorSkull', 'eosColorAxe', 'eosColorSword',
    'eosStreamerMode');
  if (savedEnabled === false) eosMapEnabled = false;
  if (Array.isArray(eosBunkTypes) && eosBunkTypes.length > 0) bunkTypes = eosBunkTypes;
  if (Array.isArray(eosEnemyBunkTypes) && eosEnemyBunkTypes.length > 0) enemyBunkTypes = eosEnemyBunkTypes;
  if (eosShowAllyBunks === false) showAllyBunks = false;
  if (eosShowEnemyBunks === false) showEnemyBunks = false;
  if (eosBunksAnimated === false) bunksAnimated = false;
  if (eosShowSkull === false) showSkullIcon = false;
  if (eosShowAxe === false) showAxeIcon = false;
  if (eosShowSword === false) showSwordIcon = false;
  if (typeof eosIconSize === 'number' && eosIconSize >= 12 && eosIconSize <= 28) iconSize = eosIconSize;
  if (typeof eosSkullDays === 'number' && eosSkullDays >= 1 && eosSkullDays <= 30) skullDays = eosSkullDays;
  if (typeof eosMapAnimation === 'string') mapAnimation = eosMapAnimation;
  if (typeof eosColorSkull === 'string') colorSkull = eosColorSkull;
  if (typeof eosColorAxe   === 'string') colorAxe   = eosColorAxe;
  if (typeof eosColorSword === 'string') colorSword = eosColorSword;
  if (eosStreamerMode === true) streamerMode = true;

  // Observa o popup nativo do TW para injetar dados de tropas
  setupPopupObserver();

  // Injeta botão de settings do mapa
  injectMapSettingsButton();

  // Busca dados da tribo e coloca escudos
  await fetchMapData(eosToken);

  // Busca relatórios de aldeias inimigas
  fetchEnemyReports(eosToken);

  // Retry e inicia tracking
  setTimeout(() => { if (eosMapEnabled) { placeShields(); startShieldTracking(); } }, 2000);

  // Refresh a cada 5 minutos
  setInterval(() => fetchMapData(eosToken), 300000);
  setInterval(() => fetchEnemyReports(eosToken), 300000);

  // Refetch quando a tab ganha foco (se última busca foi há > 60s)
  let lastFetch = Date.now();
  window.addEventListener('focus', async () => {
    if (Date.now() - lastFetch < 60000) return;
    lastFetch = Date.now();
    await fetchMapData(eosToken);
    await fetchEnemyReports(eosToken);
    document.querySelectorAll('[data-eos-shield],[data-eos-enemy],[data-eos-enemy-shield]').forEach(el => el.remove());
    shieldElements = {};
    if (eosMapEnabled) placeShields();
  });

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

    // Cria botão EOS settings — engrenagem
    const btn = document.createElement('div');
    btn.id = 'eos-map-settings-btn';
    btn.title = 'Eye of Sauron - Definições do Mapa';
    btn.style.cssText = `position:absolute;top:5px;right:5px;width:30px;height:30px;z-index:99999;cursor:pointer;
      background:linear-gradient(135deg,#5a4430,#3a2818);border:1.5px solid #c0a060;border-radius:6px;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.5);transition:all .2s`;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e8a030" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#e87830'; btn.style.transform = 'scale(1.1)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#c0a060'; btn.style.transform = ''; });
    btn.addEventListener('click', toggleMapSettingsPanel);
    mapEl.style.position = 'relative';
    mapEl.appendChild(btn);
  }, 500);
}

function toggleMapSettingsPanel() {
  const existing = document.getElementById('eos-map-settings-overlay');
  if (existing) { existing.remove(); return; }

  // Backdrop transparente (não escurece o jogo)
  const overlay = document.createElement('div');
  overlay.id = 'eos-map-settings-overlay';
  overlay.style.cssText = `position:fixed;inset:0;z-index:2147483646;background:transparent;
    display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const panel = document.createElement('div');
  panel.id = 'eos-map-settings-panel';
  panel.style.cssText = `width:1060px;max-width:96vw;max-height:90vh;
    background:linear-gradient(135deg,#2a2018,#1e1a14);border:1px solid #e8502060;border-radius:14px;
    font-size:11px;color:#f0e0c8;display:flex;flex-direction:column;overflow:hidden;
    box-shadow:0 20px 60px rgba(0,0,0,0.95),0 0 0 1px #e8502030,inset 0 1px 0 rgba(255,180,80,.08)`;

  panel.innerHTML = `<style>.eos-scroll::-webkit-scrollbar{width:5px}.eos-scroll::-webkit-scrollbar-track{background:#1a1610;border-radius:3px}.eos-scroll::-webkit-scrollbar-thumb{background:#e8502040;border-radius:3px}.eos-scroll::-webkit-scrollbar-thumb:hover{background:#e8783060}</style>` + buildSettingsPanelHTML();
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  attachSettingsEvents(panel);
}

function buildSettingsPanelHTML() {
  const toggleBg = eosMapEnabled ? 'linear-gradient(135deg,#e87830,#c06020)' : '#302820';
  const unitPng = (u) => chrome.runtime.getURL(`png/unit_${u}.png`);

  function miniToggle(id, active, color) {
    const onBg = color ? color : 'linear-gradient(135deg,#e87830,#c06020)';
    const bg = active ? onBg : '#302820';
    const left = active ? '19px' : '3px';
    return `<button id="${id}" data-active="${active}" data-color="${color || ''}" style="width:36px;height:20px;border-radius:10px;border:none;cursor:pointer;background:${bg};position:relative;transition:background .3s">
      <div style="width:14px;height:14px;border-radius:50%;background:#f4e8d0;position:absolute;top:3px;left:${left};transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>
    </button>`;
  }

  function bunkCardHTML(bt, i, section) {
    const disabled = !bt.enabled;
    return `
      <div style="background:linear-gradient(135deg,#2c241c,#1f1912);border:1px solid #e8502020;
        border-left:3px solid ${bt.color};border-radius:8px;padding:10px 12px;margin-bottom:8px;
        opacity:${disabled ? '.55' : '1'};transition:opacity .2s">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
            <div style="position:relative">
              <input type="color" value="${bt.color}" data-field="color" data-idx="${i}" data-section="${section}"
                style="width:26px;height:26px;border:1.5px solid ${bt.color}80;border-radius:50%;cursor:pointer;background:transparent;padding:0;
                box-shadow:0 0 8px ${bt.color}40">
            </div>
            <input type="text" value="${bt.name}" data-field="name" data-idx="${i}" data-section="${section}"
              style="flex:1;min-width:0;background:transparent;border:none;color:#f0e0c8;font-size:13px;font-weight:700;outline:none;padding:2px 0;
              border-bottom:1px solid transparent;transition:border-color .2s"
              onfocus="this.style.borderColor='${bt.color}'" onblur="this.style.borderColor='transparent'">
          </div>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:10px;color:#b09878;font-weight:600;margin-left:8px">
            <input type="checkbox" ${bt.enabled ? 'checked' : ''} data-field="enabled" data-idx="${i}" data-section="${section}"
              style="accent-color:${bt.color};cursor:pointer;width:14px;height:14px">
            Ativo
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="display:flex;align-items:center;gap:2px;opacity:.8">
            <img src="${unitPng('spear')}" style="width:16px;height:16px" title="Lanceiro">
            <img src="${unitPng('sword')}" style="width:16px;height:16px" title="Espadachim">
            <img src="${unitPng('heavy')}" style="width:16px;height:16px" title="Pesado">
          </div>
          <span style="font-size:10px;color:#a08868;text-transform:uppercase;letter-spacing:1;font-weight:700">Pop Def ≥</span>
          <input type="number" value="${bt.minDefPop || 0}" data-field="minDefPop" data-idx="${i}" data-section="${section}" min="0" step="1000"
            style="flex:1;background:#0e0c08;border:1px solid ${bt.color}30;border-radius:5px;color:${bt.color};
            font-size:13px;padding:5px 8px;outline:none;text-align:right;font-weight:800;font-variant-numeric:tabular-nums">
        </div>
      </div>
    `;
  }

  // Helper: label uppercase subtil para secções
  const sectionLabel = (txt, color = '#f0b878') =>
    `<div style="font-size:10px;color:${color};text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;font-weight:800;display:flex;align-items:center;gap:8px">
      <span style="width:12px;height:2px;background:${color};border-radius:1px"></span>${txt}
    </div>`;

  let html = `
    <!-- Header elegante -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;
      border-bottom:1px solid #e8502030;flex-shrink:0;
      background:linear-gradient(180deg,rgba(232,120,48,.08),transparent)">
      <div>
        <div style="font-size:17px;font-weight:800;color:#f8c850;letter-spacing:.5px;
          background:linear-gradient(90deg,#f8c850,#e87830);-webkit-background-clip:text;-webkit-text-fill-color:transparent">
          👁 Definições do Mapa
        </div>
        <div style="font-size:10px;color:#8a7860;margin-top:2px">Personaliza escudos, ícones táticos, animações e classificação</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:10px;color:#b09878;text-transform:uppercase;letter-spacing:1.5px;font-weight:700">
          ${eosMapEnabled ? 'Ativado' : 'Desativado'}
        </span>
        <button id="eos-map-toggle" style="width:52px;height:28px;border-radius:14px;border:none;cursor:pointer;
          background:${toggleBg};position:relative;transition:background .3s;
          box-shadow:${eosMapEnabled ? '0 0 12px rgba(232,120,48,.35)' : 'none'}">
          <div style="width:22px;height:22px;border-radius:50%;background:#f4e8d0;position:absolute;top:3px;
            left:${eosMapEnabled ? '27px' : '3px'};transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>
        </button>
      </div>
    </div>

    <div style="flex:1;overflow-y:auto;padding:18px 22px" class="eos-scroll">

      <!-- ═══ TOP ROW — 3 COLUNAS: Visibilidade | Táticos | Aparência ═══ -->
      <div style="display:grid;grid-template-columns:1fr 1.3fr 1.5fr;gap:14px;margin-bottom:16px">

        <!-- COL 1: Visibilidade -->
        <div style="padding:14px;background:linear-gradient(160deg,#1f1812,#1a140e);border-radius:10px;border:1px solid #e8502020">
          ${sectionLabel('Visibilidade')}
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:#14100a;border-radius:6px;border:1px solid #2a2018">
              <span style="font-size:11px;color:#e0d0b8;font-weight:600">🛡 Aliados</span>
              ${miniToggle('eos-toggle-ally', showAllyBunks)}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:#14100a;border-radius:6px;border:1px solid #2a2018">
              <span style="font-size:11px;color:#e0d0b8;font-weight:600">⚔ Inimigos</span>
              ${miniToggle('eos-toggle-enemy', showEnemyBunks)}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:#14100a;border-radius:6px;border:1px solid #2a2018">
              <span style="font-size:11px;color:#e0d0b8;font-weight:600">✨ Animados</span>
              ${miniToggle('eos-toggle-anim', bunksAnimated)}
            </div>
          </div>
        </div>

        <!-- COL 2: Ícones Táticos Inimigos -->
        <div style="padding:14px;background:linear-gradient(160deg,#1f1812,#1a140e);border-radius:10px;border:1px solid #e8502020">
          ${sectionLabel('Ícones Táticos Inimigos')}
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:#14100a;border-radius:6px;border:1px solid ${colorSkull}40">
              <span style="font-size:11px;color:#e0d0b8;font-weight:600;display:flex;align-items:center;gap:8px">
                <span style="width:22px;height:22px;border-radius:50%;background:${colorSkull};display:inline-flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 0 6px ${colorSkull}80">💀</span>
                Caveira (exército morto)
              </span>
              ${miniToggle('eos-toggle-skull', showSkullIcon, colorSkull)}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:#14100a;border-radius:6px;border:1px solid ${colorAxe}40">
              <span style="font-size:11px;color:#e0d0b8;font-weight:600;display:flex;align-items:center;gap:8px">
                <span style="width:22px;height:22px;border-radius:50%;background:${colorAxe};display:inline-flex;align-items:center;justify-content:center;box-shadow:0 0 6px ${colorAxe}80"><img src="/graphic/unit/unit_axe.png" style="width:13px;height:13px"></span>
                Ofensivo (pertencentes off)
              </span>
              ${miniToggle('eos-toggle-axe', showAxeIcon, colorAxe)}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:#14100a;border-radius:6px;border:1px solid ${colorSword}40">
              <span style="font-size:11px;color:#e0d0b8;font-weight:600;display:flex;align-items:center;gap:8px">
                <span style="width:22px;height:22px;border-radius:50%;background:${colorSword};display:inline-flex;align-items:center;justify-content:center;box-shadow:0 0 6px ${colorSword}80"><img src="/graphic/unit/unit_sword.png" style="width:13px;height:13px"></span>
                Defensivo (pertencentes def)
              </span>
              ${miniToggle('eos-toggle-sword', showSwordIcon, colorSword)}
            </div>
          </div>
        </div>

        <!-- COL 3: Aparência -->
        <div style="padding:14px;background:linear-gradient(160deg,#1f1812,#1a140e);border-radius:10px;border:1px solid #e8502020">
          ${sectionLabel('Aparência')}

          <div style="padding:10px;background:#14100a;border-radius:6px;border:1px solid #2a2018;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px">
              <span style="font-size:10px;color:#c0a878;text-transform:uppercase;letter-spacing:1;font-weight:700">Tamanho</span>
              <span id="eos-icon-size-val" style="font-size:11px;color:#f0b878;font-weight:700">${iconSize}px</span>
            </div>
            <input id="eos-icon-size" type="range" min="12" max="28" step="1" value="${iconSize}"
              style="width:100%;accent-color:#e87830">
          </div>

          <div style="padding:10px;background:#14100a;border-radius:6px;border:1px solid #2a2018;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px">
              <span style="font-size:10px;color:#c0a878;text-transform:uppercase;letter-spacing:1;font-weight:700">Validade caveira</span>
              <span id="eos-skull-days-val" style="font-size:11px;color:#f0b878;font-weight:700">${skullDays} dias</span>
            </div>
            <input id="eos-skull-days" type="range" min="1" max="14" step="1" value="${skullDays}"
              style="width:100%;accent-color:#e87830">
          </div>

          <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:6px;padding:10px;background:#14100a;border-radius:6px;border:1px solid #2a2018">
            <div>
              <div style="font-size:9px;color:#c0a878;text-transform:uppercase;letter-spacing:1;font-weight:700;margin-bottom:3px">Animação</div>
              <select id="eos-anim-type" style="width:100%;padding:5px;background:#0e0c08;color:#f0e0c8;border:1px solid #3a2a1a;border-radius:4px;font-size:10px;cursor:pointer">
                <option value="none"    ${mapAnimation==='none'?'selected':''}>✕ Nenhuma</option>
                <option value="float"   ${mapAnimation==='float'?'selected':''}>⇅ Flutuar</option>
                <option value="pulse"   ${mapAnimation==='pulse'?'selected':''}>⊚ Pulsar</option>
                <option value="shake"   ${mapAnimation==='shake'?'selected':''}>↔ Abanar</option>
                <option value="glow"    ${mapAnimation==='glow'?'selected':''}>✦ Brilhar</option>
                <option value="spin"    ${mapAnimation==='spin'?'selected':''}>↻ Rodar</option>
                <option value="breathe" ${mapAnimation==='breathe'?'selected':''}>◐ Respirar</option>
              </select>
            </div>
            <div>
              <div style="font-size:9px;color:#c0a878;text-transform:uppercase;letter-spacing:1;font-weight:700;margin-bottom:3px">💀</div>
              <input id="eos-color-skull" type="color" value="${colorSkull}" style="width:100%;height:26px;border:1px solid #3a2a1a;border-radius:4px;background:transparent;cursor:pointer">
            </div>
            <div>
              <div style="font-size:9px;color:#c0a878;text-transform:uppercase;letter-spacing:1;font-weight:700;margin-bottom:3px">Axe</div>
              <input id="eos-color-axe" type="color" value="${colorAxe}" style="width:100%;height:26px;border:1px solid #3a2a1a;border-radius:4px;background:transparent;cursor:pointer">
            </div>
            <div>
              <div style="font-size:9px;color:#c0a878;text-transform:uppercase;letter-spacing:1;font-weight:700;margin-bottom:3px">Sword</div>
              <input id="eos-color-sword" type="color" value="${colorSword}" style="width:100%;height:26px;border:1px solid #3a2a1a;border-radius:4px;background:transparent;cursor:pointer">
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Classificação de Bunkers (2 colunas) ═══ -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="padding:14px;background:linear-gradient(160deg,#1f1812,#1a140e);border-radius:10px;border:1px solid #5ab07020">
          ${sectionLabel('Bunks Aliados', '#5ab070')}
  `;
  for (let i = 0; i < bunkTypes.length; i++) html += bunkCardHTML(bunkTypes[i], i, 'ally');

  html += `
        </div>
        <div style="padding:14px;background:linear-gradient(160deg,#1f1812,#1a140e);border-radius:10px;border:1px solid #e0505020">
          ${sectionLabel('Bunks Inimigos', '#e05050')}
  `;
  for (let i = 0; i < enemyBunkTypes.length; i++) html += bunkCardHTML(enemyBunkTypes[i], i, 'enemy');

  html += `
        </div>
      </div>
    </div>
    <div style="padding:14px 22px;border-top:1px solid #e8502030;flex-shrink:0;
      background:linear-gradient(0deg,rgba(232,120,48,.06),transparent);
      display:flex;gap:12px;align-items:center">
      <div style="flex:1;font-size:10px;color:#8a7860">
        <span style="color:#5ab070;font-weight:700">●</span> Alterações aplicam-se ao vivo
      </div>
      <button id="eos-save-map-settings" style="padding:11px 32px;
        background:linear-gradient(135deg,#e87830,#c06020);color:#fff;border:none;border-radius:8px;
        font-size:13px;font-weight:800;cursor:pointer;letter-spacing:1px;text-transform:uppercase;
        box-shadow:0 4px 18px #e8502050,inset 0 1px 0 rgba(255,200,120,.3);
        transition:transform .1s"
        onmouseover="this.style.transform='translateY(-1px)'"
        onmouseout="this.style.transform='translateY(0)'">
        💾 Guardar
      </button>
    </div>
  `;

  return html;
}

function attachSettingsEvents(panel) {
  // Toggle EOS map
  panel.querySelector('#eos-map-toggle')?.addEventListener('click', () => {
    eosMapEnabled = !eosMapEnabled;
    toggleMapSettingsPanel();
    toggleMapSettingsPanel();
    if (!eosMapEnabled) {
      document.querySelectorAll('[data-eos-shield],[data-eos-enemy]').forEach(el => el.remove());
      shieldElements = {};
    } else placeShields();
  });

  // Re-render helper — remove escudos/ícones e recria
  function liveRerender() {
    document.querySelectorAll('[data-eos-shield],[data-eos-enemy],[data-eos-enemy-shield]').forEach(el => el.remove());
    shieldElements = {};
    if (eosMapEnabled) placeShields();
  }

  // Toggles show/hide ally/enemy/anim
  function bindMiniToggle(id, getter, setter) {
    panel.querySelector('#' + id)?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const newVal = !getter();
      setter(newVal);
      btn.setAttribute('data-active', String(newVal));
      const customColor = btn.dataset.color;
      const onBg = customColor ? customColor : 'linear-gradient(135deg,#e87830,#c06020)';
      btn.style.background = newVal ? onBg : '#302820';
      btn.querySelector('div').style.left = newVal ? '19px' : '3px';
      liveRerender();
    });
  }
  bindMiniToggle('eos-toggle-ally',  () => showAllyBunks,  v => showAllyBunks = v);
  bindMiniToggle('eos-toggle-enemy', () => showEnemyBunks, v => showEnemyBunks = v);
  bindMiniToggle('eos-toggle-anim',  () => bunksAnimated, v => bunksAnimated = v);
  bindMiniToggle('eos-toggle-skull', () => showSkullIcon, v => showSkullIcon = v);
  bindMiniToggle('eos-toggle-axe',   () => showAxeIcon,   v => showAxeIcon = v);
  bindMiniToggle('eos-toggle-sword', () => showSwordIcon, v => showSwordIcon = v);

  // Sliders com preview ao vivo
  const sizeSlider = panel.querySelector('#eos-icon-size');
  const sizeVal    = panel.querySelector('#eos-icon-size-val');
  sizeSlider?.addEventListener('input', () => {
    iconSize = parseInt(sizeSlider.value) || 18;
    if (sizeVal) sizeVal.textContent = `${iconSize}px`;
    liveRerender();
  });
  const daysSlider = panel.querySelector('#eos-skull-days');
  const daysVal    = panel.querySelector('#eos-skull-days-val');
  daysSlider?.addEventListener('input', () => {
    skullDays = parseInt(daysSlider.value) || 5;
    if (daysVal) daysVal.textContent = `${skullDays} dias`;
    liveRerender();
  });

  // Animação: preview ao vivo
  panel.querySelector('#eos-anim-type')?.addEventListener('change', (e) => {
    mapAnimation = e.target.value;
    injectShieldStyles();
    liveRerender();
  });

  // Color pickers — preview ao vivo + atualiza cor do toggle correspondente
  function bindColorPicker(id, setter, toggleId) {
    panel.querySelector('#' + id)?.addEventListener('input', (e) => {
      const newColor = e.target.value;
      setter(newColor);
      // Se o toggle correspondente está ativo, atualiza a cor de fundo
      const btn = panel.querySelector('#' + toggleId);
      if (btn) {
        btn.dataset.color = newColor;
        if (btn.dataset.active === 'true') btn.style.background = newColor;
      }
      liveRerender();
    });
  }
  bindColorPicker('eos-color-skull', v => colorSkull = v, 'eos-toggle-skull');
  bindColorPicker('eos-color-axe',   v => colorAxe   = v, 'eos-toggle-axe');
  bindColorPicker('eos-color-sword', v => colorSword = v, 'eos-toggle-sword');

  // Campos dos bunk cards (ally e enemy)
  panel.querySelectorAll('[data-section]').forEach(input => {
    const idx = parseInt(input.dataset.idx);
    const section = input.dataset.section;
    const arr = section === 'ally' ? bunkTypes : enemyBunkTypes;
    const field = input.dataset.field;
    const evt = (field === 'enabled') ? 'change' : 'input';
    input.addEventListener(evt, () => {
      if (field === 'enabled') arr[idx].enabled = input.checked;
      else if (field === 'minDefPop') arr[idx].minDefPop = parseInt(input.value) || 0;
      else arr[idx][field] = input.value;
      liveRerender();
    });
  });

  // Save
  panel.querySelector('#eos-save-map-settings')?.addEventListener('click', async () => {
    await chrome.storage.local.set({
      eosBunkTypes: bunkTypes,
      eosEnemyBunkTypes: enemyBunkTypes,
      eosMapEnabled,
      eosShowAllyBunks: showAllyBunks,
      eosShowEnemyBunks: showEnemyBunks,
      eosBunksAnimated: bunksAnimated,
      eosShowSkull: showSkullIcon,
      eosShowAxe:   showAxeIcon,
      eosShowSword: showSwordIcon,
      eosIconSize:  iconSize,
      eosSkullDays: skullDays,
      eosMapAnimation: mapAnimation,
      eosColorSkull:   colorSkull,
      eosColorAxe:     colorAxe,
      eosColorSword:   colorSword,
    });
    // Re-render: remove escudos e inimigos antigos e recria com novas definições
    document.querySelectorAll('[data-eos-shield],[data-eos-enemy]').forEach(el => el.remove());
    shieldElements = {};
    if (eosMapEnabled) placeShields();
    document.getElementById('eos-map-settings-overlay')?.remove();
  });
}

async function fetchMapData(token) {
  console.log('[EOS mapData] fetching tribe villages...');
  try {
    const res = await fetch(`${EOS_SERVER}/api/village-troops?tribe=true&_=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EOS-Version': chrome.runtime.getManifest().version },
      cache: 'no-store',
    });
    console.log('[EOS mapData] HTTP', res.status);
    if (!res.ok) {
      console.warn('[EOS mapData] fetch falhou:', res.status, await res.text().catch(()=>''));
      return;
    }
    const { villages } = await res.json();
    mapVillageData = new Map();
    for (const v of (villages || [])) {
      if (v.village_coords) {
        mapVillageData.set(v.village_coords, v);
      }
    }
    console.log('[EOS mapData] aldeias carregadas:', mapVillageData.size, '| 560|443?', mapVillageData.get('560|443') || 'NÃO EXISTE');
    placeShields();
  } catch (e) {
    console.error('[EOS mapData] erro:', e);
  }
}

async function fetchEnemyReports(token) {
  try {
    const res = await fetch(`${EOS_SERVER}/api/enemy-reports?_=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EOS-Version': chrome.runtime.getManifest().version },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn('[EOS] fetchEnemyReports falhou:', res.status, await res.text().catch(() => ''));
      return;
    }
    const respData = await res.json();
    console.log('[EOS server version]', respData._v || 'UNKNOWN', '| wiped_server:', respData._wipedCount);
    const { reports } = respData;
    enemyReportsData = new Map();
    let wipedCount = 0;
    for (const r of (reports || [])) {
      if (r.village_coords) enemyReportsData.set(r.village_coords, r);
      if (r.troops_wiped_at) wipedCount++;
    }
    console.log('[EOS] enemy reports carregados:', enemyReportsData.size, '| com wipe:', wipedCount);
    // Dump específico para 547|453 — se ainda estiver a falhar
    const v547 = (reports || []).find(r => r.village_coords === '547|453');
    console.log('[EOS debug 547|453]', v547);
    // Wiped samples
    const wiped = (reports || []).filter(r => r.troops_wiped_at).slice(0, 5);
    if (wiped.length) console.log('[EOS wiped sample]', wiped);
    placeShields();
  } catch (e) {
    console.warn('[EOS] fetchEnemyReports erro:', e);
  }
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

// Passagem única: coloca escudos aliados E ícones inimigos num só loop sobre as aldeias visíveis.
function placeShields() {
  if (!eosMapEnabled) return;
  const hasTribe = mapVillageData && mapVillageData.size > 0;
  const hasEnemy = enemyReportsData && enemyReportsData.size > 0;
  if (!hasTribe && !hasEnemy) return;

  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const villageMapStr = mapEl.getAttribute('data-eos-villages');
  if (!villageMapStr) return;
  let villageIds;
  try { villageIds = JSON.parse(villageMapStr); } catch (_) { return; }

  const SWORD_IMG = chrome.runtime.getURL('png/unit_sword.png');
  const VILLAGE_W = 53;
  const ICON_SIZE = iconSize;
  const ICON_GAP = 2;
  const animClass = animClassName();

  // Itera as aldeias visíveis no mapa
  for (const coordKey of Object.keys(villageIds)) {
    const vid = villageIds[coordKey];
    if (!vid) continue;
    const domVillage = document.getElementById('map_village_' + vid);
    if (!domVillage) continue;

    const parent = domVillage.parentNode;
    const alreadyShield      = parent.querySelector(`[data-eos-shield="${coordKey}"]`);
    const alreadyEnemyShield = parent.querySelector(`[data-eos-enemy-shield="${coordKey}"]`);
    const alreadyEnemy       = parent.querySelector(`[data-eos-enemy="${coordKey}"]`);
    if (alreadyShield && alreadyEnemyShield && alreadyEnemy) continue;

    const top = parseInt(domVillage.style.top, 10) || 0;
    const left = parseInt(domVillage.style.left, 10) || 0;

    // ── Escudo de tribo (aldeia aliada com tropas classificadas como bunk) ──
    if (!alreadyShield && hasTribe && showAllyBunks) {
      const v = mapVillageData.get(coordKey);
      if (v) {
        const troops = v.troops || v.troops_total || v.troops_own;
        if (troops) {
          const bt = classifyVillageForMap(troops);
          if (bt) {
            const shield = makeShieldElement(streamerMode ? STREAMER_SHIELD_COLOR : bt.color, ICON_SIZE);
            shield.dataset.eosShield = coordKey;
            shield.title = streamerMode ? `Aldeia (${coordKey})` : (bt.name + ' (' + coordKey + ')');
            shield.className = animClass;
            const delay = (Math.random() * 2).toFixed(1);
            const shieldLeft = left + VILLAGE_W / 2 - ICON_SIZE / 2;
            const shieldTop  = top - Math.round(ICON_SIZE / 2);
            shield.style.cssText += `;position:absolute;pointer-events:none;z-index:20;left:${shieldLeft}px;top:${shieldTop}px;animation-delay:${delay}s`;
            parent.insertBefore(shield, domVillage);
          }
        }
      }
    }

    // Inimigo = aldeia com relatório, que NÃO é da nossa tribo
    const isEnemyVillage = hasEnemy && !(hasTribe && mapVillageData.get(coordKey)) && enemyReportsData.get(coordKey);

    if (isEnemyVillage && showEnemyBunks) {
      const report = enemyReportsData.get(coordKey);
      // Pré-calcula os dois ícones possíveis para centrar o par
      const c1 = classifyEnemyTroops(report.troops);
      const c2 = classifyEnemyTroops(report.troops_outside);
      const best = (c1.defPop >= c2.defPop) ? c1 : c2;
      const wantShield = best.defSize && best.defColor;
      // Em streamer mode, esconder ícones táticos (revelariam info tática)
      const tactical = streamerMode ? null : classifyEnemyTactical(report);
      const wantTactical = !!tactical;

      // Centragem: se ambos, pair width = 2*ICON + GAP, senão um único centrado
      const pairWidth = (wantShield && wantTactical) ? (ICON_SIZE * 2 + ICON_GAP) : ICON_SIZE;
      const startX = left + VILLAGE_W / 2 - pairWidth / 2;
      const delay = (Math.random() * 2).toFixed(1);
      const iconTop = top - Math.round(ICON_SIZE / 2);

      let cursor = startX;

      if (!alreadyEnemyShield && wantShield) {
        const shield = makeShieldElement(streamerMode ? STREAMER_SHIELD_COLOR : best.defColor, ICON_SIZE);
        shield.dataset.eosEnemyShield = coordKey;
        shield.title = streamerMode ? `Aldeia (${coordKey})` : `Inimigo bunker: ${best.defSize} (${coordKey})`;
        shield.className = animClass;
        shield.style.cssText += `;position:absolute;pointer-events:none;z-index:20;left:${cursor}px;top:${iconTop}px;animation-delay:${delay}s`;
        parent.insertBefore(shield, domVillage);
      }
      if (wantShield) cursor += ICON_SIZE + ICON_GAP;

      if (!alreadyEnemy && wantTactical) {
        const icon = document.createElement('div');
        icon.dataset.eosEnemy = coordKey;
        icon.title = `${tactical.title} (${coordKey})`;
        icon.className = animClass;
        const innerImgSz = Math.round(ICON_SIZE * 0.65);
        const emojiFs    = Math.round(ICON_SIZE * 0.75);
        icon.style.cssText = `position:absolute;pointer-events:none;z-index:20;left:${cursor}px;top:${iconTop}px;width:${ICON_SIZE}px;height:${ICON_SIZE}px;border-radius:50%;background:${tactical.bg};border:1px solid rgba(255,255,255,.6);box-shadow:0 0 3px ${tactical.bg}aa,0 1px 2px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;animation-delay:${delay}s;font-size:${emojiFs}px;line-height:1`;
        if (tactical.imgSrc) {
          const img = document.createElement('img');
          img.src = tactical.imgSrc;
          img.style.cssText = `width:${innerImgSz}px;height:${innerImgSz}px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.8))`;
          icon.appendChild(img);
        } else if (tactical.emoji) {
          const span = document.createElement('span');
          span.textContent = tactical.emoji;
          span.style.cssText = 'color:#fff;display:inline-block';
          icon.appendChild(span);
        }
        parent.insertBefore(icon, domVillage);
      }
    }
  }
}

function startShieldTracking() {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  // Primeiro render
  placeShields();

  // Observer: quando o TW adiciona/remove sectors (pan), recoloca escudos/ícones
  // Observa map_container mas só childList (não subtree) — muito mais leve
  const container = document.getElementById('map_container') || mapEl;
  let debounce = null;
  let lastRun = 0;
  const obs = new MutationObserver(() => {
    if (debounce) clearTimeout(debounce);
    // Debounce longo mas com force-run se já passou muito tempo
    const since = Date.now() - lastRun;
    const wait = since > 2000 ? 100 : 500;
    debounce = setTimeout(() => { lastRun = Date.now(); placeShields(); }, wait);
  });
  obs.observe(container, { childList: true, subtree: true });

  // Fallback periódico
  setInterval(placeShields, 30000);
}

function setupPopupObserver() {
  // Observa o popup nativo #map_popup para injetar dados de tropas
  const EOS_TROOP_ROW_ID = 'eos-troop-info';

  function injectTroopInfo() {
    const hasTribeData = mapVillageData && mapVillageData.size > 0;
    const hasEnemyData = enemyReportsData && enemyReportsData.size > 0;
    if (!hasTribeData && !hasEnemyData) return;

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

    const v = mapVillageData ? mapVillageData.get(coordKey) : null;
    const enemyReport = enemyReportsData ? enemyReportsData.get(coordKey) : null;

    console.log('[EOS tooltip]', coordKey, 'tribe:', !!v, 'enemy:', !!enemyReport,
      enemyReportsData ? 'totalEnemy=' + enemyReportsData.size : 'no enemy data');

    // Sem dados da tribo nem relatório inimigo → nada a mostrar
    if (!v && !enemyReport) return;

    // Não mostrar nas próprias aldeias (o jogo já dá essa info)
    if (v && v.player_name && currentPlayerName && v.player_name === currentPlayerName) return;

    const units = ['spear','sword','axe','spy','light','heavy','ram','catapult','snob'];

    // Decide a fonte dos dados (tribo > relatório inimigo)
    const isEnemy = !v && !!enemyReport;
    const t = v ? (v.troops || v.troops_total || v.troops_own) : enemyReport?.troops;
    // t pode ser {} (sabemos que é 0) para relatórios inimigos — ainda queremos mostrar
    if (!t && !(isEnemy && enemyReport.troops_outside)) return;

    const bt = classifyVillageForMap(t);

    const tbody = popup.querySelector('#info_content tbody');
    if (!tbody) return;

    const troopRow = document.createElement('tr');
    troopRow.id = EOS_TROOP_ROW_ID;

    const td = document.createElement('td');
    td.colSpan = 2;
    td.style.cssText = 'padding:4px 0;border-top:1px solid #ddd';

    // Badge do tipo
    let badgeHtml = '';
    if (isEnemy && !streamerMode) {
      badgeHtml = `<div style="display:inline-block;background:#c04040;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;margin-bottom:3px">INIMIGO</div> `;
    }
    if (bt && !streamerMode) {
      badgeHtml += `<div style="display:inline-block;background:${bt.color};color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;margin-bottom:3px">${bt.name}</div>`;
    }
    if (badgeHtml) badgeHtml += '<br>';

    function renderTroopsTable(troopsObj, labelText) {
      let html = '';
      if (labelText) html += `<div style="font-size:9px;color:#888;text-transform:uppercase;margin-top:4px;font-weight:700">${labelText}</div>`;
      html += '<table style="border-collapse:collapse;width:100%;margin-top:2px"><tr>';
      for (const u of units) {
        html += `<td style="text-align:center;padding:2px"><img src="/graphic/unit/unit_${u}.png" style="width:20px;height:20px;vertical-align:middle" title="${u}"></td>`;
      }
      html += '</tr><tr>';
      for (const u of units) {
        const val = (troopsObj && troopsObj[u]) || 0;
        // Streamer mode: mascara números com pontos (••••)
        const displayVal = streamerMode
          ? (val > 0 ? '••••' : '-')
          : (val > 0 ? fmtK(val) : '-');
        html += `<td style="text-align:center;font-size:13px;font-weight:700;color:${val > 0 ? '#000' : '#bbb'};padding:2px">${displayVal}</td>`;
      }
      html += '</tr></table>';
      return html;
    }

    // Para inimigos: se troops é {} (vazio), mostra tabela com zeros (sabemos que está vazia)
    const hasInVillage = isEnemy ? (enemyReport.troops !== null && enemyReport.troops !== undefined) : !!t;
    const hasOutside = isEnemy && !!enemyReport.troops_outside;

    let troopHtml = '';
    if (hasInVillage) {
      // Para relatórios de ataques nossos: "Tropas na aldeia" (inclui apoios)
      // Para relatórios de tribo: sem label (é óbvio)
      troopHtml += renderTroopsTable(t || {}, isEnemy ? 'Tropas na aldeia' : null);
    }
    if (hasOutside) {
      // "Pertencentes à aldeia" = as que vimos fora da aldeia (seguramente dele)
      troopHtml += renderTroopsTable(enemyReport.troops_outside, 'Tropas pertencentes à aldeia');
    }

    // Info do jogador e atualização
    let ownerHtml;
    if (isEnemy) {
      const ago = enemyReport.report_date ? timeAgoShort(enemyReport.report_date) : '?';
      const syncedBy = enemyReport.reported_by ? escapeHtml(enemyReport.reported_by) : '?';
      ownerHtml = `<div style="font-size:10px;color:#888;margin-top:4px">⚔ ${syncedBy} · Relatório de há ${ago}</div>`;
    } else {
      const updatedAgo = v.updated_at ? timeAgoShort(v.updated_at) : '?';
      ownerHtml = `<div style="font-size:10px;color:#888;margin-top:4px">👁 ${v.player_name} · Tropas atualizadas há ${updatedAgo}</div>`;
    }

    td.innerHTML = badgeHtml + troopHtml + ownerHtml;
    troopRow.appendChild(td);
    tbody.appendChild(troopRow);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function timeAgoShort(iso) {
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 2) return 'agora';
    if (min < 60) return min + 'm';
    const h = Math.floor(min / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }

  // Observa o popup do mapa diretamente (mais leve que document.body)
  let lastPopupCoord = '';
  let debouncePopup = null;
  function processPopup() {
    const popup = document.getElementById('map_popup');
    if (!popup || popup.offsetHeight === 0) return;
    const th = popup.querySelector('th');
    if (!th) return;
    const coordMatch = th.textContent.match(/\((\d+\|\d+)\)/);
    if (!coordMatch) return;
    const coord = coordMatch[1];
    if (coord === lastPopupCoord && popup.querySelector('#' + EOS_TROOP_ROW_ID)) return;
    lastPopupCoord = coord;
    const old = popup.querySelector('#' + EOS_TROOP_ROW_ID);
    if (old) old.remove();
    requestAnimationFrame(injectTroopInfo);
  }

  // Tenta observar o popup direto. Se não existe ainda, observa o map_container
  // (que é onde o popup aparece) com debounce
  function attachObserver() {
    const popup = document.getElementById('map_popup');
    if (popup) {
      const obs = new MutationObserver(() => {
        if (debouncePopup) clearTimeout(debouncePopup);
        debouncePopup = setTimeout(processPopup, 100);
      });
      obs.observe(popup, { childList: true, subtree: true, characterData: true });
      return true;
    }
    return false;
  }

  // Espera o popup existir antes de observar (evita observar document.body)
  if (!attachObserver()) {
    const checkInterval = setInterval(() => {
      if (attachObserver()) clearInterval(checkInterval);
    }, 1000);
    setTimeout(() => clearInterval(checkInterval), 30000);
  }
}

function fmtK(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
  return String(n);
}

async function checkUpdateNotification() {
  const { eosUpdateAvailable, eosUpdateVersion, eosUpdateUrl, eosUpdateChangelog } = await getStorage(
    'eosUpdateAvailable', 'eosUpdateVersion', 'eosUpdateUrl', 'eosUpdateChangelog'
  );
  if (!eosUpdateAvailable || !eosUpdateVersion) return;
  if (document.getElementById('eos-update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'eos-update-banner';
  banner.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483647;background:linear-gradient(135deg,#2a1808,#1a1008);border:1px solid #e8783040;border-left:3px solid #e87830;border-radius:8px;padding:12px 16px;font-family:Segoe UI,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.8);max-width:340px';

  const title = document.createElement('div');
  title.style.cssText = 'color:#f8c850;font-weight:700;font-size:13px;margin-bottom:4px';
  title.textContent = `🔄 Eye of Sauron v${eosUpdateVersion}`;

  const desc = document.createElement('div');
  desc.style.cssText = 'color:#b09878;font-size:11px;margin-bottom:10px;line-height:1.4';
  desc.textContent = eosUpdateChangelog || 'Nova versão disponível!';

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px';

  const downloadBtn = document.createElement('button');
  downloadBtn.style.cssText = 'flex:1;padding:7px 0;background:linear-gradient(135deg,#e87830,#c06020);color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:700;cursor:pointer';
  downloadBtn.textContent = 'Atualizar';
  downloadBtn.addEventListener('click', () => {
    if (eosUpdateUrl) window.open(eosUpdateUrl, '_blank');
    chrome.storage.local.set({ eosUpdateAvailable: false });
    banner.remove();
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.style.cssText = 'padding:7px 12px;background:transparent;color:#807060;border:1px solid #3a2a1a;border-radius:5px;font-size:12px;cursor:pointer';
  dismissBtn.textContent = 'Depois';
  dismissBtn.addEventListener('click', () => {
    banner.remove();
    // Não limpa eosUpdateAvailable — volta a aparecer na próxima página
  });

  btns.appendChild(downloadBtn);
  btns.appendChild(dismissBtn);
  banner.appendChild(title);
  banner.appendChild(desc);
  banner.appendChild(btns);
  document.body.appendChild(banner);
}

// ── Notificação fora do painel (canto direito da página) ────────────────────
let _eosNotifyTimeout = null;
function showEosNotification(text, icon) {
  let n = document.getElementById('eos-notification');
  if (!n) {
    n = document.createElement('div');
    n.id = 'eos-notification';
    n.style.cssText = 'position:fixed;top:80px;right:20px;z-index:2147483646;'
      + 'display:flex;align-items:center;gap:10px;'
      + 'background:linear-gradient(135deg,#2a1810,#1a1208);'
      + 'border:1px solid #e8783040;border-left:3px solid #e87830;'
      + 'border-radius:8px;padding:10px 16px;'
      + 'box-shadow:0 4px 20px rgba(0,0,0,.5);'
      + 'font-family:Segoe UI,system-ui,sans-serif;font-size:13px;'
      + 'color:#f0b878;font-weight:600;'
      + 'transition:opacity .2s, transform .2s;opacity:0;transform:translateX(20px)';
    document.body.appendChild(n);
  }
  // Atualiza estilo conforme tipo
  if (icon === 'ok') {
    n.style.background = 'linear-gradient(135deg,#1a2a10,#141a08)';
    n.style.borderColor = '#4caf50';
    n.style.borderLeftColor = '#4caf50';
    n.style.color = '#6fcf6f';
  } else if (icon === 'error') {
    n.style.background = 'linear-gradient(135deg,#2a1410,#1a0c08)';
    n.style.borderColor = '#5a2020';
    n.style.borderLeftColor = '#e05050';
    n.style.color = '#e07070';
  } else {
    n.style.background = 'linear-gradient(135deg,#2a1810,#1a1208)';
    n.style.borderColor = '#e8783040';
    n.style.borderLeftColor = '#e87830';
    n.style.color = '#f0b878';
  }
  // Conteúdo
  n.innerHTML = '';
  if (icon === 'loading') {
    const sp = document.createElement('span');
    sp.style.cssText = 'width:14px;height:14px;border:2px solid #3a2a1a;border-top-color:#e87830;border-radius:50%;display:inline-block;animation:eos-spin .8s linear infinite';
    n.appendChild(sp);
  } else if (icon === 'ok') {
    const ok = document.createElement('span');
    ok.textContent = '✔';
    ok.style.cssText = 'font-size:14px;font-weight:700';
    n.appendChild(ok);
  }
  const txt = document.createElement('span');
  txt.textContent = text;
  n.appendChild(txt);

  // Inject animation keyframes once
  if (!document.getElementById('eos-notify-anim')) {
    const st = document.createElement('style');
    st.id = 'eos-notify-anim';
    st.textContent = '@keyframes eos-spin { to { transform: rotate(360deg) } }';
    document.head.appendChild(st);
  }

  // Mostra
  requestAnimationFrame(() => {
    n.style.opacity = '1';
    n.style.transform = 'translateX(0)';
  });

  // Auto-hide após 2s
  if (_eosNotifyTimeout) clearTimeout(_eosNotifyTimeout);
  _eosNotifyTimeout = setTimeout(() => {
    n.style.opacity = '0';
    n.style.transform = 'translateX(20px)';
    setTimeout(() => n.remove(), 250);
  }, 2000);
}

// ── Sincronização de relatórios inimigos ───────────────────────────────────

// Lê uma tabela de tropas do TW e devolve quantidade + baixas por unidade.
// Formato:
// Linha: imgs das unidades (unit_spear.png etc)
// Linha: "Quantidade:" + valores
// Linha: "Baixas:" + valores (opcional)
// Retorna { quantity: {unit: N}, losses: {unit: N}, remaining: {unit: N} }
// `remaining` é calculado como max(0, quantity - losses).
// Retorna null se não conseguiu ler a tabela.
// Registrado como builtin para recipes poderem chamar via { op: 'call', fn: 'readUnitsTable' }
function readUnitsTable(table) {
  if (!table) return null;
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length < 2) return null;

  // Linha das imgs das unidades
  let unitRow = null;
  for (const row of rows) {
    if (row.querySelector('img[src*="unit_"]')) { unitRow = row; break; }
  }
  if (!unitRow) return null;

  // Procura linhas Quantidade e Baixas por label
  let quantRow = null, lossesRow = null;
  for (const row of rows) {
    const firstCell = row.querySelector('td, th');
    if (!firstCell) continue;
    const label = (firstCell.textContent || '').toLowerCase().trim();
    if (!quantRow && label.includes('quantidade')) quantRow = row;
    else if (!lossesRow && (label.includes('baixa') || label.includes('losses'))) lossesRow = row;
  }
  // Fallback: sem labels, assume primeira linha de números após unitRow é quantidade, segunda é baixas
  if (!quantRow) {
    const unitIdx = rows.indexOf(unitRow);
    const numRows = [];
    for (let i = unitIdx + 1; i < rows.length; i++) {
      const tds = rows[i].querySelectorAll('td, th');
      let hasNumbers = false;
      for (const td of tds) if (/\d/.test(td.textContent || '')) { hasNumbers = true; break; }
      if (hasNumbers) numRows.push(rows[i]);
    }
    if (numRows[0]) quantRow = numRows[0];
    if (numRows[1]) lossesRow = numRows[1];
  }
  if (!quantRow) return null;

  function readRowValues(row, unitRowRef) {
    // Lista ordenada de unidades que aparecem em imgs na unit row
    const unitImgs = Array.from(unitRowRef.querySelectorAll('img[src*="unit_"]'));
    const units = unitImgs.map(img => {
      const m = (img.getAttribute('src') || '').match(/unit_(\w+)\.(?:png|webp|gif)/);
      return m ? m[1] : null;
    });

    // Lista de cells da value row, filtrando cells de LABEL (não numéricas)
    // Uma cell é "numérica" se o seu textContent trimmed contém dígitos ou é apenas "-"/"0"
    const valCells = Array.from(row.children);
    const numericCells = valCells.filter(td => {
      const t = (td.textContent || '').trim();
      if (!t) return false;
      // Label tipicamente termina com ":" (ex: "Quantidade:", "Baixas:")
      if (/:$/.test(t)) return false;
      // Label com palavras (mais de 3 chars não-dígitos)
      if (/^[a-záàéêíóôõúç\s]{4,}$/i.test(t)) return false;
      return /[\d\-]/.test(t);
    });

    const result = {};
    units.forEach((unit, i) => {
      if (!unit) return;
      const cell = numericCells[i];
      if (!cell) return;
      const n = parseInt((cell.textContent || '').replace(/\D/g, '')) || 0;
      result[unit] = n;
    });
    return result;
  }

  const quantity = readRowValues(quantRow, unitRow);
  const losses   = lossesRow ? readRowValues(lossesRow, unitRow) : {};

  // Remaining = quantidade - baixas (nunca negativo)
  const remaining = {};
  for (const unit of Object.keys(quantity)) {
    remaining[unit] = Math.max(0, (quantity[unit] || 0) - (losses[unit] || 0));
  }

  return { quantity, losses, remaining };
}

// Extrai info de um bloco (atacante ou defensor) — player, tribo, coords da aldeia
function extractPartyInfo(block) {
  if (!block) return null;
  const info = { playerName: null, tribeName: null, villageCoords: null, villageName: null };
  const playerLink = block.querySelector('a[href*="screen=info_player"]');
  if (playerLink) info.playerName = playerLink.textContent.trim();
  const tribeLink = block.querySelector('a[href*="screen=info_ally"]');
  if (tribeLink) info.tribeName = tribeLink.textContent.trim();
  const villageLinks = block.querySelectorAll('a[href*="screen=info_village"]');
  for (const a of villageLinks) {
    const m = a.textContent.match(/\((\d+\|\d+)\)/);
    if (m) {
      info.villageCoords = m[1];
      info.villageName = a.textContent.replace(/\s*\(\d+\|\d+\)\s*/, '').trim();
      break;
    }
  }
  return info;
}

function parseReport() {
  // Tenta recipe servidor primeiro
  const recipe = EOS_CONFIG?.recipes?.parseReport;
  if (recipe) {
    try {
      const result = runRecipe(recipe);
      if (result && result.attacker && result.defender) return result;
      console.warn('[EOS report] Recipe parseReport devolveu resultado inválido, a usar fallback JS');
    } catch (e) {
      console.warn('[EOS report] Recipe parseReport falhou:', e, '— a usar fallback JS');
    }
  }
  // Fallback JS legacy
  const attBlock = eosSel('reportAttBlock');
  const defBlock = eosSel('reportDefBlock');

  const attacker = extractPartyInfo(attBlock);
  const defender = extractPartyInfo(defBlock);

  if (!attacker || !defender) {
    console.warn('[EOS report] Sem atacante ou defensor');
    return null;
  }

  // Lê tabelas de unidades
  const attUnits = readUnitsTable(document.querySelector(EOS_CONFIG.selectors.reportAttUnits));
  const defUnits = readUnitsTable(document.querySelector(EOS_CONFIG.selectors.reportDefUnits));

  // Tropas na aldeia do defensor após o ataque (remaining = quantidade - baixas)
  const defenderTroopsRemaining = defUnits ? defUnits.remaining : null;

  // Tropas fora da aldeia — "Unidades fora da aldeia"
  // Aqui não há baixas, então remaining = quantity
  let troopsOutside = null;
  const awayTable = document.querySelector('#attack_spy_away')
    || document.querySelector('#attack_spy_away_units')
    || document.querySelector('#attack_info_away');
  let awayResult = null;
  if (awayTable) {
    awayResult = readUnitsTable(awayTable);
  }
  if (!awayResult) {
    // Fallback: procura heading "Unidades fora da aldeia" e a tabela seguinte
    const headings = document.querySelectorAll('h3, h4, th, b, strong, .report-title, caption');
    for (const h of headings) {
      if (/unidades\s+fora\s+da\s+aldeia/i.test(h.textContent || '')) {
        let next = h.nextElementSibling;
        while (next && !next.querySelector('img[src*="unit_"]')) next = next.nextElementSibling;
        const parentTable = h.closest('table');
        if (!next && parentTable) awayResult = readUnitsTable(parentTable);
        else if (next) awayResult = readUnitsTable(next.tagName === 'TABLE' ? next : next.querySelector('table'));
        if (awayResult) break;
      }
    }
  }
  if (awayResult) {
    // Filtra só unidades com valor > 0. {} = tabela vista mas vazia (sinal wipe).
    troopsOutside = {};
    for (const [u, n] of Object.entries(awayResult.quantity)) {
      if (n > 0) troopsOutside[u] = n;
    }
    // não converte {} para null — o {} é o sinal que a aldeia está sem pertencentes
  }

  // Data do relatório — prioridade:
  // 1. "Tempo de batalha" explícito (procura <th>/<td> com esse texto)
  // 2. Atributo data-timestamp em qualquer elemento do relatório
  // 3. Fallback: qualquer data-hora no content_value
  let reportDate = null;

  function parseDateStr(str) {
    if (!str) return null;
    // Formatos: "dd/mm/yyyy HH:MM" ou "dd/mm HH:MM" (ano atual)
    let m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:[àasem\s]*)?\s*(\d{1,2}):(\d{2})/);
    if (m) {
      const [, d, mo, y, hh, mm] = m;
      return new Date(+y, +mo - 1, +d, +hh, +mm).toISOString();
    }
    m = str.match(/(\d{1,2})\/(\d{1,2})\s*(?:[àasem\s]*)?\s*(\d{1,2}):(\d{2})/);
    if (m) {
      const [, d, mo, hh, mm] = m;
      const now = new Date();
      let year = now.getFullYear();
      // Se a data parece futura, é do ano passado
      const parsed = new Date(year, +mo - 1, +d, +hh, +mm);
      if (parsed > now) parsed.setFullYear(year - 1);
      return parsed.toISOString();
    }
    return null;
  }

  // 1. Procura "Tempo de batalha" no header do relatório
  const headerTable = document.querySelector('#content_value table');
  if (headerTable) {
    const ths = headerTable.querySelectorAll('th');
    for (const th of ths) {
      if (/tempo\s+de\s+batalha/i.test(th.textContent || '')) {
        const td = th.nextElementSibling;
        if (td) {
          reportDate = parseDateStr(td.textContent || '');
          if (reportDate) break;
        }
      }
    }
  }

  // 2. Fallback: procura data-timestamp
  if (!reportDate) {
    const tsEl = document.querySelector('[data-timestamp]');
    if (tsEl) {
      const ts = parseInt(tsEl.getAttribute('data-timestamp'));
      if (ts > 0) reportDate = new Date(ts * 1000).toISOString();
    }
  }

  // 3. Fallback: qualquer data-hora no texto
  if (!reportDate) {
    const allText = document.querySelector('#content_value')?.textContent || '';
    reportDate = parseDateStr(allText);
  }

  if (!reportDate) {
    console.warn('[EOS report] Não encontrou data do relatório, a usar "agora"');
    reportDate = new Date().toISOString();
  }

  // Edifícios (se relatório de espionagem)
  let wallLevel = null;
  const buildings = {};
  const buildingsTable = document.querySelector('#attack_spy_building_data') || document.querySelector('#attack_info_building');
  if (buildingsTable) {
    const data = buildingsTable.getAttribute('data-buildings') || buildingsTable.textContent;
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        for (const b of parsed) {
          if (b.name && b.level != null) buildings[b.name] = b.level;
        }
        if (buildings.wall != null) wallLevel = buildings.wall;
      }
    } catch (_) {}
  }

  return {
    attacker,
    defender,
    defenderTroopsRemaining,
    attackerTroopsSent: attUnits ? attUnits.quantity : null,
    attackerTroopsLosses: attUnits ? attUnits.losses : null,
    troopsOutside,       // "Unidades fora da aldeia" (só existe em relatórios de espionagem/ataque nosso)
    buildings: Object.keys(buildings).length > 0 ? buildings : null,
    wallLevel,
    reportDate,
  };
}

// Decide qual é a aldeia inimiga e constrói o payload a enviar ao servidor
// Retorna { payload, reason } ou { skip: 'motivo' }
function buildEnemyReportPayload(parsed, selfPlayerName, selfTribeName) {
  if (!parsed) return { skip: 'Não foi possível ler o relatório' };
  const { attacker, defender, defenderTroopsRemaining, attackerTroopsSent, attackerTroopsLosses, troopsOutside, buildings, wallLevel, reportDate } = parsed;

  const isDefenderSelf = defender.playerName === selfPlayerName
    || (selfTribeName && defender.tribeName === selfTribeName);
  const isAttackerSelf = attacker.playerName === selfPlayerName
    || (selfTribeName && attacker.tribeName === selfTribeName);

  // Caso 1: Ataque nosso — defensor é o inimigo, guardamos "tropas na aldeia" (remaining)
  if (isAttackerSelf && !isDefenderSelf && defender.villageCoords) {
    // Se matámos tudo na aldeia E não há pertencentes fora → marca wipe (objeto vazio = confirmado 0)
    const remainingAllZero = defenderTroopsRemaining
      && Object.values(defenderTroopsRemaining).every(v => !v || v === 0);
    const troopsOutsideOut = remainingAllZero && !troopsOutside ? {} : troopsOutside;
    return {
      payload: {
        village_coords:    defender.villageCoords,
        village_name:      defender.villageName,
        owner_player_name: defender.playerName,
        owner_tribe_name:  defender.tribeName,
        troops:            defenderTroopsRemaining,
        troops_outside:    troopsOutsideOut,
        buildings, wall_level: wallLevel,
        report_date:       reportDate,
      },
      reason: 'attack',
    };
  }

  // Caso 2: Defesa nossa — atacante é o inimigo, guardamos "tropas que sobreviveram" como pertencentes
  if (isDefenderSelf && !isAttackerSelf && attacker.villageCoords) {
    // Tropas do atacante que sobreviveram = sent - losses. Pertencem à aldeia do atacante.
    const survivors = {};
    if (attackerTroopsSent) {
      for (const unit of Object.keys(attackerTroopsSent)) {
        const sent = attackerTroopsSent[unit] || 0;
        const lost = (attackerTroopsLosses && attackerTroopsLosses[unit]) || 0;
        const alive = Math.max(0, sent - lost);
        if (alive > 0) survivors[unit] = alive;
      }
    }
    // Se o atacante mandou tropas E matámos todas → {} (wiped), senão os sobreviventes
    const sentAny = attackerTroopsSent && Object.values(attackerTroopsSent).some(v => v > 0);
    const troopsOutsideOut = Object.keys(survivors).length > 0
      ? survivors
      : (sentAny ? {} : null);  // {} = confirmado vazio; null = desconhecido
    // Tropas do inimigo que NÓS matámos (para subtração cumulativa no servidor)
    const killed = {};
    if (attackerTroopsLosses) {
      for (const [u, n] of Object.entries(attackerTroopsLosses)) {
        if (n > 0) killed[u] = n;
      }
    }
    return {
      payload: {
        village_coords:    attacker.villageCoords,
        village_name:      attacker.villageName,
        owner_player_name: attacker.playerName,
        owner_tribe_name:  attacker.tribeName,
        troops:            null,
        troops_outside:    troopsOutsideOut,
        troops_killed:     Object.keys(killed).length > 0 ? killed : null,
        buildings: null, wall_level: null,
        report_date:       reportDate,
      },
      reason: 'defense',
    };
  }

  if (isAttackerSelf && isDefenderSelf) return { skip: 'Ataque interno (membro da tribo)' };
  if (!isAttackerSelf && !isDefenderSelf) return { skip: 'Relatório não te envolve' };
  return { skip: 'Não foi possível determinar a aldeia inimiga' };
}

function injectSyncReportButton() {
  if (!isReportPage()) return;
  if (document.getElementById('eos-sync-report-btn')) return;

  // Inserir no topo do conteúdo do relatório
  const contentValue = document.getElementById('content_value');
  if (!contentValue) return;

  const btn = document.createElement('button');
  btn.id = 'eos-sync-report-btn';
  btn.textContent = '👁 Sincronizar com EOS';
  btn.style.cssText = 'margin:8px 0;padding:6px 14px;'
    + 'background:linear-gradient(180deg,#e87830,#c04818);color:#fff;'
    + 'border:1px solid #f0a040;border-radius:5px;'
    + 'font-size:12px;font-weight:700;cursor:pointer;'
    + 'box-shadow:0 2px 8px rgba(232,80,32,.4)';

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '⏳ A sincronizar...';
    try {
      const parsed = parseReport();
      console.log('[EOS report] parsed:', parsed);

      const { token, playerName, tribeName } = await getWorldStorage('token', 'playerName', 'tribeName');
      if (!token) throw new Error('Sem autenticação EOS');

      const result = buildEnemyReportPayload(parsed, playerName, tribeName);
      if (result.skip) throw new Error(result.skip);
      const { payload, reason } = result;
      console.log('[EOS report POST] payload:', payload, '| reason:', reason,
        '| troops_outside is {}?', payload.troops_outside && Object.keys(payload.troops_outside).length === 0);

      const res = await fetch(`${EOS_SERVER}/api/enemy-reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-EOS-Version': chrome.runtime.getManifest().version,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Erro: ${res.status}`);

      btn.textContent = reason === 'defense' ? '✔ Defesa sincronizada' : '✔ Ataque sincronizado';
      btn.style.background = 'linear-gradient(180deg,#4caf50,#2d8030)';
    } catch (e) {
      btn.textContent = `❌ ${e.message}`;
      btn.disabled = false;
      setTimeout(() => { btn.textContent = '👁 Sincronizar com EOS'; }, 4000);
    }
  });

  contentValue.insertBefore(btn, contentValue.firstChild);
}

// ── Auto-processar apoio em place.php?mode=call ────────────────────────────
async function autoFillSupportIfPending() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('screen') !== 'place' || params.get('mode') !== 'call') return;

  const data = await getWorldStorage('pendingSupportTargetVid', 'pendingSupportTroops', 'pendingSupportGroupId', 'pendingSupportGroupName');
  if (!data.pendingSupportTargetVid || !data.pendingSupportTroops) return;

  const urlTarget = params.get('target');
  if (urlTarget !== String(data.pendingSupportTargetVid)) return;

  const troops = data.pendingSupportTroops;
  const groupId = data.pendingSupportGroupId || '0';
  const groupName = data.pendingSupportGroupName || 'Todos';

  // Passo 1: seleciona grupo (se não "Todos" e se ainda não clicou)
  const groupClicked = sessionStorage.getItem('eos_support_group_clicked') === groupId;
  if (!groupClicked && !isGroupAlreadySelected(groupId)) {
    const el = await waitForGroupElement(groupId);
    if (el) {
      sessionStorage.setItem('eos_support_group_clicked', groupId);
      el.click();
      return;  // A página recarrega
    }
  }
  sessionStorage.removeItem('eos_support_group_clicked');

  // Passo 2: clica "Todos" na paginação
  const pagClicked = sessionStorage.getItem('eos_support_pagination_clicked') === '1';
  if (!pagClicked) {
    const pagTodos = await new Promise(resolve => {
      const find = () => Array.from(document.querySelectorAll('a.paged-nav-item'))
        .find(a => /todos/i.test(a.textContent.trim())) || null;
      const el = find();
      if (el) return resolve(el);
      let attempts = 0;
      const check = setInterval(() => {
        const el = find();
        if (el) { clearInterval(check); resolve(el); }
        else if (++attempts > 8) { clearInterval(check); resolve(null); }
      }, 300);
    });
    if (pagTodos) {
      sessionStorage.setItem('eos_support_pagination_clicked', '1');
      pagTodos.click();
      return;
    }
  }
  sessionStorage.removeItem('eos_support_pagination_clicked');

  // Passo 3: injeta botão "Enviar apoio" com as tropas requisitadas
  // Limpa flag para não re-processar
  await setWorldStorage({
    pendingSupportTargetVid: null,
    pendingSupportTroops:    null,
    pendingSupportGroupId:   null,
    pendingSupportGroupName: null,
  });

  injectSupportSendButton(troops, groupId, groupName);
}

// Injeta a lógica no MAIN world (com acesso ao jQuery do TW) — replica
// o supportSender de referência verbatim, recebendo apenas o objeto de tropas.
function fillSupportInputsInPage(troopsRequested) {
  // CSP bloqueia inline scripts no TW — pede ao background para executar em MAIN world
  chrome.runtime.sendMessage({ type: 'FILL_SUPPORT_MAIN', troops: troopsRequested });
  return true;
}

// Distribui tropas pedidas pelas aldeias do place&mode=call.
// Replica fielmente o supportSender de referência:
//   1) check/uncheck checkboxes de unidades no header (cb_${unit})
//   2) clica #place_call_select_all (seleciona todas as aldeias)
//   3) limpa todos os inputs visíveis a 0
//   4) algoritmo: factor = total/nAldeias; sort ascendente por disponibilidade;
//      redistribui défice; arredondamento aleatório por fração decimal
//   5) escreve valor em .call-unit-box-${unit} de cada linha (dispatch input/change)
function fillSupportInputs(troopsRequested) {
  const table = document.getElementById('village_troup_list');
  if (!table) {
    console.warn('[EOS support] #village_troup_list não encontrada');
    return false;
  }

  // ── 1) Header: marcar/desmarcar checkboxes de unidades (cb_${unit}) ──
  // Reproduz: village_troup_list.children[0].children[0].getElementsByTagName("input")
  const requestedUnits = Object.entries(troopsRequested)
    .filter(([_, v]) => v && v > 0)
    .map(([u]) => u);
  try {
    const headerInputs = table.children[0]?.children[0]?.getElementsByTagName('input') || [];
    for (let i = 0; i < headerInputs.length - 1; i++) {
      const id = headerInputs[i].id.split('_')[1];
      if (!id) continue;
      const shouldCheck = requestedUnits.includes(id);
      headerInputs[i].checked = shouldCheck;
      headerInputs[i].dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch (e) {
    console.warn('[EOS support] header checkboxes:', e);
  }

  // ── 2) Clica "selecionar todas as aldeias" ──
  const selectAllBtn = document.getElementById('place_call_select_all');
  if (selectAllBtn) {
    try { selectAllBtn.click(); } catch (_) {}
  } else {
    console.warn('[EOS support] #place_call_select_all não encontrado');
  }

  // ── 3) Limpa todos os inputs visíveis a 0 ──
  const allInputs = table.querySelectorAll('input[type="number"]');
  for (const inp of allInputs) {
    if (inp.offsetParent !== null) inp.value = '0';
  }

  // ── 4) Lê tropas disponíveis por aldeia e prepara estrutura ──
  // Cada linha de aldeia tem .call-unit-box-X visível
  const rows = Array.from(table.querySelectorAll('tr')).filter(r =>
    r.querySelector('input.call-unit-box-spear, input.call-unit-box-axe, input.call-unit-box-sword, input.call-unit-box-light, input.call-unit-box-heavy, input.call-unit-box-spy')
  );
  if (rows.length === 0) {
    console.warn('[EOS support] Sem linhas de aldeias com inputs call-unit-box');
    return false;
  }
  const rowData = rows.map(row => {
    const available = {};
    for (const unit of TROOP_NAMES) {
      // Reproduz: $(row).find(`[data-unit='${u}']`).text()
      const cell = row.querySelector(`[data-unit='${unit}']`);
      available[unit] = cell ? (parseInt((cell.textContent || '').replace(/\D/g, '')) || 0) : 0;
    }
    return { row, available, assigned: {} };
  });

  // Validação total pedido vs disponível
  const insufficient = [];
  for (const [unit, requested] of Object.entries(troopsRequested)) {
    if (!requested || requested <= 0) continue;
    const total = rowData.reduce((s, r) => s + (r.available[unit] || 0), 0);
    if (requested > total) insufficient.push(`${unit}: ${requested}/${total}`);
  }
  if (insufficient.length > 0) {
    const msg = 'Tropas insuficientes — ' + insufficient.join(', ');
    console.warn('[EOS support]', msg);
    if (window.UI && typeof window.UI.ErrorMessage === 'function') {
      try { window.UI.ErrorMessage(msg, 4000); } catch (_) {}
    }
  }

  // ── 5) Algoritmo de distribuição (clone do supportSender) ──
  for (const [unit, requested] of Object.entries(troopsRequested)) {
    if (!requested || requested <= 0) continue;
    let factor = requested / rowData.length;
    const sorted = [...rowData].sort((a, b) => a.available[unit] - b.available[unit]);
    for (let i = 0; i < sorted.length; i++) {
      const avail = sorted[i].available[unit];
      if (avail < factor) {
        const deficit = factor - avail;
        const remaining = sorted.length - i - 1;
        if (remaining > 0) factor += deficit / remaining;
        sorted[i].assigned[unit] = avail;
      } else {
        const intPart = Math.floor(factor);
        const frac = factor - intPart;
        if (avail + 1 > factor) {
          sorted[i].assigned[unit] = intPart + (Math.random() < frac ? 1 : 0);
        } else {
          sorted[i].assigned[unit] = Math.floor(factor);
        }
      }
    }
  }

  // ── 6) Escreve valores nos inputs .call-unit-box-${unit} ──
  let totalFilled = 0;
  for (const { row, assigned } of rowData) {
    for (const [unit, value] of Object.entries(assigned)) {
      const v = Math.floor(value);
      if (v <= 0) continue;
      const input = row.querySelector(`input.call-unit-box-${unit}`);
      if (input) {
        input.value = String(v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        totalFilled++;
      }
    }
  }

  console.log('[EOS support] Inputs preenchidos:', totalFilled, '| aldeias:', rowData.length);
  return totalFilled > 0;
}

async function waitForCallTable(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = document.getElementById('village_troup_list');
    if (t && t.querySelectorAll('input.call-unit-box-spear, input.call-unit-box-axe, input.call-unit-box-sword').length > 0) return t;
    await new Promise(r => setTimeout(r, 150));
  }
  return null;
}

async function injectSupportSendButton(troops, groupId, groupName) {
  if (document.getElementById('eos-send-support-btn')) return;

  // Espera tabela renderizar antes de preencher
  await waitForCallTable();
  // Pequeno delay extra para o JS do TW inicializar handlers
  await new Promise(r => setTimeout(r, 400));
  // Usa a versão MAIN-world (acede ao jQuery do TW)
  const filled = fillSupportInputsInPage(troops);

  const container = document.createElement('div');
  container.id = 'eos-send-support-container';
  container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;'
    + 'background:linear-gradient(135deg,#2a1810,#1a1208);'
    + 'border:2px solid #e87830;border-radius:10px;padding:14px 18px;'
    + 'box-shadow:0 4px 24px rgba(232,80,32,.4);'
    + 'font-family:Segoe UI,sans-serif;color:#f0e0c8;max-width:320px';

  const title = document.createElement('div');
  title.textContent = filled
    ? `⚔ Apoio requisitado (grupo: ${groupName}) — preenchido`
    : `⚔ Apoio requisitado (grupo: ${groupName}) — ⚠ não preencheu`;
  title.style.cssText = 'font-size:12px;font-weight:700;color:#f0b878;margin-bottom:8px';
  container.appendChild(title);

  const troopsDiv = document.createElement('div');
  troopsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px';
  for (const [unit, count] of Object.entries(troops)) {
    if (!count) continue;
    const item = document.createElement('div');
    item.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:12px';
    item.innerHTML = `<img src="/graphic/unit/unit_${unit}.png" style="width:14px;height:14px"> <span style="font-weight:600">${count}</span>`;
    troopsDiv.appendChild(item);
  }
  container.appendChild(troopsDiv);

  const btn = document.createElement('button');
  btn.id = 'eos-send-support-btn';
  btn.textContent = 'Enviar apoio';
  btn.style.cssText = 'width:100%;padding:10px;background:linear-gradient(180deg,#4caf50,#2d8030);'
    + 'color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;'
    + 'box-shadow:0 2px 8px rgba(76,175,80,.4)';

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = '⏳ A clicar no botão do TW...';
    chrome.runtime.sendMessage({ type: 'CLICK_TW_SUPPORT_SUBMIT' });
    setTimeout(() => {
      btn.textContent = '✔ Submetido — confirma no popup do TW';
    }, 600);
  });

  container.appendChild(btn);
  document.body.appendChild(container);
}

// Registo de funções built-in disponíveis para recipes
registerRecipeFn('readUnitsTable', readUnitsTable);
registerRecipeFn('extractParty', extractPartyInfo);

// Parse de data de relatório (Tempo de batalha + fallbacks)
registerRecipeFn('parseReportDate', () => {
  function parseDateStr(str) {
    if (!str) return null;
    let m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:[àasem\s]*)?\s*(\d{1,2}):(\d{2})/);
    if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]).toISOString();
    m = str.match(/(\d{1,2})\/(\d{1,2})\s*(?:[àasem\s]*)?\s*(\d{1,2}):(\d{2})/);
    if (m) {
      const now = new Date();
      const parsed = new Date(now.getFullYear(), +m[2]-1, +m[1], +m[3], +m[4]);
      if (parsed > now) parsed.setFullYear(now.getFullYear()-1);
      return parsed.toISOString();
    }
    return null;
  }
  // 1. Procura explicitamente "Tempo de batalha"
  const headerTable = document.querySelector('#content_value table');
  if (headerTable) {
    for (const th of headerTable.querySelectorAll('th')) {
      if (/tempo\s+de\s+batalha/i.test(th.textContent || '')) {
        const td = th.nextElementSibling;
        if (td) { const d = parseDateStr(td.textContent || ''); if (d) return d; }
      }
    }
  }
  // 2. data-timestamp
  const tsEl = document.querySelector('[data-timestamp]');
  if (tsEl) {
    const ts = parseInt(tsEl.getAttribute('data-timestamp'));
    if (ts > 0) return new Date(ts * 1000).toISOString();
  }
  // 3. fallback
  const allText = document.querySelector('#content_value')?.textContent || '';
  return parseDateStr(allText) || new Date().toISOString();
});

// Parse de edifícios (spy report)
registerRecipeFn('parseReportBuildings', () => {
  const buildingsTable = document.querySelector('#attack_spy_building_data') || document.querySelector('#attack_info_building');
  if (!buildingsTable) return { buildings: null, wallLevel: null };
  const data = buildingsTable.getAttribute('data-buildings') || buildingsTable.textContent;
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      const buildings = {};
      for (const b of parsed) if (b.name && b.level != null) buildings[b.name] = b.level;
      return { buildings: Object.keys(buildings).length ? buildings : null, wallLevel: buildings.wall ?? null };
    }
  } catch (_) {}
  return { buildings: null, wallLevel: null };
});

// Filtra objecto para só ter unidades com valor > 0
registerRecipeFn('filterNonZero', (obj) => {
  if (!obj) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v > 0) out[k] = v;
  // {} (objeto vazio) = tabela vista mas sem tropas → sinal de wipe a jusante
  return out;
});

// Acesso a sub-objeto por chave (útil para chaining em recipes)
registerRecipeFn('getKey', (obj, key) => obj?.[key] ?? null);

// Procura tabela "Unidades fora da aldeia" (com fallback por heading)
registerRecipeFn('findAwayTable', () => {
  const direct = document.querySelector('#attack_spy_away')
    || document.querySelector('#attack_spy_away_units')
    || document.querySelector('#attack_info_away');
  if (direct) return readUnitsTable(direct);
  const headings = document.querySelectorAll('h3, h4, th, b, strong, .report-title, caption');
  for (const h of headings) {
    if (/unidades\s+fora\s+da\s+aldeia/i.test(h.textContent || '')) {
      let next = h.nextElementSibling;
      while (next && !next.querySelector('img[src*="unit_"]')) next = next.nextElementSibling;
      const parentTable = h.closest('table');
      if (!next && parentTable) return readUnitsTable(parentTable);
      if (next) return readUnitsTable(next.tagName === 'TABLE' ? next : next.querySelector('table'));
    }
  }
  return null;
});

function boot() { main(); waitForQuestlog(); checkTroopConfirmation(); initMapOverlay(); checkUpdateNotification(); injectSyncReportButton(); autoFillSupportIfPending(); checkPendingSupportRequests(); }

// Verifica pedidos de apoio pendentes para o jogador atual e mostra banner persistente
async function checkPendingSupportRequests() {
  // Só em páginas de jogo
  if (!/game\.php/.test(window.location.href)) return;
  // Não mostrar na própria place&mode=call (já estamos a tratar)
  const params = new URLSearchParams(window.location.search);
  if (params.get('screen') === 'place' && params.get('mode') === 'call') return;

  async function poll() {
    try {
      const { token } = await getWorldStorage('token');
      if (!token) return;
      const res = await fetch(`${EOS_SERVER}/api/support-requests?mine=true`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EOS-Version': chrome.runtime.getManifest().version,
        }, cache: 'no-store'
      });
      if (!res.ok) return;
      const data = await res.json();
      const pending = (data.requests || []).filter(r => r.status === 'pending');
      if (pending.length > 0) showSupportRequestBanner(pending);
      else removeSupportRequestBanner();
    } catch (_) {}
  }
  poll();
  setInterval(poll, 5 * 60 * 1000);  // refresh a cada 5min
}

function removeSupportRequestBanner() {
  const el = document.getElementById('eos-support-request-banner');
  if (el) el.remove();
}

function showSupportRequestBanner(requests) {
  let banner = document.getElementById('eos-support-request-banner');
  if (banner) banner.remove();

  banner = document.createElement('div');
  banner.id = 'eos-support-request-banner';
  banner.style.cssText = 'position:fixed;top:60px;right:20px;z-index:2147483646;'
    + 'max-width:340px;background:linear-gradient(135deg,#3a1a08,#2a1208);'
    + 'border:2px solid #e87830;border-radius:10px;padding:14px 16px;'
    + 'box-shadow:0 6px 24px rgba(232,80,32,.5);'
    + 'font-family:Segoe UI,sans-serif;color:#f0e0c8;'
    + 'animation:eos-pulse 2s ease-in-out infinite';

  if (!document.getElementById('eos-pulse-anim')) {
    const st = document.createElement('style');
    st.id = 'eos-pulse-anim';
    st.textContent = '@keyframes eos-pulse { 0%,100%{box-shadow:0 6px 24px rgba(232,120,48,.4)} 50%{box-shadow:0 6px 28px rgba(232,120,48,.8)} }';
    document.head.appendChild(st);
  }

  const title = document.createElement('div');
  title.style.cssText = 'font-size:11px;font-weight:700;color:#f8c048;text-transform:uppercase;letterSpacing:1px;margin-bottom:8px';
  title.textContent = `⚔ ${requests.length} pedido${requests.length>1?'s':''} de apoio`;
  banner.appendChild(title);

  for (const r of requests.slice(0, 3)) {
    const item = document.createElement('div');
    item.style.cssText = 'font-size:12px;line-height:1.4;margin-bottom:6px;color:#f0e0c8';
    item.innerHTML = `A liderança pediu-te apoio à aldeia <b style="color:#f0b878">${r.target_village_coords}</b>`;
    banner.appendChild(item);
  }
  if (requests.length > 3) {
    const more = document.createElement('div');
    more.style.cssText = 'font-size:11px;color:#a09080;margin-bottom:6px';
    more.textContent = `... e mais ${requests.length - 3}`;
    banner.appendChild(more);
  }

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:6px;margin-top:8px';

  const openBtn = document.createElement('button');
  openBtn.textContent = 'Abrir painel';
  openBtn.style.cssText = 'flex:1;padding:7px;background:linear-gradient(180deg,#4caf50,#2d8030);'
    + 'color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:700;cursor:pointer';
  openBtn.onclick = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_PANEL' });
  };
  btnRow.appendChild(openBtn);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = 'Fechar (volta a aparecer no próximo refresh)';
  closeBtn.style.cssText = 'padding:7px 10px;background:transparent;color:#a09080;'
    + 'border:1px solid #5a4020;border-radius:5px;font-size:12px;cursor:pointer';
  closeBtn.onclick = () => banner.remove();
  btnRow.appendChild(closeBtn);

  banner.appendChild(btnRow);
  document.body.appendChild(banner);
}
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
    if (event.data.type === 'EOS_NOTIFY') {
      showEosNotification(event.data.text || '', event.data.icon || 'info');
      return;
    }
    if (event.data.type === 'EOS_SYNC_SCHEDULES') {
      getWorldStorage('token').then(({ token }) => {
        if (token) chrome.runtime.sendMessage({ type: 'SYNC_SCHEDULES', token, world: CURRENT_WORLD });
      });
      return;
    }

    if (event.data.type === 'EOS_SET_STREAMER_MODE') {
      const v = !!event.data.value;
      streamerMode = v;
      chrome.storage.local.set({ eosStreamerMode: v });
      // Re-render mapa imediato
      document.querySelectorAll('[data-eos-shield],[data-eos-enemy],[data-eos-enemy-shield]').forEach(el => el.remove());
      if (eosMapEnabled) placeShields();
      return;
    }

    if (event.data.type === 'EOS_EXTRACT_GROUPS_REQUEST') {
      const url = `https://${CURRENT_WORLD}.tribalwars.com.pt/game.php?screen=overview_villages&mode=groups`;
      chrome.storage.local.set({ pendingGroupsExtract: true });
      chrome.runtime.sendMessage({ type: 'CREATE_TAB', url, active: false });
      return;
    }

    if (event.data.type === 'EOS_FORCE_REPORT') {
      getWorldStorage('token').then(({ token }) => {
        if (!token) return;
        const groupId   = event.data.groupId   || '0';
        const groupName = event.data.groupName || 'Todos';
        setWorldStorage({ pendingTroopRequest: true, pendingTroopGroupId: groupId, pendingTroopGroupName: groupName });
        const villageMatch = window.location.href.match(/village=(\d+)/);
        const vid = villageMatch ? villageMatch[1] : '';
        const url = `https://${CURRENT_WORLD}.tribalwars.com.pt/game.php?${vid ? `village=${vid}&` : ''}screen=overview_villages&mode=units`;
        chrome.runtime.sendMessage({ type: 'CREATE_TAB', url, active: false });
      });
      return;
    }

    if (event.data.type === 'EOS_SEND_SUPPORT') {
      // Abre mass support (place.php?mode=call&target=VID) — lookup do village_id via village.txt
      (async () => {
        const coords = event.data.target_coords;
        const troops = event.data.troops || {};
        const groupId = event.data.group_id || '0';
        const groupName = event.data.group_name || 'Todos';
        if (!coords) return;
        const [tx, ty] = coords.split('|');

        // Lookup village_id pelas coords
        let targetVid = null;
        try {
          const txt = await fetch(eosUrl('villageTxt'), { cache: 'no-store' }).then(r => r.text());
          for (const line of txt.split('\n')) {
            const parts = line.split(',');
            // Formato: id,name,x,y,player_id,points,rank
            if (parts.length >= 4 && parts[2] === tx && parts[3] === ty) {
              targetVid = parts[0];
              break;
            }
          }
        } catch (e) { console.warn('[EOS] Erro ao fazer lookup village.txt:', e); }

        if (!targetVid) {
          alert('Não foi possível encontrar a aldeia alvo.');
          return;
        }

        // Guarda estado para o content.js processar na place.php
        await setWorldStorage({
          pendingSupportTargetVid: targetVid,
          pendingSupportTroops:    troops,
          pendingSupportGroupId:   groupId,
          pendingSupportGroupName: groupName,
        });

        const villageMatch = window.location.href.match(/village=(\d+)/);
        const myVid = villageMatch ? villageMatch[1] : '';
        const url = `https://${CURRENT_WORLD}.tribalwars.com.pt/game.php?${myVid ? `village=${myVid}&` : ''}screen=place&mode=call&target=${targetVid}`;
        chrome.runtime.sendMessage({ type: 'CREATE_TAB', url, active: true });
      })();
      return;
    }
  }

  // Mensagens do page_reader (mesmo window)
  if (event.source !== window) return;

  if (event.data.type === 'EOS_GAME_DATA') {
    const { playerName, tribeName, tribeTag, allyId, hasTribe } = event.data;
    if (!playerName) return;
    // Envia para background que chama o servidor
    chrome.runtime.sendMessage({
      type: 'PLAYER_SEEN', playerName, tribeName, tribeTag: tribeTag || '', allyId, hasTribe,
      world: CURRENT_WORLD
    });
  }

  if (event.data.type === 'EOS_GROUPS_DATA' && Array.isArray(event.data.groups)) {
    const groups = event.data.groups;
    (async () => {
      // Guarda mas NÃO cancela pendingGroupsExtract — o recipe corre depois e
      // faz a união (page_reader pode perder o grupo atualmente selecionado)
      await chrome.storage.local.set({ twGroups: groups });
      const { token } = await getWorldStorage('token');
      let postStatus = 'no-token';
      if (token) {
        try {
          const res = await fetch(`${EOS_SERVER}/api/tw-groups`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'X-EOS-Version': chrome.runtime.getManifest().version,
            },
            body: JSON.stringify({ groups })
          });
          postStatus = `pageReader HTTP ${res.status}`;
          console.log('[EOS groups]', postStatus);
        } catch (e) {
          postStatus = `pageReader ERROR ${e.message}`;
          console.warn('[EOS groups]', postStatus);
        }
      }
      await chrome.storage.local.set({
        eosLastGroupsSync: { ts: Date.now(), source: 'pageReader', count: groups.length, status: postStatus }
      });
      // Só fecha tab se estava a fazer extração dedicada (veio de Sincronizar)
      const params = new URLSearchParams(window.location.search);
      const isExtractPage = params.get('screen') === 'overview_villages' && params.get('mode') === 'groups';
      if (isExtractPage) {
        showOverlay(`✔ ${groups.length} grupos extraídos!`, 'ok');
        setTimeout(() => window.close(), 2500);
      }
    })();
  }

});

// Mensagem direta do background (fallback para race condition com storage)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'EOS_TRIGGER_REPORT') return;
  if (!isUnitsPage()) return;
  // Força o flag no storage e relança o fluxo principal
  setWorldStorage({
    pendingTroopRequest:   true,
    pendingTroopGroupId:   msg.groupId   || '0',
    pendingTroopGroupName: msg.groupName || 'Todos'
  }).then(() => runTroopReport());
});

async function runTroopReport() {
  // Relança o fluxo principal — main() já lida com todo o fluxo de grupo/paginação/leitura
  await main();
}
