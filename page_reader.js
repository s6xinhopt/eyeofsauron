// Corre no contexto MAIN da página — tem acesso direto a window.game_data e window.Groups
(function () {
  // Envia dados do jogador
  if (window.game_data) {
    const gd = window.game_data;
    const playerName = gd.player && gd.player.name ? gd.player.name : null;

    if (playerName) {
      // Tenta obter o nome COMPLETO da tribo de várias fontes
      // ally.name é o tag/abreviatura (ex: "NT"); ally.full_name é o nome completo
      const tribeName = (gd.ally && gd.ally.full_name)
        || (gd.ally && gd.ally.name)
        || (gd.player && gd.player.ally_name)
        || (gd.player && gd.player.tribe_name)
        // Fallback: lê do DOM (header da página TW)
        || (document.querySelector('#ally_link')?.textContent?.trim())
        || (document.querySelector('a[href*="screen=info_ally"]')?.textContent?.trim())
        || '';

      const allyId = (gd.player && gd.player.ally) ? String(gd.player.ally) : '0';
      const hasTribe = allyId !== '0' && allyId !== '';

      window.postMessage({
        type:       'EOS_GAME_DATA',
        playerName: playerName,
        tribeName:  tribeName,
        allyId:     allyId,
        hasTribe:   hasTribe
      }, '*');
    }
  }

  // Envia window.Groups se disponível (objeto {id: nome} ou {id: {name:...}})
  if (window.Groups && typeof window.Groups === 'object') {
    const groups = [];
    const seen = new Set();
    for (const [id, val] of Object.entries(window.Groups)) {
      if (!id || id === '0') continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const name = typeof val === 'string' ? val
                 : (val && val.name) ? val.name
                 : String(val);
      if (name) groups.push({ id, name });
    }
    if (groups.length > 0) {
      window.postMessage({ type: 'EOS_GROUPS_DATA', groups }, '*');
    }
  }
})();

// ── Mapa: envia viewport do TWMap para o content.js (fora do IIFE) ──
(function initMapBridge() {
  if (!window.game_data || window.game_data.screen !== 'map') return;

  let attempts = 0;
  function tryStart() {
    attempts++;
    if (window.TWMap && window.TWMap.map && window.TWMap.map.scale && document.getElementById('map')) {
      run();
    } else if (attempts < 100) {
      setTimeout(tryStart, 200);
    }
  }

  function run() {
    let lastState = '';
    function post() {
      try {
        const pos = window.TWMap.pos || [500, 500];
        const scale = window.TWMap.map.scale || [53, 38];
        const rect = document.getElementById('map').getBoundingClientRect();
        if (rect.width === 0) return;

        const state = `${pos[0]},${pos[1]},${rect.left|0},${rect.top|0},${rect.width|0},${rect.height|0}`;
        if (state === lastState) return;
        lastState = state;

        window.postMessage({
          type: 'EOS_MAP_VIEWPORT',
          centerX: pos[0], centerY: pos[1],
          fieldW: scale[0], fieldH: scale[1],
          canvasLeft: rect.left, canvasTop: rect.top,
          canvasW: rect.width, canvasH: rect.height
        }, '*');
      } catch (_) {}
    }

    setInterval(post, 300);
    post();

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'EOS_MAP_REQUEST_VIEWPORT') { lastState = ''; post(); }
    });
  }

  tryStart();
})();
