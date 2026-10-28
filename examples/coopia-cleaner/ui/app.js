/**
 * Smart Cleaner Mobile - UI do painel. Roda isolado (iframe sandboxed,
 * sem allow-same-origin) - a UNICA forma de conversar com o resto do
 * app e `callStudio(payload)`, que manda um postMessage pro parent (o
 * renderer do sTraw Studio) e recebe de volta o retorno de
 * `onMessage` registrado no index.js desta extensao (que roda no
 * processo principal, com acesso a `studio`). Nunca ha acesso direto a
 * Node/Electron/`window.parent` aqui - so essa ponte de mensagens.
 *
 * DIFERENCA em relacao ao Smart Cleaner original: como
 * studio.image.runOnnxModel() (usado por baixo, ver index.js) e
 * GENERICO - nao sabe nada sobre o formato de tensor do MI-GAN - todo
 * o pre-processamento (recorte em torno da area pintada + conversao
 * pra tensor NCHW uint8) e pos-processamento (tensor de volta pra
 * pixels, composto na posicao certa) acontece AQUI, usando o <canvas>
 * de verdade que este painel HTML ja tem disponivel - nao precisa
 * reimplementar decodificacao de imagem em JS puro, so extrair/montar
 * pixels com a Canvas API padrao do browser.
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
    loginScreen: el('loginScreen'),
    loginCode: el('loginCode'),
    loginPassword: el('loginPassword'),
    setupHint: el('setupHint'),
    btnLogin: el('btnLogin'),
    loginStatus: el('loginStatus'),
    settingsBox: el('settingsBox'),
    loggedAsCode: el('loggedAsCode'),
    loggedAsTeam: el('loggedAsTeam'),
    creditsLabel: el('creditsLabel'),
    creditsBadge: el('creditsBadge'),
    creditsLabelTop: el('creditsLabelTop'),
    btnLogout: el('btnLogout'),
    modelSelect: el('modelSelect'),
    btnSaveSettings: el('btnSaveSettings'),
    toolbar: el('toolbar'),
    settingsStatus: el('settingsStatus'),
    brushSize: el('brushSize'),
    brushSizeLabel: el('brushSizeLabel'),
    pageLabel: el('pageLabel'),
    prevPageBtn: el('prevPageBtn'),
    nextPageBtn: el('nextPageBtn'),
    undoBtn: el('undoBtn'),
    confirmBtn: el('confirmBtn'),
    panModeBtn: el('panModeBtn'),
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
  // (recorte pra IA / confirm-page) usa ESTE canvas, nunca o
  // reduzido - senao a pagina final perderia resolucao.
  const fullCanvas = document.createElement('canvas');
  const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });

  // margem pra imagem nunca encostar exatamente na borda do wrap
  const DISPLAY_PADDING = 24;

  // % do maior lado da area pintada, adicionado de cada lado do
  // recorte mandado pro modelo - da contexto suficiente ao redor pro
  // modelo reconstruir com coerencia, sem mandar a pagina inteira
  // (mais lento, mais memoria) quando o traco e pequeno. Valores
  // AUMENTADOS (eram 0.6/24px): traco pequeno + pouca margem vira um
  // recorte minusculo que o resize pra 512x512 amplia demais (ex: 5x+),
  // borrando a imagem ANTES do modelo ver ela - ele erra linhas finas
  // continuas (ex: contorno de montanha) por falta de pixels reais de
  // contexto, nao por falha do modelo em si.
  const CROP_PADDING_FACTOR = 0.8;
  const CROP_MIN_PADDING = 80;

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
  // login (mesmo ID/senha do TeamDrive, repassado pelo CoopIA) - sem
  // login nao da pra limpar NADA (tudo roda na nuvem do CoopIA, que
  // cobra credito por pagina confirmada). Ver index.js: auth-status/
  // auth-login/auth-setup-password.
  // ------------------------------------------------------------
  function updateCreditsLabel(credits) {
    const text = credits == null ? 'ilimitado' : String(credits);
    dom.creditsLabel.textContent = text;
    dom.creditsLabelTop.textContent = text;
    const low = typeof credits === 'number' && credits <= 10;
    dom.creditsBadge.classList.toggle('low', low);
    dom.creditsBadge.title = low
      ? 'Créditos CoopIA acabando! Assine um plano ou espere o reset semanal.'
      : 'Créditos CoopIA disponíveis (1 crédito por página confirmada)';
  }

  async function refreshCredits() {
    try {
      const me = await callStudio({ type: 'auth-status' });
      if (me.loggedIn) updateCreditsLabel(me.credits?.credits);
    } catch { /* se falhar, so nao atualiza o rotulo agora */ }
  }

  let needsSetup = false;
  dom.btnLogin.addEventListener('click', async () => {
    const code = dom.loginCode.value.trim();
    const password = dom.loginPassword.value;
    if (!code || !password) {
      dom.loginStatus.textContent = 'Preencha o ID e a senha.';
      dom.loginStatus.className = 'status error';
      return;
    }
    dom.btnLogin.disabled = true;
    dom.loginStatus.textContent = needsSetup ? 'Definindo senha...' : 'Entrando...';
    dom.loginStatus.className = 'status';
    try {
      const profile = needsSetup
        ? (await callStudio({ type: 'auth-setup-password', code, password })).profile
        : (await callStudio({ type: 'auth-login', code, password })).profile;
      await afterLogin(profile);
    } catch (err) {
      // a mensagem de erro é tudo que sobrevive à ponte postMessage até aqui (ver callStudio) -
      // "Primeiro acesso" é o texto que o TeamDrive manda quando o ID ainda não tem senha.
      if (/primeiro acesso/i.test(err.message || '')) {
        needsSetup = true;
        dom.setupHint.hidden = false;
        dom.loginStatus.textContent = 'Primeiro acesso: digite a senha que você quer usar e clique em Entrar de novo.';
        dom.loginStatus.className = 'status';
      } else {
        dom.loginStatus.textContent = err.message || 'Erro ao entrar.';
        dom.loginStatus.className = 'status error';
      }
    } finally {
      dom.btnLogin.disabled = false;
    }
  });

  dom.btnLogout.addEventListener('click', async () => {
    await callStudio({ type: 'auth-logout' });
    location.reload();
  });

  dom.btnSaveSettings.addEventListener('click', async () => {
    dom.settingsStatus.textContent = '';
    dom.settingsStatus.classList.remove('error');
    try {
      await callStudio({ type: 'save-settings', model: dom.modelSelect.value });
      dom.settingsStatus.textContent = 'Salvo!';
      setTimeout(() => { dom.settingsStatus.textContent = ''; }, 2000);
    } catch (err) {
      dom.settingsStatus.textContent = 'Erro: ' + err.message;
      dom.settingsStatus.classList.add('error');
    }
  });

  async function loadSettings() {
    const settings = await callStudio({ type: 'get-settings' });
    dom.modelSelect.value = settings.model || 'manga';
  }

  async function afterLogin(profile) {
    dom.loginScreen.hidden = true;
    dom.settingsBox.hidden = false;
    dom.loggedAsCode.textContent = profile.code;
    dom.loggedAsTeam.textContent = profile.team;
    await refreshCredits();
    await loadSettings();
    await initAfterLogin();
  }

  // ------------------------------------------------------------
  // zoom (Ctrl +/- ou Ctrl+scroll) e navegacao (segurar espaco e
  // arrastar) - zoomLevel multiplica a escala "caber na tela" (1 =
  // comportamento padrao de sempre); panX/panY sao um deslocamento em
  // PIXELS DE TELA aplicado via CSS var, sem depender de rolagem
  // nativa.
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
  // "modo mover" manual (botao ✋ na toolbar) - equivalente a segurar
  // espaco, so que via TOGGLE em vez de tecla segurada (celular nao tem
  // teclado, e o gesto de pinca com 2 dedos as vezes falha/nao
  // registra os 2 toques a tempo). Ligado, QUALQUER arraste de 1
  // ponteiro (dedo/mouse/caneta) move a pagina em vez de limpar - ver
  // startPan() abaixo.
  let manualPanMode = false;

  // ------------------------------------------------------------
  // zoom/pan com DOIS DEDOS (celular/tablet Android)
  // ------------------------------------------------------------
  const activeTouchPointers = new Map(); // pointerId -> {x, y} (coords de TELA)
  let pinchState = null; // { startDist, startZoom, startMid, startPanX, startPanY }

  function touchPointsArray() {
    return [...activeTouchPointers.values()];
  }

  function startPinch() {
    const pts = touchPointsArray();
    if (pts.length < 2) return;
    const [a, b] = pts;
    pinchState = {
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startZoom: zoomLevel,
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startPanX: panX,
      startPanY: panY,
    };
    dom.canvasWrap.classList.add('panning-active');
  }

  function updatePinch() {
    const pts = touchPointsArray();
    if (pts.length < 2 || !pinchState) return;
    const [a, b] = pts;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    setZoom(pinchState.startZoom * (dist / pinchState.startDist));
    panX = pinchState.startPanX + (mid.x - pinchState.startMid.x);
    panY = pinchState.startPanY + (mid.y - pinchState.startMid.y);
    applyPanTransform();
  }

  function stopPinch() {
    pinchState = null;
    dom.canvasWrap.classList.remove('panning-active');
  }

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

  dom.canvasWrap.addEventListener('mouseenter', () => window.focus());

  document.addEventListener('change', (e) => {
    if (e.target && e.target.tagName === 'SELECT') e.target.blur();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement && document.activeElement.tagName === 'SELECT') {
      document.activeElement.blur();
      e.preventDefault();
    }

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
      if (!manualPanMode) dom.canvasWrap.classList.remove('panning-ready', 'panning-active');
    }
  });

  dom.panModeBtn.addEventListener('click', () => {
    manualPanMode = !manualPanMode;
    dom.panModeBtn.classList.toggle('active', manualPanMode);
    dom.panModeBtn.setAttribute('aria-pressed', String(manualPanMode));
    dom.canvasWrap.classList.toggle('panning-ready', manualPanMode || spaceDown);
    if (!manualPanMode && !spaceDown) dom.canvasWrap.classList.remove('panning-active');
  });

  function startPan(evt) {
    if (!spaceDown && !manualPanMode) return false;
    isPanning = true;
    panPointerStart = { x: evt.clientX, y: evt.clientY };
    panOffsetStart = { x: panX, y: panY };
    dom.canvasWrap.classList.add('panning-active');
    try {
      dom.maskCanvas.setPointerCapture(evt.pointerId);
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

  function releasePointerCaptureSafe(evt) {
    try {
      dom.maskCanvas.releasePointerCapture(evt.pointerId);
    } catch (err) {
      // ja liberado/nao capturado - sem problema nenhum ignorar
    }
  }

  function stopPan(evt) {
    isPanning = false;
    dom.canvasWrap.classList.remove('panning-active');
    releasePointerCaptureSafe(evt);
  }

  // pilha de desfazer POR PAGINA (pageKey -> array de dataURLs "antes de
  // cada traco") - guardada por pagina aqui no painel, sobrevive a
  // trocar de pagina e voltar; "esvazia" so quando o PAINEL inteiro
  // fecha (memoria, nao arquivo).
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
    maskDataCtx.lineCap = 'round';
    maskDataCtx.lineJoin = 'round';
    maskDataCtx.lineWidth = Number(dom.brushSize.value);
    maskDataCtx.strokeStyle = 'rgba(255, 60, 60, 1)';
    maskDataCtx.beginPath();
    maskDataCtx.moveTo(lastPoint ? lastPoint.x : point.x, lastPoint ? lastPoint.y : point.y);
    maskDataCtx.lineTo(point.x, point.y);
    maskDataCtx.stroke();
    lastPoint = point;

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
    try {
      dom.maskCanvas.setPointerCapture(evt.pointerId);
    } catch (err) {
      // navegador/dispositivo sem suporte - segue sem capture, degrada
      // graciosamente pro comportamento de antes
    }

    if (evt.pointerType === 'touch') {
      activeTouchPointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
      if (activeTouchPointers.size >= 2) {
        evt.preventDefault();
        if (isDrawing) {
          isDrawing = false;
          hasStroke = false;
          lastPoint = null;
          clearStroke();
        }
        isPanning = false;
        startPinch();
        return;
      }
    }

    if (startPan(evt)) return;
    if (isProcessing || !currentPageKey()) return;
    evt.preventDefault();

    isDrawing = true;
    hasStroke = false;
    lastPoint = null;
    strokeTo(getPos(evt));
  }

  function moveDrawing(evt) {
    if (evt.pointerType === 'touch' && activeTouchPointers.has(evt.pointerId)) {
      activeTouchPointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
      if (pinchState) {
        evt.preventDefault();
        updatePinch();
        return;
      }
    }

    if (isPanning) {
      movePan(evt);
      return;
    }
    if (!isDrawing) return;
    evt.preventDefault();
    hasStroke = true;
    strokeTo(getPos(evt));
  }

  async function stopDrawing(evt) {
    if (evt.pointerType === 'touch' && activeTouchPointers.has(evt.pointerId)) {
      activeTouchPointers.delete(evt.pointerId);
      if (pinchState) {
        if (activeTouchPointers.size >= 2) startPinch();
        else stopPinch();
        return;
      }
    }

    if (isPanning) {
      stopPan(evt);
      return;
    }
    if (!isDrawing) return;
    isDrawing = false;
    lastPoint = null;
    releasePointerCaptureSafe(evt);
    if (hasStroke) await processStroke();
    else clearStroke();
    hasStroke = false;
  }

  dom.maskCanvas.addEventListener('pointerdown', startDrawing);
  dom.maskCanvas.addEventListener('pointermove', moveDrawing);
  window.addEventListener('pointerup', stopDrawing);
  window.addEventListener('pointercancel', stopDrawing);

  window.addEventListener('resize', () => {
    if (fullCanvas.width && !isDrawing) redrawDisplayFromFull();
  });

  // ------------------------------------------------------------
  // constroi a mascara binaria (preto/branco) na resolucao ORIGINAL, a
  // partir do traco desenhado no canvas reduzido - devolve um CANVAS
  // (nao dataURL: precisamos ler pixels dele com getImageData logo
  // depois, tanto pra achar a bounding box quanto pra recortar a
  // regiao mandada pro modelo).
  //
  // IMPORTANTE: binariza pelo alfa ANTES de qualquer upscale - ler o
  // alfa so DEPOIS de compor sobre um fundo opaco da errado (uma cor
  // semi-transparente sobre fundo opaco vira SEMPRE opaca, marcando a
  // pagina inteira como "pintada"). A ordem certa e ler o alfa direto
  // do canvas ORIGINAL do traco, binarizar AINDA na resolucao
  // reduzida, e so DEPOIS aumentar (ja preto/branco solido) pra
  // resolucao original.
  // ------------------------------------------------------------
  function buildFullResMaskCanvas() {
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
    const fullCtx2 = full.getContext('2d', { willReadFrequently: true });
    fullCtx2.imageSmoothingEnabled = false; // mantem preto/branco solido no upscale (sem cinza de interpolacao)
    fullCtx2.drawImage(small, 0, 0, small.width, small.height, 0, 0, full.width, full.height);

    return full;
  }

  function dataUrlToBase64(dataUrl) {
    return dataUrl.split(',')[1];
  }

  /** Roda UM traco na nuvem: cria sessao -> dispara processamento ->
   *  poll com espera CRESCENTE entre tentativas (backoff - nao adianta
   *  perguntar toda hora, so gasta radio/bateria do celular a toa). O
   *  loop mora AQUI (nao em index.js) porque setTimeout so existe num
   *  contexto de browser de verdade como este painel - o sandbox da
   *  extensao (index.js) roda isolado sem esse global. */
  async function cleanStrokeCloud(imageTensor, maskTensor) {
    const { sessionId } = await callStudio({ type: 'cloud-create-session' });
    await callStudio({ type: 'cloud-process', sessionId, imageTensor, maskTensor });

    let delay = 400;
    for (;;) {
      const outcome = await callStudio({ type: 'cloud-poll', sessionId });
      // sem outputNames no pedido, o servidor devolve o(s) output(s) com o nome REAL do modelo
      // (o LaMA não se chama "result" como o MI-GAN) - pega o 1º que vier, é sempre só um aqui.
      if (outcome.status === 'done') return Object.values(outcome.outputs)[0];
      if (outcome.status === 'error') throw new Error(outcome.message);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 3000);
    }
  }

  // ------------------------------------------------------------
  // helpers de tensor (pixels <-> { type, dims, data } que
  // studio.image.runOnnxModel espera - ver docs/extensions/image-api.md
  // no repo principal) - o LaMA (lama-manga/lama_fp32) usa layout NCHW,
  // float32, RGB normalizado 0-1 (pixel/255) pra imagem, e mascara de 1
  // canal também float32 0-1 onde 1=RECONSTRUIR/0=MANTER - o MESMO
  // sentido da máscara que este painel já desenha (branco=pintado=
  // reconstruir), então NÃO precisa inverter nada (diferente do MI-GAN,
  // que usava o sentido oposto). Os dois modelos exigem entrada FIXA em
  // 512x512 (ver LAMA_INPUT_SIZE) - o recorte (de tamanho variável) é
  // redimensionado pra 512x512 antes de mandar, e o resultado é
  // redimensionado de volta pro tamanho original do recorte ao colar.
  // ------------------------------------------------------------
  const LAMA_INPUT_SIZE = 512;

  function bytesToBase64(bytes) {
    const CHUNK_SIZE = 0x8000; // 32k - seguro pro limite de argumentos de String.fromCharCode.apply
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
    }
    return btoa(binary);
  }

  function base64ToFloat32(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }

  /** Redimensiona um ImageData pra um tamanho fixo via canvas - smoothing ligado pra imagem
   *  (interpolação suave), desligado pra máscara (equivalente a vizinho-mais-próximo, evita
   *  "borrar" a borda pintada em tons de cinza intermediários). */
  function resizeImageData(imageData, targetW, targetH, smoothing) {
    const src = document.createElement('canvas');
    src.width = imageData.width;
    src.height = imageData.height;
    src.getContext('2d').putImageData(imageData, 0, 0);
    const dst = document.createElement('canvas');
    dst.width = targetW;
    dst.height = targetH;
    const dctx = dst.getContext('2d');
    dctx.imageSmoothingEnabled = !!smoothing;
    dctx.drawImage(src, 0, 0, targetW, targetH);
    return dctx.getImageData(0, 0, targetW, targetH);
  }

  function imageDataToNchwFloat32(imageData, channels) {
    const { width, height, data } = imageData;
    const pixelCount = width * height;
    const out = new Float32Array(channels * pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      for (let c = 0; c < channels; c++) {
        out[c * pixelCount + i] = data[i * 4 + c] / 255;
      }
    }
    return out;
  }

  function maskImageDataToNchwFloat32(imageData) {
    const { width, height, data } = imageData;
    const pixelCount = width * height;
    const out = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      out[i] = data[i * 4] > 0 ? 1 : 0; // canal R: qualquer tinta ali = reconstruir ali
    }
    return out;
  }

  function nchwFloat32ToImageData(chwData, width, height, channels) {
    const pixelCount = width * height;
    const imageData = new ImageData(width, height);
    for (let i = 0; i < pixelCount; i++) {
      for (let c = 0; c < channels; c++) {
        imageData.data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(chwData[c * pixelCount + i] * 255)));
      }
      imageData.data[i * 4 + 3] = 255;
    }
    return imageData;
  }

  /** Bounding box (em pixels, resolucao ORIGINAL) da area pintada
   *  (pixels brancos) num canvas de mascara binaria - null se nada foi
   *  pintado. */
  function computeMaskBoundingBox(maskCanvasFull) {
    const ctx = maskCanvasFull.getContext('2d', { willReadFrequently: true });
    const { width, height } = maskCanvasFull;
    const { data } = ctx.getImageData(0, 0, width, height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        if (data[(rowOffset + x) * 4] > 127) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { minX, minY, maxX, maxY };
  }

  /** Regiao (crop) a mandar pro modelo: bounding box da area pintada +
   *  padding proporcional ao maior lado dela, sempre dentro dos
   *  limites da imagem - da contexto suficiente ao redor pro modelo
   *  reconstruir com coerencia, sem processar a pagina inteira toda
   *  vez (mais lento, mais memoria - critico num celular fraco). */
  function computeCropRegion(bbox, fullW, fullH) {
    const bboxW = bbox.maxX - bbox.minX + 1;
    const bboxH = bbox.maxY - bbox.minY + 1;
    const padding = Math.max(CROP_MIN_PADDING, Math.round(Math.max(bboxW, bboxH) * CROP_PADDING_FACTOR));
    const left = Math.max(0, bbox.minX - padding);
    const top = Math.max(0, bbox.minY - padding);
    const right = Math.min(fullW - 1, bbox.maxX + padding);
    const bottom = Math.min(fullH - 1, bbox.maxY + padding);
    return { left, top, width: right - left + 1, height: bottom - top + 1 };
  }

  // ------------------------------------------------------------
  // processa UM traco assim que o mouse e solto - sem passo manual de
  // "aplicar". Recorta a regiao pintada (+ contexto ao redor), monta
  // os tensores NCHW uint8 que o MI-GAN espera, manda pro modelo via
  // studio.image.runOnnxModel() (index.js so repassa) e cola o
  // resultado de volta na posicao certa.
  // ------------------------------------------------------------
  async function processStroke() {
    const beforeDataUrl = fullCanvas.toDataURL('image/png');
    const maskCanvasFull = buildFullResMaskCanvas();

    const bbox = computeMaskBoundingBox(maskCanvasFull);
    if (!bbox) {
      clearStroke();
      return;
    }
    const crop = computeCropRegion(bbox, fullCanvas.width, fullCanvas.height);

    setProcessing(true);
    setStatus('Limpando no CoopIA (pode levar alguns segundos)...');

    try {
      const imageRegion = fullCtx.getImageData(crop.left, crop.top, crop.width, crop.height);
      const maskCtxFull = maskCanvasFull.getContext('2d', { willReadFrequently: true });
      const maskRegion = maskCtxFull.getImageData(crop.left, crop.top, crop.width, crop.height);

      // o LaMA exige entrada FIXA 512x512 - redimensiona o recorte (tamanho variável) pra isso
      // antes de montar os tensores; o resultado volta do mesmo jeito (512x512) e é
      // redimensionado de volta pro tamanho do recorte original antes de colar na página.
      const imageResized = resizeImageData(imageRegion, LAMA_INPUT_SIZE, LAMA_INPUT_SIZE, true);
      const maskResized = resizeImageData(maskRegion, LAMA_INPUT_SIZE, LAMA_INPUT_SIZE, false);

      const imageTensor = {
        type: 'float32',
        dims: [1, 3, LAMA_INPUT_SIZE, LAMA_INPUT_SIZE],
        data: bytesToBase64(new Uint8Array(imageDataToNchwFloat32(imageResized, 3).buffer)),
      };
      const maskTensor = {
        type: 'float32',
        dims: [1, 1, LAMA_INPUT_SIZE, LAMA_INPUT_SIZE],
        data: bytesToBase64(new Uint8Array(maskImageDataToNchwFloat32(maskResized).buffer)),
      };

      const result = await cleanStrokeCloud(imageTensor, maskTensor);
      const [, resultChannels, resultH, resultW] = result.dims;
      const resultImageData512 = nchwFloat32ToImageData(base64ToFloat32(result.data), resultW, resultH, resultChannels);
      const resultImageData = resizeImageData(resultImageData512, crop.width, crop.height, true);

      getUndoStack(currentPageKey()).push(beforeDataUrl);
      fullCtx.putImageData(resultImageData, crop.left, crop.top);
      redrawDisplayFromFull();
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
      const result = await callStudio({
        type: 'confirm-page',
        pageKey: currentPageKey(),
        imageBase64: dataUrlToBase64(fullCanvas.toDataURL('image/png')),
      });
      updateCreditsLabel(result.credits);
      pageList[pageIndex] = { ...pageList[pageIndex], hasPageImage: true };

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
  // navegacao livre entre TODAS as paginas editaveis
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

    if (leavingStack.length) {
      setProcessing(true);
      setStatus('Salvando página automaticamente...');
      try {
        const result = await callStudio({
          type: 'confirm-page',
          pageKey: leavingKey,
          imageBase64: dataUrlToBase64(fullCanvas.toDataURL('image/png')),
        });
        updateCreditsLabel(result.credits);
        const leavingIndex = pageList.findIndex((p) => p.key === leavingKey);
        if (leavingIndex >= 0) pageList[leavingIndex] = { ...pageList[leavingIndex], hasPageImage: true };
      } catch (err) {
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
  // carregamento inicial (SO depois de logado): lista todas as paginas
  // editaveis (com raw e/ou pages) e abre na primeira PENDENTE (sem
  // "pages" ainda); se nao houver nenhuma pendente, abre na primeira
  // mesmo (revisao).
  // ------------------------------------------------------------
  async function initAfterLogin() {
    dom.toolbar.hidden = false;
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

  // ------------------------------------------------------------
  // ponto de entrada: so pula a tela de login se ja houver uma sessao
  // do CoopIA valida guardada (ver studio.settings em index.js).
  // ------------------------------------------------------------
  (async function start() {
    const status = await callStudio({ type: 'auth-status' });
    if (status.loggedIn) await afterLogin(status.profile);
  })();
})();
