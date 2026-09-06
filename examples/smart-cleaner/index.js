/**
 * Smart Cleaner - limpa páginas de mangá usando inpainting local (LaMa,
 * via studio.image.inpaint). Toda a interação (pintar, desfazer,
 * navegar entre páginas) roda no painel (ui/app.js) - esta função só
 * orquestra o que precisa de acesso ao projeto/modelo: listar páginas
 * editáveis, rodar o inpainting de um traço, e gravar a página
 * confirmada.
 *
 * Uma página é EDITÁVEL aqui se tiver "raw" OU "pages" (ou as duas) -
 * ou seja, tanto páginas ainda não limpas (só "raw") quanto páginas
 * JÁ limpas/geradas (já têm "pages") entram na lista. Isso permite
 * corrigir uma limpeza que ficou faltando algo, ou fazer qualquer
 * ajuste adicional numa página que já tem "pages" pronta - editar
 * SEMPRE grava em "pages" (nunca mexe em "raw", se existir), então dá
 * pra reabrir e ajustar uma página quantas vezes for preciso. Só fica
 * de fora uma página sem NENHUMA imagem ainda (nem raw, nem pages) -
 * não há nada pra carregar/editar nesse caso.
 *
 * Ao abrir o painel, a primeira página ainda SEM "pages" (pendente de
 * verdade) é priorizada; se todas já tiverem "pages", abre na primeira
 * página da lista mesmo assim (ver init() em ui/app.js) - permitindo
 * revisão/ajuste mesmo sem nenhuma pendência "nova".
 *
 * Ao trocar de página no painel (Anterior/Próxima), qualquer limpeza
 * feita na página que está sendo deixada é salva automaticamente antes
 * de navegar (ver goToPage em ui/app.js) - nada é descartado
 * silenciosamente. O histórico de desfazer (Ctrl+Z) é mantido
 * SEPARADO por página, em memória no próprio painel, e nunca é
 * limpo ao navegar nem ao confirmar - continua disponível mesmo depois
 * de ir pra outra página e voltar, durante a mesma sessão em que o
 * painel ficou aberto.
 */
module.exports = function (studio) {
  // dois modelos de reconstrucao disponiveis, escolhidos no proprio
  // painel (settings box) e guardados por projeto/instalacao via
  // studio.settings - "manga" (lama-manga.onnx, mayocream/lama-manga-onnx,
  // Apache-2.0, fine-tuned em ~300 mil imagens de mangá/anime) e o
  // padrao, porque reconstroi screentone/trama muito melhor que o
  // generico (que, treinado majoritariamente em fotos, costumava deixar
  // uma "mancha" mais clara/lisa em vez do pontilhado da trama) - mas
  // o generico continua disponivel pra quem preferir (ex: ilustracao
  // colorida/realista sem trama nenhuma, onde o fine-tuning em mangá
  // pode nao ajudar).
  const MODELS = {
    manga: 'models/lama-manga.onnx',
    generic: 'models/lama_fp32.onnx',
  };
  const DEFAULT_MODEL = 'manga';

  function getSettings() {
    const model = studio.settings.get('model');
    return { model: MODELS[model] ? model : DEFAULT_MODEL };
  }

  async function getCleanablePages() {
    const info = await studio.project.getInfo();
    return info.pages
      .filter((p) => p.hasRaw || p.hasPageImage)
      .map((p) => ({ key: p.key, hasPageImage: !!p.hasPageImage }));
  }

  async function handlePanelMessage(msg) {
    switch (msg && msg.type) {
      case 'get-settings':
        return getSettings();

      case 'save-settings': {
        studio.settings.set('model', MODELS[msg.model] ? msg.model : DEFAULT_MODEL);
        return { ok: true };
      }

      // lista TODAS as paginas editaveis (com raw e/ou pages, ver
      // getCleanablePages) - o painel usa isso pra permitir navegar
      // livremente entre elas (Anterior/Proxima), nao so avancar pra
      // frente conforme confirma. Uma pagina que ja tem "pages" e
      // mostrada a partir dela mesma (o resultado ja limpo/existente),
      // nao da "raw" de novo - ver 'get-page'.
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

      case 'clean-stroke': {
        const modelPath = MODELS[getSettings().model];
        const resultBase64 = await studio.image.inpaint(msg.imageBase64, msg.maskBase64, modelPath);
        return { imageBase64: resultBase64 };
      }

      case 'confirm-page': {
        await studio.project.writePageImage(msg.pageKey, msg.imageBase64, '.png');
        // recarrega a pagina no editor (por tras do painel) - se for a
        // pagina atualmente aberta la, o resultado aparece na hora, sem
        // precisar fechar o painel nem trocar de pagina e voltar
        await studio.editor.refresh();
        return { ok: true };
      }

      default:
        throw new Error(`Smart Cleaner: mensagem desconhecida "${msg && msg.type}"`);
    }
  }

  function openCleanerPanel() {
    studio.ui.openPanel({
      title: 'Smart Cleaner - limpeza de páginas',
      htmlFile: 'ui/index.html',
      onMessage: handlePanelMessage,
    });
  }

  studio.menu.register({
    id: 'smart-cleaner.open',
    name: 'Limpar páginas',
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
