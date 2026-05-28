const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('app:version'),

  db: {
    campaigns: {
      getAll:   ()         => ipcRenderer.invoke('db:campaigns:getAll'),
      getById:  (id)       => ipcRenderer.invoke('db:campaigns:getById', id),
      create:   (data)     => ipcRenderer.invoke('db:campaigns:create', data),
      update:   (id, data) => ipcRenderer.invoke('db:campaigns:update', id, data),
      delete:   (id)       => ipcRenderer.invoke('db:campaigns:delete', id),
    },
    npcs: {
      getAll:   (campaignId) => ipcRenderer.invoke('db:npcs:getAll', campaignId),
      create:   (data)       => ipcRenderer.invoke('db:npcs:create', data),
      update:   (id, data)   => ipcRenderer.invoke('db:npcs:update', id, data),
      delete:   (id)         => ipcRenderer.invoke('db:npcs:delete', id),
    },
    locations: {
      getAll:   (campaignId) => ipcRenderer.invoke('db:locations:getAll', campaignId),
      create:   (data)       => ipcRenderer.invoke('db:locations:create', data),
      update:   (id, data)   => ipcRenderer.invoke('db:locations:update', id, data),
      delete:   (id)         => ipcRenderer.invoke('db:locations:delete', id),
    },
    connections: {
      getAll:   (campaignId) => ipcRenderer.invoke('db:connections:getAll', campaignId),
      create:   (data)       => ipcRenderer.invoke('db:connections:create', data),
      delete:   (id)         => ipcRenderer.invoke('db:connections:delete', id),
    },
  },

  srd: {
    seedAll:       ()        => ipcRenderer.invoke('srd:seedAll'),
    getMonsters:   (filters) => ipcRenderer.invoke('srd:getMonsters', filters),
    getSpells:     (filters) => ipcRenderer.invoke('srd:getSpells', filters),
    getEquipment:  (filters) => ipcRenderer.invoke('srd:getEquipment', filters),
    getCacheStats: ()        => ipcRenderer.invoke('srd:getCacheStats'),
    onProgress:    (cb)      => ipcRenderer.on('srd:progress', (_event, data) => cb(data)),
  },

  ai: {
    initialize:  ()                      => ipcRenderer.invoke('ai:initialize'),
    getMode:     ()                      => ipcRenderer.invoke('ai:getMode'),
    complete:    (systemPrompt, message) => ipcRenderer.invoke('ai:complete', systemPrompt, message),
    saveKey:     (key)                   => ipcRenderer.invoke('ai:saveKey', key),
    deleteKey:   ()                      => ipcRenderer.invoke('ai:deleteKey'),
    hasKey:      ()                      => ipcRenderer.invoke('ai:hasKey'),
  },
})
