# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension that provides ping functionality for Google Meet meetings. Users can send visual pins (question, assist, danger, etc.) to other meeting participants in real-time using Firebase for data synchronization.

## Architecture

- **Chrome Extension**: Manifest V3 with content script, background service worker, and popup
- **Content Script** (`src/content.js`): Injects UI into Google Meet pages, handles user interactions and pin display
- **Background Script** (`src/background.js`): Manages Firebase authentication and real-time database listeners
- **Firebase Integration**: Uses Firebase Auth for Google OAuth and Realtime Database for pin data
- **Build System**: Webpack with complex configuration to handle Firebase SDK compatibility in Chrome extension context

## Common Commands

```bash
# Install dependencies
npm install

# Build the extension for distribution
npm run build

# Build and watch for changes during development
npm run watch

# Clean build artifacts
npm run clean
```

## Key Development Notes

### Firebase Integration
- Firebase config is loaded from environment variables via dotenv-webpack
- Complex webpack configuration handles Firebase SDK compatibility issues in Chrome extension context
- Special handling for reCAPTCHA and GAPI dependencies that don't work in extensions
- Uses string-replace-loader and NormalModuleReplacementPlugin to disable problematic modules

### Build Process
- Webpack builds to `dist/` directory which is used as the extension directory
- Static assets (manifest.json, HTML, CSS, icons, sounds) are copied via CopyPlugin
- OAuth client ID is injected into manifest.json from environment variables during build

### Environment Setup Required
- `.env` file with Firebase configuration variables
- `OAUTH_CLIENT_ID` for Google authentication
- `COMPANY_DOMAIN` for domain restrictions
- Firebase project with proper security rules for meetings data

### Chrome Extension Structure
- **Content Script**: Runs on meet.google.com pages, handles UI injection and participant detection
- **Background Script**: Service worker managing Firebase auth and database listeners
- **Popup**: Authentication interface accessed via extension icon

### Pin System
- 8 different pin types with icons and labels
- Support for both broadcast (everyone) and direct (individual) pins
- Automatic cleanup after 5 minutes
- Real-time display with Firebase listeners

## Testing
No automated test framework is configured. Test manually by:
1. Building the extension
2. Loading in Chrome via developer mode
3. Testing in actual Google Meet sessions