# MoiTube ULTRA PRO LIMPIO FINAL

Versión limpia para **Vercel Hobby** con:

- **1 sola función** en `/api/index.js`
- panel admin estático en `/admin`
- usuarios con token privado
- caducidad
- máximo de conexiones/IPs
- reset de IPs
- importar catálogo por JSON o M3U
- rutas Stremio por token en path:
  - `/u/TOKEN/manifest.json`
  - `/u/TOKEN/catalog/...`
  - `/u/TOKEN/meta/...`
  - `/u/TOKEN/stream/...`

## Variables de entorno

- `ADMIN_USER`
- `ADMIN_PASS`
- `SESSION_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- opcional: `CATALOG_KEY`
- opcional: `USERS_KEY`

## Importante

Dentro de `/api` solo debe existir `index.js`.

## Instalación privada

El panel genera enlaces así:

```text
https://TU-DOMINIO.vercel.app/u/TOKEN/manifest.json
```

