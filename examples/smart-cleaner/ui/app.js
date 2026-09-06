/**
 * Smart Cleaner - UI do painel. Roda isolado (iframe sandboxed, sem
 * allow-same-origin) - a UNICA forma de conversar com o resto do app e
 * `callStudio(payload)`, que manda um postMessage pro parent (o
 * renderer do sTraw Studio) e recebe de volta o retorno de
 * `onMessage` registrado no index.js desta extensao (que roda no
 * processo principal, com acesso a `studio`). Nunca ha acesso direto a
 * Node/Electron/`window.parent` aqui - so essa ponte de mensagens.
 */
(function () {
  let requestSeq = 0;
  const pending = new Map();

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    const resolver = pending.get(data.requestId);
    if (!resolver) return;
    pending.delete(data.requestId);
    if (data.error) resolver.reject(new Error(data.error));
    else resolver.resolve(data.result);
  });

  function callStudio(payload) {
    return new Promise((resolve, reject) => {
      const requestId = 'r' + (++requestSeq);
      pending.set(requestId, { resolve, reject });
      window.parent.postMessage({ requestId, payload }, '*');
    });
  }

  // ------------------------------------------------------------
  // elementos / estado
  // ------------------------------------------------------------
  const el = (id) => document.getElementById(id);

  const dom = {
    toolbar: el('toolbar'),
    brushSize: el('brushSize'),
    brushSizeLabel: el('brushSizeLabel'),
    pageLabel: el('pageLabel'),
    prevPageBtn: el('prevPageBtn'),
    nextPageBtn: el('nextPageBtn'),
    undoBtn: el('undoBtn'),
    confirmBtn: el('confirmBtn'),
    canvasWrap: el('canvasWrap'),
    emptyState: el('emptyState'),
    imageCanvas: el('imageCanvas'),
    maskCanvas: el('maskCanvas'),
    statusOverlay: el('statusOverlay'),
    statusText: el('statusText'),
  };

  const imageCtx = dom.imageCanvas.getContext('2d');
  const maskCtx = dom.maskCanvas.getContext('2d');

  // dom.maskCanvas (visivel, sobre a imagem) so mostra o TINTE
  // semi-transparente do traco - quem guarda o traco de verdade
  // (OPACO, sem acumulo nenhum de alfa) e este canvas offscreen. Ver
  // strokeTo() pra explicacao de por que a separacao existe.
  const maskDataCanvas = document.createElement('canvas');
  const maskDataCtx = maskDataCanvas.getContext('2d');

  // "fonte da verdade": canvas OFFSCREEN na resolucao ORIGINAL da
  // pagina - o canvas visivel (dom.imageCanvas) e so uma versao
  // reduzida pra caber na tela. Tudo que e enviado pro backend
  // (studio.image.inpaint / confirm-page) usa ESTE canvas, nunca o
  // reduzido - senao a pagina final perderia resolucao.
  const fullCanvas = document.createElement('canvas');
  const fullCtx = fullCanvas.getContext('2d');

  // margem pra imagem nunca encostar exatamente na borda do wrap
  const DISPLAY_PADDING = 24;

  // lista de TODAS as paginas editaveis (com raw e/ou pages, nao so as
  // pendentes) + o indice da que esta aberta agora - permite ir e
  // voltar livremente (ver goToPage/prevPage/nextPage), nao so avancar
  // conforme confirma. Cada item: { key, hasPageImage }.
  let pageList = [];
  let pageIndex = -1;
  let displayScale = 1;
  let isProcessing = false;
  let isDrawing = false;
  let lastPoint = null;
  let hasStroke = false;

  // ------------------------------------------------------------
  // zoom (Ctrl +/- ou Ctrl+scroll) e navegacao (segurar espaco e
  // arrastar) - zoomLevel multiplica a escala "caber na tela" (1 =
  // comportamento padrao de sempre); panX/panY sao um deslocamento em
  // PIXELS DE TELA aplicado via CSS var, sem depender de rolagem
  // nativa (ver nota equivalente no style.css do Painter - mesmo
  // motivo aqui: overflow:auto + centralizar via flex deixaria parte
  // do conteudo que estoura inacessivel pela rolagem).
  // ------------------------------------------------------------
  const ZOOM_MIN = 0.15;
  const ZOOM_MAX = 8;
  const ZOOM_KEY_STEP = 1.2;
  const ZOOM_WHEEL_STEP = 1.06;
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;
  let spaceDown = false;
  let isPanning = false;
  let panPointerStart = null;
  let panOffsetStart = null;

  function isTypingTarget(elm) {
    return Boolean(elm) && (elm.tagName === 'INPUT' || elm.tagName === 'TEXTAREA' || elm.tagName === 'SELECT' || elm.isContentEditable);
  }

  function applyPanTransform() {
    dom.canvasWrap.style.setProperty('--pan-x', `${panX}px`);
    dom.canvasWrap.style.setProperty('--pan-y', `${panY}px`);
  }

  function setZoom(next) {
    zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    redrawDisplayFromFull();
  }

  function resetView() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyPanTransform();
  }

  // O painel roda dentro de um IFRAME - "segurar espaco" so e capturado
  // pelo keydown abaixo se ESTE frame (nao a janela principal do app)
  // tiver o foco do teclado. Sem clicar em nada primeiro, o foco pode
  // estar em qualquer outro lugar do app, entao pressionar espaco nao
  // fazia NADA (nem sequer preventDefault) e o mousedown seguinte caia
  // direto no fluxo normal de desenho/limpeza - exatamente o bug
  // reportado. Ganhar o foco assim que o mouse ENTRA na area do canvas
  // (sem exigir um clique antes) resolve isso.
  dom.canvasWrap.addEventListener('mouseenter', () => window.focus());

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(document.activeElement)) return;
    if (e.code === 'Space' && !spaceDown) {
      spaceDown = true;
      dom.canvasWrap.classList.add('panning-ready');
      e.preventDefault();
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoom(zoomLevel * ZOOM_KEY_STEP);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      setZoom(zoomLevel / ZOOM_KEY_STEP);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      dom.canvasWrap.classList.remove('panning-ready', 'panning-active');
    }
  });

  function startPan(evt) {
    if (!spaceDown) return false;
    isPanning = true;
    panPointerStart = { x: evt.clientX, y: evt.clientY };
    panOffsetStart = { x: panX, y: panY };
    dom.canvasWrap.classList.add('panning-active');
    return true;
  }

  // ouvidas na JANELA (nao so no maskCanvas) - um arraste de pan pode
  // sair da area do canvas quando a imagem esta com zoom alto, e
  // precisa continuar respondendo mesmo assim
  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = panOffsetStart.x + (e.clientX - panPointerStart.x);
    panY = panOffsetStart.y + (e.clientY - panPointerStart.y);
    applyPanTransform();
  });
  window.addEventListener('mouseup', () => {
    if (!isPanning) return;
    isPanning = false;
    dom.canvasWrap.classList.remove('panning-active');
  });

  // pilha de desfazer POR PAGINA (pageKey -> array de dataURLs "antes de
  // cada traco") - antes era uma unica pilha global, que ia pro lixo
  // toda vez que a pessoa trocava de pagina (mesmo so pra dar uma
  // olhada e voltar). Guardando uma pilha separada por pagina aqui no
  // painel, Ctrl+Z continua funcionando certinho mesmo depois de ir pra
  // outra pagina e voltar - "esvazia" so quando o PAINEL inteiro fecha
  // (memoria, nao arquivo - nao precisa sobreviver a fechar o app).
  const undoStacksByKey = new Map();

  function getUndoStack(key) {
    if (!key) return [];
    if (!undoStacksByKey.has(key)) undoStacksByKey.set(key, []);
    return undoStacksByKey.get(key);
  }

  function currentPageKey() {
    return pageIndex >= 0 && pageIndex < pageList.length ? pageList[pageIndex].key : null;
  }

  dom.brushSizeLabel.textContent = `${dom.brushSize.value}px`;
  dom.brushSize.addEventListener('input', () => {
    dom.brushSizeLabel.textContent = `${dom.brushSize.value}px`;
  });

  function setStatus(text) {
    dom.statusText.textContent = text;
  }

  function setProcessing(value) {
    isProcessing = value;
    dom.statusOverlay.hidden = !value;
    dom.maskCanvas.style.pointerEvents = value ? 'none' : 'auto';
    dom.undoBtn.disabled = value || !getUndoStack(currentPageKey()).length;
    dom.confirmBtn.disabled = value || !currentPageKey();
    dom.prevPageBtn.disabled = value || pageIndex <= 0;
    dom.nextPageBtn.disabled = value || pageIndex < 0 || pageIndex >= pageList.length - 1;
  }

  // ------------------------------------------------------------
  // carregar imagem (base64 PNG sem prefixo "data:") no fullCanvas +
  // redesenhar o canvas visivel na resolucao reduzida
  // ------------------------------------------------------------
  function loadImageIntoCanvases(imageBase64) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        fullCanvas.width = img.naturalWidth;
        fullCanvas.height = img.naturalHeight;
        fullCtx.drawImage(img, 0, 0);
        resetView(); // pagina nova - comeca sempre do zero, centralizada
        redrawDisplayFromFull();
        resolve();
      };
      img.src = `data:image/png;base64,${imageBase64}`;
    });
  }

  function redrawDisplayFromFull() {
    // encaixa no espaco REAL disponivel no momento (nao um tamanho
    // fixo "chutado") - o painel pode abrir em janelas de tamanhos
    // bem diferentes, e um valor fixo grande demais deixava a imagem
    // maior que a area visivel, exigindo rolagem em vez de "caber".
    // zoomLevel multiplica essa escala "caber" (1 = padrao de sempre).
    const availableW = Math.max(100, dom.canvasWrap.clientWidth - DISPLAY_PADDING * 2);
    const availableH = Math.max(100, dom.canvasWrap.clientHeight - DISPLAY_PADDING * 2);
    const fitScale = Math.min(availableW / fullCanvas.width, availableH / fullCanvas.height, 1);
    const scale = fitScale * zoomLevel;
    displayScale = scale;
    const w = Math.max(1, Math.round(fullCanvas.width * scale));
    const h = Math.max(1, Math.round(fullCanvas.height * scale));

    [dom.imageCanvas, dom.maskCanvas, maskDataCanvas].forEach((c) => {
      c.width = w;
      c.height = h;
    });
    imageCtx.clearRect(0, 0, w, h);
    imageCtx.drawImage(fullCanvas, 0, 0, fullCanvas.width, fullCanvas.height, 0, 0, w, h);
    maskCtx.clearRect(0, 0, w, h);
    maskDataCtx.clearRect(0, 0, w, h);
  }

  // apaga o traco (dado opaco E o tinte visivel) - usado ao cancelar um
  // traco sem movimento, e apos cada limpeza confirmada/desfeita
  function clearStroke() {
    maskCtx.clearRect(0, 0, dom.maskCanvas.width, dom.maskCanvas.height);
    maskDataCtx.clearRect(0, 0, maskDataCanvas.width, maskDataCanvas.height);
  }

  // ------------------------------------------------------------
  // desenho do traco (no canvas de exibicao, resolucao reduzida)
  // ------------------------------------------------------------
  function getPos(evt) {
    const rect = dom.maskCanvas.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * dom.maskCanvas.width,
      y: ((evt.clientY - rect.top) / rect.height) * dom.maskCanvas.height,
    };
  }

  function strokeTo(point) {
    // pinta o segmento OPACO na camada de dados - cada chamada de
    // stroke() e um desenho "source-over" independente, entao se a
    // tinta em si ja fosse semi-transparente, mouse lento (varios
    // segmentos curtos sobrepostos) ou uma curva fechada acumulariam
    // alfa a cada sobreposicao ate virar solido (era exatamente o bug
    // reportado: "o vermelho fica sobrepondo... o transparente fica
    // solido"). Pintando SEMPRE opaco aqui, sobrepor o mesmo pixel de
    // novo nao muda nada (opaco em cima de opaco continua opaco).
    maskDataCtx.lineCap = 'round';
    maskDataCtx.lineJoin = 'round';
    maskDataCtx.lineWidth = Number(dom.brushSize.value);
    maskDataCtx.strokeStyle = 'rgba(255, 60, 60, 1)';
    maskDataCtx.beginPath();
    maskDataCtx.moveTo(lastPoint ? lastPoint.x : point.x, lastPoint ? lastPoint.y : point.y);
    maskDataCtx.lineTo(point.x, point.y);
    maskDataCtx.stroke();
    lastPoint = point;

    // redesenha o TINTE visivel do zero a partir da camada opaca, com
    // alfa fixo - como isso e um clear + UMA composicao por vez (nunca
    // desenho incremental em cima do que ja estava tintado), a
    // transparencia do traco fica constante em 0.22 em qualquer area
    // pintada, nao importa quantas vezes o mouse passou por cima
    maskCtx.clearRect(0, 0, dom.maskCanvas.width, dom.maskCanvas.height);
    maskCtx.globalAlpha = 0.22;
    maskCtx.drawImage(maskDataCanvas, 0, 0);
    maskCtx.globalAlpha = 1;
  }

  dom.canvasWrap.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_WHEEL_STEP : 1 / ZOOM_WHEEL_STEP;
      setZoom(zoomLevel * factor);
    },
    { passive: false }
  );

  function startDrawing(evt) {
    if (startPan(evt)) return;
    if (isProcessing || !currentPageKey()) return;
    evt.preventDefault();
    isDrawing = true;
    hasStroke = false;
    lastPoint = null;
    strokeTo(getPos(evt));
  }

  function moveDrawing(evt) {
    if (!isDrawing) return;
    evt.preventDefault();
    hasStroke = true;
    strokeTo(getPos(evt));
  }

  async function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    lastPoint = null;
    if (hasStroke) await processStroke();
    else clearStroke();
    hasStroke = false;
  }

  dom.maskCanvas.addEventListener('mousedown', startDrawing);
  dom.maskCanvas.addEventListener('mousemove', moveDrawing);
  window.addEventListener('mouseup', stopDrawing);

  // reajusta o fit se a janela do app (e portanto o painel) mudar de
  // tamanho enquanto uma pagina ja esta carregada - nao decide o
  // traco atual, so o quanto a pagina aparece reduzida na tela
  window.addEventListener('resize', () => {
    if (fullCanvas.width && !isDrawing) redrawDisplayFromFull();
  });

  // ------------------------------------------------------------
  // constroi a mascara binaria (preto/branco) na resolucao ORIGINAL a
  // partir do traco desenhado no canvas reduzido.
  //
  // IMPORTANTE: binariza pelo alfa ANTES de qualquer upscale/composicao
  // - ler o alfa da mascara so DEPOIS de desenha-la sobre um fundo
  // preto OPACO (como uma versao anterior deste arquivo fazia) da
  // errado: compor uma cor semi-transparente sobre um fundo opaco
  // produz um resultado TOTALMENTE opaco (alfa 255) em toda a
  // imagem, nao so onde o traco foi desenhado - isso fazia a mascara
  // final marcar a PAGINA INTEIRA como "remover", e o inpainting
  // devolvia a pagina toda preta/em branco (sem nenhum contexto no
  // entorno pro modelo reconstruir a partir de nada). A ordem certa e
  // ler o alfa direto do canvas ORIGINAL do traco (onde "nada
  // desenhado" = alfa 0 de verdade), binarizar AINDA NA RESOLUCAO
  // REDUZIDA, e so DEPOIS aumentar a imagem (ja preto/branco solida,
  // sem transparencia) pra resolucao original - nesse ponto um
  // upscale simples e seguro, porque nao ha mais informacao de alfa
  // nenhuma sendo perdida.
  // ------------------------------------------------------------
  function buildFullResMaskDataUrl() {
    const small = document.createElement('canvas');
    small.width = dom.maskCanvas.width;
    small.height = dom.maskCanvas.height;
    const smallCtx = small.getContext('2d');

    const src = maskDataCtx.getImageData(0, 0, maskDataCanvas.width, maskDataCanvas.height);
    const out = smallCtx.createImageData(small.width, small.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const v = src.data[i + 3] > 10 ? 255 : 0;
      out.data[i] = v;
      out.data[i + 1] = v;
      out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
    smallCtx.putImageData(out, 0, 0);

    const full = document.createElement('canvas');
    full.width = fullCanvas.width;
    full.height = fullCanvas.height;
    const fullCtx2 = full.getContext('2d');
    fullCtx2.imageSmoothingEnabled = false; // mantem preto/branco solido no upscale (sem cinza de interpolacao)
    fullCtx2.drawImage(small, 0, 0, small.width, small.height, 0, 0, full.width, full.height);

    return full.toDataURL('image/png');
  }

  function dataUrlToBase64(dataUrl) {
    return dataUrl.split(',')[1];
  }

  // ------------------------------------------------------------
  // processa UM traco assim que o mouse e solto - sem passo manual de
  // "aplicar", exatamente como pedido
  // ------------------------------------------------------------
  async function processStroke() {
    const beforeDataUrl = fullCanvas.toDataURL('image/png');
    const maskDataUrl = buildFullResMaskDataUrl();

    setProcessing(true);
    setStatus('Limpando (pode levar alguns segundos)...');

    try {
      const result = await callStudio({
        type: 'clean-stroke',
        imageBase64: dataUrlToBase64(beforeDataUrl),
        maskBase64: dataUrlToBase64(maskDataUrl),
      });

      getUndoStack(currentPageKey()).push(beforeDataUrl);
      await loadFullResultDataUrl(`data:image/png;base64,${result.imageBase64}`);
      clearStroke();
    } catch (err) {
      setStatus(`Erro: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2500));
      clearStroke();
    } finally {
      setProcessing(false);
    }
  }

  function loadFullResultDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        fullCtx.clearRect(0, 0, fullCanvas.width, fullCanvas.height);
        fullCtx.drawImage(img, 0, 0);
        redrawDisplayFromFull();
        resolve();
      };
      img.src = dataUrl;
    });
  }

  // ------------------------------------------------------------
  // desfazer (Ctrl+Z)
  // ------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });

  dom.undoBtn.addEventListener('click', undo);

  async function undo() {
    const stack = getUndoStack(currentPageKey());
    if (isProcessing || !stack.length) return;
    const previous = stack.pop();
    await loadFullResultDataUrl(previous);
    dom.undoBtn.disabled = !stack.length;
  }

  // ------------------------------------------------------------
  // confirmar pagina -> grava em pages/ e avanca pra proxima pendente
  // (se houver) - sem fechar a navegacao: mesmo depois de tudo
  // confirmado, Anterior/Proxima continuam livres pra revisar qualquer
  // pagina ja limpa (ver goToPage)
  // ------------------------------------------------------------
  dom.confirmBtn.addEventListener('click', async () => {
    if (isProcessing || !currentPageKey()) return;
    setProcessing(true);
    setStatus('Salvando página...');
    try {
      await callStudio({
        type: 'confirm-page',
        pageKey: currentPageKey(),
        imageBase64: dataUrlToBase64(fullCanvas.toDataURL('image/png')),
      });
      pageList[pageIndex] = { ...pageList[pageIndex], hasPageImage: true };
      // NAO limpa o historico de undo aqui - Ctrl+Z continua disponivel
      // mesmo depois de confirmar (ver getUndoStack/goToPage: o unico
      // efeito de deixar a pilha nao-vazia e goToPage salvar de novo o
      // MESMO resultado ao sair da pagina, inofensivo).
      // studio.editor.refresh() (recarrega a pagina no editor por tras
      // do painel) e chamado do lado do processo principal, dentro do
      // handler de 'confirm-page' (ver index.js) - nao precisa repetir
      // aqui.

      // prioriza a proxima pendente DEPOIS da atual (fluxo natural de ir
      // avancando); se nao sobrar nenhuma pra frente, procura qualquer
      // pendente pra tras; se nao sobrar nenhuma em lugar nenhum, fica
      // na propria pagina (tudo confirmado) em vez de travar/fechar
      const nextPending = pageList.findIndex((p, i) => i > pageIndex && !p.hasPageImage);
      const anyPending = nextPending >= 0 ? nextPending : pageList.findIndex((p) => !p.hasPageImage);
      if (anyPending >= 0) {
        await goToPage(anyPending);
      } else {
        setStatus('Todas as páginas foram limpas.');
        updatePageLabel();
        setProcessing(false);
      }
    } catch (err) {
      setStatus(`Erro ao salvar: ${err.message}`);
      setProcessing(false);
    }
  });

  // ------------------------------------------------------------
  // navegacao livre entre TODAS as paginas editaveis (com raw e/ou
  // pages, nao so as pendentes) - permite voltar numa ja confirmada pra
  // revisar/corrigir algo que passou batido, sem perder o lugar das outras
  // ------------------------------------------------------------
  function updatePageLabel() {
    const entry = pageList[pageIndex];
    const pendingCount = pageList.filter((p) => !p.hasPageImage).length;
    const status = entry.hasPageImage ? 'já limpa' : 'pendente';
    dom.pageLabel.textContent =
      `Página ${entry.key} · ${pageIndex + 1}/${pageList.length} (${status}) · ${pendingCount} pendente(s)`;
  }

  async function goToPage(index) {
    if (index < 0 || index >= pageList.length || isDrawing) return;

    const leavingKey = currentPageKey();
    const leavingStack = getUndoStack(leavingKey);

    // ha limpeza(s) feita(s) nesta pagina desde a ultima vez que foi
    // carregada/salva - em vez de DESCARTAR esse trabalho (como este
    // painel fazia antes, so avisando que ia perder), salva sozinho
    // antes de trocar de pagina, igual o editor principal ja faz ao
    // mudar de pagina com alteracoes pendentes. O historico de undo
    // NAO e apagado (ver getUndoStack) - Ctrl+Z continua funcionando
    // nesta pagina mesmo depois de voltar pra ela mais tarde.
    if (leavingStack.length) {
      setProcessing(true);
      setStatus('Salvando página automaticamente...');
      try {
        await callStudio({
          type: 'confirm-page',
          pageKey: leavingKey,
          imageBase64: dataUrlToBase64(fullCanvas.toDataURL('image/png')),
        });
        const leavingIndex = pageList.findIndex((p) => p.key === leavingKey);
        if (leavingIndex >= 0) pageList[leavingIndex] = { ...pageList[leavingIndex], hasPageImage: true };
      } catch (err) {
        // NAO navega se o salvamento falhou - a pessoa continua vendo o
        // trabalho dela na tela (nada foi perdido), e pode tentar de novo
        setStatus(`Erro ao salvar página automaticamente: ${err.message}`);
        setProcessing(false);
        return;
      }
    }

    pageIndex = index;
    setProcessing(true);
    setStatus('Carregando página...');

    const entry = pageList[index];
    const data = await callStudio({ type: 'get-page', pageKey: entry.key });
    pageList[index] = { key: entry.key, hasPageImage: data.hasPageImage };

    await loadImageIntoCanvases(data.imageBase64);
    updatePageLabel();
    setProcessing(false);
  }

  dom.prevPageBtn.addEventListener('click', () => goToPage(pageIndex - 1));
  dom.nextPageBtn.addEventListener('click', () => goToPage(pageIndex + 1));

  // ------------------------------------------------------------
  // carregamento inicial: lista todas as paginas editaveis (com raw
  // e/ou pages) e abre na primeira PENDENTE (sem "pages" ainda); se
  // nao houver nenhuma pendente (todas ja tem "pages"), abre na
  // primeira mesmo - pra revisao/ajuste adicional (o menu que abre o
  // painel so garante que ha pelo menos uma pagina editavel, pendente
  // ou nao - ver getCleanablePages em index.js)
  // ------------------------------------------------------------
  async function init() {
    setProcessing(true);
    setStatus('Carregando página...');

    const { pages } = await callStudio({ type: 'get-page-list' });
    pageList = pages;

    if (!pageList.length) {
      dom.toolbar.style.visibility = 'hidden';
      dom.imageCanvas.hidden = true;
      dom.maskCanvas.hidden = true;
      dom.emptyState.hidden = false;
      dom.statusOverlay.hidden = true;
      return;
    }

    dom.emptyState.hidden = true;
    dom.imageCanvas.hidden = false;
    dom.maskCanvas.hidden = false;
    dom.toolbar.style.visibility = 'visible';

    const startIndex = pageList.findIndex((p) => !p.hasPageImage);
    await goToPage(startIndex >= 0 ? startIndex : 0);
  }

  init();
})();
