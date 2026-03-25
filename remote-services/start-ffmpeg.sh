#!/bin/sh
set -eu

MEDIAMTX_HOST="${MEDIAMTX_HOST:-mediamtx}"
MEDIAMTX_PORT="${MEDIAMTX_PORT:-8554}"
RTSP_PATH="${RTSP_PATH:-cam}"

while true; do
  VIDEO_IN=""
  VIDEO_OPTS=""
  AUDIO_IN=""
  AUDIO_OPTS=""

  if [ -e /dev/video0 ]; then
    VIDEO_IN="-thread_queue_size 512 -f v4l2 -i /dev/video0"
    VIDEO_OPTS="-c:v libx264 -preset ultrafast -tune zerolatency"
  fi

  if [ -e /dev/snd ]; then
    AUDIO_IN="-thread_queue_size 512 -f alsa -i default"
    AUDIO_OPTS="-c:a libopus"
  fi

  if [ -z "$VIDEO_IN$AUDIO_IN" ]; then
    echo "No video/audio devices detected. Retrying in 10s..."
    sleep 10
    continue
  fi

  echo "Starting ffmpeg publisher..."
  ffmpeg $VIDEO_IN $AUDIO_IN $VIDEO_OPTS $AUDIO_OPTS -f rtsp \
    "rtsp://${MEDIAMTX_HOST}:${MEDIAMTX_PORT}/${RTSP_PATH}" || true
  echo "ffmpeg exited. Retrying in 5s..."
  sleep 5

done
