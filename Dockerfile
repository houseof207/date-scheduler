FROM node:lts-slim
WORKDIR /app

COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

# Pre-created so a named volume mounted here inherits node ownership.
RUN mkdir data && chown node:node data
USER node

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
