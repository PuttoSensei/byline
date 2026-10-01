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

`npm run build` makes `src-tauri/target/release/byline-desktop.exe`, unsigned,
for testing. `npm run test:e2e` starts that executable with a throwaway
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

## The installer, and signing it

```bash
npm run installer
```

makes `src-tauri/target/release/bundle/nsis/Byline_<version>_x64-setup.exe`, a
per-user installer: no administrator, installed under the user's profile,
listed in Installed apps, and removable there.

Every file it signs goes through `scripts/sign.mjs`: the app, the uninstaller,
an NSIS plugin, and the installer itself. **The build refuses to finish
without a certificate**, so an unsigned installer cannot come out by accident:

| Set | For |
| --- | --- |
| `BYLINE_SIGN_THUMBPRINT` | a certificate in the Windows store, including one on a hardware token |
| `BYLINE_SIGN_PFX`, `BYLINE_SIGN_PFX_PASSWORD` | a certificate file |
| `BYLINE_SIGN_TIMESTAMP` | a timestamp server (your certificate authority names one). Use it for any release, or the signature stops verifying when the certificate expires |
| `BYLINE_UNSIGNED=1` | build unsigned on purpose |

It needs `signtool.exe` from the Windows SDK (found automatically, or set
`BYLINE_SIGNTOOL`). Tauri signs the app only inside the bundle, and leaves
`target/release/byline-desktop.exe` unsigned.

`npm run test:installer` proves the pipeline without a real certificate:

1. It makes a throwaway self-signed certificate in `.signing/` (ignored by
   git, never added to any Windows certificate store, valid 30 days) and
   builds with it.
2. It checks that the installer is signed by it, that one changed byte breaks
   the signature, and that the check can tell this signature from another.
3. It installs silently into a temporary folder and checks that the installed
   app and uninstaller are signed, and that the app is listed with a Start
   menu shortcut.
4. It runs the whole desktop e2e above against the installed app.
5. It uninstalls, then checks that the program, its registry entry and its
   shortcuts are gone, and that no profile was left behind.

It refuses to run if Byline is already installed for the user.

**A test-signed installer is still from an "Unknown publisher".** Nothing
trusts the test certificate, so to Windows it is no better than unsigned.
Removing that warning takes a code-signing certificate from a certificate
authority. That means an identity check, a fee, and today a private key held
on a hardware token or in a cloud signing service. SmartScreen can still warn
for a while after that, until the signed installer builds a download
reputation. A store or token certificate works with `BYLINE_SIGN_THUMBPRINT`
as it is. A cloud signing service would need its own branch in
`scripts/sign.mjs`.

## Linux

Built and tested in Docker, so any machine with Docker can do it. From the
repository root:

```bash
docker build -t byline-desktop-linux desktop/linux
docker run --rm -v "$PWD:/src:ro" -v "$PWD/desktop/linux/out:/out" -v byline-cargo:/usr/local/cargo/registry -v byline-target:/target byline-desktop-linux bash /src/desktop/linux/run.sh
```

That builds `Byline_<version>_amd64.deb` and `Byline_<version>_amd64.AppImage`
into `desktop/linux/out/`, on Ubuntu 22.04 so the AppImage runs on newer
distributions too. It then installs the `.deb` and runs `e2e/shell-webdriver.mjs`
against it and against the AppImage. That e2e makes the Windows checks over
WebDriver (`tauri-driver`), because WebKitGTK has no DevTools protocol. The
origin is `tauri://localhost`, a secure context with WebCrypto.

`desktop/linux/smoke.sh` then starts each package somewhere that has never
seen it:

- the `.deb` on a clean Ubuntu 24.04, where apt resolves its dependencies;
- the AppImage on a clean Debian 12 with only the graphics, X11, Wayland and
  font libraries every desktop has. No GTK and no WebKit: the AppImage brings
  its own.

Each must still be running after 20 seconds and must have drawn its page. A
live but blank window fails; the check counts the colours in a screenshot.
Without Mesa's `libGLESv2`, the AppImage ran and drew nothing. Any real desktop
has `libGLESv2`; a bare container does not.

## macOS

There is no Mac here, so `.github/workflows/desktop.yml` builds on GitHub's
macOS runners. It makes a universal `.app` (Apple silicon and Intel) and a
`.dmg`, checks the bundle and its signature, launches the app and photographs
the window. It also runs the whole in-page suite in Safari
(`e2e/safari-suite.mjs`). The Mac window is WKWebView, Safari's engine, and
WKWebView inside an app cannot be driven by WebDriver. The same workflow
repeats the Linux build.

The app is ad-hoc signed only. Without an Apple Developer ID and
notarization, macOS refuses to open it until the user allows it in Privacy &
Security.

## Not done yet

- No trusted signature: see above. No auto-update.
- Linux was tested in containers under a virtual display, not on a real
  desktop session (GNOME, KDE, Wayland). Only x86-64 was built.
- macOS has not been seen yet: the workflow above has to run first.
- The service worker is staged but not relied on: the app has no offline mode
  beyond what the page already does.
