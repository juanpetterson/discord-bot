FROM node:16.15.0-alpine

RUN apk --no-cache add --virtual .builds-deps build-base python3

WORKDIR /app

COPY package*.json ./

RUN npm install --production && npm rebuild bcrypt --build-from-source && npm cache clean --force 

COPY . .

CMD [ "npm", "run", "start" ]
