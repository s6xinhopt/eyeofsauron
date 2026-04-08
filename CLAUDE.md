# Sentinel — TW Troop Reporter

## Visão Geral

Extensão de browser (Chrome/Chromium, Manifest V3) para **Tribal Wars** (`tribalwars.com.pt`) que lê automaticamente o total de tropas do jogador e reporta para o Discord da tribo.

O projeto está a crescer para um sistema completo de inteligência tribal:

1. **Extensão de browser** — lê tropas, envia para base de dados (e/ou Discord diretamente)
2. **Base de dados** — armazena histórico de tropas por jogador/mundo/timestamp
3. **Bot de Discord** — permite ao líder da tribo consultar os dados via comandos no Discord

---

## Arquitetura Atual

```
sentinel/
├── manifest.json      # Manifest V3; permissões: activeTab, scripting, storage, tabs
├── content.js         # Injected em *.tribalwars.com.pt — lê a tabela de tropas e envia para Discord
├── popup.html         # UI da extensão (320px, tema escuro medieval)
├── popup.js           # Lógica do popup: config, disparo manual do relatório
└── icons/
    └── icon128.png
```

### Fluxo atual (manual)
1. Utilizador abre o popup → configura nome e webhook do Discord
2. Clica "Enviar Tropas" → popup abre `game.php?screen=overview_villages&mode=units` numa nova tab
3. `content.js` deteta a página, lê `#units_table`, constrói embed Discord, envia via webhook
4. Tab fecha automaticamente após 1.5s

### Comunicação entre scripts
- `popup.js` → `chrome.storage.local` (`pendingReport: true`) → `content.js` lê o sinal
- `content.js` → `chrome.runtime.sendMessage` (`REPORT_SUCCESS` / `REPORT_ERROR`) → `popup.js` recebe e exibe status

---

## Roadmap / Funcionalidades Planeadas

### Fase 1 — Auto-report periódico
- [ ] Adicionar `background.js` (service worker) com alarm do Chrome (`chrome.alarms`)
- [ ] Intervalo configurável no popup (padrão: 60 minutos)
- [ ] Disparar automaticamente ao iniciar o browser (`chrome.runtime.onInstalled` / `onStartup`)
- [ ] Guardar timestamp do último envio em `chrome.storage.local`

### Fase 2 — Base de dados
- [ ] Definir backend (sugestão: Supabase ou Railway com PostgreSQL)
- [ ] Endpoint REST/API para receber reports da extensão
- [ ] Schema mínimo: `jogador`, `mundo`, `tropas (JSON)`, `timestamp`
- [ ] A extensão envia para a API em vez de (ou além do) Discord diretamente

### Fase 3 — Bot de Discord
- [ ] Bot em Node.js com `discord.js`
- [ ] Comando `/tropas @jogador` — mostra últimas tropas de um jogador
- [ ] Comando `/tropas tribo` — mostra resumo de todos os membros
- [ ] Hospedagem: Railway, Render, ou VPS simples

---

## Decisões Técnicas

| Decisão | Escolha | Razão |
|---|---|---|
| Manifest version | V3 | Obrigatório para novas extensões Chrome |
| Comunicação popup↔content | `chrome.storage.local` (signal flag) | Service workers não têm acesso direto a tabs abertas de forma fiável |
| Envio Discord | Webhook direto | Simples, sem servidor; suficiente para Fase 1 |
| Parsing de tropas | `#units_table` + fallback `table.vis` | Estrutura do TW PT |
| Língua do código | Português nos comentários e UI | Utilizadores são PT |

---

## Contexto do Jogo

- **Tribal Wars PT** — `*.tribalwars.com.pt`
- A página de tropas é: `game.php?screen=overview_villages&mode=units`
- Unidades suportadas: `spear, sword, axe, archer, spy, light, marcher, heavy, ram, catapult, knight, snob`
- Cada mundo tem um subdomínio próprio (ex: `pt101.tribalwars.com.pt`)
- A extensão deve funcionar em qualquer mundo PT

---

## Convenções de Código

- JavaScript puro (sem bundler); sem TypeScript por enquanto
- Funções nomeadas em camelCase, comentários em português
- Logs prefixados com `[TW Reporter]` para fácil filtragem na consola
- Não usar `eval()`, `innerHTML` com dados externos, ou outras superfícies de XSS
- Validar o webhook URL antes de guardar (deve começar com `https://discord.com/api/webhooks/`)

---

## Como Instalar para Desenvolvimento

1. Abrir Chrome → `chrome://extensions/`
2. Ativar **Modo de programador**
3. Clicar **Carregar sem compactação** → selecionar esta pasta
4. Abrir o TribalWars PT e navegar para a página de tropas para testar

---

## Notas Importantes

- A extensão só funciona em `tribalwars.com.pt` (definido em `host_permissions`)
- O `content.js` só age quando `pendingReport === true` no storage — não corre em todas as visitas à página
- O Discord tem rate limit nos webhooks: 30 requests/minuto por webhook
- Para o auto-report periódico, usar `chrome.alarms` (não `setInterval`) porque service workers podem ser suspensos
