# kinopio-selfhost

`kinopio-selfhost` is a self-host-focused Kinopio build for a single admin user. It keeps the existing Kinopio client and editing model, replaces hosted persistence with a local SQLite-backed server, stores uploads locally, and removes the hosted-only product surface.

This is not a rewrite. It is a trimmed self-host adaptation of the original app, packaged to run as a standalone Docker deployment.

## License

This repository includes code derived from Kinopio and remains under the original noncommercial license:

- [LICENSE.md](./LICENSE.md)
- [NOTICE.md](./NOTICE.md)

Important:

- Public redistribution is allowed only under the included PolyForm Noncommercial terms.
- Commercial use is not allowed under this license.
- Keep the license and notice files with any redistribution.
- This is an unofficial self-host-focused derivative, not the official hosted Kinopio service.

## What It Includes

- Spaces, cards, boxes, connections, lists, lines, drawing strokes, tags
- Single-admin sign-in
- SQLite storage for app data and uploads
- Local file/image/video uploads served by the same app
- Public and read-only space access
- Space links and card links
- Lightweight URL previews
- YouTube embed, thumbnail, and title fallback support
- Docker deployment

## What It Removes

- Multi-user editing and presence
- Groups and collaborator workflows
- Billing and upgrade flows
- Email invites and password reset email flows
- Hosted explore/live/community feeds
- Are.na integration
- Hosted helper/image proxy dependencies

## Requirements

- Docker and Docker Compose

Optional for local non-Docker development:

- Node.js 22
- npm

## Quick Start

Clone the standalone repo and prepare the local env file:

```bash
git clone https://github.com/lenzfliker/kinopio-selfhost.git
cd kinopio-selfhost
cp .env.example .env
```

1. Set a real `ADMIN_EMAIL`.
2. Set a real `ADMIN_PASSWORD`.
3. Set `VITE_PUBLIC_APP_ORIGIN` to your public URL.
4. Start the app:

```bash
docker compose up --build -d
```

5. Open `http://YOUR_SERVER_IP:3000` or your reverse-proxied domain.

The SQLite database is stored in the Docker volume `kinopio_selfhost_data`.

## Environment

Example env file:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-now
DATABASE_PATH=/data/kinopio-selfhost.sqlite
VITE_PUBLIC_APP_ORIGIN=https://kinopio.example.com
VITE_SELFHOST=true
VITE_API_HOST=
```

Variable notes:

- `ADMIN_EMAIL`: seeded admin login email
- `ADMIN_PASSWORD`: seeded admin login password
- `DATABASE_PATH`: SQLite file path inside the container
- `VITE_PUBLIC_APP_ORIGIN`: public base URL used for generated links and asset URLs
- `VITE_SELFHOST`: must stay `true`
- `VITE_API_HOST`: normally blank

`.env` is ignored by git and must not be committed.

## Docker Deploy Guide

Default compose setup is in [docker-compose.yml](./docker-compose.yml).

```yaml
services:
  kinopio-selfhost:
    image: kinopio-selfhost:latest
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      PORT: 3000
      DATABASE_PATH: /data/kinopio-selfhost.sqlite
      VITE_SELFHOST: "true"
    volumes:
      - kinopio_selfhost_data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"]
    restart: unless-stopped
```

Deploy steps on a VPS:

1. Clone the repo onto the server.
2. Copy `.env.example` to `.env`.
3. Edit `.env` with your real values.
4. Run `docker compose up --build -d`.
5. Put a reverse proxy in front of port `3000`.
6. Set `VITE_PUBLIC_APP_ORIGIN` to the final HTTPS URL.
7. Confirm the container becomes healthy with `docker compose ps`.

Update flow:

```bash
git pull
docker compose up --build -d
```

Stop:

```bash
docker compose down
```

Delete everything including the DB volume:

```bash
docker compose down -v
```

View logs:

```bash
docker compose logs -f
```

## Dokploy

Dokploy can deploy this repo directly from GitHub.

Recommended Dokploy setup:

1. Create a new project in Dokploy.
2. Create a new service of type `Compose` with Compose Type `Docker Compose`.
3. Choose provider `GitHub` or `Git`.
4. Select this repository and the `main` branch.
5. Set the Compose Path to `./docker-compose.dokploy.yml`.
6. Add the same variables from [`.env.example`](./.env.example) in the Dokploy environment settings.
7. Deploy the service.
8. Attach your domain in the Dokploy Domains tab.
9. Set the container port to `3000` in Dokploy Domains.
10. Set `VITE_PUBLIC_APP_ORIGIN` to the final HTTPS URL you assign in Dokploy.

Notes for Dokploy:

- Dokploy recommends configuring domains in the Dokploy UI instead of adding Traefik labels manually.
- Use [docker-compose.dokploy.yml](./docker-compose.dokploy.yml) in Dokploy. It does not publish a host port, so it avoids `0.0.0.0:3000` conflicts on the VPS.
- Use [docker-compose.yml](./docker-compose.yml) for plain Docker deployments outside Dokploy.
- Do not commit a real `.env`; keep secrets in Dokploy environment variables or a local untracked `.env`.

## Self-Host Guide

This build is aimed at one real editor account.

- Sign in with the seeded admin account from `.env`.
- The server auto-creates an `Inbox` space if one is missing.
- New spaces are empty by default.
- App data and uploaded files are stored in the same SQLite database.
- Public/read-only links remain available.
- URL previews are intentionally lightweight and happen locally from the self-hosted server.

Recommended production setup:

1. Keep Docker and the SQLite volume on the same host.
2. Put Caddy, Nginx, or another reverse proxy in front of port `3000`.
3. Terminate HTTPS at the reverse proxy.
4. Set `VITE_PUBLIC_APP_ORIGIN` to the final public HTTPS URL.
5. Back up the SQLite database regularly.

## Reverse Proxy

Use any reverse proxy that forwards to `http://127.0.0.1:3000`.

Minimal Caddy example:

```caddy
kinopio.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Minimal Nginx example:

```nginx
server {
  listen 80;
  server_name kinopio.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Backup and Restore

The only persistent requirement is the SQLite DB in the Docker volume.

Backup:

```bash
docker run --rm \
  -v kinopio_selfhost_data:/data \
  -v "$PWD:/backup" \
  alpine \
  sh -c "cp /data/kinopio-selfhost.sqlite /backup/kinopio-selfhost.sqlite"
```

Restore:

```bash
docker run --rm \
  -v kinopio_selfhost_data:/data \
  -v "$PWD:/backup" \
  alpine \
  sh -c "cp /backup/kinopio-selfhost.sqlite /data/kinopio-selfhost.sqlite"
```

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Client dev server runs on `5173`. The Node API runs on `3000`.

## Notes

- `.env` is intentionally ignored and should never be committed.
- New spaces are empty by default.
- The server auto-creates an `Inbox` space if one is missing.
- Uploads and app data are stored locally in SQLite.
- Generic URL previews are intentionally lightweight.
- YouTube previews use a deterministic fallback path for embed URL, thumbnail, and title.

## Troubleshooting

If normal websites preview correctly but YouTube metadata does not:

- verify the server can reach `youtube.com`, `youtube.com/oembed`, and `i.ytimg.com`
- verify outbound HTTPS trust in the container
- verify your reverse proxy is not blocking large responses or embed-related headers

If URL previews fail broadly inside Docker:

- verify the container has outbound network access
- verify the server can validate remote TLS certificates
- verify your VPS firewall or hosting provider is not blocking outbound requests

