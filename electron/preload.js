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
      getAll:         (campaignId) => ipcRenderer.invoke('db:npcs:getAll', campaignId),
      getById:        (id)         => ipcRenderer.invoke('db:npcs:getById', id),
      getByLocation:  (locationId) => ipcRenderer.invoke('db:npcs:getByLocation', locationId),
      getByFaction:   (factionId)  => ipcRenderer.invoke('db:npcs:getByFaction', factionId),
      create:         (data)       => ipcRenderer.invoke('db:npcs:create', data),
      update:         (id, data)   => ipcRenderer.invoke('db:npcs:update', id, data),
      toggleAlive:    (id, isAlive)=> ipcRenderer.invoke('db:npcs:toggleAlive', id, isAlive),
      delete:         (id)         => ipcRenderer.invoke('db:npcs:delete', id),
    },
    locations: {
      getAll:      (campaignId)       => ipcRenderer.invoke('db:locations:getAll', campaignId),
      getById:     (id)               => ipcRenderer.invoke('db:locations:getById', id),
      getByType:   (campaignId, type) => ipcRenderer.invoke('db:locations:getByType', campaignId, type),
      create:      (data)             => ipcRenderer.invoke('db:locations:create', data),
      update:      (id, data)         => ipcRenderer.invoke('db:locations:update', id, data),
      delete:      (id)               => ipcRenderer.invoke('db:locations:delete', id),
    },
    factions: {
      getAll:   (campaignId) => ipcRenderer.invoke('db:factions:getAll', campaignId),
      getById:  (id)         => ipcRenderer.invoke('db:factions:getById', id),
      create:   (data)       => ipcRenderer.invoke('db:factions:create', data),
      update:   (id, data)   => ipcRenderer.invoke('db:factions:update', id, data),
      delete:   (id)         => ipcRenderer.invoke('db:factions:delete', id),
    },
    connections: {
      getAll:         (campaignId)           => ipcRenderer.invoke('db:connections:getAll', campaignId),
      getForEntity:   (entityType, entityId) => ipcRenderer.invoke('db:connections:getForEntity', entityType, entityId),
      create:         (data)                 => ipcRenderer.invoke('db:connections:create', data),
      update:         (id, data)             => ipcRenderer.invoke('db:connections:update', id, data),
      delete:         (id)                   => ipcRenderer.invoke('db:connections:delete', id),
    },
    maps: {
      getAll:         (campaignId)    => ipcRenderer.invoke('db:maps:getAll', campaignId),
      getById:        (id)            => ipcRenderer.invoke('db:maps:getById', id),
      create:         (data)          => ipcRenderer.invoke('db:maps:create', data),
      update:         (id, data)      => ipcRenderer.invoke('db:maps:update', id, data),
      updateImagePath:(id, imagePath) => ipcRenderer.invoke('db:maps:updateImagePath', id, imagePath),
      updateFog:      (id, fogData)   => ipcRenderer.invoke('db:maps:updateFog', id, fogData),
      updateTokens:   (id, tokens)    => ipcRenderer.invoke('db:maps:updateTokens', id, tokens),
      delete:         (id)            => ipcRenderer.invoke('db:maps:delete', id),
    },
    world: {
      search: (campaignId, query) => ipcRenderer.invoke('db:world:search', campaignId, query),
    },
    lore: {
      getAll:   (campaignId) => ipcRenderer.invoke('db:lore:getAll', campaignId),
      getById:  (id)         => ipcRenderer.invoke('db:lore:getById', id),
      create:   (data)       => ipcRenderer.invoke('db:lore:create', data),
      update:   (id, data)   => ipcRenderer.invoke('db:lore:update', id, data),
      delete:   (id)         => ipcRenderer.invoke('db:lore:delete', id),
    },
  },

  file: {
    openImageDialog:  ()              => ipcRenderer.invoke('file:openImageDialog'),
    copyMapImage:     (sourcePath)    => ipcRenderer.invoke('file:copyMapImage', sourcePath),
    readImageAsBase64:(filePath)      => ipcRenderer.invoke('file:readImageAsBase64', filePath),
    saveThumbnail:    (mapId, base64) => ipcRenderer.invoke('file:saveThumbnail', mapId, base64),
    readThumbnail:    (mapId)         => ipcRenderer.invoke('file:readThumbnail', mapId),
    // Convert an absolute local path → dmcs-asset:// URL (no IPC round-trip, no base64).
    // Uses encodeURI (preserves / and :) after normalising backslashes → forward slashes.
    // Handler in main.js decodes and reads the file, returning it as a Response.
    getLocalUrl: (filePath) => filePath
      ? 'dmcs-asset:///' + encodeURI(filePath.replace(/\\/g, '/'))
      : null,
  },

  srd: {
    seedAll:              ()        => ipcRenderer.invoke('srd:seedAll'),
    getMonsters:          (filters) => ipcRenderer.invoke('srd:getMonsters',        filters),
    getMonsterByIndex:    (index)   => ipcRenderer.invoke('srd:getMonsterByIndex',  index),
    getSpells:            (filters) => ipcRenderer.invoke('srd:getSpells',          filters),
    getSpellByIndex:      (index)   => ipcRenderer.invoke('srd:getSpellByIndex',    index),
    getEquipment:         (filters) => ipcRenderer.invoke('srd:getEquipment',       filters),
    getEquipmentByIndex:  (index)   => ipcRenderer.invoke('srd:getEquipmentByIndex',index),
    getCacheStats:        ()        => ipcRenderer.invoke('srd:getCacheStats'),
    onProgress:           (cb)      => ipcRenderer.on('srd:progress', (_event, data) => cb(data)),
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
