FROM node:20-slim

# Claude CLI 설치
RUN npm install -g @anthropic-ai/claude-code typescript

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

RUN mkdir -p /root/projects

CMD ["node", "dist/index.js"]
