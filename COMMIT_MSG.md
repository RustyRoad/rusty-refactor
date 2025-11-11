Fix LLM tool integration to use TypeScript utilities instead of Rust FFI

- Added Utils.extractWorkspaceRoot() function for proper path normalization
- Updated ExtractToModuleTool to use built-in utilities for path handling
- Added rustyRefactor_refactor_file tool documentation to package.json
- Updated all tools to use Utils.toSnakeCase() instead of custom implementation
- Improved tool documentation to emphasize use of existing TypeScript utilities
- Updated CHANGELOG and README.md to reflect TypeScript utilities integration
- Version bump to 0.5.00

This ensures that LLM tools properly utilize the existing TypeScript utilities
instead of trying to access Rust FFI functions directly, making the integration
more reliable and maintaining proper path normalization.