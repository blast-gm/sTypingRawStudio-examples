module.exports = function (studio) {
  async function openEditor() {
    try {
      await studio.project.getInfo();
      studio.ui.openPanel({
        title: 'TRaw Editor',
        htmlFile: 'ui/index.html',
        async onMessage(payload) {
          switch (payload?.type) {
            case 'list':
              return await studio.project.traw.list();
            case 'read':
              return await studio.project.traw.read(payload.name);
            case 'create':
              await studio.project.traw.create(payload.name, payload.content ?? '');
              return await studio.project.traw.list();
            case 'write':
              await studio.project.traw.write(payload.name, payload.content ?? '');
              return true;
            case 'delete':
              await studio.project.traw.delete(payload.name);
              return await studio.project.traw.list();
            default:
              throw new Error(`Operação desconhecida: ${payload?.type || '(vazia)'}`);
          }
        },
      });
    } catch (error) {
      studio.dialog.show(error?.message || String(error));
    }
  }

  studio.menu.register({
    id: 'traw-editor.open',
    name: 'Abrir TRaw Editor',
    icon: 'file-earmark-text',
    action: openEditor,
  });
};
