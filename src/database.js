const initSqlJs = require('sql.js');
const fs = require('fs').promises;
const path = require('path');

class DatabaseManager {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.SQL = null;
  }

  async initialize() {
    const dbDir = path.dirname(this.dbPath);
    try {
      await fs.access(dbDir);
    } catch {
      await fs.mkdir(dbDir, { recursive: true });
    }

    // Initialize sql.js
    this.SQL = await initSqlJs();

    // Try to load existing database
    let dbData = null;
    try {
      const fileBuffer = await fs.readFile(this.dbPath);
      dbData = new Uint8Array(fileBuffer);
    } catch (error) {
      // Database doesn't exist yet, will create new one
    }

    this.db = new this.SQL.Database(dbData);
    this.createTables();
    await this.saveDatabase();
    return this;
  }

  createTables() {
    // Create master_files table first
    const masterFilesTableSQL = `
      CREATE TABLE IF NOT EXISTS master_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create files table
    const filesTableSQL = `
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        reference_number TEXT,
        description TEXT,
        date_received TEXT,
        date_sent TEXT,
        tags TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const scansTableSQL = `
      CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        mimetype TEXT NOT NULL,
        size INTEGER NOT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
      )
    `;

    const triggerFilesSQL = `
      CREATE TRIGGER IF NOT EXISTS update_files_updated_at
      AFTER UPDATE ON files
      BEGIN
        UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `;

    const triggerMasterFilesSQL = `
      CREATE TRIGGER IF NOT EXISTS update_master_files_updated_at
      AFTER UPDATE ON master_files
      BEGIN
        UPDATE master_files SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END
    `;

    this.db.run(masterFilesTableSQL);
    this.db.run(filesTableSQL);
    this.db.run(scansTableSQL);
    this.db.run(triggerFilesSQL);
    this.db.run(triggerMasterFilesSQL);

    // Run migrations to add new columns
    this.runMigrations();
  }

  runMigrations() {
    // Check if master_file_id column exists, if not add it
    try {
      const stmt = this.db.prepare('SELECT master_file_id FROM files LIMIT 1');
      stmt.step();
      stmt.free();
    } catch (error) {
      // Column doesn't exist, add it
      try {
        this.db.run('ALTER TABLE files ADD COLUMN master_file_id INTEGER');
        console.log('Added master_file_id column to files table');
      } catch (alterError) {
        console.error('Failed to add master_file_id column:', alterError);
      }
    }
  }

  async saveDatabase() {
    const data = this.db.export();
    await fs.writeFile(this.dbPath, Buffer.from(data));
  }

  async getAllFiles(searchParams = {}) {
    const page = searchParams.page || 1;
    const limit = searchParams.limit || 10; // Default 10 records per page
    const showAll = searchParams.limit === 'all' || searchParams.limit === null;
    const offset = showAll ? 0 : (page - 1) * limit;

    let baseQuery = `
      SELECT f.*, m.name as master_file_name, COUNT(s.id) as scan_count
      FROM files f
      LEFT JOIN master_files m ON f.master_file_id = m.id
      LEFT JOIN scans s ON f.id = s.file_id
    `;

    let countQuery = `
      SELECT COUNT(DISTINCT f.id) as total
      FROM files f
      LEFT JOIN master_files m ON f.master_file_id = m.id
    `;

    const conditions = [];
    const params = {};

    if (searchParams.search) {
      conditions.push(`(
        f.title LIKE $search OR
        f.reference_number LIKE $search OR
        f.description LIKE $search OR
        f.tags LIKE $search OR
        f.date_received LIKE $search OR
        f.date_sent LIKE $search OR
        f.created_at LIKE $search OR
        f.updated_at LIKE $search
      )`);
      params.$search = `%${searchParams.search}%`;
    }

    if (searchParams.dateFrom) {
      conditions.push('f.date_received >= $dateFrom');
      params.$dateFrom = searchParams.dateFrom;
    }

    if (searchParams.dateTo) {
      conditions.push('f.date_received <= $dateTo');
      params.$dateTo = searchParams.dateTo;
    }

    if (searchParams.tags) {
      conditions.push('f.tags LIKE $tags');
      params.$tags = `%${searchParams.tags}%`;
    }

    if (searchParams.masterFileId && searchParams.masterFileId !== 'all') {
      conditions.push('f.master_file_id = $masterFileId');
      params.$masterFileId = searchParams.masterFileId;
    }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    // Get total count for pagination
    let totalCount = 0;
    const countStmt = this.db.prepare(countQuery + whereClause);
    if (Object.keys(params).length > 0) {
      countStmt.bind(params);
    }
    if (countStmt.step()) {
      totalCount = countStmt.getAsObject().total;
    }
    countStmt.free();

    // Get paginated results
    baseQuery += whereClause + ' GROUP BY f.id ORDER BY f.updated_at DESC';

    if (!showAll) {
      baseQuery += ' LIMIT $limit OFFSET $offset';
      params.$limit = limit;
      params.$offset = offset;
    }

    const stmt = this.db.prepare(baseQuery);
    stmt.bind(params);

    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    await this.saveDatabase();

    return {
      data: results,
      pagination: {
        page: showAll ? 1 : page,
        limit: showAll ? totalCount : limit,
        total: totalCount,
        totalPages: showAll ? 1 : Math.ceil(totalCount / limit),
        hasNext: showAll ? false : page < Math.ceil(totalCount / limit),
        hasPrev: showAll ? false : page > 1,
        showAll: showAll
      }
    };
  }

  async getFileById(id) {
    const stmt = this.db.prepare(`
      SELECT f.*, m.name as master_file_name
      FROM files f
      LEFT JOIN master_files m ON f.master_file_id = m.id
      WHERE f.id = $id
    `);
    stmt.bind({ $id: id });

    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();

    return result;
  }

  async createFile(fileData) {
    const {
      title,
      reference_number = '',
      description = '',
      date_received = '',
      date_sent = '',
      tags = '',
      master_file_id = null
    } = fileData;

    const stmt = this.db.prepare(`
      INSERT INTO files (title, reference_number, description, date_received, date_sent, tags, master_file_id)
      VALUES ($title, $reference_number, $description, $date_received, $date_sent, $tags, $master_file_id)
    `);

    stmt.run({
      $title: title,
      $reference_number: reference_number,
      $description: description,
      $date_received: date_received,
      $date_sent: date_sent,
      $tags: tags,
      $master_file_id: master_file_id
    });

    const idStmt = this.db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const id = idStmt.getAsObject().id;
    idStmt.free();

    await this.saveDatabase();
    return { id, ...fileData };
  }

  async updateFile(id, fileData) {
    const {
      title,
      reference_number = '',
      description = '',
      date_received = '',
      date_sent = '',
      tags = '',
      master_file_id = null
    } = fileData;

    const stmt = this.db.prepare(`
      UPDATE files
      SET title = $title, reference_number = $reference_number, description = $description,
          date_received = $date_received, date_sent = $date_sent, tags = $tags, master_file_id = $master_file_id
      WHERE id = $id
    `);

    stmt.run({
      $title: title,
      $reference_number: reference_number,
      $description: description,
      $date_received: date_received,
      $date_sent: date_sent,
      $tags: tags,
      $master_file_id: master_file_id,
      $id: id
    });

    await this.saveDatabase();
    return { id, ...fileData };
  }

  async deleteFile(id) {
    const stmt = this.db.prepare('DELETE FROM files WHERE id = $id');
    stmt.run({ $id: id });

    await this.saveDatabase();
    return { deletedId: id };
  }

  async getScansByFileId(fileId) {
    const stmt = this.db.prepare('SELECT * FROM scans WHERE file_id = $fileId ORDER BY uploaded_at DESC');
    stmt.bind({ $fileId: fileId });

    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    return results;
  }

  async getScanById(id) {
    const stmt = this.db.prepare('SELECT * FROM scans WHERE id = $id');
    stmt.bind({ $id: id });

    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();

    return result;
  }

  async createScan(scanData) {
    const { file_id, filename, filepath, mimetype, size } = scanData;

    const stmt = this.db.prepare(`
      INSERT INTO scans (file_id, filename, filepath, mimetype, size)
      VALUES ($file_id, $filename, $filepath, $mimetype, $size)
    `);

    stmt.run({
      $file_id: file_id,
      $filename: filename,
      $filepath: filepath,
      $mimetype: mimetype,
      $size: size
    });

    const idStmt = this.db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const id = idStmt.getAsObject().id;
    idStmt.free();

    await this.saveDatabase();
    return { id, ...scanData };
  }

  async deleteScan(id) {
    const stmt = this.db.prepare('DELETE FROM scans WHERE id = $id');
    stmt.run({ $id: id });

    await this.saveDatabase();
    return { deletedId: id };
  }

  // Master File operations
  async getAllMasterFiles(searchParams = {}) {
    const page = searchParams.page || 1;
    const limit = searchParams.limit || 10;
    const showAll = searchParams.limit === 'all' || searchParams.limit === null;
    const offset = showAll ? 0 : (page - 1) * limit;

    let baseQuery = 'SELECT * FROM master_files';
    let countQuery = 'SELECT COUNT(*) as total FROM master_files';

    const conditions = [];
    const params = {};

    if (searchParams.search) {
      conditions.push('(name LIKE $search OR description LIKE $search)');
      params.$search = `%${searchParams.search}%`;
    }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    // Get total count
    let totalCount = 0;
    const countStmt = this.db.prepare(countQuery + whereClause);
    if (Object.keys(params).length > 0) {
      countStmt.bind(params);
    }
    if (countStmt.step()) {
      totalCount = countStmt.getAsObject().total;
    }
    countStmt.free();

    // Get paginated results
    baseQuery += whereClause + ' ORDER BY name ASC';

    if (!showAll) {
      baseQuery += ' LIMIT $limit OFFSET $offset';
      params.$limit = limit;
      params.$offset = offset;
    }

    const stmt = this.db.prepare(baseQuery);
    stmt.bind(params);

    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    return {
      data: results,
      pagination: {
        page: showAll ? 1 : page,
        limit: showAll ? totalCount : limit,
        total: totalCount,
        totalPages: showAll ? 1 : Math.ceil(totalCount / limit),
        hasNext: showAll ? false : page < Math.ceil(totalCount / limit),
        hasPrev: showAll ? false : page > 1,
        showAll: showAll
      }
    };
  }

  // For backward compatibility and dropdowns - get all master files without pagination
  async getAllMasterFilesSimple() {
    const stmt = this.db.prepare('SELECT * FROM master_files ORDER BY name ASC');

    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    return results;
  }

  async getMasterFileById(id) {
    const stmt = this.db.prepare('SELECT * FROM master_files WHERE id = $id');
    stmt.bind({ $id: id });

    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();

    return result;
  }

  async createMasterFile(masterFileData) {
    const {
      name,
      description = ''
    } = masterFileData;

    const stmt = this.db.prepare(`
      INSERT INTO master_files (name, description)
      VALUES ($name, $description)
    `);

    stmt.run({
      $name: name,
      $description: description
    });

    const idStmt = this.db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const id = idStmt.getAsObject().id;
    idStmt.free();

    await this.saveDatabase();
    return { id, ...masterFileData };
  }

  async updateMasterFile(id, masterFileData) {
    const {
      name,
      description = ''
    } = masterFileData;

    const stmt = this.db.prepare(`
      UPDATE master_files
      SET name = $name, description = $description
      WHERE id = $id
    `);

    stmt.run({
      $name: name,
      $description: description,
      $id: id
    });

    await this.saveDatabase();
    return { id, ...masterFileData };
  }

  async deleteMasterFile(id) {
    const stmt = this.db.prepare('DELETE FROM master_files WHERE id = $id');
    stmt.run({ $id: id });

    await this.saveDatabase();
    return { deletedId: id };
  }

  async exportData() {
    // Export all data from the database
    const data = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      master_files: [],
      files: [],
      scans: []
    };

    // Export master files
    const masterFilesStmt = this.db.prepare('SELECT * FROM master_files ORDER BY id');
    while (masterFilesStmt.step()) {
      data.master_files.push(masterFilesStmt.getAsObject());
    }
    masterFilesStmt.free();

    // Export files
    const filesStmt = this.db.prepare('SELECT * FROM files ORDER BY id');
    while (filesStmt.step()) {
      data.files.push(filesStmt.getAsObject());
    }
    filesStmt.free();

    // Export scans metadata (without actual file data)
    const scansStmt = this.db.prepare('SELECT * FROM scans ORDER BY id');
    while (scansStmt.step()) {
      data.scans.push(scansStmt.getAsObject());
    }
    scansStmt.free();

    return data;
  }

  async importData(importData, options = { overwrite: false }) {
    if (!importData.version) {
      throw new Error('Invalid import data format');
    }

    const results = {
      master_files: { imported: 0, skipped: 0, errors: 0 },
      files: { imported: 0, skipped: 0, errors: 0 },
      scans: { imported: 0, skipped: 0, errors: 0 }
    };

    try {
      // Start transaction
      this.db.run('BEGIN TRANSACTION');

      // Import master files
      if (importData.master_files) {
        for (const masterFile of importData.master_files) {
          try {
            if (!options.overwrite) {
              // Check if master file with same name already exists
              const existingStmt = this.db.prepare('SELECT id FROM master_files WHERE name = $name');
              existingStmt.bind({ $name: masterFile.name });
              const existing = existingStmt.step();
              existingStmt.free();

              if (existing) {
                results.master_files.skipped++;
                continue;
              }
            }

            const stmt = this.db.prepare(`
              INSERT OR REPLACE INTO master_files (name, description, created_at, updated_at)
              VALUES ($name, $description, $created_at, $updated_at)
            `);
            stmt.run({
              $name: masterFile.name,
              $description: masterFile.description || '',
              $created_at: masterFile.created_at,
              $updated_at: masterFile.updated_at
            });
            results.master_files.imported++;
          } catch (error) {
            console.error('Error importing master file:', error);
            results.master_files.errors++;
          }
        }
      }

      // Import files
      if (importData.files) {
        for (const file of importData.files) {
          try {
            if (!options.overwrite) {
              // Check if file with same title and reference number already exists
              const existingStmt = this.db.prepare(
                'SELECT id FROM files WHERE title = $title AND reference_number = $reference_number'
              );
              existingStmt.bind({
                $title: file.title,
                $reference_number: file.reference_number || ''
              });
              const existing = existingStmt.step();
              existingStmt.free();

              if (existing) {
                results.files.skipped++;
                continue;
              }
            }

            const stmt = this.db.prepare(`
              INSERT OR REPLACE INTO files (
                title, reference_number, description, date_received, date_sent,
                tags, master_file_id, created_at, updated_at
              )
              VALUES (
                $title, $reference_number, $description, $date_received, $date_sent,
                $tags, $master_file_id, $created_at, $updated_at
              )
            `);
            stmt.run({
              $title: file.title,
              $reference_number: file.reference_number || '',
              $description: file.description || '',
              $date_received: file.date_received || '',
              $date_sent: file.date_sent || '',
              $tags: file.tags || '',
              $master_file_id: file.master_file_id,
              $created_at: file.created_at,
              $updated_at: file.updated_at
            });
            results.files.imported++;
          } catch (error) {
            console.error('Error importing file:', error);
            results.files.errors++;
          }
        }
      }

      // Import scans metadata (actual files will be handled separately)
      if (importData.scans) {
        for (const scan of importData.scans) {
          try {
            if (!options.overwrite) {
              // Check if scan with same filepath already exists
              const existingStmt = this.db.prepare('SELECT id FROM scans WHERE filepath = $filepath');
              existingStmt.bind({ $filepath: scan.filepath });
              const existing = existingStmt.step();
              existingStmt.free();

              if (existing) {
                results.scans.skipped++;
                continue;
              }
            }

            const stmt = this.db.prepare(`
              INSERT OR REPLACE INTO scans (
                file_id, filename, filepath, mimetype, size, uploaded_at
              )
              VALUES (
                $file_id, $filename, $filepath, $mimetype, $size, $uploaded_at
              )
            `);
            stmt.run({
              $file_id: scan.file_id,
              $filename: scan.filename,
              $filepath: scan.filepath,
              $mimetype: scan.mimetype,
              $size: scan.size,
              $uploaded_at: scan.uploaded_at
            });
            results.scans.imported++;
          } catch (error) {
            console.error('Error importing scan:', error);
            results.scans.errors++;
          }
        }
      }

      // Commit transaction
      this.db.run('COMMIT');
      await this.saveDatabase();

      return results;
    } catch (error) {
      // Rollback on error
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  async close() {
    if (this.db) {
      await this.saveDatabase();
      this.db.close();
    }
  }
}

module.exports = DatabaseManager;