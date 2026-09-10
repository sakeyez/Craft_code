// This window has no project commands, filesystem access or arbitrary IPC bridge.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('gameAnnotation', {
  load: () => ipcRenderer.invoke('annotation:load'),
  ready: () => ipcRenderer.invoke('annotation:ready'),
  submit: drafts => ipcRenderer.invoke('annotation:submit', drafts),
  cancel: () => ipcRenderer.invoke('annotation:cancel'),
})
