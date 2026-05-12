#!/usr/bin/env node
/**
 * Post-build script: copies the napi_bridge cdylib to the correct
 * platform-specific .node filename so nativeBridge.ts can load it.
 *
 * Supports two modes:
 *   node scripts/copy-napi.js            — copies native build for current platform
 *   node scripts/copy-napi.js --cross    — copies cross-compiled Linux build (from Windows/macOS)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const baseDir = path.join(__dirname, '..', 'rust-backend', 'napi_bridge', 'target');
const destDir = path.join(__dirname, '..', 'rust-backend');
const cross = process.argv.includes('--cross');

const targets = [];

if (cross) {
  // Cross-compile mode: copy all cross-compiled targets found
  const crossTargets = [
    { triple: 'x86_64-unknown-linux-gnu',   src: 'libnapi_bridge.so',    dest: 'napi_bridge.linux-x64-gnu.node' },
    { triple: 'aarch64-unknown-linux-gnu',   src: 'libnapi_bridge.so',    dest: 'napi_bridge.linux-arm64-gnu.node' },
    { triple: 'x86_64-apple-darwin',         src: 'libnapi_bridge.dylib', dest: 'napi_bridge.darwin-x64.node' },
    { triple: 'aarch64-apple-darwin',        src: 'libnapi_bridge.dylib', dest: 'napi_bridge.darwin-arm64.node' },
  ];
  for (const t of crossTargets) {
    const src = path.join(baseDir, t.triple, 'release', t.src);
    if (fs.existsSync(src)) {
      targets.push({ src, dest: path.join(destDir, t.dest), label: t.triple });
    }
  }
  if (targets.length === 0) {
    console.error('[copy-napi] No cross-compiled targets found.');
    console.error('[copy-napi] Build with: cargo zigbuild --release --manifest-path rust-backend/napi_bridge/Cargo.toml --target x86_64-unknown-linux-gnu');
    process.exit(1);
  }
} else {
  // Native mode: copy build for current platform
  const platform = os.platform();
  const arch = os.arch();
  let srcName, destName;

  if (platform === 'win32') {
    srcName = 'napi_bridge.dll';
    destName = `napi_bridge.win32-${arch}-msvc.node`;
  } else if (platform === 'darwin') {
    srcName = 'libnapi_bridge.dylib';
    destName = `napi_bridge.darwin-${arch}.node`;
  } else {
    srcName = 'libnapi_bridge.so';
    destName = `napi_bridge.linux-${arch}-gnu.node`;
  }

  const src = path.join(baseDir, 'release', srcName);
  if (!fs.existsSync(src)) {
    console.error(`[copy-napi] Source not found: ${src}`);
    process.exit(1);
  }
  targets.push({ src, dest: path.join(destDir, destName), label: `${platform}-${arch}` });
}

for (const t of targets) {
  fs.copyFileSync(t.src, t.dest);
  console.log(`[copy-napi] ${t.label} → ${path.basename(t.dest)}`);
}
