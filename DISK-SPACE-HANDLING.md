# Disk Space Handling

## Overview
The Kolbo Desktop app now includes comprehensive disk space checking and error handling to prevent issues when the user's hard drive is full.

## Features Implemented

### 1. Cache Size Calculation Fix ✅
- **Problem**: Cache size showed 0.00 MB due to conflicting cache directories
- **Solution**: Unified all cache operations to use `app.getPath('userData')/MediaCache`
- **Location**:
  - Windows: `C:\Users\[User]\AppData\Roaming\kolbo-desktop\MediaCache`
  - macOS: `~/Library/Application Support/kolbo-desktop/MediaCache`

### 2. No Cache Limitations ✅
- **Policy**: No automatic cache size limits (removed 5GB restriction)
- **Reason**: Prevents corruption of NLE projects that reference cached files
- **User Control**: Users manage cache manually via Settings → Clear Cache button

### 3. Disk Space Checking ✅
- **Package**: `check-disk-space` npm package
- **When**: Before every download operation
- **Buffer**: Maintains 500MB safety buffer for system stability
- **Locations Checked**:
  - Cache downloads: `MediaCache` directory
  - Batch downloads: User-selected target folder

### 4. Error Handling ✅

#### Before Download
- **Check**: Available disk space vs required space (+ 500MB buffer)
- **Action if insufficient**:
  - Show error dialog to user
  - Cancel download
  - Suggest clearing cache or freeing disk space
- **Action if low (<2GB)**:
  - Log warning
  - Allow download to proceed
  - User is informed via console

#### During Download (ENOSPC Errors)
- **Caught in**: Both FileManager and MediaCache classes
- **Error Code**: `ENOSPC` (No Space)
- **User Experience**:
  - Clear error dialog: "Disk Full"
  - Specific file name mentioned
  - Actionable suggestions (free space, clear cache)
  - Partial files are automatically cleaned up

### 5. Implementation Details

#### FileManager (file-manager.js)

**New Functions:**
- `checkDiskSpace(directoryPath)` - Check available space for a path
- `hasEnoughDiskSpace(requiredBytes, targetPath)` - Validate space with buffer

**Updated Functions:**
- `downloadFile()` - Added pre-download space check + ENOSPC handling
- `batchDownload()` - Added batch space check + per-file ENOSPC handling

**Error Messages:**
```javascript
// Insufficient space before download
dialog.showErrorBox(
  'Insufficient Disk Space',
  `Cannot download ${fileName}.

  ${spaceMessage}

  Please free up disk space and try again, or clear cached files in Settings.`
);

// ENOSPC during download
dialog.showErrorBox(
  'Disk Full',
  `Your disk is full. Cannot download ${fileName}.

  Please free up disk space and try again, or clear cached files in Settings.`
);
```

#### MediaCache (main.js)

**Updated Functions:**
- `downloadFile()` - Added ENOSPC error handling with user dialogs

**Error Detection:**
- Monitors file write stream errors
- Detects `err.code === 'ENOSPC'`
- Cleans up partial downloads
- Shows helpful error dialogs

### 6. User Experience

#### Scenario 1: Insufficient Space Before Download
1. User tries to download a file
2. App checks available disk space
3. If insufficient (less than file size + 500MB):
   - ❌ Download is prevented
   - 💬 Error dialog shows exact space available vs needed
   - 💡 User is directed to free space or clear cache

#### Scenario 2: Disk Full During Download
1. User starts download
2. Initial space check passes
3. Disk fills up during download (other apps, etc.)
4. Write operation fails with ENOSPC
5. App catches the error:
   - 🧹 Automatically deletes partial file
   - 💬 Error dialog explains the issue
   - 💡 User is directed to free space or clear cache

#### Scenario 3: Low Disk Space Warning
1. User has <2GB free space
2. Download is allowed to proceed
3. Warning is logged to console
4. No blocking dialog (user can continue working)

### 7. Safety Buffers

- **Minimum buffer**: 500MB kept free for system stability
- **Warning threshold**: 2GB (warns but allows download)
- **Estimation**: If file size unknown, estimates 100MB per file

### 8. Batch Download Handling

- **Pre-check**: Estimates total size (100MB × file count)
- **Early stop**: If any file fails with ENOSPC, batch stops
- **User notification**: Told which file failed and total progress
- **Partial success**: Returns count of successful vs failed downloads

### 9. Testing Recommendations

To test disk space handling:

1. **Low Space Simulation**:
   ```bash
   # Create large dummy file to fill disk
   fsutil file createnew dummy.dat 10737418240  # Windows: 10GB
   dd if=/dev/zero of=dummy.dat bs=1G count=10  # macOS/Linux: 10GB
   ```

2. **Test Cases**:
   - Try downloading with <500MB free → Should fail with error
   - Try downloading with ~1.5GB free → Should warn but succeed
   - Try batch download with limited space → Should stop gracefully
   - Fill disk during active download → Should catch ENOSPC and clean up

3. **Expected Results**:
   - Clear, actionable error messages
   - No partial/corrupted files left behind
   - App remains stable and responsive

## Configuration

### No Configuration Required
All disk space handling is automatic and built-in. Users don't need to configure anything.

### For Developers

To adjust safety buffers, edit `file-manager.js`:

```javascript
// Line ~81: Adjust buffer size
const bufferBytes = 500 * 1024 * 1024; // 500MB default

// Line ~91: Adjust warning threshold
if (availableBytes < 2 * 1024 * 1024 * 1024) {
  // Warn if less than 2GB
}

// Line ~119: Adjust file size estimate
const estimatedSize = 100 * 1024 * 1024; // 100MB per file
```

## Files Modified

1. **package.json**
   - Added: `check-disk-space` dependency

2. **src/main/file-manager.js**
   - Added: `checkDiskSpace()` utility
   - Added: `hasEnoughDiskSpace()` validation
   - Updated: `downloadFile()` with space checks
   - Updated: `batchDownload()` with space checks

3. **src/main/main.js**
   - Added: `checkDiskSpace` import
   - Updated: MediaCache `downloadFile()` with ENOSPC handling
   - Updated: Cache paths unified to userData

## Benefits

✅ **No data loss**: Partial downloads are cleaned up
✅ **Clear errors**: Users understand what went wrong
✅ **Actionable**: Users know exactly what to do
✅ **No corruption**: NLE projects stay safe
✅ **System stability**: 500MB buffer prevents system hangs
✅ **Graceful degradation**: Warnings don't block work

## Support

If users encounter disk space issues:

1. **Check cache size**: Settings → Cache Size
2. **Clear cache**: Settings → Clear Cache button
3. **Free disk space**:
   - Delete unused files
   - Empty Recycle Bin/Trash
   - Uninstall unused applications
4. **Check disk usage**: Windows Settings → Storage / macOS → About This Mac → Storage

---

**Last Updated**: 2025-12-20
**Version**: 1.0.5+
**Status**: ✅ Production Ready
