'use strict';

// Baixa o modelo de deteccao de balao/texto (ogkalu/comic-text-and-bubble-detector,
// variante quantizada int8 - ~44MB) direto do Hugging Face pra
// models/detector.onnx. Ele NAO fica versionado no git (grande demais
// - ver .gitignore) - esse script busca ele quando precisar.
//
// Uso: node examples/page-translator/download-model.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL_URL = 'https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/main/detector_int8.onnx';
const DEST = path.join(__dirname, 'models', 'detector.onnx');

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
          return reject(new Error(`HTTP ${res.statusCode} baixando o modelo`));
        }
        const total = Number(res.headers['content-length'] || 0);
        let downloaded = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) process.stdout.write(`\rBaixando... ${((downloaded / total) * 100).toFixed(0)}%`);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(DEST)) {
    console.log('Modelo já presente em models/detector.onnx, nada a fazer.');
    return;
  }
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  console.log(`Baixando modelo de ${MODEL_URL} ...`);
  await download(MODEL_URL, DEST, 5);
  console.log('\nModelo salvo em', DEST);
}

main().catch((err) => {
  console.error('\nFalhou:', err.message);
  process.exit(1);
});
