# Page Translator

Detecta balões/texto numa página de quadrinho (modelo local,
[`ogkalu/comic-text-and-bubble-detector`](https://huggingface.co/ogkalu/comic-text-and-bubble-detector) -
RT-DETRv2 via ONNX Runtime, roda 100% localmente) e traduz - com dois
caminhos diferentes dependendo do que estiver configurado - **direto
num rascunho revisável**, sem alterar nada no projeto até você
confirmar.

- **Com uma chave [Gemini](https://aistudio.google.com/apikey)
  configurada**: manda o recorte de **todas** as regiões detectadas
  numa **única** chamada multimodal - o Gemini lê e traduz o texto
  direto da imagem, uma chamada por página inteira (não uma por balão,
  pra não gastar cota à toa). Funciona mesmo numa página só com `raw`,
  sem nenhum texto digitado ainda.
- **Sem chave nenhuma** (ou se a chamada ao Gemini falhar por qualquer
  motivo - cota, rede, chave inválida): cai automaticamente pro
  **tradutor gratuito** (`studio.translate.free`, sem chave nenhuma) -
  traduz, linha por linha, o **roteiro oficial já existente** da
  página (`script.traw`). Não dá pra "ler" texto de uma imagem sem um
  modelo de visão, então esse caminho só funciona se a página já tiver
  roteiro.

## Onde fica o resultado (rascunho → roteiro)

A tradução **não** é escrita direto nas caixas de texto da página. Ela
vai pra um **rascunho** (`translate.traw`, um arquivo irmão do
`script.traw`, dentro do próprio `.ztraw`) que:

- acumula página por página conforme você for traduzindo, durante a
  mesma sessão de trabalho;
- é salvo junto com o projeto (sobrevive a fechar/reabrir o app);
- fica visível e editável no painel da extensão, **à esquerda** - você
  pode revisar e corrigir o texto antes de qualquer coisa "valer";
- o roteiro **oficial** da página (`script.traw`, o mesmo texto do
  painel "Roteiro da página" do editor) fica **à direita**, também
  editável - clicar em **"Salvar roteiro"** grava o que estiver nessa
  caixa como o roteiro de verdade da página, e recarrega o editor na
  hora (`studio.editor.refresh()`) pra você ver o resultado sem
  precisar trocar de página nem reabrir o projeto.

Mostra praticamente toda a Extension API de IA/imagem/rascunho em uso:
`studio.image.detectText`, `studio.image.cropRegion`, `studio.ai.gemini`
(multimodal, várias imagens numa chamada), `studio.translate.free`,
`studio.project.readScript`/`writeScript`,
`studio.project.readTranslateDraft`/`writeTranslateDraft`,
`studio.editor.refresh`, `studio.project.getInfo` (lista de páginas,
pra navegação).

## Usando

1. Instale a extensão (ou teste pela [pasta de desenvolvimento](../../README.md#testando-os-exemplos-localmente)).
2. Menu **"Traduzir página"** abre o painel da extensão.
3. Na seção **Configurações** (recolhida por padrão): opcionalmente
   cole uma chave Gemini e escolha o idioma de destino (código curto,
   ex: `en`, `pt`, `ja`). Deixe a chave em branco pra usar só o
   tradutor gratuito.
4. Clique em **"Traduzir esta página"** - o rascunho (à esquerda) é
   gerado e salvo automaticamente.
5. Revise/edite o texto do rascunho à vontade - "Salvar rascunho" grava
   as edições sem tocar no roteiro oficial.
6. Copie o que quiser pro roteiro (à direita) e clique em **"Salvar
   roteiro"** pra aplicar de verdade na página.
7. Use **"◀ Anterior"** / **"Próxima ▶"** no topo do painel pra passar
   pelas páginas do projeto sem fechar a tela da extensão - dá pra ir
   traduzindo o projeto inteiro numa sessão só. "Recarregar" volta a
   mostrar a página que estiver aberta no editor no momento.

## Preparando o modelo (pra empacotar/testar)

O modelo (~44MB, variante quantizada int8) não fica neste repositório
- baixe ele com:

```bash
node examples/page-translator/download-model.js
```

Depois, pra gerar o `.zip` (mesma saída de sempre, `dist-extensions/`):

```bash
node examples/page-translator/build-package.js
```

## Notas técnicas

- O modelo tem 3 classes: `bubble` (balão inteiro), `text_bubble`
  (texto dentro de um balão) e `text_free` (texto solto, fora de
  balão) - só as duas últimas são usadas aqui (a primeira é só o
  contêiner, não o texto em si).
- `orig_target_sizes` (segundo input do modelo) espera
  `[largura, altura]`, apesar do nome sugerir "tamanho" genérico -
  confirmado testando contra o modelo de verdade, não documentado
  explicitamente em lugar nenhum.
- As regiões detectadas via Gemini viram uma linha de rascunho cada,
  ordenadas de cima pra baixo (posição vertical) - não é uma ordem de
  leitura "de quadrinho" completa (ex: direita-pra-esquerda em mangá),
  é só um ponto de partida razoável pra revisão manual.
