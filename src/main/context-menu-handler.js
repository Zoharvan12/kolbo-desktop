// Kolbo Studio - Context Menu Handler
// Handles right-click context menus throughout the app

const { Menu, clipboard, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

class ContextMenuHandler {
  constructor(mainWindow, store) {
    this.mainWindow = mainWindow;
    this.store = store;
  }

  /**
   * Show context menu for media items (My Media tab)
   */
  showMediaItemMenu(event, params) {
    const { mediaItem, isMultiSelect, selectedCount } = params;

    const template = [];

    if (isMultiSelect) {
      // Batch selection menu
      template.push(
        {
          label: `Download All (${selectedCount} items)`,
          click: () => {
            event.sender.send('context-menu-action', { action: 'download-batch', params });
          }
        },
        // Import to Premiere option is hidden
        // Uncomment below to re-enable:
        /*
        {
          label: `Import to Premiere (${selectedCount} items)`,
          click: () => {
            event.sender.send('context-menu-action', { action: 'premiere-batch', params });
          }
        },
        */
        { type: 'separator' },
        {
          label: 'Copy All URLs',
          click: () => {
            event.sender.send('context-menu-action', { action: 'copy-urls-batch', params });
          }
        },
        { type: 'separator' },
        {
          label: 'Clear Selection',
          click: () => {
            event.sender.send('context-menu-action', { action: 'clear-selection', params });
          }
        }
      );
    } else {
      // Single item menu
      const itemType = mediaItem.type; // 'video', 'image', 'audio'

      // Download options
      if (itemType === 'video') {
        template.push(
          {
            label: 'Download Video',
            click: () => {
              event.sender.send('context-menu-action', { action: 'download', params });
            }
          }
        );
      } else if (itemType === 'image') {
        template.push(
          {
            label: 'Download Image',
            click: () => {
              event.sender.send('context-menu-action', { action: 'download', params });
            }
          },
          {
            label: 'Copy Image',
            click: async () => {
              await this.copyImageFromUrl(mediaItem.url);
            }
          }
        );
      } else if (itemType === 'audio') {
        template.push(
          {
            label: 'Download Audio',
            click: () => {
              event.sender.send('context-menu-action', { action: 'download', params });
            }
          }
        );
      }

      template.push(
        { type: 'separator' },
        {
          label: 'Copy URL',
          click: () => {
            clipboard.writeText(mediaItem.url);
          }
        },
        {
          label: 'Copy Link',
          click: () => {
            clipboard.writeText(mediaItem.url);
          }
        },
        { type: 'separator' },
        {
          label: 'Open in Browser',
          click: () => {
            shell.openExternal(mediaItem.url);
          }
        }
      );

      // Import to Premiere option is hidden
      // Uncomment below to re-enable:
      /*
      if (itemType === 'video') {
        template.push(
          { type: 'separator' },
          {
            label: 'Import to Premiere Pro',
            click: () => {
              event.sender.send('context-menu-action', { action: 'import-premiere', params });
            }
          }
        );
      }
      */

      // If cached, show reveal option
      if (mediaItem.cached) {
        template.push(
          { type: 'separator' },
          {
            label: 'Reveal in Cache Folder',
            click: () => {
              event.sender.send('context-menu-action', { action: 'reveal-cache', params });
            }
          }
        );
      }
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: this.mainWindow });
  }

  /**
   * Show context menu for webapp content (iframe)
   */
  showWebappMenu(event, params) {
    const {
      x,
      y,
      linkURL,
      srcURL,
      mediaType, // 'image', 'video', 'audio', 'none'
      selectionText,
      pageURL
    } = params;

    const template = [];

    // Text selection menu
    if (selectionText && selectionText.trim().length > 0) {
      template.push(
        {
          label: 'Copy',
          role: 'copy'
        },
        { type: 'separator' },
        {
          label: `Search Google for "${selectionText.substring(0, 20)}${selectionText.length > 20 ? '...' : ''}"`,
          click: () => {
            shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(selectionText)}`);
          }
        }
      );

      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: this.mainWindow });
      return;
    }

    // Image context menu
    if (mediaType === 'image' && srcURL) {
      template.push(
        {
          label: 'Download Image',
          click: async () => {
            await this.downloadFile(srcURL, 'image');
          }
        },
        {
          label: 'Copy Image',
          click: async () => {
            await this.copyImageFromUrl(srcURL);
          }
        },
        {
          label: 'Copy Image Address',
          click: () => {
            clipboard.writeText(srcURL);
          }
        },
        { type: 'separator' },
        {
          label: 'Open Image in New Tab',
          click: () => {
            event.sender.send('context-menu-action', { action: 'open-in-new-tab', params: { url: srcURL } });
          }
        }
      );

      if (linkURL) {
        template.push(
          { type: 'separator' },
          {
            label: 'Copy Link Address',
            click: () => {
              clipboard.writeText(linkURL);
            }
          }
        );
      }
    }
    // Video context menu
    else if (mediaType === 'video' && srcURL) {
      template.push(
        {
          label: 'Download Video',
          click: async () => {
            await this.downloadFile(srcURL, 'video');
          }
        },
        {
          label: 'Copy Video Address',
          click: () => {
            clipboard.writeText(srcURL);
          }
        },
        { type: 'separator' },
        {
          label: 'Open Video in New Tab',
          click: () => {
            event.sender.send('context-menu-action', { action: 'open-in-new-tab', params: { url: srcURL } });
          }
        }
      );
    }
    // Audio context menu
    else if (mediaType === 'audio' && srcURL) {
      template.push(
        {
          label: 'Download Audio',
          click: async () => {
            await this.downloadFile(srcURL, 'audio');
          }
        },
        {
          label: 'Copy Audio Address',
          click: () => {
            clipboard.writeText(srcURL);
          }
        }
      );
    }
    // Link context menu
    else if (linkURL) {
      template.push(
        {
          label: 'Open Link in New Tab',
          click: () => {
            event.sender.send('context-menu-action', { action: 'open-in-new-tab', params: { url: linkURL } });
          }
        },
        {
          label: 'Open Link in New Window',
          click: () => {
            event.sender.send('context-menu-action', { action: 'open-in-new-window', params: { url: linkURL } });
          }
        },
        { type: 'separator' },
        {
          label: 'Copy Link Address',
          click: () => {
            clipboard.writeText(linkURL);
          }
        }
      );
    }
    // Default menu (no special element)
    else {
      template.push(
        {
          label: 'Back',
          enabled: event.sender.canGoBack(),
          click: () => {
            event.sender.send('context-menu-action', { action: 'go-back' });
          }
        },
        {
          label: 'Forward',
          enabled: event.sender.canGoForward(),
          click: () => {
            event.sender.send('context-menu-action', { action: 'go-forward' });
          }
        },
        {
          label: 'Reload',
          click: () => {
            event.sender.send('context-menu-action', { action: 'reload' });
          }
        },
        { type: 'separator' },
        {
          label: 'Select All',
          role: 'selectAll'
        },
        { type: 'separator' },
        {
          label: 'Copy Page URL',
          click: () => {
            clipboard.writeText(pageURL);
          }
        }
      );
    }

    // Add common items at the bottom
    if (template.length > 0 && process.env.NODE_ENV === 'development') {
      template.push(
        { type: 'separator' },
        {
          label: 'Inspect Element',
          click: () => {
            event.sender.inspectElement(x, y);
          }
        }
      );
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: this.mainWindow });
  }

  /**
   * Download file from URL to configured download folder
   */
  async downloadFile(url, type = 'file') {
    try {
      console.log('[Context Menu] Downloading file:', url);

      // Get download folder
      let downloadFolder = this.store.get('defaultDownloadFolder');

      if (!downloadFolder) {
        const result = await dialog.showOpenDialog(this.mainWindow, {
          title: 'Choose Download Folder',
          properties: ['openDirectory', 'createDirectory']
        });

        if (result.canceled || !result.filePaths.length) {
          return { success: false, canceled: true };
        }

        downloadFolder = result.filePaths[0];
        this.store.set('defaultDownloadFolder', downloadFolder);
      }

      // Generate filename from URL
      const urlPath = new URL(url).pathname;
      let fileName = path.basename(urlPath);

      // If no extension, add one based on type
      if (!path.extname(fileName)) {
        const extensions = {
          'image': '.jpg',
          'video': '.mp4',
          'audio': '.mp3',
          'file': ''
        };
        fileName += extensions[type] || '';
      }

      // Make filename unique if exists
      let savePath = path.join(downloadFolder, fileName);
      let counter = 1;
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);

      while (fs.existsSync(savePath)) {
        savePath = path.join(downloadFolder, `${base} (${counter})${ext}`);
        counter++;
      }

      console.log('[Context Menu] Saving to:', savePath);

      // Download the file
      await this.downloadFileToPath(url, savePath);

      // Show notification
      this.mainWindow.webContents.send('download-complete', {
        fileName: path.basename(savePath),
        filePath: savePath,
        folderPath: downloadFolder
      });

      console.log('[Context Menu] Download complete:', savePath);
      return { success: true, path: savePath };

    } catch (error) {
      console.error('[Context Menu] Download failed:', error);

      this.mainWindow.webContents.send('download-failed', {
        fileName: 'file',
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Download file to specific path
   */
  downloadFileToPath(url, outputPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(outputPath);
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          file.close();
          fs.unlinkSync(outputPath);
          return this.downloadFileToPath(redirectUrl, outputPath).then(resolve).catch(reject);
        }

        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        } else {
          file.close();
          fs.unlinkSync(outputPath);
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        reject(err);
      });

      file.on('error', (err) => {
        file.close();
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        reject(err);
      });
    });
  }

  /**
   * Copy image from URL to clipboard
   */
  async copyImageFromUrl(url) {
    try {
      console.log('[Context Menu] Copying image from URL:', url);

      // Download image to temp file
      const tempDir = require('os').tmpdir();
      const tempFile = path.join(tempDir, `kolbo-temp-${Date.now()}.jpg`);

      await this.downloadFileToPath(url, tempFile);

      // Load image and copy to clipboard
      const image = nativeImage.createFromPath(tempFile);
      clipboard.writeImage(image);

      // Clean up temp file
      fs.unlinkSync(tempFile);

      console.log('[Context Menu] Image copied to clipboard');
      return { success: true };

    } catch (error) {
      console.error('[Context Menu] Failed to copy image:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Setup IPC handlers
   */
  setupHandlers(ipcMain) {
    // Show media item context menu
    ipcMain.handle('context-menu:show-media-item', (event, params) => {
      this.showMediaItemMenu(event, params);
    });

    // Show webapp context menu
    ipcMain.handle('context-menu:show-webapp', (event, params) => {
      this.showWebappMenu(event, params);
    });

    // Download file
    ipcMain.handle('context-menu:download-file', async (event, url, type) => {
      return await this.downloadFile(url, type);
    });

    console.log('[Context Menu] Handlers registered');
  }
}

module.exports = ContextMenuHandler;
