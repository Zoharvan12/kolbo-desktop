// ============================================================================
// Kolbo Studio Desktop — Synci bridge adapter
// ============================================================================
// SynciManager was written for the Adobe (Premiere/CEP) host, where the bridge
// imports audio onto the timeline and can export frames / In-Out audio. The
// desktop app has no timeline, so the natural equivalent of "add to timeline"
// is "download the file to disk" (the user's default download folder).
//
// This object only implements the methods that make sense on desktop. By NOT
// defining exportFrameAsBase64() / exportAudioToTemp() / getProjectFolder(),
// the Premiere-only AI-suggest options ("Current timeline frame" /
// "From timeline audio") automatically hide themselves — SynciManager's
// _openSuggestMenu() guards those items with `typeof bridge.export… === 'function'`.
// ============================================================================

window.kolboDesktopSynciBridge = {
  /**
   * Plugin: add audio track(s) to the Premiere timeline.
   * Desktop: download each url to the configured download folder.
   * @returns {{ success: boolean, error?: string }}
   */
  async addMusicTracksToTimeline(urls, filenames) {
    try {
      for (let i = 0; i < urls.length; i++) {
        const res = await window.kolboDesktop.synciDownloadToDisk(urls[i], filenames[i]);
        if (res && res.success === false) {
          return { success: false, error: res.error || 'Download failed' };
        }
      }
      return { success: true };
    } catch (err) {
      console.error('[SynciBridge] download failed:', err);
      return { success: false, error: (err && err.message) || 'Download failed' };
    }
  }
};
