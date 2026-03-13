#!/bin/sh
set -eu

while true; do
  VIDEO_IN=""
  VIDEO_OPTS=""
  AUDIO_IN=""
  AUDIO_OPTS=""

  if [ -e /dev/video0 ]; then
    VIDEO_IN="-f v4l2 -i /dev/video0"
    VIDEO_OPTS="-c:v libx264 -preset ultrafast -tune zerolatency"
  fi

  if [ -e /dev/snd ]; then
    AUDIO_IN="-f alsa -i default"
    AUDIO_OPTS="-c:a opus"
  fi

  if [ -z "$VIDEO_IN$AUDIO_IN" ]; then
    echo "No video/audio devices detected. Retrying in 10s..."
    sleep 10
    continue
  fi

  echo "Starting ffmpeg publisher..."
  ffmpeg $VIDEO_IN $AUDIO_IN $VIDEO_OPTS $AUDIO_OPTS -f rtsp rtsp://mediamtx:8554/cam || true
  echo "ffmpeg exited. Retrying in 5s..."
  sleep 5

done
