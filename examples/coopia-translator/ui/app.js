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
    btnLogout: el('btnLogout'),
    appBody: el('appBody'),
    targetLang: el('targetLang'),
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

  function linesToText(lines) { return (lines || []).join('\n'); }
  function textToLines(text) { return text.split('\n').map((l) => l.trim()).filter((l) => l); }

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

  function updateCreditsLabel(credits) {
    dom.creditsLabel.textContent = credits == null ? 'ilimitado' : String(credits);
  }

  async function refreshCredits() {
    try {
      const me = await callStudio({ type: 'auth-status' });
      if (me.loggedIn) updateCreditsLabel(me.credits?.credits);
    } catch { /* so nao atualiza agora */ }
  }

  async function loadSettings() {
    const settings = await callStudio({ type: 'get-settings' });
    dom.targetLang.value = settings.targetLang || 'en';
  }

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
      await callStudio({ type: 'save-settings', targetLang: dom.targetLang.value });
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
    setMainStatus('Traduzindo no CoopIA...');
    try {
      const result = await callStudio({ type: 'run-detection', pageKey: currentPageKey });
      dom.draftView.value = linesToText(result.draft);
      updateCreditsLabel(result.credits);
      setMainStatus('Rascunho traduzido e salvo.');
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

  // ------------------------------------------------------------
  // login (mesmo ID/senha do TeamDrive, repassado pelo CoopIA)
  // ------------------------------------------------------------
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

  async function afterLogin(profile) {
    dom.loginScreen.hidden = true;
    dom.settingsBox.hidden = false;
    dom.appBody.hidden = false;
    dom.loggedAsCode.textContent = profile.code;
    dom.loggedAsTeam.textContent = profile.team;
    await refreshCredits();
    await loadSettings();
    await loadPage();
  }

  (async function start() {
    const status = await callStudio({ type: 'auth-status' });
    if (status.loggedIn) await afterLogin(status.profile);
  })();
})();
