# sTypingRawStudio - Exemplos de extensão

Extensões de exemplo pro [sTraw Studio](https://github.com/blast-gm/sTypingRawStudio)
(app de typesetting de mangá/quadrinhos). Este repositório fica **separado**
do código principal do app de propósito: o app em si só precisa da
*engine* de extensões pra funcionar (isso mora no repo principal); as
extensões - inclusive as de exemplo - são conteúdo à parte, publicado e
instalado sob demanda, nunca embutido no instalador.

Se você quer só **usar** extensões prontas, não precisa deste
repositório - abra o app, aba **Extensões**, e instale direto de lá
(a lista vem do [sTraw Hub](https://studio.blast.net.br)). Este repo é
pra quem quer **entender como uma extensão é feita** ou **criar a
própria**.

## O que tem aqui

| Pasta | O que é |
|---|---|
| [`extension-template/`](./extension-template) | O ponto de partida pra criar uma extensão nova - a estrutura mínima, comentada, sem fazer nada de útil por si só. É o mesmo `.zip` oferecido como "extensão base" pra download no sTraw Hub. |
| [`examples/hello-extension/`](./examples/hello-extension) | O exemplo mais simples possível: registra um item de menu que mostra um diálogo. Duas dezenas de linhas, dá pra ler inteiro em um minuto. |
| [`examples/smart-cleaner/`](./examples/smart-cleaner) | Exemplo real e completo, em produção: limpa páginas de mangá (remove texto/marcas da imagem original) usando inpainting local com IA (modelo LaMa via ONNX Runtime), com um painel próprio (canvas de pintura interativo), pincel dinâmico e desfazer. Mostra praticamente toda a Extension API em uso: painel customizado, leitura/escrita de imagem do projeto, processamento de imagem, navegação entre páginas. |

## Como uma extensão funciona (resumo)

Uma extensão é uma pasta com um `extension.json` (manifesto) e um
arquivo de entrada (`index.js` por padrão) que exporta uma função
recebendo o objeto `studio` - a única forma de interagir com o app:

```js
module.exports = function (studio) {
  studio.menu.register({
    id: 'minha-extensao.ola',
    name: 'Dizer olá',
    action() {
      studio.dialog.show('Olá!');
    },
  });
};
```

Ela roda isolada (sandbox `vm`, sem `require`/`fs`/`process`), e só
consegue fazer o que a permissão declarada em `extension.json` libera.
A documentação completa - todos os campos do manifesto, cada módulo de
`studio`, permissões, segurança, como publicar - fica em
**[studio.blast.net.br/docs](https://studio.blast.net.br/docs)**.

## Rodando os exemplos localmente

Cada exemplo já é uma extensão pronta pra instalar - não precisa
"rodar" nada, só empacotar em `.zip` e apontar o app pra ele (ou fazer
upload no [sTraw Hub](https://studio.blast.net.br)).

```bash
npm install

# gera examples/hello-extension em dist-extensions/hello-extension-1.0.0.zip
npm run build:hello-extension

# gera examples/smart-cleaner em dist-extensions/smart-cleaner-1.0.0.zip
# (pede o caminho do modelo lama_fp32.onnx na primeira vez - ele NAO
# fica neste repo, é grande demais; baixe o modelo Carve/LaMa-ONNX
# a partir do Hugging Face: https://huggingface.co/Carve/LaMa-ONNX)
node examples/smart-cleaner/build-package.js "/caminho/para/lama_fp32.onnx"
```

Pra testar localmente sem publicar no Hub, edite o catálogo local do
app principal (`packages/electron/extensions-catalog.sample.json` no
repo do [sTraw Studio](https://github.com/blast-gm/sTypingRawStudio))
apontando `download` pro `.zip` gerado em `dist-extensions/`.

## Publicando sua própria extensão

1. Comece a partir de [`extension-template/`](./extension-template)
   (ou baixe direto em [studio.blast.net.br](https://studio.blast.net.br)).
2. Edite `extension.json` e `index.js` com a lógica da sua extensão.
3. Empacote tudo num `.zip` (`extension.json` **na raiz**, não dentro
   de uma subpasta).
4. Crie uma conta grátis em [studio.blast.net.br](https://studio.blast.net.br)
   e publique - o site lê `id`/`version`/`apiVersion` direto do seu
   `extension.json` automaticamente.

Guia completo: [studio.blast.net.br/docs](https://studio.blast.net.br/docs).

## Licença

Estes exemplos são fornecidos como referência de aprendizado para
quem quer criar extensões pro sTraw Studio - sinta-se livre pra usar
qualquer um deles como ponto de partida pro seu próprio projeto.
