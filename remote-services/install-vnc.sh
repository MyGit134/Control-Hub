#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root: sudo $0"
  exit 1
fi

if [ -f /etc/os-release ]; then
  . /etc/os-release
else
  echo "Cannot detect OS (missing /etc/os-release)"
  exit 1
fi

install_pkg() {
  pkg="$1"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y "$pkg"
    return 0
  fi
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y "$pkg"
    return 0
  fi
  if command -v urpmi >/dev/null 2>&1; then
    urpmi --auto "$pkg"
    return 0
  fi
  echo "No supported package manager found (apt, dnf, urpmi)"
  exit 1
}

setup_x11vnc() {
  if ! command -v x11vnc >/dev/null 2>&1; then
    install_pkg x11vnc
  fi

  cat >/etc/systemd/system/rch-x11vnc.service <<'EOF'
[Unit]
Description=Remote Control Hub x11vnc
After=graphical.target

[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -display :0 -auth guess -forever -shared -rfbport 5900 -nopw
Restart=on-failure
RestartSec=2

[Install]
WantedBy=graphical.target
EOF

  systemctl daemon-reload
  systemctl enable rch-x11vnc.service
  systemctl restart rch-x11vnc.service
  systemctl status --no-pager rch-x11vnc.service || true
  echo "x11vnc installed and started. Port: 5900"
}

setup_wayvnc() {
  if ! command -v wayvnc >/dev/null 2>&1; then
    install_pkg wayvnc
  fi

  cat >/etc/systemd/system/rch-wayvnc.service <<'EOF'
[Unit]
Description=Remote Control Hub wayvnc
After=graphical.target

[Service]
Type=simple
ExecStart=/usr/bin/wayvnc 127.0.0.1 5900
Restart=on-failure
RestartSec=2

[Install]
WantedBy=graphical.target
EOF

  systemctl daemon-reload
  systemctl enable rch-wayvnc.service
  systemctl restart rch-wayvnc.service
  systemctl status --no-pager rch-wayvnc.service || true
  echo "wayvnc installed and started. Port: 5900"
}

session_type="${XDG_SESSION_TYPE:-}"
if [ -z "$session_type" ]; then
  if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    session_type="wayland"
  else
    session_type="x11"
  fi
fi

if [ "$session_type" = "wayland" ]; then
  echo "Wayland session detected. Installing wayvnc..."
  setup_wayvnc
else
  echo "X11 session detected. Installing x11vnc..."
  setup_x11vnc
fi
