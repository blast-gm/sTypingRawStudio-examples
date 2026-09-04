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
    btnSave: el('btnSave'),
    status: el('status'),
  };

  async function load() {
    const settings = await callStudio({ type: 'get-settings' });
    dom.geminiApiKey.value = settings.geminiApiKey || '';
    dom.targetLang.value = settings.targetLang || 'en';
    dom.geminiModel.value = settings.geminiModel || '';
  }

  dom.btnSave.addEventListener('click', async () => {
    dom.status.textContent = '';
    try {
      await callStudio({
        type: 'save-settings',
        geminiApiKey: dom.geminiApiKey.value,
        targetLang: dom.targetLang.value,
        geminiModel: dom.geminiModel.value,
      });
      dom.status.textContent = 'Salvo!';
      setTimeout(() => { dom.status.textContent = ''; }, 2000);
    } catch (err) {
      dom.status.textContent = 'Erro: ' + err.message;
      dom.status.style.color = '#ff5a5a';
    }
  });

  load();
})();
