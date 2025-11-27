#!/bin/bash
# ============================================================================
# Kolbo Desktop - Build ALL macOS Installers
# ============================================================================
# This script builds all three environment versions sequentially
# Run this script on a Mac with Node.js and npm installed
# ============================================================================

set -e  # Exit on error

echo "============================================"
echo "  Kolbo Desktop - Build ALL macOS Installers"
echo "============================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "ERROR: This script must be run on macOS"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

# Track start time
START_TIME=$(date +%s)

echo "This will build 3 installers:"
echo "  1. Development (localhost:5050)"
echo "  2. Staging (stagingapi.kolbo.ai)"
echo "  3. Production (api.kolbo.ai)"
echo ""
echo "This may take 5-10 minutes..."
echo ""

# Build Development
echo "========================================"
echo "Building 1/3: DEVELOPMENT"
echo "========================================"
npm run build:dev:mac
echo ""

# Build Staging
echo "========================================"
echo "Building 2/3: STAGING"
echo "========================================"
npm run build:staging:mac
echo ""

# Build Production
echo "========================================"
echo "Building 3/3: PRODUCTION"
echo "========================================"
npm run build:prod:mac
echo ""

# Calculate time taken
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

# Show results
echo "============================================"
echo -e "  ${GREEN}ALL BUILDS COMPLETE!${NC}"
echo "============================================"
echo ""
echo "Time taken: ${MINUTES}m ${SECONDS}s"
echo ""
echo "Installers created:"
ls -lh dist/*.dmg 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""
echo "Next steps:"
echo "  1. Test each installer on clean Macs"
echo "  2. Verify environment-specific API endpoints"
echo "  3. Upload production build to website"
echo "  4. Share dev/staging builds with team"
echo ""
