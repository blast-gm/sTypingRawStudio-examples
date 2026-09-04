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
    btnReload: el('btnReload'),
    scriptView: el('scriptView'),
    draftView: el('draftView'),
    btnTranslate: el('btnTranslate'),
    btnSaveDraft: el('btnSaveDraft'),
    btnConfirm: el('btnConfirm'),
    mainStatus: el('mainStatus'),
  };

  let currentPageKey = null;

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

  function setButtonsEnabled(enabled) {
    dom.btnTranslate.disabled = !enabled;
    dom.btnSaveDraft.disabled = !enabled;
    dom.btnConfirm.disabled = !enabled;
    dom.btnReload.disabled = !enabled;
  }

  async function loadSettings() {
    const settings = await callStudio({ type: 'get-settings' });
    dom.geminiApiKey.value = settings.geminiApiKey || '';
    dom.targetLang.value = settings.targetLang || 'en';
    dom.geminiModel.value = settings.geminiModel || '';
  }

  async function loadPage() {
    setMainStatus('Carregando página atual...');
    setButtonsEnabled(false);
    try {
      const state = await callStudio({ type: 'get-page-state' });
      currentPageKey = state.pageKey;
      dom.pageLabel.textContent = `Página: ${state.pageKey}`;
      dom.scriptView.value = linesToText(state.script);
      dom.draftView.value = linesToText(state.draft);
      setMainStatus('');
    } catch (err) {
      currentPageKey = null;
      dom.pageLabel.textContent = 'Página: -';
      setMainStatus('Erro: ' + err.message, true);
    } finally {
      setButtonsEnabled(true);
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

  dom.btnReload.addEventListener('click', loadPage);

  dom.btnTranslate.addEventListener('click', async () => {
    if (!currentPageKey) return;
    setButtonsEnabled(false);
    setMainStatus('Traduzindo...');
    try {
      const result = await callStudio({ type: 'run-detection' });
      dom.draftView.value = linesToText(result.draft);
      const modeLabel = result.usedMode === 'gemini' ? 'via Gemini (imagem)' : 'via tradutor gratuito (roteiro existente)';
      setMainStatus(`Rascunho gerado ${modeLabel} e salvo.`);
    } catch (err) {
      setMainStatus('Erro: ' + err.message, true);
    } finally {
      setButtonsEnabled(true);
    }
  });

  dom.btnSaveDraft.addEventListener('click', async () => {
    if (!currentPageKey) return;
    setButtonsEnabled(false);
    setMainStatus('Salvando rascunho...');
    try {
      await callStudio({ type: 'save-draft', pageKey: currentPageKey, lines: textToLines(dom.draftView.value) });
      setMainStatus('Rascunho salvo.');
    } catch (err) {
      setMainStatus('Erro: ' + err.message, true);
    } finally {
      setButtonsEnabled(true);
    }
  });

  dom.btnConfirm.addEventListener('click', async () => {
    if (!currentPageKey) return;
    setButtonsEnabled(false);
    setMainStatus('Aplicando no roteiro...');
    try {
      const lines = textToLines(dom.draftView.value);
      await callStudio({ type: 'confirm', pageKey: currentPageKey, lines });
      dom.scriptView.value = linesToText(lines);
      setMainStatus('Confirmado! O roteiro oficial desta página foi atualizado.');
    } catch (err) {
      setMainStatus('Erro: ' + err.message, true);
    } finally {
      setButtonsEnabled(true);
    }
  });

  (async function init() {
    await loadSettings();
    await loadPage();
  })();
})();
