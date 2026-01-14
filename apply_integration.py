#!/usr/bin/env python3
"""
Kolbo Studio - Trimmer Integration Automation Script
Applies all necessary changes to integrate the trimmer feature
"""

import os
import re
import sys

def read_file(path):
    """Read file content"""
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(path, content):
    """Write file content"""
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(content)

def update_index_html(base_dir):
    """Update index.html to include trimmer CSS and scripts"""
    print("[1/2] Updating index.html...")

    index_path = os.path.join(base_dir, 'src', 'renderer', 'index.html')
    content = read_file(index_path)

    modified = False

    # Add trimmer CSS
    if 'trimmer.css' not in content:
        print("  - Adding trimmer.css link...")
        content = re.sub(
            r'(<!-- Format Factory Styles -->\s*<link rel="stylesheet" href="css/format-factory\.css\?v=1">)',
            r'\1\n  <!-- Trimmer Styles -->\n  <link rel="stylesheet" href="css/trimmer.css?v=1">',
            content
        )
        print("  ✓ Added trimmer.css")
        modified = True
    else:
        print("  ✓ trimmer.css already present")

    # Add trimmer scripts
    if 'trimmer/video-trimmer.js' not in content:
        print("  - Adding trimmer scripts...")
        content = re.sub(
            r'(<script src="js/tab-manager\.js\?v=5"></script>)',
            r'\1\n  <!-- Trimmer Components (load BEFORE format-factory-manager) -->\n  <script src="js/trimmer/video-trimmer.js?v=1"></script>\n  <script src="js/trimmer/audio-trimmer.js?v=1"></script>\n  <script src="js/trimmer/trimmer-modal.js?v=1"></script>',
            content
        )
        print("  ✓ Added trimmer scripts")
        modified = True
    else:
        print("  ✓ Trimmer scripts already present")

    if modified:
        write_file(index_path, content)
        print("✓ index.html updated successfully!\n")
    else:
        print("✓ index.html already up to date!\n")

    return modified

def update_ffmpeg_handler(base_dir):
    """Update ffmpeg-handler.js to support trimming"""
    print("[2/2] Updating ffmpeg-handler.js...")

    ffmpeg_path = os.path.join(base_dir, 'src', 'main', 'ffmpeg-handler.js')
    content = read_file(ffmpeg_path)

    modified = False

    # Change 1: Add trimStart and trimEnd to destructuring
    if 'trimStart, trimEnd' not in content:
        print("  - Adding trim parameters to job destructuring...")
        content = re.sub(
            r'const \{ id, filePath, outputFormat, outputType, settings, outputFolder \} = job;',
            r'const { id, filePath, outputFormat, outputType, settings, outputFolder, trimStart, trimEnd } = job;',
            content
        )
        print("  ✓ Added trim parameters")
        modified = True
    else:
        print("  ✓ Trim parameters already added")

    # Change 2: Add trim to logging
    if 'trim:' not in content:
        print("  - Adding trim info to logging...")
        old_log = r"console\.log\('\[FFmpeg Handler\] Starting conversion:', \{\s*id,\s*input: filePath,\s*format: outputFormat,\s*type: outputType\s*\}\);"
        new_log = """console.log('[FFmpeg Handler] Starting conversion:', {
      id,
      input: filePath,
      format: outputFormat,
      type: outputType,
      trim: trimStart !== undefined ? `${trimStart}s - ${trimEnd}s` : 'none'
    });"""
        content = re.sub(old_log, new_log, content, flags=re.DOTALL)
        print("  ✓ Added trim logging")
        modified = True
    else:
        print("  ✓ Trim logging already added")

    # Change 3: Add trim logic before codec settings
    if 'Apply trim settings' not in content:
        print("  - Adding trim processing logic...")
        old_code = r'(const command = ffmpeg\(filePath\);)\s*(// Apply conversion settings)'
        new_code = r'''\1

        // Apply trim settings if specified (MUST be set before codec settings)
        if (trimStart !== undefined && trimEnd !== undefined) {
          console.log(`[FFmpeg Handler] Applying trim: ${trimStart}s to ${trimEnd}s`);
          // -ss: start time, -to: end time (both in seconds)
          command.setStartTime(trimStart);
          command.duration(trimEnd - trimStart);
        }

        \2'''
        content = re.sub(old_code, new_code, content)
        print("  ✓ Added trim processing")
        modified = True
    else:
        print("  ✓ Trim processing already added")

    if modified:
        write_file(ffmpeg_path, content)
        print("✓ ffmpeg-handler.js updated successfully!\n")
    else:
        print("✓ ffmpeg-handler.js already up to date!\n")

    return modified

def main():
    print("==================================")
    print("Kolbo Studio Trimmer Integration")
    print("==================================\n")

    base_dir = r'G:\Projects\Kolbo.AI\github\kolbo-desktop'

    if not os.path.exists(base_dir):
        print(f"ERROR: Directory not found: {base_dir}")
        sys.exit(1)

    try:
        html_modified = update_index_html(base_dir)
        ffmpeg_modified = update_ffmpeg_handler(base_dir)

        print("==================================")
        if html_modified or ffmpeg_modified:
            print("✓ Integration Applied Successfully!")
        else:
            print("✓ Already Integrated!")
        print("==================================\n")

        print("⚠️  MANUAL STEP REQUIRED:")
        print("  Update src/renderer/js/format-factory-manager.js")
        print("  Follow: TRIMMER_INTEGRATION_GUIDE.md (Step 3)\n")

        print("Next steps:")
        print("1. Complete format-factory-manager.js updates")
        print("2. Test with: npm start")
        print("3. Try trimming a video or audio file!\n")

    except Exception as e:
        print(f"\nERROR: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
