# Painter

Ferramenta de pintura livre na página - exemplo de referência pra
[`studio.draw`](https://studio.blast.net.br/docs/draw) e as
transformações novas de
[`studio.image`](https://studio.blast.net.br/docs/image-api)
(`resize`/`rotate`/`flip`/`blur`). Ao contrário do
[`smart-cleaner`](../smart-cleaner) (que resolve um problema
específico - limpeza de página via inpainting de IA), esta extensão é
deliberadamente simples: mostra cada função nova em uso de um jeito
direto, sem nenhum modelo `.onnx` nem lógica de negócio especial.

## Ferramentas

- **Pincel** - traço com espessura variável conforme a pressão da
  caneta (dispositivos sem caneta usam pressão fixa - ver nota abaixo).
- **Balde de tinta** - preenche a região conectada de cor parecida
  (tolerância ajustável).
- **Retângulo / Círculo / Linha** - formas básicas, com contorno e/ou
  preenchimento.
- **Girar 90° / Espelhar / Desfocar / Redimensionar** - transformações
  na imagem inteira (`studio.image`).

## Usando

1. Instale a extensão (ou teste pela [pasta de desenvolvimento](../../README.md#testando-os-exemplos-localmente)).
2. Menu **"Painter (pintura livre)"** abre o painel.
3. Clique em **"Carregar página atual"** pra editar a página aberta no
   editor, ou preencha largura/altura e clique em **"Criar"** (Tela em
   branco) pra começar do zero - uma tela em branco não é uma página do
   projeto, então "Salvar na página" fica desabilitado até você
   carregar uma página de verdade.
4. Escolha a ferramenta, cor(es) e espessura/tolerância, e desenhe.
5. Use os botões de transformação quando quiser (funcionam a qualquer
   momento, na imagem inteira atual).
6. **Ctrl+Z** desfaz o último traço/forma/transformação.
7. **"Salvar na página"** grava o resultado como a imagem `pages/` da
   página carregada, e recarrega o editor na hora
   (`studio.editor.refresh()`).

## Arquitetura (o que roda onde)

- **Painel** (`ui/app.js`): só a interação em tempo real - captura
  `pointerdown`/`pointermove`/`pointerup`, desenha uma prévia visual
  leve enquanto você arrasta (Canvas 2D comum do navegador). Nada disso
  usa `studio`.
- **`studio.draw`/`studio.image`**: só no fim de cada gesto (solta o
  mouse/caneta), o painel manda os dados brutos já capturados (pontos
  com pressão, ou os dois cantos de uma forma) pra `index.js`, que
  aplica de verdade via `studio.draw.stroke`/`floodFill`/`shape` ou
  `studio.image.rotate`/`flip`/`blur`/`resize` e devolve o resultado -
  processado com o **mesmo** motor de canvas (`@napi-rs/canvas`) usado
  pelo export de páginas do próprio app, garantindo que o que você vê
  desenhado é exatamente o que fica gravado.

## Nota sobre pressão

`event.pressure` do navegador só é confiável pra `pointerType === "pen"`
- mouse e a maioria das telas de toque reportam sempre `0.5` quando
  pressionados (fallback do próprio navegador pra hardware sem suporte
real), o que deixaria todo traço de mouse pela metade da espessura
escolhida. Por isso o painel força pressão `1` pra qualquer coisa que
não seja uma caneta de verdade - ver `readPressure()` em `ui/app.js`.
