# Remote Control Hub

Цель: веб‑панель для управления собственными Linux‑машинами через reverse SSH‑туннели. Внутри есть:
- SSH терминал (в браузере)
- SFTP файловый менеджер
- Массовое выполнение команд
- Виджеты сервисов (Desktop/Camera/Mic) через прокси
- Админка с токенами регистрации и управлением пользователями

## Быстрый старт (локально)

1) Сервер

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

2) Откройте в браузере

```text
http://localhost:8080
```

3) Первый вход

При первом запуске, если пользователей нет, создаётся админ из переменных:
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

## Docker на VPS

```bash
cp server/.env.example server/.env
# отредактируйте server/.env

docker compose up -d --build
```

## Reverse SSH‑туннели

На каждой машине поднимается обратный туннель на VPS:

```bash
ssh -N -R 2201:localhost:22 vps-user@your-vps
```

После этого в панели машину можно добавить как:
- `ssh_host`: `127.0.0.1`
- `ssh_port`: `2201`

## Готовый набор сервисов (Desktop/Camera/Mic)

В папке `remote-services/` лежит Docker‑набор, который запускается на управляемой машине.
Подробные шаги — в `remote-services/README.md`.

## Безопасность

- SSH ключи/пароли в БД шифруются AES‑256‑GCM.
- Используйте уникальный `DATA_ENC_KEY` (32 байта в base64).
- Закройте доступ к VPS фаерволом и используйте HTTPS.

## Структура

- `server/` — backend (Express + WebSocket + SQLite)
- `web/` — статический SPA интерфейс
- `remote-services/` — сервисы для управляемых машин
