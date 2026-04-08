// panel.js — Painel flutuante injetado na página do TribalWars
(function () {
  'use strict';
  if (document.getElementById('eos-panel-host')) return;

  // ── Shadow DOM host ──────────────────────────────────────────────────────
  const host = document.createElement('div');
  host.id = 'eos-panel-host';
  host.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;display:none;width:92vw;max-width:1500px;height:80vh;';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // ── CSS ──────────────────────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    #eos-panel {
      font-family: 'Segoe UI', sans-serif;
      background: #1a1a2e;
      color: #eee;
      width: 100%;
      height: 100%;
      border-radius: 6px;
      border: 1px solid #c0a060;
      box-shadow: 0 8px 32px rgba(0,0,0,0.85);
      overflow: hidden;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .header {
      background: linear-gradient(135deg, #2a1a0e 0%, #1a1a2e 100%);
      border-bottom: 2px solid #c0a060;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .header img { width: 36px; height: 36px; border-radius: 4px; border: 1px solid #c0a06055; pointer-events: none; }
    .header-title { font-size: 14px; font-weight: bold; color: #c0a060; letter-spacing: 1px; }
    .header-sub   { font-size: 11px; color: #666; margin-top: 2px; }
    .header-spacer { flex: 1; }
    .btn-header-icon {
      background: none; border: none; color: #666;
      font-size: 14px; cursor: pointer; padding: 2px 5px; line-height: 1;
      border-radius: 3px;
    }
    .btn-header-icon:hover { color: #c0a060; }
    .btn-close {
      background: none; border: none; color: #666;
      font-size: 16px; cursor: pointer; padding: 2px 6px; line-height: 1;
    }
    .btn-close:hover { color: #f44336; }

    .view { display: none; padding: 20px 16px; }
    .view.active { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }

    .status-center { text-align: center; padding: 8px 0; }
    .status-icon  { font-size: 36px; margin-bottom: 12px; }
    .status-title { font-size: 15px; color: #c0a060; margin-bottom: 8px; font-weight: 600; }
    .status-text  { font-size: 12px; color: #777; line-height: 1.6; }

    .spinner {
      width: 24px; height: 24px;
      border: 2px solid #2a2a4a;
      border-top-color: #c0a060;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin: 0 auto 10px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .tribe-bar {
      background: #0f0f1f;
      border-bottom: 1px solid #2a2a4a;
      padding: 7px 16px;
      font-size: 12px;
      color: #888;
      display: flex;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .tribe-bar strong { color: #c0a060; }

    /* Barra de grupos */
    .group-filter-bar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 5px;
      padding: 7px 12px;
      background: #0f0f1f;
      border-bottom: 1px solid #2a2a4a;
      flex-shrink: 0;
      min-height: 36px;
    }
    .group-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--gc, #c0a060);
      color: var(--gc, #c0a060);
      background: transparent;
      transition: background 0.15s;
      white-space: nowrap;
    }
    .group-pill:hover { background: color-mix(in srgb, var(--gc, #c0a060) 15%, transparent); }
    .group-pill.active { background: color-mix(in srgb, var(--gc, #c0a060) 25%, transparent); }
    .group-pill-del {
      font-size: 9px; opacity: 0.5; margin-left: 2px;
      padding: 0 2px; line-height: 1; cursor: pointer;
    }
    .group-pill-del:hover { opacity: 1; }
    .btn-new-group {
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      cursor: pointer;
      border: 1px dashed #2a2a4a;
      color: #444;
      background: transparent;
    }
    .btn-new-group:hover { border-color: #c0a060; color: #c0a060; }
    .new-group-form {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .new-group-form input[type="text"] {
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid #333;
      background: #1a1a2e;
      color: #eee;
      font-size: 11px;
      outline: none;
      width: 130px;
    }
    .new-group-form input[type="text"]:focus { border-color: #c0a060; }
    .new-group-form input[type="color"] {
      width: 26px; height: 22px;
      border: 1px solid #333;
      border-radius: 3px;
      padding: 1px;
      cursor: pointer;
      background: #1a1a2e;
    }
    .new-group-form button {
      padding: 2px 7px;
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
      border: 1px solid #333;
      background: transparent;
      color: #888;
    }
    .new-group-form button:first-of-type { border-color: #2d5a2d; color: #4caf50; }
    .new-group-form button:first-of-type:hover { background: #1a3a1a; }
    .new-group-form button:last-of-type:hover { border-color: #f44336; color: #f44336; }

    /* Célula de grupo na tabela */
    .group-badge-cell {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 8px;
      font-size: 10px;
      font-weight: 600;
      border: 1px solid var(--gc, #c0a060);
      color: var(--gc, #c0a060);
      white-space: nowrap;
      margin-right: 3px;
    }
    .group-badges-cell { display: flex; flex-wrap: wrap; gap: 2px; }

    /* Multi-select de grupos */
    .group-multi-wrapper { position: relative; display: inline-block; }
    .btn-group-multi {
      background: none; border: 1px solid #3a3a5a; color: #666;
      border-radius: 3px; font-size: 11px; cursor: pointer;
      padding: 2px 6px; line-height: 1;
    }
    .btn-group-multi:hover { border-color: #c0a060; color: #c0a060; }
    .group-multi-drop {
      position: absolute; right: 0; top: 100%; margin-top: 3px;
      background: #1a1a2e; border: 1px solid #2a2a4a;
      border-radius: 4px; z-index: 200;
      min-width: 130px; padding: 4px 0;
      box-shadow: 0 4px 14px rgba(0,0,0,0.7);
    }
    .group-check-item {
      display: flex; align-items: center; gap: 7px;
      padding: 5px 12px; cursor: pointer; font-size: 11px;
      white-space: nowrap; user-select: none;
    }
    .group-check-item:hover { background: #1e1e38; }
    .group-check-item input[type="checkbox"] { cursor: pointer; accent-color: #c0a060; }

    .tabs { display: flex; background: #111128; border-bottom: 1px solid #2a2a4a; flex-shrink: 0; }
    .tab-btn {
      flex: 1; padding: 10px 4px;
      background: none; border: none;
      border-bottom: 2px solid transparent;
      color: #555; font-size: 12px; cursor: pointer;
    }
    .tab-btn:hover { color: #aaa; }
    .tab-btn.active { color: #c0a060; border-bottom-color: #c0a060; }
    .tab-badge {
      display: inline-block;
      background: #c0a060; color: #1a1a2e;
      border-radius: 8px; font-size: 9px;
      font-weight: bold; padding: 0 4px;
      margin-left: 3px; vertical-align: middle;
    }

    .tab-pane { display: none; }
    .tab-pane.active { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }

    /* Lista de membros — tabela */
    .members-list { flex: 1; min-height: 0; overflow-y: auto; }

    .members-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .members-table thead tr {
      position: sticky;
      top: 0;
      background: #111128;
      z-index: 1;
    }
    .members-table th {
      padding: 7px 8px;
      color: #555;
      font-weight: normal;
      border-bottom: 2px solid #2a2a4a;
      white-space: nowrap;
      text-align: center;
    }
    .members-table th.col-player { text-align: left; padding-left: 14px; min-width: 140px; }
    .members-table th img { width: 16px; height: 16px; image-rendering: pixelated; vertical-align: middle; }
    .members-table td {
      padding: 7px 8px;
      border-bottom: 1px solid #1a1a2e;
      color: #aaa;
      text-align: center;
      white-space: nowrap;
    }
    .members-table td.col-player { text-align: left; padding-left: 14px; }
    .members-table tbody tr:hover td { background: #1e1e38; }
    .members-table tbody tr:last-child td { border-bottom: none; }

    .t-player-cell { display: flex; align-items: center; gap: 6px; }
    .t-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .t-name { font-weight: 500; color: #ddd; }
    .t-zero { color: #333; }
    .t-dash { color: #2a2a4a; }
    .t-time { font-size: 11px; color: #555; }
    .t-update { font-size: 11px; color: #3a3a5a; }
    .t-actions { display: flex; align-items: center; gap: 4px; justify-content: flex-end; }

    /* Banner de pedido de tropas (visível ao membro) */
    .troop-request-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #1a2a1a;
      border-bottom: 1px solid #2d5a2d;
      padding: 8px 16px;
      font-size: 12px;
      color: #6fcf6f;
      flex-shrink: 0;
    }
    .troop-request-banner span { flex: 1; }
    .btn-share-troops {
      padding: 5px 12px;
      background: #c0a060; color: #1a1a2e;
      border: none; border-radius: 3px;
      font-size: 11px; font-weight: bold; cursor: pointer;
      white-space: nowrap;
    }
    .btn-share-troops:hover { background: #d4b070; }

    .dot-online  { background: #4caf50; }
    .dot-recent  { background: #ff9800; }
    .dot-offline { background: #444; }

    .badge-leader {
      font-size: 9px; background: #c0a060; color: #1a1a2e;
      padding: 1px 5px; border-radius: 3px; font-weight: bold;
    }
    .badge-mod {
      font-size: 9px; background: #4a7faa; color: #fff;
      padding: 1px 5px; border-radius: 3px; font-weight: bold;
    }
    .role-select {
      background: #0f0f1f; border: 1px solid #2a2a4a; color: #888;
      border-radius: 3px; font-size: 10px; padding: 2px 4px;
      cursor: pointer; outline: none;
    }
    .role-select:focus { border-color: #c0a060; }
    .btn-remove-member {
      background: none; border: 1px solid #3a2a2a; color: #555;
      border-radius: 3px; font-size: 11px; cursor: pointer;
      padding: 2px 5px; line-height: 1;
    }
    .btn-remove-member:hover { border-color: #f44336; color: #f44336; }

    /* Pedidos pendentes */
    .pending-list { padding: 10px 16px; flex: 1; min-height: 0; overflow-y: auto; }
    .pending-card {
      background: #0f0f1f; border: 1px solid #2a2a4a;
      border-radius: 4px; padding: 9px 10px; margin-bottom: 7px;
    }
    .pending-card-name { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
    .pending-card-meta { font-size: 11px; color: #666; margin-bottom: 9px; }
    .btn-row { display: flex; gap: 6px; }
    .btn-approve {
      flex: 1; padding: 6px; background: #1a3a1a; color: #6fcf6f;
      border: 1px solid #2d5a2d; border-radius: 3px;
      font-size: 12px; cursor: pointer; font-weight: bold;
    }
    .btn-approve:hover { background: #1e4a1e; }
    .btn-reject {
      flex: 1; padding: 6px; background: #3a1a1a; color: #cf6f6f;
      border: 1px solid #5a2d2d; border-radius: 3px;
      font-size: 12px; cursor: pointer; font-weight: bold;
    }
    .btn-reject:hover { background: #4a1e1e; }

    /* Botão pedir tropas (líder) */
    .btn-request-troops {
      background: none; border: 1px solid #3a3a5a;
      color: #666; border-radius: 3px;
      font-size: 10px; cursor: pointer; padding: 2px 5px; line-height: 1;
    }
    .btn-request-troops:hover:not(.sent) { border-color: #c0a060; color: #c0a060; }
    .btn-request-troops.sent { border-color: #2d5a2d; color: #4caf50; cursor: default; }

    .empty { text-align: center; padding: 24px; font-size: 12px; color: #444; }


    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: #0f0f1f; }
    ::-webkit-scrollbar-thumb { background: #3a3a5a; border-radius: 2px; }

    /* ── Definições inline ── */
    .settings-topbar {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 14px;
      border-bottom: 1px solid #2a2a4a;
      background: #0f0f1f;
      flex-shrink: 0;
    }
    .btn-back {
      background: none; border: 1px solid #2a2a4a; color: #666;
      border-radius: 3px; font-size: 11px; cursor: pointer;
      padding: 3px 9px; line-height: 1;
    }
    .btn-back:hover { border-color: #c0a060; color: #c0a060; }
    .settings-topbar-title { font-size: 12px; color: #888; letter-spacing: 1px; text-transform: uppercase; }

    .settings-body { flex: 1; overflow-y: auto; padding: 16px; }

    .settings-section { margin-bottom: 22px; }
    .settings-section h3 {
      font-size: 11px; color: #c0a060; text-transform: uppercase;
      letter-spacing: 1px; margin-bottom: 10px; padding-bottom: 6px;
      border-bottom: 1px solid #2a2a4a;
    }

    .btn-extract-inline {
      width: 100%; padding: 8px;
      background: transparent; color: #c0a060;
      border: 1px solid #c0a060; border-radius: 5px;
      font-size: 12px; cursor: pointer;
    }
    .btn-extract-inline:hover { background: rgba(192,160,96,0.1); }

    .s-extract-status { margin-top: 6px; font-size: 11px; color: #555; min-height: 14px; }

    .s-schedules-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
    .s-schedule-row {
      display: flex; align-items: center; gap: 7px;
      background: #0f0f1f; border: 1px solid #2a2a4a;
      border-radius: 5px; padding: 8px 10px;
    }
    .s-sched-group {
      flex: 1; min-width: 0;
      background: #1a1a2e; border: 1px solid #333; color: #eee;
      border-radius: 4px; font-size: 12px; padding: 4px 6px; outline: none; cursor: pointer;
    }
    .s-sched-group:focus { border-color: #c0a060; }
    .s-sched-num {
      width: 46px; padding: 4px 6px;
      background: #1a1a2e; border: 1px solid #333;
      border-radius: 4px; color: #eee; font-size: 12px; outline: none; text-align: center;
    }
    .s-sched-num:focus { border-color: #c0a060; }
    .s-sched-label { font-size: 11px; color: #555; white-space: nowrap; }
    .btn-sched-del {
      background: none; border: 1px solid #3a2a2a; color: #555;
      border-radius: 3px; font-size: 11px; cursor: pointer; padding: 3px 7px; flex-shrink: 0;
    }
    .btn-sched-del:hover { border-color: #f44336; color: #f44336; }

    .btn-add-sched {
      width: 100%; padding: 7px;
      background: transparent; color: #555;
      border: 1px dashed #2a2a4a; border-radius: 5px;
      font-size: 12px; cursor: pointer; margin-bottom: 14px;
    }
    .btn-add-sched:hover { border-color: #c0a060; color: #c0a060; }

    .btn-save-settings {
      width: 100%; padding: 9px;
      background: #c0a060; color: #1a1a2e;
      border: none; border-radius: 5px;
      font-size: 13px; font-weight: bold; cursor: pointer;
    }
    .btn-save-settings:hover { background: #d4b070; }

    .s-status { margin-top: 8px; font-size: 11px; text-align: center; min-height: 16px; }
    .s-ok  { color: #4caf50; }
    .s-err { color: #f44336; }
    .s-empty-schedules { font-size: 12px; color: #333; text-align: center; padding: 10px 0; }
  `;

  // ── HTML ─────────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'eos-panel';
  panel.innerHTML = `
    <div class="header">
      <img src="${chrome.runtime.getURL('background/eye_of_sauron.gif')}" alt="">
      <div>
        <div class="header-title">EYE OF SAURON <span style="font-size:9px;font-weight:normal;color:#3a3a5a;letter-spacing:0;">made by s6x</span></div>
        <div class="header-sub" id="headerSub">Tribe Management</div>
      </div>
      <div class="header-spacer"></div>
      <span id="updateCountdown" style="font-size:11px;color:#555;white-space:nowrap;"></span>
      <button class="btn-header-icon" id="updateTroopsBtn" title="Atualizar Tropas">🔄</button>
      <button class="btn-header-icon" id="settingsHeaderBtn" title="Definições">⚙️</button>
      <button class="btn-close" id="closeBtn" title="Fechar">✕</button>
    </div>

    <div class="view active" id="viewLoading">
      <div class="status-center">
        <div class="spinner"></div>
        <div class="status-text">A verificar...</div>
      </div>
    </div>

    <div class="view" id="viewNoGame">
      <div class="status-center">
        <div class="status-icon">🏰</div>
        <div class="status-title">Tribal Wars não detectado</div>
        <div class="status-text">Abre o TribalWars PT e recarrega a página.</div>
      </div>
    </div>

    <div class="view" id="viewRefresh">
      <div class="status-center">
        <div class="status-icon">🔄</div>
        <div class="status-title">Recarrega a página</div>
        <div class="status-text">A extensão foi atualizada.<br>Faz <strong>F5</strong> para ativar.</div>
      </div>
    </div>

    <div class="view" id="viewNoTribe">
      <div class="status-center">
        <div class="status-icon">⚠️</div>
        <div class="status-title">Tribo não registada</div>
        <div class="status-text">A tua tribo ainda não está configurada.<br>Contacta o administrador.</div>
      </div>
    </div>

    <div class="view" id="viewPending">
      <div class="status-center">
        <div class="status-icon">⏳</div>
        <div class="status-title">Pedido enviado!</div>
        <div class="status-text">O teu pedido foi enviado automaticamente.<br>Aguarda que o líder da tribo te aceite.</div>
      </div>
    </div>

    <div class="view" id="viewRejected">
      <div class="status-center">
        <div class="status-icon">🚫</div>
        <div class="status-title">Pedido rejeitado</div>
        <div class="status-text">O líder rejeitou o teu pedido.<br>Contacta o teu líder para mais informações.</div>
      </div>
    </div>

    <div class="view" id="viewPanel" style="padding:0">
      <div class="tribe-bar">
        <span>Tribo: <strong id="tribeDisplay">—</strong></span>
        <span id="twGroupFilterWrap" style="display:none">
          Tropas:
          <select id="twGroupFilterSel" style="background:#0f0f1f;border:1px solid #2a2a4a;color:#c0a060;border-radius:3px;font-size:11px;padding:2px 5px;outline:none;cursor:pointer;margin-left:4px;">
            <option value="">Todos</option>
          </select>
        </span>
        <span>Mundo: <strong id="worldDisplay">—</strong></span>
      </div>

      <div class="troop-request-banner" id="troopRequestBanner" style="display:none">
        <span>⚔️ O líder pediu as tuas tropas</span>
        <button class="btn-share-troops" id="shareTroopsBtn">Partilhar</button>
      </div>

      <div class="group-filter-bar" id="groupFilterBar"></div>

      <div class="tabs">
        <button class="tab-btn active" data-tab="paneMembers">⚔️ Membros</button>
        <button class="tab-btn" id="tabPendingBtn" style="display:none" data-tab="panePending">
          ⏳ Pedidos <span class="tab-badge" id="pendingBadge" style="display:none"></span>
        </button>
      </div>

      <div class="tab-pane active" id="paneMembers">
        <div class="members-list" id="membersList">
          <div class="empty">A carregar...</div>
        </div>
      </div>

      <div class="tab-pane" id="panePending">
        <div class="pending-list" id="pendingList">
          <div class="empty">Sem pedidos pendentes.</div>
        </div>
      </div>

    </div>

    <div class="view" id="viewSettings" style="padding:0">
      <div class="settings-topbar">
        <button class="btn-back" id="settingsBackBtn">← Voltar</button>
        <span class="settings-topbar-title">Definições</span>
      </div>
      <div class="settings-body">

        <div class="settings-section">
          <h3>Grupos do jogo</h3>
          <button class="btn-extract-inline" id="sExtractBtn">⟳ Extrair grupos do jogo</button>
          <div class="s-extract-status" id="sExtractStatus"></div>
        </div>

        <div class="settings-section">
          <h3>Agendamentos de atualização</h3>
          <div class="s-schedules-list" id="sSchedulesList">
            <div class="s-empty-schedules">Sem agendamentos. Adiciona um abaixo.</div>
          </div>
          <button class="btn-add-sched" id="sAddScheduleBtn">+ Adicionar agendamento</button>
          <button class="btn-save-settings" id="sSaveBtn">Guardar definições</button>
          <div class="s-status" id="sStatus"></div>
        </div>

      </div>
    </div>
  `;

  shadow.appendChild(styleEl);
  shadow.appendChild(panel);

  // ── Toggle ───────────────────────────────────────────────────────────────
  document.addEventListener('eos:toggle', () => {
    if (host.style.display === 'none') {
      host.style.display = '';
      panelInit();
    } else {
      host.style.display = 'none';
      stopPolling();
      stopCountdown();
    }
  });

  shadow.querySelector('#closeBtn').addEventListener('click', () => {
    host.style.display = 'none';
    stopPolling();
    stopCountdown();
  });

  // ── Lógica do painel ─────────────────────────────────────────────────────
  let currentPlayer      = null;
  let pollTimer          = null;
  let panelState         = null; // { tribeName, world, myRole, myName }
  let currentGroupFilter = null; // null = todos, string = group id
  let allGroupsCache     = [];   // groups loaded for current tribe/world
  let twSnapshotsCache   = {};   // { player_name: { tw_group_id: {troops, updated_at} } }
  let selectedTWGroup    = '';   // '' = todos, otherwise tw_group_id

  // Verifica se o contexto da extensão ainda é válido
  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(refreshData, 30000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function refreshData() {
    if (!panelState) return;
    if (!isContextValid()) { stopPolling(); stopCountdown(); return; }
    const { tribeName, world, myRole, myName } = panelState;

    // Atualiza banner de pedido de tropas para o jogador atual
    try {
      const me = await dbGet('memberships',
        `player_name=eq.${enc(myName)}&world=eq.${enc(world)}`);
      if (me && me[0]) {
        const banner = q('troopRequestBanner');
        if (banner) banner.style.display = me[0].troop_request ? '' : 'none';
      }
    } catch (_) {}

    await loadTWSnapshots(tribeName, world, myRole);
    await loadGroups(tribeName, world, myRole);
    await loadMembers(tribeName, world, myRole, myName);
    if (myRole === 'leader' || myRole === 'moderator') {
      await loadPending(tribeName, world);
    }
  }

  function q(id) { return shadow.querySelector('#' + id); }

  function showView(id) {
    shadow.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    q(id)?.classList.add('active');
  }

  async function panelInit() {
    if (!isContextValid()) {
      showView('viewNoGame');
      return;
    }
    currentGroupFilter = null;
    allGroupsCache = [];
    showView('viewLoading');

    const data = await chrome.storage.local.get([
      'eosPlayerName', 'eosTribeName', 'eosWorld'
    ]);

    if (!data.eosPlayerName) {
      // panel.js só corre em páginas TW, portanto estamos sempre no jogo
      showView('viewRefresh');
      return;
    }

    currentPlayer = { name: data.eosPlayerName, tribe: data.eosTribeName, world: data.eosWorld };
    q('headerSub').textContent =
      `${data.eosPlayerName} · ${(data.eosWorld || '').toUpperCase()}` +
      (data.eosTribeName ? ` · ${data.eosTribeName}` : ' · (sem tribo)');

    try {
      const rows = await dbGet('memberships',
        `player_name=eq.${enc(data.eosPlayerName)}&world=eq.${enc(data.eosWorld)}`);

      if (!rows || rows.length === 0) {
        const { eosStatus } = await chrome.storage.local.get('eosStatus');
        showView(eosStatus === 'no_tribe' ? 'viewNoTribe' : 'viewPending');
        return;
      }

      const me = rows[0];
      const myRole = me.role || (me.is_leader ? 'leader' : 'member');
      await chrome.storage.local.set({ eosStatus: me.status, eosRole: myRole });

      if (me.status === 'pending')  { showView('viewPending');  return; }
      if (me.status === 'rejected') { showView('viewRejected'); return; }
      if (me.status !== 'approved') { showView('viewNoGame');   return; }

      q('tribeDisplay').textContent = me.tribe_name;
      q('worldDisplay').textContent = me.world.toUpperCase();

      if (myRole === 'leader' || myRole === 'moderator') {
        q('tabPendingBtn').style.display = '';
      }
      if (me.troop_request) {
        q('troopRequestBanner').style.display = '';
      }

      panelState = { tribeName: me.tribe_name, world: me.world, myRole, myName: me.player_name };

      setupTabs();
      setupShareTroopsBtn(me.world);
      setupUpdateBtn(me.world);
      showView('viewPanel');
      await loadTWSnapshots(me.tribe_name, me.world, myRole);
      await loadGroups(me.tribe_name, me.world, myRole);
      loadMembers(me.tribe_name, me.world, myRole, me.player_name);
      if (myRole === 'leader' || myRole === 'moderator') loadPending(me.tribe_name, me.world);
      startPolling();

    } catch (err) {
      console.error('[EOS Panel]', err);
      showView('viewNoGame');
    }
  }

  // ── Snapshots de tropas por grupo TW ────────────────────────────────────

  async function loadTWSnapshots(tribeName, world, myRole) {
    try {
      // Busca todos os snapshots dos membros aprovados desta tribo
      const snaps = await dbGet('troop_snapshots',
        `world=eq.${enc(world)}&order=tw_group_id.asc`);

      // Organiza: { player_name -> { tw_group_id -> {troops, updated_at, tw_group_name} } }
      twSnapshotsCache = {};
      const groupSet = new Map(); // tw_group_id -> tw_group_name

      for (const s of (snaps || [])) {
        if (!twSnapshotsCache[s.player_name]) twSnapshotsCache[s.player_name] = {};
        twSnapshotsCache[s.player_name][s.tw_group_id] = {
          troops:     s.troops,
          updated_at: s.updated_at,
          group_name: s.tw_group_name
        };
        groupSet.set(s.tw_group_id, s.tw_group_name || s.tw_group_id);
      }

      // Atualiza o selector de grupos TW no tribe-bar
      const sel  = q('twGroupFilterSel');
      const wrap = q('twGroupFilterWrap');
      if (!sel) return;

      sel.innerHTML = '<option value="">Todos</option>';
      groupSet.forEach((name, id) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        if (id === selectedTWGroup) opt.selected = true;
        sel.appendChild(opt);
      });

      if (groupSet.size > 0) {
        wrap.style.display = '';
        if (!sel.dataset.setup) {
          sel.dataset.setup = '1';
          sel.addEventListener('change', () => {
            selectedTWGroup = sel.value;
            loadMembers(panelState.tribeName, panelState.world, panelState.myRole, panelState.myName);
          });
        }
      } else {
        wrap.style.display = 'none';
      }
    } catch (_) {}
  }

  // ── Grupos ───────────────────────────────────────────────────────────────

  async function loadGroups(tribeName, world, myRole) {
    try {
      const groups = await dbGet('groups',
        `tribe_name=eq.${enc(tribeName)}&world=eq.${enc(world)}&order=name.asc`);
      allGroupsCache = groups || [];
    } catch (_) {
      allGroupsCache = [];
    }
    renderGroupBar(tribeName, world, myRole);
  }

  function renderGroupBar(tribeName, world, myRole) {
    const bar = q('groupFilterBar');
    if (!bar) return;
    const canManage = myRole === 'leader' || myRole === 'moderator';

    const pills = allGroupsCache.map(g => {
      const isActive = currentGroupFilter === g.id;
      return `<button class="group-pill${isActive ? ' active' : ''}" data-gid="${g.id}" style="--gc:${g.color || '#c0a060'}">
        ${escHtml(g.name)}
        ${canManage ? `<span class="group-pill-del" data-gid="${g.id}">✕</span>` : ''}
      </button>`;
    }).join('');

    const newForm = canManage ? `
      <button class="btn-new-group" id="newGroupBtn">+ Novo grupo</button>
      <div class="new-group-form" id="newGroupForm" style="display:none">
        <input type="text" id="newGroupName" placeholder="Nome" maxlength="30">
        <input type="color" id="newGroupColor" value="#c0a060">
        <button id="saveGroupBtn">✔</button>
        <button id="cancelGroupBtn">✕</button>
      </div>` : '';

    bar.innerHTML = `
      <button class="group-pill${!currentGroupFilter ? ' active' : ''}" data-gid="" style="--gc:#666">Todos</button>
      ${pills}
      ${newForm}`;

    bar.onclick = async (e) => {
      // Eliminar grupo
      const del = e.target.closest('.group-pill-del');
      if (del) {
        e.stopPropagation();
        if (!confirm(`Eliminar o grupo "${allGroupsCache.find(g => g.id === del.dataset.gid)?.name}"?`)) return;
        try {
          await dbDelete('groups', `id=eq.${del.dataset.gid}`);
        } catch (_) {}
        allGroupsCache = allGroupsCache.filter(g => g.id !== del.dataset.gid);
        if (currentGroupFilter === del.dataset.gid) currentGroupFilter = null;
        renderGroupBar(tribeName, world, myRole);
        loadMembers(tribeName, world, myRole, panelState.myName);
        return;
      }

      // Filtrar por grupo
      const pill = e.target.closest('.group-pill');
      if (pill && !e.target.classList.contains('group-pill-del')) {
        currentGroupFilter = pill.dataset.gid || null;
        bar.querySelectorAll('.group-pill').forEach(p =>
          p.classList.toggle('active', p.dataset.gid === (currentGroupFilter || '')));
        loadMembers(tribeName, world, myRole, panelState.myName);
        return;
      }

      // Novo grupo
      if (e.target.id === 'newGroupBtn') {
        q('newGroupForm').style.display = '';
        q('newGroupBtn').style.display = 'none';
        setTimeout(() => q('newGroupName')?.focus(), 0);
        return;
      }
      if (e.target.id === 'cancelGroupBtn') {
        q('newGroupForm').style.display = 'none';
        q('newGroupBtn').style.display = '';
        return;
      }
      if (e.target.id === 'saveGroupBtn') {
        const name = q('newGroupName')?.value.trim();
        if (!name) return;
        const color = q('newGroupColor')?.value || '#c0a060';
        try {
          const res = await dbInsert('groups', { tribe_name: tribeName, world, name, color });
          if (res && res[0]) allGroupsCache.push(res[0]);
        } catch (_) {}
        renderGroupBar(tribeName, world, myRole);
      }
    };
  }

  // Unidades exibidas na tabela (sem arqueiro, arq. montado, paladino)
  const TABLE_UNITS = ['spear','sword','axe','spy','light','heavy','ram','catapult','snob'];

  async function loadMembers(tribeName, world, myRole, myName) {
    const el = q('membersList');
    const canSeeAllTroops  = myRole === 'leader' || myRole === 'moderator';
    const canManage        = myRole === 'leader' || myRole === 'moderator';
    const canChangeRole    = myRole === 'leader';
    const canRequestTroops = myRole === 'leader' || myRole === 'moderator';

    try {
      const rows = await dbGet('memberships',
        `tribe_name=eq.${enc(tribeName)}&world=eq.${enc(world)}&status=eq.approved&order=role.asc,player_name.asc`);

      if (!rows || rows.length === 0) {
        el.innerHTML = '<div class="empty">Sem membros aprovados.</div>';
        return;
      }

      // Filtra por grupo se necessário
      const filtered = currentGroupFilter
        ? rows.filter(m => Array.isArray(m.group_ids) && m.group_ids.includes(currentGroupFilter))
        : rows;

      if (filtered.length === 0) {
        el.innerHTML = '<div class="empty">Nenhum membro neste grupo.</div>';
        return;
      }

      // Cabeçalho da tabela
      const unitHeaders = TABLE_UNITS.map(u =>
        `<th title="${UNIT_NAMES[u]}"><img src="${chrome.runtime.getURL(`png/unit_${u}.png`)}"></th>`
      ).join('');
      const actionsHeader = canManage ? '<th></th>' : '';

      const bodyRows = filtered.map(m => {
        const isMe   = m.player_name === myName;
        const mRole  = m.role || (m.is_leader ? 'leader' : 'member');
        const showTroops = canSeeAllTroops || isMe;

        const badge = mRole === 'leader'    ? ' <span class="badge-leader">LÍDER</span>'
                    : mRole === 'moderator' ? ' <span class="badge-mod">MOD</span>'
                    : '';
        const dot = `<span class="t-dot ${onlineDot(m.last_seen)}"></span>`;

        // Escolhe a fonte de tropas: snapshot do grupo TW seleccionado, ou m.troops como fallback
        const snap = twSnapshotsCache[m.player_name];
        const troopSource = selectedTWGroup && snap
          ? snap[selectedTWGroup]?.troops
          : (snap ? Object.values(snap).reduce((latest, s) => {
              if (!latest) return s;
              return (s.updated_at > latest.updated_at) ? s : latest;
            }, null)?.troops : null) || m.troops;
        const lastReport = selectedTWGroup && snap
          ? snap[selectedTWGroup]?.updated_at
          : m.last_report;

        const unitCells = TABLE_UNITS.map(u => {
          if (!showTroops) return '<td class="t-dash">—</td>';
          if (!troopSource) return '<td class="t-dash">—</td>';
          const v = troopSource[u] || 0;
          return `<td class="${v === 0 ? 't-zero' : ''}">${v === 0 ? '0' : fmtK(v)}</td>`;
        }).join('');

        // Célula de grupo — badges read-only (todos os grupos do jogador)
        const memberGroupIds = Array.isArray(m.group_ids) ? m.group_ids : [];
        const memberGroups   = allGroupsCache.filter(g => memberGroupIds.includes(g.id));
        const groupCell = memberGroups.length > 0
          ? `<td><div class="group-badges-cell">${memberGroups.map(g =>
              `<span class="group-badge-cell" style="--gc:${g.color || '#c0a060'}">${escHtml(g.name)}</span>`
            ).join('')}</div></td>`
          : '<td class="t-dash">—</td>';

        let actions = '';
        if (canManage && !isMe) {
          if (canChangeRole && mRole !== 'leader') {
            actions += `<select class="role-select" data-player="${escHtml(m.player_name)}" data-world="${escHtml(world)}">
              <option value="member"    ${mRole === 'member'    ? 'selected' : ''}>Membro</option>
              <option value="moderator" ${mRole === 'moderator' ? 'selected' : ''}>Moderador</option>
            </select>`;
          }
          if (allGroupsCache.length > 0) {
            const checkboxes = allGroupsCache.map(g => {
              const checked = memberGroupIds.includes(g.id) ? 'checked' : '';
              return `<label class="group-check-item">
                <input type="checkbox" class="group-check" value="${g.id}" ${checked}
                  data-player="${escHtml(m.player_name)}" data-world="${escHtml(world)}">
                <span style="color:${g.color || '#c0a060'}">${escHtml(g.name)}</span>
              </label>`;
            }).join('');
            actions += `<div class="group-multi-wrapper">
              <button class="btn-group-multi" title="Grupos">Grupos</button>
              <div class="group-multi-drop" style="display:none">${checkboxes}</div>
            </div>`;
          }
          if (canRequestTroops) {
            actions += `<button class="btn-request-troops ${m.troop_request ? 'sent' : ''}"
              data-player="${escHtml(m.player_name)}" data-world="${escHtml(world)}"
              ${m.troop_request ? 'disabled' : ''}
              title="Pedir tropas">${m.troop_request ? '✔' : '📋'}</button>`;
          }
          const canRemove = canChangeRole || (myRole === 'moderator' && mRole === 'member');
          if (canRemove) {
            actions += `<button class="btn-remove-member"
              data-player="${escHtml(m.player_name)}" data-world="${escHtml(world)}"
              title="Remover da tribo">🗑</button>`;
          }
        }
        const actionsCell = canManage
          ? `<td><div class="t-actions">${actions}</div></td>`
          : '';

        return `<tr>
          <td class="col-player">
            <div class="t-player-cell">${dot}<span class="t-name">${escHtml(m.player_name)}</span>${badge}</div>
          </td>
          <td class="t-time">${timeAgo(m.last_seen)}</td>
          ${groupCell}
          ${canSeeAllTroops ? `<td style="text-align:center;font-size:12px;color:${m.auto_update ? '#4caf50' : '#333'}">${m.auto_update ? '✔' : '—'}</td>` : ''}
          ${unitCells}
          <td class="t-update">${showTroops && lastReport ? timeAgo(lastReport) : '—'}</td>
          ${actionsCell}
        </tr>`;
      }).join('');

      el.innerHTML = `
        <table class="members-table">
          <thead>
            <tr>
              <th class="col-player">Jogador</th>
              <th title="Visto">Visto</th>
              <th title="Grupo">Grupo</th>
              ${canSeeAllTroops ? '<th title="Atualização automática">Auto</th>' : ''}
              ${unitHeaders}
              <th title="Último update"><img src="${chrome.runtime.getURL('png/clock.png')}" style="width:18px;height:18px;"></th>
              ${actionsHeader}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>`;

      el.onclick = async (e) => {
        // Toggle dropdown de grupos
        const groupBtn = e.target.closest('.btn-group-multi');
        if (groupBtn) {
          const drop = groupBtn.nextElementSibling;
          const isOpen = drop.style.display !== 'none';
          // Fecha todos os outros
          el.querySelectorAll('.group-multi-drop').forEach(d => d.style.display = 'none');
          drop.style.display = isOpen ? 'none' : '';
          return;
        }
        // Fecha dropdowns ao clicar fora
        if (!e.target.closest('.group-multi-wrapper')) {
          el.querySelectorAll('.group-multi-drop').forEach(d => d.style.display = 'none');
        }

        const btn = e.target.closest('.btn-request-troops:not(.sent)');
        if (btn) {
          btn.disabled = true; btn.textContent = '✔'; btn.classList.add('sent');
          await dbUpdate('memberships', { troop_request: true },
            `player_name=eq.${enc(btn.dataset.player)}&world=eq.${enc(btn.dataset.world)}`);
          return;
        }
        const rem = e.target.closest('.btn-remove-member');
        if (rem && confirm(`Remover "${rem.dataset.player}" da tribo?`)) {
          await dbUpdate('memberships', { status: 'removed' },
            `player_name=eq.${enc(rem.dataset.player)}&world=eq.${enc(rem.dataset.world)}`);
          rem.closest('tr').remove();
        }
      };

      el.onchange = async (e) => {
        const roleSel = e.target.closest('.role-select');
        if (roleSel) {
          await dbUpdate('memberships', { role: roleSel.value },
            `player_name=eq.${enc(roleSel.dataset.player)}&world=eq.${enc(roleSel.dataset.world)}`);
          return;
        }
        const groupCheck = e.target.closest('.group-check');
        if (groupCheck) {
          // Recolhe todos os checkboxes do mesmo jogador
          const wrapper  = groupCheck.closest('.group-multi-drop');
          const allBoxes = Array.from(wrapper.querySelectorAll('.group-check'));
          const newIds   = allBoxes.filter(c => c.checked).map(c => c.value);
          await dbUpdate('memberships', { group_ids: newIds },
            `player_name=eq.${enc(groupCheck.dataset.player)}&world=eq.${enc(groupCheck.dataset.world)}`);
          // Atualiza os badges na célula do grupo desta linha
          const row        = groupCheck.closest('tr');
          const badgesCell = row.querySelector('.group-badges-cell') ||
                             (() => { const td = row.cells[2]; td.innerHTML = ''; return td; })();
          const selected   = allGroupsCache.filter(g => newIds.includes(g.id));
          if (selected.length > 0) {
            row.cells[2].innerHTML = `<div class="group-badges-cell">${selected.map(g =>
              `<span class="group-badge-cell" style="--gc:${g.color}">${escHtml(g.name)}</span>`
            ).join('')}</div>`;
          } else {
            row.cells[2].innerHTML = '<span class="t-dash">—</span>';
          }
        }
      };

    } catch (err) {
      el.innerHTML = '<div class="empty">Erro ao carregar membros.</div>';
    }
  }

  async function loadPending(tribeName, world) {
    const listEl = q('pendingList');
    const badge  = q('pendingBadge');
    try {
      const rows = await dbGet('memberships',
        `tribe_name=eq.${enc(tribeName)}&world=eq.${enc(world)}&status=eq.pending&order=created_at.asc`);

      if (!rows || rows.length === 0) {
        listEl.innerHTML = '<div class="empty">Sem pedidos pendentes.</div>';
        badge.style.display = 'none';
        return;
      }

      badge.textContent = rows.length;
      badge.style.display = '';

      listEl.innerHTML = rows.map(m => `
        <div class="pending-card" id="pc-${m.id}">
          <div class="pending-card-name">${escHtml(m.player_name)}</div>
          <div class="pending-card-meta">Pedido em ${formatDate(m.created_at)}</div>
          <div class="btn-row">
            <button class="btn-approve" data-id="${m.id}" data-action="approved">✔ Aceitar</button>
            <button class="btn-reject"  data-id="${m.id}" data-action="rejected">✖ Rejeitar</button>
          </div>
        </div>`).join('');

      listEl.onclick = async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        btn.disabled = true;
        await decideMember(btn.dataset.id, btn.dataset.action);
      };

    } catch (err) {
      listEl.innerHTML = '<div class="empty">Erro ao carregar pedidos.</div>';
    }
  }

  async function decideMember(id, decision) {
    try {
      await dbUpdate('memberships',
        { status: decision, approved_by: currentPlayer?.name || null },
        `id=eq.${id}`);

      shadow.querySelector(`#pc-${id}`)?.remove();

      const remaining = shadow.querySelectorAll('[id^="pc-"]').length;
      const badge = q('pendingBadge');
      if (remaining === 0) {
        badge.style.display = 'none';
        q('pendingList').innerHTML = '<div class="empty">Sem pedidos pendentes.</div>';
      } else {
        badge.textContent = remaining;
      }
    } catch (err) {
      console.error('[EOS] decideMember:', err);
    }
  }

  let countdownTimer = null;

  function startCountdown() {
    stopCountdown();
    const el = q('updateCountdown');
    if (!el) return;

    async function tick() {
      if (!isContextValid()) { stopCountdown(); return; }
      let autoUpdateNextTimes;
      try {
        ({ autoUpdateNextTimes } = await chrome.storage.local.get('autoUpdateNextTimes'));
      } catch (_) { stopCountdown(); return; }

      const times = autoUpdateNextTimes || [];
      if (times.length === 0) { el.textContent = ''; return; }

      // Mostra o próximo agendamento mais próximo
      const soonest = times.reduce((a, b) => a.nextTime < b.nextTime ? a : b);
      const diff = soonest.nextTime - Date.now();
      if (diff <= 0) { el.textContent = `A atualizar ${soonest.groupName}...`; return; }

      const totalSec = Math.floor(diff / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const parts = [];
      if (h > 0) parts.push(`${h}h`);
      if (h > 0 || m > 0) parts.push(`${m}m`);
      parts.push(`${s}s`);
      el.textContent = `${soonest.groupName} em: ${parts.join(' ')}`;
    }

    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    const el = q('updateCountdown');
    if (el) el.textContent = '';
  }

  function setupUpdateBtn(world) {
    const btn = q('updateTroopsBtn');
    if (!btn || btn.dataset.setup) return;
    btn.dataset.setup = '1';
    btn.addEventListener('click', async () => {
      btn.style.opacity = '0.4';
      btn.style.pointerEvents = 'none';
      const { twSelectedGroupId } = await chrome.storage.local.get('twSelectedGroupId');
      const groupParam = twSelectedGroupId ? `&group=${twSelectedGroupId}` : '';
      await chrome.storage.local.set({ pendingTroopRequest: true });
      const url = `https://${world}.tribalwars.com.pt/game.php?screen=overview_villages&mode=units&type=own_home${groupParam}`;
      chrome.runtime.sendMessage({ type: 'CREATE_TAB', url, active: true });
      setTimeout(() => {
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
      }, 15000);
    });

    const settingsBtn = q('settingsHeaderBtn');
    if (settingsBtn && !settingsBtn.dataset.setup) {
      settingsBtn.dataset.setup = '1';
      settingsBtn.addEventListener('click', () => openSettings());
    }

    startCountdown();
  }

  // ── Definições inline ────────────────────────────────────────────────────

  let settingsTWGroups  = [];
  let settingsSchedules = [];
  let settingsPrevView  = 'viewPanel';

  function openSettings() {
    settingsPrevView = shadow.querySelector('.view.active')?.id || 'viewPanel';
    // Carrega dados do storage
    chrome.storage.local.get(['twGroups', 'autoUpdateSchedules'], (data) => {
      settingsTWGroups  = data.twGroups || [];
      settingsSchedules = JSON.parse(JSON.stringify(data.autoUpdateSchedules || []));
      renderSettingsExtractStatus();
      renderSettingsSchedules();
      showView('viewSettings');
      setupSettingsListeners();
    });
  }

  function setupSettingsListeners() {
    const backBtn = q('settingsBackBtn');
    if (backBtn && !backBtn.dataset.setup) {
      backBtn.dataset.setup = '1';
      backBtn.addEventListener('click', () => showView(settingsPrevView));
    }

    const extractBtn = q('sExtractBtn');
    if (extractBtn && !extractBtn.dataset.setup) {
      extractBtn.dataset.setup = '1';
      extractBtn.addEventListener('click', () => {
        const origin = window.location.origin;
        chrome.runtime.sendMessage({ type: 'CREATE_TAB', url: `${origin}/game.php?screen=overview_villages&mode=groups`, active: true });
        const st = q('sExtractStatus');
        if (st) { st.textContent = 'A abrir página de grupos...'; st.style.color = '#555'; }
      });
    }

    const addBtn = q('sAddScheduleBtn');
    if (addBtn && !addBtn.dataset.setup) {
      addBtn.dataset.setup = '1';
      addBtn.addEventListener('click', () => {
        settingsSchedules.push({ twGroupId: '0', twGroupName: 'Todos', intervalMin: 1440 });
        renderSettingsSchedules();
      });
    }

    const saveBtn = q('sSaveBtn');
    if (saveBtn && !saveBtn.dataset.setup) {
      saveBtn.dataset.setup = '1';
      saveBtn.addEventListener('click', () => saveSettings());
    }

    // Actualiza grupos quando extraídos (enquanto a view estiver aberta)
    if (!shadow._settingsStorageListener) {
      shadow._settingsStorageListener = true;
      chrome.storage.onChanged.addListener((changes) => {
        if (!changes.twGroups) return;
        settingsTWGroups = changes.twGroups.newValue || [];
        const st = q('sExtractStatus');
        if (st) {
          st.textContent = `✔ ${settingsTWGroups.length} grupos extraídos!`;
          st.style.color = '#4caf50';
        }
        renderSettingsSchedules(); // actualiza dropdowns
      });
    }
  }

  function renderSettingsExtractStatus() {
    const st = q('sExtractStatus');
    if (!st) return;
    if (settingsTWGroups.length > 0) {
      st.textContent = `${settingsTWGroups.length} grupo(s): ${settingsTWGroups.map(g => g.name).join(', ')}`;
      st.style.color = '#555';
    } else {
      st.textContent = 'Nenhum grupo extraído ainda.';
      st.style.color = '#444';
    }
  }

  function settingsGroupOptions(selectedId) {
    const allOpt = `<option value="0" ${!selectedId || selectedId === '0' ? 'selected' : ''}>Todos</option>`;
    const opts = settingsTWGroups.map(g =>
      `<option value="${g.id}" ${String(g.id) === String(selectedId) ? 'selected' : ''}>${escHtml(g.name)}</option>`
    ).join('');
    return allOpt + opts;
  }

  function renderSettingsSchedules() {
    const list = q('sSchedulesList');
    if (!list) return;

    if (settingsSchedules.length === 0) {
      list.innerHTML = '<div class="s-empty-schedules">Sem agendamentos. Adiciona um abaixo.</div>';
      return;
    }

    list.innerHTML = settingsSchedules.map((s, i) => {
      const h = Math.floor((s.intervalMin || 0) / 60);
      const m = (s.intervalMin || 0) % 60;
      return `<div class="s-schedule-row" data-idx="${i}">
        <select class="s-sched-group" data-idx="${i}">${settingsGroupOptions(s.twGroupId)}</select>
        <input type="number" class="s-sched-num s-sched-h" data-idx="${i}" min="0" max="167" value="${h}" title="Horas">
        <span class="s-sched-label">h</span>
        <input type="number" class="s-sched-num s-sched-m" data-idx="${i}" min="0" max="59"  value="${m}" title="Minutos">
        <span class="s-sched-label">min</span>
        <button class="btn-sched-del" data-idx="${i}">🗑</button>
      </div>`;
    }).join('');

    list.querySelectorAll('.s-sched-group').forEach(sel => {
      sel.onchange = () => {
        const idx = +sel.dataset.idx;
        const chosen = settingsTWGroups.find(g => String(g.id) === sel.value) || { id: '0', name: 'Todos' };
        settingsSchedules[idx].twGroupId   = sel.value || '0';
        settingsSchedules[idx].twGroupName = sel.value === '0' || !sel.value ? 'Todos' : chosen.name;
      };
    });
    list.querySelectorAll('.s-sched-h').forEach(inp => {
      inp.onchange = () => {
        const idx = +inp.dataset.idx;
        const h = Math.max(0, Math.min(167, parseInt(inp.value) || 0));
        inp.value = h;
        const mInp = list.querySelector(`.s-sched-m[data-idx="${idx}"]`);
        const m = parseInt(mInp?.value) || 0;
        settingsSchedules[idx].intervalMin = h * 60 + m;
      };
    });
    list.querySelectorAll('.s-sched-m').forEach(inp => {
      inp.onchange = () => {
        const idx = +inp.dataset.idx;
        const m = Math.max(0, Math.min(59, parseInt(inp.value) || 0));
        inp.value = m;
        const hInp = list.querySelector(`.s-sched-h[data-idx="${idx}"]`);
        const h = parseInt(hInp?.value) || 0;
        settingsSchedules[idx].intervalMin = h * 60 + m;
      };
    });
    list.querySelectorAll('.btn-sched-del').forEach(btn => {
      btn.onclick = () => {
        settingsSchedules.splice(+btn.dataset.idx, 1);
        renderSettingsSchedules();
      };
    });
  }

  async function saveSettings() {
    const st = q('sStatus');
    // Valida
    for (const s of settingsSchedules) {
      if (!s.intervalMin || s.intervalMin < 1) {
        if (st) { st.textContent = 'Intervalo mínimo: 1 minuto.'; st.className = 's-status s-err'; }
        return;
      }
    }
    const seen = new Set();
    for (const s of settingsSchedules) {
      if (seen.has(s.twGroupId)) {
        if (st) { st.textContent = 'Grupo duplicado num agendamento.'; st.className = 's-status s-err'; }
        return;
      }
      seen.add(s.twGroupId);
    }
    await chrome.storage.local.set({
      autoUpdateSchedules: settingsSchedules,
      autoUpdate: settingsSchedules.length > 0
    });
    chrome.runtime.sendMessage({ type: 'UPDATE_ALARM' });
    if (st) {
      st.textContent = '✔ Definições guardadas!';
      st.className = 's-status s-ok';
      setTimeout(() => { if (st) st.textContent = ''; }, 2500);
    }
  }

function setupShareTroopsBtn(world) {
    const btn = q('shareTroopsBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'A abrir...';
      const { twSelectedGroupId } = await chrome.storage.local.get('twSelectedGroupId');
      const groupParam = twSelectedGroupId ? `&group=${twSelectedGroupId}` : '';
      await chrome.storage.local.set({ pendingTroopRequest: true });
      const troopsUrl = `https://${world}.tribalwars.com.pt/game.php?screen=overview_villages&mode=units&type=own_home${groupParam}`;
      chrome.runtime.sendMessage({ type: 'CREATE_TAB', url: troopsUrl, active: true });
      q('troopRequestBanner').style.display = 'none';
    });
  }

  function setupTabs() {
    shadow.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        if (!target) return;
        shadow.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        shadow.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        shadow.querySelector('#' + target)?.classList.add('active');
      });
    });
  }

  // ── Utilitários de tropas ────────────────────────────────────────────────
  const UNIT_NAMES = {
    spear: 'Lanceiros', sword: 'Espadachins', axe: 'Vikings',
    spy: 'Batedores', light: 'Leves', heavy: 'Pesadas',
    ram: 'Arietes', catapult: 'Catapultas', snob: 'Nobres'
  };

  function fmtK(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1).replace('.0', '') + 'k';
    return n.toString();
  }

  // ── Utilitários ──────────────────────────────────────────────────────────
  function enc(str) { return encodeURIComponent(str || ''); }

  function escHtml(str) {
    return (str || '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function timeAgo(isoStr) {
    if (!isoStr) return '';
    const min = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
    if (min < 2)  return 'agora';
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    if (h  < 24)  return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  function onlineDot(isoStr) {
    if (!isoStr) return 'dot-offline';
    const min = (Date.now() - new Date(isoStr).getTime()) / 60000;
    if (min < 15)  return 'dot-online';
    if (min < 120) return 'dot-recent';
    return 'dot-offline';
  }

  function formatDate(isoStr) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleString('pt-PT', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }
})();
