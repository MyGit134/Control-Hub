#!/bin/sh
set -eu

VNC_SERVER="${VNC_SERVER:-127.0.0.1:5900}"
WEB_PORT="${WEB_PORT:-6080}"

if [ ! -x /usr/share/novnc/utils/novnc_proxy ]; then
  echo "novnc_proxy not found"
  exit 1
fi

/usr/share/novnc/utils/novnc_proxy --vnc "$VNC_SERVER" --listen "$WEB_PORT" --web /usr/share/novnc
