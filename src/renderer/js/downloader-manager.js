// Kolbo Studio - Downloader Manager
// Handles video/audio downloads from YouTube, Instagram, Twitter, TikTok, and 1000+ sites

class DownloaderManager {
  constructor() {
    this.queue = [];
    this.outputFolder = null;
    this.currentMediaInfo = null;
    this.isProcessing = false;
    this.initialized = false;

    // Platform icons mapping
    this.platformIcons = {
      youtube: { icon: '🎬', color: '#ff0000', name: 'YouTube' },
      instagram: { icon: '📸', color: '#e4405f', name: 'Instagram' },
      twitter: { icon: '𝕏', color: '#1da1f2', name: 'Twitter/X' },
      tiktok: { icon: '🎵', color: '#ee1d52', name: 'TikTok' },
      facebook: { icon: '📘', color: '#1877f2', name: 'Facebook' },
      linkedin: { icon: '💼', color: '#0a66c2', name: 'LinkedIn' },
      vimeo: { icon: '🎥', color: '#1ab7ea', name: 'Vimeo' },
      twitch: { icon: '🎮', color: '#9146ff', name: 'Twitch' },
      dailymotion: { icon: '📺', color: '#0066dc', name: 'Dailymotion' },
      soundcloud: { icon: '🔊', color: '#ff5500', name: 'SoundCloud' },
      other: { icon: '🌐', color: '#888', name: 'Website' }
    };

    this.init();
  }

  async init() {
    console.log('[Downloader] Initializing...');

    // Load saved output folder
    await this.loadOutputFolder();

    // Setup event listeners
    this.setupEventListeners();

    // Setup IPC listeners
    this.setupIPCListeners();

    this.initialized = true;
    console.log('[Downloader] Initialized successfully');
  }

  async loadOutputFolder() {
    try {
      if (window.kolboDesktop?.downloader) {
        const result = await window.kolboDesktop.downloader.getOutputFolder();
        if (result.success && result.outputFolder) {
          this.outputFolder = result.outputFolder;
        } else {
          // Default to downloads folder path display
          this.outputFolder = result.outputFolder || 'Downloads folder';
        }
        this.updateOutputFolderDisplay();
      }
    } catch (error) {
      console.error('[Downloader] Failed to load output folder:', error);
      // Set default display
      const folderPath = document.getElementById('dl-folder-path');
      if (folderPath) {
        folderPath.textContent = 'Downloads folder (click Change to set)';
      }
    }
  }

  setupEventListeners() {
    // URL input - fetch on Enter
    const urlInput = document.getElementById('dl-url-input');
    if (urlInput) {
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.fetchMediaInfo();
        }
      });

      // Clear preview when input is cleared
      urlInput.addEventListener('input', () => {
        if (!urlInput.value.trim()) {
          this.hidePreview();
        }
      });
    }

    // Fetch button
    const fetchBtn = document.getElementById('dl-fetch-btn');
    if (fetchBtn) {
      fetchBtn.addEventListener('click', () => this.fetchMediaInfo());
    }

    // Preview close button
    const previewClose = document.getElementById('dl-preview-close');
    if (previewClose) {
      previewClose.addEventListener('click', () => this.hidePreview());
    }

    // Add to queue button
    const addQueueBtn = document.getElementById('dl-add-queue-btn');
    if (addQueueBtn) {
      addQueueBtn.addEventListener('click', () => this.addToQueue());
    }

    // Format select - update quality options
    const formatSelect = document.getElementById('dl-format-select');
    if (formatSelect) {
      formatSelect.addEventListener('change', () => this.updateQualityOptions());
    }

    // Folder selection
    const outputFolderBtn = document.getElementById('dl-output-folder-btn');
    if (outputFolderBtn) {
      outputFolderBtn.addEventListener('click', () => this.selectOutputFolder());
    }

    // Folder path click - also opens folder picker
    const folderPath = document.getElementById('dl-folder-path');
    if (folderPath) {
      folderPath.style.cursor = 'pointer';
      folderPath.addEventListener('click', () => this.selectOutputFolder());
    }

    const openFolderBtn = document.getElementById('dl-open-folder-btn');
    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', () => this.openOutputFolder());
    }

    const clearBtn = document.getElementById('dl-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearCompleted());
    }

    const stopAllBtn = document.getElementById('dl-stop-all-btn');
    if (stopAllBtn) {
      stopAllBtn.addEventListener('click', () => this.stopAll());
    }

    const startAllBtn = document.getElementById('dl-start-all-btn');
    if (startAllBtn) {
      startAllBtn.addEventListener('click', () => this.startAll());
    }
  }

  setupIPCListeners() {
    if (!window.kolboDesktop?.downloader) {
      console.warn('[Downloader] IPC not available');
      return;
    }

    // Progress updates
    window.kolboDesktop.downloader.onProgress((data) => {
      this.updateJobProgress(data);
    });

    // Download complete
    window.kolboDesktop.downloader.onComplete((data) => {
      this.handleJobComplete(data);
    });

    // Download error
    window.kolboDesktop.downloader.onError((data) => {
      this.handleJobError(data);
    });

    // Download cancelled
    window.kolboDesktop.downloader.onCancelled((data) => {
      this.handleJobCancelled(data);
    });
  }

  async fetchMediaInfo() {
    const urlInput = document.getElementById('dl-url-input');
    const url = urlInput?.value.trim();

    if (!url) {
      this.showError('Please enter a URL');
      return;
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      this.showError('Please enter a valid URL');
      return;
    }

    // Show loading state
    this.showPreviewLoading();

    try {
      const result = await window.kolboDesktop.downloader.getMediaInfo(url);

      if (result.success) {
        this.currentMediaInfo = result.info;
        this.showPreview(result.info);
      } else {
        this.hidePreview();
        this.showError(result.error || 'Failed to fetch media info');
      }
    } catch (error) {
      console.error('[Downloader] Fetch error:', error);
      this.hidePreview();
      this.showError('Failed to fetch media info');
    }
  }

  showPreviewLoading() {
    const previewCard = document.getElementById('dl-preview-card');
    const loading = document.getElementById('dl-preview-loading');
    const content = document.getElementById('dl-preview-content');

    previewCard?.classList.remove('hidden');
    loading?.classList.remove('hidden');
    content?.style.setProperty('display', 'none');
  }

  showPreview(info) {
    const previewCard = document.getElementById('dl-preview-card');
    const loading = document.getElementById('dl-preview-loading');
    const content = document.getElementById('dl-preview-content');

    // Hide loading, show content
    loading?.classList.add('hidden');
    content?.style.setProperty('display', 'flex');
    previewCard?.classList.remove('hidden');

    // Update thumbnail
    const thumb = document.getElementById('dl-preview-thumb');
    if (thumb) {
      thumb.src = info.thumbnail || '';
      thumb.onerror = () => { thumb.src = ''; };
    }

    // Update duration
    const duration = document.getElementById('dl-preview-duration');
    if (duration) {
      duration.textContent = this.formatDuration(info.duration);
    }

    // Update platform
    const platformContainer = document.getElementById('dl-preview-platform');
    if (platformContainer) {
      const platformInfo = this.platformIcons[info.platform] || this.platformIcons.other;
      platformContainer.innerHTML = `
        <span class="dl-platform-icon">${platformInfo.icon}</span>
        <span class="dl-platform-name">${platformInfo.name}</span>
      `;
    }

    // Update title
    const title = document.getElementById('dl-preview-title');
    if (title) {
      title.textContent = info.title || 'Untitled';
      title.title = info.title || 'Untitled';
    }

    // Update uploader
    const uploader = document.getElementById('dl-preview-uploader');
    if (uploader) {
      uploader.textContent = info.uploader || '';
    }

    // Update quality options based on available formats
    this.updateQualityOptions();
  }

  hidePreview() {
    const previewCard = document.getElementById('dl-preview-card');
    previewCard?.classList.add('hidden');
    this.currentMediaInfo = null;
  }

  updateQualityOptions() {
    const formatSelect = document.getElementById('dl-format-select');
    const qualitySelect = document.getElementById('dl-quality-select');

    if (!formatSelect || !qualitySelect) return;

    const format = formatSelect.value;

    // Clear existing options
    qualitySelect.innerHTML = '';

    if (format === 'mp3') {
      // Audio quality options - default to highest quality
      qualitySelect.innerHTML = `
        <option value="high" selected>High (320kbps)</option>
        <option value="standard">Standard (192kbps)</option>
        <option value="low">Low (128kbps)</option>
      `;
    } else {
      // Video quality options - default to best available (auto)
      qualitySelect.innerHTML = `
        <option value="best" selected>Best Available (Auto)</option>
        <option value="2160">4K (2160p)</option>
        <option value="1080">1080p</option>
        <option value="720">720p</option>
        <option value="480">480p</option>
      `;
    }
  }

  async addToQueue() {
    if (!this.currentMediaInfo) {
      this.showError('No media selected');
      return;
    }

    const formatSelect = document.getElementById('dl-format-select');
    const qualitySelect = document.getElementById('dl-quality-select');

    const outputFormat = formatSelect?.value || 'mp4';
    const quality = qualitySelect?.value || 'best';

    // Create job
    const job = {
      id: `dl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      url: this.currentMediaInfo.url,
      title: this.currentMediaInfo.title,
      thumbnail: this.currentMediaInfo.thumbnail,
      duration: this.currentMediaInfo.duration,
      platform: this.currentMediaInfo.platform,
      outputFormat: outputFormat,
      quality: quality,
      qualityLabel: qualitySelect?.options[qualitySelect.selectedIndex]?.text || quality,
      status: 'pending',
      progress: 0,
      outputPath: null,
      error: null,
      outputFolder: this.outputFolder
    };

    // Add to queue
    this.queue.push(job);

    // Update UI
    this.renderQueueItem(job);
    this.updateQueueCount();
    this.updateToolbarButtons();

    // Hide preview and clear input
    this.hidePreview();
    const urlInput = document.getElementById('dl-url-input');
    if (urlInput) urlInput.value = '';

    console.log('[Downloader] Added to queue:', job.id);
  }

  renderQueueItem(job) {
    const queueList = document.getElementById('dl-queue-list');
    const emptyState = document.getElementById('dl-empty-state');

    // Hide empty state
    if (emptyState) emptyState.style.display = 'none';

    const platformInfo = this.platformIcons[job.platform] || this.platformIcons.other;

    const itemHtml = `
      <div class="dl-queue-item" data-job-id="${job.id}" data-status="${job.status}">
        <input type="checkbox" class="dl-item-checkbox" checked>
        <span class="dl-item-platform">${platformInfo.icon}</span>
        <div class="dl-item-info">
          <p class="dl-item-title" title="${this.escapeHtml(job.title)}">${this.escapeHtml(job.title)}</p>
          <div class="dl-item-meta">
            <span class="dl-item-format">${job.outputFormat.toUpperCase()} ${job.qualityLabel}</span>
            <span class="dl-item-duration">${this.formatDuration(job.duration)}</span>
          </div>
          <span class="dl-item-error" style="display: none;"></span>
        </div>
        <div class="dl-item-progress-wrapper">
          <div class="dl-item-progress-bar">
            <div class="dl-item-progress-fill" style="width: 0%"></div>
          </div>
          <span class="dl-item-progress-text">Pending</span>
        </div>
        <div class="dl-item-actions">
          <button class="dl-item-action-btn folder" title="Show in folder" style="display: none;">
            ${Icons.get('download', 16)}
          </button>
          <button class="dl-item-action-btn cancel" title="Cancel/Remove">
            ${Icons.get('x', 14)}
          </button>
        </div>
      </div>
    `;

    queueList?.insertAdjacentHTML('beforeend', itemHtml);

    // Add event listeners for the new item
    const item = queueList?.querySelector(`[data-job-id="${job.id}"]`);
    if (item) {
      const cancelBtn = item.querySelector('.dl-item-action-btn.cancel');
      cancelBtn?.addEventListener('click', () => this.removeJob(job.id));

      const folderBtn = item.querySelector('.dl-item-action-btn.folder');
      folderBtn?.addEventListener('click', () => this.showInFolder(job.id));
    }
  }

  updateJobUI(jobId, updates) {
    const item = document.querySelector(`[data-job-id="${jobId}"]`);
    if (!item) return;

    if (updates.status) {
      item.dataset.status = updates.status;
      item.classList.remove('pending', 'downloading', 'completed', 'failed');
      item.classList.add(updates.status);
    }

    if (updates.progress !== undefined) {
      const progressFill = item.querySelector('.dl-item-progress-fill');
      const progressText = item.querySelector('.dl-item-progress-text');

      if (progressFill) {
        progressFill.style.width = `${updates.progress}%`;
      }

      if (progressText) {
        if (updates.status === 'completed') {
          progressText.textContent = 'Completed';
        } else if (updates.status === 'failed') {
          progressText.textContent = 'Failed';
        } else if (updates.status === 'downloading') {
          progressText.textContent = `${Math.round(updates.progress)}%`;
        } else {
          progressText.textContent = 'Pending';
        }
      }
    }

    if (updates.error) {
      const errorEl = item.querySelector('.dl-item-error');
      if (errorEl) {
        errorEl.textContent = updates.error;
        errorEl.style.display = 'block';
      }
    }

    if (updates.showFolder) {
      const folderBtn = item.querySelector('.dl-item-action-btn.folder');
      if (folderBtn) {
        folderBtn.style.display = 'block';
      }
    }
  }

  updateJobProgress(data) {
    const job = this.queue.find(j => j.id === data.jobId);
    if (!job) return;

    job.progress = data.progress || 0;
    job.status = 'downloading';

    this.updateJobUI(data.jobId, {
      status: 'downloading',
      progress: data.progress
    });
  }

  handleJobComplete(data) {
    const job = this.queue.find(j => j.id === data.jobId);
    if (!job) return;

    job.status = 'completed';
    job.progress = 100;
    job.outputPath = data.outputPath;

    this.updateJobUI(data.jobId, {
      status: 'completed',
      progress: 100,
      showFolder: true
    });

    this.processNextJob();
    this.updateToolbarButtons();

    console.log('[Downloader] Download complete:', data.jobId);
  }

  handleJobError(data) {
    const job = this.queue.find(j => j.id === data.jobId);
    if (!job) return;

    job.status = 'failed';
    job.error = data.error;

    this.updateJobUI(data.jobId, {
      status: 'failed',
      error: data.error
    });

    this.processNextJob();
    this.updateToolbarButtons();

    console.error('[Downloader] Download failed:', data.jobId, data.error);
  }

  handleJobCancelled(data) {
    const job = this.queue.find(j => j.id === data.jobId);
    if (!job) return;

    job.status = 'cancelled';

    // Remove from UI
    const item = document.querySelector(`[data-job-id="${data.jobId}"]`);
    item?.remove();

    // Remove from queue
    this.queue = this.queue.filter(j => j.id !== data.jobId);

    this.updateQueueCount();
    this.updateToolbarButtons();
    this.checkEmptyState();
  }

  async removeJob(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job) return;

    // If downloading, cancel it
    if (job.status === 'downloading') {
      await window.kolboDesktop.downloader.cancelDownload(jobId);
    }

    // Remove from UI
    const item = document.querySelector(`[data-job-id="${jobId}"]`);
    item?.remove();

    // Remove from queue
    this.queue = this.queue.filter(j => j.id !== jobId);

    this.updateQueueCount();
    this.updateToolbarButtons();
    this.checkEmptyState();
  }

  async showInFolder(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job?.outputPath) return;

    await window.kolboDesktop.downloader.showInFolder(job.outputPath);
  }

  async startAll() {
    const pendingJobs = this.queue.filter(j => j.status === 'pending');
    if (pendingJobs.length === 0) return;

    this.isProcessing = true;
    this.updateToolbarButtons();

    // Start the first pending job
    this.processNextJob();
  }

  async processNextJob() {
    const pendingJob = this.queue.find(j => j.status === 'pending');
    if (!pendingJob) {
      this.isProcessing = false;
      this.updateToolbarButtons();
      return;
    }

    // Check if already downloading
    const downloadingJob = this.queue.find(j => j.status === 'downloading');
    if (downloadingJob) return;

    pendingJob.status = 'downloading';
    this.updateJobUI(pendingJob.id, { status: 'downloading', progress: 0 });

    try {
      await window.kolboDesktop.downloader.startDownload({
        id: pendingJob.id,
        url: pendingJob.url,
        title: pendingJob.title,
        outputFormat: pendingJob.outputFormat,
        quality: pendingJob.quality,
        outputFolder: this.outputFolder
      });
    } catch (error) {
      console.error('[Downloader] Failed to start download:', error);
      pendingJob.status = 'failed';
      pendingJob.error = error.message || 'Failed to start download';
      this.updateJobUI(pendingJob.id, {
        status: 'failed',
        error: pendingJob.error
      });
      this.processNextJob();
    }
  }

  async stopAll() {
    await window.kolboDesktop.downloader.cancelAll();

    // Update all downloading jobs to cancelled
    this.queue.forEach(job => {
      if (job.status === 'downloading') {
        job.status = 'cancelled';
        const item = document.querySelector(`[data-job-id="${job.id}"]`);
        item?.remove();
      }
    });

    this.queue = this.queue.filter(j => j.status !== 'cancelled');
    this.isProcessing = false;

    this.updateQueueCount();
    this.updateToolbarButtons();
    this.checkEmptyState();
  }

  clearCompleted() {
    // Remove completed and failed jobs
    const toRemove = this.queue.filter(j => j.status === 'completed' || j.status === 'failed');

    toRemove.forEach(job => {
      const item = document.querySelector(`[data-job-id="${job.id}"]`);
      item?.remove();
    });

    this.queue = this.queue.filter(j => j.status !== 'completed' && j.status !== 'failed');

    this.updateQueueCount();
    this.updateToolbarButtons();
    this.checkEmptyState();
  }

  async selectOutputFolder() {
    try {
      const result = await window.kolboDesktop.downloader.selectOutputFolder();
      if (result.success && result.folderPath) {
        this.outputFolder = result.folderPath;
        this.updateOutputFolderDisplay();
      }
    } catch (error) {
      console.error('[Downloader] Failed to select folder:', error);
    }
  }

  async openOutputFolder() {
    if (this.outputFolder) {
      await window.kolboDesktop.downloader.openFolder(this.outputFolder);
    }
  }

  updateOutputFolderDisplay() {
    const folderPath = document.getElementById('dl-folder-path');
    if (folderPath && this.outputFolder) {
      // Show full path
      folderPath.textContent = this.outputFolder;
      folderPath.title = this.outputFolder;
    }
  }

  updateQueueCount() {
    const countEl = document.getElementById('dl-queue-count');
    if (countEl) {
      const total = this.queue.length;
      const pending = this.queue.filter(j => j.status === 'pending').length;
      const downloading = this.queue.filter(j => j.status === 'downloading').length;
      const completed = this.queue.filter(j => j.status === 'completed').length;

      if (total === 0) {
        countEl.textContent = '0 items';
      } else if (downloading > 0) {
        countEl.textContent = `${downloading} downloading, ${pending} pending`;
      } else if (completed > 0) {
        countEl.textContent = `${completed} completed, ${pending} pending`;
      } else {
        countEl.textContent = `${total} items`;
      }
    }
  }

  updateToolbarButtons() {
    const startBtn = document.getElementById('dl-start-all-btn');
    const stopBtn = document.getElementById('dl-stop-all-btn');

    const hasPending = this.queue.some(j => j.status === 'pending');
    const hasDownloading = this.queue.some(j => j.status === 'downloading');

    if (startBtn) {
      const canStart = hasPending && !hasDownloading;
      startBtn.disabled = !canStart;

      // Add pulse animation when items are ready to download
      if (canStart) {
        startBtn.classList.add('ready');
      } else {
        startBtn.classList.remove('ready');
      }
    }

    if (stopBtn) {
      stopBtn.disabled = !hasDownloading;
    }
  }

  checkEmptyState() {
    const emptyState = document.getElementById('dl-empty-state');
    const hasItems = this.queue.length > 0;

    if (emptyState) {
      emptyState.style.display = hasItems ? 'none' : 'flex';
    }
  }

  showError(message) {
    console.error('[Downloader] Error:', message);
    // Could show a toast notification here
  }

  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Auto-instantiate when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.downloaderManager = new DownloaderManager();
  });
} else {
  window.downloaderManager = new DownloaderManager();
}
