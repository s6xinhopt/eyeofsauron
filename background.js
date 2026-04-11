// background.js — service worker mínimo
// Gere alarmes para auto-update e comunica com o servidor

const EOS_SERVER = 'https://eos-server-sooty.vercel.app';

// ── Autenticação: regista jogador e guarda token ─────────────────────────────

async function handlePlayerSeen({ playerName, tribeName, tribeTag, allyId, hasTribe, world }) {
  if (!playerName || !world) return;

  await chrome.storage.local.set({ eosPlayerName: playerName, eosWorld: world, eosTribeName: tribeName || '', eosTribeTag: tribeTag || '' });

  try {
    const res = await fetch(`${EOS_SERVER}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName, tribeName, tribeTag: tribeTag || '', allyId, hasTribe, world })
    });

    if (!res.ok) return;
    const data = await res.json();

    if (data.token) {
      await chrome.storage.local.set({
        eosToken:    data.token,
        eosStatus:   data.status,
        eosRole:     data.role,
        eosSubscription: data.subscription || null,
        eosTribeName: data.tribeName || tribeName || '',
      });
      console.log(`[EOS] Autenticado: ${playerName} (${data.role}) sub:${data.subscription?.status || 'none'}`);

      if (data.status === 'approved') {
        checkPendingBadge();
        // checkMissed=true: se o browser esteve fechado durante uma atualização agendada, dispara agora
        syncSchedules(data.token, true);
        // Garante que o alarme de polling existe (recria se o service worker reiniciou)
        chrome.alarms.get('check-requests', a => {
          if (!a) chrome.alarms.create('check-requests', { periodInMinutes: 1 });
        });
        // Se a liderança pediu tropas
        if (data.troop_request) {
          const { pendingTroopRequest } = await chrome.storage.local.get('pendingTroopRequest');
          if (!pendingTroopRequest) {
            if (data.auto_accept_requests) {
              await triggerReport(
                data.troop_request_group_id   || '0',
                data.troop_request_group_name || 'Todos'
              );
            } else {
              await chrome.storage.local.set({
                pendingTroopConfirm: true,
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

// ── Agendamentos ─────────────────────────────────────────────────────────────

async function syncSchedules(token, checkMissed = false) {
  try {
    const res = await fetch(`${EOS_SERVER}/api/schedules`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const { schedules, last_report } = await res.json();
    await chrome.storage.local.set({ autoUpdateSchedules: schedules });
    setupAlarms(schedules);

    // Verifica se algum agendamento foi falhado enquanto o PC estava desligado (só uma vez)
    if (checkMissed && !syncSchedules._checked && schedules && schedules.length > 0) {
      syncSchedules._checked = true;
      const lastReportTime = last_report ? new Date(last_report).getTime() : 0;
      const now = new Date();

      for (const sched of schedules) {
        if (!sched.times || sched.times.length === 0) continue;

        // Encontra a hora agendada mais recente que já passou
        let mostRecentPassed = 0;
        for (const time of sched.times) {
          const [hh, mm] = time.split(':').map(Number);
          const candidate = new Date();
          candidate.setHours(hh, mm, 0, 0);
          if (candidate > now) candidate.setDate(candidate.getDate() - 1);
          if (candidate.getTime() > mostRecentPassed) mostRecentPassed = candidate.getTime();
        }

        // Se last_report é anterior à hora agendada mais recente → falhou
        if (mostRecentPassed > 0 && lastReportTime < mostRecentPassed) {
          console.log(`[EOS] Atualização falhada detetada. A disparar agora...`);
          await triggerReport(sched.twGroupId, sched.twGroupName);
          break; // Dispara apenas uma vez; o mecanismo pendente trata o resto
        }
      }
    }
  } catch (_) {}
}

async function setupAlarms(schedules) {
  // Limpa alarmes existentes
  const existing = await chrome.alarms.getAll();
  for (const a of existing) {
    if (a.name.startsWith('auto-report')) await chrome.alarms.clear(a.name);
  }

  if (!schedules || schedules.length === 0) return;

  for (const sched of schedules) {
    if (!sched.times || sched.times.length === 0) continue;
    for (const time of sched.times) {
      const [hh, mm] = time.split(':').map(Number);
      const target = new Date();
      target.setHours(hh, mm, 0, 0);
      if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
      chrome.alarms.create(`auto-report-${sched.twGroupId}-${time}`, {
        when: target.getTime(),
        periodInMinutes: 24 * 60
      });
    }
  }
}

async function triggerReport(groupId, groupName) {
  const { eosPlayerName, eosWorld, pendingTroopRequest } = await chrome.storage.local.get(
    ['eosPlayerName', 'eosWorld', 'pendingTroopRequest']
  );
  if (!eosPlayerName || !eosWorld) return;

  // Se já há um report em curso, coloca na fila e sai
  if (pendingTroopRequest) {
    const { reportQueue = [] } = await chrome.storage.local.get('reportQueue');
    // Evita duplicados na fila (mesmo groupId)
    if (!reportQueue.some(r => r.groupId === (groupId || '0'))) {
      reportQueue.push({ groupId: groupId || '0', groupName: groupName || 'Todos' });
      await chrome.storage.local.set({ reportQueue });
      console.log(`[EOS] Report para grupo "${groupName || 'Todos'}" adicionado à fila (${reportQueue.length} na fila)`);
    }
    return;
  }

  // Mass support page — lê tropas via #village_troup_list (mesmo método do Support Sender)
  // Extrai village ID de uma tab TW aberta
  let villageId = '';
  try {
    const twTabs = await chrome.tabs.query({ url: '*://*.tribalwars.com.pt/*' });
    for (const t of twTabs) {
      const m = (t.url || '').match(/village=(\d+)/);
      if (m) { villageId = m[1]; break; }
    }
  } catch (_) {}
  const troopsUrl = `https://${eosWorld}.tribalwars.com.pt/game.php?${villageId ? `village=${villageId}&` : ''}screen=overview_villages&mode=units`;
  await chrome.storage.local.set({
    pendingTroopRequest:   true,
    pendingTroopGroupId:   groupId || '0',
    pendingTroopGroupName: groupName || 'Todos'
  });

  console.log(`[EOS] A iniciar report para grupo "${groupName || 'Todos'}"`);
  const tab = await chrome.tabs.create({ url: troopsUrl, active: false });

  // Envia mensagem direta à tab quando terminar de carregar (evita race condition com storage)
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

// Processa o próximo report na fila (chamado quando um report termina)
async function processReportQueue() {
  const { reportQueue = [] } = await chrome.storage.local.get('reportQueue');
  if (reportQueue.length === 0) return;

  const next = reportQueue.shift();
  await chrome.storage.local.set({ reportQueue });
  console.log(`[EOS] A processar próximo da fila: grupo "${next.groupName}" (${reportQueue.length} restantes)`);
  await triggerReport(next.groupId, next.groupName);
}

// ── Badge de notificação: pedidos pendentes de membros ───────────────────────

async function checkPendingBadge() {
  const { eosToken, eosRole } = await chrome.storage.local.get(['eosToken', 'eosRole']);
  if (!eosToken || (eosRole !== 'leader' && eosRole !== 'moderator')) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  try {
    const res = await fetch(`${EOS_SERVER}/api/pending`, {
      headers: { Authorization: `Bearer ${eosToken}` }
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

// ── Verifica pedidos de tropas da liderança ───────────────────────────────────

async function checkTroopRequest() {
  const { eosToken } = await chrome.storage.local.get('eosToken');
  if (!eosToken) return;
  try {
    const res = await fetch(`${EOS_SERVER}/api/check`, {
      headers: { Authorization: `Bearer ${eosToken}` }
    });
    if (!res.ok) return;
    const { troop_request, troop_request_group_id, troop_request_group_name, auto_accept_requests } = await res.json();
    if (!troop_request) return;

    const { pendingTroopRequest } = await chrome.storage.local.get('pendingTroopRequest');
    if (pendingTroopRequest) return; // já há um report em curso

    if (auto_accept_requests) {
      // Auto-aceitar: dispara o report imediatamente
      await triggerReport(
        troop_request_group_id   || '0',
        troop_request_group_name || 'Todos'
      );
    } else {
      // Guardar pedido pendente para o content.js mostrar notificação ao jogador
      await chrome.storage.local.set({
        pendingTroopConfirm: true,
        pendingTroopConfirmGroupId:   troop_request_group_id   || '0',
        pendingTroopConfirmGroupName: troop_request_group_name || 'Todos',
      });
    }
  } catch (_) {}
}

// ── Eventos ───────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const { autoUpdateSchedules } = await chrome.storage.local.get('autoUpdateSchedules');
  if (autoUpdateSchedules) setupAlarms(autoUpdateSchedules);
  chrome.alarms.create('check-requests', { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(async () => {
  // Aguarda o browser estar pronto antes de criar tabs
  await new Promise(resolve => setTimeout(resolve, 3000));
  const { eosToken, autoUpdateSchedules } = await chrome.storage.local.get(['eosToken', 'autoUpdateSchedules']);
  if (eosToken) {
    syncSchedules(eosToken, true);
    checkTroopRequest();
  } else if (autoUpdateSchedules) {
    setupAlarms(autoUpdateSchedules);
  }
  chrome.alarms.create('check-requests', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'check-requests') { await checkTroopRequest(); await checkPendingBadge(); return; }
  if (!alarm.name.startsWith('auto-report-')) return;

  // Formato: auto-report-{groupId}-{HH:MM}
  // groupId é numérico, time é sempre HH:MM — split no último '-'
  const withoutPrefix = alarm.name.slice('auto-report-'.length);
  const lastDash = withoutPrefix.lastIndexOf('-');
  const groupId = withoutPrefix.substring(0, lastDash);

  const { autoUpdateSchedules } = await chrome.storage.local.get('autoUpdateSchedules');
  const sched = (autoUpdateSchedules || []).find(s => String(s.twGroupId) === groupId);
  await triggerReport(groupId, sched?.twGroupName || 'Todos');
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'PLAYER_SEEN') {
    handlePlayerSeen(message);
  } else if (message.type === 'CREATE_TAB') {
    // Valida que o URL é do TW antes de abrir
    const url = message.url || '';
    if (/^https?:\/\/[a-z0-9]+\.tribalwars\.com\.pt\//.test(url)) {
      chrome.tabs.create({ url, active: message.active !== false });
    }
  } else if (message.type === 'CLOSE_TAB') {
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
    // Após fechar a tab do report, processa o próximo na fila
    setTimeout(() => processReportQueue(), 500);
  } else if (message.type === 'SYNC_SCHEDULES') {
    if (message.token) syncSchedules(message.token);
  }
});

// ── Auto-update checker ─────────────────────────────────────────────────────

async function checkForUpdate() {
  try {
    const manifest = chrome.runtime.getManifest();
    const currentVersion = manifest.version;

    const res = await fetch(`${EOS_SERVER}/api/version?v=${currentVersion}`);
    if (!res.ok) return;
    const data = await res.json();

    // Versão desatualizada (obrigatório atualizar)
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

    // Compara versões
    const current = currentVersion.split('.').map(Number);
    const latest = data.version.split('.').map(Number);
    let isNewer = false;
    for (let i = 0; i < 3; i++) {
      if ((latest[i] || 0) > (current[i] || 0)) { isNewer = true; break; }
      if ((latest[i] || 0) < (current[i] || 0)) break;
    }
    if (!isNewer) return;

    // Guarda info do update
    await chrome.storage.local.set({
      eosUpdateAvailable: true,
      eosUpdateVersion: data.version,
      eosUpdateUrl: data.downloadUrl,
      eosUpdateChangelog: data.changelog,
    });

    // Badge no ícone da extensão
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#e87830' });

    console.log(`[EOS] Update disponível: ${currentVersion} → ${data.version}`);
  } catch (_) {}
}

// Verifica updates a cada 6 horas
chrome.alarms.create('check-update', { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-update') checkForUpdate();
});

// Verifica logo ao iniciar
chrome.runtime.onInstalled.addListener(() => {
  setTimeout(checkForUpdate, 10000);
});
chrome.runtime.onStartup.addListener(() => {
  setTimeout(checkForUpdate, 15000);
});
