const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const DatabaseManager = require('./database');
const FileStorage = require('./fileStorage');

let mainWindow;
let database;
let fileStorage;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false
  });

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
    mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
  }
};

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');

  database = new DatabaseManager(path.join(userDataPath, 'filetracker.db'));
  await database.initialize();

  fileStorage = new FileStorage(path.join(userDataPath, 'storage'));
  await fileStorage.initialize();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// File operations
ipcMain.handle('files:getAll', async (event, searchParams) => {
  return await database.getAllFiles(searchParams);
});

ipcMain.handle('files:getById', async (event, id) => {
  return await database.getFileById(id);
});

ipcMain.handle('files:create', async (event, fileData) => {
  return await database.createFile(fileData);
});

ipcMain.handle('files:update', async (event, id, fileData) => {
  return await database.updateFile(id, fileData);
});

ipcMain.handle('files:delete', async (event, id) => {
  const scans = await database.getScansByFileId(id);
  for (const scan of scans) {
    await fileStorage.deleteFile(scan.filepath);
  }
  return await database.deleteFile(id);
});

// Scan operations
ipcMain.handle('scans:getByFileId', async (event, fileId) => {
  return await database.getScansByFileId(fileId);
});

ipcMain.handle('scans:upload', async (event, fileId, fileBuffer, filename, mimetype) => {
  // Convert ArrayBuffer to Buffer if needed
  const buffer = fileBuffer instanceof ArrayBuffer ? Buffer.from(fileBuffer) : fileBuffer;

  const filepath = await fileStorage.saveFile(buffer, filename);
  const scanData = {
    file_id: fileId,
    filename,
    filepath,
    mimetype,
    size: buffer.length
  };
  return await database.createScan(scanData);
});

ipcMain.handle('scans:delete', async (event, id) => {
  const scan = await database.getScanById(id);
  if (scan) {
    await fileStorage.deleteFile(scan.filepath);
  }
  return await database.deleteScan(id);
});

ipcMain.handle('scans:download', async (event, scanId) => {
  const scan = await database.getScanById(scanId);
  if (!scan) {
    throw new Error('Scan not found');
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: scan.filename,
    filters: [
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled) {
    const fileBuffer = await fileStorage.getFile(scan.filepath);
    await fs.writeFile(result.filePath, fileBuffer);
    return result.filePath;
  }
  return null;
});

ipcMain.handle('scans:getFileData', async (event, scanId) => {
  const scan = await database.getScanById(scanId);
  if (!scan) {
    throw new Error('Scan not found');
  }

  const fileBuffer = await fileStorage.getFile(scan.filepath);
  return {
    data: fileBuffer.toString('base64'),
    mimetype: scan.mimetype,
    filename: scan.filename
  };
});

ipcMain.handle('files:openScan', async (event, scanId) => {
  const scan = await database.getScanById(scanId);
  if (!scan) {
    throw new Error('Scan not found');
  }

  const { shell } = require('electron');
  const fullPath = await fileStorage.getFullPath(scan.filepath);
  shell.openPath(fullPath);
});

ipcMain.handle('dialog:showOpenDialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const fileBuffer = await fs.readFile(filePath);
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    let mimetype;
    if (['.pdf'].includes(ext)) {
      mimetype = 'application/pdf';
    } else if (['.jpg', '.jpeg'].includes(ext)) {
      mimetype = 'image/jpeg';
    } else if (['.png'].includes(ext)) {
      mimetype = 'image/png';
    } else if (['.gif'].includes(ext)) {
      mimetype = 'image/gif';
    } else {
      mimetype = 'application/octet-stream';
    }

    return {
      filename,
      data: fileBuffer,
      mimetype
    };
  }
  return null;
});

// Master File operations
ipcMain.handle('masterFiles:getAll', async (event, searchParams) => {
  return await database.getAllMasterFiles(searchParams);
});

ipcMain.handle('masterFiles:getAllSimple', async (event) => {
  return await database.getAllMasterFilesSimple();
});

ipcMain.handle('masterFiles:getById', async (event, id) => {
  return await database.getMasterFileById(id);
});

ipcMain.handle('masterFiles:create', async (event, masterFileData) => {
  return await database.createMasterFile(masterFileData);
});

ipcMain.handle('masterFiles:update', async (event, id, masterFileData) => {
  return await database.updateMasterFile(id, masterFileData);
});

ipcMain.handle('masterFiles:delete', async (event, id) => {
  return await database.deleteMasterFile(id);
});

// Export/Import operations
ipcMain.handle('data:export', async (event, exportType = 'full') => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Data',
      defaultPath: `filetracker-backup-${new Date().toISOString().split('T')[0]}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled) {
      const exportData = await database.exportData();
      await fs.writeFile(result.filePath, JSON.stringify(exportData, null, 2));

      return {
        success: true,
        filePath: result.filePath,
        message: 'Data exported successfully'
      };
    }
    return { success: false, message: 'Export cancelled' };
  } catch (error) {
    console.error('Export error:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('data:import', async (event, options = { overwrite: false }) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Data',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const importPath = result.filePaths[0];
      const importDataStr = await fs.readFile(importPath, 'utf8');
      const importData = JSON.parse(importDataStr);

      const importResults = await database.importData(importData, options);

      return {
        success: true,
        results: importResults,
        message: 'Data imported successfully'
      };
    }
    return { success: false, message: 'Import cancelled' };
  } catch (error) {
    console.error('Import error:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('files:exportBackup', async (event) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Create Full Backup',
      defaultPath: `filetracker-full-backup-${new Date().toISOString().split('T')[0]}.zip`,
      filters: [
        { name: 'ZIP Files', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled) {
      // Create a complete backup with both data and files
      const tempDataPath = path.join(app.getPath('temp'), `database-export-${Date.now()}.json`);
      const exportData = await database.exportData();
      await fs.writeFile(tempDataPath, JSON.stringify(exportData, null, 2));

      // Create backup with both database export and files
      const backupResult = await fileStorage.createBackupWithDatabase(result.filePath, tempDataPath);

      // Clean up temp file
      await fs.unlink(tempDataPath);

      return {
        success: true,
        filePath: result.filePath,
        totalBytes: backupResult.totalBytes,
        message: 'Full backup created successfully'
      };
    }
    return { success: false, message: 'Backup cancelled' };
  } catch (error) {
    console.error('Backup error:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('files:importBackup', async (event, options = { overwrite: false }) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Restore from Backup',
      filters: [
        { name: 'ZIP Files', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const backupPath = result.filePaths[0];

      // Restore files
      const fileResults = await fileStorage.restoreBackup(backupPath, options, database);

      return {
        success: true,
        results: {
          files: fileResults,
          databaseRestored: fileResults.databaseRestored,
          databaseFound: fileResults.databaseFound
        },
        message: 'Complete backup restored successfully'
      };
    }
    return { success: false, message: 'Restore cancelled' };
  } catch (error) {
    console.error('Restore error:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('storage:getStats', async (event) => {
  try {
    return await fileStorage.getStorageStats();
  } catch (error) {
    console.error('Storage stats error:', error);
    throw error;
  }
});

// Window controls
ipcMain.handle('window:minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});