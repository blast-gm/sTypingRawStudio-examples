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
    targetLang: el('targetLang'),
    cloudOcr: el('cloudOcr'),
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

  // pagina que o PAINEL esta mostrando/editando agora - independente
  // da pagina exibida no editor principal por tras dele
  let currentPageKey = null;
  let pageKeys = [];
  let currentState = null;
  let settings = { targetLang: 'en', cloudOcr: false };

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

  /** Renderiza o roteiro no formato de blocos/caixas do .traw (igual o
   *  painel "Roteiro da página" do editor principal). */
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
    dom.cloudOcr.checked = Boolean(settings.cloudOcr);
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

  dom.btnSaveSettings.addEventListener('click', async () => {
    dom.settingsStatus.textContent = '';
    dom.settingsStatus.classList.remove('error');
    try {
      await callStudio({ type: 'save-settings', targetLang: dom.targetLang.value, cloudOcr: dom.cloudOcr.checked });
      settings = { targetLang: dom.targetLang.value.trim() || 'en', cloudOcr: dom.cloudOcr.checked };
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

  /** Modo nuvem opcional (ver index.js): cria sessão -> dispara
   *  detecção+OCR -> poll com espera CRESCENTE entre tentativas. O
   *  loop mora aqui (e não em index.js) porque setTimeout só existe
   *  num contexto de browser de verdade como este painel - o sandbox
   *  da extensão roda isolado sem esse global. O servidor só devolve
   *  o texto ORIGINAL lido da imagem (nunca traduzido) - a tradução
   *  de verdade acontece depois, localmente, via tradutor gratuito
   *  (ver 'translate-lines' em index.js), mesmo caminho sem IA de
   *  sempre. */
  async function detectAndTranslateViaCloud(imageBase64, targetLang) {
    const { sessionId } = await callStudio({ type: 'cloud-create-session' });
    await callStudio({ type: 'cloud-process', sessionId, imageBase64 });

    let delay = 500;
    let originalLines;
    for (;;) {
      const outcome = await callStudio({ type: 'cloud-poll', sessionId });
      if (outcome.status === 'done') { originalLines = outcome.lines || []; break; }
      if (outcome.status === 'error') throw new Error(outcome.message || 'Falha na nuvem.');
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 4000);
    }
    if (!originalLines.length) return [];
    const { draft } = await callStudio({ type: 'translate-lines', lines: originalLines, targetLang });
    return draft;
  }

  dom.btnTranslate.addEventListener('click', async () => {
    if (!currentPageKey) return;
    setBusy(true);
    try {
      // caminho rapido (padrao, sem IA nenhuma): traduz o roteiro ja
      // existente via tradutor gratuito - so cai pro modo nuvem
      // (opcional) se a pagina nao tiver NENHUM roteiro ainda e a
      // pessoa tiver ativado isso explicitamente nas configuracoes.
      const hasScript = currentState && currentState.script && currentState.script.length;
      if (!hasScript && settings.cloudOcr && currentState && currentState.imageBase64) {
        setMainStatus('Detectando texto na nuvem (pode levar alguns segundos)...');
        const lines = await detectAndTranslateViaCloud(currentState.imageBase64, settings.targetLang);
        dom.draftView.value = linesToText(lines);
        await callStudio({ type: 'save-draft', pageKey: currentPageKey, lines });
        setMainStatus('Rascunho gerado via nuvem (detecção + leitura de texto) e salvo.');
      } else {
        setMainStatus('Traduzindo...');
        const result = await callStudio({ type: 'run-translate', pageKey: currentPageKey });
        dom.draftView.value = linesToText(result.draft);
        setMainStatus('Rascunho gerado via tradutor gratuito e salvo.');
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

  // "Testar rascunho": so uma PREVIA local, sem chamar nada nem gravar
  // - renderiza o rascunho no formato de blocos/caixas do roteiro.
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
