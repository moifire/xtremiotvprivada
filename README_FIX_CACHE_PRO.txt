FIX CACHE PRO · LISTO PARA SUBIR

Incluye:
- api/index.js con:
  - /api/admin/cache-info
  - /api/admin/refresh-cache
  - versionado persistente del catálogo
  - ids de catálogo versionados para Stremio
  - cabeceras no-store
- public/admin/index.html con:
  - botón "Actualizar catálogo"
  - barra de versión y última actualización
- data/cache-info.sample.json

Variables recomendadas en Vercel:
- ADMIN_USER
- ADMIN_PASS
- SESSION_SECRET
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN
- USERS_KEY
- CATALOG_KEY
- CACHE_INFO_KEY=xtremio:cache-info

Después de subir:
1. Redeploy en Vercel
2. Entrar a /admin
3. Pulsar "Actualizar catálogo"
4. Cerrar y abrir Stremio
