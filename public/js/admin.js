/* Admin dashboard — fetch APIs, charts canvas natif */
(async function(){
  const page=window.__PAGE__||'dashboard';
  const range=()=>document.getElementById('range')?.value||'7';
  async function j(u){const r=await fetch(u);return r.json();}
  function tbl(rows,cols){
    if(!rows.length)return '<p class="muted">Aucune donnée pour cette période (le tracking démarre à l’activation).</p>';
    return '<table class="tbl"><tr>'+cols.map(c=>`<th>${c}</th>`).join('')+'</tr>'+rows.map(r=>'<tr>'+cols.map(c=>`<td>${String(r[c]??'').slice(0,220)}</td>`).join('')+'</tr>').join('')+'</table>';
  }
  if(page==='dashboard'){
    const d=await j('/api/admin/stats?days=30');
    document.getElementById('cards').innerHTML=[
      [d.visitorsToday,'visiteurs aujourd’hui'],[d.visitors7,'visiteurs 7 j'],[d.visitors,'visiteurs 30 j'],
      [d.pageViews,'pages vues'],[d.perSession,'pages/session'],[d.whatsapp,'clics WhatsApp'],[d.forms,'formulaires'],
      [(d.social.instagram_click||0),'Instagram']
    ].map(([b,s])=>`<div class="card"><b>${b}</b><span>${s}</span></div>`).join('');
    // chart
    const c=document.getElementById('ch'),ctx=c.getContext('2d');
    const ks=Object.keys(d.perDay),vs=Object.values(d.perDay);
    const max=Math.max(1,...vs);
    c.width=c.parentElement.clientWidth||800;c.height=160;
    ctx.strokeStyle='#c9a86a';ctx.beginPath();
    ks.forEach((k,i)=>{const x=20+i*(c.width-40)/Math.max(1,ks.length-1),y=c.height-20-(vs[i]/max)*(c.height-50);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.stroke();
    document.getElementById('rt').innerHTML=`<b>${d.realtime}</b> visiteurs actifs (5 min)`+(d.realtimeRows||[]).map(r=>`<div class="muted">${r.page} · ${r.device}</div>`).join('');
    return;
  }
  async function load(){
    const days=range(),box=document.getElementById('tbl');box.textContent='Chargement…';
    if(page==='pages'){const r=await j(`/api/admin/pages?days=${days}`);box.innerHTML=tbl(r,['page','vues','visites']);}
    if(page==='parfums'){const r=await j(`/api/admin/parfums?days=${days}`);box.innerHTML=tbl(r,['nom','vues','whatsapp']);}
    if(page==='parcours'){const r=await j(`/api/admin/parcours?days=${days}`);box.innerHTML=tbl(r,['parcours','n']);}
    if(page==='visiteurs'){const r=await j(`/api/admin/visiteurs?days=${days}`);box.innerHTML=tbl(r,['session','entree','sortie','pages','duree','appareil','langue']);}
    if(page==='conversions'){const r=await j(`/api/admin/conversions?days=${days}`);box.innerHTML='<h3>Totaux</h3>'+tbl(Object.entries(r.totals).map(([k,v])=>({event:k,count:v})),['event','count'])+'<h3>Par jour</h3>'+tbl(Object.entries(r.perDay).map(([d,v])=>({jour:d,...v})),['jour','whatsapp_click','contact_form_submit','instagram_click','facebook_click','tiktok_click','phone_click','email_click']);}
    if(page==='formulaires'){
      const r=await j('/api/admin/formulaires');
      box.innerHTML=r.length?'<table class="tbl"><tr><th>date</th><th>nom</th><th>email</th><th>tél</th><th>message</th><th>page</th><th>statut</th></tr>'+r.map(c=>`<tr><td>${c.date}</td><td>${c.nom}</td><td>${c.email}</td><td>${c.telephone}</td><td>${(c.message||'').slice(0,120)}</td><td>${c.page}</td><td><select data-d="${c.date}" data-e="${c.email}"><option ${c.statut==='Nouveau'?'selected':''}>Nouveau</option><option ${c.statut==='Lu'?'selected':''}>Lu</option><option ${c.statut==='Traité'?'selected':''}>Traité</option></select></td></tr>`).join('')+'</table>':'<p class="muted">Aucun formulaire pour l’instant.</p>';
      box.querySelectorAll('select').forEach(s=>s.onchange=async()=>{await fetch('/api/admin/formulaires/statut',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:s.dataset.d,email:s.dataset.e,statut:s.value})});});
    }
  }
  document.getElementById('reload')?.addEventListener('click',load);
  document.getElementById('range')?.addEventListener('change',load);
  load();
})();
