FROM node:22-alpine AS build

RUN apk add --no-cache openjdk11

WORKDIR /app

COPY package.json ./

RUN npm install --frozen-lockfile --online || npm install --frozen-lockfile

COPY . .

RUN npm run build:dev

FROM nginx:alpine

COPY default.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]