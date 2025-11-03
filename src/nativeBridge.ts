import * as path from 'path';
import * as fs from 'fs';

// Type definitions for our native module
interface EnhancedOutput {
  file: string;
  suggested_imports: ImportInfo[];
  external_crates: ExternalCrate[];
  diagnostics: Diagnostic[];
  unresolved_types: string[];
  functions: FunctionInfo[];
  types: TypeInfo[];
}

interface ImportInfo {
  path: string;
  alias?: string;
  span?: SpanInfo;
  is_glob: boolean;
  confidence: number;
}

interface FunctionInfo {
  name: string;
  span?: SpanInfo;
  signature: string;
  params: ParamInfo[];
  return_type: string;
  is_unsafe: boolean;
  is_async: boolean;
}

interface ParamInfo {
  name: string;
  ty: string;
  span?: SpanInfo;
}

interface TypeInfo {
  name: string;
  span?: SpanInfo;
  definition: string;
}

interface SpanInfo {
  line_start: number;
  line_end: number;
  column_start: number;
  column_end: number;
}

interface ExternalCrate {
  name: string;
  version: string;
}

interface Diagnostic {
  level: string;
  message: string;
  span?: SpanInfo;
}

interface ExtractionResult {
  extracted_code: string;
  modified_file: string;
  required_imports: string[];
  suggested_lifetimes: LifetimeSuggestion[];
}

interface LifetimeSuggestion {
  name: string;
  suggestion: string;
  confidence: number;
}

interface TraitBound {
  trait_name: string;
  type_name: string;
  is_required: boolean;
}

interface ModuleConversionInfo {
  needs_conversion: boolean;
  existing_file_path?: string;
  target_folder_path: string;
  target_mod_file_path: string;
  module_name: string;
}

interface CacheStatsResult {
  hits: number;
  misses: number;
  size_bytes: number;
  entry_count: number;
  hit_rate: number;
}

// Native loader that attempts to find the compiled addon
function tryRequire(paths: string[]): any {
  for (const p of paths) {
    try {
      console.log(`Trying to load native module from: ${p}`);
      if (fs.existsSync(p)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(/* webpackIgnore: true */ p);
        console.log(`Successfully loaded native module from: ${p}`);
        return mod;
      }
    } catch (e) {
      console.warn(`Failed to load from ${p}:`, e);
    }
  }
  throw new Error('Native addon not found. Build the napi bridge first (npm run build:napi)');
}

// Try different possible locations for the native module
const candidates = [
  // Standard napi location
  path.join(__dirname, '..', 'rust-backend', 'napi_bridge.win32-x64-msvc.node'),
  path.join(__dirname, '..', 'rust-backend', 'napi_bridge.darwin-x64.node'),
  path.join(__dirname, '..', 'rust-backend', 'napi_bridge.linux-x64-gnu.node'),
  
  // Custom build locations
  path.join(__dirname, '..', 'rust-backend', 'target', 'release', 'rusty_refactor_worker.node'),
  path.join(__dirname, '..', 'rust-backend', 'target', 'release', 'rusty_refactor_worker.dll'),
  path.join(__dirname, '..', 'rust-backend', 'target', 'release', 'librusty_refactor_worker.so'),
  path.join(__dirname, '..', 'rust-backend', 'target', 'release', 'librusty_refactor_worker.dylib'),
  path.join(__dirname, '..', 'rust-backend', 'index.node'),
].filter(p => {
  try {
    // Filter to only check paths that could exist on this platform
    return fs.existsSync(path.dirname(p)) || p.includes('.node');
  } catch {
    return false;
  }
});

// Lazy loading of the native module
let nativeModule: any | null = null;
let loadError: Error | null = null;

function getNativeModule(): any {
  if (nativeModule !== null) {
    return nativeModule;
  }
  
  if (loadError !== null) {
    throw loadError;
  }
  
  try {
    nativeModule = tryRequire(candidates);
    return nativeModule;
  } catch (e) {
    loadError = e as Error;
    throw loadError;
  }
}

// Export wrapper functions with proper error handling
export function enhancedCargoCheck(workspaceRoot: string, targetFile: string): Promise<EnhancedOutput> {
  try {
    const native = getNativeModule();
    return native.enhanced_cargo_check(workspaceRoot, targetFile);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function suggestImportsForTypes(workspaceRoot: string, unresolvedTypes: string[]): Promise<string> {
  try {
    const native = getNativeModule();
    return native.suggest_imports_for_types(workspaceRoot, unresolvedTypes);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function extractFunctionWithTypes(
  filePath: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  functionName: string
): Promise<ExtractionResult> {
  try {
    const native = getNativeModule();
    return native.extract_function_with_types(filePath, startLine, startCol, endLine, endCol, functionName);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function getFunctionAtPosition(
  filePath: string,
  line: number,
  column: number
): Promise<FunctionInfo | null> {
  try {
    const native = getNativeModule();
    return native.get_function_at_position(filePath, line, column);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function analyzeLifetimes(code: string): Promise<LifetimeSuggestion[]> {
  try {
    const native = getNativeModule();
    return native.analyze_lifetimes(code);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function resolveTraitBounds(code: string): Promise<TraitBound[]> {
  try {
    const native = getNativeModule();
    return native.resolve_trait_bounds(code);
  } catch (e) {
    return Promise.reject(e);
  }
}

// Legacy compatibility functions
export function greet(name: string): string {
  try {
    const native = getNativeModule();
    return native.greet ? native.greet(name) : `Hello, ${name}! (native not loaded)`;
  } catch (e) {
    return `Hello, ${name}! (native error: ${e})`;
  }
}

export function analyzePlaceholder(p: string): string {
  try {
    const native = getNativeModule();
    return native.analyze_placeholder ? native.analyze_placeholder(p) : `Analysis result for: ${p}`;
  } catch (e) {
    return `Analysis result for: ${p} (error: ${e})`;
  }
}

// Check if native module is available
export function isNativeModuleAvailable(): boolean {
  try {
    getNativeModule();
    return true;
  } catch {
    return false;
  }
}

// Get the path where the module was loaded from
export function getNativeModulePath(): string | null {
  try {
    const native = getNativeModule();
    // Try to get the module filename
    return native.module?.filename || null;
  } catch {
    return null;
  }
}

// Check if a module needs conversion from file to folder
export function checkModuleConversion(
  workspaceRoot: string,
  targetPath: string,
  moduleName: string
): Promise<ModuleConversionInfo> {
  try {
    const native = getNativeModule();
    return native.check_module_conversion(workspaceRoot, targetPath, moduleName);
  } catch (e) {
    return Promise.reject(e);
  }
}

// Convert a module file to a folder structure
export function convertModuleToFolder(
  existingFilePath: string,
  targetFolderPath: string,
  targetModFilePath: string
): Promise<boolean> {
  try {
    const native = getNativeModule();
    return native.convert_module_to_folder(existingFilePath, targetFolderPath, targetModFilePath);
  } catch (e) {
    return Promise.reject(e);
  }
}

// ============================================================================
// Cache Functions
// ============================================================================

export function createCache(workspaceRoot: string): Promise<string> {
  try {
    const native = getNativeModule();
    return native.create_cache(workspaceRoot);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function getCachedAnalysis(workspaceRoot: string, filePath: string): Promise<string | null> {
  try {
    const native = getNativeModule();
    return native.get_cached_analysis(workspaceRoot, filePath);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function cacheAnalysis(
  workspaceRoot: string,
  filePath: string,
  analysisJson: string
): Promise<boolean> {
  try {
    const native = getNativeModule();
    return native.cache_analysis(workspaceRoot, filePath, analysisJson);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function getCacheStats(workspaceRoot: string): Promise<CacheStatsResult> {
  try {
    const native = getNativeModule();
    return native.get_cache_stats(workspaceRoot);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function clearCache(workspaceRoot: string): Promise<boolean> {
  try {
    const native = getNativeModule();
    return native.clear_cache(workspaceRoot);
  } catch (e) {
    return Promise.reject(e);
  }
}

// ============================================================================
// Name Resolution Functions
// ============================================================================

export function getStdLibraryItems(): Promise<string> {
  try {
    const native = getNativeModule();
    return native.get_std_library_items();
  } catch (e) {
    return Promise.reject(e);
  }
}

export function findBestImport(
  workspaceRoot: string,
  typeName: string
): Promise<string> {
  try {
    const native = getNativeModule();
    return native.find_best_import(workspaceRoot, typeName);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function resolveProjectNames(workspaceRoot: string): Promise<string> {
  try {
    const native = getNativeModule();
    return native.resolve_project_names(workspaceRoot);
  } catch (e) {
    return Promise.reject(e);
  }
}
