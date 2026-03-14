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

pick_session() {
  if ! command -v loginctl >/dev/null 2>&1; then
    return 1
  fi

  sessions=$(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}')
  for sid in $sessions; do
    active=$(loginctl show-session "$sid" -p Active --value 2>/dev/null || true)
    if [ "$active" != "yes" ]; then
      continue
    fi
    stype=$(loginctl show-session "$sid" -p Type --value 2>/dev/null || true)
    suser=$(loginctl show-session "$sid" -p Name --value 2>/dev/null || true)
    suid=$(loginctl show-session "$sid" -p User --value 2>/dev/null || true)
    sdisp=$(loginctl show-session "$sid" -p Display --value 2>/dev/null || true)
    if [ -n "$suser" ] && [ -n "$stype" ]; then
      SESSION_TYPE="$stype"
      SESSION_USER="$suser"
      SESSION_UID="$suid"
      SESSION_DISPLAY="$sdisp"
      return 0
    fi
  done
  return 1
}

detect_display() {
  if [ -n "${SESSION_DISPLAY:-}" ]; then
    return 0
  fi
  if [ -d /tmp/.X11-unix ]; then
    sock=$(ls /tmp/.X11-unix/X* 2>/dev/null | head -n1 || true)
    if [ -n "$sock" ]; then
      num=$(basename "$sock" | sed 's/^X//')
      if [ -n "$num" ]; then
        SESSION_DISPLAY=":$num"
      fi
    fi
  fi
}

setup_x11vnc() {
  user="$1"
  uid="$2"
  display="$3"
  scale="${VNC_SCALE:-0.8}"

  if ! command -v x11vnc >/dev/null 2>&1; then
    install_pkg x11vnc
  fi

  xauth=""
  if [ -n "$uid" ] && [ -d "/run/user/$uid" ]; then
    for candidate in \
      "/run/user/$uid/gdm/Xauthority" \
      "/run/user/$uid/gdm3/Xauthority" \
      "/run/user/$uid/Xauthority" \
      "/run/user/$uid/.Xauthority" \
      "/run/user/$uid/.mutter-Xwaylandauth."* \
      "/home/$user/.Xauthority"
    do
      if [ -f "$candidate" ]; then
        xauth="$candidate"
        break
      fi
    done
  fi
  if [ -z "$xauth" ] && [ -f "/home/$user/.Xauthority" ]; then
    xauth="/home/$user/.Xauthority"
  fi

  cat >/etc/systemd/system/rch-x11vnc.service <<EOF
[Unit]
Description=Remote Control Hub x11vnc
After=graphical.target

[Service]
Type=simple
User=$user
Environment=DISPLAY=${display:-:0}
Environment=XAUTHORITY=${xauth}
ExecStart=/usr/bin/x11vnc -display ${display:-:0} ${xauth:+-auth ${xauth}} -forever -shared -rfbport 5900 -nopw -noxdamage -nowf -xkb -ncache 10 -wait 20 -scale ${scale}
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
  user="$1"
  uid="$2"

  if ! command -v wayvnc >/dev/null 2>&1; then
    install_pkg wayvnc
  fi

  if [ -z "$uid" ]; then
    echo "Cannot determine user UID for wayvnc"
    exit 1
  fi

  runtime_dir="/run/user/$uid"
  wl_display=""
  if [ -d "$runtime_dir" ]; then
    wl_display=$(ls "$runtime_dir"/wayland-* 2>/dev/null | head -n1 || true)
  fi
  if [ -n "$wl_display" ]; then
    wl_display=$(basename "$wl_display")
  else
    wl_display="wayland-0"
  fi

  user_dir="/home/$user/.config/systemd/user"
  mkdir -p "$user_dir"

  cat >"$user_dir/rch-wayvnc.service" <<EOF
[Unit]
Description=Remote Control Hub wayvnc
After=graphical.target

[Service]
Type=simple
Environment=WAYLAND_DISPLAY=$wl_display
Environment=XDG_RUNTIME_DIR=/run/user/%U
ExecStart=/usr/bin/wayvnc 127.0.0.1 5900
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

  chown -R "$user":"$user" "/home/$user/.config"

  loginctl enable-linger "$user" || true
  sudo -u "$user" XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user daemon-reload || true
  sudo -u "$user" XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user enable rch-wayvnc.service || true
  sudo -u "$user" XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user restart rch-wayvnc.service || true

  echo "wayvnc installed and started. Port: 5900"
}

SESSION_TYPE=""
SESSION_USER=""
SESSION_UID=""
SESSION_DISPLAY=""

pick_session || true
detect_display

if [ -z "$SESSION_USER" ]; then
  SESSION_USER=$(logname 2>/dev/null || true)
fi
if [ -z "$SESSION_UID" ] && [ -n "$SESSION_USER" ]; then
  SESSION_UID=$(id -u "$SESSION_USER" 2>/dev/null || true)
fi

force="${FORCE_VNC:-}"
if [ "$force" = "wayvnc" ]; then
  echo "FORCE_VNC=wayvnc set"
  setup_wayvnc "$SESSION_USER" "$SESSION_UID"
  exit 0
fi
if [ "$force" = "x11vnc" ]; then
  echo "FORCE_VNC=x11vnc set"
  setup_x11vnc "$SESSION_USER" "$SESSION_UID" "$SESSION_DISPLAY"
  exit 0
fi

if [ "${SESSION_TYPE:-}" = "wayland" ]; then
  echo "Wayland session detected. Installing wayvnc..."
  setup_wayvnc "$SESSION_USER" "$SESSION_UID"
else
  echo "X11 session detected (or unknown). Installing x11vnc..."
  setup_x11vnc "$SESSION_USER" "$SESSION_UID" "$SESSION_DISPLAY"
fi

if command -v ss >/dev/null 2>&1; then
  ss -tlnp | grep ':5900' || true
fi
