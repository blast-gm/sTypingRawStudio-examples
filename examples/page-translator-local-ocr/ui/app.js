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
  // manga-ocr - roda aqui no painel (não em index.js) porque precisa
  // de um <canvas> de verdade pra redimensionar/ler pixel da imagem -
  // o sandbox da extensão (index.js) não tem isso, só os globals
  // padrão de JS (ver docs/extensions/image-api.md, "runOnnxModel").
  // Tokens especiais e geração GREEDY: mesma lógica/valores de
  // packages/translate-ai-cloud/src/mangaOcr.js (a versão que roda na
  // nuvem pro Mobile) - mantida idêntica de propósito, pra calibrar
  // aqui e portar com confiança.
  // ------------------------------------------------------------
  const MANGA_OCR_IMAGE_SIZE = 224;
  const MANGA_OCR_DECODER_START_TOKEN_ID = 2; // [CLS]
  const MANGA_OCR_EOS_TOKEN_ID = 3; // [SEP]
  const MANGA_OCR_MAX_NEW_TOKENS = 128;

  function uint8ToBase64(bytes) {
    const CHUNK_SIZE = 0x8000; // 32k - limite seguro de String.fromCharCode.apply
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
    }
    return btoa(binary);
  }

  function base64ToFloat32Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }

  /** Carrega o PNG (base64) num <canvas>, redimensiona pra 224x224
   *  SEM preservar proporção (squish - mesmo comportamento do
   *  ViTImageProcessor com "size" fixo em altura+largura que o
   *  manga-ocr foi treinado) e devolve o tensor NCHW float32
   *  [1,3,224,224] normalizado (pixel/255 - 0.5)/0.5, já serializado
   *  no formato {type,dims,data} que studio.image.runOnnxModel espera. */
  function imageToPixelTensor(base64Png) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = MANGA_OCR_IMAGE_SIZE;
        canvas.height = MANGA_OCR_IMAGE_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, MANGA_OCR_IMAGE_SIZE, MANGA_OCR_IMAGE_SIZE);
        ctx.drawImage(img, 0, 0, MANGA_OCR_IMAGE_SIZE, MANGA_OCR_IMAGE_SIZE);
        const { data } = ctx.getImageData(0, 0, MANGA_OCR_IMAGE_SIZE, MANGA_OCR_IMAGE_SIZE); // RGBA uint8
        const pixelCount = MANGA_OCR_IMAGE_SIZE * MANGA_OCR_IMAGE_SIZE;
        const chw = new Float32Array(pixelCount * 3);
        for (let i = 0; i < pixelCount; i++) {
          for (let c = 0; c < 3; c++) {
            chw[c * pixelCount + i] = (data[i * 4 + c] / 255 - 0.5) / 0.5;
          }
        }
        const bytes = new Uint8Array(chw.buffer);
        resolve({ type: 'float32', dims: [1, 3, MANGA_OCR_IMAGE_SIZE, MANGA_OCR_IMAGE_SIZE], data: uint8ToBase64(bytes) });
      };
      img.onerror = () => reject(new Error('Não consegui carregar o recorte da região no <canvas>.'));
      img.src = 'data:image/png;base64,' + base64Png;
    });
  }

  /** Gera o texto caractere a caractere (greedy) a partir do
   *  last_hidden_state do encoder - um .run-decoder por token, até
   *  achar [SEP] ou bater o teto de segurança. Decoder SEM KV-cache
   *  (ver mangaOcr.js na nuvem) - cada passo manda a sequência INTEIRA
   *  gerada até agora, de novo; balão de mangá é texto curto, não pesa
   *  na prática. */
  async function greedyDecode(encoderHiddenStates) {
    const tokenIds = [MANGA_OCR_DECODER_START_TOKEN_ID];

    for (let step = 0; step < MANGA_OCR_MAX_NEW_TOKENS; step++) {
      const inputIds = { type: 'int64', dims: [1, tokenIds.length], data: tokenIds.map(String) };
      const { logits } = await callStudio({ type: 'run-decoder', inputIds, encoderHiddenStates });
      const vocabSize = logits.dims[2];
      const floatData = base64ToFloat32Array(logits.data);
      const lastStepOffset = (tokenIds.length - 1) * vocabSize;

      let bestId = 0;
      let bestScore = -Infinity;
      for (let v = 0; v < vocabSize; v++) {
        const score = floatData[lastStepOffset + v];
        if (score > bestScore) {
          bestScore = score;
          bestId = v;
        }
      }

      if (bestId === MANGA_OCR_EOS_TOKEN_ID) break;
      tokenIds.push(bestId);
    }

    return tokenIds.slice(1); // tira o [CLS] inicial do começo
  }

  /** Lê o texto de UM recorte de balão (base64 PNG) via manga-ocr -
   *  encoder (uma vez) + decode greedy (vários passos, ver acima). */
  async function readTextFromCrop(cropBase64) {
    const pixelValues = await imageToPixelTensor(cropBase64);
    const { lastHiddenState } = await callStudio({ type: 'run-encoder', pixelValues });
    const tokenIds = await greedyDecode(lastHiddenState);
    const vocab = window.MANGA_OCR_VOCAB || [];
    return tokenIds
      .map((id) => vocab[id] || '')
      .join('')
      .trim();
  }

  // ------------------------------------------------------------
  // resto do painel - mesmo padrão visual/fluxo do Page Translator
  // Mobile (rascunho/roteiro em blocos, navegação entre páginas)
  // ------------------------------------------------------------
  const el = (id) => document.getElementById(id);
  const dom = {
    targetLang: el('targetLang'),
    readingDirection: el('readingDirection'),
    confidence: el('confidence'),
    confidenceLabel: el('confidenceLabel'),
    btnSaveSettings: el('btnSaveSettings'),
    settingsStatus: el('settingsStatus'),
    pageLabel: el('pageLabel'),
    btnPrevPage: el('btnPrevPage'),
    btnNextPage: el('btnNextPage'),
    btnReload: el('btnReload'),
    scriptView: el('scriptView'),
    draftView: el('draftView'),
    btnTranslate: el('btnTranslate'),
    btnSaveDraft: el('btnSaveDraft'),
    btnTestDraft: el('btnTestDraft'),
    btnSaveScript: el('btnSaveScript'),
    mainStatus: el('mainStatus'),
    pagePreviewWrap: el('pagePreviewWrap'),
    pagePreviewImg: el('pagePreviewImg'),
  };

  let currentPageKey = null;
  let pageKeys = [];
  let currentState = null;
  let settings = { targetLang: 'en', readingDirection: 'ltr', confidence: 0.5 };

  function linesToText(lines) {
    return (lines || []).join('\n');
  }

  function textToLines(text) {
    return text.split('\n').map((l) => l.trim()).filter((l) => l);
  }

  function autoResizeChip(chip) {
    chip.style.height = 'auto';
    chip.style.height = chip.scrollHeight + 'px';
  }

  function renderScriptChips(lines) {
    dom.scriptView.innerHTML = '';
    const nonEmpty = (lines || []).filter((l) => l && l.trim());

    if (!nonEmpty.length) {
      const empty = document.createElement('div');
      empty.className = 'script-empty';
      empty.textContent = '(sem roteiro ainda nesta página)';
      dom.scriptView.appendChild(empty);
      return;
    }

    nonEmpty.forEach((line) => {
      const parts = line.split('/').map((p) => p.trim()).filter(Boolean);
      const row = document.createElement('div');
      row.className = 'script-row';
      (parts.length ? parts : ['']).forEach((part) => {
        const chip = document.createElement('textarea');
        chip.className = 'script-chip';
        chip.rows = 1;
        chip.value = part;
        chip.addEventListener('input', () => autoResizeChip(chip));
        row.appendChild(chip);
      });
      dom.scriptView.appendChild(row);
    });

    requestAnimationFrame(() => {
      dom.scriptView.querySelectorAll('.script-chip').forEach(autoResizeChip);
    });
  }

  function readScriptChips() {
    const rows = Array.from(dom.scriptView.querySelectorAll('.script-row'));
    return rows
      .map((row) => Array.from(row.querySelectorAll('.script-chip')).map((chip) => chip.value.trim()).filter(Boolean).join(' / '))
      .filter((line) => line.trim());
  }

  function setMainStatus(text, isError) {
    dom.mainStatus.textContent = text;
    dom.mainStatus.classList.toggle('error', Boolean(isError));
  }

  function setBusy(busy) {
    dom.btnTranslate.disabled = busy;
    dom.btnSaveDraft.disabled = busy;
    dom.btnTestDraft.disabled = busy;
    dom.btnSaveScript.disabled = busy;
    dom.btnReload.disabled = busy;
    updateNavButtons(busy);
  }

  function updateNavButtons(forceDisabled) {
    const idx = pageKeys.indexOf(currentPageKey);
    dom.btnPrevPage.disabled = Boolean(forceDisabled) || idx <= 0;
    dom.btnNextPage.disabled = Boolean(forceDisabled) || idx === -1 || idx >= pageKeys.length - 1;
  }

  async function loadSettings() {
    settings = await callStudio({ type: 'get-settings' });
    dom.targetLang.value = settings.targetLang || 'en';
    dom.readingDirection.value = settings.readingDirection === 'rtl' ? 'rtl' : 'ltr';
    dom.confidence.value = settings.confidence || 0.5;
    dom.confidenceLabel.textContent = (settings.confidence || 0.5).toFixed(2);
  }

  async function loadPage(pageKey) {
    setMainStatus('Carregando página...');
    setBusy(true);
    try {
      const state = await callStudio({ type: 'get-page-state', pageKey });
      currentState = state;
      currentPageKey = state.pageKey;
      pageKeys = state.pageKeys || [];
      dom.pageLabel.textContent = `Página: ${state.pageKey}`;
      renderScriptChips(state.script);
      dom.draftView.value = linesToText(state.draft);
      if (state.imageBase64) {
        dom.pagePreviewImg.src = `data:image/png;base64,${state.imageBase64}`;
        dom.pagePreviewWrap.hidden = false;
      } else {
        dom.pagePreviewImg.src = '';
        dom.pagePreviewWrap.hidden = true;
      }
      setMainStatus('');
    } catch (err) {
      setMainStatus('Erro: ' + err.message, true);
    } finally {
      setBusy(false);
    }
  }

  dom.confidence.addEventListener('input', () => {
    dom.confidenceLabel.textContent = Number(dom.confidence.value).toFixed(2);
  });

  dom.btnSaveSettings.addEventListener('click', async () => {
    dom.settingsStatus.textContent = '';
    dom.settingsStatus.classList.remove('error');
    try {
      await callStudio({
        type: 'save-settings',
        targetLang: dom.targetLang.value,
        readingDirection: dom.readingDirection.value,
        confidence: dom.confidence.value,
      });
      settings = {
        targetLang: dom.targetLang.value.trim() || 'en',
        readingDirection: dom.readingDirection.value === 'rtl' ? 'rtl' : 'ltr',
        confidence: Number(dom.confidence.value) || 0.5,
      };
      dom.settingsStatus.textContent = 'Salvo!';
      setTimeout(() => { dom.settingsStatus.textContent = ''; }, 2000);
    } catch (err) {
      dom.settingsStatus.textContent = 'Erro: ' + err.message;
      dom.settingsStatus.classList.add('error');
    }
  });

  dom.btnReload.addEventListener('click', () => loadPage(currentPageKey));

  dom.btnPrevPage.addEventListener('click', () => {
    const idx = pageKeys.indexOf(currentPageKey);
    if (idx > 0) loadPage(pageKeys[idx - 1]);
  });

  dom.btnNextPage.addEventListener('click', () => {
    const idx = pageKeys.indexOf(currentPageKey);
    if (idx !== -1 && idx < pageKeys.length - 1) loadPage(pageKeys[idx + 1]);
  });

  /** Caminho OCR local: detecta regiões (index.js, local) -> lê cada
   *  recorte com manga-ocr (aqui, local) -> traduz o que saiu (index.js,
   *  tradutor gratuito, local). Nenhum passo toca rede. */
  async function detectAndTranslateLocally(pageKey, targetLang) {
    const { crops } = await callStudio({ type: 'detect-regions', pageKey });
    if (!crops.length) return [];

    const originalLines = [];
    for (let i = 0; i < crops.length; i++) {
      setMainStatus(`Lendo balão ${i + 1}/${crops.length} (OCR local)...`);
      const text = await readTextFromCrop(crops[i].cropBase64);
      if (text) originalLines.push(text);
    }
    if (!originalLines.length) return [];

    setMainStatus('Traduzindo...');
    const { draft } = await callStudio({ type: 'translate-lines', lines: originalLines, targetLang });
    return draft;
  }

  dom.btnTranslate.addEventListener('click', async () => {
    if (!currentPageKey) return;
    setBusy(true);
    try {
      const hasScript = currentState && currentState.script && currentState.script.length;
      if (hasScript) {
        setMainStatus('Traduzindo...');
        const result = await callStudio({ type: 'run-translate', pageKey: currentPageKey });
        dom.draftView.value = linesToText(result.draft);
        setMainStatus('Rascunho gerado via tradutor gratuito e salvo.');
      } else if (currentState && currentState.imageBase64) {
        setMainStatus('Detectando balões...');
        const lines = await detectAndTranslateLocally(currentPageKey, settings.targetLang);
        dom.draftView.value = linesToText(lines);
        await callStudio({ type: 'save-draft', pageKey: currentPageKey, lines });
        setMainStatus(`Rascunho gerado via OCR local (manga-ocr) e salvo - ${lines.length} linha(s).`);
      } else {
        setMainStatus('Esta página não tem roteiro nem imagem nenhuma - nada pra traduzir.', true);
      }
    } catch (err) {
      setMainStatus('Erro: ' + err.message, true);
    } finally {
      setBusy(false);
    }
  });

  dom.btnSaveDraft.addEventListener('click', async () => {
    if (!currentPageKey) return;
    setBusy(true);
    setMainStatus('Salvando rascunho...');
    try {
      await callStudio({ type: 'save-draft', pageKey: currentPageKey, lines: textToLines(dom.draftView.value) });
      setMainStatus('Rascunho salvo.');
    } catch (err) {
      setMainStatus('Erro: ' + err.message, true);
    } finally {
      setBusy(false);
    }
  });

  dom.btnTestDraft.addEventListener('click', () => {
    renderScriptChips(textToLines(dom.draftView.value));
    setMainStatus('Prévia aplicada na caixa do roteiro - nada foi salvo ainda.');
  });

  dom.btnSaveScript.addEventListener('click', async () => {
    if (!currentPageKey) return;
    setBusy(true);
    setMainStatus('Salvando roteiro...');
    try {
      const lines = readScriptChips();
      await callStudio({ type: 'confirm', pageKey: currentPageKey, lines });
      renderScriptChips(lines);
      setMainStatus('Roteiro salvo e aplicado na página.');
    } catch (err) {
      setMainStatus('Erro: ' + err.message, true);
    } finally {
      setBusy(false);
    }
  });

  (async function init() {
    await loadSettings();
    await loadPage();
  })();
})();
