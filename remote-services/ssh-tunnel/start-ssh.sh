#!/usr/bin/env sh
set -eu

if [ -z "${SSH_HOST:-}" ] || [ -z "${SSH_USER:-}" ]; then
  echo "Missing SSH_HOST or SSH_USER."
  exit 1
fi

if [ -z "${TUNNEL_PORTS:-}" ]; then
  echo "Missing TUNNEL_PORTS (example: 6080:6080,3000:3000,8888:8888)."
  exit 1
fi

SSH_PORT="${SSH_PORT:-22}"
LOCAL_HOST="${LOCAL_HOST:-127.0.0.1}"
REMOTE_BIND_HOST="${REMOTE_BIND_HOST:-127.0.0.1}"

build_tunnels() {
  pairs="$1"
  opts=""
  oldifs="$IFS"
  IFS=', '
  for pair in $pairs; do
    [ -z "$pair" ] && continue
    remote="${pair%%:*}"
    local="${pair##*:}"
    if [ -z "$remote" ] || [ -z "$local" ]; then
      echo "Invalid TUNNEL_PORTS entry: $pair"
      exit 1
    fi
    opts="$opts -R ${REMOTE_BIND_HOST}:${remote}:${LOCAL_HOST}:${local}"
  done
  IFS="$oldifs"
  echo "$opts"
}

TUNNEL_OPTS="$(build_tunnels "$TUNNEL_PORTS")"

BASE_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -p ${SSH_PORT} -N -T"

run_ssh() {
  if [ -n "${SSH_PASSWORD:-}" ]; then
    export SSHPASS="$SSH_PASSWORD"
    # shellcheck disable=SC2086
    sshpass -e ssh ${BASE_OPTS} ${TUNNEL_OPTS} "${SSH_USER}@${SSH_HOST}"
  else
    key_opt=""
    if [ -f /ssh/id_rsa ]; then
      key_opt="-i /ssh/id_rsa"
    fi
    # shellcheck disable=SC2086
    ssh ${BASE_OPTS} ${key_opt} ${TUNNEL_OPTS} "${SSH_USER}@${SSH_HOST}"
  fi
}

echo "Starting reverse SSH tunnels to ${SSH_USER}@${SSH_HOST}:${SSH_PORT}"
echo "Tunnels: ${TUNNEL_PORTS}"

while true; do
  run_ssh || true
  sleep 3
done
