# Rust Compiler Bridge Setup Guide

## Quick Start

The Rust Compiler Bridge is **automatic** - it builds and runs transparently. No configuration needed!

## What Gets Built

When you run `npm run vscode:prepublish` (or package the extension), this happens:

```bash
# 1. Build Rust worker binary
cargo build --release --manifest-path rust-backend/Cargo.toml

# 2. Compile TypeScript
tsc -p ./

# 3. Package extension
vsce package
```

The resulting `.vsix` package includes the Rust worker binary.

## Development Setup

If you want to work on the Rust or TypeScript code:

### 1. Install Dependencies

```bash
# Install Node dependencies
npm install

# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Build Both Components

```bash
# Build Rust worker (one-time)
cargo build --release --manifest-path rust-backend/Cargo.toml

# Build TypeScript (watch mode for development)
npm run watch
```

### 3. Run Extension

In VS Code:
- Press `F5` to launch extension in debug mode
- The extension will use your local binaries

### 4. Test the Bridge

1. Open a Rust project in VS Code
2. Select some code with external crate types
3. Right-click → "Extract to Module"
4. Check the generated module for **all** suggested imports

Check the Developer Console (`Ctrl+Shift+K`) for debug output:
```
Generating AI documentation with model: ...
AI documentation requested for module: ...
Error executing Rust worker: ... (if any)
```

## Troubleshooting

### "Failed to build Rust analysis worker"

**Error:** You see a warning during extraction

**Cause:** Rust toolchain not installed or `cargo build` failed

**Solution:**
```bash
# Check if Rust is installed
rustc --version
cargo --version

# If not, install from https://rustup.rs/

# Try building manually
cargo build --release --manifest-path rust-backend/Cargo.toml
```

### "Binary not found"

**Error:** Rust worker binary not executing

**Solutions:**
```bash
# Rebuild the binary
npm run build:rust

# Or manually
cd rust-backend
cargo build --release
cd ..
```

### Worker Timeout

**Error:** "Error running Rust analysis worker" after 120 seconds

**Cause:** Large workspace with many dependencies

**Solutions:**
1. Run `cargo check` manually first to warm up cache
2. Increase timeout in `src/rustCompilerBridge.ts`:
   ```typescript
   { timeout: 1000 * 60 * 5 }  // 5 minutes instead of 2
   ```

### No Suggested Imports

**Symptom:** Bridge runs but doesn't return any import suggestions

**Debug steps:**
1. Open Developer Console (`Ctrl+Shift+K`)
2. Look for Rust worker output
3. Verify the Rust file has compiler errors (that triggers import suggestions)
4. Try running `cargo check` manually to see what compiler reports

## File Structure

```
rusty-refactor/
├── src/
│   ├── rustCompilerBridge.ts    ← TypeScript-Rust bridge
│   ├── extractor.ts             ← Uses bridge in generateImports()
│   └── ... (other TypeScript files)
│
├── rust-backend/
│   ├── Cargo.toml               ← Rust project manifest
│   ├── src/
│   │   └── main.rs              ← Rust worker binary source
│   └── target/
│       └── release/
│           └── rusty_refactor_worker*  ← Built binary
│
├── package.json                 ← Defines npm scripts
└── RUST_COMPILER_BRIDGE.md      ← Architecture doc
```

## How It Works During Refactoring

### Step 1: User Extracts Code
User selects code and clicks "Extract to Module"

### Step 2: TypeScript Analyzes
`extractor.ts` → `generateImports()` collects heuristic imports

### Step 3: Bridge is Called
```typescript
const suggested = await suggestImportsForFile(filePath);
```

### Step 4: Rust Worker Executes
```bash
./rust-backend/target/release/rusty_refactor_worker \
  --workspace-root /path/to/workspace \
  --file /path/to/target.rs
```

### Step 5: Worker Runs `cargo check`
Parses JSON diagnostics for import suggestions

### Step 6: Results Merged
TypeScript deduplicates and formats imports

### Step 7: Module Generated
Final extracted module includes all imports

## Modifying the Rust Worker

If you need to enhance the worker:

1. Edit `rust-backend/src/main.rs`
2. Rebuild: `cargo build --release --manifest-path rust-backend/Cargo.toml`
3. Test locally with `F5` debug mode
4. Commit both `.rs` file and updated binary

## CI/CD Integration

If building in CI/CD pipeline:

```yaml
# GitHub Actions example
- name: Build Rust worker
  run: cargo build --release --manifest-path rust-backend/Cargo.toml

- name: Build extension
  run: npm run vscode:prepublish

- name: Package extension
  run: npx vsce package
```

## Performance Notes

- **Cold start** (first cargo check): 2-5 seconds
- **Warm cache**: 1-2 seconds
- **Suggested timeout**: 120 seconds
- **Runs once per refactor** (not on every keystroke)

## Next Steps

- See `RUST_COMPILER_BRIDGE.md` for detailed architecture
- Check `REFACTORING_FIXES.md` for previous improvements
- Read `AI_DOCUMENTATION_TROUBLESHOOTING.md` for AI docs setup
