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

// ── Mapa: guarda TWMap.pos num data attribute para o content.js ler ──
(function initMapBridge() {
  if (!window.game_data || window.game_data.screen !== 'map') return;

  var attempts = 0;
  function tryStart() {
    attempts++;
    if (window.TWMap && window.TWMap.pos) {
      run();
    } else if (attempts < 200) {
      setTimeout(tryStart, 100);
    }
  }

  function run() {
    var mapEl = document.getElementById('map');
    if (!mapEl) return;

    // Guarda posição + village IDs no DOM
    setInterval(function() {
      try {
        var pos = window.TWMap.pos;
        if (pos) {
          mapEl.setAttribute('data-eos-cx', pos[0]);
          mapEl.setAttribute('data-eos-cy', pos[1]);
        }
      } catch (e) {}
    }, 50);

    // Escreve mapeamento coord→id das aldeias visíveis (menos frequente)
    setInterval(function() {
      try {
        var villages = window.TWMap.villages;
        if (!villages) return;
        var map = {};
        for (var key in villages) {
          var v = villages[key];
          if (v && v.id) {
            var x = Math.floor(parseInt(key) / 1000);
            var y = parseInt(key) % 1000;
            map[x + '|' + y] = v.id;
          }
        }
        mapEl.setAttribute('data-eos-villages', JSON.stringify(map));
      } catch (e) {}
    }, 2000);
  }

  tryStart();
})();
