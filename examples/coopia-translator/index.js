/**
 * CoopIA - Traduzir página. Fork do Page Translator que troca o Gemini por dois caminhos 100%
 * locais/self-hosted, autenticados (mesmo ID/senha do TeamDrive), cobrando 1 crédito por fala:
 *
 * - Roteiro já existe: traduz o texto já digitado (script.traw) via CoopIA (LibreTranslate) -
 *   igual ao caminho "sem chave Gemini" do extension original, só que é sempre esse caminho aqui.
 * - Página ainda sem roteiro: detecta balão/texto (RT-DETRv2) e LÊ o texto original (OCR via
 *   Tesseract, tudo rodando no servidor do CoopIA - ver "op: detect-text" em sTrawStudio-CoopIA)
 *   e then traduz as linhas lidas. Cobre o mesmo caso que só o Gemini cobria antes, sem IA
 *   generativa de terceiros nenhuma.
 *
 * Mantém: rascunho (translate.traw) revisável antes de virar roteiro oficial, navegação entre
 * páginas sem fechar o painel, "Salvar roteiro"/studio.editor.refresh().
 */
module.exports = function (studio) {
  const CLOUD_URL = 'https://ai.blast.net.br';

  function getToken() { return studio.settings.get('coopiaToken') || ''; }
  function setToken(t) { studio.settings.set('coopiaToken', t || ''); }

  async function cloudFetch(path, opts = {}) {
    const token = getToken();
    const res = await studio.network.fetch(`${CLOUD_URL}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...((opts && opts.headers) || {}) },
    });
    let body;
    try { body = JSON.parse(res.text); } catch (err) { throw new Error(`Resposta inválida do CoopIA (HTTP ${res.status}).`); }
    if (!res.ok) {
      if (res.status === 401) setToken('');
      throw Object.assign(new Error(body.error || `O CoopIA respondeu ${res.status}.`), { status: res.status });
    }
    return body;
  }

  async function login(code, password) {
    const out = await cloudFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ code, password }) });
    setToken(out.token);
    return out.profile;
  }
  async function setupPassword(code, password) {
    const out = await cloudFetch('/api/auth/setup-password', { method: 'POST', body: JSON.stringify({ code, password }) });
    setToken(out.token);
    return out.profile;
  }
  async function authStatus() {
    if (!getToken()) return { loggedIn: false };
    try {
      const me = await cloudFetch('/api/auth/me');
      return { loggedIn: true, profile: { code: me.code, team: me.team }, credits: me.credits };
    } catch { return { loggedIn: false }; }
  }
  async function logout() {
    try { await cloudFetch('/api/auth/logout', { method: 'POST' }); } catch { /* sessão já pode ter caído */ }
    setToken('');
  }

  const OCR_ENGINES = ['auto', 'manga-ocr', 'easyocr'];
  function getSettings() {
    return {
      targetLang: studio.settings.get('targetLang') || 'en',
      // ordem de leitura usada SÓ pela detecção na imagem (sem roteiro ainda) - agrupa balões
      // por fileira e ordena cada fileira nessa direção (ver textDetect.js no servidor).
      readingDirection: studio.settings.get('readingDirection') === 'rtl' ? 'rtl' : 'ltr',
      // qual IA de OCR usar na detecção (sem roteiro ainda, ver "op: detect-text" no servidor):
      // "auto" deixa o servidor decidir pelo idioma/proporção da página; dá pra forçar
      // manga-ocr (mangá japonês) ou easyocr (coreano/manhwa e o resto) e trocar a qualquer
      // momento - nada fica "preso" de uma chamada pra outra.
      ocrEngine: OCR_ENGINES.includes(studio.settings.get('ocrEngine')) ? studio.settings.get('ocrEngine') : 'auto',
    };
  }

  /** Traduz uma lista de linhas JÁ LIDAS (uma por região, sem " / " - isso é só do formato do
   *  script.traw) - usado depois do "op: detect-text" (ver cloud-process-detect abaixo). */
  async function translateLines(lines, targetLang) {
    if (!lines.length) return { draft: [], credits: null };
    const out = await cloudFetch('/api/translate', { method: 'POST', body: JSON.stringify({ q: lines, target: targetLang }) });
    return { draft: out.results.map((r) => (r.translatedText || '').trim()), credits: out.credits };
  }

  /**
   * Traduz o roteiro OFICIAL já existente da página, linha por linha, via CoopIA (LibreTranslate
   * self-hosted). Cada LINHA do script.traw pode ter vários balões separados por " / " - traduz
   * cada parte separadamente (preserva a separação no rascunho) numa ÚNICA chamada em lote pro
   * CoopIA (1 requisição HTTP, N créditos - não N requisições). Devolve [] se não houver roteiro
   * ainda (sem OCR/visão, não dá pra "ler" texto de uma imagem sem roteiro nenhum).
   */
  async function draftViaCoopIA(existingScriptLines, targetLang) {
    const lineParts = existingScriptLines
      .filter((line) => line && line.trim())
      .map((line) => line.split('/').map((p) => p.trim()).filter(Boolean));
    const flatParts = lineParts.flat();
    if (!flatParts.length) return [];

    const out = await cloudFetch('/api/translate', {
      method: 'POST',
      body: JSON.stringify({ q: flatParts, target: targetLang }),
    });

    let i = 0;
    const draft = lineParts.map((parts) => parts.map(() => (out.results[i++].translatedText || '').trim()).join(' / '));
    return { draft, credits: out.credits };
  }

  async function resolvePageKey(info, requestedKey) {
    if (requestedKey) {
      if (!info.pageKeys.includes(requestedKey)) throw new Error(`Página "${requestedKey}" não existe neste projeto.`);
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
    const [script, draft] = await Promise.all([studio.project.readScript(pageKey), studio.project.readTranslateDraft(pageKey)]);

    let imageBase64 = null;
    if (hasRaw || hasPageImage) imageBase64 = await studio.project.readPageImage(pageKey, hasRaw ? 'raw' : 'pages');

    return { pageKey, pageKeys: info.pageKeys, hasRaw, hasPageImage, script, draft, imageBase64 };
  }

  studio.menu.register({
    id: 'coopia-translator.open',
    name: 'Traduzir página (CoopIA)',
    icon: 'translate',
    action() {
      studio.ui.openPanel({
        title: 'CoopIA - Traduzir página',
        htmlFile: 'ui/index.html',
        async onMessage(msg) {
          if (!msg || typeof msg.type !== 'string') throw new Error('CoopIA Translator: mensagem sem "type"');

          switch (msg.type) {
            case 'auth-status': return authStatus();
            case 'auth-login': return { profile: await login(msg.code, msg.password) };
            case 'auth-setup-password': return { profile: await setupPassword(msg.code, msg.password) };
            case 'auth-logout': return logout().then(() => ({ ok: true }));

            case 'get-settings': return getSettings();
            case 'save-settings':
              studio.settings.set('targetLang', (msg.targetLang || 'en').trim());
              studio.settings.set('readingDirection', msg.readingDirection === 'rtl' ? 'rtl' : 'ltr');
              studio.settings.set('ocrEngine', OCR_ENGINES.includes(msg.ocrEngine) ? msg.ocrEngine : 'auto');
              return { ok: true };

            case 'get-page-state': return loadPageState(msg.pageKey);

            // caminho 1: roteiro já existe - traduz direto, numa chamada só (sem precisar de
            // sessão na nuvem: não tem imagem nem modelo envolvido aqui, só tradução).
            case 'run-detection': {
              const { targetLang } = getSettings();
              const state = await loadPageState(msg.pageKey);
              if (!state.script.length) throw new Error('NO_SCRIPT');
              const { draft, credits } = await draftViaCoopIA(state.script, targetLang);
              await studio.project.writeTranslateDraft(state.pageKey, draft);
              return { pageKey: state.pageKey, draft, credits };
            }

            // caminho 2: sem roteiro ainda - detecção+OCR precisa de sessão na nuvem (create/
            // process/poll, ver sTrawStudio-CoopIA), e o loop de espera roda no PAINEL (ui/app.js,
            // que tem setTimeout de verdade - este arquivo roda num sandbox vm sem ele).
            case 'cloud-create-session': return cloudFetch('/sessions', { method: 'POST' });
            case 'cloud-process-detect':
              return cloudFetch(`/sessions/${msg.sessionId}/process`, {
                method: 'POST',
                body: JSON.stringify({ op: 'detect-text', image: msg.image, readingDirection: msg.readingDirection, ocrEngine: msg.ocrEngine }),
              });
            case 'cloud-poll': return cloudFetch(`/sessions/${msg.sessionId}/result`);

            // depois que o painel já tem as LINHAS lidas (texto original) - traduz e grava o
            // rascunho, igual ao caminho 1.
            case 'translate-lines': {
              const { targetLang } = getSettings();
              const { draft, credits } = await translateLines(msg.lines || [], targetLang);
              await studio.project.writeTranslateDraft(msg.pageKey, draft);
              return { pageKey: msg.pageKey, draft, credits };
            }

            case 'save-draft':
              await studio.project.writeTranslateDraft(msg.pageKey, msg.lines || []);
              return { ok: true };

            case 'confirm': {
              const lines = msg.lines || [];
              await studio.project.writeTranslateDraft(msg.pageKey, lines);
              await studio.project.writeScript(msg.pageKey, lines);
              await studio.editor.refresh();
              return { ok: true };
            }

            default:
              throw new Error(`CoopIA Translator: mensagem desconhecida "${msg.type}"`);
          }
        },
      });
    },
  });
};
