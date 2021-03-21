FROM node:15.4.0-alpine

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install


COPY . .

CMD [ "npm", "run", "start" ]
