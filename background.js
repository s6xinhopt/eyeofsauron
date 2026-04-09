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
        syncSchedules(data.token);
        // Garante que o alarme de polling existe (recria se o service worker reiniciou)
        chrome.alarms.get('check-requests', a => {
          if (!a) chrome.alarms.create('check-requests', { periodInMinutes: 2 });
        });
        // Se a liderança pediu tropas, dispara — mas só se não há já um pedido em curso
        if (data.troop_request) {
          const { pendingTroopRequest } = await chrome.storage.local.get('pendingTroopRequest');
          if (!pendingTroopRequest) await triggerReport('0', 'Todos');
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
      const now = Date.now();
      // Usa o menor intervalo dos agendamentos como referência
      const minInterval = Math.min(...schedules.map(s => s.intervalMin || Infinity));
      if (minInterval < Infinity) {
        const elapsed = (now - lastReportTime) / 60000; // em minutos
        if (elapsed >= minInterval) {
          console.log(`[EOS] Atualização falhada detetada (${Math.round(elapsed)}min atrás). A disparar agora...`);
          // Dispara para cada agendamento que tenha falhado
          for (const s of schedules) {
            if (elapsed >= (s.intervalMin || Infinity)) {
              await triggerReport(s.twGroupId, s.twGroupName);
            }
          }
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

  if (!schedules || schedules.length === 0) {
    await chrome.storage.local.set({ autoUpdateNextTimes: [] });
    return;
  }

  const nextTimes = [];
  for (const sched of schedules) {
    if (!sched.intervalMin || sched.intervalMin < 1) continue;
    const alarmName = `auto-report-${sched.twGroupId}`;
    chrome.alarms.create(alarmName, { delayInMinutes: sched.intervalMin, periodInMinutes: sched.intervalMin });
    nextTimes.push({ groupId: sched.twGroupId, groupName: sched.twGroupName, nextTime: Date.now() + sched.intervalMin * 60 * 1000 });
  }
  await chrome.storage.local.set({ autoUpdateNextTimes: nextTimes });
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
    const { troop_request } = await res.json();
    if (troop_request) {
      const { pendingTroopRequest } = await chrome.storage.local.get('pendingTroopRequest');
      if (!pendingTroopRequest) await triggerReport('0', 'Todos');
    }
  } catch (_) {}
}

// ── Eventos ───────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const { autoUpdateSchedules } = await chrome.storage.local.get('autoUpdateSchedules');
  if (autoUpdateSchedules) setupAlarms(autoUpdateSchedules);
  chrome.alarms.create('check-requests', { periodInMinutes: 2 });
});

chrome.runtime.onStartup.addListener(async () => {
  const { eosToken, autoUpdateSchedules } = await chrome.storage.local.get(['eosToken', 'autoUpdateSchedules']);
  if (eosToken) {
    syncSchedules(eosToken, true);
    checkTroopRequest();
  } else if (autoUpdateSchedules) {
    setupAlarms(autoUpdateSchedules);
  }
  chrome.alarms.create('check-requests', { periodInMinutes: 2 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'check-requests') { await checkTroopRequest(); return; }
  if (!alarm.name.startsWith('auto-report-')) return;
  const groupId = alarm.name.replace('auto-report-', '');
  const { autoUpdateSchedules } = await chrome.storage.local.get('autoUpdateSchedules');
  const sched = (autoUpdateSchedules || []).find(s => String(s.twGroupId) === groupId);
  await triggerReport(groupId, sched?.twGroupName || 'Todos');

  if (sched) {
    const { autoUpdateNextTimes } = await chrome.storage.local.get('autoUpdateNextTimes');
    const times = autoUpdateNextTimes || [];
    const idx = times.findIndex(t => String(t.groupId) === groupId);
    const nextTime = Date.now() + sched.intervalMin * 60 * 1000;
    if (idx >= 0) times[idx].nextTime = nextTime;
    else times.push({ groupId, groupName: sched.twGroupName, nextTime });
    await chrome.storage.local.set({ autoUpdateNextTimes: times });
  }
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
