/* Tracking + i18n + UX — sans données personnelles */
(function(){
  const lang=document.body.dataset.lang||'fr';
  const path=location.pathname;
  const consent=localStorage.getItem('consent');
  const box=document.getElementById('consent');
  if(!consent&&box){box.hidden=false;document.getElementById('consent-txt').textContent={fr:'Autorisez-vous les statistiques anonymes ?',en:'Allow anonymous analytics?',es:'¿Permitir analíticas anónimas?'}[lang]||'';}
  function ok(v){localStorage.setItem('consent',v?'yes':'no');if(box)box.hidden=true;}
  document.getElementById('c-ok')?.addEventListener('click',()=>ok(true));
  document.getElementById('c-no')?.addEventListener('click',()=>ok(false));
  const allowed=localStorage.getItem('consent')!=='no';
  function dev(){return /Mobi|Android/i.test(navigator.userAgent)?'mobile':'desktop';}
  async function track(event,extra={}){
    if(!allowed)return;
    try{await fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,page:path+(location.search||''),language:lang,device:dev(),browser:(navigator.userAgent||'').slice(0,40),...extra})});}catch{}
  }
  // burger
  document.getElementById('burger')?.addEventListener('click',()=>document.getElementById('nav')?.classList.toggle('open'));
  // reveal
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('v');io.unobserve(e.target);}}));
  document.querySelectorAll('.reveal,.card').forEach(el=>{el.classList.add('reveal');io.observe(el);});
  // page/product view
  track('page_view');
  if(window.__PRODUCT__)track('product_view',{product_id:window.__PRODUCT__.id});
  // clicks
  document.querySelectorAll('[data-ev]').forEach(a=>{
    a.addEventListener('click',()=>{
      const ev=a.getAttribute('data-ev');
      const pid=a.getAttribute('data-product')||(window.__PRODUCT__?.id)||'';
      track(ev,{product_id:pid});
    },{once:true});
  });
  // search filter (collection)
  const q=document.getElementById('q'),g=document.getElementById('gamme'),grid=document.getElementById('grid');
  if(q&&grid&&window.__PRODUCTS__){
    const all=grid.innerHTML;
    function apply(){
      const s=q.value.toLowerCase(),gm=g.value;
      const list=window.__PRODUCTS__.filter(p=>(!gm||p.gamme===gm)&&(!s||(p.name+' '+p.ref+' '+p.brand).toLowerCase().includes(s)));
      // simple: hide/show via reload of cards? fallback filter DOM
      [...grid.children].forEach(card=>{
        const t=card.textContent.toLowerCase();
        const showT=!s||t.includes(s);
        card.style.display=showT?'':'none';
      });
    }
    q.addEventListener('input',apply);g?.addEventListener('change',apply);
  }
  // contact form
  const f=document.getElementById('cform');
  if(f){
    f.querySelector('textarea,input[name=nom]')?.addEventListener('focus',()=>track('contact_form_start'),{once:true});
    f.addEventListener('submit',async e=>{
      e.preventDefault();
      const fd=new FormData(f);
      const body=Object.fromEntries(fd.entries());
      const err=document.getElementById('cerr'),okm=document.getElementById('cok');
      err.hidden=true;
      try{
        const r=await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const j=await r.json();
        if(!r.ok)throw new Error(j.message||j.error||'Erreur');
        okm.hidden=false;f.reset();
      }catch(ex){err.textContent=String(ex.message||ex);err.hidden=false;}
    });
  }
})();
