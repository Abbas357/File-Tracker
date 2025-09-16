class FileTrackerApp {
    constructor() {
        this.currentPage = 'dashboard';
        this.currentFile = null;
        this.files = [];
        this.masterFiles = [];
        this.isEditing = false;
        this.editingId = null;
        this.editingType = null; // 'file' or 'masterFile'
        this.selectedFile = null;

        // Pagination state
        this.pagination = {
            dashboard: { page: 1, limit: 10, total: 0, totalPages: 0 },
            documents: { page: 1, limit: 10, total: 0, totalPages: 0 },
            masterFiles: { page: 1, limit: 10, total: 0, totalPages: 0 }
        };

        this.initializeApp();
    }

    async initializeApp() {
        this.bindEvents();
        await this.loadMasterFiles();
        await this.loadFiles();
        this.loadTheme();
    }

    bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const page = e.target.getAttribute('data-page');
                console.log('Navigation clicked:', page); // Debug log
                await this.navigateToPage(page);
            });
        });

        // About button
        document.getElementById('aboutBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('About button clicked'); // Debug log
            this.showAboutModal();
        });
        document.getElementById('closeAboutModal')?.addEventListener('click', () => this.hideAboutModal());

        // Theme toggle
        document.getElementById('themeToggle')?.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Theme toggle clicked'); // Debug log
            this.toggleTheme();
        });

        // Search functionality
        document.getElementById('searchBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Search button clicked'); // Debug log
            this.searchFiles();
        });
        document.getElementById('clearBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Clear button clicked'); // Debug log
            this.clearSearch();
        });
        document.getElementById('globalSearch')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchFiles();
        });

        // Add buttons
        document.getElementById('addFileFromDocuments')?.addEventListener('click', async (e) => {
            e.preventDefault();
            console.log('Add file button clicked'); // Debug log
            await this.navigateToPage('add-file');
        });
        document.getElementById('addMasterFileFromPage')?.addEventListener('click', async (e) => {
            e.preventDefault();
            console.log('Add master file button clicked'); // Debug log
            await this.navigateToPage('add-master-file');
        });

        // Form submissions
        document.getElementById('fileForm').addEventListener('submit', (e) => this.handleFileFormSubmit(e));
        document.getElementById('masterFileForm').addEventListener('submit', (e) => this.handleMasterFileFormSubmit(e));

        // Cancel buttons
        document.getElementById('cancelFileForm').addEventListener('click', async () => await this.navigateToPage('dashboard'));
        document.getElementById('cancelFileFormBtn').addEventListener('click', async () => await this.navigateToPage('dashboard'));
        document.getElementById('cancelMasterFileForm').addEventListener('click', async () => await this.navigateToPage('master-files'));
        document.getElementById('cancelMasterFileFormBtn').addEventListener('click', async () => await this.navigateToPage('master-files'));

        // File upload
        this.setupFileUpload();

        // Modal close events
        document.getElementById('closeFileDetailModal').addEventListener('click', () => this.hideFileDetailModal());
        document.getElementById('closePreviewModal').addEventListener('click', () => this.hidePreviewModal());

        // Pagination event handlers
        this.setupPaginationEvents();

        // Backup and restore functionality
        document.getElementById('refreshStatsBtn')?.addEventListener('click', () => this.loadStorageStats());
        document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportData());
        document.getElementById('importDataBtn')?.addEventListener('click', () => this.importData());
        document.getElementById('createBackupBtn')?.addEventListener('click', () => this.createBackup());
        document.getElementById('restoreBackupBtn')?.addEventListener('click', () => this.restoreBackup());

        // Global drag and drop prevention (but allow normal interactions)
        document.addEventListener('dragover', (e) => {
            // Only prevent drag over if not in upload area
            if (!e.target.closest('#uploadArea')) {
                e.preventDefault();
            }
        });
        document.addEventListener('drop', (e) => {
            // Only prevent drop if not in upload area
            if (!e.target.closest('#uploadArea')) {
                e.preventDefault();
            }
        });
    }

    setupFileUpload() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const selectedFileDiv = document.getElementById('selectedFile');
        const selectedFileName = document.getElementById('selectedFileName');
        const removeFileBtn = document.getElementById('removeFile');

        uploadArea.addEventListener('click', () => fileInput.click());

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelection(files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileSelection(e.target.files[0]);
            }
        });

        removeFileBtn.addEventListener('click', () => {
            this.selectedFile = null;
            selectedFileDiv.classList.add('hidden');
            fileInput.value = '';
        });
    }

    handleFileSelection(file) {
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            this.showMessage('Please select a PDF or image file (JPG, PNG, GIF)', 'error');
            return;
        }

        if (file.size > 50 * 1024 * 1024) { // 50MB limit
            this.showMessage('File size must be less than 50MB', 'error');
            return;
        }

        this.selectedFile = file;
        document.getElementById('selectedFileName').textContent = file.name;
        document.getElementById('selectedFile').classList.remove('hidden');
    }

    async navigateToPage(page) {
        // Update navigation
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

        // Update pages
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(`${page}-page`).classList.add('active');

        this.currentPage = page;

        // Load page-specific data
        if (page === 'documents') {
            this.loadDocumentsPage();
        } else if (page === 'master-files') {
            this.loadMasterFilesPage();
        } else if (page === 'add-file') {
            await this.setupFileForm();
        } else if (page === 'add-master-file') {
            this.setupMasterFileForm();
        } else if (page === 'backup-restore') {
            await this.loadBackupRestorePage();
        }
    }

    async loadFiles(searchParams = {}, pageType = 'dashboard') {
        try {
            this.showLoading('filesList');

            // Merge pagination parameters with search parameters
            const params = {
                ...searchParams,
                page: this.pagination[pageType].page,
                limit: this.pagination[pageType].limit
            };

            const result = await window.electronAPI.files.getAll(params);

            // Update pagination state
            this.pagination[pageType] = {
                ...this.pagination[pageType],
                ...result.pagination
            };

            this.files = result.data;
            this.renderFilesList('filesList');
            this.renderPagination(pageType);
        } catch (error) {
            this.showMessage('Failed to load files: ' + error.message, 'error');
        }
    }

    async loadDocumentsPage() {
        try {
            this.showLoading('documentsFilesList');

            const params = {
                page: this.pagination.documents.page,
                limit: this.pagination.documents.limit
            };

            const result = await window.electronAPI.files.getAll(params);

            // Update pagination state
            this.pagination.documents = {
                ...this.pagination.documents,
                ...result.pagination
            };

            this.renderFilesList('documentsFilesList', result.data);
            this.renderPagination('documents');
        } catch (error) {
            this.showMessage('Failed to load documents: ' + error.message, 'error');
        }
    }

    async loadMasterFiles() {
        try {
            this.masterFiles = await window.electronAPI.masterFiles.getAllSimple();
            this.updateMasterFileSelects();
        } catch (error) {
            this.showMessage('Failed to load master files: ' + error.message, 'error');
        }
    }

    async loadMasterFilesPage() {
        try {
            const tableBody = document.getElementById('masterFilesTableBody');
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center"><div class="loading">Loading master files...</div></td></tr>';

            const params = {
                page: this.pagination.masterFiles.page,
                limit: this.pagination.masterFiles.limit
            };

            const result = await window.electronAPI.masterFiles.getAll(params);

            // Update pagination state
            this.pagination.masterFiles = {
                ...this.pagination.masterFiles,
                ...result.pagination
            };

            this.renderMasterFilesTable(result.data);
            this.renderPagination('masterFiles');
        } catch (error) {
            this.showMessage('Failed to load master files: ' + error.message, 'error');
        }
    }

    updateMasterFileSelects() {
        const selects = [document.getElementById('masterFileFilter'), document.getElementById('masterFileSelect')];

        selects.forEach(select => {
            if (!select) return;

            const currentValue = select.value;
            const isFilter = select.id === 'masterFileFilter';

            select.innerHTML = isFilter ? '<option value="all">All Master Files</option>' : '<option value="">Select a master file (optional)</option>';

            this.masterFiles.forEach(mf => {
                const option = document.createElement('option');
                option.value = mf.id;
                option.textContent = mf.name;
                select.appendChild(option);
            });

            select.value = currentValue;
        });
    }

    renderFilesList(containerId, files = null) {
        const container = document.getElementById(containerId);
        const filesToRender = files || this.files;

        if (filesToRender.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No files found</h3>
                    <p>Start by adding a new file to the system.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = filesToRender.map(file => `
            <div class="list-item" onclick="app.showFileDetail(${file.id})">
                <div class="item-header">
                    <div class="item-title">${this.escapeHtml(file.title)}</div>
                    <div class="item-actions">
                        <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); app.editFile(${file.id})">Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); app.deleteFile(${file.id})">Delete</button>
                    </div>
                </div>
                ${file.reference_number ? `<div style="color: var(--text-secondary); margin-bottom: 8px;">Ref: ${this.escapeHtml(file.reference_number)}</div>` : ''}
                ${file.description ? `<div style="color: var(--text-secondary); margin-bottom: 8px;">${this.escapeHtml(file.description)}</div>` : ''}
                <div class="item-meta">
                    ${file.master_file_name ? `<span>📁 ${this.escapeHtml(file.master_file_name)}</span>` : ''}
                    ${file.date_received ? `<span>📥 Received: ${file.date_received}</span>` : ''}
                    ${file.date_sent ? `<span>📤 Sent: ${file.date_sent}</span>` : ''}
                    <span>📎 ${file.scan_count} scan(s)</span>
                    <span>🕐 ${new Date(file.created_at).toLocaleDateString()}</span>
                    ${file.tags ? `<span class="badge">${this.escapeHtml(file.tags)}</span>` : ''}
                </div>
            </div>
        `).join('');
    }

    renderMasterFilesTable(masterFiles = null) {
        const tableBody = document.getElementById('masterFilesTableBody');
        const filesToRender = masterFiles || this.masterFiles;

        if (filesToRender.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center">
                        <div class="empty-state">
                            <h3>No master files found</h3>
                            <p>Create your first master file to organize documents.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = filesToRender.map(mf => `
            <tr>
                <td><strong>${this.escapeHtml(mf.name)}</strong></td>
                <td>${this.escapeHtml(mf.description || '')}</td>
                <td><span class="badge badge-secondary">0</span></td>
                <td>${new Date(mf.created_at).toLocaleDateString()}</td>
                <td>
                    <div class="d-flex gap-10">
                        <button class="btn btn-sm btn-primary" onclick="app.editMasterFile(${mf.id})">Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="app.deleteMasterFile(${mf.id})">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    async showFileDetail(id) {
        try {
            const file = await window.electronAPI.files.getById(id);
            const scans = await window.electronAPI.scans.getByFileId(id);

            document.getElementById('fileDetailTitle').textContent = file.title;
            document.getElementById('fileDetailContent').innerHTML = `
                <div style="margin-bottom: 20px;">
                    <div class="d-flex justify-between align-center mb-20">
                        <h4>File Information</h4>
                        <div class="d-flex gap-10">
                            <button class="btn btn-primary" onclick="app.editFile(${file.id}); app.hideFileDetailModal();">Edit</button>
                            <button class="btn btn-danger" onclick="app.deleteFile(${file.id}); app.hideFileDetailModal();">Delete</button>
                        </div>
                    </div>

                    ${file.reference_number ? `<p><strong>Reference:</strong> ${this.escapeHtml(file.reference_number)}</p>` : ''}
                    ${file.description ? `<p><strong>Description:</strong> ${this.escapeHtml(file.description)}</p>` : ''}
                    ${file.master_file_name ? `<p><strong>Master File:</strong> ${this.escapeHtml(file.master_file_name)}</p>` : ''}
                    ${file.date_received ? `<p><strong>Date Received:</strong> ${file.date_received}</p>` : ''}
                    ${file.date_sent ? `<p><strong>Date Sent:</strong> ${file.date_sent}</p>` : ''}
                    ${file.tags ? `<p><strong>Tags:</strong> ${this.escapeHtml(file.tags)}</p>` : ''}
                    <p><strong>Created:</strong> ${new Date(file.created_at).toLocaleString()}</p>
                    <p><strong>Updated:</strong> ${new Date(file.updated_at).toLocaleString()}</p>
                </div>

                <div>
                    <div class="d-flex justify-between align-center mb-20">
                        <h4>Scans (${scans.length})</h4>
                        <button class="btn btn-success" onclick="app.uploadScan(${file.id})">Upload Scan</button>
                    </div>

                    ${scans.length === 0 ?
                        '<p style="color: var(--text-secondary);">No scans uploaded yet.</p>' :
                        scans.map(scan => `
                            <div class="d-flex justify-between align-center" style="padding: 10px; border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 10px;">
                                <div>
                                    <strong>${this.escapeHtml(scan.filename)}</strong><br>
                                    <small style="color: var(--text-secondary);">
                                        ${this.formatFileSize(scan.size)} • ${scan.mimetype} • ${new Date(scan.uploaded_at).toLocaleString()}
                                    </small>
                                </div>
                                <div class="d-flex gap-10">
                                    <button class="btn btn-sm btn-primary" onclick="app.previewScan(${scan.id})">Preview</button>
                                    <button class="btn btn-sm btn-secondary" onclick="app.downloadScan(${scan.id})">Download</button>
                                    <button class="btn btn-sm btn-secondary" onclick="app.openScan(${scan.id})">Open</button>
                                    <button class="btn btn-sm btn-danger" onclick="app.deleteScan(${scan.id})">Delete</button>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
            `;

            this.showFileDetailModal();
        } catch (error) {
            this.showMessage('Failed to load file details: ' + error.message, 'error');
        }
    }

    async setupFileForm(file = null) {
        this.isEditing = !!file;
        this.editingId = file?.id || null;
        this.editingType = 'file';

        document.getElementById('fileFormTitle').textContent = this.isEditing ? 'Edit File' : 'Add New File';
        document.getElementById('submitFileBtn').textContent = this.isEditing ? 'Update File' : 'Save File';

        // Ensure master files are loaded
        await this.loadMasterFiles();

        // Reset form
        document.getElementById('fileForm').reset();
        this.selectedFile = null;
        document.getElementById('selectedFile').classList.add('hidden');

        // Hide upload section for editing
        document.getElementById('uploadSection').style.display = this.isEditing ? 'none' : 'block';

        if (file) {
            // Use setTimeout to ensure the select options are populated
            setTimeout(() => {
                document.getElementById('titleInput').value = file.title || '';
                document.getElementById('refInput').value = file.reference_number || '';
                document.getElementById('descInput').value = file.description || '';
                document.getElementById('dateReceivedInput').value = file.date_received || '';
                document.getElementById('dateSentInput').value = file.date_sent || '';
                document.getElementById('tagsInput').value = file.tags || '';
                document.getElementById('masterFileSelect').value = file.master_file_id || '';
            }, 100);
        }
    }

    setupMasterFileForm(masterFile = null) {
        this.isEditing = !!masterFile;
        this.editingId = masterFile?.id || null;
        this.editingType = 'masterFile';

        document.getElementById('masterFileFormTitle').textContent = this.isEditing ? 'Edit Master File' : 'Add Master File';
        document.getElementById('submitMasterFileBtn').textContent = this.isEditing ? 'Update Master File' : 'Save Master File';

        // Reset form
        document.getElementById('masterFileForm').reset();

        if (masterFile) {
            document.getElementById('masterFileNameInput').value = masterFile.name || '';
            document.getElementById('masterFileDescInput').value = masterFile.description || '';
        }
    }

    async handleFileFormSubmit(e) {
        e.preventDefault();

        const formData = {
            title: document.getElementById('titleInput').value.trim(),
            reference_number: document.getElementById('refInput').value.trim(),
            description: document.getElementById('descInput').value.trim(),
            date_received: document.getElementById('dateReceivedInput').value,
            date_sent: document.getElementById('dateSentInput').value,
            tags: document.getElementById('tagsInput').value.trim(),
            master_file_id: document.getElementById('masterFileSelect').value || null
        };

        if (!formData.title) {
            this.showMessage('Title is required', 'error');
            return;
        }

        try {
            let result;
            if (this.isEditing) {
                result = await window.electronAPI.files.update(this.editingId, formData);
                this.showMessage('File updated successfully', 'success');
            } else {
                result = await window.electronAPI.files.create(formData);

                if (this.selectedFile) {
                    const fileBuffer = await this.selectedFile.arrayBuffer();
                    await window.electronAPI.scans.upload(
                        result.id,
                        fileBuffer,
                        this.selectedFile.name,
                        this.selectedFile.type
                    );
                }
                this.showMessage('File created successfully', 'success');
            }

            await this.loadFiles();
            await this.loadMasterFiles();
            await this.navigateToPage('dashboard');
        } catch (error) {
            this.showMessage('Failed to save file: ' + error.message, 'error');
        }
    }

    async handleMasterFileFormSubmit(e) {
        e.preventDefault();

        const formData = {
            name: document.getElementById('masterFileNameInput').value.trim(),
            description: document.getElementById('masterFileDescInput').value.trim()
        };

        if (!formData.name) {
            this.showMessage('Master file name is required', 'error');
            return;
        }

        try {
            if (this.isEditing) {
                await window.electronAPI.masterFiles.update(this.editingId, formData);
                this.showMessage('Master file updated successfully', 'success');
            } else {
                await window.electronAPI.masterFiles.create(formData);
                this.showMessage('Master file created successfully', 'success');
            }

            await this.loadMasterFiles();
            await this.navigateToPage('master-files');
        } catch (error) {
            this.showMessage('Failed to save master file: ' + error.message, 'error');
        }
    }

    async editFile(id) {
        try {
            const file = await window.electronAPI.files.getById(id);
            await this.navigateToPage('add-file');
            await this.setupFileForm(file);
        } catch (error) {
            this.showMessage('Failed to load file for editing: ' + error.message, 'error');
        }
    }

    async editMasterFile(id) {
        try {
            const masterFile = await window.electronAPI.masterFiles.getById(id);
            await this.navigateToPage('add-master-file');
            this.setupMasterFileForm(masterFile);
        } catch (error) {
            this.showMessage('Failed to load master file for editing: ' + error.message, 'error');
        }
    }

    async deleteFile(id) {
        if (!confirm('Are you sure you want to delete this file? This will also delete all associated scans.')) {
            return;
        }

        try {
            await window.electronAPI.files.delete(id);
            this.showMessage('File deleted successfully', 'success');
            await this.loadFiles();
        } catch (error) {
            this.showMessage('Failed to delete file: ' + error.message, 'error');
        }
    }

    async deleteMasterFile(id) {
        if (!confirm('Are you sure you want to delete this master file? Associated files will not be deleted but will lose their master file association.')) {
            return;
        }

        try {
            await window.electronAPI.masterFiles.delete(id);
            this.showMessage('Master file deleted successfully', 'success');
            await this.loadMasterFiles();
            this.loadMasterFilesPage();
        } catch (error) {
            this.showMessage('Failed to delete master file: ' + error.message, 'error');
        }
    }

    async uploadScan(fileId) {
        try {
            const result = await window.electronAPI.dialog.showOpenDialog({
                properties: ['openFile'],
                filters: [
                    { name: 'Documents', extensions: ['pdf'] },
                    { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (result) {
                await window.electronAPI.scans.upload(
                    fileId,
                    result.data,
                    result.filename,
                    result.mimetype
                );

                this.showMessage('File uploaded successfully', 'success');
                this.showFileDetail(fileId); // Refresh the detail view
            }
        } catch (error) {
            this.showMessage('Failed to upload file: ' + error.message, 'error');
        }
    }

    async deleteScan(scanId) {
        if (!confirm('Are you sure you want to delete this scan?')) {
            return;
        }

        try {
            await window.electronAPI.scans.delete(scanId);
            this.showMessage('Scan deleted successfully', 'success');
            // Refresh current view
            if (document.getElementById('fileDetailModal').classList.contains('active')) {
                // Find the current file ID and refresh detail view
                // This is a simple implementation - in a real app you'd track this better
                this.hideFileDetailModal();
            }
        } catch (error) {
            this.showMessage('Failed to delete scan: ' + error.message, 'error');
        }
    }

    async downloadScan(scanId) {
        try {
            const filePath = await window.electronAPI.scans.download(scanId);
            if (filePath) {
                this.showMessage('File downloaded successfully', 'success');
            }
        } catch (error) {
            this.showMessage('Failed to download file: ' + error.message, 'error');
        }
    }

    async openScan(scanId) {
        try {
            await window.electronAPI.files.openScan(scanId);
        } catch (error) {
            this.showMessage('Failed to open file: ' + error.message, 'error');
        }
    }

    async previewScan(scanId) {
        try {
            const fileData = await window.electronAPI.scans.getFileData(scanId);

            document.getElementById('previewTitle').textContent = `Preview: ${fileData.filename}`;

            let previewContent = '';
            if (fileData.mimetype.startsWith('image/')) {
                previewContent = `
                    <div style="text-align: center; padding: 20px;">
                        <img src="data:${fileData.mimetype};base64,${fileData.data}"
                             style="max-width: 100%; max-height: 70vh; object-fit: contain;"
                             alt="${fileData.filename}">
                    </div>
                `;
            } else if (fileData.mimetype === 'application/pdf') {
                previewContent = `
                    <div style="width: 100%; height: 70vh;">
                        <embed src="data:${fileData.mimetype};base64,${fileData.data}"
                               type="application/pdf"
                               width="100%"
                               height="100%">
                    </div>
                `;
            } else {
                previewContent = `
                    <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                        <p>Preview not available for this file type.</p>
                        <p>Click "Open" to view with default application.</p>
                    </div>
                `;
            }

            document.getElementById('previewContent').innerHTML = previewContent;
            this.showPreviewModal();
        } catch (error) {
            this.showMessage('Failed to preview file: ' + error.message, 'error');
        }
    }

    async searchFiles() {
        const searchParams = {};

        const search = document.getElementById('globalSearch').value.trim();
        if (search) {
            searchParams.search = search;
        }

        const masterFileId = document.getElementById('masterFileFilter').value;
        if (masterFileId && masterFileId !== 'all') {
            searchParams.masterFileId = masterFileId;
        }

        const dateFrom = document.getElementById('dateFrom').value;
        if (dateFrom) {
            searchParams.dateFrom = dateFrom;
        }

        const dateTo = document.getElementById('dateTo').value;
        if (dateTo) {
            searchParams.dateTo = dateTo;
        }

        // Reset to first page for new search
        this.pagination.dashboard.page = 1;
        await this.loadFiles(searchParams, 'dashboard');
    }

    clearSearch() {
        document.getElementById('globalSearch').value = '';
        document.getElementById('masterFileFilter').value = 'all';
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value = '';

        // Reset to first page
        this.pagination.dashboard.page = 1;
        this.loadFiles({}, 'dashboard');
    }

    // Theme management
    toggleTheme() {
        const body = document.body;
        const currentTheme = body.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';

        body.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    }

    loadTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.body.setAttribute('data-theme', savedTheme);
    }

    // Modal management
    showAboutModal() {
        document.getElementById('aboutModal').classList.add('active');
    }

    hideAboutModal() {
        document.getElementById('aboutModal').classList.remove('active');
    }

    showFileDetailModal() {
        document.getElementById('fileDetailModal').classList.add('active');
    }

    hideFileDetailModal() {
        document.getElementById('fileDetailModal').classList.remove('active');
    }

    showPreviewModal() {
        document.getElementById('previewModal').classList.add('active');
    }

    hidePreviewModal() {
        document.getElementById('previewModal').classList.remove('active');
    }

    // Utility functions
    showLoading(containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = '<div class="loading">Loading...</div>';
        }
    }

    showMessage(message, type = 'success') {
        const container = document.getElementById('messagesContainer');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${type}`;

        // Create message structure with close button
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.textContent = message;

        const closeButton = document.createElement('button');
        closeButton.className = 'message-close';
        closeButton.innerHTML = '×';
        closeButton.title = 'Close';
        closeButton.addEventListener('click', () => this.removeMessage(messageDiv));

        messageDiv.appendChild(messageContent);
        messageDiv.appendChild(closeButton);

        container.appendChild(messageDiv);

        // Trigger show animation
        requestAnimationFrame(() => {
            messageDiv.classList.add('show');
        });

        // Auto-remove after timeout (longer for errors)
        const timeout = type === 'error' ? 7000 : 4000;
        const timeoutId = setTimeout(() => {
            this.removeMessage(messageDiv);
        }, timeout);

        // Store timeout ID so it can be cleared if manually closed
        messageDiv.dataset.timeoutId = timeoutId;
    }

    removeMessage(messageDiv) {
        if (!messageDiv || !messageDiv.parentElement) return;

        // Clear auto-removal timeout
        if (messageDiv.dataset.timeoutId) {
            clearTimeout(parseInt(messageDiv.dataset.timeoutId));
        }

        // Animate out
        messageDiv.classList.remove('show');

        // Remove from DOM after animation
        setTimeout(() => {
            if (messageDiv.parentElement) {
                messageDiv.remove();
            }
        }, 300);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Pagination functionality
    setupPaginationEvents() {
        // Dashboard pagination
        document.getElementById('dashboardPrevBtn')?.addEventListener('click', () => this.goToPage('dashboard', this.pagination.dashboard.page - 1));
        document.getElementById('dashboardNextBtn')?.addEventListener('click', () => this.goToPage('dashboard', this.pagination.dashboard.page + 1));
        document.getElementById('dashboardPageSize')?.addEventListener('change', (e) => this.changePageSize('dashboard', e.target.value));

        // Documents pagination
        document.getElementById('documentsPrevBtn')?.addEventListener('click', () => this.goToPage('documents', this.pagination.documents.page - 1));
        document.getElementById('documentsNextBtn')?.addEventListener('click', () => this.goToPage('documents', this.pagination.documents.page + 1));
        document.getElementById('documentsPageSize')?.addEventListener('change', (e) => this.changePageSize('documents', e.target.value));

        // Master Files pagination
        document.getElementById('masterFilesPrevBtn')?.addEventListener('click', () => this.goToPage('masterFiles', this.pagination.masterFiles.page - 1));
        document.getElementById('masterFilesNextBtn')?.addEventListener('click', () => this.goToPage('masterFiles', this.pagination.masterFiles.page + 1));
        document.getElementById('masterFilesPageSize')?.addEventListener('change', (e) => this.changePageSize('masterFiles', e.target.value));
    }

    async goToPage(pageType, pageNumber) {
        if (pageNumber < 1 || pageNumber > this.pagination[pageType].totalPages) {
            return;
        }

        this.pagination[pageType].page = pageNumber;

        if (pageType === 'dashboard') {
            await this.loadFiles({}, 'dashboard');
        } else if (pageType === 'documents') {
            await this.loadDocumentsPage();
        } else if (pageType === 'masterFiles') {
            await this.loadMasterFilesPage();
        }
    }

    async changePageSize(pageType, newSize) {
        this.pagination[pageType].limit = newSize === 'all' ? 'all' : parseInt(newSize);
        this.pagination[pageType].page = 1; // Reset to first page

        if (pageType === 'dashboard') {
            await this.loadFiles({}, 'dashboard');
        } else if (pageType === 'documents') {
            await this.loadDocumentsPage();
        } else if (pageType === 'masterFiles') {
            await this.loadMasterFilesPage();
        }
    }

    renderPagination(pageType) {
        const pagination = this.pagination[pageType];
        const prefix = pageType === 'masterFiles' ? 'masterFiles' : pageType;

        // Update pagination info
        const infoElement = document.getElementById(`${prefix}PaginationInfo`);
        if (infoElement) {
            if (pagination.showAll) {
                infoElement.textContent = `Showing all ${pagination.total} entries`;
            } else {
                const start = (pagination.page - 1) * pagination.limit + 1;
                const end = Math.min(pagination.page * pagination.limit, pagination.total);
                infoElement.textContent = `Showing ${start}-${end} of ${pagination.total} entries`;
            }
        }

        // Update navigation buttons
        const prevBtn = document.getElementById(`${prefix}PrevBtn`);
        const nextBtn = document.getElementById(`${prefix}NextBtn`);

        if (prevBtn) {
            prevBtn.disabled = !pagination.hasPrev || pagination.showAll;
        }
        if (nextBtn) {
            nextBtn.disabled = !pagination.hasNext || pagination.showAll;
        }

        // Update page numbers
        this.renderPageNumbers(pageType);
    }

    renderPageNumbers(pageType) {
        const pagination = this.pagination[pageType];
        const prefix = pageType === 'masterFiles' ? 'masterFiles' : pageType;
        const container = document.getElementById(`${prefix}PageNumbers`);

        if (!container) return;

        // If showing all records, hide page numbers
        if (pagination.showAll) {
            container.innerHTML = '';
            return;
        }

        const maxVisiblePages = 5;
        const totalPages = pagination.totalPages;
        const currentPage = pagination.page;

        let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        const pageNumbers = [];

        // First page
        if (startPage > 1) {
            pageNumbers.push(`<div class="pagination-page" onclick="app.goToPage('${pageType}', 1)">1</div>`);
            if (startPage > 2) {
                pageNumbers.push('<div class="pagination-page disabled">...</div>');
            }
        }

        // Visible pages
        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === currentPage ? 'active' : '';
            pageNumbers.push(`<div class="pagination-page ${isActive}" onclick="app.goToPage('${pageType}', ${i})">${i}</div>`);
        }

        // Last page
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                pageNumbers.push('<div class="pagination-page disabled">...</div>');
            }
            pageNumbers.push(`<div class="pagination-page" onclick="app.goToPage('${pageType}', ${totalPages})">${totalPages}</div>`);
        }

        container.innerHTML = pageNumbers.join('');
    }

    // Backup and Restore functionality
    async loadBackupRestorePage() {
        await this.loadStorageStats();
    }

    async loadStorageStats() {
        try {
            const stats = await window.electronAPI.backup.getStats();
            document.getElementById('totalFiles').textContent = stats.totalFiles.toLocaleString();
            document.getElementById('totalSize').textContent = this.formatFileSize(stats.totalSize);
        } catch (error) {
            console.error('Failed to load storage stats:', error);
            document.getElementById('totalFiles').textContent = 'Error';
            document.getElementById('totalSize').textContent = 'Error';
            this.showMessage('Failed to load storage statistics: ' + error.message, 'error');
        }
    }

    async exportData() {
        try {
            const result = await window.electronAPI.data.export();
            if (result.success) {
                this.showMessage(result.message, 'success');
                this.showResults([{
                    type: 'success',
                    message: `Data exported to: ${result.filePath}`
                }]);
            } else {
                this.showMessage(result.message, 'warning');
            }
        } catch (error) {
            console.error('Export failed:', error);
            this.showMessage('Failed to export data: ' + error.message, 'error');
        }
    }

    async importData() {
        const overwrite = document.getElementById('overwriteDataCheck').checked;
        try {
            const result = await window.electronAPI.data.import({ overwrite });
            if (result.success) {
                this.showMessage(result.message, 'success');
                const results = [];
                Object.entries(result.results).forEach(([type, stats]) => {
                    results.push({
                        type: stats.errors > 0 ? 'error' : 'success',
                        message: `${type}: ${stats.imported} imported, ${stats.skipped} skipped, ${stats.errors} errors`
                    });
                });
                this.showResults(results);
                // Reload data
                await this.loadFiles();
                await this.loadMasterFiles();
            } else {
                this.showMessage(result.message, 'warning');
            }
        } catch (error) {
            console.error('Import failed:', error);
            this.showMessage('Failed to import data: ' + error.message, 'error');
        }
    }

    async createBackup() {
        try {
            const result = await window.electronAPI.backup.create();
            if (result.success) {
                this.showMessage(result.message, 'success');
                this.showResults([{
                    type: 'success',
                    message: `Full backup created: ${result.filePath}`
                }, {
                    type: 'success',
                    message: `Total size: ${this.formatFileSize(result.totalBytes)}`
                }]);
            } else {
                this.showMessage(result.message, 'warning');
            }
        } catch (error) {
            console.error('Backup failed:', error);
            this.showMessage('Failed to create backup: ' + error.message, 'error');
        }
    }

    async restoreBackup() {
        const overwrite = document.getElementById('overwriteBackupCheck').checked;
        if (!confirm('This will restore files from the backup. Are you sure you want to continue?')) {
            return;
        }
        try {
            const result = await window.electronAPI.backup.restore({ overwrite });
            if (result.success) {
                this.showMessage(result.message, 'success');
                const results = [];
                const fileResults = result.results.files;
                results.push({
                    type: fileResults.errors > 0 ? 'error' : 'success',
                    message: `Files: ${fileResults.restored} restored, ${fileResults.skipped} skipped, ${fileResults.errors} errors`
                });
                this.showResults(results);
                // Reload data
                await this.loadFiles();
                await this.loadStorageStats();
            } else {
                this.showMessage(result.message, 'warning');
            }
        } catch (error) {
            console.error('Restore failed:', error);
            this.showMessage('Failed to restore backup: ' + error.message, 'error');
        }
    }

    showResults(results) {
        const resultsSection = document.getElementById('backupResults');
        const resultsContent = document.getElementById('resultsContent');

        resultsContent.innerHTML = results.map(result =>
            `<div class="result-item result-${result.type}">${result.message}</div>`
        ).join('');

        resultsSection.style.display = 'block';

        // Auto-hide after 10 seconds
        setTimeout(() => {
            resultsSection.style.display = 'none';
        }, 10000);
    }
}

// Initialize the app
const app = new FileTrackerApp();