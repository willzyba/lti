# fxEditor's LTI 1.3 tool, as served at https://lti.codecogs.com (docker-swarm/docker-fxlti.yml).
# Plain HTTP on :3000; fxnginx in front terminates TLS.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src src
COPY views views

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
