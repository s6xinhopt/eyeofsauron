// background.js — service worker mínimo
// Gere alarmes para auto-update e comunica com o servidor

const EOS_SERVER = 'https://eos-server-sooty.vercel.app';

// ── Autenticação: regista jogador e guarda token ─────────────────────────────

async function handlePlayerSeen({ playerName, tribeName, allyId, hasTribe, world }) {
  if (!playerName || !world) return;

  await chrome.storage.local.set({ eosPlayerName: playerName, eosWorld: world });

  try {
    const res = await fetch(`${EOS_SERVER}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName, tribeName, allyId, hasTribe, world })
    });

    if (!res.ok) return;
    const data = await res.json();

    if (data.token) {
      await chrome.storage.local.set({
        eosToken:    data.token,
        eosStatus:   data.status,
        eosRole:     data.role,
      });
      console.log(`[EOS] Autenticado: ${playerName} (${data.role})`);

      if (data.status === 'approved') {
        // checkMissed=true: se o browser esteve fechado durante uma atualização agendada, dispara agora
        syncSchedules(data.token, true);
        // Garante que o alarme de polling existe (recria se o service worker reiniciou)
        chrome.alarms.get('check-requests', a => {
          if (!a) chrome.alarms.create('check-requests', { periodInMinutes: 1 });
        });
        // Se a liderança pediu tropas, dispara — mas só se não há já um pedido em curso
        if (data.troop_request) {
          const { pendingTroopRequest } = await chrome.storage.local.get('pendingTroopRequest');
          if (!pendingTroopRequest) await triggerReport(
            data.troop_request_group_id   || '0',
            data.troop_request_group_name || 'Todos'
          );
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

    // Verifica se algum agendamento foi falhado enquanto o PC estava desligado
    if (checkMissed && schedules && schedules.length > 0) {
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
  const { eosPlayerName, eosWorld } = await chrome.storage.local.get(['eosPlayerName', 'eosWorld']);
  if (!eosPlayerName || !eosWorld) return;

  const troopsUrl = `https://${eosWorld}.tribalwars.com.pt/game.php?screen=overview_villages&mode=units&type=own_home`;
  await chrome.storage.local.set({
    pendingTroopRequest:   true,
    pendingTroopGroupId:   groupId || '0',
    pendingTroopGroupName: groupName || 'Todos'
  });
  chrome.tabs.create({ url: troopsUrl, active: false });
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
    const { troop_request, troop_request_group_id, troop_request_group_name } = await res.json();
    if (troop_request) {
      const { pendingTroopRequest } = await chrome.storage.local.get('pendingTroopRequest');
      if (!pendingTroopRequest) await triggerReport(
        troop_request_group_id   || '0',
        troop_request_group_name || 'Todos'
      );
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
  if (alarm.name === 'check-requests') { await checkTroopRequest(); return; }
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
    chrome.tabs.create({ url: message.url, active: message.active !== false });
  } else if (message.type === 'CLOSE_TAB') {
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
  } else if (message.type === 'SYNC_SCHEDULES') {
    if (message.token) syncSchedules(message.token);
  }
});
