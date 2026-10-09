/**
 * Page Translator Mobile - traduz o roteiro de uma página SEM nenhuma
 * IA (nem modelo local de visão, nem Gemini): lê o roteiro OFICIAL já
 * existente (script.traw), linha por linha, e manda pro tradutor
 * gratuito (studio.translate.free - endpoint público do Google
 * Translate, sem chave nenhuma, e SEM relação com studio.ai/Gemini).
 * É o mesmo caminho "sem chave" do Page Translator original, só que
 * aqui é o ÚNICO caminho - sem detecção de balão por modelo local
 * nem OCR via Gemini, de propósito: nada de modelo pra carregar deixa
 * isso rápido o bastante pra rodar bem em qualquer celular, mesmo os
 * mais fracos.
 *
 * O rascunho/revisão/confirmação (translate.traw -> script.traw) segue
 * exatamente o mesmo padrão do Page Translator - ver
 * docs/extensions/project-api.md ("Roteiro oficial vs. rascunho") no
 * repo principal.
 *
 * MODO NUVEM (automático, SEM precisar ligar nada nas configurações):
 * cobre o caso em que a página AINDA NÃO TEM roteiro nenhum (projeto
 * só com "raw", nada digitado ainda) - sem roteiro não tem o que
 * traduzir localmente, e sem visão computacional não dá pra "ler" o
 * texto direto da imagem. Mesma ideia do Page Translator original
 * (que tentava o Gemini primeiro e só caía pro tradutor gratuito se
 * não desse) - só que aqui, em vez do Gemini, quem faz a parte de
 * "enxergar" a imagem é a MESMA API na nuvem já usada pelo Smart
 * Cleaner Mobile (straw-studio-ai-cloud, ver
 * examples/smart-cleaner-mobile): sessão autodestrutiva, sem chave,
 * rate limit por IP do lado do servidor em vez de credencial, modelos
 * abertos auto-hospedados - NUNCA Gemini nem qualquer IA generativa de
 * terceiros. A operação usada é "detect-text" (detecção de balão +
 * OCR) - DIFERENTE do fluxo genérico (model/feeds/outputNames) que o
 * Smart Cleaner Mobile usa pra rodar o MI-GAN; o mesmo servidor atende
 * os dois. A TRADUÇÃO do texto reconhecido continua SEMPRE sendo feita
 * localmente via studio.translate.free - a nuvem só detecta/lê, nunca
 * traduz nada.
 *
 * Resumindo o fluxo de 'run-translate' (ver mais abaixo): roteiro já
 * existente -> traduz ele direto (rápido, sem tocar rede nenhuma); sem
 * roteiro mas COM imagem -> usa a nuvem pra ler o texto e traduz o que
 * ela devolver; sem roteiro E sem imagem nenhuma -> não há nada pra
 * traduzir de jeito nenhum.
 */
module.exports = function (studio) {
  // mesma API na nuvem do Smart Cleaner Mobile (straw-studio-ai-cloud)
  // - sem chave de API de proposito: o freio contra abuso é rate
  // limit por IP do lado do servidor, não uma credencial aqui.
  const CLOUD_URL = 'https://ai.blast.net.br';

  function getSettings() {
    return {
      targetLang: studio.settings.get('targetLang') || 'en',
      // so usado pelo modo nuvem (op "detect-text", automatico quando
      // a pagina nao tem roteiro) - define em que ordem os baloes
      // detectados viram linhas do rascunho
      readingDirection: studio.settings.get('readingDirection') === 'rtl' ? 'rtl' : 'ltr',
    };
  }

  /** Traduz o roteiro OFICIAL já existente da página, linha por linha,
   *  via tradutor gratuito - sem IA, sem chave, sem Gemini. Cada LINHA
   *  pode ter vários balões separados por " / " (formato padrão do
   *  .traw) - traduz cada PARTE separadamente e junta de volta com
   *  " / ", preservando a separação entre balões no rascunho. */
  async function draftViaFreeTranslate(existingScriptLines, targetLang) {
    const draft = [];
    for (const line of existingScriptLines) {
      if (!line || !line.trim()) continue;
      const parts = line.split('/').map((p) => p.trim()).filter(Boolean);
      const translatedParts = [];
      for (const part of parts) {
        const result = await studio.translate.free(part, targetLang);
        translatedParts.push((result.text || '').trim());
      }
      draft.push(translatedParts.join(' / '));
    }
    return draft;
  }

  async function cloudFetch(path, opts) {
    const res = await studio.network.fetch(`${CLOUD_URL}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) },
    });
    let body;
    try {
      body = JSON.parse(res.text);
    } catch (err) {
      throw new Error(`Resposta inválida da nuvem (HTTP ${res.status}).`);
    }
    if (!res.ok) throw new Error(body.error || `A nuvem respondeu ${res.status}.`);
    return body;
  }

  // 3 passos da sessão na nuvem (criar/disparar/poll), separados de
  // propósito - o LOOP de espera mora no PAINEL (ui/app.js), não aqui:
  // este arquivo roda num sandbox vm isolado sem setTimeout.
  async function cloudCreateSession() {
    return cloudFetch('/sessions', { method: 'POST' });
  }

  async function cloudProcess(sessionId, imageBase64, readingDirection) {
    // op "detect-text" do straw-studio-ai-cloud - so pede DETECCAO +
    // OCR (texto ORIGINAL lido da imagem), nunca tradução nenhuma: o
    // servidor nao recebe (nem precisa de) targetLang nenhum. A
    // traducao do texto devolvido continua acontecendo aqui,
    // localmente, via studio.translate.free (ver 'translate-lines'
    // abaixo) - mesmo caminho sem IA de sempre.
    return cloudFetch(`/sessions/${sessionId}/process`, {
      method: 'POST',
      body: JSON.stringify({ op: 'detect-text', image: imageBase64, readingDirection }),
    });
  }

  async function cloudPoll(sessionId) {
    return cloudFetch(`/sessions/${sessionId}/result`);
  }

  /** Resolve qual página usar: a informada explicitamente pelo painel
   *  (navegação Anterior/Próxima) ou, na falta dela, a atual do editor
   *  (carga inicial do painel). */
  async function resolvePageKey(info, requestedKey) {
    if (requestedKey) {
      if (!info.pageKeys.includes(requestedKey)) {
        throw new Error(`Página "${requestedKey}" não existe neste projeto.`);
      }
      return requestedKey;
    }
    const current = await studio.project.getCurrentPage();
    if (!current.pageKey) throw new Error('Nenhuma página aberta no editor no momento.');
    return current.pageKey;
  }

  async function loadPageState(requestedKey) {
    const info = await studio.project.getInfo();
    const pageKey = await resolvePageKey(info, requestedKey);
    const page = info.pages.find((p) => p.key === pageKey);
    const hasRaw = Boolean(page && page.hasRaw);
    const hasPageImage = Boolean(page && page.hasPageImage);
    const [script, draft] = await Promise.all([
      studio.project.readScript(pageKey),
      studio.project.readTranslateDraft(pageKey),
    ]);

    let imageBase64 = null;
    if (hasRaw || hasPageImage) {
      imageBase64 = await studio.project.readPageImage(pageKey, hasRaw ? 'raw' : 'pages');
    }

    return { pageKey, pageKeys: info.pageKeys, hasRaw, hasPageImage, script, draft, imageBase64 };
  }

  studio.menu.register({
    id: 'page-translator-mobile.open',
    name: 'Traduzir página (Mobile)',
    icon: 'translate',
    action() {
      studio.ui.openPanel({
        title: 'Page Translator Mobile',
        htmlFile: 'ui/index.html',
        async onMessage(msg) {
          if (!msg || typeof msg.type !== 'string') {
            throw new Error('Page Translator Mobile: mensagem sem "type"');
          }

          switch (msg.type) {
            case 'get-settings':
              return getSettings();

            case 'save-settings': {
              studio.settings.set('targetLang', (msg.targetLang || 'en').trim());
              studio.settings.set('readingDirection', msg.readingDirection === 'rtl' ? 'rtl' : 'ltr');
              return { ok: true };
            }

            case 'get-page-state':
              return loadPageState(msg.pageKey);

            // só o caminho "já tem roteiro" (rápido, sem rede nenhuma) -
            // o painel (ui/app.js) decide sozinho se chama isto ou o
            // modo nuvem (cloud-create-session/process/poll +
            // translate-lines abaixo), conforme a página tiver roteiro
            // ou não. Chamado direto sem roteiro nenhum, é um erro -
            // nunca deveria acontecer vindo do painel normal.
            case 'run-translate': {
              const { targetLang } = getSettings();
              const state = await loadPageState(msg.pageKey);
              if (!state.script.length) {
                throw new Error('Esta página ainda não tem roteiro nenhum pra traduzir localmente.');
              }
              const draft = await draftViaFreeTranslate(state.script, targetLang);
              await studio.project.writeTranslateDraft(state.pageKey, draft);
              return { pageKey: state.pageKey, draft };
            }

            case 'save-draft': {
              await studio.project.writeTranslateDraft(msg.pageKey, msg.lines || []);
              return { ok: true };
            }

            case 'confirm': {
              const lines = msg.lines || [];
              await studio.project.writeTranslateDraft(msg.pageKey, lines);
              await studio.project.writeScript(msg.pageKey, lines);
              await studio.editor.refresh();
              return { ok: true };
            }

            // ---- modo nuvem opcional (ver cabeçalho do arquivo) ----
            case 'cloud-create-session':
              return cloudCreateSession();

            case 'cloud-process':
              return cloudProcess(msg.sessionId, msg.imageBase64, getSettings().readingDirection);

            case 'cloud-poll':
              return cloudPoll(msg.sessionId);

            // traduz linhas ARBITRARIAS (ex: texto original lido via
            // OCR na nuvem) via tradutor gratuito - mesmo caminho sem
            // IA de 'run-translate', so que a entrada vem direto do
            // painel em vez do roteiro oficial do projeto.
            case 'translate-lines': {
              const draft = await draftViaFreeTranslate(msg.lines || [], msg.targetLang || getSettings().targetLang);
              return { draft };
            }

            default:
              throw new Error(`Page Translator Mobile: mensagem desconhecida "${msg.type}"`);
          }
        },
      });
    },
  });
};
