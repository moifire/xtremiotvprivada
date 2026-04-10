const fs=require('fs');

function load(){
 try{return JSON.parse(fs.readFileSync('data/users.json'));}catch{return {users:[]}}
}

function save(db){
 fs.writeFileSync('data/users.json',JSON.stringify(db,null,2));
}

function requirePrivateAccess(req,res){
 const url=new URL(req.url,'http://localhost');
 const token=url.searchParams.get('token');

 if(!token){res.end(JSON.stringify({error:'no token'}));return null;}

 const db=load();
 const user=db.users.find(u=>u.token===token);
 if(!user){res.end(JSON.stringify({error:'invalid'}));return null;}

 if(!user.enabled){res.end(JSON.stringify({error:'disabled'}));return null;}

 if(user.expiresAt && Date.now()>user.expiresAt){
  res.end(JSON.stringify({error:'expired'}));return null;
 }

 return user;
}

module.exports={requirePrivateAccess,load,save};
