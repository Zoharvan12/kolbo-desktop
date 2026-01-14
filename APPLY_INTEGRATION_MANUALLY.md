# Manual Integration Steps - Trimmer Feature

**IMPORTANT**: Please close Kolbo Studio before applying these changes.

## Step 1: Update `src/renderer/index.html`

### 1a. Add Trimmer CSS (around line 18)

Find this section:
```html
<!-- Format Factory Styles -->
<link rel="stylesheet" href="css/format-factory.css?v=1">
</head>
```

Change to:
```html
<!-- Format Factory Styles -->
<link rel="stylesheet" href="css/format-factory.css?v=1">
<!-- Trimmer Styles -->
<link rel="stylesheet" href="css/trimmer.css?v=1">
</head>
```

### 1b. Add Trimmer Scripts (around line 1079)

Find this section:
```html
<script src="js/tab-manager.js?v=5"></script>
<script src="js/format-factory-manager.js?v=1"></script>
```

Change to:
```html
<script src="js/tab-manager.js?v=5"></script>
<!-- Trimmer Components (load BEFORE format-factory-manager) -->
<script src="js/trimmer/video-trimmer.js?v=1"></script>
<script src="js/trimmer/audio-trimmer.js?v=1"></script>
<script src="js/trimmer/trimmer-modal.js?v=1"></script>
<script src="js/format-factory-manager.js?v=1"></script>
```

## Step 2: Update `src/main/ffmpeg-handler.js`

### 2a. Add trim parameters to job destructuring (line 97)

Find:
```javascript
const { id, filePath, outputFormat, outputType, settings, outputFolder } = job;
```

Replace with:
```javascript
const { id, filePath, outputFormat, outputType, settings, outputFolder, trimStart, trimEnd } = job;
```

### 2b. Add trim info to logging (lines 99-104)

Find:
```javascript
console.log('[FFmpeg Handler] Starting conversion:', {
  id,
  input: filePath,
  format: outputFormat,
  type: outputType
});
```

Replace with:
```javascript
console.log('[FFmpeg Handler] Starting conversion:', {
  id,
  input: filePath,
  format: outputFormat,
  type: outputType,
  trim: trimStart !== undefined ? `${trimStart}s - ${trimEnd}s` : 'none'
});
```

### 2c. Add trim processing logic (after line 158)

Find:
```javascript
const command = ffmpeg(filePath);

// Apply conversion settings based on type
```

Replace with:
```javascript
const command = ffmpeg(filePath);

// Apply trim settings if specified (MUST be set before codec settings)
if (trimStart !== undefined && trimEnd !== undefined) {
  console.log(`[FFmpeg Handler] Applying trim: ${trimStart}s to ${trimEnd}s`);
  // -ss: start time, -to: end time (both in seconds)
  command.setStartTime(trimStart);
  command.duration(trimEnd - trimStart);
}

// Apply conversion settings based on type
```

## Step 3: Update `src/renderer/js/format-factory-manager.js`

This file requires more extensive changes. Please refer to **TRIMMER_INTEGRATION_GUIDE.md** Section "Step 3" for complete code snippets.

Key changes needed:
1. Add trim properties to job object in `addToQueue()` method
2. Add trim button to table row action buttons
3. Add `openTrimmer()` method to the class
4. Update `convertJob()` to pass trim data to backend

## Verification

After applying all changes:

1. Save all files
2. Run: `npm start`
3. Go to Format Factory tab
4. Add a video or audio file
5. Click the scissors (✂️) button
6. Verify trimmer modal opens
7. Test trimming and conversion

## Troubleshooting

If trimmer doesn't open:
- Check browser console (F12) for errors
- Verify all script tags are loaded in correct order
- Ensure trimmer.css is loaded

If trim doesn't apply during conversion:
- Check FFmpeg logs in terminal
- Verify trim parameters are in job object
- Check that FFmpeg command includes -ss and -t flags

## Files Created

All trimmer component files are already created:
- ✅ src/renderer/js/trimmer/video-trimmer.js
- ✅ src/renderer/js/trimmer/audio-trimmer.js
- ✅ src/renderer/js/trimmer/trimmer-modal.js
- ✅ src/renderer/css/trimmer.css

You only need to update the 3 files listed above to integrate them.
