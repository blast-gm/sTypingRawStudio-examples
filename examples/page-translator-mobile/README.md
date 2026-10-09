# Page Translator Mobile

Traduz o roteiro **já existente** de uma página, linha por linha, com
um tradutor gratuito (`studio.translate.free`) - **sem nenhuma IA**:
nenhum modelo local de visão, nenhuma chave, **sem depender do
Gemini** em nenhum momento. Por não precisar carregar modelo nenhum
(nem `.onnx` de detecção, nem chamada multimodal), é **rápida** -
pensada pra rodar bem até em celulares mais fracos, do mesmo jeito que
o [Page Translator](../page-translator) original é rápido no caminho
"sem chave" dele (esta extensão é, na prática, só esse caminho,
promovido a único).

## Por que não detecta balão na imagem

O [Page Translator](../page-translator) original detecta balões/texto
com um modelo local (RT-DETRv2, ~44MB) e, com uma chave Gemini
configurada, lê e traduz direto da imagem. Aqui não: sem visão
computacional nenhuma não dá pra "ler" texto de uma imagem - esta
extensão só traduz o que já estiver **digitado** no roteiro da página
(`script.traw`). Se a página ainda não tiver nenhum roteiro, não há o
que traduzir por esse caminho.

## Modo nuvem (opcional, desligado por padrão)

Só existe pra cobrir esse caso ("página só com `raw`, nada digitado
ainda"). Em vez de pedir pra cada pessoa configurar a própria chave
Gemini (o que o pedido original queria evitar), esse modo usa a
**mesma** API na nuvem já usada pelo
[Smart Cleaner Mobile](../smart-cleaner-mobile) (`straw-studio-ai-cloud`,
sessão autodestrutiva, sem chave nenhuma - rate limit por IP do lado do
servidor em vez de credencial) - só que com uma operação diferente:
`detect-text` em vez do fluxo genérico (`model`/`feeds`/`outputNames`)
usado pra rodar o MI-GAN. Essa operação detecta balão/texto (RT-DETRv2,
mesmo modelo local do Page Translator original) e lê o conteúdo (OCR,
via Tesseract) - modelos **abertos, auto-hospedados**, nenhuma IA
generativa de terceiros. A **tradução** do texto reconhecido continua
acontecendo localmente, pelo mesmo `studio.translate.free` de sempre -
o servidor nunca traduz nada, só devolve o texto original lido da
imagem.

Ative em **Configurações → "Detectar texto na nuvem (opcional)"**. A
**ordem de leitura dos balões** (ocidental ou mangá) também fica nas
configurações, mas só importa pra esse modo - sem detecção de imagem
nenhuma, o caminho padrão não tem balão nenhum pra ordenar. Precisa de
internet só quando usado; o caminho padrão (com roteiro já existente)
nunca toca rede nenhuma.

## Onde fica o resultado (rascunho → roteiro)

Mesmo padrão do Page Translator original - ver
[project-api.md](https://github.com/blast-gm/sTypingRawStudio/blob/main/docs/extensions/project-api.md#roteiro-oficial-vs-rascunho-translatetraw):
a tradução vai pra um rascunho (`translate.traw`) revisável/editável
no painel, à esquerda; o roteiro oficial (`script.traw`) fica à
direita, no mesmo formato de blocos do editor principal. Nada é
gravado no roteiro oficial até clicar em **"Salvar roteiro"**.

## Usando

1. Instale a extensão (ou teste pela [pasta de desenvolvimento](../../README.md#testando-os-exemplos-localmente) - esta não precisa baixar modelo nenhum).
2. Menu **"Traduzir página (Mobile)"** abre o painel.
3. Em **Configurações**, escolha o idioma de destino (ex: `en`, `pt`, `ja`).
4. Clique em **"Traduzir esta página"** - o rascunho é gerado e salvo
   automaticamente a partir do roteiro já existente.
5. Revise/edite o rascunho à vontade - **"Salvar rascunho"** grava as
   edições sem tocar no roteiro oficial.
6. **"Testar rascunho"** copia o rascunho pra área do roteiro só como
   prévia (sem gravar nada) - útil pra ver a formatação em blocos antes
   de confirmar.
7. **"Salvar roteiro"** aplica de verdade na página.
8. **"◀ Anterior" / "Próxima ▶"** navegam pelas páginas do projeto sem
   fechar o painel.

## Empacotando

```bash
node scripts/build-package.js examples/page-translator-mobile
```

Gera `dist-extensions/page-translator-mobile-<versão>.zip` - sem
modelo nenhum pra baixar antes (diferente do Page Translator
original), por não usar nenhum.
