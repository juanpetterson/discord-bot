FROM node:20.10.0-alpine

RUN apk --no-cache add --virtual .builds-deps build-base python3

WORKDIR /app

COPY package*.json ./

RUN npm install --production && npm rebuild bcrypt --build-from-source && npm cache clean --force 

COPY . .

RUN npm run build

EXPOSE 8080

CMD [ "npm", "run", "start" ]
