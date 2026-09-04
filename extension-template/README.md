# Template de extensão do sTraw Studio

Ponto de partida oficial pra criar uma extensão do sTraw Studio. Copie
esta pasta inteira, renomeie e comece a editar `extension.json` e
`index.js`.

## Estrutura

```
minha-extensao/
├── extension.json   # manifesto - metadados, versão, permissões
├── index.js          # ponto de entrada - código que roda dentro do app
├── README.md
└── ui/                # reservado pra versões futuras (painéis customizados)
```

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
  escolha algo que não colida com outras extensões.
- `apiVersion`: sempre `"1.0"` hoje (a única versão da Extension API
  que existe). Se o app um dia tiver uma API 2.0, uma extensão que
  ainda pede `"1.0"` continua funcionando normalmente.
- `permissions`: veja a lista completa e o que cada uma libera em
  `docs/extensions/permissions.md`. Só peça o que você realmente usa -
  o app nega em runtime qualquer chamada pra uma permissão não
  declarada aqui.
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

Referência completa da API (`studio.menu`, `studio.commands`,
`studio.events`, `studio.dialog`, `studio.settings`, `studio.storage`,
`studio.project`, `studio.files`, `studio.image`, `studio.network`):
`docs/extensions/` no repositório principal do sTraw Studio.

## 3. Teste localmente

1. Empacote a pasta num `.zip` com `extension.json` e `index.js` na
   **raiz** do zip (não dentro de uma subpasta).
2. Adicione uma entrada apontando pra esse `.zip` num catálogo de
   extensões (o app usa `packages/electron/extensions-catalog.sample.json`
   como catálogo local por padrão - veja o exemplo da "Hello Extension"
   lá, incluindo como calcular o `sha256`).
3. Abra o sTraw Studio → aba **Extensões** → sua extensão aparece em
   "Disponíveis" → Instalar.

## 4. Publicar

Ainda não existe um servidor de distribuição público de extensões de
terceiros - por enquanto, distribua o `.zip` diretamente (ex: GitHub
Releases) e documente pra quem for instalar como apontar o catálogo
local pra ele. A arquitetura já está preparada pra um catálogo remoto
de verdade no futuro, sem mudar nada no formato do manifesto ou no
código da extensão.
