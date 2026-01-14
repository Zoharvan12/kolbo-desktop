# Kolbo Studio - Trimmer Integration Automation Script
# This script applies all necessary changes to integrate the trimmer feature

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Kolbo Studio Trimmer Integration" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

$baseDir = "G:\Projects\Kolbo.AI\github\kolbo-desktop"

# Check if any Electron process is running
Write-Host "Checking for running processes..." -ForegroundColor Yellow
$electronProcesses = Get-Process | Where-Object {$_.ProcessName -match "Kolbo|electron"} 2>$null
if ($electronProcesses) {
    Write-Host "WARNING: Kolbo Studio or Electron is running!" -ForegroundColor Red
    Write-Host "Please close the application before running this script." -ForegroundColor Red
    Write-Host ""
    $electronProcesses | Format-Table ProcessName, Id
    Write-Host ""
    $response = Read-Host "Do you want to continue anyway? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Host "Exiting..." -ForegroundColor Yellow
        exit
    }
}

Write-Host "Starting integration..." -ForegroundColor Green
Write-Host ""

# ========== 1. UPDATE INDEX.HTML ==========
Write-Host "[1/3] Updating index.html..." -ForegroundColor Cyan

$indexPath = Join-Path $baseDir "src\renderer\index.html"
$indexContent = Get-Content $indexPath -Raw

# Add trimmer CSS
if ($indexContent -notmatch "trimmer\.css") {
    Write-Host "  - Adding trimmer.css link..." -ForegroundColor Yellow
    $indexContent = $indexContent -replace `
        '(<!-- Format Factory Styles -->\s*<link rel="stylesheet" href="css/format-factory\.css\?v=1">)',
        "`$1`r`n  <!-- Trimmer Styles -->`r`n  <link rel=`"stylesheet`" href=`"css/trimmer.css?v=1`">"
    Write-Host "  ✓ Added trimmer.css" -ForegroundColor Green
} else {
    Write-Host "  ✓ trimmer.css already present" -ForegroundColor Gray
}

# Add trimmer scripts
if ($indexContent -notmatch "trimmer/video-trimmer\.js") {
    Write-Host "  - Adding trimmer scripts..." -ForegroundColor Yellow
    $indexContent = $indexContent -replace `
        '(<script src="js/tab-manager\.js\?v=5"></script>)',
        "`$1`r`n  <!-- Trimmer Components (load BEFORE format-factory-manager) -->`r`n  <script src=`"js/trimmer/video-trimmer.js?v=1`"></script>`r`n  <script src=`"js/trimmer/audio-trimmer.js?v=1`"></script>`r`n  <script src=`"js/trimmer/trimmer-modal.js?v=1`"></script>"
    Write-Host "  ✓ Added trimmer scripts" -ForegroundColor Green
} else {
    Write-Host "  ✓ Trimmer scripts already present" -ForegroundColor Gray
}

Set-Content $indexPath -Value $indexContent -NoNewline
Write-Host "✓ index.html updated successfully!" -ForegroundColor Green
Write-Host ""

# ========== 2. UPDATE FFMPEG-HANDLER.JS ==========
Write-Host "[2/3] Updating ffmpeg-handler.js..." -ForegroundColor Cyan

$ffmpegPath = Join-Path $baseDir "src\main\ffmpeg-handler.js"
$ffmpegContent = Get-Content $ffmpegPath -Raw

$ffmpegModified = $false

# Change 1: Add trimStart and trimEnd to destructuring
if ($ffmpegContent -match "const \{ id, filePath, outputFormat, outputType, settings, outputFolder \} = job;") {
    Write-Host "  - Adding trim parameters to job destructuring..." -ForegroundColor Yellow
    $ffmpegContent = $ffmpegContent -replace `
        "const \{ id, filePath, outputFormat, outputType, settings, outputFolder \} = job;",
        "const { id, filePath, outputFormat, outputType, settings, outputFolder, trimStart, trimEnd } = job;"
    $ffmpegModified = $true
    Write-Host "  ✓ Added trim parameters" -ForegroundColor Green
} else {
    Write-Host "  ✓ Trim parameters already added" -ForegroundColor Gray
}

# Change 2: Add trim to logging
if ($ffmpegContent -notmatch "trim:") {
    Write-Host "  - Adding trim info to logging..." -ForegroundColor Yellow
    $ffmpegContent = $ffmpegContent -replace `
        "console\.log\('\[FFmpeg Handler\] Starting conversion:', \{\s*id,\s*input: filePath,\s*format: outputFormat,\s*type: outputType\s*\}\);",
        "console.log('[FFmpeg Handler] Starting conversion:', {`r`n      id,`r`n      input: filePath,`r`n      format: outputFormat,`r`n      type: outputType,`r`n      trim: trimStart !== undefined ? ``${trimStart}s - ${trimEnd}s`` : 'none'`r`n    });"
    $ffmpegModified = $true
    Write-Host "  ✓ Added trim logging" -ForegroundColor Green
} else {
    Write-Host "  ✓ Trim logging already added" -ForegroundColor Gray
}

# Change 3: Add trim logic before codec settings
if ($ffmpegContent -notmatch "Apply trim settings") {
    Write-Host "  - Adding trim processing logic..." -ForegroundColor Yellow
    $ffmpegContent = $ffmpegContent -replace `
        "(const command = ffmpeg\(filePath\);)\s*(// Apply conversion settings)",
        "`$1`r`n`r`n        // Apply trim settings if specified (MUST be set before codec settings)`r`n        if (trimStart !== undefined && trimEnd !== undefined) {`r`n          console.log(``[FFmpeg Handler] Applying trim: ${trimStart}s to ${trimEnd}s``);`r`n          // -ss: start time, -to: end time (both in seconds)`r`n          command.setStartTime(trimStart);`r`n          command.duration(trimEnd - trimStart);`r`n        }`r`n`r`n        `$2"
    $ffmpegModified = $true
    Write-Host "  ✓ Added trim processing" -ForegroundColor Green
} else {
    Write-Host "  ✓ Trim processing already added" -ForegroundColor Gray
}

if ($ffmpegModified) {
    Set-Content $ffmpegPath -Value $ffmpegContent -NoNewline
    Write-Host "✓ ffmpeg-handler.js updated successfully!" -ForegroundColor Green
} else {
    Write-Host "✓ ffmpeg-handler.js already up to date!" -ForegroundColor Green
}
Write-Host ""

# ========== 3. SUMMARY & NEXT STEPS ==========
Write-Host "[3/3] Integration Status" -ForegroundColor Cyan
Write-Host ""
Write-Host "✓ Trimmer components created:" -ForegroundColor Green
Write-Host "  - src/renderer/js/trimmer/video-trimmer.js"
Write-Host "  - src/renderer/js/trimmer/audio-trimmer.js"
Write-Host "  - src/renderer/js/trimmer/trimmer-modal.js"
Write-Host "  - src/renderer/css/trimmer.css"
Write-Host ""
Write-Host "✓ Core files updated:" -ForegroundColor Green
Write-Host "  - src/renderer/index.html (scripts & styles)"
Write-Host "  - src/main/ffmpeg-handler.js (trim support)"
Write-Host ""
Write-Host "⚠️  MANUAL STEP REQUIRED:" -ForegroundColor Yellow
Write-Host "  Update src/renderer/js/format-factory-manager.js"
Write-Host "  Follow instructions in: TRIMMER_INTEGRATION_GUIDE.md"
Write-Host "  (Search for 'Step 3' in the guide)"
Write-Host ""
Write-Host "📖 Full documentation:" -ForegroundColor Cyan
Write-Host "  - TRIMMER_INTEGRATION_GUIDE.md (complete integration guide)"
Write-Host "  - src/main/ffmpeg-trim-support.patch.js (reference patches)"
Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Integration Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Complete manual updates to format-factory-manager.js"
Write-Host "2. Test with: npm start"
Write-Host "3. Try trimming a video or audio file!"
Write-Host ""
