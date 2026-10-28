/**
 * CoopIA - Traduzir página. Fork do Page Translator que remove o Gemini (e portanto a leitura de
 * texto direto da imagem - sem um modelo de visão/OCR verificado pra rodar no servidor, não dá pra
 * "ler" balão sem texto já digitado) e usa SEMPRE o tradutor do CoopIA (LibreTranslate self-hosted,
 * sem API externa) pro roteiro OFICIAL que a página já tiver - igual ao caminho "sem chave Gemini"
 * do extension original, só que agora é o ÚNICO caminho, autenticado, e cobrando 1 crédito por fala.
 *
 * Mantém: rascunho (translate.traw) revisável antes de virar roteiro oficial, navegação entre
 * páginas sem fechar o painel, "Salvar roteiro"/studio.editor.refresh() - só a origem da tradução
 * (studio.translate.free -> CoopIA) e a exigência de login mudam.
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

  function getSettings() {
    return { targetLang: studio.settings.get('targetLang') || 'en' };
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
              return { ok: true };

            case 'get-page-state': return loadPageState(msg.pageKey);

            case 'run-detection': {
              const { targetLang } = getSettings();
              const state = await loadPageState(msg.pageKey);
              if (!state.script.length) {
                throw new Error('Esta página ainda não tem roteiro nenhum - digite/importe o roteiro original primeiro (sem roteiro, não há texto pra traduzir).');
              }
              const { draft, credits } = await draftViaCoopIA(state.script, targetLang);
              await studio.project.writeTranslateDraft(state.pageKey, draft);
              return { pageKey: state.pageKey, draft, credits };
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
