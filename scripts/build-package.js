'use strict';

// Empacota QUALQUER pasta de extensao (extension.json + entry + ui/ +
// models/, o que existir) num .zip pronto pra subir no sTraw Hub -
// generico, funciona pra qualquer extensao, nao so as que tem seu
// proprio script "build:xxx" no package.json. Antes, cada extensao
// tinha seu proprio build-package.js com o nome do .zip de saida
// HARDCODED (ex: "smart-cleaner-1.0.0.zip") - facil de esquecer de
// atualizar depois de subir a versao no extension.json, e ficava sem
// gerar zero valor pra uma extensao nova sem esse arquivo proprio.
// Aqui o nome/versao do .zip vem SEMPRE do proprio extension.json da
// pasta informada ("id" e "version"), nunca hardcoded.
//
// Uso:
//   node scripts/build-package.js <pasta-da-extensao> [caminho-do-modelo-pra-copiar]
//
// <pasta-da-extensao>: relativa ao diretorio atual, ou absoluta.
// [caminho-do-modelo-pra-copiar]: opcional - se a extensao usa um
//   modelo .onnx grande demais pro git (ver .gitignore), passe o
//   caminho local dele aqui que este script copia pra
//   <pasta-da-extensao>/models/ antes de empacotar (nao baixa nada
//   sozinho - pra download automatico, ver o download-model.js
//   proprio de cada extensao, quando existir).
//
// Exemplos:
//   node scripts/build-package.js examples/hello-extension
//   node scripts/build-package.js examples/smart-cleaner "D:\...\lama_fp32.onnx"
//   node scripts/build-package.js examples/page-translator
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

function main() {
  const extDirArg = process.argv[2];
  const modelSrc = process.argv[3];

  if (!extDirArg) {
    console.error(
      'Uso: node scripts/build-package.js <pasta-da-extensao> [caminho-do-modelo-pra-copiar]\n' +
        'Ex.:  node scripts/build-package.js examples/smart-cleaner "D:\\caminho\\para\\lama_fp32.onnx"'
    );
    process.exit(1);
  }

  const extDir = path.resolve(process.cwd(), extDirArg);
  const manifestPath = path.join(extDir, 'extension.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`"${manifestPath}" não encontrado - a pasta informada precisa ter um extension.json na raiz.`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (!manifest.id || !manifest.version) {
    console.error('extension.json precisa ter "id" e "version" preenchidos pra nomear o pacote automaticamente.');
    process.exit(1);
  }

  // copia o modelo informado (2o argumento) pra models/ da propria
  // extensao ANTES de empacotar, se foi passado - generico, funciona
  // pra qualquer extensao com modelo externo grande demais pro git, nao
  // so uma especifica
  if (modelSrc) {
    if (!fs.existsSync(modelSrc)) {
      console.error(`Modelo informado não encontrado: "${modelSrc}"`);
      process.exit(1);
    }
    const modelsDir = path.join(extDir, 'models');
    fs.mkdirSync(modelsDir, { recursive: true });
    const modelDest = path.join(modelsDir, path.basename(modelSrc));
    console.log(`Copiando modelo de "${modelSrc}" para "${modelDest}"...`);
    fs.copyFileSync(modelSrc, modelDest);
  }

  const entryFile = manifest.entry || 'index.js';
  const entryPath = path.join(extDir, entryFile);
  if (!fs.existsSync(entryPath)) {
    console.error(`Arquivo de entrada "${entryFile}" (campo "entry" do extension.json) não encontrado em "${extDir}".`);
    process.exit(1);
  }

  // dist-extensions/ na raiz deste repo (gitignored - so saida de
  // build, nunca versionada; alguns pacotes passam de 180MB por causa
  // do modelo embutido)
  const outDir = path.join(__dirname, '..', 'dist-extensions');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${manifest.id}-${manifest.version}.zip`);

  console.log(`Empacotando "${manifest.id}" v${manifest.version}...`);
  const zip = new AdmZip();
  zip.addLocalFile(manifestPath);
  zip.addLocalFile(entryPath);

  // pastas OPCIONAIS - inclui so as que existirem, sem exigir nenhuma
  // (uma extensao simples tipo hello-extension nao tem nem ui/ nem
  // models/, e isso e normal)
  ['ui', 'models'].forEach((folder) => {
    const folderPath = path.join(extDir, folder);
    if (fs.existsSync(folderPath)) {
      zip.addLocalFolder(folderPath, folder);
    }
  });

  zip.writeZip(outFile);

  console.log('Calculando SHA-256 (pacotes com modelo grande podem levar um instante)...');
  const buffer = fs.readFileSync(outFile);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  console.log('\nPacote gerado em:', outFile);
  console.log('Tamanho:', (buffer.length / 1024 / 1024).toFixed(1), 'MB');
  console.log('SHA-256:', sha256, '(calculado só pra conferência - o Hub calcula o dele próprio no upload)');
  console.log('\nSuba esse .zip em https://studio.blast.net.br (Nova extensão / Enviar nova versão).');
}

main();
