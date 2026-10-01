#!/usr/bin/env bash
# Build and test the Linux desktop app inside the byline-desktop-linux image.
# From the repository root:
#
#   docker build -t byline-desktop-linux desktop/linux
#   docker run --rm -v "$PWD:/src:ro" -v "$PWD/desktop/linux/out:/out" \
#     -v byline-cargo:/usr/local/cargo/registry -v byline-target:/target \
#     byline-desktop-linux bash /src/desktop/linux/run.sh
#
# The source is mounted read-only and copied in, so nothing built here lands
# in the Windows checkout except the bundles in desktop/linux/out.
set -euo pipefail

rsync -a /src/byline.html /src/byline-sw.js /work/
rsync -a --delete --exclude node_modules --exclude dist --exclude .signing --exclude .e2e \
  --exclude src-tauri/target --exclude src-tauri/gen --exclude linux/out /src/desktop/ /work/desktop/
cd /work/desktop
npm ci --no-audit --no-fund --loglevel=error

export CARGO_TARGET_DIR=/target APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true
npx tauri build --bundles deb,appimage

mkdir -p /out
rm -f /out/*.deb /out/*.AppImage
cp /target/release/bundle/deb/*.deb /target/release/bundle/appimage/*.AppImage /out/
ls -l /out

echo
echo "== the .deb, installed as a user would install it"
apt-get install -y -qq /out/*.deb >/dev/null
dpkg -L byline | grep -E 'bin/|\.desktop$'
xvfb-run -a -s "-screen 0 1280x900x24" node e2e/shell-webdriver.mjs "$(command -v byline-desktop)"

echo
echo "== the AppImage"
chmod +x /out/*.AppImage
xvfb-run -a -s "-screen 0 1280x900x24" node e2e/shell-webdriver.mjs "$(ls /out/*.AppImage)"
