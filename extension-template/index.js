/**
 * Ponto de entrada da extensão. O sTraw Studio chama esta função uma
 * única vez, quando a extensão é ativada, passando `studio` - o único
 * jeito de conversar com o app. Não existe `require`, `process`, `fs`
 * nem nenhum outro global do Node aqui dentro: tudo que você precisa
 * fazer passa por `studio`.
 *
 * Documentação completa da Extension API: docs/extensions/ no
 * repositório do sTraw Studio.
 */
module.exports = function (studio) {
  // Registra um item de menu - aparece na aba "Extensões", dentro do
  // card da sua extensão, como um botão clicável.
  studio.menu.register({
    id: 'my-extension.hello',
    name: 'Dizer olá',
    icon: 'stars', // nome de um ícone Bootstrap Icons, sem o prefixo "bi-"
    action() {
      studio.dialog.show('Olá! Minha extensão está funcionando.');
    },
  });

  // Comandos são parecidos com menus, mas não aparecem visíveis por
  // conta própria - servem pra ações que outras partes do app (ou
  // futuramente atalhos de teclado) podem invocar por id.
  studio.commands.register({
    id: 'my-extension.hello',
    name: 'Dizer olá',
    execute() {
      studio.dialog.show('Olá! Minha extensão está funcionando.');
    },
  });

  // Escute eventos de ciclo de vida do editor.
  studio.events.on('project.opened', (info) => {
    studio.log.info('Projeto aberto:', info.title);
  });

  // Exemplos de outras coisas disponíveis (descomente conforme
  // precisar - lembre de declarar a permissão correspondente em
  // extension.json antes de usar cada uma):
  //
  // const value = studio.settings.get('minhaOpcao');
  // studio.settings.set('minhaOpcao', true);
  //
  // const info = await studio.project.getInfo();              // permissão "project:read"
  // const layout = await studio.project.readLayout('01');      // permissão "project:read"
  // await studio.project.writeLayout('01', novoLayout);        // permissão "project:write"
  //
  // const file = await studio.files.pickAndReadFile();         // permissão "filesystem:read"
  //
  // const confirmou = await studio.dialog.confirm('Tem certeza?');
};
