/**
 * Painter - exemplo de referência pra `studio.draw` (traço de pincel
 * com pressão, balde de tinta, formas básicas, tela em branco) e as
 * transformações novas de `studio.image` (resize/rotate/flip/blur).
 * Ao contrário do `smart-cleaner` (que resolve um problema específico -
 * limpeza de página via inpainting de IA), esta extensão é
 * deliberadamente simples: uma ferramenta de pintura livre genérica,
 * só pra mostrar cada função da API em uso de um jeito direto.
 *
 * Toda a interação em tempo real (arrastar o pincel, prévia de uma
 * forma sendo desenhada) roda no painel (ui/app.js), em Canvas 2D
 * comum do navegador - isso NÃO precisa de nenhuma função de `studio`.
 * Só no FIM de cada gesto (solta o mouse/caneta) o painel manda os
 * dados brutos (pontos com pressão, ou os dois cantos de uma forma)
 * pra cá, que aplica de verdade via `studio.draw`/`studio.image` e
 * devolve o resultado - ver docs/extensions/draw.md ("O que fica no
 * painel vs no Core").
 */
module.exports = function (studio) {
  async function loadCurrentPage() {
    const current = await studio.project.getCurrentPage();
    if (!current.pageKey) throw new Error('Nenhuma página aberta no editor no momento.');

    const info = await studio.project.getInfo();
    const page = info.pages.find((p) => p.key === current.pageKey);
    if (!page || (!page.hasRaw && !page.hasPageImage)) {
      throw new Error(`A página "${current.pageKey}" ainda não tem nenhuma imagem (nem raw, nem pages).`);
    }

    const variant = page.hasPageImage ? 'pages' : 'raw';
    const imageBase64 = await studio.project.readPageImage(current.pageKey, variant);
    return { pageKey: current.pageKey, imageBase64 };
  }

  async function handlePanelMessage(msg) {
    switch (msg && msg.type) {
      case 'load-current-page':
        return loadCurrentPage();

      case 'new-blank-canvas': {
        const imageBase64 = await studio.draw.blank(msg.width, msg.height, msg.backgroundColor);
        return { imageBase64 };
      }

      case 'stroke': {
        const imageBase64 = await studio.draw.stroke(msg.imageBase64, msg.points, msg.opts || {});
        return { imageBase64 };
      }

      case 'flood-fill': {
        const imageBase64 = await studio.draw.floodFill(msg.imageBase64, msg.point, msg.color, msg.opts || {});
        return { imageBase64 };
      }

      case 'shape': {
        const imageBase64 = await studio.draw.shape(msg.imageBase64, msg.shape);
        return { imageBase64 };
      }

      case 'rotate': {
        const imageBase64 = await studio.image.rotate(msg.imageBase64, msg.degrees);
        return { imageBase64 };
      }

      case 'flip': {
        const imageBase64 = await studio.image.flip(msg.imageBase64, msg.axis);
        return { imageBase64 };
      }

      case 'blur': {
        const imageBase64 = await studio.image.blur(msg.imageBase64, msg.radius);
        return { imageBase64 };
      }

      case 'resize': {
        const imageBase64 = await studio.image.resize(msg.imageBase64, msg.opts || {});
        return { imageBase64 };
      }

      case 'save-to-page': {
        await studio.project.writePageImage(msg.pageKey, msg.imageBase64, '.png');
        // recarrega a pagina no editor (por tras do painel) - o
        // resultado aparece na hora, sem precisar fechar o painel
        await studio.editor.refresh();
        return { ok: true };
      }

      default:
        throw new Error(`Painter: mensagem desconhecida "${msg && msg.type}"`);
    }
  }

  studio.menu.register({
    id: 'painter.open',
    name: 'Painter (pintura livre)',
    icon: 'palette',
    action() {
      studio.ui.openPanel({
        title: 'Painter',
        htmlFile: 'ui/index.html',
        onMessage: handlePanelMessage,
      });
    },
  });
};
