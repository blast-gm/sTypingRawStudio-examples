/**
 * Hello Extension - o exemplo mais simples possível de uma extensão do
 * sTraw Studio. Registra um item de menu e um comando que mostram um
 * diálogo, e escuta o evento de abertura de projeto pra logar algo.
 *
 * O único jeito de conversar com o app é através do objeto `studio`
 * recebido aqui - não há `require`, `process`, `fs` nem nenhum outro
 * global do Node disponível dentro de uma extensão.
 */
module.exports = function (studio) {
  function sayHello() {
    studio.dialog.show('Funcionou! 👋 Essa mensagem veio da Hello Extension.');
  }

  studio.menu.register({
    id: 'hello-extension.say-hello',
    name: 'Dizer olá',
    icon: 'stars',
    action: sayHello,
  });

  studio.commands.register({
    id: 'hello-extension.say-hello',
    name: 'Dizer olá',
    execute: sayHello,
  });

  studio.events.on('project.opened', (info) => {
    studio.log.info('projeto aberto:', info && info.title);
  });
};
