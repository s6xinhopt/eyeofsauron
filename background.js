// background.js — service worker mínimo
// Gere alarmes para auto-update e comunica com o servidor
// NOTA: todo o storage é world-scoped (eos.{world}.token, eos.{world}.status, etc.)

const EOS_SERVER = 'https://eos-server-sooty.vercel.app';

// ── Helpers para storage world-scoped ───────────────────────────────────────

function worldKey(world, key) {
  return `eos.${world}.${key}`;
}

async function getWorldData(world) {
  const keys = [
    worldKey(world, 'token'),
    worldKey(world, 'playerName'),
    worldKey(world, 'tribeName'),
    worldKey(world, 'tribeTag'),
    worldKey(world, 'status'),
    worldKey(world, 'role'),
    worldKey(world, 'subscription'),
    worldKey(world, 'isLeader'),
    worldKey(world, 'schedules'),
  ];
  const data = await chrome.storage.local.get(keys);
  return {
    token:        data[worldKey(world, 'token')]      || null,
    playerName:   data[worldKey(world, 'playerName')] || null,
    tribeName:    data[worldKey(world, 'tribeName')]   || '',
    tribeTag:     data[worldKey(world, 'tribeTag')]    || '',
    status:       data[worldKey(world, 'status')]      || null,
    role:         data[worldKey(world, 'role')]         || null,
    subscription: data[worldKey(world, 'subscription')]|| null,
    isLeader:     data[worldKey(world, 'isLeader')]    || false,
    schedules:    data[worldKey(world, 'schedules')]   || null,
  };
}

async function setWorldData(world, obj) {
  const mapped = {};
  for (const [k, v] of Object.entries(obj)) {
    mapped[worldKey(world, k)] = v;
  }
  await chrome.storage.local.set(mapped);
}

// ── Autenticação: regista jogador e guarda token (world-scoped) ─────────────

async function handlePlayerSeen({ playerName, tribeName, tribeTag, allyId, hasTribe, world }) {
  if (!playerName || !world) return;

  await setWorldData(world, {
    playerName,
    tribeName: tribeName || '',
    tribeTag:  tribeTag || '',
  });

  try {
    const res = await fetch(`${EOS_SERVER}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EOS-Version': chrome.runtime.getManifest().version },
      body: JSON.stringify({ playerName, tribeName, tribeTag: tribeTag || '', allyId, hasTribe, world })
    });

    if (!res.ok) return;
    const data = await res.json();

    if (data.token) {
      await setWorldData(world, {
        token:        data.token,
        status:       data.status,
        role:         data.role,
        subscription: data.subscription || null,
        isLeader:     data.role === 'leader',
        tribeName:    data.tribeName || tribeName || '',
      });

      // Mantém compatibilidade: guarda o último mundo visitado
      await chrome.storage.local.set({ eosLastWorld: world });

      console.log(`[EOS] Autenticado: ${playerName}@${world} (${data.role}) sub:${data.subscription?.status || 'none'}`);

      if (data.status === 'approved') {
        checkPendingBadge(world);
        syncSchedules(world, data.token, true);
        chrome.alarms.get(`check-requests-${world}`, a => {
          if (!a) chrome.alarms.create(`check-requests-${world}`, { periodInMinutes: 1 });
        });
        // Se a liderança pediu tropas
        if (data.troop_request) {
          const pendingKey = worldKey(world, 'pendingTroopRequest');
          const { [pendingKey]: pending } = await chrome.storage.local.get(pendingKey);
          if (!pending) {
            if (data.auto_accept_requests) {
              await triggerReport(world,
                data.troop_request_group_id   || '0',
                data.troop_request_group_name || 'Todos'
              );
            } else {
              await setWorldData(world, {
                pendingTroopConfirm:          true,
                pendingTroopConfirmGroupId:   data.troop_request_group_id   || '0',
                pendingTroopConfirmGroupName: data.troop_request_group_name || 'Todos',
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[EOS] handlePlayerSeen:', err);
  }
}

// ── Agendamentos (world-scoped) ─────────────────────────────────────────────

async function syncSchedules(world, token, checkMissed = false) {
  try {
    const res = await fetch(`${EOS_SERVER}/api/schedules`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EOS-Version': chrome.runtime.getManifest().version }
    });
    if (!res.ok) return;
    const { schedules, last_report } = await res.json();
    await setWorldData(world, { schedules });
    setupAlarms(world, schedules);

    // Verifica se algum agendamento foi falhado enquanto o PC estava desligado
    const checkedKey = `_syncChecked_${world}`;
    if (checkMissed && !syncSchedules[checkedKey] && schedules && schedules.length > 0) {
      syncSchedules[checkedKey] = true;
      const lastReportTime = last_report ? new Date(last_report).getTime() : 0;
      const now = new Date();

      for (const sched of schedules) {
        if (!sched.times || sched.times.length === 0) continue;

        let mostRecentPassed = 0;
        for (const time of sched.times) {
          const [hh, mm] = time.split(':').map(Number);
          const candidate = new Date();
          candidate.setHours(hh, mm, 0, 0);
          if (candidate > now) candidate.setDate(candidate.getDate() - 1);
          if (candidate.getTime() > mostRecentPassed) mostRecentPassed = candidate.getTime();
        }

        if (mostRecentPassed > 0 && lastReportTime < mostRecentPassed) {
          console.log(`[EOS] Atualização falhada detetada para ${world}. A disparar agora...`);
          await triggerReport(world, sched.twGroupId, sched.twGroupName);
          break;
        }
      }
    }
  } catch (_) {}
}

async function setupAlarms(world, schedules) {
  // Limpa alarmes existentes deste mundo
  const existing = await chrome.alarms.getAll();
  for (const a of existing) {
    if (a.name.startsWith(`auto-report-${world}-`)) await chrome.alarms.clear(a.name);
  }

  if (!schedules || schedules.length === 0) {
    console.log(`[EOS alarms] ${world}: sem schedules — nenhum alarme criado`);
    return;
  }

  let count = 0;
  for (const sched of schedules) {
    if (!sched.times || sched.times.length === 0) continue;
    for (const time of sched.times) {
      const [hh, mm] = time.split(':').map(Number);
      const target = new Date();
      target.setHours(hh, mm, 0, 0);
      if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
      const name = `auto-report-${world}-${sched.twGroupId}-${time}`;
      chrome.alarms.create(name, {
        when: target.getTime(),
        periodInMinutes: 24 * 60
      });
      console.log(`[EOS alarms] ${world}: criado ${name} para ${target.toLocaleString()}`);
      count++;
    }
  }
  console.log(`[EOS alarms] ${world}: ${count} alarmes ativos`);
}

// ── Trigger report (world-scoped) ───────────────────────────────────────────

// Lock em memória por mundo para prevenir race conditions quando 2+ alarmes
// disparam no mesmo segundo (cada triggerReport espera o anterior completar)
const _triggerReportLocks = {};

async function triggerReport(world, groupId, groupName) {
  // Serializa chamadas para o mesmo mundo
  const prev = _triggerReportLocks[world] || Promise.resolve();
  const run = prev.then(() => _triggerReportInner(world, groupId, groupName)).catch(e => {
    console.error(`[EOS triggerReport] erro:`, e);
  });
  _triggerReportLocks[world] = run;
  return run;
}

async function _triggerReportInner(world, groupId, groupName) {
  const wd = await getWorldData(world);
  console.log(`[EOS triggerReport] world=${world} groupId=${groupId} playerName=${wd.playerName}`);
  if (!wd.playerName) {
    console.warn(`[EOS triggerReport] ABORTADO: sem playerName para ${world}`);
    return;
  }

  const queueKey = worldKey(world, 'reportQueue');
  const pendingKey = worldKey(world, 'pendingTroopRequest');
  const pendingTimeKey = worldKey(world, 'pendingTroopRequestTime');
  const { [pendingKey]: pending, [queueKey]: queue = [], [pendingTimeKey]: pendingTime } = await chrome.storage.local.get([pendingKey, queueKey, pendingTimeKey]);

  const STALE_MS = 5 * 60 * 1000;
  if (pending && pendingTime && (Date.now() - pendingTime) > STALE_MS) {
    console.warn(`[EOS triggerReport] flag pending stale (>${STALE_MS}ms) — a limpar`);
    await chrome.storage.local.set({ [pendingKey]: false });
  } else if (pending) {
    if (!queue.some(r => r.groupId === (groupId || '0'))) {
      queue.push({ groupId: groupId || '0', groupName: groupName || 'Todos' });
      await chrome.storage.local.set({ [queueKey]: queue });
      console.log(`[EOS] Report para ${world} grupo "${groupName || 'Todos'}" adicionado à fila (${queue.length} na fila)`);
    }
    return;
  }

  // Extrai village ID de uma tab TW aberta NO MESMO MUNDO
  let villageId = '';
  try {
    const twTabs = await chrome.tabs.query({ url: `*://${world}.tribalwars.com.pt/*` });
    for (const t of twTabs) {
      const m = (t.url || '').match(/village=(\d+)/);
      if (m) { villageId = m[1]; break; }
    }
  } catch (_) {}

  // SEMPRE usa o mundo correto na URL — nunca o mundo de outra tab
  const troopsUrl = `https://${world}.tribalwars.com.pt/game.php?${villageId ? `village=${villageId}&` : ''}screen=overview_villages&mode=units`;

  await chrome.storage.local.set({
    [pendingKey]: true,
    [pendingTimeKey]: Date.now(),
    [worldKey(world, 'pendingTroopGroupId')]:   groupId || '0',
    [worldKey(world, 'pendingTroopGroupName')]: groupName || 'Todos',
  });

  console.log(`[EOS] A iniciar report para ${world} grupo "${groupName || 'Todos'}"`);
  let tab;
  try {
    tab = await chrome.tabs.create({ url: troopsUrl, active: false });
    console.log(`[EOS] Tab criada: id=${tab.id}`);
  } catch (e) {
    console.error(`[EOS] Erro ao criar tab:`, e);
    await chrome.storage.local.set({ [pendingKey]: false });
    return;
  }

  const listener = (tabId, info) => {
    if (tabId !== tab.id || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(listener);
    chrome.tabs.sendMessage(tab.id, {
      type: 'EOS_TRIGGER_REPORT',
      groupId:   groupId || '0',
      groupName: groupName || 'Todos'
    }).catch(() => {});
  };
  chrome.tabs.onUpdated.addListener(listener);
}

// Processa o próximo report na fila
async function processReportQueue(world) {
  const queueKey = worldKey(world, 'reportQueue');
  const { [queueKey]: queue = [] } = await chrome.storage.local.get(queueKey);
  if (queue.length === 0) return;

  const next = queue.shift();
  await chrome.storage.local.set({ [queueKey]: queue });
  console.log(`[EOS] A processar próximo da fila (${world}): grupo "${next.groupName}" (${queue.length} restantes)`);
  await triggerReport(world, next.groupId, next.groupName);
}

// ── Badge de notificação: pedidos pendentes ─────────────────────────────────

async function checkPendingBadge(world) {
  if (!world) {
    // Fallback: usa último mundo conhecido
    const { eosLastWorld } = await chrome.storage.local.get('eosLastWorld');
    world = eosLastWorld;
    if (!world) return;
  }
  const wd = await getWorldData(world);
  if (!wd.token || (wd.role !== 'leader' && wd.role !== 'moderator')) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  try {
    const res = await fetch(`${EOS_SERVER}/api/pending`, {
      headers: { Authorization: `Bearer ${wd.token}`, 'X-EOS-Version': chrome.runtime.getManifest().version }
    });
    if (!res.ok) return;
    const { pending } = await res.json();
    const count = (pending || []).length;
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#c0a060' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (_) {}
}

// ── Verifica pedidos de tropas da liderança ─────────────────────────────────

async function checkTroopRequest(world) {
  if (!world) {
    const { eosLastWorld } = await chrome.storage.local.get('eosLastWorld');
    world = eosLastWorld;
    if (!world) return;
  }
  const wd = await getWorldData(world);
  if (!wd.token) return;
  try {
    const res = await fetch(`${EOS_SERVER}/api/check`, {
      headers: { Authorization: `Bearer ${wd.token}`, 'X-EOS-Version': chrome.runtime.getManifest().version }
    });
    if (!res.ok) return;
    const { troop_request, troop_request_group_id, troop_request_group_name, auto_accept_requests } = await res.json();
    if (!troop_request) return;

    const pendingKey = worldKey(world, 'pendingTroopRequest');
    const { [pendingKey]: pending } = await chrome.storage.local.get(pendingKey);
    if (pending) return;

    if (auto_accept_requests) {
      await triggerReport(world,
        troop_request_group_id   || '0',
        troop_request_group_name || 'Todos'
      );
    } else {
      await setWorldData(world, {
        pendingTroopConfirm:          true,
        pendingTroopConfirmGroupId:   troop_request_group_id   || '0',
        pendingTroopConfirmGroupName: troop_request_group_name || 'Todos',
      });
    }
  } catch (_) {}
}

// Limpa flags pending de todas as sessões anteriores.
// Se o browser foi fechado mid-report, a flag fica presa a true e bloqueia todos os reports seguintes.
async function clearStalePendingFlags() {
  const all = await chrome.storage.local.get(null);
  const toReset = {};
  for (const key of Object.keys(all)) {
    if (key.match(/^eos\..+\.pendingTroopRequest$/) && all[key] === true) {
      toReset[key] = false;
      console.log(`[EOS] A limpar flag pending stale: ${key}`);
    }
  }
  if (Object.keys(toReset).length > 0) await chrome.storage.local.set(toReset);
}

// ── Eventos ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  clearStalePendingFlags();
  // ── Migração: copia dados antigos (globais) para chaves world-scoped ──
  const all = await chrome.storage.local.get(null);
  const oldWorld = all.eosWorld;
  const oldToken = all.eosToken;
  if (oldWorld && oldToken && !all[worldKey(oldWorld, 'token')]) {
    console.log(`[EOS] Migração: a copiar dados globais para eos.${oldWorld}.*`);
    await setWorldData(oldWorld, {
      token:        oldToken,
      playerName:   all.eosPlayerName || '',
      tribeName:    all.eosTribeName || '',
      tribeTag:     all.eosTribeTag || '',
      status:       all.eosStatus || null,
      role:         all.eosRole || null,
      subscription: all.eosSubscription || null,
      isLeader:     all.eosIsLeader || false,
    });
    await chrome.storage.local.set({ eosLastWorld: oldWorld });
    console.log(`[EOS] Migração concluída para ${oldWorld}`);
  }

  // Recupera mundos conhecidos e recria alarmes
  const worlds = new Set();
  for (const key of Object.keys(all)) {
    const m = key.match(/^eos\.([a-z0-9]+)\.schedules$/);
    if (m) worlds.add(m[1]);
  }
  for (const w of worlds) {
    const sched = all[worldKey(w, 'schedules')];
    if (sched) setupAlarms(w, sched);
    chrome.alarms.create(`check-requests-${w}`, { periodInMinutes: 1 });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  clearStalePendingFlags();
  await new Promise(resolve => setTimeout(resolve, 3000));
  const all = await chrome.storage.local.get(null);
  const worlds = new Set();
  for (const key of Object.keys(all)) {
    const m = key.match(/^eos\.([a-z0-9]+)\.token$/);
    if (m) worlds.add(m[1]);
  }
  for (const w of worlds) {
    const token = all[worldKey(w, 'token')];
    if (token) {
      syncSchedules(w, token, true);
      checkTroopRequest(w);
    }
    chrome.alarms.create(`check-requests-${w}`, { periodInMinutes: 1 });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log(`[EOS alarm] disparou: ${alarm.name} @ ${new Date().toLocaleString()}`);
  // check-requests-{world}
  const crMatch = alarm.name.match(/^check-requests-(.+)$/);
  if (crMatch) {
    const world = crMatch[1];
    await checkTroopRequest(world);
    await checkPendingBadge(world);
    return;
  }

  // auto-report-{world}-{groupId}-{HH:MM}
  if (!alarm.name.startsWith('auto-report-')) return;
  const parts = alarm.name.slice('auto-report-'.length);
  // Format: world-groupId-HH:MM — world is first segment
  const firstDash = parts.indexOf('-');
  const world = parts.substring(0, firstDash);
  const rest = parts.substring(firstDash + 1);
  const lastDash = rest.lastIndexOf('-');
  const groupId = rest.substring(0, lastDash);

  const wd = await getWorldData(world);
  const sched = (wd.schedules || []).find(s => String(s.twGroupId) === groupId);
  console.log(`[EOS alarm] auto-report → world=${world} groupId=${groupId} groupName=${sched?.twGroupName || 'Todos'}`);
  await triggerReport(world, groupId, sched?.twGroupName || 'Todos');
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'PLAYER_SEEN') {
    handlePlayerSeen(message);
  } else if (message.type === 'CREATE_TAB') {
    const url = message.url || '';
    if (/^https?:\/\/[a-z0-9]+\.tribalwars\.com\.pt\//.test(url)) {
      chrome.tabs.create({ url, active: message.active !== false });
    }
  } else if (message.type === 'CLOSE_TAB') {
    // Extrai o mundo da URL da tab que fecha
    const tabUrl = sender.tab?.url || '';
    const worldMatch = tabUrl.match(/^https?:\/\/([a-z0-9]+)\.tribalwars\.com\.pt/);
    const world = worldMatch ? worldMatch[1] : null;
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
    if (world) setTimeout(() => processReportQueue(world), 500);
  } else if (message.type === 'SYNC_SCHEDULES') {
    if (message.token && message.world) syncSchedules(message.world, message.token);
  } else if (message.type === 'OPEN_PANEL') {
    if (chrome.action?.openPopup) {
      chrome.action.openPopup().catch(() => {});
    }
  } else if (message.type === 'CLICK_TW_SUPPORT_SUBMIT') {
    if (sender.tab?.id) {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: clickTWSupportSubmit,
      }).catch(e => console.warn('[EOS bg] CLICK_TW_SUPPORT_SUBMIT falhou:', e));
    }
  } else if (message.type === 'FILL_SUPPORT_MAIN') {
    // Executa a lógica do supportSender no MAIN world (acesso ao jQuery do TW)
    if (sender.tab?.id) {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: supportSenderMain,
        args: [message.troops || {}],
      }).catch(e => console.warn('[EOS bg] FILL_SUPPORT_MAIN falhou:', e));
    }
  } else if (message.type === 'READ_AVAILABLE_MAIN') {
    if (sender.tab?.id) {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: readAvailableTroopsMain,
      }).catch(e => console.warn('[EOS bg] READ_AVAILABLE_MAIN falhou:', e));
    }
  }
});

// Lê tropas disponíveis por aldeia na page place&mode=call via jQuery (MAIN world)
// Posta resultado para o content script via window.postMessage
function readAvailableTroopsMain() {
  try {
    if (typeof $ === 'undefined') {
      console.warn('[EOS available] jQuery não disponível');
      window.postMessage({ type: 'EOS_AVAILABLE_DATA', byVid: {} }, '*');
      return;
    }
    const UNITS = ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob'];
    const rows = Array.from(document.querySelectorAll('#village_troup_list tbody tr'));
    const byVid = {};
    for (const row of rows) {
      // Link da aldeia na row tem ?village=VID
      const link = row.querySelector('a[href*="screen=info_village"], a[href*="village="]');
      if (!link) continue;
      const vidMatch = (link.getAttribute('href') || '').match(/village=(\d+)|[?&]id=(\d+)/);
      const vid = vidMatch && (vidMatch[1] || vidMatch[2]);
      if (!vid) continue;
      const troops = {};
      for (const u of UNITS) {
        const n = parseInt(($(row).find(`[data-unit='${u}']`).text() || '').replace(/\D/g, '')) || 0;
        if (n > 0) troops[u] = n;
      }
      if (Object.keys(troops).length > 0) byVid[vid] = troops;
    }
    console.log('[EOS available MAIN] aldeias lidas:', Object.keys(byVid).length);
    window.postMessage({ type: 'EOS_AVAILABLE_DATA', byVid }, '*');
  } catch (e) {
    console.error('[EOS available MAIN] erro:', e);
    window.postMessage({ type: 'EOS_AVAILABLE_DATA', byVid: {} }, '*');
  }
}

// Clica no botão "Enviar apoio" do TW no MAIN world (handlers JS funcionam)
function clickTWSupportSubmit() {
  try {
    const candidates = [
      'form#command-data-form input[type="submit"]',
      'form[action*="place"] input[type="submit"]',
      '#target_attack',
      '#troop_confirm_submit',
      'input[name="target_attack"]',
    ];
    let btn = null;
    for (const sel of candidates) {
      btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) break;
      btn = null;
    }
    if (!btn) {
      btn = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"]'))
        .find(b => /enviar apoio|apoio|atac/i.test((b.value || b.textContent || '')));
    }
    if (!btn) { console.warn('[EOS support MAIN] botão TW não encontrado'); return; }
    console.log('[EOS support MAIN] clicando botão TW:', btn.id || btn.name || btn.value);
    if (typeof $ !== 'undefined') {
      $(btn).trigger('click');
    } else {
      btn.click();
    }
  } catch (e) { console.error('[EOS support MAIN] click falhou:', e); }
}

// Função executada no MAIN world da página TW. Tem acesso a jQuery, game_data, etc.
function supportSenderMain(troopsRequested) {
  try {
    if (typeof $ === 'undefined') { console.warn('[EOS support] jQuery não disponível'); return; }
    const requestedUnits = Object.keys(troopsRequested).filter(u => troopsRequested[u] > 0);

    // 1) Header checkboxes (cb_<unit>)
    try {
      const headerInputs = document.getElementById('village_troup_list').children[0].children[0].getElementsByTagName('input');
      for (let i = 0; i < headerInputs.length - 1; i++) {
        const id = (headerInputs[i].id || '').split('_')[1];
        if (!id) continue;
        headerInputs[i].checked = requestedUnits.indexOf(id) !== -1;
      }
    } catch (e) { console.warn('[EOS support MAIN] header cbs:', e); }

    // 2) Seleciona todas as aldeias
    const selAll = document.getElementById('place_call_select_all')
      || document.querySelector('a#select_all, a.select_all, .select_all_units, [onclick*="selectAll"]');
    if (selAll) {
      console.log('[EOS support MAIN] select-all:', selAll.id || selAll.className);
      selAll.click();
    } else {
      const headerMaster = $('#village_troup_list thead input[type=checkbox], #village_troup_list tbody:first tr:first input[type=checkbox]').first();
      if (headerMaster.length) {
        console.log('[EOS support MAIN] master cb:', headerMaster.attr('id'));
        headerMaster.prop('checked', true).trigger('click').trigger('change');
      }
      const villageCbs = $('#village_troup_list tbody tr input[type=checkbox]');
      console.log('[EOS support MAIN] checkboxes aldeia:', villageCbs.length);
      villageCbs.each(function () {
        if (!this.checked) { this.checked = true; this.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    }

    // 3) Limpa inputs visíveis
    $('#village_troup_list').find('input[type=number]:visible').val(0);

    // 4) Lê tropas disponíveis por linha
    const rows = Array.from($('#village_troup_list tbody tr'));
    const rowData = [];
    rows.forEach(row => {
      const hasInput = $(row).find('.call-unit-box-spear, .call-unit-box-axe, .call-unit-box-sword, .call-unit-box-light, .call-unit-box-heavy, .call-unit-box-spy').length > 0;
      if (!hasInput) return;
      const available = {};
      requestedUnits.forEach(u => {
        const t = parseInt($(row).find(`[data-unit='${u}']`).text().replace(/\D/g, '')) || 0;
        available[u] = t;
      });
      rowData.push({ row, available, assigned: {} });
    });
    if (rowData.length === 0) { console.warn('[EOS support MAIN] sem linhas com inputs'); return; }
    console.log('[EOS support MAIN] aldeias com inputs:', rowData.length);

    // 5) Distribuição (algoritmo do supportSender)
    requestedUnits.forEach(unit => {
      const requested = troopsRequested[unit];
      let factor = requested / rowData.length;
      const sorted = rowData.slice().sort((a, b) => a.available[unit] - b.available[unit]);
      for (let i = 0; i < sorted.length; i++) {
        const avail = sorted[i].available[unit];
        if (avail < factor) {
          const deficit = factor - avail;
          const rem = sorted.length - i - 1;
          if (rem > 0) factor += deficit / rem;
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
    });

    // 6) Escreve via jQuery .val() + triggers
    let totalFilled = 0;
    rowData.forEach(rd => {
      Object.keys(rd.assigned).forEach(unit => {
        const v = Math.floor(rd.assigned[unit]);
        if (v <= 0) return;
        const inp = $(rd.row).find('.call-unit-box-' + unit);
        if (inp.length) {
          inp.val(v);
          inp.trigger('input').trigger('change');
          totalFilled++;
        }
      });
    });
    console.log('[EOS support MAIN] preenchidos:', totalFilled);
  } catch (e) {
    console.error('[EOS support MAIN] erro:', e);
  }
}

// ── Auto-update checker ─────────────────────────────────────────────────────

async function checkForUpdate() {
  try {
    const manifest = chrome.runtime.getManifest();
    const currentVersion = manifest.version;

    const res = await fetch(`${EOS_SERVER}/api/version?v=${currentVersion}`);
    if (!res.ok) return;
    const data = await res.json();

    if (data.outdated) {
      await chrome.storage.local.set({
        eosOutdated: true,
        eosUpdateVersion: data.version,
        eosUpdateUrl: data.downloadUrl,
      });
      chrome.action.setBadgeText({ text: '⚠' });
      chrome.action.setBadgeBackgroundColor({ color: '#e05050' });
      console.log(`[EOS] Versão desatualizada! ${currentVersion} < ${data.minVersion}`);
      return;
    }

    await chrome.storage.local.set({ eosOutdated: false });

    if (!data.version || data.version === currentVersion) return;

    const current = currentVersion.split('.').map(Number);
    const latest = data.version.split('.').map(Number);
    let isNewer = false;
    for (let i = 0; i < 3; i++) {
      if ((latest[i] || 0) > (current[i] || 0)) { isNewer = true; break; }
      if ((latest[i] || 0) < (current[i] || 0)) break;
    }
    if (!isNewer) return;

    await chrome.storage.local.set({
      eosUpdateAvailable: true,
      eosUpdateVersion: data.version,
      eosUpdateUrl: data.downloadUrl,
      eosUpdateChangelog: data.changelog,
    });

    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#e87830' });

    console.log(`[EOS] Update disponível: ${currentVersion} → ${data.version}`);
  } catch (_) {}
}

chrome.alarms.create('check-update', { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-update') checkForUpdate();
});

chrome.runtime.onInstalled.addListener(() => {
  setTimeout(checkForUpdate, 10000);
});
chrome.runtime.onStartup.addListener(() => {
  setTimeout(checkForUpdate, 15000);
});
