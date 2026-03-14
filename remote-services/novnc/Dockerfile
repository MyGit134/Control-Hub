FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y novnc websockify procps \
  && rm -rf /var/lib/apt/lists/*

ENV VNC_SERVER=127.0.0.1:5900
ENV WEB_PORT=6080

COPY start-novnc.sh /start-novnc.sh
RUN chmod +x /start-novnc.sh

EXPOSE 6080

CMD ["/start-novnc.sh"]
