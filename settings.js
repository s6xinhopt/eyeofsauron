document.getElementById('eyeImg').src = chrome.runtime.getURL('background/eye_of_sauron.gif');

const schedulesList = document.getElementById('schedulesList');
const addScheduleBtn = document.getElementById('addScheduleBtn');
const saveBtn        = document.getElementById('saveBtn');
const status         = document.getElementById('status');
const extractBtn     = document.getElementById('extractGroupsBtn');
const extractSt      = document.getElementById('extractStatus');

let twGroups    = []; // [{id, name}] - grupos do jogo TW
let schedules   = []; // [{twGroupId, twGroupName, intervalMin}]

// ── Carrega dados guardados ──────────────────────────────────────────────
chrome.storage.local.get(['twGroups', 'autoUpdateSchedules'], (data) => {
  twGroups  = data.twGroups || [];
  schedules = data.autoUpdateSchedules || [];
  updateExtractStatus();
  renderSchedules();
});

// ── Grupos do jogo ───────────────────────────────────────────────────────
function updateExtractStatus() {
  if (twGroups.length > 0) {
    extractSt.textContent = `${twGroups.length} grupo(s) carregado(s): ${twGroups.map(g => g.name).join(', ')}`;
    extractSt.style.color = '#555';
  } else {
    extractSt.textContent = 'Nenhum grupo extraído ainda.';
    extractSt.style.color = '#333';
  }
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.twGroups) {
    twGroups = changes.twGroups.newValue || [];
    updateExtractStatus();
    renderSchedules(); // atualiza dropdowns
    extractSt.textContent = `✔ ${twGroups.length} grupos extraídos!`;
    extractSt.style.color = '#4caf50';
  }
});

extractBtn.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: '*://*.tribalwars.com.pt/*' });
  if (tabs.length === 0) {
    extractSt.textContent = 'Abre o TribalWars primeiro.';
    extractSt.style.color = '#f44336';
    return;
  }
  const origin = new URL(tabs[0].url).origin;
  chrome.runtime.sendMessage({ type: 'CREATE_TAB', url: `${origin}/game.php?screen=overview_villages&mode=groups`, active: true });
  extractSt.textContent = 'A abrir página de grupos...';
  extractSt.style.color = '#555';
});

// ── Render schedules ─────────────────────────────────────────────────────
function groupOptions(selectedId) {
  const allOption = `<option value="0" ${selectedId === '0' || !selectedId ? 'selected' : ''}>Todos</option>`;
  const opts = twGroups.map(g =>
    `<option value="${g.id}" ${String(g.id) === String(selectedId) ? 'selected' : ''}>${escHtml(g.name)}</option>`
  ).join('');
  return allOption + opts;
}

function escHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderSchedules() {
  if (schedules.length === 0) {
    schedulesList.innerHTML = '<div class="empty-schedules">Sem agendamentos. Adiciona um abaixo.</div>';
    return;
  }

  schedulesList.innerHTML = schedules.map((s, i) => {
    const h = Math.floor((s.intervalMin || 0) / 60);
    const m = (s.intervalMin || 0) % 60;
    return `<div class="schedule-row" data-idx="${i}">
      <select class="sched-group" data-idx="${i}">
        ${groupOptions(s.twGroupId)}
      </select>
      <input type="number" class="sched-num sched-h" data-idx="${i}" min="0" max="167" value="${h}" title="Horas">
      <span class="sched-label">h</span>
      <input type="number" class="sched-num sched-m" data-idx="${i}" min="0" max="59" value="${m}" title="Minutos">
      <span class="sched-label">min</span>
      <button class="btn-sched-del" data-idx="${i}">🗑</button>
    </div>`;
  }).join('');

  // Events
  schedulesList.querySelectorAll('.sched-group').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = +sel.dataset.idx;
      const chosen = twGroups.find(g => String(g.id) === sel.value) || { id: '0', name: 'Todos' };
      schedules[idx].twGroupId   = sel.value || '0';
      schedules[idx].twGroupName = sel.value === '0' || !sel.value ? 'Todos' : chosen.name;
    });
  });
  schedulesList.querySelectorAll('.sched-h').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = +inp.dataset.idx;
      const h = Math.max(0, Math.min(167, parseInt(inp.value) || 0));
      inp.value = h;
      const m = parseInt(schedulesList.querySelectorAll(`.sched-m[data-idx="${idx}"]`)[0]?.value) || 0;
      schedules[idx].intervalMin = h * 60 + m;
    });
  });
  schedulesList.querySelectorAll('.sched-m').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = +inp.dataset.idx;
      const m = Math.max(0, Math.min(59, parseInt(inp.value) || 0));
      inp.value = m;
      const h = parseInt(schedulesList.querySelectorAll(`.sched-h[data-idx="${idx}"]`)[0]?.value) || 0;
      schedules[idx].intervalMin = h * 60 + m;
    });
  });
  schedulesList.querySelectorAll('.btn-sched-del').forEach(btn => {
    btn.addEventListener('click', () => {
      schedules.splice(+btn.dataset.idx, 1);
      renderSchedules();
    });
  });
}

addScheduleBtn.addEventListener('click', () => {
  schedules.push({ twGroupId: '0', twGroupName: 'Todos', intervalMin: 1440 });
  renderSchedules();
});

// ── Guardar ──────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  // Valida
  for (const s of schedules) {
    if (!s.intervalMin || s.intervalMin < 1) {
      status.textContent = 'Intervalo mínimo: 1 minuto.';
      status.className = 's-err';
      return;
    }
  }

  // Evita grupos duplicados
  const seen = new Set();
  for (const s of schedules) {
    if (seen.has(s.twGroupId)) {
      status.textContent = 'Grupo duplicado num agendamento.';
      status.className = 's-err';
      return;
    }
    seen.add(s.twGroupId);
  }

  await chrome.storage.local.set({
    autoUpdateSchedules: schedules,
    autoUpdate: schedules.length > 0
  });
  chrome.runtime.sendMessage({ type: 'UPDATE_ALARM' });

  status.textContent = '✔ Definições guardadas!';
  status.className = 's-ok';
  setTimeout(() => { status.textContent = ''; }, 2500);
});
