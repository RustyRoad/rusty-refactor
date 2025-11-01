# Rusty Refactor

A powerful VSCode extension for extracting Rust code into modules with intelligent type detection, **impl block preservation**, and **RustyRoad-aware** file navigation.

## ✨ Features

### 💬 Copilot Chat Integration (NEW!)
- **Language Model Tools**: Use Rusty Refactor directly in Copilot Chat with natural language commands
  - `#extract_rust_module`: Ask Copilot to extract Rust code to a new module
  - `#analyze_rust`: Ask Copilot to analyze Rust code structure and dependencies
- **Agent Mode Support**: Copilot can automatically invoke extraction tools as part of its refactoring workflow
- **Intelligent Tool Calling**: Natural conversation flow - Copilot understands context and suggests refactoring
- **Confirmation Dialogs**: User-friendly confirmations before any refactoring operations

### 🤖 AI-Powered Documentation
- **Automatic Documentation Generation**: Uses GPT-4o-mini to generate comprehensive Rust documentation
- **Smart Summaries**: AI-generated extraction summaries in the original file
- **Copilot Integration**: Leverages GitHub Copilot's language models
- **Configurable**: Can be set to always ask, always generate, or never generate

### 🚀 Smart Code Extraction
- **Intelligent Import Analysis**: Only copies imports that are actually used in the extracted code
- **Rust-Analyzer Cleanup**: Automatically removes unused imports after extraction using LSP diagnostics
- **Implementation Block Preservation**: Automatically wraps extracted methods in `impl` blocks when extracting from implementations
- **Type Detection**: Identifies types, traits, and dependencies in your selected code
- **Automatic Module Registration**: Finds parent module and properly registers with `pub mod` and `pub use`

### 📁 RustyRoad Integration
Built specifically for [RustyRoad](https://github.com/RustyRoad/RustyRoad) projects with Rails-like conventions:
- **Auto-suggests conventional directories**: `controllers`, `models`, `views`, `services`, `middleware`, etc.
- **Browse project structure**: Intuitive directory navigation with QuickPick
- **Create directories on-the-fly**: Automatically creates suggested RustyRoad directories

### 🎯 Three Extraction Modes

1. **Extract with File Browser** ⭐ (Recommended)
   - Visual directory browsing
   - RustyRoad directory suggestions
   - Create new directories as needed

2. **Quick Extract**
   - Uses default path from settings
   - Fastest for standard workflows

3. **Custom Path Extract**
   - Type exact file path manually
   - For advanced users

## 💬 Using with Copilot Chat

Rusty Refactor is now available as a **Language Model Tool** in Copilot Chat! You can use natural language to refactor your Rust code.

### Extract Code via Copilot Chat

Open the Copilot Chat panel and ask Copilot to help with refactoring:

```
@copilot #extract_rust_module Extract the create method from src/models/email.rs (lines 15-35) to a module named "email_repository" in src/models/repositories/
```

Or use the analyze tool first:

```
@copilot #analyze_rust Analyze the code in src/models/email.rs from lines 1 to 50 to understand what I'm working with
```

### Why Use Copilot Chat?

- **Natural Language**: Describe what you want to extract in plain English
- **Context-Aware**: Copilot understands your code and makes intelligent suggestions
- **Automated**: Let Copilot handle the extraction while you focus on design
- **Confirmation**: Always review and confirm before changes are applied
- **Integrated**: Works alongside Copilot's code analysis and suggestions

## 📖 Usage Examples

### Example 1: Extracting Methods from an `impl` Block

**Before** - Original file `src/models/email.rs`:
```rust
use super::Email;
use rustyroad::database::{Database, PoolConnection};

impl Email {
    pub fn new(
        to_field: String,
        from_field: String,
        subject: String,
        body: String,
    ) -> Self {
        Self {
            id: 0,
            to_field,
            from_field,
            subject,
            body,
            status: "pending".to_string(),
        }
    }

    pub async fn create(email: Email) -> Result<Self, sqlx::Error> {
        let sql = r#"
            INSERT INTO emails (to_field, from_field, status)
            VALUES ($1, $2, $3)
            RETURNING *
        "#;
        
        let database = Database::get_database_from_rustyroad_toml().unwrap();
        let pool = Database::get_db_pool(database).await.unwrap();
        
        sqlx::query_as::<_, Self>(sql)
            .bind(&email.to_field)
            .bind(&email.from_field)
            .bind(&email.status)
            .fetch_one(&pool)
            .await
    }
}
```

**Steps:**
1. Select the `create` method (just the method, not the entire impl block)
2. Right-click → **"Rusty Refactor: Extract to Module (Browse Files)"**
3. Enter module name: `email_repository`
4. Browse to: `src/models/repositories/` or create it
5. Confirm

**After** - New file `src/models/repositories/email_repository.rs`:
```rust
//! Email repository module
//!
//! This module was automatically extracted by Rusty Refactor.

// Imports from original file
use super::Email;
use rustyroad::database::{Database, PoolConnection};

impl Email {
    pub async fn create(email: Email) -> Result<Self, sqlx::Error> {
        let sql = r#"
            INSERT INTO emails (to_field, from_field, status)
            VALUES ($1, $2, $3)
            RETURNING *
        "#;
        
        let database = Database::get_database_from_rustyroad_toml().unwrap();
        let pool = Database::get_db_pool(database).await.unwrap();
        
        sqlx::query_as::<_, Self>(sql)
            .bind(&email.to_field)
            .bind(&email.from_field)
            .bind(&email.status)
            .fetch_one(&pool)
            .await
    }
}
```

**Updated** - Original file `src/models/email.rs`:
```rust
use super::Email;
use rustyroad::database::{Database, PoolConnection};

pub mod repositories;
pub use repositories::email_repository::*;

impl Email {
    pub fn new(
        to_field: String,
        from_field: String,
        subject: String,
        body: String,
    ) -> Self {
        Self {
            id: 0,
            to_field,
            from_field,
            subject,
            body,
            status: "pending".to_string(),
        }
    }

    // Code extracted to src/models/repositories/email_repository.rs
    // Available as: email_repository::*
}
```

**Updated** - Parent module file `src/models/mod.rs` or `src/lib.rs`:
```rust
pub mod repositories;
pub use repositories::*;
```

### Example 2: Extracting Standalone Functions

**Before**:
```rust
use std::collections::HashMap;

pub fn calculate_total(items: &[Item]) -> f64 {
    items.iter().map(|i| i.price).sum()
}

pub fn apply_discount(total: f64, discount: f64) -> f64 {
    total * (1.0 - discount)
}
```

**Steps:**
1. Select both functions
2. Extract to `src/utils/pricing.rs`

**After** - `src/utils/pricing.rs`:
```rust
//! Pricing module

// Imports from original file
use std::collections::HashMap;

pub fn calculate_total(items: &[Item]) -> f64 {
    items.iter().map(|i| i.price).sum()
}

pub fn apply_discount(total: f64, discount: f64) -> f64 {
    total * (1.0 - discount)
}
```

## 🎨 How It Works

### Import Handling
Rusty Refactor intelligently copies **all imports from your original file** to the new module. This means:
- ✅ External crate imports are preserved
- ✅ Local module imports are maintained  
- ✅ No more compiler errors from missing imports
- ✅ Only adds `use super::*` for types defined in the parent module (like struct definitions for impl blocks)

### Implementation Block Detection
When you select code inside an `impl` block:
1. Detects you're inside an `impl Email` or `impl Trait for Type`
2. Automatically wraps extracted code in the same impl structure
3. Imports the target type from parent module if needed
4. Preserves trait implementations correctly

### Module Registration
The extension automatically:
1. Finds the correct parent module file (`mod.rs`, `lib.rs`, or `main.rs`)
2. Adds `pub mod module_name;` with proper path attributes if needed
3. Adds `pub use module_name::*;` to re-export public items
4. Handles nested module structures

## ⚙️ Configuration

```json
{
  // Enable RustyRoad conventions (controllers, models, etc.)
  "rustyRefactor.rustyRoadMode": true,
  
  // Default path for quick extract
  "rustyRefactor.defaultModulePath": "src",
  
  // Auto-format after refactoring
  "rustyRefactor.autoFormatAfterRefactor": true,
  
  // Add doc comments to extracted modules
  "rustyRefactor.addModuleDocComments": true,
  
  // Integrate with rust-analyzer
  "rustyRefactor.integrationWithRustAnalyzer": true,
  
  // AI Documentation (requires GitHub Copilot)
  "rustyRefactor.aiAutoDocumentation": false,  // Set to true to always generate
  "rustyRefactor.aiAskEachTime": true,         // Ask before generating each time
  
  // Maximum directory depth for file search
  "rustyRefactor.searchDepth": 5
}
```

### AI Documentation Setup

1. **Install GitHub Copilot**: The AI documentation feature requires an active GitHub Copilot subscription
2. **Enable in Settings**: Set `rustyRefactor.aiAutoDocumentation` to `true` for automatic generation
3. **Or Choose Each Time**: Keep `rustyRefactor.aiAskEachTime` as `true` to be prompted each extraction

**AI Documentation Example:**

Before extraction, your code might look like this:
```rust
pub async fn create(email: Email) -> Result<Self, sqlx::Error> {
    let sql = r#"INSERT INTO emails..."#;
    // ... implementation
}
```

After AI documentation generation:
```rust
/// Creates a new email record in the database
///
/// This function inserts a new email entry into the emails table with the provided
/// email data and returns the created record with all database-generated fields.
///
/// # Arguments
///
/// * `email` - The email data to be inserted
///
/// # Returns
///
/// Returns `Result<Self, sqlx::Error>` containing the created email record with
/// database-generated fields populated, or an error if the insertion fails.
///
/// # Errors
///
/// This function will return an error if:
/// * Database connection fails
/// * SQL query execution fails
/// * Email data validation fails
///
/// # Example
///
/// ```rust
/// let email = Email::new(...);
/// let created = Email::create(email).await?;
/// ```
pub async fn create(email: Email) -> Result<Self, sqlx::Error> {
    let sql = r#"INSERT INTO emails..."#;
    // ... implementation
}
```

## 🚦 Commands

| Command | Description | Shortcut |
|---------|-------------|----------|
| `Rusty Refactor: Extract to Module (Browse Files)` | Browse and select destination directory | Right-click menu |
| `Rusty Refactor: Extract to Module` | Quick extract to default path | Right-click menu |
| `Rusty Refactor: Extract to Module (Custom Path)` | Manually type file path | Right-click menu |

## 📋 Requirements

- VSCode 1.80.0 or higher
- Rust project with `Cargo.toml`
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) extension (recommended for best results)

## 🔧 Installation

1. Install from VSCode Marketplace: Search for "Rusty Refactor"
2. Or install from VSIX: `code --install-extension rusty-refactor-0.2.0.vsix`

## 🎯 RustyRoad Project Structure

This extension works great with RustyRoad's Rails-inspired structure:

```
src/
├── controllers/       # HTTP request handlers
├── models/           # Data models and business logic
│   └── repositories/ # Database access layer
├── views/            # Template rendering
├── services/         # Business logic services
├── middleware/       # Request/response middleware
├── helpers/          # Helper functions
├── utils/            # Utility functions
├── config/           # Configuration
├── routes/           # Route definitions
└── lib.rs or main.rs
```

When you use "Extract with File Browser", these directories are suggested automatically!

## 🐛 Troubleshooting

### Imports not working?
- The extension copies all imports from your original file
- If you still get errors, check that the types are accessible from the new module location
- You may need to adjust paths if moving between different module hierarchies

### Module not registered in parent?
- Check that your project has a proper module structure (`mod.rs`, `lib.rs`, or `main.rs`)
- The extension looks for parent modules automatically
- You can manually add `pub mod module_name;` if needed

### Impl block not preserved?
- Make sure you're selecting code from **inside** an impl block
- The extension detects the impl context automatically
- If issues persist, try selecting the entire impl block

## 🤝 Contributing

Contributions welcome! Please open issues or PRs on GitHub.

## 📄 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- Built for the [RustyRoad](https://github.com/RustyRoad/RustyRoad) framework
- Inspired by Rails conventions and Ruby refactoring tools
- Powered by rust-analyzer LSP integration

---

**Happy Refactoring! 🦀✨**
