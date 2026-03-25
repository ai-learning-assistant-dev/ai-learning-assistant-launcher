# AI Learning Assistant Launcher (AI学习助手启动器)

## Project Overview

This is an **Electron-based desktop application** that serves as a launcher for the AI Learning Assistant. It automates the installation and configuration of complex AI model deployments, enabling users to run AI learning assistants in a completely offline environment without technical barriers.

The application manages:
- WSL (Windows Subsystem for Linux) installation
- Podman virtual machine setup
- Container management for AI services
- Obsidian plugin integration
- LM Studio integration for local LLM management
- P2P content distribution via WebTorrent

## Technology Stack

### Core Framework
- **Electron 36.5.0** - Cross-platform desktop application framework
- **React 19.1.0** - Frontend UI library
- **TypeScript 4.5.4** - Primary programming language
- **Webpack 5** - Module bundling (via Electron Forge)

### Build Tools
- **Electron Forge 7.8.1** - Application building and packaging
- **Webpack + TypeScript Loader** - Code compilation and bundling
- **ESLint + Prettier** - Code linting and formatting
- **Sass/SCSS** - CSS preprocessing

### Key Dependencies
- **Ant Design 5.26.1** - UI component library
- **React Router DOM 7.6.2** - Client-side routing
- **LangChain** - LLM integration (@langchain/openai, @langchain/ollama, etc.)
- **Dockerode** - Docker/Podman container management
- **WebTorrent** - P2P content distribution
- **electron-log** - Application logging
- **isomorphic-git** - Git operations

## Project Structure

```
ai-learning-assistant-launcher/
├── src/
│   ├── main/                    # Main process (Node.js/Electron backend)
│   │   ├── index.ts            # Application entry point
│   │   ├── preload.ts          # Preload script for IPC exposure
│   │   ├── ipc-data-type.ts    # IPC message type definitions
│   │   ├── ipc-util.ts         # IPC utility functions
│   │   ├── menu.ts             # Application menu configuration
│   │   ├── util.ts             # Utility functions
│   │   ├── backup/             # Log backup service
│   │   ├── cmd/                # Command-line operations (WSL checks, etc.)
│   │   ├── configs/            # Configuration file management
│   │   ├── dlc/                # Downloadable Content management (WebTorrent)
│   │   ├── exec/               # Command execution utilities
│   │   ├── external-url/       # External URL handling
│   │   ├── git/                # Git operations
│   │   ├── joint-build/        # Joint build (共建计划) features
│   │   ├── launcher-update/    # Launcher self-update
│   │   ├── lm-studio/          # LM Studio integration
│   │   ├── local-service/      # Local AI services
│   │   │   ├── obsidian-voice-service/  # Voice service for Obsidian
│   │   │   └── rts-service/    # Real-time service
│   │   ├── logger/             # Logging infrastructure
│   │   ├── native-script/      # Native script execution
│   │   ├── native-training-service/  # Training service management
│   │   ├── obsidian-plugin/    # Obsidian plugin management
│   │   ├── pdf-convert/        # PDF conversion utilities
│   │   ├── podman-desktop/     # Podman/Docker container management
│   │   ├── terminal-log/       # Terminal logging
│   │   ├── training-service/   # Container-based training service
│   │   └── workspace/          # Workspace management
│   │
│   └── renderer/               # Renderer process (React frontend)
│       ├── index.tsx           # React entry point
│       ├── app.tsx             # Main App component with routing
│       ├── app.css             # Global styles
│       ├── containers/         # React container components (business logic)
│       │   ├── backup/         # Backup UI container
│       │   ├── container-logs/ # Container log viewer
│       │   ├── example-container/
│       │   ├── obsidian-plugin/
│       │   ├── terminal-log-screen/
│       │   ├── torrent-progress/   # P2P download progress
│       │   ├── use-cmd/        # Command execution hooks
│       │   ├── use-configs/    # Configuration hooks
│       │   ├── use-docker/     # Docker/Podman hooks
│       │   ├── use-lm-studio/  # LM Studio hooks
│       │   ├── use-native-training-service-shortcut/
│       │   ├── use-obsidian-voice-service/
│       │   ├── use-rts-service/
│       │   ├── use-training-service-shortcut/
│       │   ├── use-vm/         # VM management hooks
│       │   └── use-workspace/  # Workspace hooks
│       │
│       ├── pages/              # Page components (routes)
│       │   ├── hello/          # Home/welcome page
│       │   ├── ai-service/     # AI service toolbox
│       │   ├── native-ai-service/  # Native AI services
│       │   ├── lm-service/     # LM Studio management
│       │   ├── llm-api-config/ # LLM API configuration
│       │   ├── obsidian-app/   # Obsidian app settings
│       │   ├── obsidian-plugin/# Obsidian plugin settings
│       │   ├── asr-config/     # ASR configuration
│       │   ├── tts-config/     # TTS configuration
│       │   ├── voice-rtc-config/   # Voice RTC configuration
│       │   ├── pdf-config/     # PDF configuration
│       │   ├── pdf-convert/    # PDF conversion page
│       │   ├── joint-build/    # Joint build page
│       │   ├── p2p-test/       # P2P testing page
│       │   ├── workspace-manage/   # Workspace management
│       │   ├── example-page/   # Example/template page
│       │   └── welcome/        # Welcome modal
│       │
│       ├── logger/             # Renderer-side logging
│       ├── web-utils.ts        # Web utilities
│       └── preload.d.ts        # TypeScript declarations for preload
│
├── external-resources/         # External resources (not bundled)
│   ├── ai-assistant-backend/   # VM installers, container images, configs
│   ├── config/                 # Launcher configuration files
│   ├── dlc/                    # Downloadable content (via WebTorrent)
│   ├── local-ai-service/       # Local AI service binaries
│   ├── native-runtime/         # Native runtime (bun, uv)
│   ├── native-training/        # Training service files
│   ├── obsidian-plugins-template/  # Obsidian plugin templates
│   └── user-workspace/         # User workspace data
│
├── icons/                      # Application icons
├── locales/                    # i18n locale files
├── resources/                  # Static resources
├── forge.config.ts             # Electron Forge configuration
├── webpack.main.config.ts      # Main process webpack config
├── webpack.renderer.config.ts  # Renderer process webpack config
├── webpack.rules.ts            # Webpack loader rules
├── webpack.plugins.ts          # Webpack plugins
└── tsconfig.json               # TypeScript configuration
```

## Build and Development Commands

### Installation
```bash
npm install
```

### Development
```bash
# Start the application in development mode
# Note: Must restart after modifying main process code
# Renderer code changes apply immediately (HMR)
npm run start
```

### Building
```bash
# Package without compression (for testing)
npm run package

# Build distributable with all dependencies (~1.4GB)
npm run make

# Build mini version without dependencies (~100MB)
npm run make-mini

# Publish release
npm run publish
```

### Code Quality
```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix
```

## Architecture Overview

### Electron Process Model

This application follows Electron's multi-process architecture:

1. **Main Process** (`src/main/`)
   - Runs in Node.js environment
   - Has full access to OS APIs
   - Manages application lifecycle, windows, system integration
   - Executes commands, manages containers, handles file system operations

2. **Renderer Process** (`src/renderer/`)
   - Runs in Chromium browser environment
   - React-based UI with restricted access to Node.js APIs
   - Communicates with main process via IPC (Inter-Process Communication)

3. **Preload Script** (`src/main/preload.ts`)
   - Bridges main and renderer processes
   - Exposes safe APIs via `contextBridge`
   - Defines type-safe IPC channels

### IPC Communication Pattern

The application uses a structured IPC system defined in `src/main/ipc-data-type.ts`:

**Message Types:**
- `ERROR` - Blocking error (stops UI loading states)
- `INFO` - Result info (stops UI loading states)
- `WARNING` - Non-blocking warning
- `DATA` - Data transmission
- `PROGRESS` - Progress updates
- `PROGRESS_ERROR` - Non-blocking error

**Channels:**
- `docker` - Container operations
- `cmd` - Command execution
- `wsl` - WSL management
- `configs` - Configuration management
- `obsidian-plugin` - Plugin operations
- `lm-studio` - LM Studio integration
- `training-service` - Training service management
- `webtorrent` - P2P downloads
- `launcher-update` - Self-updates
- And more...

### Module Conventions

Each feature module in `src/main/` follows this structure:
```
module-name/
├── index.ts        # Main implementation with init function
└── type-info.ts    # Type definitions, action/service names
```

Example from `src/main/cmd/`:
```typescript
// type-info.ts
export type ActionName = 'isWSLInstalled';
export type ServiceName = 'wsl';

// index.ts
export default function initCmd(ipcMain: IpcMain) {
  ipcMain.on('cmd', async (event, action, serviceName, ...args) => {
    // Handle actions...
  });
}
```

## Code Style Guidelines

### TypeScript Conventions
- Target: ES6
- Module: CommonJS
- Strict type checking disabled (`noImplicitAny: false`)
- JSX: `react-jsx` transform

### ESLint Configuration
- Extends: ESLint recommended, TypeScript, Import, React, Prettier
- Single quotes for strings
- Prettier integration for formatting

### Naming Conventions
- **Files**: kebab-case for multi-word files (e.g., `ipc-data-type.ts`)
- **Components**: PascalCase (e.g., `Hello.tsx`, `AiService.tsx`)
- **Functions/Variables**: camelCase
- **Types/Interfaces**: PascalCase with descriptive names
- **IPC Channels**: kebab-case or camelCase strings

### CSS/SCSS
- Module CSS supported (`.module.scss`)
- Global styles in `app.css`
- Component-scoped styles in page/component folders

## Key Features and Modules

### 1. AI Service Management
- **Container-based**: Uses Podman/Docker to run AI services
- **Native services**: Direct execution of local AI binaries
- **Service types**: Training, TTS, ASR, Voice RTC, PDF processing

### 2. Obsidian Integration
- Plugin template management
- Workspace management
- Vault synchronization
- Voice service integration

### 3. P2P Content Distribution
- WebTorrent integration for DLC downloads
- Torrent file management in `external-resources/dlc/`
- Upload/download statistics tracking

### 4. LM Studio Integration
- Local LLM server management
- Model discovery and configuration

### 5. Joint Build (共建计划)
- Collaborative build system
- Folder selection and disk info
- Tray integration

## Important Development Notes

### Admin Privileges Required
**Windows**: First-time installation of AI tools requires administrator mode.
- Development: Run `npm run start` from an admin CMD
- Production: Users must run the app with admin privileges

### Hot Reload Behavior
- **Main process changes**: Must restart the application
- **Renderer process changes**: Hot-reload applies immediately

### Platform Compatibility
- Currently supports **Windows 10/11 x64** only
- Uses offline Podman installer (not compatible with other platforms)
- WSL2 is a prerequisite on Windows

### External Resources
Content in `external-resources/` is:
- Copied during packaging (see `forge.config.ts` hooks)
- Not bundled by webpack
- Excluded from git (see `.gitignore`)
- DLC large files excluded from main package

### Security
- Context isolation enabled
- Preload script exposes limited APIs via `contextBridge`
- Fuses plugin configures Electron security settings
- CSP (Content Security Policy) configured for WebTorrent

## Environment Variables

- `NODE_ENV` - `development` or `production`
- `MAKE_MINI` - Set to `true` for mini build (excludes large dependencies)
- `npm_package_version` - Injected at build time

## Build-time Constants

- `__COMMIT_HASH__` - Current Git commit hash
- `__NPM_PACKAGE_VERSION__` - Version from package.json

## Troubleshooting

### Common Issues
1. **WSL installation fails** - Ensure Windows is in admin mode
2. **Podman not found** - Check if external-resources were copied correctly
3. **Renderer not updating** - Main process changes require restart
4. **IPC errors** - Check type definitions in `type-info.ts` files

### Logs
- Main process: `launcher.log`, `launcher.old.log`
- Chrome: `chrome.log`
- Updates: `launcher-update.log`
