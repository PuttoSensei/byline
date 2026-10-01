#!/usr/bin/env bash
# Does a package start on a machine that has never seen it? Run in a clean
# distribution image, with the bundles from run.sh mounted at /out:
#
#   docker run --rm -v "$PWD/desktop/linux:/linux:ro" -v "$PWD/desktop/linux/out:/out" ubuntu:24.04 bash /linux/smoke.sh deb
#   docker run --rm -v "$PWD/desktop/linux:/linux:ro" -v "$PWD/desktop/linux/out:/out" debian:12    bash /linux/smoke.sh appimage
#
# "deb" installs the .deb with apt, so its declared dependencies are what gets
# tested. "appimage" installs nothing but a display. Either way the app must
# still be running after 20 seconds, and a screenshot of the window is kept.
set -euo pipefail
kind="$1"
distro="$(. /etc/os-release && echo "$ID-$VERSION_ID")"
export DEBIAN_FRONTEND=noninteractive APPIMAGE_EXTRACT_AND_RUN=1
apt-get update -qq
apt-get install -y -qq --no-install-recommends xvfb xauth x11-apps netpbm >/dev/null

if [ "$kind" = deb ]; then
  apt-get install -y -qq --no-install-recommends /out/*.deb >/dev/null
  app="$(command -v byline-desktop)"
else
  # An AppImage bundles GTK and WebKit but, by design, not the graphics, X11,
  # Wayland and font libraries every desktop already has. A bare container
  # lacks them, so give it that layer and nothing more: no GTK, no WebKit.
  apt-get install -y -qq --no-install-recommends libegl1 libgl1 libgbm1 libdrm2 libx11-6 libx11-xcb1 libxcb1 \
    libwayland-client0 libgles2 libfontconfig1 libfreetype6 libfribidi0 libharfbuzz0b libexpat1 >/dev/null
  if dpkg -l | grep -qE '^ii +(libgtk-3-0|libwebkit2gtk)'; then echo "FAIL: the baseline pulled in GTK or WebKit"; exit 1; fi
  cp /out/*.AppImage /tmp/byline.AppImage && chmod +x /tmp/byline.AppImage
  app=/tmp/byline.AppImage
fi

Xvfb :7 -screen 0 1280x860x24 >/dev/null 2>&1 & sleep 1
export DISPLAY=:7 HOME=/tmp/home XDG_DATA_HOME=/tmp/home/data && mkdir -p "$HOME"
"$app" >/tmp/app.log 2>&1 & pid=$!
sleep 20
if kill -0 "$pid" 2>/dev/null; then
  xwd -root -silent | xwdtopnm 2>/dev/null > /tmp/shot.ppm
  pnmtopng < /tmp/shot.ppm > "/out/smoke-$kind-$distro.png"
  # Running is not rendering: a live window can be blank. Byline's first screen
  # has gradients and text, so it shows hundreds of colours; a blank one, one.
  colours=$(ppmhist -noheader /tmp/shot.ppm | wc -l)
  if [ "$colours" -gt 50 ]; then
    echo "OK: $kind is running on $distro after 20s and drew its page ($colours colours); /out/smoke-$kind-$distro.png"; status=0
  else
    echo "FAIL: $kind is running on $distro but its window is blank ($colours colours); /out/smoke-$kind-$distro.png"; status=1
  fi
  kill "$pid"
else
  echo "FAIL: $kind exited on $distro"; status=1
fi
echo "--- what it printed"; head -c 3000 /tmp/app.log
exit $status
