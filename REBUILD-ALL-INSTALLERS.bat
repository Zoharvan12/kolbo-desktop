@echo off
REM ============================================================================
REM Kolbo Desktop - Rebuild ALL Windows Installers with Branding
REM ============================================================================
REM This script rebuilds all 3 Windows installers with the 9:16 sidebar image
REM ============================================================================

echo ========================================
echo  Rebuilding ALL Windows Installers
echo  With 9:16 Sidebar Branding
echo ========================================
echo.

echo This will rebuild 3 installers:
echo   1. Production (api.kolbo.ai)
echo   2. Staging (stagingapi.kolbo.ai)
echo   3. Development (localhost:5050)
echo.
echo This may take 5-10 minutes...
echo.

pause

REM Build Production
echo ========================================
echo Building 1/3: PRODUCTION
echo ========================================
call npm run build:prod:win
if errorlevel 1 (
    echo ERROR: Production build failed!
    pause
    exit /b 1
)
echo.

REM Build Staging
echo ========================================
echo Building 2/3: STAGING
echo ========================================
call npm run build:staging:win
if errorlevel 1 (
    echo ERROR: Staging build failed!
    pause
    exit /b 1
)
echo.

REM Build Development
echo ========================================
echo Building 3/3: DEVELOPMENT
echo ========================================
call npm run build:dev:win
if errorlevel 1 (
    echo ERROR: Development build failed!
    pause
    exit /b 1
)
echo.

echo ========================================
echo  ALL BUILDS COMPLETE!
echo ========================================
echo.
echo All installers now include the branded 9:16 sidebar!
echo.
echo Output files:
dir /B dist\*.exe
echo.
echo Next steps:
echo   1. Test the installers (double-click to see branded sidebar)
echo   2. Distribute production installer
echo   3. Commit changes to git
echo.
pause
