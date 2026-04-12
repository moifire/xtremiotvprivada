# ULTRA PRO DB PRIVADA + M3U (LEGAL)

Proyecto privado para Stremio con panel admin, base de datos y soporte M3U.
Uso exclusivo para contenido propio, autorizado o licenciado.

## Stack
- Vercel Functions
- Upstash Redis REST API (como base de datos)
- Token privado para el addon
- Login admin con sesión firmada
- Importación de M3U desde navegador
- Node 24

## Variables de entorno
Crea estas variables en Vercel:

- ADDON_TOKEN=tu_token_privado_para_stremio
- ADMIN_USER=admin
- ADMIN_PASS=tu_password_segura
- SESSION_SECRET=una_cadena_larga_y_aleatoria
- UPSTASH_REDIS_REST_URL=https://tu-endpoint.upstash.io
- UPSTASH_REDIS_REST_TOKEN=tu_token_upstash
- CATALOG_KEY=moitube:catalog (opcional)

## Flujo
1. Sube a GitHub.
2. Importa el repo en Vercel.
3. Configura variables de entorno.
4. Despliega.
5. Entra en /admin y haz login.
6. Importa tu M3U autorizada o añade contenido manualmente.
7. Guarda.
8. Instala el addon en:
   https://TU-PROYECTO.vercel.app/manifest.json?token=TU_TOKEN

## Nota
Sin token, el addon responde 401.


## Novedades v2
- Botón para vaciar toda la base de datos
- Separación de canales TV por categorías en Stremio usando el group-title de la M3U o la categoría manual
- Campo categoría en el panel admin

## Novedades v3
- Ocultar categorías TV desde panel
- Ordenar categorías TV desde panel
- Logo y fondo por defecto configurables
- Las series mantienen la ficha principal de la serie y los capítulos se muestran al entrar en la meta de la serie

## Novedades v4
- Renombrado automático de categorías
- Fusión automática de grupos parecidos
- Alias configurables desde el panel admin usando formato origen=destino


## Gestión de usuarios privados

Ahora puedes crear usuarios desde el panel `/admin` con:
- fecha de caducidad
- límite de conexiones/IPs
- activación/desactivación
- reset de IPs
- enlace privado de instalación por usuario

### Nueva API admin
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users`
- `DELETE /api/admin/users`

### Cómo funciona
El addon ya no usa un único `ADDON_TOKEN` para clientes finales. Cada usuario tiene su propio token en la URL de instalación:

`/manifest.json?token=TOKEN_DEL_USUARIO`

Las rutas `manifest`, `catalog`, `meta` y `stream` validan ese usuario, su caducidad y el límite de conexiones/IPs registradas.
