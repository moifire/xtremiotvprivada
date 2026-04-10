const {requirePrivateAccess}=require('./lib/private');
const {sendJson,handleOptions}=require('./lib/common');

module.exports=async(req,res)=>{
 if(handleOptions(req,res))return;
 const user=await requirePrivateAccess(req,res);
 if(!user)return;

 sendJson(res,200,{ok:true,type:"meta.js"})
};
