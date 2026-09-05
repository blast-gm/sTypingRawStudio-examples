/**
 * Smart Cleaner - limpa páginas de mangá usando inpainting local (LaMa,
 * via studio.image.inpaint). Toda a interação (pintar, desfazer,
 * navegar entre páginas) roda no painel (ui/app.js) - esta função só
 * orquestra o que precisa de acesso ao projeto/modelo: encontrar a
 * próxima página pendente, rodar o inpainting de um traço, e gravar a
 * página confirmada.
 *
 * "Página pendente" = tem imagem "raw" mas ainda não tem "pages" (ou
 * seja, ainda não foi limpa/gerada) - exatamente os projetos que só
 * trazem a pasta raw/ dentro do .ztraw.
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
  const MODEL_PATH = 'models/lama_fp32.onnx';

  async function getCleanablePages() {
    const info = await studio.project.getInfo();
    return info.pages.filter((p) => p.hasRaw).map((p) => ({ key: p.key, hasPageImage: !!p.hasPageImage }));
  }

  async function findNextPendingPage() {
    const pages = await getCleanablePages();
    return pages.find((p) => !p.hasPageImage) || null;
  }

  async function handlePanelMessage(msg) {
    switch (msg && msg.type) {
      // lista TODAS as paginas com raw (nao so as pendentes) - o painel
      // usa isso pra permitir navegar livremente entre elas (Anterior/
      // Proxima), nao so avancar pra frente conforme confirma. Uma
      // pagina ja confirmada e mostrada a partir da propria "pages/"
      // (o resultado ja limpo), nao da "raw" de novo - ver 'get-page'.
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
        const resultBase64 = await studio.image.inpaint(msg.imageBase64, msg.maskBase64, MODEL_PATH);
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
      const page = await findNextPendingPage();
      if (!page) {
        studio.dialog.show('Nenhuma página pendente de limpeza - todas já têm imagem gerada, ou não há projeto aberto com páginas "raw".');
        return;
      }
      openCleanerPanel();
    },
  });
};
