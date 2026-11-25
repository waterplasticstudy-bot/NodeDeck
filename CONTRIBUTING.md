# Contributing to NodeDeck

Thank you for your interest in contributing to **NodeDeck**!

## Development Prerequisites
- **Windows 10 / 11** (WebView2 Runtime pre-installed on Windows 11)
- **Rust** (stable MSVC toolchain) & **Visual Studio C++ Build Tools**
- **Node.js 20+** (for static contract & privacy check scripts only; runtime has zero Node dependency)

## Coding Standards
1. **Zero Dead Code**: `src-tauri/src/lib.rs` enforces `#![deny(dead_code, unused_imports)]`. Always run `cargo clippy --all-targets -- -D warnings`.
2. **Design Tokens First**: Keep UI styling inside `src/styles/{tokens,layout,components}.css` and avoid native `alert()` / `confirm()` / `prompt()`.
3. **Privacy Guard**: Never commit `config.json`, private keys, or personal server screenshots. Always run `node scripts/privacy-check.mjs` before opening a Pull Request.
4. **Security Boundaries**: NodeDeck must never expose local HTTP ports or persist user website/SSH passwords in plain text.
