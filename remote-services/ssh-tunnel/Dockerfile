FROM alpine:3.20

RUN apk add --no-cache openssh-client sshpass

COPY start-ssh.sh /start-ssh.sh
RUN chmod +x /start-ssh.sh

ENTRYPOINT ["/start-ssh.sh"]
