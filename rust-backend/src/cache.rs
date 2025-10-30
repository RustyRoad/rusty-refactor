//! Incremental compilation cache for Rusty Refactor
//! 
//! This module implements a query-based caching system similar to rust-analyzer's salsa,
//! designed to persist HIR/MIR analysis between refactorings for instant performance.

use anyhow::Result;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use zstd::bulk::Compressor;
use dashmap::DashMap;

/// Base directory for all cache files
const CACHE_DIR: &str = ".rusty-cache";

/// Current cache version - bump this to invalidate all existing caches
const CACHE_VERSION: u32 = 1;

/// Cache entry for persisted HIR/MIR data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    /// Hash of the file content
    pub file_hash: u64,
    /// Timestamp when this entry was created
    pub created_at: u64,
    /// Compressed HIR data (binary)
    pub hir_data: Vec<u8>,
    /// Compressed MIR data (binary)
    pub mir_data: Vec<u8>,
    /// Additional metadata (dependencies, etc.)
    pub metadata: CacheMetadata,
}

/// Metadata stored with each cache entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheMetadata {
    /// Rust compiler version
    pub rustc_version: String,
    /// List of files this file depends on
    pub dependencies: Vec<PathBuf>,
    /// File modification time
    pub file_mtime: u64,
    /// Analysis duration (for caching decisions)
    pub analysis_duration_ms: u64,
    /// File size in bytes
    pub file_size: u64,
}

/// Index for fast lookup of cache entries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheIndex {
    /// Map from file path to cache key
    pub file_to_key: HashMap<PathBuf, String>,
    /// Map from cache key to file metadata
    pub entries: HashMap<String, CacheMetadata>,
    /// Cache statistics
    pub stats: CacheStats,
    /// Cache version of this index
    pub version: u32,
}

/// Cache statistics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CacheStats {
    /// Total number of cache hits
    pub hits: u64,
    /// Total number of cache misses
    pub misses: u64,
    /// Current cache size in bytes
    pub size_bytes: u64,
    /// Number of entries in cache
    pub entry_count: u64,
}

impl CacheStats {
    pub fn hit_rate(&self) -> f64 {
        if self.hits + self.misses == 0 {
            return 0.0;
        }
        self.hits as f64 / (self.hits + self.misses) as f64
    }
}

/// Main incremental cache system
#[derive(Clone)]
pub struct IncrementalCache {
    /// Base directory for cache
    base_dir: PathBuf,
    /// Index file for fast lookups
    index: Arc<RwLock<CacheIndex>>,
    /// In-memory cache for hot entries
    memory_cache: Arc<DashMap<String, CacheEntry>>,
    /// File system options
    fs_options: CacheOptions,
    /// Compressor for data
    compressor: Arc<RwLock<Compressor<'static>>>,
}

/// Configuration for cache behavior
#[derive(Debug, Clone)]
pub struct CacheOptions {
    /// Maximum cache size in bytes (0 = unlimited)
    pub max_size_bytes: u64,
    /// Maximum duration to keep entries (0 = unlimited)
    pub max_age_secs: u64,
    /// Whether to compress cached data
    pub compress_data: bool,
    /// Whether to use memory-mapped files
    pub use_mmap: bool,
    /// Maximum number of in-memory entries
    pub max_memory_entries: usize,
}

impl Default for CacheOptions {
    fn default() -> Self {
        Self {
            max_size_bytes: 500 * 1024 * 1024, // 500MB
            max_age_secs: 24 * 60 * 60, // 24 hours
            compress_data: true,
            use_mmap: true,
            max_memory_entries: 100,
        }
    }
}

impl IncrementalCache {
    /// Create a new incremental cache with default options
    pub fn new<P: AsRef<Path>>(workspace_root: P) -> Result<Self> {
        Self::with_options(workspace_root, CacheOptions::default())
    }

    /// Create a new incremental cache with custom options
    pub fn with_options<P: AsRef<Path>>(workspace_root: P, options: CacheOptions) -> Result<Self> {
        let base_dir = workspace_root.as_ref().join(CACHE_DIR);
        std::fs::create_dir_all(&base_dir)?;

        // Load or create the index
        let index_path = base_dir.join("index.bin");
        let index = if index_path.exists() {
            Self::load_index(&index_path)?
        } else {
            CacheIndex {
                file_to_key: HashMap::new(),
                entries: HashMap::new(),
                stats: CacheStats::default(),
                version: CACHE_VERSION,
            }
        };

        // Initialize compressor
        let compressor = Compressor::new(3)?; // Level 3 compression

        Ok(Self {
            base_dir,
            index: Arc::new(RwLock::new(index)),
            memory_cache: Arc::new(DashMap::new()),
            fs_options: options,
            compressor: Arc::new(RwLock::new(compressor)),
        })
    }

    /// Get a cached entry for a file
    pub fn get(&self, file_path: &Path) -> Result<Option<CacheEntry>> {
        // Check memory cache first
        let key = self.get_cache_key(file_path)?;
        if let Some(entry) = self.memory_cache.get(&key) {
            return Ok(Some(entry.clone()));
        }

        // Check file system cache
        let cache_file = self.base_dir.join(&format!("{}.cache", key));
        if !cache_file.exists() {
            return Ok(None);
        }

        let data = std::fs::read(&cache_file)?;
        let entry: CacheEntry = bincode::deserialize(&data)?;

        // Check if entry is still valid
        if !self.is_entry_valid(file_path, &entry)? {
            // Remove invalid entry
            std::fs::remove_file(cache_file)?;
            return Ok(None);
        }

        // Add to memory cache if under limit
        if self.memory_cache.len() < self.fs_options.max_memory_entries {
            self.memory_cache.insert(key, entry.clone());
        }

        // Update statistics
        {
            let mut index = self.index.write();
            index.stats.hits += 1;
        }

        Ok(Some(entry))
    }

    /// Store a new cache entry
    pub fn put(&self, file_path: &Path, hir_data: &[u8], mir_data: &[u8], metadata: CacheMetadata) -> Result<()> {
        // Calculate file hash
        let file_content = std::fs::read(file_path)?;
        let file_hash = self.calculate_hash(&file_content);

        // Prepare cache entry
        let entry = CacheEntry {
            file_hash,
            created_at: current_timestamp(),
            hir_data: if self.fs_options.compress_data {
                self.compressor.write().compress(hir_data)?
            } else {
                hir_data.to_vec()
            },
            mir_data: if self.fs_options.compress_data {
                self.compressor.write().compress(mir_data)?
            } else {
                mir_data.to_vec()
            },
            metadata: metadata.clone(),
        };

        // Get the cache key for this file
        let key = self.get_cache_key(file_path)?;

        // Write to file system
        let cache_file = self.base_dir.join(format!("{}.cache", key));
        let serialized = bincode::serialize(&entry)?;
        std::fs::write(&cache_file, &serialized)?;

        // Update index
        {
            let mut index = self.index.write();
            index.file_to_key.insert(file_path.to_path_buf(), key.clone());
            index.entries.insert(key.clone(), metadata);
            index.stats.misses += 1;
            index.stats.size_bytes += serialized.len() as u64;
            index.stats.entry_count += 1;
        }

        // Add to memory cache
        self.memory_cache.insert(key, entry);

        // Cleanup old entries
        self.cleanup_old_entries()?;

        Ok(())
    }

    /// Invalidate cache for a specific file
    pub fn invalidate(&self, file_path: &Path) -> Result<()> {
        let key = self.get_cache_key(file_path)?;
        
        // Remove from memory cache
        self.memory_cache.remove(&key);
        
        // Remove from file system
        let cache_file = self.base_dir.join(format!("{}.cache", key));
        if cache_file.exists() {
            std::fs::remove_file(cache_file)?;
        }

        // Update index
        {
            let mut index = self.index.write();
            index.file_to_key.remove(file_path);
            if let Some(metadata) = index.entries.remove(&key) {
                // Update stats
                index.stats.size_bytes = index.stats.size_bytes.saturating_sub(metadata.file_size);
                index.stats.entry_count = index.stats.entry_count.saturating_sub(1);
            }
        }

        Ok(())
    }

    /// Clear all cache entries
    pub fn clear(&self) -> Result<()> {
        // Clear memory cache
        self.memory_cache.clear();

        // Remove all cache files
        for entry in std::fs::read_dir(&self.base_dir)? {
            let entry = entry?;
            if let Some(filename) = entry.file_name().to_str() {
                if filename.ends_with(".cache") || filename == "index.bin" {
                    std::fs::remove_file(entry.path())?;
                }
            }
        }

        // Reset index
        {
            let mut index = self.index.write();
            index.file_to_key.clear();
            index.entries.clear();
            index.stats = CacheStats::default();
        }

        Ok(())
    }

    /// Get cache statistics
    pub fn stats(&self) -> CacheStats {
        self.index.read().stats.clone()
    }

    /// Save the index to disk
    pub fn save_index(&self) -> Result<()> {
        let index = self.index.read();
        let serialized = bincode::serialize(&*index)?;
        std::fs::write(self.base_dir.join("index.bin"), serialized)?;
        Ok(())
    }

    // Private helper methods

    fn load_index<P: AsRef<Path>>(index_path: P) -> Result<CacheIndex> {
        let data = std::fs::read(index_path)?;
        let index: CacheIndex = bincode::deserialize(&data)?;
        
        // Check version compatibility
        if index.version != CACHE_VERSION {
            return Ok(CacheIndex {
                file_to_key: HashMap::new(),
                entries: HashMap::new(),
                stats: CacheStats::default(),
                version: CACHE_VERSION,
            });
        }

        Ok(index)
    }

    fn get_cache_key(&self, file_path: &Path) -> Result<String> {
        // Create a stable key based on file path
        let canonical_path = std::fs::canonicalize(file_path)?;
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        canonical_path.hash(&mut hasher);
        Ok(format!("{:016x}", hasher.finish()))
    }

    fn calculate_hash(&self, data: &[u8]) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        data.hash(&mut hasher);
        hasher.finish()
    }

    fn is_entry_valid(&self, file_path: &Path, entry: &CacheEntry) -> Result<bool> {
        // Check if file has changed
        let current_content = std::fs::read(file_path)?;
        let current_hash = self.calculate_hash(&current_content);
        
        if current_hash != entry.file_hash {
            return Ok(false);
        }

        // Check if entry is too old
        if self.fs_options.max_age_secs > 0 {
            let now = current_timestamp();
            if now - entry.created_at > self.fs_options.max_age_secs {
                return Ok(false);
            }
        }

        // Check if dependencies are newer
        for dep_path in &entry.metadata.dependencies {
            if !dep_path.exists() {
                return Ok(false);
            }
            
            let dep_mtime = file_mtime(dep_path)?;
            if dep_mtime > entry.created_at {
                return Ok(false);
            }
        }

        Ok(true)
    }

    fn cleanup_old_entries(&self) -> Result<()> {
        // Implement size-based cleanup if needed
        if self.fs_options.max_size_bytes > 0 {
            let stats = self.stats();
            if stats.size_bytes > self.fs_options.max_size_bytes {
                // Remove oldest entries until under limit
                // This is a simple implementation - could be LRU, etc.
                println!("Cache cleanup needed - implement LRU removal");
            }
        }
        Ok(())
    }
}

/// Helper functions

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn file_mtime(path: &Path) -> Result<u64> {
    let metadata = std::fs::metadata(path)?;
    let modified = metadata.modified()?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs::File, io::Write};
    use tempfile::TempDir;

    #[test]
    fn test_cache_basic_operations() -> Result<()> {
        let temp_dir = TempDir::new()?;
        let cache = IncrementalCache::new(temp_dir.path())?;

        // Create a test file
        let test_file = temp_dir.path().join("test.rs");
        let mut file = File::create(&test_file)?;
        file.write_all(b"fn main() {}")?;
        drop(file);

        // Test initial miss
        assert!(cache.get(&test_file)?.is_none());

        // Put an entry
        let metadata = CacheMetadata {
            rustc_version: "1.70.0".to_string(),
            dependencies: vec![],
            file_mtime: file_mtime(&test_file)?,
            analysis_duration_ms: 100,
            file_size: test_file.metadata()?.len(),
        };

        cache.put(&test_file, b"hir_data", b"mir_data", metadata)?;

        // Test hit
        let entry = cache.get(&test_file)?.unwrap();
        assert_eq!(entry.file_hash, cache.calculate_hash(b"fn main() {}"));

        // Test statistics
        let stats = cache.stats();
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 1);

        Ok(())
    }
}