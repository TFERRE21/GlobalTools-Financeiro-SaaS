FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./server.js
COPY public ./public
ENV NODE_ENV=production
ENV PORT=3015
EXPOSE 3015
USER node
CMD ["npm","start"]
