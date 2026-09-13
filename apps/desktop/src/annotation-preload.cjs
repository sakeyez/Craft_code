// Only operation-scoped annotation messages are exposed to this sandbox.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('gameAnnotation', {
  onBegin: listener => {
    const wrapped = (_event, id) => { if (typeof id === 'string') listener(id) }
    ipcRenderer.on('annotation:begin', wrapped)
    return () => ipcRenderer.removeListener('annotation:begin', wrapped)
  },
  onReset: listener => {
    const wrapped = (_event, id) => { if (typeof id === 'string') listener(id) }
    ipcRenderer.on('annotation:reset', wrapped)
    return () => ipcRenderer.removeListener('annotation:reset', wrapped)
  },
  load: id => ipcRenderer.invoke('annotation:load', id),
  ready: id => ipcRenderer.invoke('annotation:ready', id),
  submit: (id, drafts) => ipcRenderer.invoke('annotation:submit', id, drafts),
  cancel: id => ipcRenderer.invoke('annotation:cancel', id),
})
