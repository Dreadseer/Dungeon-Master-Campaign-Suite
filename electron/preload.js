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
    mindmap: {
      getPositions:   (campaignId)          => ipcRenderer.invoke('db:mindmap:getPositions',  campaignId),
      savePosition:   (data)                => ipcRenderer.invoke('db:mindmap:savePosition',  data),
      savePositions:  (campaignId, positions) => ipcRenderer.invoke('db:mindmap:savePositions', campaignId, positions),
      clearPositions: (campaignId)          => ipcRenderer.invoke('db:mindmap:clearPositions', campaignId),
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
    compendium: {
      getAll:   (campaignId, type) => ipcRenderer.invoke('db:compendium:getAll',  campaignId, type),
      getById:  (id)               => ipcRenderer.invoke('db:compendium:getById', id),
      create:   (data)             => ipcRenderer.invoke('db:compendium:create',  data),
      update:   (id, data)         => ipcRenderer.invoke('db:compendium:update',  id, data),
      delete:   (id)               => ipcRenderer.invoke('db:compendium:delete',  id),
      search:   (campaignId, q)    => ipcRenderer.invoke('db:compendium:search',  campaignId, q),
    },
    encounters: {
      getAll:         (campaignId)            => ipcRenderer.invoke('db:encounters:getAll',         campaignId),
      getById:        (id)                    => ipcRenderer.invoke('db:encounters:getById',        id),
      create:         (data)                  => ipcRenderer.invoke('db:encounters:create',         data),
      update:         (id, data)              => ipcRenderer.invoke('db:encounters:update',         id, data),
      updateStatus:   (id, status)            => ipcRenderer.invoke('db:encounters:updateStatus',   id, status),
      updateMonsters: (id, monsters, xpTotal) => ipcRenderer.invoke('db:encounters:updateMonsters', id, monsters, xpTotal),
      delete:         (id)                    => ipcRenderer.invoke('db:encounters:delete',         id),
    },
    pdf: {
      getAll:            (campaignId)                        => ipcRenderer.invoke('db:pdf:getAll',            campaignId),
      getById:           (id)                                => ipcRenderer.invoke('db:pdf:getById',            id),
      create:            (data)                              => ipcRenderer.invoke('db:pdf:create',             data),
      updateStatus:      (id, status, chunkCount)            => ipcRenderer.invoke('db:pdf:updateStatus',       id, status, chunkCount),
      delete:            (id)                                => ipcRenderer.invoke('db:pdf:delete',             id),
      getChunks:         (sourceId)                          => ipcRenderer.invoke('db:pdf:getChunks',          sourceId),
      insertChunks:      (sourceId, chunks)                  => ipcRenderer.invoke('db:pdf:insertChunks',       sourceId, chunks),
      deleteChunks:      (sourceId)                          => ipcRenderer.invoke('db:pdf:deleteChunks',       sourceId),
      searchChunks:      (campaignId, query, limit)          => ipcRenderer.invoke('db:pdf:searchChunks',       campaignId, query, limit),
      getChunksBySource: (sourceId, offset, limit)           => ipcRenderer.invoke('db:pdf:getChunksBySource',  sourceId, offset, limit),
      getChunkContext:   (sourceId, chunkIndex, contextRadius) => ipcRenderer.invoke('db:pdf:getChunkContext',  sourceId, chunkIndex, contextRadius),
    },
    characters: {
      getAll:           (campaignId)             => ipcRenderer.invoke('db:characters:getAll',           campaignId),
      getById:          (id)                     => ipcRenderer.invoke('db:characters:getById',          id),
      create:           (data)                   => ipcRenderer.invoke('db:characters:create',           data),
      update:           (id, data)               => ipcRenderer.invoke('db:characters:update',           id, data),
      updateHP:         (id, hpCurrent)          => ipcRenderer.invoke('db:characters:updateHP',         id, hpCurrent),
      bulkUpdateHP:     (updates)               => ipcRenderer.invoke('db:characters:bulkUpdateHP',     updates),
      updateStats:      (id, stats)              => ipcRenderer.invoke('db:characters:updateStats',      id, stats),
      delete:           (id)                     => ipcRenderer.invoke('db:characters:delete',           id),
      addItem:          (charId, item)            => ipcRenderer.invoke('db:characters:addItem',         charId, item),
      removeItem:       (charId, itemId)          => ipcRenderer.invoke('db:characters:removeItem',      charId, itemId),
      updateItem:       (charId, itemId, changes) => ipcRenderer.invoke('db:characters:updateItem',      charId, itemId, changes),
      useSlot:          (charId, slotLevel)       => ipcRenderer.invoke('db:characters:useSlot',         charId, slotLevel),
      restoreSlot:      (charId, slotLevel)       => ipcRenderer.invoke('db:characters:restoreSlot',     charId, slotLevel),
      longRest:         (charId)                  => ipcRenderer.invoke('db:characters:longRest',        charId),
      addKnownSpell:    (charId, spell)           => ipcRenderer.invoke('db:characters:addKnownSpell',   charId, spell),
      removeKnownSpell: (charId, spellIndex)      => ipcRenderer.invoke('db:characters:removeKnownSpell',charId, spellIndex),
      updateCurrency:   (charId, currency)        => ipcRenderer.invoke('db:characters:updateCurrency',  charId, currency),
      updateAC:         (charId, updates)         => ipcRenderer.invoke('db:characters:updateAC',         charId, updates),
      setSubclass:      (charId, subclassName)    => ipcRenderer.invoke('db:characters:setSubclass',      charId, subclassName),
    },
    subclasses: {
      getByClass: (className)                    => ipcRenderer.invoke('db:subclasses:getByClass', className),
      getByName:  (className, subclassName)      => ipcRenderer.invoke('db:subclasses:getByName',  className, subclassName),
      getAll:     ()                             => ipcRenderer.invoke('db:subclasses:getAll'),
      create:     (data)                         => ipcRenderer.invoke('db:subclasses:create',     data),
      delete:     (id)                           => ipcRenderer.invoke('db:subclasses:delete',     id),
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
    saveExportedImage: (campaignName, dataUrl) =>
      ipcRenderer.invoke('file:saveExportedImage', campaignName, dataUrl),
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
    initialize:    ()                              => ipcRenderer.invoke('ai:initialize'),
    getMode:       ()                              => ipcRenderer.invoke('ai:getMode'),
    complete:      (systemPrompt, message)         => ipcRenderer.invoke('ai:complete',  systemPrompt, message),
    saveKey:       (key)                           => ipcRenderer.invoke('ai:saveKey',   key),
    deleteKey:     ()                              => ipcRenderer.invoke('ai:deleteKey'),
    hasKey:        ()                              => ipcRenderer.invoke('ai:hasKey'),
    ragQuery:      (question, campaignId, options) => ipcRenderer.invoke('ai:ragQuery',      question, campaignId, options),
    getUsageStats: (campaignId)                    => ipcRenderer.invoke('ai:getUsageStats', campaignId),
    clearUsageLog: (campaignId)                    => ipcRenderer.invoke('ai:clearUsageLog', campaignId),
    // Streaming — fire-and-forget send; results come back via chunk/done/error events
    streamStart:   (systemPrompt, messages, requestId) =>
      ipcRenderer.send('ai:stream:start', { systemPrompt, messages, requestId }),
    onStreamChunk: (cb) => ipcRenderer.on('ai:stream:chunk', (_e, data) => cb(data)),
    onStreamDone:  (cb) => ipcRenderer.on('ai:stream:done',  (_e, data) => cb(data)),
    onStreamError: (cb) => ipcRenderer.on('ai:stream:error', (_e, data) => cb(data)),
    offStream:     ()   => {
      ipcRenderer.removeAllListeners('ai:stream:chunk')
      ipcRenderer.removeAllListeners('ai:stream:done')
      ipcRenderer.removeAllListeners('ai:stream:error')
    },
  },

  pdf: {
    openDialog:      ()                              => ipcRenderer.invoke('pdf:openDialog'),
    ingest:          (campaignId, filePath)          => ipcRenderer.invoke('pdf:ingest',           campaignId, filePath),
    reIngest:        (sourceId)                      => ipcRenderer.invoke('pdf:reIngest',          sourceId),
    delete:          (sourceId, filePath)            => ipcRenderer.invoke('pdf:delete',            sourceId, filePath),
    onProgress:      (callback)                      => ipcRenderer.on('pdf:progress',    (_event, data) => callback(data)),
    offProgress:     (callback)                      => ipcRenderer.removeListener('pdf:progress', callback),
    extractChunk:    (chunkId, useAI)                => ipcRenderer.invoke('pdf:extractChunk',      chunkId, useAI),
    extractChunks:   (chunkIds, useAI)               => ipcRenderer.invoke('pdf:extractChunks',     chunkIds, useAI),
    semanticSearch:  (campaignId, query, topK)        => ipcRenderer.invoke('pdf:semanticSearch',    campaignId, query, topK),
    detectChunkType: (text)                          => ipcRenderer.invoke('pdf:detectChunkType',   text),
  },

  rag: {
    getSettings: ()         => ipcRenderer.invoke('rag:getSettings'),
    saveSettings:(settings) => ipcRenderer.invoke('rag:saveSettings', settings),
  },

  embed: {
    source:       (sourceId)            => ipcRenderer.invoke('embed:source',       sourceId),
    search:       (queryText, topK)     => ipcRenderer.invoke('embed:search',        queryText, topK),
    deleteSource: (sourceId)            => ipcRenderer.invoke('embed:deleteSource',  sourceId),
    getStatus:    ()                    => ipcRenderer.invoke('embed:getStatus'),
    onProgress:   (callback)            => ipcRenderer.on('embed:progress',   (_event, data) => callback(data)),
    offProgress:  (callback)            => ipcRenderer.removeListener('embed:progress', callback),
  },

  // ── Player window ──────────────────────────────────────────────────────────
  player: {
    openWindow:    (campaignId)  => ipcRenderer.invoke('player:openWindow',    campaignId),
    closeWindow:   ()            => ipcRenderer.invoke('player:closeWindow'),
    isOpen:        ()            => ipcRenderer.invoke('player:isOpen'),
    setFullScreen: (fullScreen)  => ipcRenderer.invoke('player:setFullScreen', fullScreen),
    broadcast:     (message)     => ipcRenderer.send('player:broadcast', message),
    onReceive:     (callback)    => ipcRenderer.on('player:receive', callback),
    offReceive:    (callback)    => ipcRenderer.removeListener('player:receive', callback),
  },
})
