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

## Onde fica o resultado (rascunho → confirmar)

A tradução **não** é escrita direto no roteiro oficial nem nas caixas
de texto da página. Ela vai pra um **rascunho** (`translate.traw`, um
arquivo irmão do `script.traw`, dentro do próprio `.ztraw`) que:

- acumula página por página conforme você for traduzindo, durante a
  mesma sessão de trabalho;
- é salvo junto com o projeto (sobrevive a fechar/reabrir o app);
- fica visível e editável no painel da extensão - você pode revisar e
  corrigir o texto antes de qualquer coisa "valer";
- só passa a ser o roteiro **oficial** da página quando você clica em
  **"Confirmar → aplicar no roteiro"**, que grava no `script.traw` de
  verdade (o mesmo texto do painel "Roteiro da página" do editor).

Mostra praticamente toda a Extension API de IA/imagem/rascunho em uso:
`studio.image.detectText`, `studio.image.cropRegion`, `studio.ai.gemini`
(multimodal, várias imagens numa chamada), `studio.translate.free`,
`studio.project.readScript`/`writeScript`,
`studio.project.readTranslateDraft`/`writeTranslateDraft`,
`studio.editor.refresh`.

## Usando

1. Instale a extensão (ou teste pela [pasta de desenvolvimento](../../README.md#testando-os-exemplos-localmente)).
2. Menu **"Traduzir página"** abre o painel da extensão.
3. Na seção **Configurações** (recolhida por padrão): opcionalmente
   cole uma chave Gemini e escolha o idioma de destino (código curto,
   ex: `en`, `pt`, `ja`). Deixe a chave em branco pra usar só o
   tradutor gratuito.
4. Clique em **"Traduzir esta página"** - o rascunho é gerado e salvo
   automaticamente.
5. Revise/edite o texto na caixa "Rascunho de tradução" à vontade -
   "Salvar rascunho" grava as edições sem tocar no roteiro oficial.
6. Quando estiver satisfeito, clique em **"Confirmar → aplicar no
   roteiro"** pra promover o rascunho ao `script.traw` oficial.
7. Ao trocar de página no editor, clique em **"Recarregar"** no topo do
   painel pra carregar o roteiro/rascunho da página atual (o painel não
   acompanha a navegação automaticamente).

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
