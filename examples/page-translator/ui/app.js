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
    geminiApiKey: el('geminiApiKey'),
    targetLang: el('targetLang'),
    geminiModel: el('geminiModel'),
    readingDirection: el('readingDirection'),
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

  // pagina que o PAINEL esta mostrando/editando agora - independente da
  // pagina exibida no editor principal por tras dele, pra dar pra
  // avancar/voltar sem precisar sair da tela da extensao
  let currentPageKey = null;
  let pageKeys = [];

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

  /** Renderiza o roteiro no MESMO formato visual do painel "Roteiro da
   *  página" do editor principal: cada linha do .traw vira uma fileira
   *  (.script-row), e cada parte separada por "/" dentro da linha vira
   *  uma caixa (.script-chip) editável dentro dela - assim a pessoa ve
   *  exatamente como o texto vai ficar em blocos, no padrao do .traw,
   *  em vez de uma barra de texto crua. */
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

    // auto-ajusta a altura de cada caixa ao texto (pode ter varias
    // linhas, como no exemplo de referencia) - so depois de montado no
    // DOM, senao scrollHeight ainda nao reflete o layout final
    requestAnimationFrame(() => {
      dom.scriptView.querySelectorAll('.script-chip').forEach(autoResizeChip);
    });
  }

  /** Le de volta o roteiro editado nas caixas - cada fileira vira uma
   *  linha do .traw, com as partes rejuntadas por " / ". */
  function readScriptChips() {
    const rows = Array.from(dom.scriptView.querySelectorAll('.script-row'));
    return rows
      .map((row) => Array.from(row.querySelectorAll('.script-chip')).map((chip) => chip.value.trim()).filter(Boolean).join(' / '))
      .filter((line) => line.trim());
  }

  // tamanho da previa: 2.7x o tanto que caberia inteiro sem precisar
  // rolar (pedidos explicitos em sequencia: 80% maior, depois mais 50%
  // maior ainda em cima disso - o "cabe sem rolar" original ficou
  // pequeno demais pra ser util) - pode pedir rolagem vertical a
  // vontade, a unica coisa que NUNCA pode e passar da largura
  // disponivel (nunca encostar nas laterais).
  const PREVIEW_ZOOM = 1.8 * 1.5;

  function fitPreviewImage() {
    const img = dom.pagePreviewImg;
    if (!img.naturalWidth || !img.naturalHeight) return;

    const wrapRect = dom.pagePreviewWrap.getBoundingClientRect();
    const availableW = wrapRect.width;
    // offsetTop (nao getBoundingClientRect) porque nao depende da
    // posicao de rolagem atual - da a altura disponivel COMO SE a
    // pagina estivesse no topo, so pra calcular o tamanho BASE que
    // depois e ampliado em 80%
    const availableH = Math.max(80, window.innerHeight - dom.pagePreviewWrap.offsetTop - 18);
    const fitScale = Math.min(availableW / img.naturalWidth, availableH / img.naturalHeight, 1);
    const maxWidthScale = availableW / img.naturalWidth; // teto - nunca estoura os lados
    const scale = Math.min(fitScale * PREVIEW_ZOOM, maxWidthScale);
    img.style.width = `${Math.round(img.naturalWidth * scale)}px`;
    img.style.height = 'auto';
  }

  window.addEventListener('resize', fitPreviewImage);

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
    const settings = await callStudio({ type: 'get-settings' });
    dom.geminiApiKey.value = settings.geminiApiKey || '';
    dom.targetLang.value = settings.targetLang || 'en';
    dom.geminiModel.value = settings.geminiModel || '';
    dom.readingDirection.value = settings.readingDirection === 'rtl' ? 'rtl' : 'ltr';
  }

  /** Carrega o estado de uma pagina no painel. `pageKey` omitido = usa a
   *  pagina atual do editor (so na primeira carga); informado = navega
   *  o painel pra essa pagina especifica (botoes Anterior/Próxima). */
  async function loadPage(pageKey) {
    setMainStatus('Carregando página...');
    setBusy(true);
    try {
      const state = await callStudio({ type: 'get-page-state', pageKey });
      currentPageKey = state.pageKey;
      pageKeys = state.pageKeys || [];
      dom.pageLabel.textContent = `Página: ${state.pageKey}`;
      renderScriptChips(state.script);
      dom.draftView.value = linesToText(state.draft);
      if (state.imageBase64) {
        dom.pagePreviewImg.onload = fitPreviewImage;
        dom.pagePreviewImg.src = `data:image/png;base64,${state.imageBase64}`;
        dom.pagePreviewWrap.hidden = false;
      } else {
        dom.pagePreviewImg.onload = null;
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

  dom.btnSaveSettings.addEventListener('click', async () => {
    dom.settingsStatus.textContent = '';
    dom.settingsStatus.classList.remove('error');
    try {
      await callStudio({
        type: 'save-settings',
        geminiApiKey: dom.geminiApiKey.value,
        targetLang: dom.targetLang.value,
        geminiModel: dom.geminiModel.value,
        readingDirection: dom.readingDirection.value,
      });
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

  dom.btnTranslate.addEventListener('click', async () => {
    if (!currentPageKey) return;
    setBusy(true);
    setMainStatus('Traduzindo...');
    try {
      const result = await callStudio({ type: 'run-detection', pageKey: currentPageKey });
      dom.draftView.value = linesToText(result.draft);
      const modeLabel = result.usedMode === 'gemini' ? 'via Gemini (imagem)' : 'via tradutor gratuito (roteiro existente)';
      setMainStatus(`Rascunho gerado ${modeLabel} e salvo.`);
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

  // "Testar rascunho": so uma PREVIA local, sem chamar a API nem gravar
  // nada - renderiza o rascunho no formato de blocos/caixas do roteiro
  // (uma fileira por linha do rascunho), pra pessoa ver exatamente como
  // vai ficar antes de decidir usar "Salvar roteiro".
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
