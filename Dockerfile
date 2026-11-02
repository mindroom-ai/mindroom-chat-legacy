## Builder
FROM --platform=$BUILDPLATFORM node:24.13.1-alpine AS builder

WORKDIR /src

COPY .npmrc package.json package-lock.json /src/
# The patch-package postinstall needs the patches before dependencies install.
COPY patches /src/patches
RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY . /src/
ENV NODE_OPTIONS=--max_old_space_size=4096
ARG APP_BUILD_BASE_PATH
ENV APP_BUILD_BASE_PATH=${APP_BUILD_BASE_PATH}
ARG MINDROOM_BUILD_VERSION
ENV MINDROOM_BUILD_VERSION=${MINDROOM_BUILD_VERSION}
ARG MINDROOM_RELEASE_VERSION
ENV MINDROOM_RELEASE_VERSION=${MINDROOM_RELEASE_VERSION}
RUN npm run build


## App
FROM nginx:1.31.2-alpine

COPY --from=builder /src/dist /app
COPY --from=builder /src/dist/runtime-config.js /opt/mindroom/runtime-config.js
# Operators replace this empty list by mounting a directory here (README, Notices).
COPY --from=builder /src/dist/notices.json /opt/mindroom/notices/notices.json
COPY --from=builder /src/docker-nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/99-runtime-config.sh /docker-entrypoint.d/99-runtime-config.sh

RUN rm -rf /usr/share/nginx/html \
  && ln -s /app /usr/share/nginx/html
