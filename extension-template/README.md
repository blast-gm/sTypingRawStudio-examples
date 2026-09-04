# Template de extensão do sTraw Studio

Ponto de partida oficial pra criar uma extensão do sTraw Studio. Copie
esta pasta inteira, renomeie e comece a editar `extension.json` e
`index.js`.

## Estrutura

```
minha-extensao/
├── extension.json    # manifesto - metadados, versao, permissoes
├── index.js           # ponto de entrada - codigo que roda dentro do app
├── README.md
└── ui/                 # opcional - painel customizado (canvas, formulario, etc.)
    ├── index.html
    ├── app.js
    └── style.css
```

A pasta `ui/` só é necessária se sua extensão abrir um painel próprio
via `studio.ui.openPanel()` (ver [ui.md](https://studio.blast.net.br/docs/ui))
- pra uma extensão simples que só registra itens de menu, pode apagar
essa pasta inteira.

## 1. Edite o manifesto (`extension.json`)

```json
{
  "id": "minha-extensao",
  "name": "Minha Extensão",
  "version": "1.0.0",
  "description": "O que ela faz.",
  "author": "Seu nome",
  "apiVersion": "1.0",
  "entry": "index.js",
  "icon": "puzzle",
  "permissions": [],
  "minAppVersion": "1.0.0"
}
```

- `id`: identificador único, minúsculo, só letras/números/hífen (ex:
  `smart-cleaner`). Vira o nome da pasta onde a extensão é instalada -
  escolha algo específico. Se, na hora de publicar, esse id já
  estiver em uso por outra conta, o [sTraw Hub](https://studio.blast.net.br)
  resolve sozinho adicionando um sufixo numérico.
- `apiVersion`: sempre `"1.0"` hoje (a única versão da Extension API
  que existe). Se o app um dia tiver uma API 2.0, uma extensão que
  ainda pede `"1.0"` continua funcionando normalmente.
- `permissions`: veja a lista completa e o que cada uma libera em
  [permissions.md](https://studio.blast.net.br/docs/permissions). Só
  peça o que você realmente usa - o app nega em runtime qualquer
  chamada pra uma permissão não declarada aqui.
- `minAppVersion` (opcional): versão mínima do sTraw Studio necessária.

## 2. Escreva o código (`index.js`)

```js
module.exports = function (studio) {
  studio.menu.register({
    id: 'minha-extensao.acao-principal',
    name: 'Minha Ação',
    icon: 'stars',
    action() {
      studio.dialog.show('Funcionou!');
    },
  });
};
```

Regras importantes:

- **Não existe `require()`.** O código roda isolado, sem acesso a
  Node/Electron cru - só o que `studio` expõe. Isso é proposital: não
  dá pra a extensão fazer `require('fs')` e ler qualquer arquivo do
  computador.
- **Não instale dependências NPM.** Uma extensão nunca roda `npm
  install`; tudo que ela pode usar já está em `studio`. Se você precisa
  de uma capacidade que não existe lá, ela ainda não é possível numa
  extensão - abra uma sugestão em vez de tentar contornar.
- **Trabalho pesado dentro de `action()`/`execute()`, nunca no topo do
  arquivo.** O topo do `index.js` roda uma vez, na ativação - deve só
  registrar menus/comandos/listeners rapidamente. Qualquer
  processamento pesado (ler um arquivo grande, chamar uma API) deve
  acontecer dentro do callback, disparado só quando a pessoa realmente
  usa a extensão.

Referência completa da API - documentação com busca em
[studio.blast.net.br/docs](https://studio.blast.net.br/docs):
`studio.menu`, `studio.commands`, `studio.events`, `studio.dialog`,
`studio.settings`, `studio.storage`, `studio.editor`, `studio.project`,
`studio.files`, `studio.image` (inpainting local com IA, GPU automática
via DirectML/WebGPU quando disponível), `studio.network`, `studio.ai`
(Gemini) e `studio.translate` (Google Translate + um tradutor gratuito
sem chave nenhuma).

## 3. Teste localmente - pasta de desenvolvimento

**Não precisa zipar nada nem editar nada do app pra testar.** Na aba
**Extensões** do sTraw Studio, seção "Em desenvolvimento", clique em
**"Escolher pasta..."** e aponte pra uma pasta que contenha, cada uma
na própria subpasta, as extensões que você está desenvolvendo:

```
minhas-extensoes-dev/
└── minha-extensao/       <- esta pasta (copiada/renomeada do template)
    ├── extension.json
    └── index.js
```

Toda subpasta com um `extension.json` válido fica ativa
automaticamente - dá pra testar várias extensões ao mesmo tempo, cada
uma com seus próprios itens de menu. Uma subpasta com problema aparece
marcada com o erro específico, em vez de simplesmente não aparecer.

Depois de mudar o código, clique em **"Recarregar"** - reativa tudo do
zero, sem precisar reiniciar o app. Se sua extensão editou algo na
página atual do projeto, `studio.editor.refresh()` (ou simplesmente
fechar a aba Extensões) atualiza a visualização sem precisar trocar de
página.

## 4. Publicar

Crie uma conta gratuita em [studio.blast.net.br](https://studio.blast.net.br/signup),
empacote a pasta num `.zip` (`extension.json` e `index.js` na **raiz**
do zip, não dentro de uma subpasta) e envie pelo painel - o `id`,
`version` e `apiVersion` são lidos automaticamente do seu
`extension.json`. Guia completo, incluindo como publicar atualizações:
[studio.blast.net.br/docs/publishing-an-extension](https://studio.blast.net.br/docs/publishing-an-extension).
