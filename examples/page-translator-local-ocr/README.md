# Page Translator (OCR local) — versão de TESTE

Extensão **desktop** de bancada, pra calibrar o pipeline "ler texto de
mangá sem IA de terceiros" com iteração rápida (editar extensão →
recarregar → testar, sem deploy nenhum) antes de portar a mesma lógica
pro [Page Translator Mobile](../page-translator-mobile) (que roda isso
numa nuvem própria, ver `packages/translate-ai-cloud` no repo
principal, operação `detect-text`).

**Sem Gemini, sem IA generativa de terceiros, sem rede nenhuma** - os
dois modelos abertos rodam 100% local, direto no app desktop:

- **Detecção de balão/texto**: RT-DETRv2 (`models/detector.onnx`,
  mesmo modelo do [Page Translator](../page-translator) original) via
  `studio.image.detectText`.
- **Leitura de texto (OCR)**: [**manga-ocr**](https://github.com/kha-white/manga-ocr)
  (`kha-white/manga-ocr-base`, export ONNX) - modelo treinado
  **especificamente** em letreiramento de mangá (fonte estilizada,
  texto vertical), em vez de um OCR de documento genérico. Via
  `studio.image.runOnnxModel` - o painel (`ui/app.js`, que tem um
  `<canvas>` de verdade) monta os tensores e decodifica o texto gerado
  caractere a caractere; `index.js` só repassa pro modelo. Mesmo
  código/lógica (tokens especiais, decodificação greedy) da versão que
  roda na nuvem pro Mobile - só a ORIGEM do processamento muda (aqui,
  local; lá, um servidor próprio).
- **Tradução**: sempre `studio.translate.free` (gratuito, sem chave) -
  etapa **independente** da leitura; o manga-ocr só lê o texto
  original, nunca traduz nada.

## Por que uma extensão separada

Pra não misturar o código "em calibração" com o
[Page Translator Mobile](../page-translator-mobile) já publicado.
Rodando local, cada ajuste (confiança de detecção, decodificação do
OCR etc.) é testado na hora, sem precisar subir nada numa VPS - uma
vez satisfeito com o resultado aqui, o mesmo ajuste é portado pro
`packages/translate-ai-cloud` (nuvem, usada pelo Mobile).

## Usando

1. Baixe os modelos (variante `int8`, mais leve - troque com
   `MANGA_OCR_VARIANT= node download-model.js` se quiser a fp32, mais
   pesada e precisa):
   ```bash
   node examples/page-translator-local-ocr/download-model.js
   ```
2. Teste pela [pasta de desenvolvimento](../../README.md#testando-os-exemplos-localmente).
3. Menu **"Traduzir página (OCR local)"** abre o painel.
4. Em **Configurações**: idioma de destino, ordem de leitura dos
   balões (ocidental/mangá) e a **confiança mínima de detecção** - o
   principal parâmetro pra calibrar (mais baixo detecta mais regiões,
   inclusive erradas; mais alto é mais seletivo).
5. **"Traduzir esta página"**: se a página já tiver roteiro, traduz
   direto; se só tiver imagem, detecta balão + lê com manga-ocr
   (mostra progresso "Lendo balão X/Y..." - cada balão é uma chamada
   ao encoder + várias ao decoder, pode levar alguns segundos em CPU)
   e traduz o que saiu.
6. Revise o rascunho, **"Salvar roteiro"** quando satisfeito - mesmo
   fluxo rascunho→revisão→confirmação de sempre.

## `ui/vocab.js`

O vocabulário do manga-ocr (6144 tokens, um caractere por linha em
`vocab.txt` no Hugging Face) vem **embutido** nesse arquivo
(`window.MANGA_OCR_VOCAB`, um array indexado por id de token) - o
sandbox da extensão (`index.js`) não tem `fs`/`require` pra ler um
`vocab.txt` do disco em runtime, só os arquivos declarados
(`htmlFile`) e o que o painel carrega via `<script>`, mesmo jeito que
`app.js`/`style.css` já carregam. Se o manga-ocr for atualizado pra
uma versão com vocabulário diferente, regenere esse arquivo a partir
do `vocab.txt` novo.

## Empacotando

```bash
node scripts/build-package.js examples/page-translator-local-ocr
```
