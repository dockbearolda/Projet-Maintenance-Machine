# Site statique : aucune étape de build, on copie les fichiers derrière Caddy.
FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html /srv/index.html
COPY assets /srv/assets

EXPOSE 80
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
