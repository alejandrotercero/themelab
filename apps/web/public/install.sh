#!/usr/bin/env bash
#
# ThemeLab CLI installer.
#   curl -fsSL https://themelab.dev/install.sh | bash
#
# Downloads the prebuilt, self-contained binary for your platform (compiled with
# `bun build --compile`, so no Node/npm needed) and drops it on your PATH.
#
# Binaries are published as GitHub Release assets by .github/workflows/cli-binaries.yml.
#
# Env overrides:
#   THEMELAB_INSTALL_BASE   base URL to fetch binaries from
#   THEMELAB_INSTALL_DIR    install directory (default $HOME/.themelab/bin)

set -euo pipefail

REPO="${THEMELAB_REPO:-alejandrotercero/themelab}"
BASE_URL="${THEMELAB_INSTALL_BASE:-https://github.com/$REPO/releases/latest/download}"
INSTALL_DIR="${THEMELAB_INSTALL_DIR:-$HOME/.themelab/bin}"
EXE="$INSTALL_DIR/themelab"

# — pretty output (no-op when not a tty) ——————————————————————————————
if [ -t 1 ]; then
  Bold="$(printf '\033[1m')"; Dim="$(printf '\033[2m')"
  Green="$(printf '\033[32m')"; Red="$(printf '\033[31m')"; Reset="$(printf '\033[0m')"
else
  Bold=""; Dim=""; Green=""; Red=""; Reset=""
fi
info() { printf '%s\n' "$*"; }
success() { printf '%s%s%s\n' "$Green" "$*" "$Reset"; }
error() { printf '%serror%s: %s\n' "$Red" "$Reset" "$*" >&2; exit 1; }

# — detect platform —————————————————————————————————————————————————————
os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) error "unsupported OS '$os'. On Windows, download themelab-windows-x64.exe from $BASE_URL manually." ;;
esac

case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) error "unsupported architecture '$arch'." ;;
esac

target="themelab-${os}-${arch}"
url="$BASE_URL/$target"

# — download ————————————————————————————————————————————————————————————
command -v curl >/dev/null 2>&1 || error "curl is required but was not found."

info "${Bold}Installing ThemeLab${Reset} ${Dim}($target)${Reset}"
mkdir -p "$INSTALL_DIR"

if ! curl --fail --location --progress-bar --output "$EXE" "$url"; then
  error "failed to download $url — is the binary published for your platform?"
fi
chmod +x "$EXE"

success "Installed themelab → $EXE"

# — ensure it's on PATH ————————————————————————————————————————————————
add_path_line() {
  local profile="$1" line="$2"
  [ -f "$profile" ] || return 0
  grep -qsF "$line" "$profile" && return 0
  printf '\n# ThemeLab\n%s\n' "$line" >> "$profile"
  info "Added $INSTALL_DIR to PATH in ${Dim}$profile${Reset}"
}

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    : # already on PATH
    ;;
  *)
    sh_name="$(basename "${SHELL:-}")"
    case "$sh_name" in
      fish)
        fish_config="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
        mkdir -p "$(dirname "$fish_config")"
        add_path_line "$fish_config" "fish_add_path $INSTALL_DIR"
        ;;
      zsh)
        add_path_line "$HOME/.zshrc" "export PATH=\"$INSTALL_DIR:\$PATH\""
        ;;
      *)
        add_path_line "$HOME/.bashrc" "export PATH=\"$INSTALL_DIR:\$PATH\""
        add_path_line "$HOME/.profile" "export PATH=\"$INSTALL_DIR:\$PATH\""
        ;;
    esac
    info "${Dim}Restart your shell or run: export PATH=\"$INSTALL_DIR:\$PATH\"${Reset}"
    ;;
esac

info ""
success "Done. Run ${Bold}themelab${Reset}${Green} in your project to get started.${Reset}"
