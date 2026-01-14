/**
 * PATCH FILE: FFmpeg Trim Support
 *
 * This file contains the changes needed to add trimming support to ffmpeg-handler.js
 * Apply these changes manually to src/main/ffmpeg-handler.js
 */

// 1. UPDATE: Line 97 - Add trimStart and trimEnd to destructuring
// OLD:
// const { id, filePath, outputFormat, outputType, settings, outputFolder } = job;
// NEW:
const { id, filePath, outputFormat, outputType, settings, outputFolder, trimStart, trimEnd } = job;

// 2. UPDATE: Lines 99-104 - Add trim info to logging
// OLD:
// console.log('[FFmpeg Handler] Starting conversion:', {
//   id,
//   input: filePath,
//   format: outputFormat,
//   type: outputType
// });
// NEW:
console.log('[FFmpeg Handler] Starting conversion:', {
  id,
  input: filePath,
  format: outputFormat,
  type: outputType,
  trim: trimStart !== undefined ? `${trimStart}s - ${trimEnd}s` : 'none'
});

// 3. INSERT: After line 158 (after "const command = ffmpeg(filePath);")
// Add trim settings before applying codec settings
if (trimStart !== undefined && trimEnd !== undefined) {
  console.log(`[FFmpeg Handler] Applying trim: ${trimStart}s to ${trimEnd}s`);
  // -ss: start time (in seconds)
  // -t: duration (in seconds)
  command.setStartTime(trimStart);
  command.duration(trimEnd - trimStart);
}

/**
 * COMPLETE UPDATED convertFile METHOD (for reference):
 */
async function convertFile(job) {
  const { id, filePath, outputFormat, outputType, settings, outputFolder, trimStart, trimEnd } = job;

  console.log('[FFmpeg Handler] Starting conversion:', {
    id,
    input: filePath,
    format: outputFormat,
    type: outputType,
    trim: trimStart !== undefined ? `${trimStart}s - ${trimEnd}s` : 'none'
  });

  // ... validation code remains the same ...

  return new Promise((resolve, reject) => {
    try {
      const command = ffmpeg(filePath);

      // Apply trim settings if specified (MUST be set BEFORE codec settings)
      if (trimStart !== undefined && trimEnd !== undefined) {
        console.log(`[FFmpeg Handler] Applying trim: ${trimStart}s to ${trimEnd}s`);
        command.setStartTime(trimStart);
        command.duration(trimEnd - trimStart);
      }

      // Apply conversion settings based on type
      if (outputType === 'video') {
        this.applyVideoSettings(command, outputFormat, settings);
        const ffmpegFormat = FORMAT_MAPPINGS.video[outputFormat] || outputFormat;
        command.format(ffmpegFormat);
      } else if (outputType === 'audio') {
        this.applyAudioSettings(command, outputFormat, settings);
        const ffmpegFormat = FORMAT_MAPPINGS.audio[outputFormat] || outputFormat;
        command.format(ffmpegFormat);
      } else if (outputType === 'image') {
        this.applyImageSettings(command, outputFormat, settings);
        const ffmpegFormat = FORMAT_MAPPINGS.image[outputFormat] || 'image2';
        command.format(ffmpegFormat);
      }

      // ... rest of the method remains the same ...
    } catch (error) {
      console.error('[FFmpeg Handler] Setup error:', error);
      reject(error);
    }
  });
}

// INSTRUCTIONS:
// 1. Open src/main/ffmpeg-handler.js
// 2. Find the convertFile method (starts around line 96)
// 3. Apply the three changes listed above
// 4. Save the file
// 5. Delete this patch file once applied
