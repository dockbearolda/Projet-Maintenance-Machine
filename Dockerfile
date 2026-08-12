# Site statique + serveur de partage : aucune étape de build, aucune dépendance
# à installer. On copie les fichiers, on lance Node, c'est tout.
FROM node:22-alpine

WORKDIR /srv
COPY server.js ./server.js
COPY index.html ./index.html
COPY assets ./assets

# Les données de l'atelier vivent sur le volume Railway monté ici, jamais dans
# l'image : un redéploiement ne doit rien effacer.
ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080

# On reste root : le volume Railway est monté au nom de root, un conteneur qui
# tourne sous « node » ne pourrait pas y écrire — et un partage qui n'écrit pas
# est pire qu'un partage absent.
CMD ["node", "server.js"]
