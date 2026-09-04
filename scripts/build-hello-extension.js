'use strict';

// Script utilitario pra empacotar examples/hello-extension/ num .zip -
// util tanto pra testar a instalacao localmente (aponte o catalogo
// local do app principal, sTypingRawStudio, pro arquivo gerado) quanto
// pra publicar essa versao de exemplo no sTraw Hub
// (studio.blast.net.br). Roda de novo sempre que mudar o conteudo de
// examples/hello-extension/.
//
// A saida fica em dist-extensions/ (gitignored - e saida de build, nao
// codigo-fonte, nunca precisa ser versionada).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const sourceDir = path.join(__dirname, '..', 'examples', 'hello-extension');
const outDir = path.join(__dirname, '..', 'dist-extensions');
const outFile = path.join(outDir, 'hello-extension-1.0.0.zip');

fs.mkdirSync(outDir, { recursive: true });

const zip = new AdmZip();
zip.addLocalFile(path.join(sourceDir, 'extension.json'));
zip.addLocalFile(path.join(sourceDir, 'index.js'));
zip.writeZip(outFile);

const buffer = fs.readFileSync(outFile);
const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

console.log('Pacote gerado em:', outFile);
console.log('SHA-256:', sha256);
