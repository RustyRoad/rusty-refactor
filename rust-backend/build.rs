use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    // Tell Cargo to rerun this script if any of these files change
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=Cargo.toml");
    
    // Set up N-API bindings
    napi_build::setup();
    
    // Check if we're building with rust-src
    let rustc = env::var("RUSTC").unwrap_or_else(|_| "rustc".to_string());
    let output = Command::new(&rustc)
        .args(&["--print", "sysroot"])
        .output()
        .expect("Failed to get rustc sysroot");
    
    let sysroot = String::from_utf8(output.stdout).unwrap().trim().to_string();
    let rust_src_path = PathBuf::from(&sysroot).join("lib/rustlib/src/rust");
    
    if rust_src_path.exists() {
        println!("cargo:rustc-env=RUST_SRC_PATH={}", rust_src_path.display());
        println!("Found rust-src at: {}", rust_src_path.display());
    } else {
        println!("cargo:warning=rust-src component not found. Install with: rustup component add rust-src");
        println!("cargo:warning=Internal compiler crates will not be available");
    }
}
