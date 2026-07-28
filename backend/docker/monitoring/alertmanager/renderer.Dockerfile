FROM alpine:3.22

RUN apk add --no-cache gettext

COPY render-config.sh /usr/local/bin/render-alertmanager-config
RUN chmod 0755 /usr/local/bin/render-alertmanager-config

ENTRYPOINT ["/usr/local/bin/render-alertmanager-config"]
