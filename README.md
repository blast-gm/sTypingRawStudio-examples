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
| [`examples/smart-cleaner/`](./examples/smart-cleaner) | Exemplo real e completo, em produção: limpa páginas de mangá (remove texto/marcas da imagem original) usando inpainting local com IA (modelo LaMa via ONNX Runtime, GPU automática via DirectML/WebGPU quando disponível), com um painel próprio (canvas de pintura interativo), pincel dinâmico e desfazer. Mostra praticamente toda a Extension API em uso: painel customizado, leitura/escrita de imagem do projeto, processamento de imagem, navegação entre páginas. |
| [`examples/page-translator/`](./examples/page-translator) | Detecta balão/texto numa página (modelo local RT-DETRv2) e traduz - via Gemini (lê e traduz direto da imagem, uma chamada por página inteira) com fallback automático pra um tradutor gratuito sem chave nenhuma (traduzindo o texto já existente na página) se não houver chave ou a chamada falhar. Mostra `studio.image.detectText`/`cropRegion`, `studio.ai.gemini` (multimodal, várias imagens numa chamada), `studio.translate.free`, e `studio.editor.refresh`. |

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

## Testando os exemplos localmente

**Não precisa empacotar nada nem editar nada do app.** Cada pasta em
`examples/` (e `extension-template/`) já é uma extensão pronta -
clone este repositório e, na aba **Extensões** do sTraw Studio, use
**"Escolher pasta..."** (seção "Em desenvolvimento") apontando pra
`examples/` (ou pra este repositório inteiro) - toda subpasta com um
`extension.json` válido fica ativa automaticamente, dá pra testar
várias ao mesmo tempo. Depois de qualquer mudança, **"Recarregar"**
reativa tudo sem precisar reiniciar o app. Guia completo:
[studio.blast.net.br/docs/creating-an-extension](https://studio.blast.net.br/docs/creating-an-extension#4-teste-localmente---pasta-de-desenvolvimento).

`examples/smart-cleaner` e `examples/page-translator` são exceção - os
modelos de IA deles não ficam neste repo (grandes demais pro git):

```bash
# smart-cleaner (~200MB, precisa baixar manualmente - ver o README da pasta)
# page-translator (~44MB, baixa sozinho):
node examples/page-translator/download-model.js
```

## Empacotando (pra publicar)

Só quando for publicar de verdade - até lá, o teste local acima já é
suficiente pro ciclo de desenvolvimento inteiro.

Um único script genérico (`scripts/build-package.js`) empacota
**qualquer** pasta de extensão - o nome/versão do `.zip` de saída vem
sempre do `id`/`version` do próprio `extension.json` da pasta
informada, nunca precisa ser digitado à mão:

```bash
npm install

# uso geral - funciona pra qualquer extensao, mesmo uma nova sem
# nenhum script proprio no package.json:
node scripts/build-package.js <pasta-da-extensao> [caminho-do-modelo-pra-copiar]

# gera dist-extensions/hello-extension-<versão>.zip
npm run build:hello-extension

# gera dist-extensions/smart-cleaner-<versão>.zip (o 2º argumento,
# opcional, copia o modelo pra models/ antes de empacotar - so precisa
# na primeira vez, ou se o modelo ainda nao estiver la)
npm run build:smart-cleaner -- "/caminho/para/lama_fp32.onnx"

# gera dist-extensions/page-translator-<versão>.zip
npm run build:page-translator
```

Depois de subir a versão em `extension.json`, é só rodar o build de
novo - o nome do `.zip` já sai certo, sem precisar editar nada no
script.

## Publicando sua própria extensão

1. Comece a partir de [`extension-template/`](./extension-template)
   (ou baixe direto em [studio.blast.net.br](https://studio.blast.net.br)).
2. Edite `extension.json` e `index.js` com a lógica da sua extensão,
   testando pela [pasta de desenvolvimento](#testando-os-exemplos-localmente)
   até estar satisfeito.
3. Empacote tudo num `.zip` (`extension.json` **na raiz**, não dentro
   de uma subpasta) - ou só um `index.js`, se preferir: o Hub gera um
   `extension.json` automaticamente a partir do título que você
   preencher no upload.
4. Crie uma conta grátis em [studio.blast.net.br](https://studio.blast.net.br)
   e publique - o site lê `id`/`version`/`apiVersion` direto do seu
   `extension.json` automaticamente (ou do que ele mesmo gerou).

Guia completo: [studio.blast.net.br/docs](https://studio.blast.net.br/docs).

## Licença

Estes exemplos são fornecidos como referência de aprendizado para
quem quer criar extensões pro sTraw Studio - sinta-se livre pra usar
qualquer um deles como ponto de partida pro seu próprio projeto.
