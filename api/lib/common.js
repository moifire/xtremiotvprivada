function sendJson(res, code, data){
  res.statusCode=code;
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(data));
}
function handleOptions(req,res){
 if(req.method==='OPTIONS'){res.statusCode=204;res.end();return true;}
 return false;
}
function parseUrl(req){ return new URL(req.url,'http://localhost'); }

function getBearer(req){
 const a=(req.headers.authorization||'').replace('Bearer ','');
 return a;
}

function requireAdmin(req,res){
 const token=getBearer(req);
 if(token!=='moifire123456'){
  sendJson(res,401,{error:'Admin unauthorized'});
  return null;
 }
 return {role:'admin'};
}

module.exports={sendJson,handleOptions,parseUrl,requireAdmin};
