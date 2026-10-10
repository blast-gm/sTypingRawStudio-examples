/**
 * Page Translator (OCR local) - versão de TESTE (desktop) pensada pra
 * calibrar, com iteração rápida, o pipeline de "ler texto de mangá sem
 * IA de terceiros" ANTES de portar pro Mobile (onde a mesma lógica
 * roda na nuvem, ver examples/page-translator-mobile +
 * packages/translate-ai-cloud no repo principal) - testar aqui no
 * desktop é muito mais rápido que fazer deploy numa VPS toda vez.
 *
 * NUNCA usa Gemini nem qualquer IA generativa de terceiros, e NUNCA
 * toca rede (sem permissão "network" nem "ai" no extension.json) -
 * tudo roda 100% local, com os mesmos dois modelos abertos usados pela
 * nuvem:
 *
 * - Detecção de balão/texto: RT-DETRv2 local (models/detector.onnx,
 *   mesmo modelo do Page Translator original) via
 *   studio.image.detectText.
 * - Leitura de texto (OCR): manga-ocr (models/manga-ocr/*.onnx,
 *   kha-white/manga-ocr-base) - modelo especializado em letreiramento
 *   de mangá, MUITO melhor que OCR de documento genérico (Tesseract)
 *   pra esse tipo de fonte. Via studio.image.runOnnxModel - esta
 *   função só MONTA os tensores certos e orquestra; o trabalho pesado
 *   de pixel (redimensionar/normalizar a imagem, decodificar os
 *   tokens gerados) roda no PAINEL (ui/app.js), que tem um <canvas>
 *   de verdade disponível - mesmo padrão do Smart Cleaner Mobile
 *   (buildMiganFeeds em ui/app.js de lá).
 * - Tradução: sempre local, via studio.translate.free (sem chave, sem
 *   IA) - a leitura (OCR) e a tradução são etapas INDEPENDENTES; o
 *   manga-ocr só lê o texto original, nunca traduz nada.
 */
module.exports = function (studio) {
  const DETECTOR_MODEL_PATH = 'models/detector.onnx';
  const ENCODER_MODEL_PATH = 'models/manga-ocr/encoder_model.onnx';
  const DECODER_MODEL_PATH = 'models/manga-ocr/decoder_model.onnx';
  const TEXT_CLASSES = ['text_bubble', 'text_free'];

  function getSettings() {
    return {
      targetLang: studio.settings.get('targetLang') || 'en',
      readingDirection: studio.settings.get('readingDirection') === 'rtl' ? 'rtl' : 'ltr',
      confidence: Number(studio.settings.get('confidence')) || 0.5,
    };
  }

  /** Mesma lógica de examples/page-translator/index.js
   *  (orderByReadingDirection): agrupa balões aproximadamente na mesma
   *  fileira vertical e ordena cada fileira da esquerda pra direita
   *  ("ltr") ou direita pra esquerda ("rtl", mangá). */
  function orderByReadingDirection(regions, direction) {
    if (!regions.length) return [];
    const sorted = [...regions].sort((a, b) => a.box.y - b.box.y);
    const avgHeight = sorted.reduce((sum, r) => sum + r.box.height, 0) / sorted.length;
    const rowThreshold = avgHeight * 0.6;

    const rows = [];
    let currentRow = [sorted[0]];
    let rowStartY = sorted[0].box.y;
    for (let i = 1; i < sorted.length; i++) {
      const region = sorted[i];
      if (region.box.y - rowStartY <= rowThreshold) {
        currentRow.push(region);
      } else {
        rows.push(currentRow);
        currentRow = [region];
        rowStartY = region.box.y;
      }
    }
    rows.push(currentRow);

    const sign = direction === 'rtl' ? -1 : 1;
    for (const row of rows) row.sort((a, b) => sign * (a.box.x - b.box.x));
    return rows.flat();
  }

  async function resolvePageKey(info, requestedKey) {
    if (requestedKey) {
      if (!info.pageKeys.includes(requestedKey)) {
        throw new Error(`Página "${requestedKey}" não existe neste projeto.`);
      }
      return requestedKey;
    }
    const current = await studio.project.getCurrentPage();
    if (!current.pageKey) throw new Error('Nenhuma página aberta no editor no momento.');
    return current.pageKey;
  }

  async function loadPageState(requestedKey) {
    const info = await studio.project.getInfo();
    const pageKey = await resolvePageKey(info, requestedKey);
    const page = info.pages.find((p) => p.key === pageKey);
    const hasRaw = Boolean(page && page.hasRaw);
    const hasPageImage = Boolean(page && page.hasPageImage);
    const [script, draft] = await Promise.all([
      studio.project.readScript(pageKey),
      studio.project.readTranslateDraft(pageKey),
    ]);

    let imageBase64 = null;
    if (hasRaw || hasPageImage) {
      imageBase64 = await studio.project.readPageImage(pageKey, hasRaw ? 'raw' : 'pages');
    }

    return { pageKey, pageKeys: info.pageKeys, hasRaw, hasPageImage, script, draft, imageBase64 };
  }

  /** Detecta regiões de texto na página atual e devolve os recortes
   *  (base64) já na ordem de leitura - o PAINEL faz o resto (rodar o
   *  manga-ocr região por região, via as mensagens run-encoder/
   *  run-decoder abaixo). */
  async function detectRegions(imageBase64, settings) {
    const detections = await studio.image.detectText(imageBase64, DETECTOR_MODEL_PATH, { confidence: settings.confidence });
    const regions = orderByReadingDirection(
      detections.filter((d) => TEXT_CLASSES.includes(d.class)),
      settings.readingDirection
    );
    const crops = [];
    for (const region of regions) {
      const cropBase64 = await studio.image.cropRegion(imageBase64, region.box);
      crops.push({ box: region.box, cropBase64 });
    }
    return crops;
  }

  async function draftViaFreeTranslate(lines, targetLang) {
    const draft = [];
    for (const line of lines) {
      if (!line || !line.trim()) continue;
      const parts = line.split('/').map((p) => p.trim()).filter(Boolean);
      const translatedParts = [];
      for (const part of parts) {
        const result = await studio.translate.free(part, targetLang);
        translatedParts.push((result.text || '').trim());
      }
      draft.push(translatedParts.join(' / '));
    }
    return draft;
  }

  studio.menu.register({
    id: 'page-translator-local-ocr.open',
    name: 'Traduzir página (OCR local)',
    icon: 'translate',
    action() {
      studio.ui.openPanel({
        title: 'Page Translator (OCR local)',
        htmlFile: 'ui/index.html',
        async onMessage(msg) {
          if (!msg || typeof msg.type !== 'string') {
            throw new Error('Page Translator (OCR local): mensagem sem "type"');
          }

          switch (msg.type) {
            case 'get-settings':
              return getSettings();

            case 'save-settings': {
              studio.settings.set('targetLang', (msg.targetLang || 'en').trim());
              studio.settings.set('readingDirection', msg.readingDirection === 'rtl' ? 'rtl' : 'ltr');
              studio.settings.set('confidence', Number(msg.confidence) || 0.5);
              return { ok: true };
            }

            case 'get-page-state':
              return loadPageState(msg.pageKey);

            // caminho rápido: roteiro já existe, traduz direto, sem
            // detecção/OCR nenhum (igual o Page Translator Mobile)
            case 'run-translate': {
              const { targetLang } = getSettings();
              const state = await loadPageState(msg.pageKey);
              if (!state.script.length) throw new Error('Esta página ainda não tem roteiro nenhum pra traduzir localmente.');
              const draft = await draftViaFreeTranslate(state.script, targetLang);
              await studio.project.writeTranslateDraft(state.pageKey, draft);
              return { pageKey: state.pageKey, draft };
            }

            // etapa 1 do caminho OCR: detecta balões + devolve recortes
            // pro painel processar um por um (run-encoder/run-decoder)
            case 'detect-regions': {
              const settings = getSettings();
              const state = await loadPageState(msg.pageKey);
              if (!state.imageBase64) throw new Error('Esta página não tem imagem nenhuma (nem raw, nem já editada).');
              const crops = await detectRegions(state.imageBase64, settings);
              return { pageKey: state.pageKey, crops };
            }

            // etapas 2/3 do caminho OCR - o painel monta os tensores
            // (tem <canvas> de verdade; ver ui/app.js) e só pede pra
            // rodar o modelo - mesmo padrão do Smart Cleaner Mobile
            case 'run-encoder': {
              const outputs = await studio.image.runOnnxModel(
                ENCODER_MODEL_PATH,
                { pixel_values: msg.pixelValues },
                { outputNames: ['last_hidden_state'] }
              );
              return { lastHiddenState: outputs.last_hidden_state };
            }

            case 'run-decoder': {
              const outputs = await studio.image.runOnnxModel(
                DECODER_MODEL_PATH,
                { input_ids: msg.inputIds, encoder_hidden_states: msg.encoderHiddenStates },
                { outputNames: ['logits'] }
              );
              return { logits: outputs.logits };
            }

            // traduz linhas arbitrárias (texto lido via OCR local) -
            // mesmo tradutor gratuito de sempre, sem IA
            case 'translate-lines': {
              const draft = await draftViaFreeTranslate(msg.lines || [], msg.targetLang || getSettings().targetLang);
              return { draft };
            }

            case 'save-draft': {
              await studio.project.writeTranslateDraft(msg.pageKey, msg.lines || []);
              return { ok: true };
            }

            case 'confirm': {
              const lines = msg.lines || [];
              await studio.project.writeTranslateDraft(msg.pageKey, lines);
              await studio.project.writeScript(msg.pageKey, lines);
              await studio.editor.refresh();
              return { ok: true };
            }

            default:
              throw new Error(`Page Translator (OCR local): mensagem desconhecida "${msg.type}"`);
          }
        },
      });
    },
  });
};
