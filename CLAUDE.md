# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI Learning Assistant Launcher - an Electron application that helps users install and configure AI learning tools locally. The launcher automates the complex setup process for deploying AI models and services in offline environments.

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (requires UTF-8 encoding on Windows)
npm run start

# Package application (uncompressed)
npm run package

# Create distributable package (compressed)
npm run make

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix
```

## Important Development Notes

- **Windows Development**: The application requires UTF-8 encoding (handled by `chcp 65001` in the start command)
- **Main Process Changes**: After modifying code in `src/main/`, you must manually restart the application to see changes
- **Renderer Process Changes**: Changes in `src/renderer/` will hot-reload without restart
- **Administrator Privileges**: On Windows, the app may need to run as administrator for WSL/Podman installation

## Architecture

### Main Process (`src/main/`)
The main process handles system-level operations and background services:

- **podman-desktop/**: Container management interface for Podman virtual machines
- **cmd/**: Command-line execution utilities
- **configs/**: Configuration file management for external resources
- **exec/**: Core command execution abstraction layer
- **workspace/**: User workspace management
- **obsidian-plugin/**: Obsidian plugin integration
- **lm-studio/**: LM Studio service integration
- **ipc-util.ts**: Inter-process communication utilities

### Renderer Process (`src/renderer/`)
The renderer process provides the user interface:

- **pages/**: Individual page components (main application views)
- **containers/**: Reusable container components with business logic
- **app.tsx**: Main application router with AntdApp wrapper
- **index.tsx**: Application entry point

### External Resources (`external-resources/`)
This directory contains managed external resources:

- **ai-assistant-backend/**: VM installation packages, container images, and configurations
- **config/**: Launcher configuration files
- **obsidian-plugins-template/**: Obsidian plugin source code templates
- **user-workspace/**: User data and workspace files

### Key Application Features

1. **AI Service Management**: Automated installation and configuration of local AI services
2. **Container Management**: Podman-based container lifecycle management
3. **Workspace Management**: User workspace configuration and management
4. **Obsidian Integration**: Plugin management and integration with Obsidian
5. **LM Studio Integration**: Connection and configuration with LM Studio

### Build Configuration

- **Electron Forge**: Used for packaging and distribution
- **Webpack**: Handles bundling for both main and renderer processes
- **TypeScript**: Primary development language
- **React + Antd**: UI framework and component library
- **React Router**: Client-side routing

### External Dependencies

- **Podman**: Container runtime for local AI services
- **WSL**: Windows Subsystem for Linux compatibility
- **Dockerode**: Docker API compatibility layer
- **Electron**: Desktop application framework

### File Structure Conventions

- Type definitions are typically in `type-info.ts` files alongside their implementation
- IPC handlers are registered in `src/main/index.ts` through module initialization functions
- Page components include both `.tsx` and `.scss` files for styling
- Configuration files use JSON format in `external-resources/config/`

### Important Paths

- App data path: Uses `appPath` from `src/main/exec/util.ts`
- Chrome logs: `chrome.log` in app directory
- Launcher logs: `launcher.log` in project root
- External resources: Copied to build output during packaging via `forge.config.ts`