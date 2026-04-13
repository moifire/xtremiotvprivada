
function normalizePlan(plan){
 const v = String(plan||'').toLowerCase();
 if(v.includes('tri')) return 'trimestral';
 if(v.includes('anu')) return 'anual';
 return 'mensual';
}
function getPlanClass(p){
 p=normalizePlan(p);
 if(p==='trimestral') return 'plan-quarter';
 if(p==='anual') return 'plan-year';
 return 'plan-month';
}
function getDeviceClass(n){
 n=Number(n||1);
 if(n==2) return 'device-orange';
 if(n>=3) return 'device-red';
 return 'device-green';
}
function render(users){
 const el=document.getElementById('users');
 el.innerHTML = users.map(u=>`
 <div class="card">
   <div>
     <div><b>${u.name}</b></div>
     <div>${u.plan}</div>
   </div>
   <div class="brand ${getPlanClass(u.plan)}">
     <div class="logo">MoiStremioTV</div>
     <div class="plan">PLAN ${normalizePlan(u.plan).toUpperCase()}</div>
     <div class="device ${getDeviceClass(u.maxConnections)}">
       ${u.maxConnections} DISPOSITIVO${u.maxConnections>1?'S':''}
     </div>
   </div>
 </div>`).join('');
}
render([
 {name:'cliente1',plan:'mensual',maxConnections:1},
 {name:'cliente2',plan:'trimestral',maxConnections:2},
 {name:'cliente3',plan:'anual',maxConnections:3}
]);
