'use strict';

// Empacota examples/smart-cleaner/ (extension.json + index.js + ui/ +
// o modelo .onnx) num .zip pronto pra subir no sTraw Hub
// (studio.blast.net.br) - NAO pro catalogo local do app mais (ver nota
// abaixo sobre OUT_DIR). O modelo (~200MB) NAO fica versionado no git
// (ver .gitignore) - esse script copia ele de um caminho local
// informado na hora de gerar o pacote.
//
// Uso: node examples/smart-cleaner/build-package.js "<caminho para o lama_fp32.onnx>"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const EXT_DIR = __dirname;
const MODEL_DEST = path.join(EXT_DIR, 'models', 'lama_fp32.onnx');
// dist-extensions/ (raiz deste repo, gitignored) - so saida de build,
// nunca versionada (o .zip final passa de 180MB por causa do modelo).
const OUT_DIR = path.join(__dirname, '..', '..', 'dist-extensions');
const OUT_FILE = path.join(OUT_DIR, 'smart-cleaner-1.0.0.zip');

function main() {
  const modelSrc = process.argv[2];

  if (!fs.existsSync(MODEL_DEST)) {
    if (!modelSrc) {
      console.error(
        'Modelo ainda nao esta em examples/smart-cleaner/models/lama_fp32.onnx.\n' +
          'Rode: node examples/smart-cleaner/build-package.js "<caminho para o .onnx>"'
      );
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(MODEL_DEST), { recursive: true });
    console.log(`Copiando modelo de "${modelSrc}"...`);
    fs.copyFileSync(modelSrc, MODEL_DEST);
  } else {
    console.log('Modelo ja presente em examples/smart-cleaner/models/, reaproveitando.');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Empacotando...');
  const zip = new AdmZip();
  zip.addLocalFile(path.join(EXT_DIR, 'extension.json'));
  zip.addLocalFile(path.join(EXT_DIR, 'index.js'));
  zip.addLocalFolder(path.join(EXT_DIR, 'ui'), 'ui');
  zip.addLocalFile(MODEL_DEST, 'models');
  zip.writeZip(OUT_FILE);

  console.log('Calculando SHA-256 (arquivo grande, pode levar um instante)...');
  const buffer = fs.readFileSync(OUT_FILE);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  console.log('\nPacote gerado em:', OUT_FILE);
  console.log('Tamanho:', (buffer.length / 1024 / 1024).toFixed(1), 'MB');
  console.log('SHA-256:', sha256, '(calculado so pra conferencia - o Hub calcula o dele proprio no upload)');
  console.log('\nSuba esse .zip em https://studio.blast.net.br (Nova extensao / Enviar nova versao).');
}

main();
