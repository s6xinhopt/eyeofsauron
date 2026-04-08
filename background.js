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

      // Sincroniza agendamentos do servidor para os alarmes locais
      if (data.status === 'approved') syncSchedules(data.token);
    }
  } catch (err) {
    console.error('[EOS] handlePlayerSeen:', err);
  }
}

// ── Agendamentos ─────────────────────────────────────────────────────────────

async function syncSchedules(token) {
  try {
    const res = await fetch(`${EOS_SERVER}/api/schedules`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const { schedules } = await res.json();
    await chrome.storage.local.set({ autoUpdateSchedules: schedules });
    setupAlarms(schedules);
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

// ── Eventos ───────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const { autoUpdateSchedules } = await chrome.storage.local.get('autoUpdateSchedules');
  if (autoUpdateSchedules) setupAlarms(autoUpdateSchedules);
});

chrome.runtime.onStartup.addListener(async () => {
  const { eosToken, autoUpdateSchedules } = await chrome.storage.local.get(['eosToken', 'autoUpdateSchedules']);
  if (eosToken) syncSchedules(eosToken);
  else if (autoUpdateSchedules) setupAlarms(autoUpdateSchedules);
  // Dispara imediatamente para todos os agendamentos
  for (const s of (autoUpdateSchedules || [])) {
    await triggerReport(s.twGroupId, s.twGroupName);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PLAYER_SEEN') {
    handlePlayerSeen(message);
  } else if (message.type === 'CREATE_TAB') {
    chrome.tabs.create({ url: message.url, active: message.active !== false });
  }
});
