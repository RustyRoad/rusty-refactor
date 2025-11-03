# Complete rebuild and diagnostic script for Rusty Refactor
Write-Host "=== Rusty Refactor Build & Diagnostic ===" -ForegroundColor Cyan

# Step 1: Clean old builds
Write-Host "`n[1/6] Cleaning old builds..." -ForegroundColor Yellow
if (Test-Path "out") { Remove-Item -Recurse -Force "out" }
if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }
if (Test-Path "*.vsix") { Remove-Item -Force "*.vsix" }
Write-Host "✓ Cleaned" -ForegroundColor Green

# Step 2: Check TypeScript compilation
Write-Host "`n[2/6] Checking TypeScript for errors..." -ForegroundColor Yellow
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ TypeScript compilation has errors!" -ForegroundColor Red
    Write-Host "Fix the errors above before continuing." -ForegroundColor Red
    exit 1
}
Write-Host "✓ TypeScript OK" -ForegroundColor Green

# Step 3: Build Rust backend
Write-Host "`n[3/6] Building Rust backend..." -ForegroundColor Yellow
cargo build --release --manifest-path rust-backend/Cargo.toml
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Rust build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Rust backend built" -ForegroundColor Green

# Step 4: Build TypeScript extension
Write-Host "`n[4/6] Building TypeScript extension..." -ForegroundColor Yellow
npx tsc -p ./
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ TypeScript build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Extension built" -ForegroundColor Green

# Step 5: Build webview
Write-Host "`n[5/6] Building webview..." -ForegroundColor Yellow
npm run build:webview
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Webview build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Webview built" -ForegroundColor Green

# Step 6: Package extension
Write-Host "`n[6/6] Packaging extension..." -ForegroundColor Yellow
npx vsce package
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Packaging failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Extension packaged" -ForegroundColor Green

# Show results
Write-Host "`n=== Build Complete ===" -ForegroundColor Cyan
Write-Host "Extension files:" -ForegroundColor Yellow
Get-ChildItem "*.vsix" | ForEach-Object {
    Write-Host "  📦 $($_.Name) ($([math]::Round($_.Length/1MB, 2)) MB)" -ForegroundColor Green
}

Write-Host "`n✓ Ready to install!" -ForegroundColor Green
Write-Host "To install: Extensions -> Install from VSIX... -> Select the .vsix file" -ForegroundColor Cyan
