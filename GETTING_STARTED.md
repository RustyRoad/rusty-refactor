# Getting Started with Rusty Refactor

This guide will help you get started with developing and using the Rusty Refactor VSCode extension.

## Installation

### For Users

1. Install the extension from the VSCode Marketplace (coming soon)
2. Or install from VSIX:
   ```bash
   code --install-extension rusty-refactor-0.1.0.vsix
   ```

### For Development

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd rusty-refactor
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Compile the TypeScript code**
   ```bash
   npm run compile
   ```

4. **Run in development mode**
   - Press `F5` in VSCode to open a new Extension Development Host window
   - Or run: `npm run watch` to automatically recompile on changes

## Project Structure

```
rusty-refactor/
├── src/
│   ├── extension.ts              # Main extension entry point
│   ├── analyzer.ts                # Rust code analysis logic
│   ├── extractor.ts               # Module extraction logic
│   └── rustAnalyzerIntegration.ts # Integration with rust-analyzer
├── examples/
│   └── sample.rs                  # Example Rust code for testing
├── package.json                   # Extension manifest and dependencies
├── tsconfig.json                  # TypeScript configuration
└── README.md                      # User-facing documentation
```

## How It Works

### 1. Code Analysis (`analyzer.ts`)

The analyzer examines selected Rust code to identify:
- **Functions**: Name, signature, visibility, generics
- **Structs**: Name, fields, visibility, generics
- **Enums**: Name, variants, visibility
- **Traits**: Name, visibility, methods
- **Implementations**: Target types, trait implementations
- **Dependencies**: Used types from outside the selection
- **Imports**: Existing use statements

### 2. Rust Analyzer Integration (`rustAnalyzerIntegration.ts`)

Enhances analysis by leveraging rust-analyzer's capabilities:
- Hover information for type details
- Symbol information for accurate identification
- Definition and reference tracking
- Workspace-wide type information

### 3. Module Extraction (`extractor.ts`)

Performs the actual refactoring:
- Generates new module file with proper imports
- Updates original file with `mod` declaration
- Adds `use` statements for public items
- Preserves visibility modifiers
- Formats both files (optional)

## Using the Extension

### Basic Workflow

1. **Open a Rust file** in VSCode
2. **Select the code** you want to extract (functions, structs, traits, etc.)
3. **Right-click** and choose one of:
   - "Rusty Refactor: Extract to Module" (uses default path)
   - "Rusty Refactor: Extract to Module (Custom Path)"
4. **Enter module name** (e.g., `user_management`)
5. **Enter path** (if using custom path option)
6. The extension will:
   - Create the new module file
   - Update your original file
   - Format both files (if enabled)

### Tips for Best Results

✅ **DO:**
- Select complete function/struct/trait definitions
- Include related implementations together
- Use descriptive module names in snake_case
- Review generated imports for accuracy

❌ **DON'T:**
- Select partial code blocks
- Extract code with unresolved dependencies
- Use uppercase or spaces in module names
- Forget to test after refactoring

## Configuration

Open VSCode Settings and search for "Rusty Refactor":

```json
{
  "rustyRefactor.defaultModulePath": "src",
  "rustyRefactor.autoFormatAfterRefactor": true,
  "rustyRefactor.addModuleDocComments": true,
  "rustyRefactor.integrationWithRustAnalyzer": true
}
```

## Testing Your Changes

### Manual Testing

1. Open the Extension Development Host (`F5`)
2. Open the `examples/sample.rs` file
3. Try extracting different code sections
4. Verify:
   - New module file is created correctly
   - Imports are added properly
   - Original file is updated
   - Code still compiles

### Automated Testing

```bash
npm run test
```

## Common Development Tasks

### Compile TypeScript
```bash
npm run compile
```

### Watch mode (auto-compile)
```bash
npm run watch
```

### Lint code
```bash
npm run lint
```

### Package extension
```bash
vsce package
```

## Debugging

### Extension Code

1. Set breakpoints in TypeScript files
2. Press `F5` to start debugging
3. Trigger the extension command
4. Debugger will pause at breakpoints

### Check Output

- Open VSCode Output panel
- Select "Rusty Refactor" from the dropdown
- View console.log messages

## Contributing

We welcome contributions! Here's how to help:

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
4. **Test thoroughly**
5. **Commit with clear messages**
   ```bash
   git commit -m "Add feature: description"
   ```
6. **Push and create a Pull Request**

### Code Style

- Use TypeScript strict mode
- Follow existing code patterns
- Add comments for complex logic
- Update tests for new features

## Troubleshooting

### Extension not activating
- Check that you have a Rust file open
- Verify the extension is enabled
- Check VSCode developer console for errors

### rust-analyzer not working
- Ensure rust-analyzer extension is installed
- Check that rust-analyzer is active
- Try disabling and re-enabling integration in settings

### Module not created
- Verify you have write permissions
- Check that the path is valid
- Ensure workspace folder is set

## Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Rust Analyzer](https://rust-analyzer.github.io/)
- [Rust Language](https://www.rust-lang.org/)

## Next Steps

- Explore the `examples/sample.rs` file for test cases
- Read through the source code in `src/`
- Try extracting different types of Rust code
- Customize settings for your workflow
- Report bugs or suggest features

Happy refactoring! 🦀
