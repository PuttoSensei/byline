# The Linux toolchain for the desktop shell: Tauri's build prerequisites, the
# WebKitGTK WebDriver and a virtual display for testing, Rust, Node.
# Ubuntu 22.04 on purpose: an AppImage runs on distributions with a glibc at
# least as new as the one it was built against, so build on an older one.
#
#   docker build -t byline-desktop-linux desktop/linux
#   see desktop/linux/run.sh for building and testing with it
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl wget file ca-certificates git pkg-config rsync xz-utils \
      libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
      webkit2gtk-driver xvfb xauth dbus-x11 at-spi2-core \
    && rm -rf /var/lib/apt/lists/*

ARG NODE_VERSION=22.20.0
RUN curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
      | tar -xJ -C /usr/local --strip-components=1

ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
    && cargo install tauri-driver --locked \
    && rm -rf /usr/local/cargo/registry

WORKDIR /work
