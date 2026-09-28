/**
 * Smart Cleaner Mobile - limpa páginas de mangá usando inpainting local
 * com MI-GAN (via studio.image.runOnnxModel), em vez do LaMa usado pelo
 * Smart Cleaner "normal" (studio.image.inpaint). MI-GAN é uma arquitetura
 * feita sob medida pra rodar em CPU de celular - ~28MB (contra ~200MB+
 * do LaMa) e cerca de uma ordem de magnitude mais rápido, o suficiente
 * pra funcionar bem SEM GPU (Android não tem DirectML/WebGPU de
 * qualquer forma - ver docs/mobile/ARCHITECTURE.md no repo principal).
 *
 * Diferente do studio.image.inpaint() (que já sabe o formato exato de
 * tensor do LaMa e faz TODO o pré/pós-processamento no lado do app),
 * studio.image.runOnnxModel() é genérico - esta extensão é responsável
 * por montar os tensores certos (crop em torno da área pintada + layout
 * NCHW uint8) e recompor o resultado. Esse trabalho pesado de pixels
 * roda no PAINEL (ui/app.js, com <canvas> de verdade disponível), não
 * aqui - esta função só orquestra o que precisa de acesso ao
 * projeto/modelo: listar páginas editáveis, rodar a inferência de um
 * traço, e gravar a página confirmada.
 *
 * Todo o resto (listar/navegar páginas, desfazer, confirmar) é
 * idêntico ao Smart Cleaner original - só a parte de "como pedir a
 * reconstrução de um traço" muda.
 */
module.exports = function (studio) {
  const MODEL_PATH = 'models/migan_pipeline_v2.onnx';

  // servidor de inferencia na nuvem (ver straw-studio-ai-cloud no repo
  // principal) - sem chave de API de proposito, a ferramenta precisa
  // funcionar sem NENHUMA configuracao de quem instala a extensao
  // pelo Hub. O freio contra abuso e limite de requisicoes por IP do
  // lado do servidor (ver src/rateLimit.js la), nao uma credencial
  // aqui.
  const CLOUD_URL = 'https://ai.blast.net.br';
  const CLOUD_MODEL_NAME = 'migan_pipeline_v2';

  function getSettings() {
    const mode = studio.settings.get('mode');
    return { mode: mode === 'cloud' ? 'cloud' : 'local' };
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
      throw new Error(`Resposta invalida da nuvem (HTTP ${res.status}).`);
    }
    if (!res.ok) throw new Error(body.error || `A nuvem respondeu ${res.status}.`);
    return body;
  }

  // Os 3 passos da sessao na nuvem (criar/disparar/poll) ficam
  // SEPARADOS de proposito, cada um sua propria mensagem - o LOOP de
  // poll-com-espera roda no PAINEL (ui/app.js), nao aqui: este arquivo
  // executa dentro de um sandbox vm isolado que NAO tem setTimeout
  // (so os globals padrao de JS + o que o sandbox.js expoe
  // explicitamente), entao esperar entre tentativas de poll precisa
  // acontecer num contexto de browser de verdade.
  async function cloudCreateSession() {
    return cloudFetch('/sessions', { method: 'POST' });
  }

  async function cloudProcess(sessionId, imageTensor, maskTensor) {
    return cloudFetch(`/sessions/${sessionId}/process`, {
      method: 'POST',
      body: JSON.stringify({
        model: CLOUD_MODEL_NAME,
        feeds: { image: imageTensor, mask: maskTensor },
        outputNames: ['result'],
      }),
    });
  }

  async function cloudPoll(sessionId) {
    return cloudFetch(`/sessions/${sessionId}/result`);
  }

  async function getCleanablePages() {
    const info = await studio.project.getInfo();
    return info.pages
      .filter((p) => p.hasRaw || p.hasPageImage)
      .map((p) => ({ key: p.key, hasPageImage: !!p.hasPageImage }));
  }

  async function handlePanelMessage(msg) {
    switch (msg && msg.type) {
      // lista TODAS as paginas editaveis (com raw e/ou pages) - o painel
      // usa isso pra permitir navegar livremente entre elas.
      case 'get-page-list': {
        const pages = await getCleanablePages();
        return { pages };
      }

      case 'get-page': {
        const pages = await getCleanablePages();
        const page = pages.find((p) => p.key === msg.pageKey);
        if (!page) throw new Error(`Pagina "${msg.pageKey}" nao encontrada.`);
        const variant = page.hasPageImage ? 'pages' : 'raw';
        const imageBase64 = await studio.project.readPageImage(page.key, variant);
        return { imageBase64, hasPageImage: page.hasPageImage };
      }

      // o painel ja montou os tensores certos (crop + layout NCHW uint8,
      // ver buildMiganFeeds() em ui/app.js) - aqui so repassa pro motor
      // ONNX generico e devolve o tensor de saida como veio, pro painel
      // recompor os pixels sozinho.
      case 'clean-stroke': {
        const outputs = await studio.image.runOnnxModel(
          MODEL_PATH,
          { image: msg.imageTensor, mask: msg.maskTensor },
          { outputNames: ['result'] }
        );
        return { result: outputs.result };
      }

      case 'get-settings':
        return getSettings();

      case 'save-settings':
        studio.settings.set('mode', msg.mode === 'cloud' ? 'cloud' : 'local');
        return { ok: true };

      // 3 passos da limpeza NA NUVEM (ver cloudCreateSession/cloudProcess/
      // cloudPoll acima) - o painel encadeia essas 3 mensagens com o
      // loop de espera dele mesmo (setTimeout so existe la).
      case 'cloud-create-session':
        return cloudCreateSession();

      case 'cloud-process':
        return cloudProcess(msg.sessionId, msg.imageTensor, msg.maskTensor);

      case 'cloud-poll':
        return cloudPoll(msg.sessionId);

      case 'confirm-page': {
        await studio.project.writePageImage(msg.pageKey, msg.imageBase64, '.png');
        // recarrega a pagina no editor (por tras do painel) - se for a
        // pagina atualmente aberta la, o resultado aparece na hora, sem
        // precisar fechar o painel nem trocar de pagina e voltar
        await studio.editor.refresh();
        return { ok: true };
      }

      default:
        throw new Error(`Smart Cleaner Mobile: mensagem desconhecida "${msg && msg.type}"`);
    }
  }

  function openCleanerPanel() {
    studio.ui.openPanel({
      title: 'Smart Cleaner Mobile - limpeza de páginas (MI-GAN)',
      htmlFile: 'ui/index.html',
      onMessage: handlePanelMessage,
    });
  }

  studio.menu.register({
    id: 'smart-cleaner-mobile.open',
    name: 'Limpar páginas (Mobile)',
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
