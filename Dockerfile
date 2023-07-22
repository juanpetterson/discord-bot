FROM node:16.15.0

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./

RUN apk add --no-cache --virtual .gyp \
        python \
        make \
        g++ \
    && npm install \
    && apk del .gyp

COPY . .

CMD [ "npm", "run", "start" ]