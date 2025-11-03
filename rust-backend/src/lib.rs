use napi::bindgen_prelude::*;
use napi_derive::napi;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use toml;
pub mod models;
pub mod cache;
pub mod name_resolution;

pub use models::*;
pub use cache::*;
pub use name_resolution::*;
#[derive(Deserialize, Debug)]
struct CargoToml {
    dependencies: Option<HashMap<String, toml::Value>>,
}

// Enhanced data structures for better IDE integration
#[derive(Serialize, Debug)]
#[napi(object)]
pub struct EnhancedOutput {
    pub file: String,
    pub suggested_imports: Vec<ImportInfo>,
    pub external_crates: Vec<ExternalCrate>,
    pub diagnostics: Vec<Diagnostic>,
    pub unresolved_types: Vec<String>,
    pub functions: Vec<FunctionInfo>,
    pub types: Vec<TypeInfo>,
}

#[derive(Serialize, Debug, Clone)]
#[napi(object)]
pub struct ImportInfo {
    pub path: String,
    pub alias: Option<String>,
    pub span: Option<SpanInfo>,
    pub is_glob: bool,
    pub confidence: f64,
}

#[derive(Serialize, Debug, Clone)]
#[napi(object)]
pub struct FunctionInfo {
    pub name: String,
    pub span: Option<SpanInfo>,
    pub signature: String,
    pub params: Vec<ParamInfo>,
    pub return_type: String,
    pub is_unsafe: bool,
    pub is_async: bool,
}

#[derive(Serialize, Debug, Clone)]
#[napi(object)]
pub struct ParamInfo {
    pub name: String,
    pub ty: String,
    pub span: Option<SpanInfo>,
}

#[derive(Serialize, Debug, Clone)]
#[napi(object)]
pub struct TypeInfo {
    pub name: String,
    pub span: Option<SpanInfo>,
    pub definition: String,
}

#[derive(Serialize, Debug, Clone)]
#[napi(object)]
pub struct SpanInfo {
    pub line_start: u32,
    pub line_end: u32,
    pub column_start: u32,
    pub column_end: u32,
}

#[derive(Serialize, Debug)]
#[napi(object)]
pub struct ExternalCrate {
    pub name: String,
    pub version: String,
}

#[derive(Serialize, Debug)]
#[napi(object)]
pub struct Diagnostic {
    pub level: String,
    pub message: String,
    pub span: Option<SpanInfo>,
}

#[derive(Serialize, Debug)]
#[napi(object)]
pub struct ExtractionResult {
    pub extracted_code: String,
    pub modified_file: String,
    pub required_imports: Vec<String>,
    pub suggested_lifetimes: Vec<LifetimeSuggestion>,
}

#[derive(Serialize, Debug)]
#[napi(object)]
pub struct LifetimeSuggestion {
    pub name: String,
    pub suggestion: String,
    pub confidence: f64,
}

#[derive(Serialize, Debug)]
#[napi(object)]
pub struct TraitBound {
    pub trait_name: String,
    pub type_name: String,
    pub is_required: bool,
}

// State for tracking analysis results
#[napi(object)]
pub struct AnalysisState {
    pub functions: HashMap<String, FunctionInfo>,
    pub types: HashMap<String, TypeInfo>,
    pub imports: HashMap<String, ImportInfo>,
    #[allow(dead_code)]
    pub modules: HashMap<String, String>, // name -> path
    #[allow(dead_code)]
    pub file_path: String,
}

impl AnalysisState {
    pub fn new(file_path: String) -> Self {
        Self {
            functions: HashMap::new(),
            types: HashMap::new(),
            imports: HashMap::new(),
            modules: HashMap::new(),
            file_path,
        }
    }
    // Code extracted to src\models\get_functions.rs
    // Available as: get_functions::*
    pub fn get_types(&self) -> Vec<TypeInfo> {
        self.types.values().cloned().collect()
    }

    pub fn get_imports(&self) -> Vec<ImportInfo> {
        self.imports.values().cloned().collect()
    }
}

/// Enhanced version of cargo check that provides more accurate import suggestions
#[napi]
pub fn enhanced_cargo_check(workspace_root: String, target_file: String) -> Result<EnhancedOutput> {
    match enhanced_check_impl(&workspace_root, &target_file) {
        Ok(output) => Ok(output),
        Err(e) => {
            // Return an enhanced error response
            Ok(EnhancedOutput {
                file: target_file,
                suggested_imports: vec![],
                external_crates: vec![],
                diagnostics: vec![Diagnostic {
                    level: "error".to_string(),
                    message: e.to_string(),
                    span: None,
                }],
                unresolved_types: vec![],
                functions: vec![],
                types: vec![],
            })
        }
    }
}

/// Provide import suggestions for unresolved types (legacy version)
#[napi]
pub fn suggest_imports_for_types_legacy(
    unresolved_types: Vec<String>,
    _workspace_root: String,
) -> Result<Vec<ImportInfo>> {
    let mut suggestions = Vec::new();

    // In a real implementation, this would:
    // 1. Use the name resolution engine to find matches
    // 2. Score matches by relevance
    // 3. Return the top suggestions

    for _type in unresolved_types {
        // Placeholder implementation
        suggestions.push(ImportInfo {
            path: "std::collections::HashMap".to_string(),
            alias: None,
            span: None,
            is_glob: false,
            confidence: 0.9,
        });
    }

    Ok(suggestions)
}

/// Analyze code to determine lifetime requirements
#[napi]
pub fn analyze_lifetimes(_code: String, _context: String) -> Result<Vec<LifetimeSuggestion>> {
    let mut suggestions = Vec::new();

    // In a real implementation, this would:
    // 1. Parse the code to find lifetime dependencies
    // 2. Run borrow checker analysis
    // 3. Suggest appropriate lifetime annotations

    // Placeholder implementation
    if _code.contains("&") {
        suggestions.push(LifetimeSuggestion {
            name: "'a".to_string(),
            suggestion: "Consider adding lifetime parameter 'a".to_string(),
            confidence: 0.7,
        });
    }

    Ok(suggestions)
}

/// Resolve trait bounds for generic code
#[napi]
pub fn resolve_trait_bounds(_code: String, generic_params: Vec<String>) -> Result<Vec<TraitBound>> {
    let mut trait_bounds = Vec::new();

    // In a real implementation, this would:
    // 1. Parse the code to find where generics are used
    // 2. Query rustc's trait solver
    // 3. Return minimal required trait bounds

    // Placeholder implementation
    for param in generic_params {
        if param == "T" {
            trait_bounds.push(TraitBound {
                trait_name: "Debug".to_string(),
                type_name: param,
                is_required: true,
            });
        }
    }

    Ok(trait_bounds)
}

/// Get function information for a given file
#[napi]
pub fn get_function_info(
    _file_path: String,
    _workspace_root: String,
) -> Result<Option<FunctionInfo>> {
    // Placeholder implementation
    // In a real implementation, this would parse the file and extract function info
    Ok(None)
}

/// Information about module conversion from file to folder
#[derive(Serialize, Debug)]
#[napi(object)]
pub struct ModuleConversionInfo {
    pub needs_conversion: bool,
    pub existing_file_path: Option<String>,
    pub target_folder_path: String,
    pub target_mod_file_path: String,
    pub module_name: String,
}

/// Check if a module file needs to be converted to a folder structure
/// This handles the case where a user wants to extract code to a module that's currently
/// a file (e.g., models.rs) and should become a folder (e.g., models/mod.rs)
#[napi]
pub fn check_module_conversion(
    workspace_root: String,
    target_path: String,
    module_name: String,
) -> Result<ModuleConversionInfo> {
    let workspace = Path::new(&workspace_root);
    let target = Path::new(&target_path);
    
    // Determine the parent directory where the module should be
    let parent_dir = target.parent().unwrap_or(Path::new(""));
    let full_parent = workspace.join(parent_dir);
    
    // Check if a file with the module name exists in the parent directory
    let module_file = full_parent.join(format!("{}.rs", module_name));
    let module_folder = full_parent.join(&module_name);
    let module_mod_file = module_folder.join("mod.rs");
    
    let needs_conversion = module_file.exists() && !module_folder.exists();
    
    Ok(ModuleConversionInfo {
        needs_conversion,
        existing_file_path: if module_file.exists() {
            Some(module_file.to_string_lossy().to_string())
        } else {
            None
        },
        target_folder_path: module_folder.to_string_lossy().to_string(),
        target_mod_file_path: module_mod_file.to_string_lossy().to_string(),
        module_name,
    })
}

/// Convert a module file to a folder structure
/// Moves models.rs -> models/mod.rs
#[napi]
pub fn convert_module_to_folder(
    existing_file_path: String,
    target_folder_path: String,
    target_mod_file_path: String,
) -> Result<bool> {
    let source = Path::new(&existing_file_path);
    let folder = Path::new(&target_folder_path);
    let mod_file = Path::new(&target_mod_file_path);
    
    // Verify source exists
    if !source.exists() {
        return Err(napi::Error::new(
            napi::Status::InvalidArg,
            format!("Source file does not exist: {}", existing_file_path),
        ));
    }
    
    // Create the folder
    fs::create_dir_all(folder).map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("Failed to create folder: {}", e),
        )
    })?;
    
    // Read the content from the original file
    let content = fs::read_to_string(source).map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("Failed to read source file: {}", e),
        )
    })?;
    
    // Write to mod.rs
    fs::write(mod_file, content).map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("Failed to write mod.rs: {}", e),
        )
    })?;
    
    // Remove the original file
    fs::remove_file(source).map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("Failed to remove original file: {}", e),
        )
    })?;
    
    Ok(true)
}

// Private implementation functions

fn enhanced_check_impl(workspace_root: &str, target_file: &str) -> napi::Result<EnhancedOutput> {
    // Ensure target file exists
    if fs::metadata(target_file).is_err() {
        return Ok(EnhancedOutput {
            file: target_file.to_string(),
            suggested_imports: vec![],
            external_crates: vec![],
            diagnostics: vec![],
            unresolved_types: vec![],
            functions: vec![],
            types: vec![],
        });
    }

    // Read external crates from Cargo.toml
    let external_crates = read_cargo_dependencies(workspace_root);

    // Run cargo check
    let mut cmd = Command::new("cargo");
    cmd.args(&["check", "--message-format=json", "--all-targets"]);
    cmd.current_dir(workspace_root);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("Failed to run cargo check: {}", e),
        )
    })?;
    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let reader = BufReader::new(stdout);

    let backtick_re = Regex::new(r#"`([^`]+)`"#).map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("Failed to compile regex: {}", e),
        )
    })?;
    let type_re = Regex::new(r"(?:type|struct|enum|trait)\s+`([^`]+)`").map_err(|e| {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("Failed to compile regex: {}", e),
        )
    })?;
    let mut suggestions: HashSet<String> = HashSet::new();
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let mut unresolved_types: HashSet<String> = HashSet::new();

    // Canonicalize target file for reliable comparison
    let canonical_target =
        fs::canonicalize(target_file).unwrap_or_else(|_| PathBuf::from(target_file));

    for line in reader.lines() {
        let line = line.unwrap_or_default();
        if line.trim().is_empty() {
            continue;
        }

        // Parse JSON
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if v.get("reason").and_then(|r| r.as_str()) != Some("compiler-message") {
            continue;
        }

        let message = &v["message"];
        let level = message["level"].as_str().unwrap_or("").to_string();
        let msg_text = message["message"].as_str().unwrap_or("").to_string();

        // Check if message relates to target file
        let mut spans_hit = false;
        let mut span_info: Option<SpanInfo> = None;

        if let Some(spans) = message.get("spans").and_then(|s| s.as_array()) {
            for span in spans {
                if let Some(file_name) = span.get("file_name").and_then(|f| f.as_str()) {
                    let file_path =
                        fs::canonicalize(file_name).unwrap_or_else(|_| PathBuf::from(file_name));
                    if file_path == canonical_target {
                        spans_hit = true;

                        // Extract span information
                        if span_info.is_none() {
                            span_info = Some(SpanInfo {
                                line_start: span["line_start"].as_u64().unwrap_or(0) as u32,
                                line_end: span["line_end"].as_u64().unwrap_or(0) as u32,
                                column_start: span["column_start"].as_u64().unwrap_or(0) as u32,
                                column_end: span["column_end"].as_u64().unwrap_or(0) as u32,
                            });
                        }
                        break;
                    }
                }
            }
        }

        if !spans_hit {
            continue;
        }

        // Add diagnostic with span info
        diagnostics.push(Diagnostic {
            level: level.clone(),
            message: msg_text.clone(),
            span: span_info,
        });

        // Extract unresolved types
        if msg_text.contains("cannot find type") || msg_text.contains("unresolved import") {
            for cap in type_re.captures_iter(&msg_text) {
                if let Some(m) = cap.get(1) {
                    unresolved_types.insert(m.as_str().to_string());
                }
            }
        }

        // Process rendered message for import suggestions
        if let Some(rendered) = message.get("rendered").and_then(|r| r.as_str()) {
            extract_imports_from_rendered(rendered, &backtick_re, &mut suggestions);
        }

        // Process child messages (compiler suggestions)
        if let Some(children) = message.get("children").and_then(|c| c.as_array()) {
            for child in children {
                let child_msg = child.get("message").and_then(|m| m.as_str()).unwrap_or("");

                // Look for "consider importing" suggestions
                if child_msg.contains("consider importing")
                    || child_msg.contains("use of undeclared")
                {
                    if let Some(rendered) = child.get("rendered").and_then(|r| r.as_str()) {
                        extract_imports_from_rendered(rendered, &backtick_re, &mut suggestions);
                    }
                }
            }
        }
    }

    // Wait for child process
    let _ = child.wait();

    // Convert structured suggestions
    let mut import_infos = Vec::new();
    for suggestion in suggestions {
        import_infos.push(ImportInfo {
            path: suggestion,
            alias: None,
            span: None,
            is_glob: false,
            confidence: 0.8,
        });
    }

    let unresolved_vec: Vec<String> = unresolved_types.into_iter().collect();

    Ok(EnhancedOutput {
        file: canonical_target.to_string_lossy().to_string(),
        suggested_imports: import_infos,
        external_crates,
        diagnostics,
        unresolved_types: unresolved_vec,
        functions: vec![], // TODO: Implement function extraction
        types: vec![],     // TODO: Implement type extraction
    })
}

/// Extract import suggestions from rendered compiler output
fn extract_imports_from_rendered(
    rendered: &str,
    backtick_re: &Regex,
    suggestions: &mut HashSet<String>,
) {
    for cap in backtick_re.captures_iter(rendered) {
        if let Some(m) = cap.get(1) {
            let snippet = m.as_str().trim();

            // Extract from use statements
            if snippet.starts_with("use ") {
                let without_use = snippet.trim_start_matches("use ").trim();
                let without_semicolon = without_use.trim_end_matches(';').trim();
                suggestions.insert(without_semicolon.to_string());
                continue;
            }

            // Extract paths (contains ::)
            if snippet.contains("::") {
                let without_semicolon = snippet.trim_end_matches(';').trim();
                suggestions.insert(without_semicolon.to_string());
                continue;
            }
        }
    }
}

/// Read dependencies from Cargo.toml
fn read_cargo_dependencies(workspace_root: &str) -> Vec<ExternalCrate> {
    let cargo_path = Path::new(workspace_root).join("Cargo.toml");
    let mut crates = Vec::new();

    if let Ok(contents) = fs::read_to_string(&cargo_path) {
        if let Ok(cargo_toml) = toml::from_str::<CargoToml>(&contents) {
            if let Some(deps) = cargo_toml.dependencies {
                for (name, value) in deps {
                    let version = match value {
                        toml::Value::String(v) => v,
                        toml::Value::Table(t) => t
                            .get("version")
                            .and_then(|v| v.as_str())
                            .unwrap_or("*")
                            .to_string(),
                        _ => "*".to_string(),
                    };
                    crates.push(ExternalCrate { name, version });
                }
            }
        }
    }

    crates
}

// ============================================================================
// NAPI Cache Bindings
// ============================================================================

/// Create a new incremental cache
#[napi]
pub fn create_cache(workspace_root: String) -> Result<String> {
    let _cache = IncrementalCache::new(&workspace_root)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    // Return a success indicator (in real implementation, we'd return a cache handle)
    Ok(format!("Cache initialized at {}", workspace_root))
}

/// Get cached analysis for a file
#[napi]
pub fn get_cached_analysis(workspace_root: String, file_path: String) -> Result<Option<String>> {
    let cache = IncrementalCache::new(&workspace_root)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    let entry = cache.get(Path::new(&file_path))
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    // Return serialized cache data if found
    Ok(entry.map(|e| format!("Cached: {} bytes HIR, {} bytes MIR", 
        e.hir_data.len(), e.mir_data.len())))
}

/// Cache analysis results for a file
#[napi]
pub fn cache_analysis(
    workspace_root: String,
    file_path: String,
    analysis_json: String,
) -> Result<bool> {
    let cache = IncrementalCache::new(&workspace_root)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    // In real implementation, we'd serialize the analysis result properly
    let hir_data = analysis_json.as_bytes();
    let mir_data = &[]; // Placeholder
    
    let file_metadata = std::fs::metadata(&file_path)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    let metadata = cache::CacheMetadata {
        rustc_version: "1.70.0".to_string(), // Would detect actual version
        dependencies: vec![],
        file_mtime: file_metadata.modified()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        analysis_duration_ms: 0,
        file_size: file_metadata.len(),
    };
    
    cache.put(Path::new(&file_path), hir_data, mir_data, metadata)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    Ok(true)
}

/// Get cache statistics
#[napi(object)]
pub struct CacheStatsResult {
    pub hits: u32,
    pub misses: u32,
    pub size_bytes: u32,
    pub entry_count: u32,
    pub hit_rate: f64,
}

#[napi]
pub fn get_cache_stats(workspace_root: String) -> Result<CacheStatsResult> {
    let cache = IncrementalCache::new(&workspace_root)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    let stats = cache.stats();
    
    Ok(CacheStatsResult {
        hits: stats.hits as u32,
        misses: stats.misses as u32,
        size_bytes: stats.size_bytes as u32,
        entry_count: stats.entry_count as u32,
        hit_rate: stats.hit_rate(),
    })
}

/// Clear the cache
#[napi]
pub fn clear_cache(workspace_root: String) -> Result<bool> {
    let cache = IncrementalCache::new(&workspace_root)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    cache.clear()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    Ok(true)
}

// ============================================================================
// NAPI Name Resolution Bindings
// ============================================================================

/// Suggest imports for unresolved types using the name resolution engine
#[napi]
pub fn suggest_imports_for_types(
    workspace_root: String,
    unresolved_types: Vec<String>,
) -> Result<String> {
    let resolver = NameResolver::new();
    
    let matches = resolver.find_matches_for_types(&unresolved_types, Path::new(&workspace_root))
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    // Convert to JSON
    let json = serde_json::to_string(&matches)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    Ok(json)
}

/// Get all importable items from std library
#[napi]
pub fn get_std_library_items() -> Result<String> {
    let resolver = NameResolver::new();
    
    let items = resolver.get_std_items()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    let json = serde_json::to_string(&items)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    Ok(json)
}

/// Find best import match for a single type
#[napi]
pub fn find_best_import(
    workspace_root: String,
    type_name: String,
) -> Result<String> {
    let resolver = NameResolver::new();
    
    let matches = resolver.find_matches_for_types(&[type_name], Path::new(&workspace_root))
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    // Get the best match (highest confidence)
    if let Some(best_match) = matches.first() {
        let json = serde_json::to_string(&best_match)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(json)
    } else {
        Ok("null".to_string())
    }
}

/// Resolve all names in a project (expensive operation, use cache!)
#[napi]
pub fn resolve_project_names(workspace_root: String) -> Result<String> {
    // Create resolver with cache
    let cache = IncrementalCache::new(&workspace_root)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    let resolver = NameResolver::with_cache(cache);
    
    let result = resolver.resolve_project(Path::new(&workspace_root))
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    let json = serde_json::to_string(&result)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    Ok(json)
}
