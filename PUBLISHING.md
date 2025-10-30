# Publishing Rusty Refactor Extension

This document explains how to publish the Rusty Refactor extension to the VS Code Marketplace.

## Automated Publishing

The extension uses GitHub Actions for automated publishing. There are two ways to trigger a publish:

### Option 1: Automatic on Release Creation

When you create a GitHub Release, the extension will be automatically published:

1. Update the version in `package.json` (e.g., from "0.2.3" to "0.2.4")
2. Commit and push the changes:
   ```bash
   git add package.json
   git commit -m "Bump version to 0.2.4"
   git push
   ```
3. Create a new release on GitHub:
   - Go to the repository's Releases page
   - Click "Create a new release"
   - Choose or create a new tag (e.g., "v0.2.4")
   - Set the title (e.g., "Release v0.2.4")
   - Mark as a prerelease if this is not a stable release
   - Click "Publish release"

The GitHub Action will automatically build and publish the extension.

### Option 2: Manual Workflow Trigger

You can also manually trigger the publishing workflow:

1. Go to the repository's Actions page
2. Select the "Publish Extension" workflow
3. Click "Run workflow"
4. Enter the version number (e.g., "0.2.4")
5. Specify if this is a prerelease
6. Click "Run workflow"

## Required Setup

Before you can publish, you need to set up a personal access token:

1. Generate a Personal Access Token on [Azure DevOps](https://dev.azure.com/)
   - Go to your organization settings
   - Navigate to Personal Access Tokens
   - Create a new token with "Marketplace" scope
   - Copy the token

2. Add the token as a repository secret:
   - Go to your repository's Settings
   - Navigate to Secrets and variables > Actions
   - Click "New repository secret"
   - Name it `VSCE_PAT`
   - Paste the token value

## Local Publishing

You can also publish locally for testing:

```bash
# Install the VS Code Extension CLI
npm install -g @vscode/vsce

# Build the extension
npm run build

# Package the extension
npm run package

# Publish to the marketplace (requires PAT)
npm run publish
```

## Version Management

The extension follows semantic versioning:
- Major version (0.x.x): Breaking changes
- Minor version (x.2.x): New features
- Patch version (x.x.3): Bug fixes

Always update the version in `package.json` before publishing to avoid conflicts.