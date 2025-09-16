const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  files: {
    getAll: (searchParams) => ipcRenderer.invoke('files:getAll', searchParams),
    getById: (id) => ipcRenderer.invoke('files:getById', id),
    create: (fileData) => ipcRenderer.invoke('files:create', fileData),
    update: (id, fileData) => ipcRenderer.invoke('files:update', id, fileData),
    delete: (id) => ipcRenderer.invoke('files:delete', id),
    openScan: (scanId) => ipcRenderer.invoke('files:openScan', scanId)
  },

  // Scan operations
  scans: {
    getByFileId: (fileId) => ipcRenderer.invoke('scans:getByFileId', fileId),
    upload: (fileId, fileBuffer, filename, mimetype) =>
      ipcRenderer.invoke('scans:upload', fileId, fileBuffer, filename, mimetype),
    delete: (id) => ipcRenderer.invoke('scans:delete', id),
    download: (scanId) => ipcRenderer.invoke('scans:download', scanId),
    getFileData: (scanId) => ipcRenderer.invoke('scans:getFileData', scanId)
  },

  // Dialog operations
  dialog: {
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options)
  },

  // Master File operations
  masterFiles: {
    getAll: (searchParams) => ipcRenderer.invoke('masterFiles:getAll', searchParams),
    getAllSimple: () => ipcRenderer.invoke('masterFiles:getAllSimple'),
    getById: (id) => ipcRenderer.invoke('masterFiles:getById', id),
    create: (masterFileData) => ipcRenderer.invoke('masterFiles:create', masterFileData),
    update: (id, masterFileData) => ipcRenderer.invoke('masterFiles:update', id, masterFileData),
    delete: (id) => ipcRenderer.invoke('masterFiles:delete', id)
  },

  // Export/Import operations
  data: {
    export: (exportType) => ipcRenderer.invoke('data:export', exportType),
    import: (options) => ipcRenderer.invoke('data:import', options)
  },

  // Backup/Restore operations
  backup: {
    create: () => ipcRenderer.invoke('files:exportBackup'),
    restore: (options) => ipcRenderer.invoke('files:importBackup', options),
    getStats: () => ipcRenderer.invoke('storage:getStats')
  },

  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  }
});