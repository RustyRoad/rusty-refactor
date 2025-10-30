# Rusty Refactor VS Code Extension - Makefile
# Build automation for development and publishing

.PHONY: help clean build-rust compile build package publish package-publish clean-rust install show-status setup-dev

# Default target
help:
	@echo "Rusty Refactor VS Code Extension Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  help          - Show this help message"
	@echo "  setup-dev     - Initial development setup"
	@echo "  clean         - Clean all build artifacts"
	@echo "  clean-rust    - Clean Rust build artifacts only"
	@echo "  build-rust    - Build Rust backend only"
	@echo "  compile       - Compile TypeScript only"
	@echo "  build         - Build Rust + TypeScript (prepublish)"
	@echo "  package       - Package into VSIX file"
	@echo "  publish       - Build and publish to marketplace"
	@echo "  package-publish- Build and package for local distribution"
	@echo "  install       - Install extension locally"
	@echo "  show-status    - Show publisher authentication status"
	@echo "  verify-pat    - Verify PAT for marketplace publishing"

# Colors for pretty output
RED=\033[0;31m
GREEN=\033[0;32m
YELLOW=\033[0;33m
BLUE=\033[0;34m
NC=\033[0m # No Color

# Initial setup
setup-dev:
	@echo "$(BLUE)Setting up development environment...$(NC)"
	npm install
	@echo "$(GREEN)✓ Dependencies installed$(NC)"
	@echo "$(YELLOW)Note: Ensure Rust toolchain is installed for backend compilation$(NC)"

# Clean targets
clean:
	@echo "$(BLUE)Cleaning all build artifacts...$(NC)"
	rm -rf target
	rm -rf out
	rm -f *.vsix
	@echo "$(GREEN)✓ All artifacts cleaned$(NC)"

clean-rust:
	@echo "$(BLUE)Cleaning Rust build artifacts...$(NC)"
	rm -rf target
	@echo "$(GREEN)✓ Rust artifacts cleaned$(NC)"

# Build targets
build-rust:
	@echo "$(BLUE)Building Rust backend...$(NC)"
	cargo build --release --manifest-path rust-backend/Cargo.toml
	@echo "$(GREEN)✓ Rust backend built$(NC)"

compile:
	@echo "$(BLUE)Compiling TypeScript...$(NC)"
	tsc -p ./
	@echo "$(GREEN)✓ TypeScript compiled$(NC)"

build: build-rust compile
	@echo "$(GREEN)✓ Complete build finished$(NC)"

# Package and publish
package:
	@echo "$(BLUE)Packaging extension...$(NC)"
	npx -y @vscode/vsce package
	@echo "$(GREEN)✓ Extension packaged$(NC)"
	@echo "$(YELLOW)VSIX file(s) created:$(NC)"
	@for f in *.vsix; do echo "  - $$f"; done

publish: build
	@echo "$(BLUE)Publishing to VS Code Marketplace...$(NC)"
	npx -y @vscode/vsce publish
	@echo "$(GREEN)✓ Extension published successfully!$(NC)"

package-publish: package
	@echo "$(YELLOW)Ready for distribution!$(NC)"
	@for %%f in (*.vsix) do @echo "  - %%f"

# Installation
install: package
	@echo "$(BLUE)Installing extension locally...$(NC)"
	@for f in *.vsix; do code --install-extension "$$f" && echo "$(GREEN)✓ Installed $$f$(NC)"; done

# Status and verification
show-status:
	@echo "$(BLUE)Publisher authentication status:$(NC)"
	@npx -y @vscode/vsce ls-publishers

verify-pat:
	@echo "$(BLUE)Verifying marketplace permissions...$(NC)"
	@npx -y @vscode/vsce verify-pat rusty-refactor

# Additional utilities
check: compile
	@echo "$(BLUE)Running type checks...$(NC)"
	npm run lint
	@echo "$(GREEN)✓ Type checks completed$(NC)"

test: compile
	@echo "$(BLUE)Running tests...$(NC)"
	npm run test
	@echo "$(GREEN)✓ Tests completed$(NC)"

# Development workflow targets
dev: clean compile
	@echo "$(GREEN)✓ Ready for development$(NC)"

release: clean publish
	@echo "$(GREEN)✓ Release complete!$(NC)"

# Quick rebuild during development
watch:
	@echo "$(BLUE)Starting development watch mode...$(NC)"
	npm run watch

# Show extension info
info:
	@echo "$(BLUE)Extension Information:$(NC)"
	@echo "Name: $(shell node -p "require('./package.json').displayName")"
	@echo "Version: $(shell node -p "require('./package.json').version")"
	@echo "Publisher: $(shell node -p "require('./package.json').publisher")"
	@echo "Repository: $(shell node -p "require('./package.json').repository.url")"

# Create release notes
notes:
	@echo "$(BLUE)Release notes template:$(NC)"
	@echo "## Release v$(shell node -p "require('./package.json').version")"
	@echo ""
	@echo "### Features"
	@echo "- [Feature description]"
	@echo ""
	@echo "### Bug Fixes"
	@echo "- [Bug fix description]"
	@echo ""
	@echo "### Improvements"
	@echo "- [Improvement description]"