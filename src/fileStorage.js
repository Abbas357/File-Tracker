const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('crypto');

class FileStorage {
  constructor(storagePath) {
    this.storagePath = storagePath;
  }

  async initialize() {
    try {
      await fs.access(this.storagePath);
    } catch {
      await fs.mkdir(this.storagePath, { recursive: true });
    }
  }

  async saveFile(fileBuffer, originalFilename) {
    const ext = path.extname(originalFilename);
    const uniqueFilename = `${this.generateUniqueId()}${ext}`;
    const filepath = path.join(this.storagePath, uniqueFilename);

    await fs.writeFile(filepath, fileBuffer);
    return uniqueFilename;
  }

  async getFile(filename) {
    const filepath = path.join(this.storagePath, filename);
    return await fs.readFile(filepath);
  }

  async deleteFile(filename) {
    const filepath = path.join(this.storagePath, filename);
    try {
      await fs.unlink(filepath);
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return false;
    }
  }

  async getFullPath(filename) {
    return path.join(this.storagePath, filename);
  }

  async createBackup(backupPath) {
    const archiver = require('archiver');
    const { createWriteStream } = require('fs');

    return new Promise((resolve, reject) => {
      const output = createWriteStream(backupPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve({
          success: true,
          totalBytes: archive.pointer(),
          message: `Backup created: ${backupPath}`
        });
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);
      archive.directory(this.storagePath, false);
      archive.finalize();
    });
  }

  async createBackupWithDatabase(backupPath, databasePath) {
    const archiver = require('archiver');
    const { createWriteStream } = require('fs');

    return new Promise((resolve, reject) => {
      const output = createWriteStream(backupPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve({
          success: true,
          totalBytes: archive.pointer(),
          message: `Complete backup created: ${backupPath}`
        });
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // Add all files from storage directory
      archive.directory(this.storagePath, 'files');

      // Add database export file
      archive.file(databasePath, { name: 'database.json' });

      archive.finalize();
    });
  }

  async restoreBackup(backupPath, options = { overwrite: false }, databaseInstance = null) {
    const extract = require('extract-zip');
    const path = require('path');

    try {
      // Create a temporary directory for extraction
      const tempDir = path.join(this.storagePath, '..', 'temp_restore');
      await fs.mkdir(tempDir, { recursive: true });

      // Extract the backup
      await extract(backupPath, { dir: tempDir });

      // Check if this is a complete backup (has database.json and files folder) or just files
      const tempContents = await fs.readdir(tempDir);
      const hasDatabase = tempContents.includes('database.json');
      const hasFilesFolder = tempContents.includes('files');

      const results = {
        restored: 0,
        skipped: 0,
        errors: 0,
        files: [],
        databaseRestored: false,
        databaseFound: hasDatabase
      };

      // Handle database restoration
      if (hasDatabase && databaseInstance) {
        try {
          const databasePath = path.join(tempDir, 'database.json');
          const databaseData = await fs.readFile(databasePath, 'utf-8');

          // Parse JSON first to catch parse errors
          let parsedData;
          try {
            parsedData = JSON.parse(databaseData);
          } catch (parseError) {
            throw new Error(`Invalid JSON in database.json: ${parseError.message}`);
          }

          // Validate the data structure
          if (!parsedData.version) {
            throw new Error('Database backup missing version information');
          }

          // Import the database data
          await databaseInstance.importData(parsedData, options);
          results.databaseRestored = true;
        } catch (error) {
          console.error('Error restoring database:', error);
          results.errors++;
          results.files.push({ filename: 'database.json', status: 'error', reason: error.message });
          // Don't set databaseRestored to false here - leave it as the default false
          // This way the calling code can distinguish between "no database found" and "database found but failed to restore"
        }
      } else if (hasDatabase && !databaseInstance) {
        // Database found but no instance provided (files-only restoration)
        results.files.push({ filename: 'database.json', status: 'skipped', reason: 'Database restoration not requested' });
      }

      // Handle files restoration
      const filesDir = hasFilesFolder ? path.join(tempDir, 'files') : tempDir;

      try {
        const tempFiles = await fs.readdir(filesDir);

        // Process each file
        for (const filename of tempFiles) {
          try {
            const tempFilePath = path.join(filesDir, filename);
            const stat = await fs.stat(tempFilePath);

            // Skip directories
            if (stat.isDirectory()) continue;

            const targetFilePath = path.join(this.storagePath, filename);

            // Check if file already exists
            if (!options.overwrite) {
              try {
                await fs.access(targetFilePath);
                results.skipped++;
                results.files.push({ filename, status: 'skipped', reason: 'File already exists' });
                continue;
              } catch {
                // File doesn't exist, proceed with restore
              }
            }

            // Copy file from temp to storage
            await fs.copyFile(tempFilePath, targetFilePath);
            results.restored++;
            results.files.push({ filename, status: 'restored' });

          } catch (error) {
            console.error(`Error restoring file ${filename}:`, error);
            results.errors++;
            results.files.push({ filename, status: 'error', reason: error.message });
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Error reading files directory:', error);
        }
      }

      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true });

      return results;
    } catch (error) {
      throw new Error(`Failed to restore backup: ${error.message}`);
    }
  }

  async exportFiles(exportPath, filenames = null) {
    const archiver = require('archiver');
    const { createWriteStream } = require('fs');

    return new Promise(async (resolve, reject) => {
      const output = createWriteStream(exportPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve({
          success: true,
          totalBytes: archive.pointer(),
          message: `Files exported: ${exportPath}`
        });
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      try {
        if (filenames && filenames.length > 0) {
          // Export specific files
          for (const filename of filenames) {
            const filePath = path.join(this.storagePath, filename);
            try {
              await fs.access(filePath);
              archive.file(filePath, { name: filename });
            } catch (error) {
              console.warn(`File not found: ${filename}`);
            }
          }
        } else {
          // Export all files
          archive.directory(this.storagePath, false);
        }

        archive.finalize();
      } catch (error) {
        reject(error);
      }
    });
  }

  async importFiles(importPath, options = { overwrite: false }) {
    // Files-only import (no database restoration)
    return await this.restoreBackup(importPath, options, null);
  }

  async getStorageStats() {
    try {
      const files = await fs.readdir(this.storagePath);
      let totalSize = 0;
      const fileStats = [];

      for (const filename of files) {
        try {
          const filePath = path.join(this.storagePath, filename);
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
          fileStats.push({
            filename,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
          });
        } catch (error) {
          console.warn(`Error reading stats for ${filename}:`, error);
        }
      }

      return {
        totalFiles: files.length,
        totalSize,
        files: fileStats
      };
    } catch (error) {
      throw new Error(`Failed to get storage stats: ${error.message}`);
    }
  }

  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

module.exports = FileStorage;