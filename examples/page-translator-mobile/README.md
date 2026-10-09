# Page Translator Mobile

Traduz uma página com um tradutor gratuito (`studio.translate.free`) -
**sem nenhuma IA generativa**: nenhuma chave, **sem depender do
Gemini** em nenhum momento, em nenhum caminho. Segue a mesma ideia do
[Page Translator](../page-translator) original (tenta "enxergar" a
imagem primeiro, com fallback automático pro texto já existente) - só
que aqui, em vez do Gemini, quem lê a imagem é uma **nuvem própria**
(ver abaixo), e quem traduz é **sempre** o tradutor gratuito, sem
exceção:

- **Página já tem roteiro digitado** (`script.traw`): traduz ele
  direto, linha por linha - rápido, local, **sem tocar rede nenhuma**.
- **Página só tem imagem** (projeto com `raw`, nada digitado ainda):
  manda a imagem pra nuvem automaticamente (sem precisar ligar nada
  nas configurações) pra detectar balão/texto e ler o conteúdo, e
  traduz o que ela devolver.

## Modo nuvem (automático, não é opcional)

Entra sozinho sempre que a página não tiver roteiro nenhum ainda -
usa a **mesma** API na nuvem já usada pelo
[Smart Cleaner Mobile](../smart-cleaner-mobile) (`straw-studio-ai-cloud`,
sessão autodestrutiva, sem chave nenhuma - rate limit por IP do lado do
servidor em vez de credencial), só que com uma operação diferente:
`detect-text` em vez do fluxo genérico (`model`/`feeds`/`outputNames`)
usado pra rodar o MI-GAN. Essa operação detecta balão/texto (RT-DETRv2,
mesmo modelo local do Page Translator original, agora rodando no
servidor) e lê o conteúdo (OCR, via Tesseract) - modelos **abertos,
auto-hospedados**, nenhuma IA generativa de terceiros. A **tradução**
do texto reconhecido continua acontecendo sempre localmente, pelo
mesmo `studio.translate.free` - o servidor nunca traduz nada, só
devolve o texto original lido da imagem.

A **ordem de leitura dos balões** (ocidental ou mangá), nas
configurações, só importa pra esse modo - sem detecção de imagem,
não há balão nenhum pra ordenar. Se a página não tiver roteiro **nem**
imagem nenhuma, não há nada pra traduzir por nenhum caminho.

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
