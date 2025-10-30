# Rusty Refactor - Build System

This document provides automated build scripts and commands for developing, testing, and publishing the Rusty Refactor VS Code extension.

## Quick Start

### Windows Batch Script (Recommended)
```cmd
# Show help
build.bat help

# Development workflow
build.bat build          # Build everything
build.bat package        # Create VSIX file
build.bat publish        # Publish to marketplace
```

### PowerShell Script
```powershell
# Show help (after fixing syntax)
.\build.ps1 help
```

### Individual Commands

## Build Commands

### 1. Setup Development Environment
```cmd
build.bat setup-dev
# OR
npm install
```
- Installs all Node.js dependencies
- Requires Rust toolchain for backend compilation

### 2. Clean Build Artifacts
```cmd
build.bat clean         # Clean everything (Rust + TypeScript)
build.bat clean-rust    # Clean Rust artifacts only
# OR
rmdir /s /q target out 2>nul
del *.vsix 2>nul
```

### 3. Build Components
```cmd
build.bat build-rust    # Build Rust backend only
build.bat compile       # Compile TypeScript only
build.bat build         # Build both (full pipeline)
# OR
cargo build --release --manifest-path rust-backend/Cargo.toml
tsc -p ./
```

## Release Workflow

### 1. Package Extension
```cmd
build.bat package       # Create VSIX for local use
build.bat package-publish  # Show where packaged files are
# OR
npx -y @vscode/vsce package
```

### 2. Publish to Marketplace
```cmd
build.bat publish        # Build and publish
# OR
npx -y @vscode/vsce publish
```

### 3. Install Locally (Testing)
```cmd
build.bat install       # Install from current VSIX
# OR
code --install-extension rusty-refactor-0.2.2.vsix
```

## Development Workflow

### Setup
```cmd
# First time setup
build.bat setup-dev
# OR manually
npm install
rustup toolchain install stable
```

### Daily Development
```cmd
# Quick watch mode
build.bat watch         # Start development watch
# OR
npm run watch
```

### Local Testing
```cmd
# Build and install locally
build.bat clean        # Clean old stuff
build.bat build        # Build everything
build.bat install      # Install for testing
```

### Quality Checks
```cmd
build.bat check         # Run ESLint/type checking
build.bat test         # Run tests
# OR
npm run lint
npm test
```

## Publisher Management

### Authentication Status
```cmd
build.bat show-status    # Check if you're authenticated
build.bat verify-pat    # Verify marketplace permissions
# OR
npx -y @vscode/vsce ls-publishers
npx -y @vscode/vsce verify-pat rusty-refactor
```

### Login (if needed)
```cmd
# First time setup
npx -y @vscode/vsce login rusty-refactor
# Will prompt for PAT with Marketplace permissions
```

## Publishing

### Prerequisites
1. **Publisher Account**: Created at https://aka.ms/vscode-create-publisher
2. **PAT with Marketplace Access**: 
   - Create at: https://dev.azure.com/rusty-refactor/_usersSettings/tokens
   - Required scopes: Marketplace, User Impersonation

### Publishing Process
```cmd
build.bat release       # Clean build + publish
# OR manual:
build.bat build
npx -y @vscode/vsce publish
```

## File Structure After Build

```
rusty-refactor/
├── out/                    # Compiled TypeScript (22 files, ~217 KB)
├── target/                 # Rust artifacts (build cache)
├── *.vsix                 # Extension package (~157 KB)
├── target/release/          # Rust release builds
└── rust-backend/           # Rust source (included in package)
```

## Common Issues & Solutions

### GPG Signing Errors
```cmd
git config --local commit.gpgsign false
git commit -m "Your message"
```

### Pat Permission Errors
```
ERROR: Access Denied: needs the following permission(s): View user permissions
# Solution: Create new PAT with Marketplace scope at:
https://dev.azure.com/rusty-refactor/_usersSettings/tokens
```

### Rust Build Issues
```cmd
# Check Rust toolchain
rustc --version
cargo --version

# Reinstall if needed
rustup update stable
rustup default stable
```

## Environment Variables (Optional)

```cmd
# Set custom PAT (not recommended for security)
set VSCODE_MARKETPLACE_TOKEN=your_pat_here
```

## One-Command Publishing

For quick releases after development:

```cmd
# Complete release pipeline
build.bat release

# Equivalent:
build.bat clean && build.bat build && build.bat publish
```

## Package Information

- **Extension ID**: `rusty-refactor.rusty-refactor`
- **Package name**: `rusty-refactor-0.2.2.vsix`
- **Marketplace URL**: https://marketplace.visualstudio.com/items?itemName=rusty-refactor.rusty-refactor
- **Management Hub**: https://marketplace.visualstudio.com/manage/publishers/rusty-refactor/extensions/rusty-refactor/hub

## Troubleshooting

### Extension Not Found in Marketplace
- Wait 15-30 minutes for propagation
- Check publisher authentication: `build.bat show-status`
- Verify extension ID and version in package.json

### Build Failures
```cmd
# Clean everything and rebuild
build.bat clean
build.bat setup-dev
build.bat build
```

### Certificate Issues
```cmd
# Trust the marketplace certificate
# Settings > Extensions > Marketplace: "Allow all extensions"
```

## IDE Integration

### VS Code Tasks
The `tasks.json` includes:
- **Build**: `npm run compile`
- **Watch**: `npm run watch`
- **Build Rust**: `cargo build --release`
- **Publish Extension**: `npx -y @vscode/vsce publish`

Recommended keybinding: `Ctrl+Shift+B` for build, `F5` for debug.

---

**For more help**: Check the extension's documentation files or open an issue on the repository.