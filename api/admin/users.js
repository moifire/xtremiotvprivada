const {sendJson,handleOptions,requireAdmin}=require('../lib/common');
const {load,save}=require('../lib/private');

module.exports=async(req,res)=>{
 if(handleOptions(req,res))return;

 if(!requireAdmin(req,res))return;

 const db=load();

 if(req.method==='GET'){
  return sendJson(res,200,{users:db.users});
 }

 if(req.method==='POST'){
  let body='';
  req.on('data',c=>body+=c);
  req.on('end',()=>{
    const d=JSON.parse(body||'{}');
    db.users.push({
      token:d.token||('user_'+Math.random().toString(36).slice(2)),
      name:d.name,
      enabled:true,
      expiresAt:d.expiresAt||0,
      maxIps:d.maxIps||1,
      ips:[]
    });
    save(db);
    sendJson(res,200,{ok:true});
  });
 }
};
