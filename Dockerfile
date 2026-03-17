FROM oven/bun:1.2 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ARG VITE_DEFAULT_SUPERBASED_URL=http://localhost:3100
ARG VITE_COWORKER_APP_NPUB=npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy

ENV VITE_DEFAULT_SUPERBASED_URL=${VITE_DEFAULT_SUPERBASED_URL}
ENV VITE_COWORKER_APP_NPUB=${VITE_COWORKER_APP_NPUB}

RUN bun run build

FROM nginx:stable

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
