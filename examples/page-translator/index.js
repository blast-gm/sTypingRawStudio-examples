/**
 * Page Translator - detecta balões/texto numa página (modelo local
 * ogkalu/comic-text-and-bubble-detector, RT-DETRv2 via ONNX) e produz
 * um RASCUNHO de tradução, revisável e editável, ANTES de qualquer
 * coisa virar "oficial":
 *
 * - Rascunho (translate.traw): gravado via studio.project.writeTranslateDraft -
 *   um arquivo IRMÃO do script.traw, dentro do próprio .ztraw, que
 *   acumula página por página conforme a pessoa for traduzindo -
 *   sobrevive a fechar/reabrir o app (persiste quando o projeto é
 *   salvo). Só esta extensão lê/escreve nele por enquanto.
 * - "Salvar roteiro" (studio.project.writeScript): promove o rascunho
 *   revisado pro roteiro OFICIAL (script.traw) e chama
 *   studio.editor.refresh() - o editor recarrega a página e o painel
 *   "Roteiro da página" já mostra o texto novo, sem precisar fechar e
 *   reabrir o projeto.
 * - O painel tem botões "◀ Anterior"/"Próxima ▶" pra trocar de página
 *   SEM fechar a tela da extensão - útil pra ir traduzindo o projeto
 *   inteiro, página por página, numa sessão só.
 *
 * Como o rascunho é gerado:
 * - Com uma chave Gemini configurada: detecta balões/texto na imagem e
 *   manda TODOS os recortes numa ÚNICA chamada multimodal (lê e
 *   traduz direto da imagem - funciona mesmo sem nenhum texto digitado
 *   ainda). Uma linha de rascunho por região detectada, na ordem de
 *   LEITURA escolhida nas configurações: "ltr" (ocidental,
 *   esquerda->direita) ou "rtl" (mangá, direita->esquerda) - ver
 *   orderByReadingDirection.
 * - Sem chave (ou se a chamada falhar por qualquer motivo - cota,
 *   rede, chave inválida): traduz o ROTEIRO OFICIAL já existente da
 *   página, linha por linha, via tradutor gratuito (sem chave
 *   nenhuma), preservando os baloes separados por " / " dentro de cada
 *   linha (formato padrao do .traw). Não dá pra "ler" texto de uma
 *   imagem sem visão, então esse caminho só funciona se já houver
 *   roteiro pra essa página.
 *
 * O botão "Testar rascunho" do painel copia o rascunho pra área do
 * roteiro só como PRÉVIA (sem gravar nada) - útil pra ver como o texto
 * vai ficar formatado em blocos, no mesmo padrão do roteiro oficial,
 * antes de decidir usar "Salvar roteiro" de verdade.
 */
module.exports = function (studio) {
  const MODEL_PATH = 'models/detector.onnx';
  const TEXT_CLASSES = ['text_bubble', 'text_free'];

  function getSettings() {
    return {
      geminiApiKey: studio.settings.get('geminiApiKey') || '',
      targetLang: studio.settings.get('targetLang') || 'en',
      geminiModel: studio.settings.get('geminiModel') || '',
      // ordem de leitura usada pra sequenciar os baloes detectados pelo
      // Gemini: "ltr" (ocidental, esquerda->direita - padrao de comics
      // americanas/europeias) ou "rtl" (mangá, direita->esquerda)
      readingDirection: studio.settings.get('readingDirection') === 'rtl' ? 'rtl' : 'ltr',
    };
  }

  /** Ordena as regioes detectadas na ordem de LEITURA (nao so de cima
   *  pra baixo): agrupa baloes que estao aproximadamente na mesma
   *  "fileira" vertical (mesmo painel/linha da pagina) e, dentro de
   *  cada fileira, ordena da esquerda pra direita ("ltr", padrao
   *  ocidental) ou da direita pra esquerda ("rtl", padrao de mangá). A
   *  altura media dos baloes detectados define o quao proximas duas
   *  regioes precisam estar verticalmente pra contarem como "a mesma
   *  fileira" - uma aproximacao razoavel pra pagina de quadrinho comum,
   *  nao uma analise de layout completa. */
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
    for (const row of rows) {
      row.sort((a, b) => sign * (a.box.x - b.box.x));
    }

    return rows.flat();
  }

  /** Detecta regiões, manda todas numa unica chamada multimodal pro
   *  Gemini, devolve as linhas traduzidas na ordem de leitura escolhida
   *  (ver orderByReadingDirection). Lanca erro se o Gemini falhar por
   *  qualquer motivo (cota, chave, rede, resposta mal formada). */
  async function draftViaGemini(imageBase64, apiKey, targetLang, model, readingDirection) {
    const detections = await studio.image.detectText(imageBase64, MODEL_PATH, { confidence: 0.5 });
    const detected = detections.filter((d) => TEXT_CLASSES.includes(d.class));
    const regions = orderByReadingDirection(detected, readingDirection);

    if (!regions.length) return [];

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

    return parsed.map((t) => (typeof t === 'string' ? t.trim() : '')).filter((t) => t);
  }

  /** Traduz o roteiro OFICIAL ja existente da pagina, linha por linha,
   *  via tradutor gratuito - fallback quando nao ha chave Gemini (ou
   *  ela falhou). Devolve [] se a pagina nao tiver roteiro nenhum
   *  ainda (nada pra traduzir sem visao).
   *
   *  Cada LINHA do script.traw pode conter varios baloes separados por
   *  " / " (formato padrao do .traw, ver packages/core/src/trawScript.js
   *  "splitParts") - traduzir a linha inteira de uma vez mandaria essa
   *  barra pro tradutor junto do texto, arriscando ele tratar tudo como
   *  uma frase so e perder a separacao. Por isso traduz cada PARTE
   *  separadamente e junta de volta com " / ", preservando o mesmo
   *  bloco/formatacao da linha original no rascunho. */
  async function draftViaFreeTranslate(existingScriptLines, targetLang) {
    const draft = [];
    for (const line of existingScriptLines) {
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

  /** Resolve qual pagina usar: a informada explicitamente pelo painel
   *  (pra poder navegar entre paginas com os botoes Anterior/Próxima,
   *  SEM sair da tela da extensao nem mudar a pagina exibida no editor)
   *  ou, na falta dela, a que estiver aberta no editor no momento
   *  (carga inicial do painel). */
  async function resolvePageKey(info, requestedKey) {
    if (requestedKey) {
      if (!info.pageKeys.includes(requestedKey)) {
        throw new Error(`Pagina "${requestedKey}" nao existe neste projeto.`);
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

    // previa da pagina atual pro painel (so feedback visual, pra saber
    // onde cada balao esta na hora de revisar) - prefere SEMPRE o "raw"
    // (a imagem ORIGINAL, com o texto de origem ainda visivel) mesmo
    // que a pagina ja tenha sido limpa - e o texto ORIGINAL que precisa
    // bater com o rascunho/roteiro na hora de revisar, nao a versao ja
    // sem texto; so cai pro "pages" se por algum motivo nao houver raw
    let imageBase64 = null;
    if (hasRaw || hasPageImage) {
      imageBase64 = await studio.project.readPageImage(pageKey, hasRaw ? 'raw' : 'pages');
    }

    return {
      pageKey,
      pageKeys: info.pageKeys,
      hasRaw,
      hasPageImage,
      script,
      draft,
      imageBase64,
    };
  }

  studio.menu.register({
    id: 'page-translator.open',
    name: 'Traduzir página',
    icon: 'translate',
    action() {
      studio.ui.openPanel({
        title: 'Page Translator',
        htmlFile: 'ui/index.html',
        async onMessage(msg) {
          if (!msg || typeof msg.type !== 'string') {
            throw new Error('Page Translator: mensagem sem "type"');
          }

          switch (msg.type) {
            case 'get-settings':
              return getSettings();

            case 'save-settings': {
              studio.settings.set('geminiApiKey', (msg.geminiApiKey || '').trim());
              studio.settings.set('targetLang', (msg.targetLang || 'en').trim());
              studio.settings.set('geminiModel', (msg.geminiModel || '').trim());
              studio.settings.set('readingDirection', msg.readingDirection === 'rtl' ? 'rtl' : 'ltr');
              return { ok: true };
            }

            case 'get-page-state': {
              return loadPageState(msg.pageKey);
            }

            case 'run-detection': {
              const { geminiApiKey, targetLang, geminiModel, readingDirection } = getSettings();
              const state = await loadPageState(msg.pageKey);
              const pageKey = state.pageKey;
              let draft = [];
              let usedMode;

              if (geminiApiKey) {
                try {
                  const variant = state.hasRaw ? 'raw' : 'pages';
                  const imageBase64 = await studio.project.readPageImage(pageKey, variant);
                  draft = await draftViaGemini(imageBase64, geminiApiKey, targetLang, geminiModel, readingDirection);
                  usedMode = 'gemini';
                } catch (err) {
                  studio.log.warn('Gemini falhou - caindo pro tradutor gratuito (roteiro já existente):', err.message);
                }
              }

              if (!draft.length && usedMode !== 'gemini') {
                if (!state.script.length) {
                  throw new Error(
                    geminiApiKey
                      ? 'O Gemini falhou e esta página ainda não tem roteiro nenhum pra usar como fallback.'
                      : 'Sem chave Gemini configurada, e esta página ainda não tem roteiro nenhum pra traduzir - configure uma chave, ou digite/importe o roteiro original primeiro.'
                  );
                }
                draft = await draftViaFreeTranslate(state.script, targetLang);
                usedMode = 'free';
              }

              await studio.project.writeTranslateDraft(pageKey, draft);
              return { pageKey, draft, usedMode };
            }

            case 'save-draft': {
              await studio.project.writeTranslateDraft(msg.pageKey, msg.lines || []);
              return { ok: true };
            }

            case 'confirm': {
              const lines = msg.lines || [];
              // grava tambem no rascunho, pra translate.traw nunca ficar
              // divergente do que acabou de ser confirmado no script.traw -
              // a pessoa pode ter editado o texto direto na caixa antes de
              // confirmar, sem clicar em "Salvar rascunho" antes
              await studio.project.writeTranslateDraft(msg.pageKey, lines);
              await studio.project.writeScript(msg.pageKey, lines);
              await studio.editor.refresh();
              return { ok: true };
            }

            default:
              throw new Error(`Page Translator: mensagem desconhecida "${msg.type}"`);
          }
        },
      });
    },
  });
};
