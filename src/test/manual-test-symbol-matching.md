# Manual Test Guide for Symbol Matching in ExtractToModuleTool

## Overview
This guide provides step-by-step instructions to manually test the symbol matching functionality implemented in the ExtractToModuleTool.

## Test Scenarios

### 1. Symbol Found Successfully
**Objective:** Verify symbol matching works when functionName exists

**Steps:**
1. Create a Rust file with the following content:
```rust
/// A test function
pub fn test_function() -> String {
    "Hello, World!".to_string()
}

pub struct TestStruct {
    field: i32,
}

impl TestStruct {
    pub fn new() -> Self {
        Self { field: 42 }
    }
}
```

2. Use the language model tool with these parameters:
```json
{
    "sourceFilePath": "/path/to/your/file.rs",
    "startLine": 2,
    "endLine": 4,
    "functionName": "test_function",
    "moduleName": "test_module"
}
```

3. **Expected Results:**
   - Console log: "Attempting to find symbol by name: test_function"
   - Console log: "Successfully found symbol 'test_function' using symbol matching"
   - Result message includes: "Extraction method: Symbol matching"
   - The entire function (including doc comment) should be extracted

### 2. Symbol Not Found - Fallback to Line Numbers
**Objective:** Verify fallback behavior when symbol doesn't exist

**Steps:**
1. Use the same Rust file as above
2. Use the language model tool with these parameters:
```json
{
    "sourceFilePath": "/path/to/your/file.rs",
    "startLine": 2,
    "endLine": 4,
    "functionName": "nonexistent_function",
    "moduleName": "test_module"
}
```

3. **Expected Results:**
   - Console log: "Attempting to find symbol by name: nonexistent_function"
   - Console log: "Symbol 'nonexistent_function' not found, falling back to line numbers"
   - Console log: "Using line numbers 2-4 for selection"
   - Result message includes: "Extraction method: Line numbers"
   - Lines 2-4 should be extracted

### 3. No FunctionName Provided
**Objective:** Verify line numbers are used when no functionName

**Steps:**
1. Use the same Rust file
2. Use the language model tool with these parameters:
```json
{
    "sourceFilePath": "/path/to/your/file.rs",
    "startLine": 6,
    "endLine": 8,
    "moduleName": "test_module"
}
```

3. **Expected Results:**
   - Console log: "Using line numbers 6-4 for selection"
   - Result message includes: "Extraction method: Line numbers"
   - Lines 6-8 should be extracted

### 4. Struct Symbol Matching
**Objective:** Verify symbol matching works for structs

**Steps:**
1. Use the same Rust file
2. Use the language model tool with these parameters:
```json
{
    "sourceFilePath": "/path/to/your/file.rs",
    "startLine": 6,
    "endLine": 8,
    "functionName": "TestStruct",
    "moduleName": "test_module"
}
```

3. **Expected Results:**
   - Console log: "Successfully found symbol 'TestStruct' using symbol matching"
   - Result message includes: "Extraction method: Symbol matching"
   - The entire struct definition should be extracted

### 5. Error Handling - Empty Selection
**Objective:** Verify error handling when both methods fail

**Steps:**
1. Use the language model tool with these parameters:
```json
{
    "sourceFilePath": "/path/to/empty/file.rs",
    "startLine": 100,
    "endLine": 200,
    "functionName": "nonexistent",
    "moduleName": "test_module"
}
```

3. **Expected Results:**
   - Error message: "The selected code using line numbers does not contain any code..."

## Verification Checklist

For each test scenario, verify:

- [ ] Console logs show the correct method being used
- [ ] Result message indicates the correct extraction method
- [ ] The correct code is extracted
- [ ] Error messages are clear and helpful
- [ ] Fallback behavior works as expected

## Confirmation Message Testing

Test that the `prepareInvocation` method shows correct information:

- [ ] When functionName is provided: Shows both symbol name and line numbers as fallback
- [ ] When no functionName: Shows only line numbers
- [ ] Note about symbol matching appears when functionName is provided

## Performance Considerations

- [ ] Symbol matching doesn't significantly delay the extraction process
- [ ] Fallback to line numbers is immediate when symbol not found
- [ ] Logging is appropriate (not too verbose, not too silent)

## Edge Cases to Consider

- [ ] Empty string as functionName
- [ ] Special characters in functionName
- [ ] Multiple symbols with the same name in different scopes
- [ ] Symbols with attributes (#[derive(...)])
- [ ] Symbols inside impl blocks