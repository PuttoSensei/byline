// Byline in its own window.
//
// This shell does one thing: it serves the same byline.html from an origin of
// its own, so the page no longer runs as a file:// page. In Chrome and Edge
// every local HTML file shares one storage area, which put an unlocked
// masthead's private keys within reach of the next HTML file anyone opened.
// Here the storage belongs to this app alone.
//
// It deliberately does nothing else yet. The page is granted no Tauri
// capabilities (there is no capabilities/ folder), and the security policy is
// left to the one byline.html already carries: Tauri is told not to rewrite it
// ("csp": null), because a rewritten policy would change the bytes its hash
// covers. The e2e test checks both, and runs the whole smoke suite in here.
//
// It runs while this window is open, and not otherwise. Nothing it starts may
// be described as running when the machine is closed.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Byline could not start its window");
}
