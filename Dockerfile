FROM node:22-alpine
RUN apk add --no-cache curl tar gzip
WORKDIR /app
RUN npm install -g pnpm
COPY package*.json ./
RUN pnpm install
COPY . .
RUN pnpm run build
EXPOSE 8080
CMD ["pnpm", "run", "start"]
