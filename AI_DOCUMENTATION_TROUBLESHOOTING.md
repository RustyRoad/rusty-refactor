# AI Documentation Troubleshooting Guide

## How AI Documentation Works

The AI documentation feature uses GitHub Copilot's language model API to generate documentation for extracted Rust modules.

### Workflow

1. **User triggers refactor** → Selects code and runs "Extract to Module"
2. **Prompt appears** → "Generate AI documentation for the extracted module?"
   - **Yes** → Generate docs for this refactor only
   - **No** → Skip documentation
   - **Always** → Generate docs automatically for all future refactors
3. **AI generates documentation** → If successful, adds module-level and function-level doc comments
4. **Validation** → Checks if generated code is valid Rust syntax
5. **Falls back** → If validation fails, uses original code without AI docs

## Checking Settings

Open VS Code settings and search for "rusty refactor":

- `rustyRefactor.aiAutoDocumentation`: Should be `true` after clicking "Always"
- `rustyRefactor.aiAskEachTime`: Should be `false` after clicking "Always"

To reset (if you want to be prompted again):
```json
{
  "rustyRefactor.aiAutoDocumentation": false,
  "rustyRefactor.aiAskEachTime": true
}
```

## Debugging Steps

### 1. Check Console Output

Open the Developer Console in VS Code:
- Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
- Type "Developer: Toggle Developer Tools"
- Go to the Console tab

Look for these messages:
```
AI documentation requested for module: <module_name>
Generating AI documentation with model: <model_name>
AI documentation generated successfully
```

OR error messages:
```
No language models available for documentation generation
Language Model Error: ...
AI generated invalid Rust code, returning original
```

### 2. Verify GitHub Copilot is Active

AI documentation requires GitHub Copilot:

1. Check the status bar for the Copilot icon
2. Ensure you're signed in to GitHub Copilot
3. Verify your Copilot subscription is active

If Copilot is not available, you'll see:
```
GitHub Copilot model not available. Skipping AI documentation.
```

### 3. Test with Simple Code

Try extracting a simple function first:

```rust
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
```

If this works but complex code doesn't, the AI might be generating invalid syntax (which triggers validation failures).

### 4. Check Validation Failures

If you see logs like:
```
Found doc comment on same line as code: /// pub fn
Unbalanced braces: { count: 5, } count: 4
AI generated invalid Rust code, returning original
```

This means the AI generated malformed code. The extension correctly falls back to original code without docs.

## Common Issues

### Issue 1: Prompt Not Appearing

**Symptom**: You don't see the "Generate AI documentation?" prompt

**Causes**:
- `aiAutoDocumentation` is already set to `true` (docs generated automatically)
- `aiAskEachTime` is set to `false` and `aiAutoDocumentation` is `false` (docs disabled)

**Solution**: Check your settings (see above)

### Issue 2: No Documentation Generated

**Symptom**: Prompt appears, you click "Yes" or "Always", but no docs are added

**Causes**:
- GitHub Copilot is not available/active
- AI generated invalid code (validation failed)
- Language model API error

**Solution**: 
1. Check console for error messages
2. Verify Copilot is active
3. Try with simpler code

### Issue 3: "Always" Doesn't Persist

**Symptom**: You click "Always" but are prompted again next time

**Cause**: Settings update might have failed

**Solution**: 
1. Manually set in VS Code settings: `"rustyRefactor.aiAutoDocumentation": true`
2. Check console for "AI documentation enabled: setting updated to always generate"
3. Restart VS Code

### Issue 4: Generated Code Has Syntax Errors

**Symptom**: The AI-documented code doesn't compile

**Cause**: Validation failed to catch an edge case

**Solution**: This is a bug! Please report it with:
- The original code you tried to extract
- The generated code with errors
- Console output

## Manual Override

If AI documentation consistently fails, you can:

1. **Disable it completely**:
   ```json
   {
     "rustyRefactor.aiAutoDocumentation": false,
     "rustyRefactor.aiAskEachTime": false
   }
   ```

2. **Use simple module comments** (generated automatically without AI):
   ```rust
   //! Module name module
   //!
   //! This module was automatically extracted by Rusty Refactor.
   ```

## Reporting Issues

If AI documentation isn't working, please provide:

1. **Console output** (from Developer Tools)
2. **VS Code version** and **OS**
3. **Copilot status** (active/inactive)
4. **Settings values** for `rustyRefactor.ai*`
5. **Sample code** that fails (if possible)

## Expected Behavior

When working correctly, you should see:

1. **First refactor**: Prompt appears
2. **Click "Always"**: Setting saved, docs generated
3. **Subsequent refactors**: No prompt, docs generated automatically
4. **Console shows**: "AI documentation requested" and "generated successfully"
5. **Code has**: Module-level `//!` comments and function-level `///` comments
