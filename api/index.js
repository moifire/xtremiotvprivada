
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname.includes('/configure')) {
    return serveConfigurePage(res);
  }

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}

function serveConfigurePage(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  res.end(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>MoiStremioTV</title>
<style>
body{background:#0b0f1a;color:white;font-family:Arial;text-align:center;padding:40px;}
button{padding:12px 20px;border:none;border-radius:10px;margin:10px;cursor:pointer;}
.green{background:#22c55e;color:white;}
</style>
</head>

<body>

<h1>⚙️ MoiStremioTV</h1>

<p>Panel cliente</p>

<button class="green" onclick="update()">Actualizar catálogo</button>

<p id="msg"></p>

<script>
async function update(){
  try{
    await fetch('/api/admin/refresh-cache',{method:'POST'});
    document.getElementById('msg').innerText='✅ Actualizado. Cierra y abre Stremio';
  }catch{
    document.getElementById('msg').innerText='❌ Error';
  }
}
</script>

</body>
</html>`);
}
