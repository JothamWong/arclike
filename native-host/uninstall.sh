#!/bin/bash

# Arclike Native Host Uninstaller

set -e

HOST_NAME="com.amitrahman1026.arclike"
INSTALL_DIR="$HOME/.arclike"
OLD_INSTALL_DIR="$HOME/.clut-native-host"
CHROME_NATIVE_HOSTS_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

echo "========================================"
echo "Arclike Native Host Uninstaller"
echo "========================================"
echo ""

# Remove the new binary directory
if [[ -d "$INSTALL_DIR" ]]; then
    echo "Removing binary directory: $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
else
    echo "Binary directory not found (already removed?)"
fi

# Remove old binary directory if exists
if [[ -d "$OLD_INSTALL_DIR" ]]; then
    echo "Removing old binary directory: $OLD_INSTALL_DIR"
    rm -rf "$OLD_INSTALL_DIR"
fi

# Remove the manifest
MANIFEST_PATH="$CHROME_NATIVE_HOSTS_DIR/$HOST_NAME.json"
if [[ -f "$MANIFEST_PATH" ]]; then
    echo "Removing manifest: $MANIFEST_PATH"
    rm "$MANIFEST_PATH"
else
    echo "Manifest not found (already removed?)"
fi

echo ""
echo "Uninstallation complete!"
echo ""
echo "Note: You may also want to remove Accessibility permissions:"
echo "  System Settings > Privacy & Security > Accessibility"
echo "  Remove: arclike (or Arclike.app)"
echo ""
