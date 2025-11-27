#!/bin/bash
# ============================================================================
# Kolbo Desktop - macOS Build Script
# ============================================================================
# This script builds all macOS installers (development, staging, production)
# Run this script on a Mac with Node.js and npm installed
# ============================================================================

set -e  # Exit on error

echo "========================================"
echo "  Kolbo Desktop - macOS Build Script"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}ERROR: This script must be run on macOS${NC}"
    exit 1
fi

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}ERROR: Node.js is not installed${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}ERROR: npm is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js version: $(node --version)"
echo -e "${GREEN}✓${NC} npm version: $(npm --version)"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

# Get environment from argument or default to production
ENVIRONMENT=${1:-production}

# Validate environment
if [[ "$ENVIRONMENT" != "development" && "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    echo -e "${RED}ERROR: Invalid environment: $ENVIRONMENT${NC}"
    echo "Valid options: development, staging, production"
    echo ""
    echo "Usage: ./build-mac.sh [environment]"
    echo "Example: ./build-mac.sh staging"
    exit 1
fi

echo "Building for environment: ${YELLOW}$ENVIRONMENT${NC}"
echo ""

# Build based on environment
case "$ENVIRONMENT" in
    "development")
        echo "Building DEVELOPMENT installer (localhost:5050)..."
        npm run build:dev:mac
        ;;
    "staging")
        echo "Building STAGING installer (stagingapi.kolbo.ai)..."
        npm run build:staging:mac
        ;;
    "production")
        echo "Building PRODUCTION installer (api.kolbo.ai)..."
        npm run build:prod:mac
        ;;
esac

# Check if build was successful
if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo -e "  ${GREEN}Build Complete!${NC}"
    echo "========================================"
    echo ""
    echo "Installer created in: dist/"
    echo ""
    ls -lh dist/*.dmg 2>/dev/null || echo "DMG file will be in dist/ folder"
    echo ""
    echo "Next steps:"
    echo "  1. Test the installer on a clean Mac"
    echo "  2. Verify correct API endpoint"
    echo "  3. Test login and media browsing"
    echo "  4. Upload to website for distribution"
    echo ""
else
    echo ""
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi
