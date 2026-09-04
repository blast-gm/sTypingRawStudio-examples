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
    btnSaveScript: el('btnSaveScript'),
    mainStatus: el('mainStatus'),
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

  function setMainStatus(text, isError) {
    dom.mainStatus.textContent = text;
    dom.mainStatus.classList.toggle('error', Boolean(isError));
  }

  function setBusy(busy) {
    dom.btnTranslate.disabled = busy;
    dom.btnSaveDraft.disabled = busy;
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
      dom.scriptView.value = linesToText(state.script);
      dom.draftView.value = linesToText(state.draft);
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

  dom.btnSaveScript.addEventListener('click', async () => {
    if (!currentPageKey) return;
    setBusy(true);
    setMainStatus('Salvando roteiro...');
    try {
      const lines = textToLines(dom.scriptView.value);
      await callStudio({ type: 'confirm', pageKey: currentPageKey, lines });
      dom.scriptView.value = linesToText(lines);
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
