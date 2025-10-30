@echo off
:: Rusty Refactor VS Code Extension - Windows build script

setlocal enabledelayedexpansion

if "%1"=="" goto help
if "%1"=="help" goto help
if "%1"=="setup-dev" goto setup-dev
if "%1"=="clean" goto clean
if "%1"=="clean-rust" goto clean-rust
if "%1"=="build-rust" goto build-rust
if "%1"=="compile" goto compile
if "%1"=="build" goto build
if "%1"=="package" goto package
if "%1"=="publish" goto publish
if "%1"=="package-publish" goto package-publish
if "%1"=="install" goto install
if "%1"=="show-status" goto show-status
if "%1"=="verify-pat" goto verify-pat
if "%1"=="check" goto check
if "%1"=="test" goto test
if "%1"=="dev" goto dev
if "%1"=="release" goto release
if "%1"=="watch" goto watch
if "%1"=="info" goto info
if "%1"=="notes" goto notes
goto help

:help
echo Rusty Refactor VS Code Extension Build System
echo.
echo Available commands:
echo   help          - Show this help message
echo   setup-dev     - Initial development setup
echo   clean         - Clean all build artifacts
echo   clean-rust    - Clean Rust build artifacts only
echo   build-rust    - Build Rust backend only
echo   compile       - Compile TypeScript only
echo   build         - Build Rust + TypeScript (prepublish)
echo   package       - Package into VSIX file
echo   publish       - Build and publish to marketplace
echo   package-publish- Build and package for local distribution
echo   install       - Install extension locally
echo   show-status    - Show publisher authentication status
echo   verify-pat    - Verify PAT for marketplace publishing
echo.
goto end

:setup-dev
echo Setting up development environment...
call npm install
echo ✓ Dependencies installed
echo Note: Ensure Rust toolchain is installed for backend compilation
goto end

:clean
echo Cleaning all build artifacts...
if exist "target" rmdir /s /q "target"
if exist "out" rmdir /s /q "out"
del /q *.vsix 2>nul
echo ✓ All artifacts cleaned
goto end

:clean-rust
echo Cleaning Rust build artifacts...
if exist "target" rmdir /s /q "target"
echo ✓ Rust artifacts cleaned
goto end

:build-rust
echo Building Rust backend...
cargo build --release --manifest-path rust-backend/Cargo.toml
echo ✓ Rust backend built
goto end

:compile
echo Compiling TypeScript...
tsc -p ./
echo ✓ TypeScript compiled
goto end

:build
call :build-rust
call :compile
echo ✓ Complete build finished
goto end

:package
echo Packaging extension...
npx -y @vscode/vsce package
echo ✓ Extension packaged
echo VSIX file(s) created:
for %%f in (*.vsix) do echo   - %%f
goto end

:publish
call :build
echo Publishing to VS Code Marketplace...
npx -y @vscode/vsce publish
echo ✓ Extension published successfully!
goto end

:package-publish
call :package
echo Ready for distribution!
for %%f in (*.vsix) do echo   - %%f
goto end

:install
call :package
echo Installing extension locally...
for %%f in (*.vsix) do (
    code --install-extension "%%f"
    echo ✓ Installed %%f
)
goto end

:show-status
echo Publisher authentication status:
npx -y @vscode/vsce ls-publishers
goto end

:verify-pat
echo Verifying marketplace permissions...
npx -y @vscode/vsce verify-pat rusty-refactor
goto end

:check
echo Running type checks...
npm run lint
echo ✓ Type checks completed
goto end

:test
echo Running tests...
npm run test
echo ✓ Tests completed
goto end

:dev
call :clean
call :compile
echo ✓ Ready for development
goto end

:release
call :clean
call :publish
echo ✓ Release complete!
goto end

:watch
echo Starting development watch mode...
npm run watch
goto end

:info
echo Extension Information:
for /f "tokens=2 delims=:" %%a in ('node -e "console.log(require('./package.json').displayName)"') do echo Name: %%a
for /f "tokens=2 delims=:" %%a in ('node -e "console.log(require('./package.json').version)"') do echo Version: %%a
for /f "tokens=2 delims=:" %%a in ('node -e "console.log(require('./package.json').publisher)"') do echo Publisher: %%a
for /f "tokens=2 delims=:" %%a in ('node -e "console.log(require('./package.json').repository.url)"') do echo Repository: %%a
goto end

:notes
echo Release notes template:
for /f %%v in ('node -e "console.log(require('./package.json').version)"') do echo ## Release v%%v
echo.
echo ### Features
echo - [Feature description]
echo.
echo ### Bug Fixes
echo - [Bug fix description]
echo.
echo ### Improvements
echo - [Improvement description]
goto end

:end