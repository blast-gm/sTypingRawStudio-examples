'use strict';

// Baixa os modelos usados por esta extensão de TESTE (desktop):
// - models/detector.onnx (deteccao de balao, ogkalu/comic-text-and-bubble-detector,
//   mesmo modelo do Page Translator original, ~44MB)
// - models/manga-ocr/encoder_model.onnx + decoder_model.onnx (leitura
//   de texto, kha-white/manga-ocr-base via onnx-community/manga-ocr-base-ONNX)
//
// Por padrao baixa a variante INT8 (quantizada, mais leve/rapida em
// CPU - ~87MB+29.6MB) do manga-ocr, a mesma recomendada pro servidor
// de nuvem (packages/translate-ai-cloud) sem GPU. Defina
// MANGA_OCR_VARIANT=  (vazio) no ambiente antes de rodar pra baixar a
// fp32 (mais pesada, mais precisa) em vez disso.
//
// Nao versionado no git (grande demais - ver .gitignore, *.onnx) -
// esse script busca quando precisar, mesmo padrao de
// examples/page-translator/download-model.js.
//
// Uso: node download-model.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const DETECTOR_URL = 'https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/main/detector_int8.onnx';
const MANGA_OCR_BASE_URL = 'https://huggingface.co/onnx-community/manga-ocr-base-ONNX/resolve/main/onnx';
const VOCAB_URL = 'https://huggingface.co/kha-white/manga-ocr-base/resolve/main/vocab.txt';

const VARIANT = process.env.MANGA_OCR_VARIANT === '' ? '' : process.env.MANGA_OCR_VARIANT || 'int8';
const SUFFIX = VARIANT ? `_${VARIANT}` : '';

const MODELS_DIR = path.join(__dirname, 'models');
const MANGA_OCR_DIR = path.join(MODELS_DIR, 'manga-ocr');

const FILES = [
  { url: DETECTOR_URL, dest: path.join(MODELS_DIR, 'detector.onnx') },
  { url: `${MANGA_OCR_BASE_URL}/encoder_model${SUFFIX}.onnx`, dest: path.join(MANGA_OCR_DIR, 'encoder_model.onnx') },
  { url: `${MANGA_OCR_BASE_URL}/decoder_model${SUFFIX}.onnx`, dest: path.join(MANGA_OCR_DIR, 'decoder_model.onnx') },
  // vocab.txt NAO e usado em runtime (o painel usa ui/vocab.js, ja
  // embutido no pacote da extensao - gerado a partir deste mesmo
  // arquivo) - baixado aqui so por completude/conferencia manual, se
  // precisar.
  { url: VOCAB_URL, dest: path.join(MANGA_OCR_DIR, 'vocab.txt') },
];

function download(url, dest, redirectsLeft) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error('redirecionamentos demais'));
          res.resume();
          return resolve(download(res.headers.location, dest, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} baixando ${url}`));
        }
        const total = Number(res.headers['content-length'] || 0);
        let downloaded = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) process.stdout.write(`\r  ${((downloaded / total) * 100).toFixed(0)}%`);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(MANGA_OCR_DIR, { recursive: true });

  for (const { url, dest } of FILES) {
    if (fs.existsSync(dest)) {
      console.log(`"${path.relative(__dirname, dest)}" já presente, pulando.`);
      continue;
    }
    console.log(`Baixando ${path.relative(__dirname, dest)} de ${url} ...`);
    await download(url, dest, 5);
    console.log(`\nSalvo em ${dest}`);
  }

  console.log('\nPronto.');
}

main().catch((err) => {
  console.error('\nFalhou:', err.message);
  process.exit(1);
});
