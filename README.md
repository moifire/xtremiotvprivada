# MoiStremioTV ULTRA PRO DB v5

Versión limpia para Vercel Hobby con:

- una sola función en `api/index.js`
- panel admin en `/admin`
- test Redis visible en el panel
- usuarios con token privado
- suscripciones PRO: mensual, trimestral, anual y personalizado
- renovación rápida por usuario
- tarjeta de cliente con QR para compartir
- importación de M3U por archivo o por texto
- guardado en Upstash si están las variables de entorno

## Variables necesarias

- `ADMIN_USER`
- `ADMIN_PASS`
- `SESSION_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- opcional: `CATALOG_KEY`
- opcional: `USERS_KEY`

## URL de instalación en Stremio

`https://TU-DOMINIO.vercel.app/u/TOKEN/manifest.json`

## Nota

La tarjeta cliente usa la librería `qrcode` desde CDN para generar el QR en el navegador del panel.
