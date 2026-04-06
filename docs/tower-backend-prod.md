# Tower Backend For Flight Deck

This is the Flight Deck-side deployment note for the SuperBased Tower backend.

Flight Deck itself is not intended to run in Docker for local development. The Docker commands below are for `wingman-tower`, which Flight Deck connects to.

## Required Tower env

Minimum runtime env for Tower:

```env
SUPERBASED_DIRECT_HTTPS_URL=https://sb4.otherstuff.studio
ADMIN_NPUB=npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy
SUPERBASED_SERVICE_NSEC=nsec1...ff

STORAGE_S3_ENDPOINT=http://host.docker.internal:9000
STORAGE_S3_ENDPOINT_PUBLIC=https://storage.otherstuff.ai
STORAGE_S3_ACCESS_KEY=superbased
STORAGE_S3_SECRET_KEY=superbased-secret
STORAGE_S3_BUCKET=superbased-storage

DB_HOST=postgres
DB_PORT=5432
DB_NAME=coworker_v4
DB_USER=postgres
DB_PASSWORD=change-me
```

Recommended extras:

```env
TOWER_PORT=3100
TOWER_HOST_PORT=3100
STORAGE_S3_REGION=us-east-1
STORAGE_S3_FORCE_PATH_STYLE=true
STORAGE_PRESIGN_UPLOAD_TTL_SECONDS=900
STORAGE_PRESIGN_DOWNLOAD_TTL_SECONDS=900
DB_MAX_CONNECTIONS=10
DB_WAIT_MAX_ATTEMPTS=40
```

Important container note:

- `STORAGE_S3_ENDPOINT=http://127.0.0.1:9000` is only correct if Tower uses the host network.
- In the provided Docker Compose setup, use `http://host.docker.internal:9000` so the Tower container can reach MinIO running on the Docker host.

## Preferred Docker command

Use the Tower compose stack:

```bash
cd /Users/mini/code/wingmanbefree/wingman-tower
cp .env.prod.example .env.prod
# edit .env.prod
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

That starts:

- `wingman-tower-postgres`
- `wingman-tower-b3`

Update deploy:

```bash
cd /Users/mini/code/wingmanbefree/wingman-tower
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Stop:

```bash
cd /Users/mini/code/wingmanbefree/wingman-tower
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

## Health check

```bash
curl http://127.0.0.1:3100/health
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f tower
```

## Admin web and connection token

Open:

- `https://<your-tower-domain>/table-viewer`

Use a browser Nostr extension logged in as `ADMIN_NPUB`, then click `Connect with Nostr`.

The admin page now supports:

- table inspection
- workspace listing
- connection-token generation for a selected workspace and app `npub`

To generate a token for Flight Deck/Yoke:

1. Open `/table-viewer`
2. Connect as `ADMIN_NPUB`
3. Select the workspace
4. Enter the app `npub`
5. Click `Generate Token`

The generated token can be used directly with Yoke:

```bash
cd /Users/mini/code/wingmanbefree/wingman-yoke
node src/cli.js init --token "<connection_token>"
```

## Source of truth

The full Tower-side deployment note lives in:

- `/Users/mini/code/wingmanbefree/wingman-tower/docs/prod-deploy.md`
