// Kolbo Desktop - Drag Handler
// Handles OS-level drag-and-drop using Electron's startDrag() API

const { ipcMain, nativeImage } = require('electron');
const FileManager = require('./file-manager');
const path = require('path');

class DragHandler {
  static setupHandlers() {
    ipcMain.handle('drag:prepare', this.prepareForDrag.bind(this));
    ipcMain.handle('drag:start', this.startDrag.bind(this));

    console.log('[DragHandler] IPC handlers registered');
  }

  static async prepareForDrag(event, items) {
    try {
      console.log(`[DragHandler] Preparing ${items.length} item(s) for drag`);

      const results = [];

      // Download all files sequentially
      for (const item of items) {
        try {
          console.log(`[DragHandler] Downloading: ${item.fileName}`);

          // Download main file
          const fileResult = await FileManager.downloadFile(event, {
            url: item.url,
            fileName: item.fileName
          });

          if (fileResult.success) {
            results.push({
              success: true,
              filePath: fileResult.filePath,
              fileName: item.fileName,
              id: item.id
            });

            // Download thumbnail for drag icon (optional)
            if (item.thumbnailUrl) {
              try {
                const thumbName = `thumb_${item.id}.png`;
                const thumbResult = await FileManager.downloadFile(event, {
                  url: item.thumbnailUrl,
                  fileName: thumbName
                });

                if (thumbResult.success) {
                  results[results.length - 1].thumbnailPath = thumbResult.filePath;
                }
              } catch (thumbError) {
                console.log('[DragHandler] Thumbnail download failed (non-critical):', thumbError.message);
              }
            }
          } else {
            results.push({
              success: false,
              fileName: item.fileName,
              id: item.id,
              error: 'Download failed'
            });
          }
        } catch (error) {
          console.error('[DragHandler] Download failed:', item.fileName, error);
          results.push({
            success: false,
            fileName: item.fileName,
            id: item.id,
            error: error.message
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[DragHandler] Prepared ${successCount}/${items.length} files`);

      return {
        success: true,
        results,
        successCount,
        totalCount: items.length
      };

    } catch (error) {
      console.error('[DragHandler] Prepare failed:', error);
      return { success: false, error: error.message };
    }
  }

  static startDrag(event, { filePaths, thumbnailPaths }) {
    try {
      console.log(`[DragHandler] Starting drag with ${filePaths.length} file(s)`);

      // Create drag icon from thumbnail
      let icon = nativeImage.createEmpty();
      if (thumbnailPaths && thumbnailPaths.length > 0 && thumbnailPaths[0]) {
        try {
          const thumbnailPath = thumbnailPaths[0];
          if (thumbnailPath && thumbnailPath.length > 0) {
            icon = nativeImage.createFromPath(thumbnailPath);
            if (!icon.isEmpty()) {
              icon = icon.resize({ width: 128, height: 72 });
              console.log('[DragHandler] Using thumbnail as drag icon');
            }
          }
        } catch (error) {
          console.log('[DragHandler] Failed to create icon from thumbnail:', error.message);
          icon = nativeImage.createEmpty();
        }
      }

      // Start OS-level drag
      if (filePaths.length === 1) {
        // Single file drag
        console.log('[DragHandler] Starting single file drag:', path.basename(filePaths[0]));
        event.sender.startDrag({
          file: filePaths[0],
          icon: icon
        });
      } else {
        // Multiple files drag (Electron supports arrays!)
        console.log('[DragHandler] Starting multi-file drag:', filePaths.length, 'files');
        event.sender.startDrag({
          files: filePaths,
          icon: icon
        });
      }

      console.log('[DragHandler] Drag started successfully');
      return { success: true };

    } catch (error) {
      console.error('[DragHandler] Start drag failed:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = DragHandler;
