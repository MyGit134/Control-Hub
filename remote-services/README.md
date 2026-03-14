# Remote Services Bundle

Этот набор запускается **на управляемой Linux‑машине** (Kali/Rosa и т.д.). Он даёт (модули включаются отдельно):

- Desktop (виртуальный): `webtop` (браузерный рабочий стол)
- Desktop (реальный GUI): noVNC + VNC‑сервер на хосте
- Camera/Mic: MediaMTX + FFmpeg публикация в RTSP

## Запуск

Все сервисы теперь опциональны и запускаются через профили.

```bash
# Виртуальный рабочий стол (webtop)
docker compose --profile desktop-webtop up -d

# Камера/микрофон
docker compose --profile camera up -d

# Реальный GUI через noVNC (нужен VNC сервер на хосте)
docker compose --profile desktop-real up -d
```

## Что получится

### Desktop
Контейнер `webtop` слушает порт `3000` (HTTP). Его удобно подключать как сервис `Desktop`.

### Desktop (Real GUI)
noVNC слушает порт `6080` и проксирует VNC‑сервер хоста.
По умолчанию ожидается VNC на `127.0.0.1:5900` на самой машине.
`desktop-real` теперь собирается локально из `remote-services/novnc/`, логин в `ghcr.io` не нужен.

#### Автоматическая установка VNC (x11vnc/wayvnc)
Запусти один раз на управляемой машине:

```bash
sudo ./install-vnc.sh
```

Скрипт:
- определит тип сессии (X11/Wayland),
- установит `x11vnc` или `wayvnc` (apt/dnf/urpmi),
- создаст systemd‑сервис,
- включит автозапуск,
- стартует VNC на порту `5900`.

Если авто‑детект ошибся, можно явно указать:

```bash
sudo FORCE_VNC=wayvnc ./install-vnc.sh
# или
sudo FORCE_VNC=x11vnc ./install-vnc.sh
```

После установки можно проверить порт:

```bash
ss -tlnp | grep 5900
```

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
- В compose для ffmpeg используется `privileged: true` и монтируется `/dev`, чтобы контейнер не падал при отсутствии устройств.

## Реальный GUI: установка VNC на хосте (пример X11)

```bash
sudo apt update
sudo apt install -y x11vnc
sudo x11vnc -display :0 -forever -shared -rfbport 5900 -nopw
```

Если используется Wayland, вместо x11vnc обычно применяют `gnome-remote-desktop` (RDP) или `wayvnc`.

## Как добавить в панель

В UI (вкладка **Сервисы**) для нужной машины:

- Desktop
  - `protocol`: `http`
  - `target_host`: `127.0.0.1`
  - `target_port`: `3000`
  - `target_path`: `/`

- Desktop (Real GUI via noVNC)
  - `protocol`: `http`
  - `target_host`: `127.0.0.1`
  - `target_port`: `6080`
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

