# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Learning Assistant Launcher (技能工作台) is an Electron desktop application that helps users install and manage AI learning tools locally. It orchestrates WSL, Podman virtualization, Obsidian plugins, LM Studio, and local AI services.

## Build Commands

```shell
npm install              # Install dependencies
npm run start            # Development mode (main code changes require manual restart)
npm run lint             # Lint with ESLint
npm run lint:fix         # Fix linting issues
npm run package          # Package without compression
npm run make             # Build zip with dependencies (~1.4GB)
npm run make-mini        # Build zip without dependencies (~100MB)
```

## Architecture

### Electron Process Model
- **Main process** (`src/main/`): Node.js backend handling system operations (WSL, Podman, commands)
- **Renderer process** (`src/renderer/`): React 19 frontend with Ant Design UI
- **Preload script** (`src/main/preload.ts`): Secure IPC bridge between main and renderer

### IPC Communication
The main process exposes handlers via `ipcMain.handle()` and the renderer calls them through `window.mainHandle.*`. Preload exposes typed methods via `src/renderer/preload.d.ts`.

### Key Modules (main process)
- `cmd/`: CLI command execution wrappers
- `configs/`: TOML config file parsing for external-resources
- `podman-desktop/`: Podman container management (real-api.ts is the core connector)
- `lm-studio/`: LM Studio process management
- `obsidian-plugin/`: Obsidian plugin template management
- `workspace/`: Obsidian vault workspace operations
- `local-service/`: RTS and obsidian-voice-service management
- `training-service/`, `native-training-service/`: Training pipeline management

### Renderer Architecture
- React Router for page navigation (routes defined in `src/renderer/app.tsx`)
- Pages in `src/renderer/pages/`: ai-service, lm-service, obsidian-plugin, workspace-manage, etc.
- Containers in `src/renderer/containers/`: reusable business logic components
- xterm.js for terminal emulation in container-logs

## Development Notes

- **Main process changes**: Restart the app manually to see effects
- **Renderer changes**: Hot-reload works automatically via webpack plugin
- **Windows admin mode**: Required for WSL installation (run `npm start` in admin cmd, or set compatibility on distributed exe)
- **Podman**: Only compatible with Windows 10/11 x86_64 (offline install package used)
- **ASAR integrity**: Packaged app has ASAR integrity validation enabled (`FuseV1Options.OnlyLoadAppFromAsar: true`)

## Configuration

- `forge.config.ts`: Electron Forge packaging config (makers, plugins, copy rules for external-resources)
- `webpack.*.config.ts`: Webpack configs for main/renderer/preload bundles
- `external-resources/`: Runtime assets managed by the launcher (ai-assistant-backend, local-ai-service, etc.)