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
 *
 * IMPORTANTE (desenho continuo/a mao livre): confirmar um traco no
 * Core e uma viagem assincrona (IPC + processamento real) - por mais
 * rapida que seja, esperar ELA terminar antes de deixar a pessoa
 * comecar o PROXIMO traco cortaria completamente o desenho a mao
 * livre (cada vez que solta a caneta pra recomecar em outro lugar, o
 * app "trava" ate confirmar o anterior). Por isso:
 * - Iniciar um traco/forma/balde NUNCA espera nenhum commit anterior
 *   terminar (ver canStartDrawing) - so bloqueia durante uma
 *   TRANSFORMACAO DE IMAGEM INTEIRA (girar/espelhar/etc), que troca a
 *   base inteira e de fato nao pode rodar ao mesmo tempo que um traco.
 * - O traco/forma recem-terminado continua VISIVEL no overlay (nao e
 *   limpo na hora) ate o Core confirmar de verdade - ver
 *   pendingPreviews. Limpar a previa ANTES do resultado voltar era o
 *   que fazia o traco "sumir" um instante e voltar, cortando a
 *   sensacao de desenho continuo.
 * - Varios commits podem ficar enfileirados (runSerialized) se a
 *   pessoa desenhar mais rapido que o Core confirma - cada um so
 *   comeca depois que o anterior JA aplicou o resultado dele, pra
 *   nunca ler um "antes" desatualizado nem correr o risco de um
 *   terminar fuera de ordem e apagar o outro.
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
  let isDrawing = false;
  let undoStack = [];

  // true SO durante uma transformacao de imagem INTEIRA (carregar
  // pagina, tela em branco, girar/espelhar/desfocar/redimensionar,
  // desfazer, salvar) - essas trocam a base inteira e nao podem rodar
  // ao mesmo tempo que um traco em andamento. NUNCA fica true so
  // porque um traco/balde/forma esta sendo confirmado no Core (ver
  // canStartDrawing) - e exatamente essa distincao que permite
  // desenhar continuamente sem esperar cada traco confirmar.
  let wholeImageBusy = false;

  // estado do gesto em andamento (pincel: pontos acumulados; formas:
  // ponto inicial, em coordenadas de EXIBICAO - convertidas pra
  // resolucao completa so na hora de commitar, ver toFullRes)
  let brushPoints = [];
  let shapeFrom = null;

  // ------------------------------------------------------------
  // zoom (Ctrl +/- ou Ctrl+scroll) e navegacao (segurar espaco e
  // arrastar) - zoomLevel multiplica a escala "caber na tela" (1 =
  // comportamento padrao de sempre); panX/panY sao um deslocamento em
  // PIXELS DE TELA aplicado via CSS var, sem depender do scroll nativo
  // do navegador (canvasWrap tem align-items/justify-content:center +
  // overflow:hidden - combinar isso com overflow:auto tem um bug
  // conhecido de flexbox onde metade do conteudo que estoura vira
  // inacessivel pela rolagem; controlando o deslocamento a mao esse
  // problema nem aparece).
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
    redrawDisplay();
  }

  function resetView() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyPanTransform();
  }

  function setStatus(text, isError) {
    dom.statusText.textContent = text;
    if (isError) console.error('[painter]', text);
  }

  function canStartDrawing() {
    return hasImage && !wholeImageBusy;
  }

  function refreshButtons() {
    dom.btnUndo.disabled = wholeImageBusy || !undoStack.length;
    dom.btnSave.disabled = wholeImageBusy || !hasImage || !pageKey;
    [dom.btnLoadPage, dom.btnBlank, dom.btnRotateCcw, dom.btnRotateCw, dom.btnFlipH, dom.btnFlipV, dom.btnBlur, dom.btnResize].forEach(
      (btn) => { btn.disabled = wholeImageBusy; }
    );
  }

  function setWholeImageBusy(value) {
    wholeImageBusy = value;
    dom.statusOverlay.hidden = !value;
    refreshButtons();
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
        resetView(); // imagem nova (pagina/tela em branco) - comeca sempre do zero, centralizada
        redrawDisplay();
        resolve();
      };
      img.src = `data:image/png;base64,${imageBase64}`;
    });
  }

  function redrawDisplay() {
    const availableW = Math.max(50, dom.canvasWrap.clientWidth - DISPLAY_PADDING * 2);
    const availableH = Math.max(50, dom.canvasWrap.clientHeight - DISPLAY_PADDING * 2);
    const fitScale = Math.min(availableW / fullCanvas.width, availableH / fullCanvas.height, 1);
    const scale = fitScale * zoomLevel;
    const w = Math.max(1, Math.round(fullCanvas.width * scale));
    const h = Math.max(1, Math.round(fullCanvas.height * scale));

    [dom.imageCanvas, dom.overlayCanvas].forEach((c) => {
      c.width = w;
      c.height = h;
    });
    imageCtx.clearRect(0, 0, w, h);
    imageCtx.drawImage(fullCanvas, 0, 0, fullCanvas.width, fullCanvas.height, 0, 0, w, h);
    redrawPendingPreviews();
  }

  window.addEventListener('resize', () => {
    if (hasImage && !isDrawing) redrawDisplay();
  });

  function pushUndo() {
    undoStack.push(fullCanvas.toDataURL('image/png'));
    refreshButtons();
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
  // previas de tracos/formas AINDA NAO confirmadas pelo Core - ficam
  // desenhadas no overlay desde o instante em que o gesto termina ate
  // o resultado de verdade voltar, pra nao haver NENHUM instante em
  // que o desenho "some" (ver nota no topo do arquivo). Cada entrada
  // sabe se redesenhar sozinha (redrawPendingPreviews limpa tudo e
  // manda cada uma se desenhar de novo, na ordem - preciso disso
  // porque remover UMA previa exige limpar o overlay inteiro, e as
  // outras ainda pendentes precisam reaparecer).
  // ------------------------------------------------------------
  let pendingPreviews = [];

  function redrawPendingPreviews() {
    overlayCtx.clearRect(0, 0, dom.overlayCanvas.width, dom.overlayCanvas.height);
    for (const p of pendingPreviews) p.draw();
  }

  function addPendingPreview(drawFn) {
    const entry = { draw: drawFn };
    pendingPreviews.push(entry);
    redrawPendingPreviews();
    return entry;
  }

  function removePendingPreview(entry) {
    const idx = pendingPreviews.indexOf(entry);
    if (idx === -1) return;
    pendingPreviews.splice(idx, 1);
    redrawPendingPreviews();
  }

  /** Redesenha um traco de pincel INTEIRO no overlay (coordenadas dos
   *  pontos em resolucao COMPLETA, convertidas pra exibicao aqui) -
   *  mesmo algoritmo de segmento-por-segmento do Core (studio.draw.stroke),
   *  so que como previa leve no navegador. */
  function drawStrokeFull(points, color, baseWidth) {
    if (!points.length || !fullCanvas.width) return;
    const scale = dom.overlayCanvas.width / fullCanvas.width;
    overlayCtx.strokeStyle = color;
    overlayCtx.fillStyle = color;
    overlayCtx.lineCap = 'round';
    overlayCtx.lineJoin = 'round';

    if (points.length === 1) {
      const p = points[0];
      const radius = Math.max(0.5, (baseWidth * (p.pressure ?? 1)) / 2) * scale;
      overlayCtx.beginPath();
      overlayCtx.arc(p.x * scale, p.y * scale, radius, 0, Math.PI * 2);
      overlayCtx.fill();
      return;
    }

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const pressure = ((a.pressure ?? 1) + (b.pressure ?? 1)) / 2;
      overlayCtx.lineWidth = Math.max(0.5, baseWidth * pressure) * scale;
      overlayCtx.beginPath();
      overlayCtx.moveTo(a.x * scale, a.y * scale);
      overlayCtx.lineTo(b.x * scale, b.y * scale);
      overlayCtx.stroke();
    }
  }

  /** Redesenha uma forma no visual FINAL (solido, com as cores/espessura
   *  reais) no overlay - substitui a previa tracejada usada so durante
   *  o arraste (ver drawShapeDragPreview). */
  function drawShapeFull(type, from, to, strokeColor, strokeWidth, fillColor) {
    if (!fullCanvas.width) return;
    const scale = dom.overlayCanvas.width / fullCanvas.width;
    const df = { x: from.x * scale, y: from.y * scale };
    const dt = { x: to.x * scale, y: to.y * scale };

    overlayCtx.save();
    overlayCtx.beginPath();
    if (type === 'rectangle') {
      overlayCtx.rect(Math.min(df.x, dt.x), Math.min(df.y, dt.y), Math.abs(dt.x - df.x), Math.abs(dt.y - df.y));
    } else if (type === 'circle') {
      overlayCtx.arc(df.x, df.y, Math.hypot(dt.x - df.x, dt.y - df.y), 0, Math.PI * 2);
    } else {
      overlayCtx.moveTo(df.x, df.y);
      overlayCtx.lineTo(dt.x, dt.y);
    }
    if (fillColor && type !== 'line') {
      overlayCtx.fillStyle = fillColor;
      overlayCtx.fill();
    }
    overlayCtx.strokeStyle = strokeColor;
    overlayCtx.lineWidth = strokeWidth * scale;
    overlayCtx.lineCap = 'round';
    overlayCtx.stroke();
    overlayCtx.restore();
  }

  // ------------------------------------------------------------
  // fila de commits - serializa studio.draw/studio.image (cada um so
  // comeca depois que o anterior JA aplicou o resultado dele) sem
  // bloquear a INTERACAO (iniciar um novo traco nunca espera a fila).
  // Ver nota no topo do arquivo pra motivacao completa.
  // ------------------------------------------------------------
  let commitChain = Promise.resolve();
  function runSerialized(fn) {
    const run = commitChain.then(fn, fn);
    commitChain = run.catch(() => {});
    return run;
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
    if (wholeImageBusy || !undoStack.length) return;
    // passa pela MESMA fila dos commits de traco - sem isso, um traco
    // ainda pendente de confirmar poderia terminar DEPOIS do undo e
    // reaplicar por cima, "desfazendo o desfazer" sem a pessoa perceber
    await runSerialized(async () => {
      setWholeImageBusy(true);
      try {
        const previous = undoStack.pop();
        await applyResultBase64(dataUrlToBase64(previous));
      } finally {
        setWholeImageBusy(false);
      }
    });
  }

  // ------------------------------------------------------------
  // carregar pagina atual / tela em branco
  // ------------------------------------------------------------
  dom.btnLoadPage.addEventListener('click', () =>
    runSerialized(async () => {
      setWholeImageBusy(true);
      setStatus('Carregando página...');
      try {
        const result = await callStudio({ type: 'load-current-page' });
        pageKey = result.pageKey;
        dom.pageLabel.textContent = `Página: ${pageKey}`;
        await loadImageIntoCanvases(result.imageBase64);
        undoStack = [];
        setStatus('');
      } catch (err) {
        setStatus(`Erro: ${err.message}`, true);
      } finally {
        setWholeImageBusy(false);
      }
    })
  );

  dom.btnBlank.addEventListener('click', () =>
    runSerialized(async () => {
      setWholeImageBusy(true);
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
        setStatus(`Erro: ${err.message}`, true);
      } finally {
        setWholeImageBusy(false);
      }
    })
  );

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

  function releasePointerCaptureSafe(evt) {
    try {
      dom.overlayCanvas.releasePointerCapture(evt.pointerId);
    } catch (err) {
      // ja liberado/nao capturado - sem problema nenhum ignorar
    }
  }

  // ------------------------------------------------------------
  // zoom (Ctrl +/- e Ctrl+scroll) e pan (segurar espaco e arrastar) -
  // tem prioridade sobre o desenho: enquanto espaco esta pressionado, o
  // mesmo gesto de pointerdown/move/up navega em vez de desenhar (ver
  // startPan/movePan/stopPan chamados no topo de startDrawing/moveDrawing/stopDrawing).
  // ------------------------------------------------------------
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

  function startPan(evt) {
    if (!spaceDown) return false;
    isPanning = true;
    panPointerStart = { x: evt.clientX, y: evt.clientY };
    panOffsetStart = { x: panX, y: panY };
    dom.canvasWrap.classList.add('panning-active');
    try {
      dom.overlayCanvas.setPointerCapture(evt.pointerId);
    } catch (err) {
      // sem suporte a capture - segue sem, o pan so fica um pouco menos robusto
    }
    return true;
  }

  function movePan(evt) {
    panX = panOffsetStart.x + (evt.clientX - panPointerStart.x);
    panY = panOffsetStart.y + (evt.clientY - panPointerStart.y);
    applyPanTransform();
  }

  function stopPan(evt) {
    isPanning = false;
    dom.canvasWrap.classList.remove('panning-active');
    releasePointerCaptureSafe(evt);
  }

  function startDrawing(evt) {
    if (startPan(evt)) return;
    if (!canStartDrawing()) return;
    evt.preventDefault();

    // TRAVA DE CAPTURA: prende TODOS os eventos seguintes desse mesmo
    // ponteiro (move/up) neste canvas, mesmo que a caneta saia da area
    // dele ou o SO troque qual elemento "esta por baixo" no meio do
    // gesto. Sem isso, uma caneta/tablet real perde pointermove no
    // meio do traco (o navegador some de entregar os eventos pro
    // elemento certo assim que o ponteiro cruza alguma borda/limite) -
    // era exatamente essa perda de pontos intermediarios que fazia uma
    // curva de verdade virar uma linha reta (so o inicio e o fim
    // sobreviviam). setPointerCapture existe pra isso.
    try {
      dom.overlayCanvas.setPointerCapture(evt.pointerId);
    } catch (err) {
      // navegador/dispositivo sem suporte - segue sem capture, degrada
      // graciosamente pro comportamento de antes
    }

    isDrawing = true;
    const pos = getDisplayPos(evt);
    const tool = dom.tool.value;

    if (tool === 'brush') {
      brushPoints = [{ ...toFullRes(pos), pressure: readPressure(evt) }];
    } else if (tool === 'bucket') {
      isDrawing = false;
      releasePointerCaptureSafe(evt);
      const color = dom.color.value;
      const tolerance = Number(dom.sizeRange.value);
      runSerialized(() => commitBucket(pos, color, tolerance));
    } else {
      shapeFrom = pos;
    }
  }

  function moveDrawing(evt) {
    if (isPanning) {
      movePan(evt);
      return;
    }
    if (!isDrawing) return;
    evt.preventDefault();

    // NAO usar "evt.buttons === 0" aqui pra detectar "soltou" - em
    // varios drivers de mesa digitalizadora/tablet reais, "buttons"
    // vem 0 (ou piscando entre 0 e 1) MESMO com a caneta pressionada
    // de verdade o tempo todo (so "pressure" e confiavel nesse
    // hardware). Confiar em "buttons" pra decidir parar o traco
    // fragmentava um traco continuo em varios pedacinhos curtos (cada
    // leitura ruidosa de buttons=0 cortava o traco ali, e um novo
    // pointerdown espurio do mesmo driver recomecava outro pedaco).
    // setPointerCapture (ver startDrawing) ja resolve o motivo
    // original de precisar dessa rede de seguranca (pointerup/pointercancel
    // agora chegam de forma confiavel, mesmo se a caneta sair fisicamente
    // da area do canvas) - nao precisa mais adivinhar pelo "buttons".

    const pos = getDisplayPos(evt);
    const tool = dom.tool.value;

    if (tool === 'brush') {
      brushPoints.push({ ...toFullRes(pos), pressure: readPressure(evt) });
      // previa leve ao vivo - so o segmento novo, direto no overlay
      // (redrawPendingPreviews cuida de redesenhar o traco INTEIRO
      // quando algum outro pendente terminar antes deste)
      const prev = brushPoints[brushPoints.length - 2];
      if (prev) {
        const scale = dom.overlayCanvas.width / fullCanvas.width;
        const pressure = ((prev.pressure ?? 1) + readPressure(evt)) / 2;
        overlayCtx.strokeStyle = dom.color.value;
        overlayCtx.lineCap = 'round';
        overlayCtx.lineJoin = 'round';
        overlayCtx.lineWidth = Math.max(0.5, Number(dom.sizeRange.value) * pressure) * scale;
        overlayCtx.beginPath();
        overlayCtx.moveTo(prev.x * scale, prev.y * scale);
        overlayCtx.lineTo(pos.x, pos.y);
        overlayCtx.stroke();
      }
    } else if (shapeFrom) {
      redrawPendingPreviews(); // mantem qualquer previa de OUTRO gesto ainda pendente
      drawShapeDragPreview(tool, shapeFrom, pos);
    }
  }

  function drawShapeDragPreview(tool, from, to) {
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

  function stopDrawing(evt) {
    if (isPanning) {
      stopPan(evt);
      return;
    }
    if (!isDrawing) return;
    isDrawing = false;
    releasePointerCaptureSafe(evt);
    const tool = dom.tool.value;

    if (tool === 'brush') {
      const points = brushPoints;
      brushPoints = [];
      if (!points.length) return;
      const color = dom.color.value;
      const baseWidth = Number(dom.sizeRange.value);
      // fica visivel (previa) ate o Core confirmar de verdade - NUNCA
      // limpa o overlay aqui, isso que cortava o traco antes
      const preview = addPendingPreview(() => drawStrokeFull(points, color, baseWidth));
      runSerialized(() => commitStroke(points, color, baseWidth)).finally(() => removePendingPreview(preview));
    } else if (shapeFrom) {
      const fromFull = toFullRes(shapeFrom);
      shapeFrom = null;
      const toFull = toFullRes(getDisplayPos(evt));
      const strokeColor = dom.color.value;
      const strokeWidth = Number(dom.sizeRange.value);
      const fillColor = dom.useFill.checked && tool !== 'line' ? dom.fillColor.value : null;
      const preview = addPendingPreview(() => drawShapeFull(tool, fromFull, toFull, strokeColor, strokeWidth, fillColor));
      runSerialized(() => commitShape(tool, fromFull, toFull, strokeColor, strokeWidth, fillColor)).finally(() =>
        removePendingPreview(preview)
      );
    }
  }

  dom.overlayCanvas.addEventListener('pointerdown', startDrawing);
  dom.overlayCanvas.addEventListener('pointermove', moveDrawing);
  window.addEventListener('pointerup', stopDrawing);
  // pointercancel: o navegador/SO interrompeu esse ponteiro no meio do
  // gesto (ex: gesto do sistema, troca de janela, palm rejection) -
  // evento legitimo e raro, diferente de reler "buttons" a cada
  // pointermove (que se mostrou nao confiavel em tablets reais) -
  // trata igual um "soltou" pra nao deixar isDrawing preso.
  window.addEventListener('pointercancel', stopDrawing);

  // ------------------------------------------------------------
  // commits - so AQUI que studio.draw/studio.image entram em cena, no
  // FIM do gesto, com os dados JA CAPTURADOS (cores/espessura/tolerancia
  // vem como PARAMETRO, snapshot do momento do gesto - nunca lidos de
  // `dom.*` aqui dentro, porque por essa funcao poder rodar mais tarde
  // - enfileirada atras de outro commit - a pessoa pode ja ter trocado
  // de cor/ferramenta pro PROXIMO traco antes deste aqui rodar de verdade).
  // Nao bloqueiam a interacao (sem setWholeImageBusy) - ver nota no
  // topo do arquivo.
  // ------------------------------------------------------------
  async function commitStroke(points, color, baseWidth) {
    const before = fullCanvasBase64();
    try {
      const result = await callStudio({
        type: 'stroke',
        imageBase64: before,
        points,
        opts: { color, baseWidth, pressureAffectsWidth: true },
      });
      pushUndo();
      await applyResultBase64(result.imageBase64);
    } catch (err) {
      setStatus(`Erro ao aplicar traço: ${err.message}`, true);
    }
  }

  async function commitBucket(displayPos, color, tolerance) {
    const before = fullCanvasBase64();
    try {
      const result = await callStudio({
        type: 'flood-fill',
        imageBase64: before,
        point: toFullRes(displayPos),
        color,
        opts: { tolerance },
      });
      pushUndo();
      await applyResultBase64(result.imageBase64);
    } catch (err) {
      setStatus(`Erro ao preencher: ${err.message}`, true);
    }
  }

  async function commitShape(type, from, to, strokeColor, strokeWidth, fillColor) {
    const before = fullCanvasBase64();
    try {
      const shape = { type, from, to, strokeColor, strokeWidth };
      if (fillColor) shape.fillColor = fillColor;
      const result = await callStudio({ type: 'shape', imageBase64: before, shape });
      pushUndo();
      await applyResultBase64(result.imageBase64);
    } catch (err) {
      setStatus(`Erro ao desenhar forma: ${err.message}`, true);
    }
  }

  // ------------------------------------------------------------
  // transformacoes (studio.image) - sempre na imagem INTEIRA, por isso
  // passam por wholeImageBusy (bloqueiam novos tracos) E pela mesma
  // fila serializada (esperam qualquer traco pendente confirmar antes
  // de rodar, garantindo que operam sobre o estado mais recente).
  // ------------------------------------------------------------
  function applyImageOp(type, extra, label) {
    if (!hasImage) return;
    return runSerialized(async () => {
      setWholeImageBusy(true);
      setStatus(label);
      const before = fullCanvasBase64();
      try {
        const result = await callStudio({ type, imageBase64: before, ...extra });
        pushUndo();
        await applyResultBase64(result.imageBase64);
        setStatus('');
      } catch (err) {
        setStatus(`Erro: ${err.message}`, true);
      } finally {
        setWholeImageBusy(false);
      }
    });
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
  // salvar na pagina - tambem espera a fila (qualquer traco ainda
  // pendente de confirmar) pra garantir que salva o estado mais
  // recente de verdade, nao um instantaneo no meio de uma confirmacao.
  // ------------------------------------------------------------
  dom.btnSave.addEventListener('click', () => {
    if (!pageKey || !hasImage) return;
    return runSerialized(async () => {
      setWholeImageBusy(true);
      setStatus('Salvando na página...');
      try {
        await callStudio({ type: 'save-to-page', pageKey, imageBase64: fullCanvasBase64() });
        setStatus('Salvo! O editor já mostra o resultado.');
      } catch (err) {
        setStatus(`Erro ao salvar: ${err.message}`, true);
      } finally {
        setWholeImageBusy(false);
      }
    });
  });

  setWholeImageBusy(false);
})();
