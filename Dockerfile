FROM node:alpine AS build

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN apk add --no-cache --virtual .gyp \
        python \
        make \
        g++ \
    && npm install \
    && apk del .gyp


FROM gcr.io/distroless/nodejs:16

COPY --from=build /usr/src/app /usr/src/app

WORKDIR /usr/src/app

CMD [ "npm", "run", "start" ]