# Byline desktop

A window for `byline.html`, and nothing more.

The page on the web and the page in this app are the same bytes. The build
copies the repository's `byline.html` into the app unchanged, and refuses to
build if its security policy's script hash is stale. The app does not add
features, a background service, a tray icon, or any API the page can call.

## What it changes, and why it exists

Opened straight from disk, a browser gives every local HTML file one shared
storage area (Chrome) or none that lasts (Firefox's `null` origin). Byline
detects this and shows a banner, because a key kept there is readable by any
other file you open. The desktop app serves the page from its own origin, so
its keys and record have storage of their own, kept in the app's profile and
seen by nothing else.

## When it runs

**Byline runs while this window is open, and not otherwise.** Closing the
window stops it. It does not start at login, keep a process in the background,
or answer anything while the machine is asleep or shut. Anything that depends
on it, such as a correspondent a peer is waiting on, is unavailable whenever
the window is closed, and nothing here should be described otherwise.

## Build and test

Needs Node 20+, Rust (stable) and, on Windows, WebView2 (present on Windows 11).

```bash
npm install
npm run build
npm run test:e2e
```

`npm run build` makes `src-tauri/target/release/byline-desktop.exe` (no
installer yet). `npm run test:e2e` starts that executable with a throwaway
profile, attaches to its WebView2 over the DevTools protocol, and checks:

- the page is served from the app's origin, not `file://`, and is
  byte-identical to the repository's `byline.html`;
- the page's own hash-only Content-Security-Policy is the one in force, and
  nothing violates it on load;
- the page gets no Tauri API, and a call into the shell is refused;
- Byline's own storage check sees unshared storage, so no warning banner;
- the full in-page test suite passes inside the desktop window;
- what the page stores survives closing and restarting the app, and a
  different profile does not see it.

The test is Windows-only, because it attaches to WebView2.

## Three settings that must stay as they are

`python e2e/mutants.py` changes each of these, rebuilds, and checks that the
e2e fails. All three are caught.

- `app.withGlobalTauri: false`. Otherwise the page gets `window.__TAURI__`.
- `app.security.csp: null`. Given a policy, Tauri rewrites the page: it adds
  nonces and its own policy. The page is then no longer the repository's bytes,
  its inline styles are blocked, and one in-page test fails.
- No `src-tauri/capabilities/`. Granting even `core:default` lets the page call
  into the app (`plugin:app|version` answered).

## Not done yet

- No installer, code signing or auto-update. The executable is unsigned, so
  Windows SmartScreen will warn on another machine.
- Only Windows has been built and tested. macOS and Linux (WKWebView,
  WebKitGTK) have not been tried.
- The service worker is staged but not relied on: the app has no offline mode
  beyond what the page already does.
