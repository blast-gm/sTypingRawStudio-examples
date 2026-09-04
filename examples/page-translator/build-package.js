'use strict';

// Empacota examples/page-translator/ (extension.json + index.js + ui/
// + o modelo de deteccao) num .zip pronto pra subir no sTraw Hub.
// Baixa o modelo automaticamente (ver download-model.js) se ainda nao
// estiver em models/detector.onnx.
//
// Uso: node examples/page-translator/build-package.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const EXT_DIR = __dirname;
const MODEL_PATH = path.join(EXT_DIR, 'models', 'detector.onnx');
const OUT_DIR = path.join(__dirname, '..', '..', 'dist-extensions');
const OUT_FILE = path.join(OUT_DIR, 'page-translator-1.0.0.zip');

async function main() {
  if (!fs.existsSync(MODEL_PATH)) {
    console.log('Modelo ainda não baixado - buscando...');
    require('./download-model.js');
    return; // download-model.js roda async e termina o processo sozinho; rode este script de novo depois
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Empacotando...');
  const zip = new AdmZip();
  zip.addLocalFile(path.join(EXT_DIR, 'extension.json'));
  zip.addLocalFile(path.join(EXT_DIR, 'index.js'));
  zip.addLocalFolder(path.join(EXT_DIR, 'ui'), 'ui');
  zip.addLocalFile(MODEL_PATH, 'models');
  zip.writeZip(OUT_FILE);

  const buffer = fs.readFileSync(OUT_FILE);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  console.log('\nPacote gerado em:', OUT_FILE);
  console.log('Tamanho:', (buffer.length / 1024 / 1024).toFixed(1), 'MB');
  console.log('SHA-256:', sha256, '(calculado só pra conferência - o Hub calcula o dele próprio no upload)');
  console.log('\nSuba esse .zip em https://studio.blast.net.br (Nova extensão / Enviar nova versão).');
}

main();
