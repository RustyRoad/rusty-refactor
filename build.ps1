# Rusty Refactor VS Code Extension - PowerShell build script
# Usage: .\build.ps1 [command]

param(
    [Parameter(Mandatory=$false)]
    [string]$Command = "help"
)

function Show-Help {
    Write-Host "Rusty Refactor VS Code Extension Build System" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Available commands:" -ForegroundColor White
    Write-Host "  help          - Show this help message"
    Write-Host "  setup-dev     - Initial development setup"
    Write-Host "  clean         - Clean all build artifacts"
    Write-Host "  clean-rust    - Clean Rust build artifacts only"
    Write-Host "  build-rust    - Build Rust backend only"
    Write-Host "  compile       - Compile TypeScript only"
    Write-Host "  build         - Build Rust + TypeScript (prepublish)"
    Write-Host "  package       - Package into VSIX file"
    Write-Host "  publish       - Build and publish to marketplace"
    Write-Host "  package-publish- Build and package for local distribution"
    Write-Host "  install       - Install extension locally"
    Write-Host "  show-status    - Show publisher authentication status"
    Write-Host "  verify-pat    - Verify PAT for marketplace publishing"
}

function Setup-Dev {
    Write-Host "Setting up development environment..." -ForegroundColor Cyan
    npm install
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
    Write-Host "Note: Ensure Rust toolchain is installed for backend compilation" -ForegroundColor Yellow
}

function Clean-All {
    Write-Host "Cleaning all build artifacts..." -ForegroundColor Cyan
    if (Test-Path "target") { Remove-Item -Recurse -Force "target" }
    if (Test-Path "out") { Remove-Item -Recurse -Force "out" }
    Remove-Item "*.vsix" -ErrorAction SilentlyContinue
    Write-Host "✓ All artifacts cleaned" -ForegroundColor Green
}

function Clean-Rust {
    Write-Host "Cleaning Rust build artifacts..." -ForegroundColor Cyan
    if (Test-Path "target") { Remove-Item -Recurse -Force "target" }
    Write-Host "✓ Rust artifacts cleaned" -ForegroundColor Green
}

function Build-Rust {
    Write-Host "Building Rust backend..." -ForegroundColor Cyan
    cargo build --release --manifest-path rust-backend/Cargo.toml
    Write-Host "✓ Rust backend built" -ForegroundColor Green
}

function Compile-TS {
    Write-Host "Compiling TypeScript..." -ForegroundColor Cyan
    tsc -p ./
    Write-Host "✓ TypeScript compiled" -ForegroundColor Green
}

function Package-Ext {
    Write-Host "Packaging extension..." -ForegroundColor Cyan
    npx -y @vscode/vsce package
    Write-Host "✓ Extension packaged" -ForegroundColor Green
    Write-Host "VSIX file(s) created:" -ForegroundColor Yellow
    Get-ChildItem "*.vsix" | ForEach-Object { Write-Host "  - $($_.Name)" }
}

function Publish-Ext {
    Build-Rust
    Compile-TS
    Write-Host "✓ Complete build finished" -ForegroundColor Green
    Write-Host "Publishing to VS Code Marketplace..." -ForegroundColor Cyan
    npx -y @vscode/vsce publish
    Write-Host "✓ Extension published successfully!" -ForegroundColor Green
}

function Package-Publish {
    Package-Ext
    Write-Host "Ready for distribution!" -ForegroundColor Yellow
    Get-ChildItem "*.vsix" | ForEach-Object { Write-Host "  - $($_.Name)" }
}

function Install-Local {
    Package-Ext
    Write-Host "Installing extension locally..." -ForegroundColor Cyan
    Get-ChildItem "*.vsix" | ForEach-Object { 
        code --install-extension $_.FullName
        Write-Host "✓ Installed $($_.Name)" -ForegroundColor Green
    }
}

function Show-Status {
    Write-Host "Publisher authentication status:" -ForegroundColor Cyan
    npx -y @vscode/vsce ls-publishers
}

function Verify-PAT {
    Write-Host "Verifying marketplace permissions..." -ForegroundColor Cyan
    npx -y @vscode/vsce verify-pat rusty-refactor
}

function Run-Checks {
    Write-Host "Running type checks..." -ForegroundColor Cyan
    npm run lint
    Write-Host "✓ Type checks completed" -ForegroundColor Green
}

function Run-Tests {
    Write-Host "Running tests..." -ForegroundColor Cyan
    npm run test
    Write-Host "✓ Tests completed" -ForegroundColor Green
}

function Show-Info {
    Write-Host "Extension Information:" -ForegroundColor Cyan
    $package = Get-Content 'package.json' | ConvertFrom-Json
    Write-Host "Name: $($package.displayName)"
    Write-Host "Version: $($package.version)"
    Write-Host "Publisher: $($package.publisher)"
    Write-Host "Repository: $($package.repository.url)"
}

function Show-Notes {
    Write-Host "Release notes template:" -ForegroundColor Cyan
    $package = Get-Content 'package.json' | ConvertFrom-Json
    Write-Host "## Release v$($package.version)"
    Write-Host ""
    Write-Host "### Features"
    Write-Host "- [Feature description]"
    Write-Host ""
    Write-Host "### Bug Fixes"
    Write-Host "- [Bug fix description]"
    Write-Host ""
    Write-Host "### Improvements"
    Write-Host "- [Improvement description]"
}

# Main command dispatcher
switch ($Command) {
    "help" { Show-Help }
    "setup-dev" { Setup-Dev }
    "clean" { Clean-All }
    "clean-rust" { Clean-Rust }
    "build-rust" { Build-Rust }
    "compile" { Compile-TS }
    "build" { 
        Build-Rust
        Compile-TS
        Write-Host "✓ Complete build finished" -ForegroundColor Green
    }
    "package" { Package-Ext }
    "publish" { Publish-Ext }
    "package-publish" { Package-Publish }
    "install" { Install-Local }
    "show-status" { Show-Status }
    "verify-pat" { Verify-PAT }
    "check" { Run-Checks }
    "test" { Run-Tests }
    "dev" { 
        Clean-All
        Compile-TS
        Write-Host "✓ Ready for development" -ForegroundColor Green
    }
    "release" { 
        Clean-All
        Publish-Ext
        Write-Host "✓ Release complete!" -ForegroundColor Green
    }
    "watch" { 
        Write-Host "Starting development watch mode..." -ForegroundColor Cyan
        npm run watch
    }
    "info" { Show-Info }
    "notes" { Show-Notes }
    default { 
        Write-Host "Unknown command: $Command" -ForegroundColor Red
        Show-Help
    }
}