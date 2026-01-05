#!/bin/bash
# ============================================================================
# macOS Code Signing Setup Helper Script
# ============================================================================
# This script helps you set up environment variables for macOS code signing
# Run this script and follow the prompts
# ============================================================================

set -e

echo "========================================"
echo "  macOS Code Signing Setup Helper"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}ERROR: This script must be run on macOS${NC}"
    exit 1
fi

echo "This script will help you configure macOS code signing."
echo "You'll need:"
echo "  1. Your Apple Developer Team ID"
echo "  2. Your Apple ID email"
echo "  3. An app-specific password (from appleid.apple.com)"
echo ""

read -p "Do you have all this information ready? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Please gather the required information first:"
    echo "  1. Team ID: https://developer.apple.com/account (look in top right)"
    echo "  2. App-specific password: https://appleid.apple.com → Security → App-Specific Passwords"
    echo ""
    echo "Then run this script again."
    exit 0
fi

echo ""
echo "Let's gather the information:"
echo ""

# Get Team ID
read -p "Enter your Apple Developer Team ID (e.g., ABC123DEF4): " TEAM_ID
if [ -z "$TEAM_ID" ]; then
    echo -e "${RED}ERROR: Team ID is required${NC}"
    exit 1
fi

# Get Apple ID
read -p "Enter your Apple ID email: " APPLE_ID
if [ -z "$APPLE_ID" ]; then
    echo -e "${RED}ERROR: Apple ID is required${NC}"
    exit 1
fi

# Get app-specific password
echo ""
echo "Generate an app-specific password at: https://appleid.apple.com"
echo "Go to: Security → App-Specific Passwords → Generate Password"
echo "Label it: 'Kolbo Studio Notarization'"
echo ""
read -p "Enter your app-specific password: " APP_SPECIFIC_PASSWORD
if [ -z "$APP_SPECIFIC_PASSWORD" ]; then
    echo -e "${RED}ERROR: App-specific password is required${NC}"
    exit 1
fi

# Determine company name (default to Kolbo.AI)
COMPANY_NAME="Kolbo.AI"
read -p "Enter your company/developer name (default: Kolbo.AI): " INPUT_COMPANY
if [ ! -z "$INPUT_COMPANY" ]; then
    COMPANY_NAME="$INPUT_COMPANY"
fi

# Build identity string
IDENTITY="Developer ID Application: ${COMPANY_NAME} (${TEAM_ID})"

echo ""
echo "========================================"
echo "  Configuration Summary"
echo "========================================"
echo ""
echo "Team ID: ${TEAM_ID}"
echo "Apple ID: ${APPLE_ID}"
echo "Company Name: ${COMPANY_NAME}"
echo "Identity: ${IDENTITY}"
echo ""

read -p "Is this correct? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Setup cancelled. Run the script again to start over."
    exit 0
fi

# Determine shell config file
if [ -f "$HOME/.zshrc" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
    SHELL_NAME="zsh"
elif [ -f "$HOME/.bash_profile" ]; then
    SHELL_CONFIG="$HOME/.bash_profile"
    SHELL_NAME="bash"
else
    SHELL_CONFIG="$HOME/.bashrc"
    SHELL_NAME="bash"
fi

echo ""
echo "Adding configuration to ${SHELL_CONFIG}..."
echo ""

# Check if already exists
if grep -q "APPLE_IDENTITY" "$SHELL_CONFIG" 2>/dev/null; then
    echo -e "${YELLOW}Warning: macOS signing configuration already exists in ${SHELL_CONFIG}${NC}"
    read -p "Do you want to replace it? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Remove old configuration
        sed -i '' '/# macOS Code Signing Configuration/,/^$/d' "$SHELL_CONFIG"
    else
        echo "Keeping existing configuration. Exiting."
        exit 0
    fi
fi

# Append configuration
cat >> "$SHELL_CONFIG" << EOF

# macOS Code Signing Configuration
export APPLE_IDENTITY="${IDENTITY}"
export APPLE_TEAM_ID="${TEAM_ID}"
export APPLE_ID="${APPLE_ID}"
export APPLE_APP_SPECIFIC_PASSWORD="${APP_SPECIFIC_PASSWORD}"
EOF

echo -e "${GREEN}✓${NC} Configuration added to ${SHELL_CONFIG}"
echo ""

# Verify certificates
echo "Checking for Developer ID certificates..."
echo ""

CERTIFICATES=$(security find-identity -v -p codesigning | grep "Developer ID" || true)

if [ -z "$CERTIFICATES" ]; then
    echo -e "${YELLOW}⚠ Warning: No Developer ID certificates found in Keychain${NC}"
    echo ""
    echo "You need to:"
    echo "  1. Go to https://developer.apple.com/account/resources/certificates/list"
    echo "  2. Create 'Developer ID Application' certificate"
    echo "  3. Create 'Developer ID Installer' certificate"
    echo "  4. Download and install them (double-click .cer files)"
    echo ""
else
    echo -e "${GREEN}✓${NC} Found Developer ID certificates:"
    echo "$CERTIFICATES" | sed 's/^/  /'
    echo ""
fi

echo "========================================"
echo -e "  ${GREEN}Setup Complete!${NC}"
echo "========================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Reload your shell configuration:"
echo "   source ${SHELL_CONFIG}"
echo ""
echo "2. Verify environment variables are set:"
echo "   echo \$APPLE_IDENTITY"
echo "   echo \$APPLE_TEAM_ID"
echo ""
echo "3. Build your app:"
echo "   npm run build:prod:mac"
echo ""
echo "4. The build will automatically:"
echo "   - Code sign the app"
echo "   - Code sign the DMG"
echo "   - Submit for notarization"
echo "   - Staple the notarization ticket"
echo ""
echo "For detailed instructions, see: MACOS-CODE-SIGNING.md"
echo ""
