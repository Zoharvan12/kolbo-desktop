# Video & Audio Trimmer Integration Guide

## Overview
This guide explains how to integrate the new video and audio trimming functionality into the Format Factory.

## Files Created
1. **src/renderer/js/trimmer/video-trimmer.js** - Video trimmer component with thumbnail timeline
2. **src/renderer/js/trimmer/audio-trimmer.js** - Audio trimmer component with waveform visualization
3. **src/renderer/js/trimmer/trimmer-modal.js** - Unified modal dialog for both trimmers
4. **src/renderer/css/trimmer.css** - Complete styling for all trimmer components
5. **src/main/ffmpeg-trim-support.patch.js** - Patch file for FFmpeg handler changes

## Integration Steps

### Step 1: Update HTML (src/renderer/index.html)

Add the trimmer scripts and styles BEFORE the format-factory-manager.js script:

```html
<!-- Format Factory Styles -->
<link rel="stylesheet" href="css/format-factory.css">
<!-- ADD THIS: Trimmer Styles -->
<link rel="stylesheet" href="css/trimmer.css">

<!-- Other scripts... -->

<!-- ADD THESE: Trimmer Scripts (BEFORE format-factory-manager.js) -->
<script src="js/trimmer/video-trimmer.js"></script>
<script src="js/trimmer/audio-trimmer.js"></script>
<script src="js/trimmer/trimmer-modal.js"></script>

<!-- Format Factory Manager -->
<script src="js/format-factory-manager.js"></script>
```

### Step 2: Update FFmpeg Handler (src/main/ffmpeg-handler.js)

Open `src/main/ffmpeg-trim-support.patch.js` and apply the changes manually:

**Change 1** - Line 97 (add trimStart and trimEnd to destructuring):
```javascript
// OLD:
const { id, filePath, outputFormat, outputType, settings, outputFolder } = job;

// NEW:
const { id, filePath, outputFormat, outputType, settings, outputFolder, trimStart, trimEnd } = job;
```

**Change 2** - Lines 99-104 (add trim info to logging):
```javascript
// OLD:
console.log('[FFmpeg Handler] Starting conversion:', {
  id,
  input: filePath,
  format: outputFormat,
  type: outputType
});

// NEW:
console.log('[FFmpeg Handler] Starting conversion:', {
  id,
  input: filePath,
  format: outputFormat,
  type: outputType,
  trim: trimStart !== undefined ? `${trimStart}s - ${trimEnd}s` : 'none'
});
```

**Change 3** - After line 158 (add trim logic BEFORE codec settings):
```javascript
const command = ffmpeg(filePath);

// ADD THIS:
// Apply trim settings if specified (MUST be set BEFORE codec settings)
if (trimStart !== undefined && trimEnd !== undefined) {
  console.log(`[FFmpeg Handler] Applying trim: ${trimStart}s to ${trimEnd}s`);
  command.setStartTime(trimStart);
  command.duration(trimEnd - trimStart);
}

// Apply conversion settings based on type...
```

### Step 3: Update Format Factory Manager (src/renderer/js/format-factory-manager.js)

**Change 1** - Update `addToQueue` method (around line 681):

Add trim properties to job object:

```javascript
const job = {
  id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  file: file,
  fileName: file.name,
  filePath: filePath,
  fileSize: file.size,
  fileType: file.type,
  outputFormat: this.selectedFormat,
  outputType: this.selectedType,
  status: 'pending',
  progress: 0,
  settings: this.getDefaultSettings(this.selectedType, this.selectedFormat),
  // ADD THESE:
  trimStart: undefined,
  trimEnd: undefined,
  hasTrim: false
};
```

**Change 2** - Update table row action buttons (around line 805):

Add trim button before the settings button in the actions cell:

```javascript
actionsCell.innerHTML = `
  <div style="display: flex; gap: 8px; justify-content: flex-end;">
    <!-- ADD THIS: Trim Button -->
    <button class="ff-btn" data-action="trim" title="Trim ${job.outputType === 'video' ? 'Video' : 'Audio'}" ${job.status === 'processing' ? 'disabled' : ''}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 4 L12 8 L20 12 M20 12 L12 16 L20 20"/>
        <path d="M4 4 L12 8 L4 12 M4 12 L12 16 L4 20"/>
      </svg>
    </button>

    <button class="ff-btn" data-action="settings" title="Change Format" ${job.status === 'processing' ? 'disabled' : ''}>
      <!-- ... existing SVG ... -->
    </button>

    <button class="ff-btn" data-action="remove" title="Remove" ${job.status === 'processing' ? 'disabled' : ''}>
      <!-- ... existing SVG ... -->
    </button>
  </div>
`;
```

**Change 3** - Add event listener for trim button (around line 843):

```javascript
// Add this AFTER the settings button listener
const trimBtn = actionsCell.querySelector('[data-action="trim"]');
if (trimBtn) {
  trimBtn.addEventListener('click', () => this.openTrimmer(job.id));
}
```

**Change 4** - Add `openTrimmer` method (add anywhere in the class, around line 1090):

```javascript
/**
 * Open trimmer modal for a job
 * @param {string} jobId - Job ID to trim
 */
async openTrimmer(jobId) {
  const job = this.queue.find(j => j.id === jobId);
  if (!job) return;

  console.log('[Format Factory] Opening trimmer for:', job.fileName);

  // Determine file type for trimmer
  const fileType = job.fileType.startsWith('video/') ? 'video' : 'audio';

  // Open trimmer modal
  const trimPoints = await window.trimmerModal.open(job.file, fileType, {
    maxDuration: 300, // 5 minutes default
    minDuration: 1
  });

  // If user cancelled (null) or skipped (null), do nothing
  if (trimPoints === null) {
    console.log('[Format Factory] User cancelled/skipped trimming');
    return;
  }

  // Apply trim points to job
  job.trimStart = trimPoints[0];
  job.trimEnd = trimPoints[1];
  job.hasTrim = true;

  console.log('[Format Factory] Trim points applied:', trimPoints);

  // Update UI to show trim indicator
  this.updateTableUI();
}
```

**Change 5** - Update `convertJob` method (around line 1170):

Update the serializable job to include trim data:

```javascript
// Create serializable job object (remove File object, keep only path)
const serializableJob = {
  id: job.id,
  filePath: job.filePath,
  fileName: job.fileName,
  fileSize: job.fileSize,
  fileType: job.fileType,
  outputFormat: job.outputFormat,
  outputType: job.outputType,
  settings: job.settings,
  outputFolder: outputFolder,
  // ADD THESE:
  trimStart: job.trimStart,
  trimEnd: job.trimEnd
};
```

**Optional Enhancement** - Show trim indicator in UI:

Update the output cell to show if a trim is applied (around line 790):

```javascript
outputCell.innerHTML = `
  <div class="ff-output-info">
    <div class="ff-output-format">
      → ${job.outputFormat.toUpperCase()}
      ${job.hasTrim ? ' <span style="color: #3b82f6; font-size: 10px;">✂️ TRIMMED</span>' : ''}
    </div>
    <div class="ff-progress-container">
      <!-- ... progress bar ... -->
    </div>
  </div>
`;
```

### Step 4: Update Main Process IPC Handlers (src/main/main.js)

Make sure the FFmpeg handler is properly integrated. The existing setup should already work if you've applied the ffmpeg-handler changes.

## Testing

1. **Test Video Trimming:**
   - Add a video file (MP4, MOV, etc.)
   - Click the trim button (scissors icon)
   - Adjust trim points using the handles
   - Preview the selection with play button
   - Apply trim and convert

2. **Test Audio Trimming:**
   - Add an audio file (MP3, WAV, etc.)
   - Click the trim button
   - See waveform visualization
   - Adjust trim points
   - Apply trim and convert

3. **Test Skip/Cancel:**
   - Open trimmer
   - Click "Skip Trim" to convert without trimming
   - Or click "Cancel" to return without changes

4. **Test Multiple Files:**
   - Add multiple files
   - Trim each one individually
   - Convert all at once

## Features Implemented

- Visual timeline with thumbnail preview for video
- Waveform visualization for audio
- Dual-handle range slider for precise trimming
- Play/pause preview of trimmed segment
- Min/max duration constraints
- Skip trimming option (convert original)
- Responsive design for mobile/tablet
- Integration with existing Format Factory workflow

## Troubleshooting

**Trimmer doesn't open:**
- Check browser console for errors
- Verify all trimmer scripts are loaded before format-factory-manager.js
- Check that `window.trimmerModal` is defined

**FFmpeg trim not working:**
- Verify the ffmpeg-handler changes were applied correctly
- Check that trimStart and trimEnd are being passed in the job object
- Look for FFmpeg command in logs - should include -ss and -t flags

**Video/Audio won't load:**
- Check file format is supported by browser
- For video: MP4 (H.264) is most compatible
- For audio: MP3, WAV are most compatible
- Check browser console for codec errors

## Architecture

```
User adds file → Format Factory Queue
     ↓
User clicks Trim button
     ↓
TrimmerModal opens (trimmer-modal.js)
     ↓
VideoTrimmer OR AudioTrimmer loads (video-trimmer.js / audio-trimmer.js)
     ↓
User adjusts trim points & previews
     ↓
User clicks "Apply Trim"
     ↓
Trim points saved to job object
     ↓
User starts conversion
     ↓
FFmpegHandler applies trim (setStartTime + duration)
     ↓
Converted file with trim applied
```

## Cleanup

Once integration is complete and tested:
1. Delete `src/main/ffmpeg-trim-support.patch.js`
2. Delete this guide file `TRIMMER_INTEGRATION_GUIDE.md`
