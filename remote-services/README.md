# Remote Services Bundle

Этот набор запускается **на управляемой Linux‑машине** (Kali/Rosa и т.д.). Он даёт:

- Desktop: `webtop` (браузерный рабочий стол)
- Camera/Mic: MediaMTX + FFmpeg публикация в RTSP

## Запуск

```bash
docker compose up -d
```

## Что получится

### Desktop
Контейнер `webtop` слушает порт `3000` (HTTP). Его удобно подключать как сервис `Desktop`.

### Camera + Mic
FFmpeg забирает видео из `/dev/video0` и аудио из ALSA `default`, публикует поток в MediaMTX:

```
rtsp://127.0.0.1:8554/cam
```

MediaMTX раздаёт HLS и WebRTC через порты `8888` и `8889`.

## Настройка устройств

- Если камера на другом устройстве, замените `/dev/video0`.
- Если микрофон не `default`, укажите нужный ALSA‑input.
- Контейнер с публикацией FFmpeg теперь в цикле и не падает, если устройства временно отсутствуют.

## Как добавить в панель

В UI (вкладка **Сервисы**) для нужной машины:

- Desktop
  - `protocol`: `http`
  - `target_host`: `127.0.0.1`
  - `target_port`: `3000`
  - `target_path`: `/`

- Camera/Mic (WebRTC)
  - `protocol`: `http`
  - `target_host`: `127.0.0.1`
  - `target_port`: `8889`
  - `target_path`: `/cam`

- Camera/Mic (HLS)
  - `protocol`: `http`
  - `target_host`: `127.0.0.1`
  - `target_port`: `8888`
  - `target_path`: `/cam`

