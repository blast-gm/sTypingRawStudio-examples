/**
 * Painter - UI do painel. Roda isolado (iframe sandboxed, sem
 * allow-same-origin) - a UNICA forma de conversar com o resto do app e
 * `callStudio(payload)`, que manda um postMessage pro parent e recebe
 * de volta o retorno de `onMessage` registrado no index.js (que roda
 * no processo principal, com acesso a `studio`).
 *
 * Arquitetura (mesmo principio do smart-cleaner): so o que precisa ser
 * REATIVO em tempo real roda aqui (pointerdown/move/up, previa visual
 * leve enquanto arrasta) - a operacao de verdade (studio.draw / studio.image)
 * so acontece no FIM do gesto (solta o mouse/caneta), mandando os
 * dados brutos JA CAPTURADOS pro Core processar em resolucao completa.
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

  const el = (id) => document.getElementById(id);
  const dom = {
    pageLabel: el('pageLabel'),
    btnLoadPage: el('btnLoadPage'),
    blankWidth: el('blankWidth'),
    blankHeight: el('blankHeight'),
    blankColor: el('blankColor'),
    btnBlank: el('btnBlank'),
    tool: el('tool'),
    colorLabel: el('colorLabel'),
    color: el('color'),
    fillColorLabel: el('fillColorLabel'),
    fillColor: el('fillColor'),
    useFillLabel: el('useFillLabel'),
    useFill: el('useFill'),
    sizeLabel: el('sizeLabel'),
    sizeRange: el('sizeRange'),
    sizeValue: el('sizeValue'),
    btnRotateCcw: el('btnRotateCcw'),
    btnRotateCw: el('btnRotateCw'),
    btnFlipH: el('btnFlipH'),
    btnFlipV: el('btnFlipV'),
    btnBlur: el('btnBlur'),
    blurRadius: el('blurRadius'),
    resizeWidth: el('resizeWidth'),
    btnResize: el('btnResize'),
    btnUndo: el('btnUndo'),
    btnSave: el('btnSave'),
    canvasWrap: el('canvasWrap'),
    emptyState: el('emptyState'),
    imageCanvas: el('imageCanvas'),
    overlayCanvas: el('overlayCanvas'),
    statusOverlay: el('statusOverlay'),
    statusText: el('statusText'),
  };

  const imageCtx = dom.imageCanvas.getContext('2d');
  const overlayCtx = dom.overlayCanvas.getContext('2d');

  // "fonte da verdade": canvas OFFSCREEN na resolucao ORIGINAL da
  // imagem - o canvas visivel (dom.imageCanvas) e so uma versao
  // reduzida pra caber na tela. Tudo que e enviado pro Core
  // (studio.draw.*/studio.image.*) usa ESTE canvas, nunca o reduzido.
  const fullCanvas = document.createElement('canvas');
  const fullCtx = fullCanvas.getContext('2d');

  const DISPLAY_PADDING = 24;

  let pageKey = null;
  let hasImage = false;
  let isProcessing = false;
  let isDrawing = false;
  let undoStack = [];

  // estado do gesto em andamento (pincel: pontos acumulados; formas:
  // ponto inicial, em coordenadas de EXIBICAO - convertidas pra
  // resolucao completa so na hora de commitar, ver toFullRes)
  let brushPoints = [];
  let shapeFrom = null;

  function setStatus(text) {
    dom.statusText.textContent = text;
  }

  function setProcessing(value) {
    isProcessing = value;
    dom.statusOverlay.hidden = !value;
    dom.overlayCanvas.style.pointerEvents = value ? 'none' : 'auto';
    dom.btnUndo.disabled = value || !undoStack.length;
    dom.btnSave.disabled = value || !hasImage || !pageKey;
    [dom.btnLoadPage, dom.btnBlank, dom.btnRotateCcw, dom.btnRotateCw, dom.btnFlipH, dom.btnFlipV, dom.btnBlur, dom.btnResize].forEach(
      (btn) => { btn.disabled = value; }
    );
  }

  // ------------------------------------------------------------
  // carregar/exibir imagem
  // ------------------------------------------------------------
  function loadImageIntoCanvases(imageBase64) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        fullCanvas.width = img.naturalWidth;
        fullCanvas.height = img.naturalHeight;
        fullCtx.clearRect(0, 0, fullCanvas.width, fullCanvas.height);
        fullCtx.drawImage(img, 0, 0);
        hasImage = true;
        dom.emptyState.hidden = true;
        dom.imageCanvas.hidden = false;
        dom.overlayCanvas.hidden = false;
        redrawDisplay();
        resolve();
      };
      img.src = `data:image/png;base64,${imageBase64}`;
    });
  }

  function redrawDisplay() {
    const availableW = Math.max(50, dom.canvasWrap.clientWidth - DISPLAY_PADDING * 2);
    const availableH = Math.max(50, dom.canvasWrap.clientHeight - DISPLAY_PADDING * 2);
    const scale = Math.min(availableW / fullCanvas.width, availableH / fullCanvas.height, 1);
    const w = Math.max(1, Math.round(fullCanvas.width * scale));
    const h = Math.max(1, Math.round(fullCanvas.height * scale));

    [dom.imageCanvas, dom.overlayCanvas].forEach((c) => {
      c.width = w;
      c.height = h;
    });
    imageCtx.clearRect(0, 0, w, h);
    imageCtx.drawImage(fullCanvas, 0, 0, fullCanvas.width, fullCanvas.height, 0, 0, w, h);
    overlayCtx.clearRect(0, 0, w, h);
  }

  window.addEventListener('resize', () => {
    if (hasImage && !isDrawing) redrawDisplay();
  });

  function pushUndo() {
    undoStack.push(fullCanvas.toDataURL('image/png'));
  }

  function dataUrlToBase64(dataUrl) {
    return dataUrl.split(',')[1];
  }

  function fullCanvasBase64() {
    return dataUrlToBase64(fullCanvas.toDataURL('image/png'));
  }

  async function applyResultBase64(resultBase64) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // o resultado pode ter dimensoes DIFERENTES da imagem anterior
        // (rotate/resize mudam largura/altura) - precisa redimensionar
        // o canvas de verdade ANTES de desenhar, senao o navegador so
        // desenha (e recorta) o resultado novo dentro do tamanho ANTIGO
        // do canvas, corrompendo silenciosamente o resultado.
        fullCanvas.width = img.naturalWidth;
        fullCanvas.height = img.naturalHeight;
        fullCtx.clearRect(0, 0, fullCanvas.width, fullCanvas.height);
        fullCtx.drawImage(img, 0, 0);
        redrawDisplay();
        resolve();
      };
      img.src = `data:image/png;base64,${resultBase64}`;
    });
  }

  // ------------------------------------------------------------
  // desfazer
  // ------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });
  dom.btnUndo.addEventListener('click', undo);

  async function undo() {
    if (isProcessing || !undoStack.length) return;
    const previous = undoStack.pop();
    await applyResultBase64(dataUrlToBase64(previous));
    dom.btnUndo.disabled = !undoStack.length;
  }

  // ------------------------------------------------------------
  // carregar pagina atual / tela em branco
  // ------------------------------------------------------------
  dom.btnLoadPage.addEventListener('click', async () => {
    setProcessing(true);
    setStatus('Carregando página...');
    try {
      const result = await callStudio({ type: 'load-current-page' });
      pageKey = result.pageKey;
      dom.pageLabel.textContent = `Página: ${pageKey}`;
      await loadImageIntoCanvases(result.imageBase64);
      undoStack = [];
      setStatus('');
    } catch (err) {
      setStatus(`Erro: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  });

  dom.btnBlank.addEventListener('click', async () => {
    setProcessing(true);
    setStatus('Criando tela em branco...');
    try {
      const result = await callStudio({
        type: 'new-blank-canvas',
        width: Number(dom.blankWidth.value) || 800,
        height: Number(dom.blankHeight.value) || 600,
        backgroundColor: dom.blankColor.value,
      });
      pageKey = null; // tela solta, nao vinculada a nenhuma pagina ainda
      dom.pageLabel.textContent = 'Tela em branco (não salva em nenhuma página)';
      await loadImageIntoCanvases(result.imageBase64);
      undoStack = [];
      setStatus('');
    } catch (err) {
      setStatus(`Erro: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  });

  // ------------------------------------------------------------
  // selecao de ferramenta - ajusta os campos visiveis/rotulos
  // ------------------------------------------------------------
  function updateToolUI() {
    const tool = dom.tool.value;
    const isShape = tool === 'rectangle' || tool === 'circle' || tool === 'line';

    [dom.fillColorLabel, dom.fillColor, dom.useFillLabel].forEach((elm) => { elm.hidden = !isShape; });

    if (tool === 'brush') {
      dom.colorLabel.textContent = 'Cor';
      dom.sizeLabel.textContent = 'Espessura';
      dom.sizeRange.min = 1;
      dom.sizeRange.max = 80;
      if (Number(dom.sizeRange.value) > 80) dom.sizeRange.value = 10;
    } else if (tool === 'bucket') {
      dom.colorLabel.textContent = 'Cor';
      dom.sizeLabel.textContent = 'Tolerância';
      dom.sizeRange.min = 0;
      dom.sizeRange.max = 200;
    } else {
      dom.colorLabel.textContent = 'Contorno';
      dom.sizeLabel.textContent = 'Espessura do contorno';
      dom.sizeRange.min = 1;
      dom.sizeRange.max = 40;
      if (Number(dom.sizeRange.value) > 40) dom.sizeRange.value = 4;
    }
    dom.sizeValue.textContent = `${dom.sizeRange.value}px`;
  }
  dom.tool.addEventListener('change', updateToolUI);
  dom.sizeRange.addEventListener('input', () => { dom.sizeValue.textContent = `${dom.sizeRange.value}px`; });
  updateToolUI();

  // ------------------------------------------------------------
  // desenho no canvas (overlay) - so a interacao BRUTA (Canvas 2D
  // comum do navegador), sem nenhuma funcao de studio ainda
  // ------------------------------------------------------------
  function getDisplayPos(evt) {
    const rect = dom.overlayCanvas.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * dom.overlayCanvas.width,
      y: ((evt.clientY - rect.top) / rect.height) * dom.overlayCanvas.height,
    };
  }

  function toFullRes(displayPos) {
    const scaleX = fullCanvas.width / dom.overlayCanvas.width;
    const scaleY = fullCanvas.height / dom.overlayCanvas.height;
    return { x: displayPos.x * scaleX, y: displayPos.y * scaleY };
  }

  // so confia em pressao de CANETA de verdade - mouse/touch reportam
  // 0.5 constante (fallback do proprio navegador quando o hardware nao
  // suporta pressao real), o que deixaria TODO traco de mouse pela
  // metade da espessura escolhida por padrao. Ver docs/extensions/draw.md.
  function readPressure(evt) {
    return evt.pointerType === 'pen' ? evt.pressure : 1;
  }

  function startDrawing(evt) {
    if (isProcessing || !hasImage) return;
    evt.preventDefault();
    isDrawing = true;
    const pos = getDisplayPos(evt);
    const tool = dom.tool.value;

    if (tool === 'brush') {
      brushPoints = [{ ...toFullRes(pos), pressure: readPressure(evt) }];
      overlayCtx.strokeStyle = dom.color.value;
      overlayCtx.lineWidth = Number(dom.sizeRange.value) * (dom.overlayCanvas.width / fullCanvas.width);
      overlayCtx.lineCap = 'round';
      overlayCtx.lineJoin = 'round';
      overlayCtx.beginPath();
      overlayCtx.moveTo(pos.x, pos.y);
    } else if (tool === 'bucket') {
      commitBucket(pos);
      isDrawing = false;
    } else {
      shapeFrom = pos;
    }
  }

  function moveDrawing(evt) {
    if (!isDrawing) return;
    evt.preventDefault();
    const pos = getDisplayPos(evt);
    const tool = dom.tool.value;

    if (tool === 'brush') {
      brushPoints.push({ ...toFullRes(pos), pressure: readPressure(evt) });
      overlayCtx.lineTo(pos.x, pos.y);
      overlayCtx.stroke();
    } else if (shapeFrom) {
      overlayCtx.clearRect(0, 0, dom.overlayCanvas.width, dom.overlayCanvas.height);
      drawShapePreview(tool, shapeFrom, pos);
    }
  }

  function drawShapePreview(tool, from, to) {
    overlayCtx.save();
    overlayCtx.strokeStyle = dom.color.value;
    overlayCtx.lineWidth = 1.5;
    overlayCtx.setLineDash([5, 4]);
    overlayCtx.beginPath();
    if (tool === 'rectangle') {
      overlayCtx.rect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    } else if (tool === 'circle') {
      overlayCtx.arc(from.x, from.y, Math.hypot(to.x - from.x, to.y - from.y), 0, Math.PI * 2);
    } else {
      overlayCtx.moveTo(from.x, from.y);
      overlayCtx.lineTo(to.x, to.y);
    }
    overlayCtx.stroke();
    overlayCtx.restore();
  }

  async function stopDrawing(evt) {
    if (!isDrawing) return;
    isDrawing = false;
    const tool = dom.tool.value;
    overlayCtx.clearRect(0, 0, dom.overlayCanvas.width, dom.overlayCanvas.height);

    if (tool === 'brush') {
      if (brushPoints.length) await commitStroke(brushPoints);
      brushPoints = [];
    } else if (shapeFrom) {
      const to = toFullRes(getDisplayPos(evt));
      await commitShape(tool, toFullRes(shapeFrom), to);
      shapeFrom = null;
    }
  }

  dom.overlayCanvas.addEventListener('pointerdown', startDrawing);
  dom.overlayCanvas.addEventListener('pointermove', moveDrawing);
  window.addEventListener('pointerup', stopDrawing);

  // ------------------------------------------------------------
  // commits - so AQUI que studio.draw/studio.image entram em cena,
  // sempre no FIM do gesto, com os dados ja capturados
  // ------------------------------------------------------------
  async function commitStroke(points) {
    setProcessing(true);
    setStatus('Aplicando traço...');
    const before = fullCanvasBase64();
    try {
      const result = await callStudio({
        type: 'stroke',
        imageBase64: before,
        points,
        opts: { color: dom.color.value, baseWidth: Number(dom.sizeRange.value), pressureAffectsWidth: true },
      });
      pushUndo();
      await applyResultBase64(result.imageBase64);
      setStatus('');
    } catch (err) {
      setStatus(`Erro: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  }

  async function commitBucket(displayPos) {
    setProcessing(true);
    setStatus('Preenchendo...');
    const before = fullCanvasBase64();
    try {
      const result = await callStudio({
        type: 'flood-fill',
        imageBase64: before,
        point: toFullRes(displayPos),
        color: dom.color.value,
        opts: { tolerance: Number(dom.sizeRange.value) },
      });
      pushUndo();
      await applyResultBase64(result.imageBase64);
      setStatus('');
    } catch (err) {
      setStatus(`Erro: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  }

  async function commitShape(type, from, to) {
    setProcessing(true);
    setStatus('Desenhando forma...');
    const before = fullCanvasBase64();
    try {
      const shape = {
        type,
        from,
        to,
        strokeColor: dom.color.value,
        strokeWidth: Number(dom.sizeRange.value),
      };
      if (dom.useFill.checked && type !== 'line') shape.fillColor = dom.fillColor.value;
      const result = await callStudio({ type: 'shape', imageBase64: before, shape });
      pushUndo();
      await applyResultBase64(result.imageBase64);
      setStatus('');
    } catch (err) {
      setStatus(`Erro: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  }

  // ------------------------------------------------------------
  // transformacoes (studio.image) - sempre na imagem INTEIRA
  // ------------------------------------------------------------
  async function applyImageOp(type, extra, label) {
    if (!hasImage) return;
    setProcessing(true);
    setStatus(label);
    const before = fullCanvasBase64();
    try {
      const result = await callStudio({ type, imageBase64: before, ...extra });
      pushUndo();
      await applyResultBase64(result.imageBase64);
      setStatus('');
    } catch (err) {
      setStatus(`Erro: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  }

  dom.btnRotateCcw.addEventListener('click', () => applyImageOp('rotate', { degrees: -90 }, 'Girando...'));
  dom.btnRotateCw.addEventListener('click', () => applyImageOp('rotate', { degrees: 90 }, 'Girando...'));
  dom.btnFlipH.addEventListener('click', () => applyImageOp('flip', { axis: 'horizontal' }, 'Espelhando...'));
  dom.btnFlipV.addEventListener('click', () => applyImageOp('flip', { axis: 'vertical' }, 'Espelhando...'));
  dom.btnBlur.addEventListener('click', () => applyImageOp('blur', { radius: Number(dom.blurRadius.value) }, 'Desfocando...'));
  dom.btnResize.addEventListener('click', () => {
    const width = Number(dom.resizeWidth.value);
    if (!width) return;
    applyImageOp('resize', { opts: { width, maintainAspectRatio: true } }, 'Redimensionando...');
  });

  // ------------------------------------------------------------
  // salvar na pagina
  // ------------------------------------------------------------
  dom.btnSave.addEventListener('click', async () => {
    if (!pageKey || !hasImage) return;
    setProcessing(true);
    setStatus('Salvando na página...');
    try {
      await callStudio({ type: 'save-to-page', pageKey, imageBase64: fullCanvasBase64() });
      setStatus('Salvo! O editor já mostra o resultado.');
    } catch (err) {
      setStatus(`Erro ao salvar: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  });

  setProcessing(false);
})();
