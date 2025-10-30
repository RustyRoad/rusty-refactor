use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
fn greet(name: String) -> String {
    format!("Hello from Rust, {}!", name)
}

#[napi]
fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// Placeholder for future compiler-integration functions
#[napi]
fn analyze_placeholder(path: String) -> String {
    // For now, just return the path back so TS can validate the bridge
    format!("analyzed: {}", path)
}
