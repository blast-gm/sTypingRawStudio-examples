/**
 * CoopIA - Limpar páginas. Fork do Smart Cleaner Mobile que troca o processamento local (MI-GAN
 * via studio.image.runOnnxModel) por SEMPRE usar a nuvem do CoopIA - sem Gemini, sem IA local no
 * app. Precisa de login (mesmo ID/senha do TeamDrive, repassado pelo próprio CoopIA) e cada página
 * confirmada consome 1 crédito. O resto (listar/navegar páginas, desfazer) é idêntico ao original -
 * só a parte de "pra onde manda o traço" e "como confirma a página" muda.
 */
module.exports = function (studio) {
  // servidor do CoopIA (ex-ai.blast.net.br/TesteAICloud, renomeado) - mesmo domínio/SSL de sempre.
  const CLOUD_URL = 'https://ai.blast.net.br';
  const CLOUD_MODEL_NAME = 'migan_pipeline_v2';

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
      if (res.status === 401) setToken(''); // sessão caiu: força login de novo na próxima
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

  // Os 3 passos da sessão na nuvem ficam SEPARADOS de propósito (ver smart-cleaner-mobile original):
  // este arquivo roda num sandbox vm sem setTimeout, então o loop de espera entre tentativas de
  // poll roda no PAINEL (ui/app.js), que tem um browser de verdade.
  const cloudCreateSession = () => cloudFetch('/sessions', { method: 'POST' });
  const cloudProcess = (sessionId, imageTensor, maskTensor) => cloudFetch(`/sessions/${sessionId}/process`, {
    method: 'POST', body: JSON.stringify({ model: CLOUD_MODEL_NAME, feeds: { image: imageTensor, mask: maskTensor }, outputNames: ['result'] }),
  });
  const cloudPoll = (sessionId) => cloudFetch(`/sessions/${sessionId}/result`);

  async function getCleanablePages() {
    const info = await studio.project.getInfo();
    return info.pages.filter((p) => p.hasRaw || p.hasPageImage).map((p) => ({ key: p.key, hasPageImage: !!p.hasPageImage }));
  }

  async function handlePanelMessage(msg) {
    switch (msg && msg.type) {
      case 'auth-status': return authStatus();
      case 'auth-login': return { profile: await login(msg.code, msg.password) };
      case 'auth-setup-password': return { profile: await setupPassword(msg.code, msg.password) };
      case 'auth-logout': return logout().then(() => ({ ok: true }));

      case 'get-page-list': return { pages: await getCleanablePages() };

      case 'get-page': {
        const pages = await getCleanablePages();
        const page = pages.find((p) => p.key === msg.pageKey);
        if (!page) throw new Error(`Página "${msg.pageKey}" não encontrada.`);
        const variant = page.hasPageImage ? 'pages' : 'raw';
        const imageBase64 = await studio.project.readPageImage(page.key, variant);
        return { imageBase64, hasPageImage: page.hasPageImage };
      }

      case 'cloud-create-session': return cloudCreateSession();
      case 'cloud-process': return cloudProcess(msg.sessionId, msg.imageTensor, msg.maskTensor);
      case 'cloud-poll': return cloudPoll(msg.sessionId);

      // confirma a página SÓ depois de cobrar o crédito - se não tiver saldo, nada é gravado.
      case 'confirm-page': {
        const charge = await cloudFetch('/api/credits/charge', { method: 'POST', body: JSON.stringify({ reason: 'clean-page', amount: 1 }) });
        await studio.project.writePageImage(msg.pageKey, msg.imageBase64, '.png');
        await studio.editor.refresh();
        return { ok: true, credits: charge.credits };
      }

      default:
        throw new Error(`CoopIA Cleaner: mensagem desconhecida "${msg && msg.type}"`);
    }
  }

  function openCleanerPanel() {
    studio.ui.openPanel({ title: 'CoopIA - Limpeza de páginas (MI-GAN)', htmlFile: 'ui/index.html', onMessage: handlePanelMessage });
  }

  studio.menu.register({
    id: 'coopia-cleaner.open',
    name: 'Limpar páginas (CoopIA)',
    icon: 'eraser',
    async action() {
      const pages = await getCleanablePages();
      if (!pages.length) {
        studio.dialog.show('Nenhuma página com imagem (raw ou já limpa) neste projeto - ou não há projeto aberto.');
        return;
      }
      openCleanerPanel();
    },
  });
};
