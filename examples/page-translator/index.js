/**
 * Page Translator - detecta balões/texto numa página (modelo local
 * ogkalu/comic-text-and-bubble-detector, RT-DETRv2 via ONNX) e traduz:
 *
 * - Com uma chave Gemini configurada (aba Extensões → "Configurar
 *   tradução"): manda o recorte de TODAS as regiões detectadas numa
 *   ÚNICA chamada multimodal (uma imagem por região, um só request) -
 *   funciona mesmo numa página só com "raw" (sem nenhum texto digitado
 *   ainda). Uma única chamada em vez de uma por região é proposital:
 *   evita bater na cota da API (sobretudo no tier gratuito) só porque
 *   uma página tem várias falas.
 * - Se essa chamada falhar por QUALQUER motivo (cota excedida, chave
 *   inválida, rede) - ou se não houver chave nenhuma configurada -
 *   cai automaticamente pro tradutor gratuito (sem chave nenhuma),
 *   traduzindo o TEXTO que já existir nas caixas atuais da página nas
 *   posições onde o detector encontrou uma região (não dá pra "ler"
 *   texto de uma imagem sem um modelo de visão, então esse caminho só
 *   funciona pra texto que já esteja digitado).
 */
module.exports = function (studio) {
  const MODEL_PATH = 'models/detector.onnx';
  const TEXT_CLASSES = ['text_bubble', 'text_free'];

  function randomId() {
    return Math.random().toString(36).slice(2, 12);
  }

  function getSettings() {
    return {
      geminiApiKey: studio.settings.get('geminiApiKey') || '',
      targetLang: studio.settings.get('targetLang') || 'en',
      // opcional - em branco usa o default do Core (alias sempre
      // atualizado, ver docs/extensions/ai.md); preencher so se quiser
      // um modelo Gemini especifico (ex: "gemini-3.1-flash-lite" pra
      // priorizar custo/velocidade sobre qualidade).
      geminiModel: studio.settings.get('geminiModel') || '',
    };
  }

  function boxesOverlap(a, b) {
    // considera "a mesma regiao" se o CENTRO de "b" cai dentro de "a"
    // (ou vice-versa) - mais tolerante a pequenas diferencas de recorte
    // entre o detector e uma caixa de texto ja existente do que exigir
    // IoU alto
    const bCenterX = b.x + b.width / 2;
    const bCenterY = b.y + b.height / 2;
    const aCenterX = a.x + a.width / 2;
    const aCenterY = a.y + a.height / 2;
    const bInsideA = bCenterX >= a.x && bCenterX <= a.x + a.width && bCenterY >= a.y && bCenterY <= a.y + a.height;
    const aInsideB = aCenterX >= b.x && aCenterX <= b.x + b.width && aCenterY >= b.y && aCenterY <= b.y + b.height;
    return bInsideA || aInsideB;
  }

  function buildTextBox(box, text) {
    return {
      id: randomId(),
      text,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: 0,
      style: {
        font: 'Arial',
        size: Math.max(10, Math.round(Math.min(box.width, box.height) * 0.22)),
        bold: false,
        italic: false,
        underline: false,
        align: 'center',
        letterSpacing: 0,
        lineSpacing: 0,
        strokeEnabled: true,
        strokeWidth: 2,
        textColor: '#000000',
        strokeColor: '#ffffff',
      },
    };
  }

  /** Recorta TODAS as regiões e manda numa ÚNICA chamada multimodal -
   *  devolve um array de strings traduzidas, na MESMA ordem de
   *  `regions` (string vazia = sem texto legível naquela região).
   *  Lança erro se o Gemini falhar (cota, chave, rede, resposta num
   *  formato inesperado) - quem chama decide o fallback. */
  async function translateAllViaGemini(imageBase64, regions, apiKey, targetLang, model) {
    const crops = [];
    for (const region of regions) {
      crops.push(await studio.image.cropRegion(imageBase64, region.box));
    }

    const prompt =
      `You will receive ${regions.length} images, in order, each a cropped speech bubble or text region from ` +
      `a single comic/manga page. For EACH image, read the text in it and translate it to ${targetLang}. ` +
      `Reply with ONLY a JSON array of ${regions.length} strings (the translations, same order as the images) - ` +
      `no markdown, no code fences, no explanation, nothing before or after the array. ` +
      `If an image has no legible text, use an empty string "" for that entry.`;

    const opts = { images: crops, temperature: 0 };
    if (model) opts.model = model;
    const result = await studio.ai.gemini(prompt, apiKey, opts);

    // o Gemini as vezes embrulha JSON em ```json ... ``` mesmo pedindo
    // pra nao fazer isso - tira isso antes de tentar parsear
    const cleaned = (result.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new Error(`resposta do Gemini nao era um JSON valido: ${cleaned.slice(0, 200)}`);
    }
    if (!Array.isArray(parsed) || parsed.length !== regions.length) {
      throw new Error(`Gemini devolveu ${Array.isArray(parsed) ? parsed.length : typeof parsed} item(ns), esperava ${regions.length}`);
    }

    return parsed.map((t) => (typeof t === 'string' ? t.trim() : ''));
  }

  async function translateExistingText(existingLayout, region, targetLang) {
    const match = existingLayout.find((b) => b.text && b.text.trim() && boxesOverlap(region.box, b));
    if (!match) return null;
    const result = await studio.translate.free(match.text, targetLang);
    return { text: (result.text || '').trim(), replaceId: match.id };
  }

  studio.menu.register({
    id: 'page-translator.configure',
    name: 'Configurar tradução',
    icon: 'gear',
    action() {
      studio.ui.openPanel({
        title: 'Configurar Tradução de Página',
        htmlFile: 'ui/index.html',
        onMessage(msg) {
          if (msg && msg.type === 'get-settings') return getSettings();
          if (msg && msg.type === 'save-settings') {
            studio.settings.set('geminiApiKey', (msg.geminiApiKey || '').trim());
            studio.settings.set('targetLang', (msg.targetLang || 'en').trim());
            studio.settings.set('geminiModel', (msg.geminiModel || '').trim());
            return { ok: true };
          }
          throw new Error(`Page Translator: mensagem desconhecida "${msg && msg.type}"`);
        },
      });
    },
  });

  studio.menu.register({
    id: 'page-translator.translate',
    name: 'Traduzir página',
    icon: 'translate',
    async action() {
      const { geminiApiKey, targetLang, geminiModel } = getSettings();

      const current = await studio.project.getCurrentPage();
      if (!current.pageKey) {
        studio.dialog.show('Abra um projeto (com uma página selecionada) antes de traduzir.');
        return;
      }

      const info = await studio.project.getInfo();
      const page = info.pages.find((p) => p.key === current.pageKey);
      const variant = page && page.hasRaw ? 'raw' : 'pages';

      const imageBase64 = await studio.project.readPageImage(current.pageKey, variant);

      studio.log.info('detectando baloes/texto...');
      const detections = await studio.image.detectText(imageBase64, MODEL_PATH, { confidence: 0.5 });
      const regions = detections.filter((d) => TEXT_CLASSES.includes(d.class));

      if (!regions.length) {
        studio.dialog.show('Nenhum texto/balão detectado nessa página.');
        return;
      }

      // tenta o Gemini UMA VEZ, pra TODAS as regioes juntas - se falhar
      // por qualquer motivo (cota, chave, rede, resposta mal formada),
      // "geminiTexts" fica null e todo mundo cai pro tradutor gratuito
      // (texto ja existente), sem gastar mais nenhuma chamada de IA
      let geminiTexts = null;
      let usedMode = 'tradutor gratuito (texto já existente na página)';
      if (geminiApiKey) {
        try {
          geminiTexts = await translateAllViaGemini(imageBase64, regions, geminiApiKey, targetLang, geminiModel);
          usedMode = 'Gemini (IA + OCR direto da imagem, 1 chamada pra página inteira)';
        } catch (err) {
          studio.log.warn('Gemini falhou pro lote inteiro - caindo pro tradutor gratuito:', err.message);
        }
      }

      const existingLayout = await studio.project.readLayout(current.pageKey);
      const usedExistingIds = new Set();
      const newBoxes = [];
      let translatedCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < regions.length; i++) {
        const region = regions[i];
        try {
          if (geminiTexts) {
            const text = geminiTexts[i];
            if (text) {
              newBoxes.push(buildTextBox(region.box, text));
              translatedCount++;
            } else {
              skippedCount++;
            }
          } else {
            const result = await translateExistingText(existingLayout, region, targetLang);
            if (result && result.text) {
              usedExistingIds.add(result.replaceId);
              const box = buildTextBox(region.box, result.text);
              box.id = result.replaceId; // atualiza a caixa existente no lugar, em vez de duplicar
              newBoxes.push(box);
              translatedCount++;
            } else {
              skippedCount++;
            }
          }
        } catch (err) {
          studio.log.warn(`falha traduzindo regiao [${region.box.x},${region.box.y}]:`, err.message);
          skippedCount++;
        }
      }

      // combina: caixas existentes que NAO foram substituidas + as
      // novas/atualizadas
      const keptExisting = existingLayout.filter((b) => !usedExistingIds.has(b.id));
      await studio.project.writeLayout(current.pageKey, [...keptExisting, ...newBoxes]);

      await studio.editor.refresh();

      studio.dialog.show(
        `Tradução concluída via ${usedMode}.\n` +
          `${regions.length} região(ões) detectada(s) - ${translatedCount} traduzida(s), ${skippedCount} sem texto/pulada(s).`
      );
    },
  });
};
