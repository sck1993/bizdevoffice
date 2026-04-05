# Hostinger Docker Manager Deployment

Use `docker-compose.hostinger.yml` when deploying this repository through Hostinger Docker Manager from a GitHub URL.

## Defaults baked into the compose file

- Docker network: `openclaw-9cv4_default`
- OpenClaw websocket URL: `ws://openclaw:61744`
- Public app port: `3001`

These defaults match the current VPS state that was inspected from Docker:

- OpenClaw container alias: `openclaw`
- OpenClaw Docker network: `openclaw-9cv4_default`
- OpenClaw exposed TCP port: `61744`

## Recommended Hostinger setup

1. Deploy from the repository using the compose file:
   `docker-compose.hostinger.yml`
2. If Hostinger asks for environment variables, set only when overriding defaults:
   `OPENCLAW_DOCKER_NETWORK`
   `OPENCLAW_URL`
   `CLAWOFFICE_PORT`
3. After deployment, open the container logs and confirm:
   `> Ready on http://localhost:3000`
   `[gateway] connected to OpenClaw`
4. Trigger a real OpenClaw task and watch for:
   `[gateway] message: ...`

## What still requires manual follow-up

- Confirm the OpenClaw websocket path if it is not the root websocket endpoint.
- Provide real gateway message samples so `_handleMessage()` can be completed.
- Replace placeholder art assets and tune scene coordinates.
