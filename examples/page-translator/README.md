# Page Translator

Detecta balões/texto numa página de quadrinho (modelo local,
[`ogkalu/comic-text-and-bubble-detector`](https://huggingface.co/ogkalu/comic-text-and-bubble-detector) -
RT-DETRv2 via ONNX Runtime, roda 100% localmente) e traduz - com dois
caminhos diferentes dependendo do que estiver configurado:

- **Com uma chave [Gemini](https://aistudio.google.com/apikey)
  configurada** (aba Extensões → "Configurar tradução"): manda o
  recorte de **todas** as regiões detectadas numa **única** chamada
  multimodal - o Gemini lê e traduz o texto direto da imagem, uma
  chamada por página inteira (não uma por balão, pra não gastar cota à
  toa). Funciona mesmo numa página só com `raw`, sem nenhum texto
  digitado ainda.
- **Sem chave nenhuma** (ou se a chamada ao Gemini falhar por qualquer
  motivo - cota, rede, chave inválida): cai automaticamente pro
  **tradutor gratuito** (`studio.translate.free`, sem chave nenhuma) -
  traduz o texto que **já existir** nas caixas atuais da página, nas
  posições onde o detector encontrou uma região. Não dá pra "ler"
  texto de uma imagem sem um modelo de visão, então esse caminho só
  funciona pra texto já digitado.

Mostra praticamente toda a Extension API de IA/imagem em uso:
`studio.image.detectText`, `studio.image.cropRegion`, `studio.ai.gemini`
(multimodal, várias imagens numa chamada), `studio.translate.free`,
`studio.project.readLayout`/`writeLayout`, `studio.editor.refresh`.

## Usando

1. Instale a extensão (ou teste pela [pasta de desenvolvimento](../../README.md#testando-os-exemplos-localmente)).
2. Menu **"Configurar tradução"**: opcionalmente cole uma chave Gemini
   e escolha o idioma de destino (código curto, ex: `en`, `pt`, `ja`).
   Deixe a chave em branco pra usar só o tradutor gratuito.
3. Abra uma página e clique em **"Traduzir página"**.

## Preparando o modelo (pra empacotar/testar)

O modelo (~44MB, variante quantizada int8) não fica neste repositório
- baixe ele com:

```bash
node examples/page-translator/download-model.js
```

Depois, pra gerar o `.zip` (mesma saída de sempre, `dist-extensions/`):

```bash
node examples/page-translator/build-package.js
```

## Notas técnicas

- O modelo tem 3 classes: `bubble` (balão inteiro), `text_bubble`
  (texto dentro de um balão) e `text_free` (texto solto, fora de
  balão) - só as duas últimas são usadas aqui (a primeira é só o
  contêiner, não o texto em si).
- `orig_target_sizes` (segundo input do modelo) espera
  `[largura, altura]`, apesar do nome sugerir "tamanho" genérico -
  confirmado testando contra o modelo de verdade, não documentado
  explicitamente em lugar nenhum.
- As caixas de texto criadas usam posição/tamanho exatos da detecção,
  com um tamanho de fonte estimado a partir da altura da caixa - é um
  ponto de partida, não um resultado de typesetting final polido
  (ajuste manual depois é esperado, igual qualquer tradução automática).
