import {PLACES,HOTEL,CAT,AREA,DAYS,DEFAULT_PLAN} from './data.js';
import {firebaseConfig} from './firebase-config.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}};
const byId=Object.fromEntries(PLACES.map(p=>[p.id,p]));
const km=(a,b,c,d)=>{const t=x=>x*Math.PI/180,h=Math.sin(t(c-a)/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(t(d-b)/2)**2;return 12742*Math.asin(Math.sqrt(h))};
PLACES.forEach(p=>{p.km=km(HOTEL.lat,HOTEL.lng,p.lat,p.lng);p.min=Math.max(5,Math.round(p.km*1.35/70*60/5)*5)});
const fmt=m=>m<60?`${m} דק׳`:`${Math.floor(m/60)} ש׳${m%60?` ${m%60} דק׳`:''}`;

/* ---------- backend: Firebase if configured, otherwise this phone only ---------- */
let api=null, myUid=ls.get('uid',null)||('local-'+Math.random().toString(36).slice(2));ls.set('uid',myUid);
async function connect(){
  if(!firebaseConfig){$('sync').textContent='מצב מקומי: נשמר רק בטלפון הזה';$('banner').hidden=false;$('banner').textContent='האפליקציה עוד לא מחוברת ל-Firebase. מפה ומקומות עובדים, אבל הצבעות ותמונות לא משותפות. ההוראות בקובץ README.';return localApi()}
  const V='10.12.2',B=`https://www.gstatic.com/firebasejs/${V}/`;
  const [{initializeApp},{getAuth,signInAnonymously,onAuthStateChanged},F]=await Promise.all([import(B+'firebase-app.js'),import(B+'firebase-auth.js'),import(B+'firebase-firestore.js')]);
  const app=initializeApp(firebaseConfig);
  let db;try{db=F.initializeFirestore(app,{localCache:F.persistentLocalCache({tabManager:F.persistentMultipleTabManager()})})}catch(e){db=F.getFirestore(app)}
  const auth=getAuth(app);
  await new Promise((res,rej)=>{onAuthStateChanged(auth,u=>{if(u){myUid=u.uid;res()}});signInAnonymously(auth).catch(rej)});
  $('sync').textContent='מחובר · משותף לכולם';
  return {
    onVotes:cb=>F.onSnapshot(F.collection(db,'votes'),s=>{const v={};s.forEach(d=>{const x=d.data();if(typeof x.name==='string'&&Array.isArray(x.likes))v[x.name.slice(0,20)]=x.likes.filter(i=>byId[i])});cb(v)}),
    setVotes:(name,likes)=>F.setDoc(F.doc(db,'votes',name),{name,likes,uid:myUid,t:F.serverTimestamp()}),
    onPlan:cb=>F.onSnapshot(F.doc(db,'plan','main'),d=>{if(d.exists())cb(d.data().days)}),
    setPlan:(days,by)=>F.setDoc(F.doc(db,'plan','main'),{days,by,t:F.serverTimestamp()}),
    onPhotos:cb=>F.onSnapshot(F.query(F.collection(db,'photos'),F.orderBy('t','desc'),F.limit(400)),s=>{const a=[];s.forEach(d=>{const x=d.data();a.push({id:d.id,...x,t:x.t?x.t.toMillis():Date.now()})});cb(a)}),
    addPhoto:async(meta,full)=>{const ref=F.doc(F.collection(db,'photos'));await F.setDoc(F.doc(db,'photoFull',ref.id),{img:full,uid:myUid});await F.setDoc(ref,{...meta,uid:myUid,t:F.serverTimestamp()})},
    getFull:async id=>{const d=await F.getDoc(F.doc(db,'photoFull',id));return d.exists()?d.data().img:null},
    delPhoto:async id=>{await F.deleteDoc(F.doc(db,'photos',id));await F.deleteDoc(F.doc(db,'photoFull',id)).catch(()=>{})}
  };
}
function localApi(){
  const subs={votes:[],plan:[],photos:[]};const emit=k=>subs[k].forEach(f=>f(ls.get('l_'+k,k==='photos'?[]:null)));
  return {
    onVotes:cb=>{subs.votes.push(cb);cb(ls.get('l_votes',{})||{})},
    setVotes:async(n,l)=>{const v=ls.get('l_votes',{})||{};v[n]=l;ls.set('l_votes',v);emit('votes')},
    onPlan:cb=>{subs.plan.push(cb);const p=ls.get('l_plan',null);if(p)cb(p)},
    setPlan:async d=>{ls.set('l_plan',d)},
    onPhotos:cb=>{subs.photos.push(cb);cb(ls.get('l_photos',[]))},
    addPhoto:async(meta,full)=>{const a=ls.get('l_photos',[]);const id='p'+Date.now();a.unshift({id,...meta,uid:myUid,t:Date.now()});if(!ls.set('l_photos',a))throw new Error('אין מקום בטלפון');ls.set('l_full_'+id,full);emit('photos')},
    getFull:async id=>ls.get('l_full_'+id,null),
    delPhoto:async id=>{ls.set('l_photos',ls.get('l_photos',[]).filter(p=>p.id!==id));try{localStorage.removeItem('l_full_'+id)}catch(e){}emit('photos')}
  };
}

/* ---------- state ---------- */
let me=ls.get('me','');$('me').value=me;
$('me').addEventListener('input',()=>{me=$('me').value.trim();ls.set('me',me)});
let votes={},plan=JSON.parse(JSON.stringify(DEFAULT_PLAN)),photos=[],sel=null,fCat='all',fArea='all',mCat='all';
const needName=()=>{me=$('me').value.trim();if(!me){$('me').focus();$('sync').textContent='כתבו קודם את השם שלכם';return true}ls.set('me',me);return false};
const likers=id=>Object.entries(votes).filter(([,l])=>l.includes(id)).map(([n])=>n);

/* countdown */
{const d=Math.ceil((new Date(2027,6,23)-new Date())/864e5);$('count').innerHTML=d>0?`עוד <b>${d}</b> ימים`:d>-8?'<b>בטיול!</b>':'<b>היה מדהים</b>'}

/* ---------- tabs ---------- */
const TABS=['map','places','days','votes','photos','hotel'];
function tab(t){if(!TABS.includes(t))t='map';document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.t===t));TABS.forEach(s=>$(s+'-s').hidden=s!==t);if(location.hash!=='#'+t)history.replaceState(null,'','#'+t);if(t==='map'&&map)setTimeout(()=>map.invalidateSize(),50)}
$('tabs').onclick=e=>{const b=e.target.closest('button');if(b)tab(b.dataset.t)};
addEventListener('hashchange',()=>tab(location.hash.slice(1)));

/* ---------- map ---------- */
let map=null,markers={};
function initMap(){
  if(!window.L){$('map').innerHTML='<p style="padding:20px">המפה לא נטענה. בדקו חיבור לאינטרנט.</p>';return}
  map=L.map('map',{zoomControl:true}).setView([HOTEL.lat,HOTEL.lng],9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);
  L.marker([HOTEL.lat,HOTEL.lng],{icon:L.divIcon({className:'',html:'<div class="star">★</div>',iconSize:[30,30],iconAnchor:[15,15]}),zIndexOffset:1000}).addTo(map).bindPopup('<b>המלון</b><br>Landhaus Steiner');
  [[50,'כשעה'],[100,'כשעתיים']].forEach(([r,l])=>L.circle([HOTEL.lat,HOTEL.lng],{radius:r*1000,color:'#0b3a53',weight:1.5,dashArray:'6 6',fill:false,interactive:false}).addTo(map).bindTooltip(l,{permanent:true,direction:'top',className:'',offset:[0,0]}));
  PLACES.forEach(p=>{const m=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:`<div class="pin" style="background:${CAT[p.cat].c}"></div>`,iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map);
    m.bindPopup(()=>popup(p));markers[p.id]=m});
  map.on('popupopen',e=>{const b=e.popup.getElement().querySelector('[data-v]');if(b)b.onclick=()=>{toggleVote(b.dataset.v);map.closePopup()};const g=e.popup.getElement().querySelector('[data-go]');if(g)g.onclick=()=>{select(g.dataset.go,true)}});
}
const popup=p=>{const L_=likers(p.id),mine=me&&L_.includes(me);return `<b>${p.he}</b><br><span class="small">${CAT[p.cat].n} · כ-${fmt(p.min)} מהמלון</span>${p.note?`<br>${p.note}`:''}<div class="row" style="margin-top:8px"><button class="like" data-v="${p.id}" aria-pressed="${!!mine}">${mine?'רוצה ✓':'רוצה'} · ${L_.length}</button><a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" rel="noopener">ניווט</a><button class="like" data-go="${p.id}">פרטים</button></div>`};
function mapFilter(){PLACES.forEach(p=>{const on=mCat==='all'||(mCat==='rain'?p.rain:p.cat===mCat);const m=markers[p.id];if(!m)return;on?m.addTo(map):m.remove()})}
$('fitNear').onclick=()=>map&&map.setView([HOTEL.lat,HOTEL.lng],9);
$('fitAll').onclick=()=>map&&map.fitBounds(L.latLngBounds(PLACES.map(p=>[p.lat,p.lng])),{padding:[20,20]});
$('locate').onclick=()=>{if(!map||!navigator.geolocation)return;navigator.geolocation.getCurrentPosition(pos=>{const ll=[pos.coords.latitude,pos.coords.longitude];L.circleMarker(ll,{radius:8,color:'#fff',fillColor:'#2f80ed',fillOpacity:1,weight:3}).addTo(map);map.setView(ll,11)},()=>{$('sync').textContent='אין הרשאת מיקום'})};

/* ---------- places ---------- */
const catChips=(cur)=>[['all','הכול'],...Object.entries(CAT).map(([k,v])=>[k,v.n]),['rain','מתאים לגשם']].map(([k,n])=>`<button class="chip" data-k="${k}" aria-pressed="${cur===k}">${n}</button>`).join('');
function chips(){$('fCat').innerHTML=catChips(fCat);$('mCat').innerHTML=catChips(mCat);$('fArea').innerHTML=[['all','כל האזורים'],...Object.entries(AREA)].map(([k,n])=>`<button class="chip" data-k="${k}" aria-pressed="${fArea===k}">${n}</button>`).join('')}
$('fCat').onclick=e=>{const b=e.target.closest('.chip');if(b){fCat=b.dataset.k;chips();renderList()}};
$('fArea').onclick=e=>{const b=e.target.closest('.chip');if(b){fArea=b.dataset.k;chips();renderList()}};
$('mCat').onclick=e=>{const b=e.target.closest('.chip');if(b){mCat=b.dataset.k;chips();mapFilter()}};
const showP=p=>(fCat==='all'||(fCat==='rain'?p.rain:p.cat===fCat))&&(fArea==='all'||p.area===fArea);
function renderList(){
  const list=PLACES.filter(showP).sort((a,b)=>a.km-b.km);
  $('list').innerHTML=list.map(p=>{const L_=likers(p.id),mine=me&&L_.includes(me);return `<article class="card${sel===p.id?' sel':''}" data-id="${p.id}" style="--c:${CAT[p.cat].c}">
  <h3>${p.he}</h3><div class="de">${p.de}</div>
  <div class="meta"><span>${CAT[p.cat].n}</span><span>${AREA[p.area]}</span><span>כ-${fmt(p.min)} מהמלון</span></div>
  ${p.note?`<div>${p.note}</div>`:''}
  ${p.rain||p.min>=150?`<div class="row">${p.rain?'<span class="tag rain">מתאים לגשם</span>':''}${p.min>=150?'<span class="tag far">יום נסיעה</span>':''}</div>`:''}
  <div class="row" style="margin-top:auto"><button class="like" data-v="${p.id}" aria-pressed="${!!mine}">${mine?'רוצה ✓':'רוצה'} · ${L_.length}</button>
  <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" rel="noopener">גוגל מפות</a>
  <a href="https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes" target="_blank" rel="noopener">Waze</a>
  <button class="like" data-onmap="${p.id}">במפה</button></div>
  ${L_.length?`<div class="small">${L_.map(esc).join(' · ')}</div>`:''}</article>`}).join('')||'<p class="small">אין מקומות בסינון הזה.</p>';
}
$('list').onclick=e=>{const b=e.target.closest('[data-v]');if(b)return toggleVote(b.dataset.v);const m=e.target.closest('[data-onmap]');if(m&&map){const p=byId[m.dataset.onmap];tab('map');setTimeout(()=>{map.setView([p.lat,p.lng],12);markers[p.id].addTo(map).openPopup()},80)}};
function select(id,scroll){sel=id;if(!showP(byId[id])){fCat='all';fArea='all';chips()}renderList();if(scroll){tab('places');const el=document.querySelector(`.card[data-id="${id}"]`);el&&el.scrollIntoView({behavior:'smooth',block:'center'})}}

/* ---------- votes ---------- */
function toggleVote(id){if(needName())return;const l=new Set(votes[me]||[]);l.has(id)?l.delete(id):l.add(id);votes[me]=[...l];renderVotes();api&&api.setVotes(me,votes[me]).catch(()=>$('sync').textContent='השמירה נכשלה')}
function renderVotes(){renderList();renderRank();renderPlan()}
function renderRank(){
  const people=Object.keys(votes).filter(n=>votes[n].length);
  const rows=PLACES.map(p=>({p,L:likers(p.id)})).filter(r=>r.L.length).sort((a,b)=>b.L.length-a.L.length||a.p.km-b.p.km);const max=rows[0]?rows[0].L.length:1;
  $('ranking').innerHTML=`<p class="small">${people.length} הצביעו${people.length?': '+people.map(esc).join(', '):''}</p>`+(rows.map((r,i)=>`<div class="rank"><span class="n">${i+1}</span><div><b>${r.p.he}</b> <span class="small">· ${AREA[r.p.area]} · כ-${fmt(r.p.min)}</span><div class="bar" style="width:${r.L.length/max*100}%"></div><div class="small">${r.L.map(esc).join(' · ')}</div></div><b>${r.L.length}</b></div>`).join('')||'<p>עדיין אין הצבעות.</p>');
}

/* ---------- days ---------- */
function renderPlan(){
  $('plan').innerHTML=DAYS.map(([d,w,x])=>{const it=plan[d]||{a:'near',p:[]};const opts=PLACES.filter(p=>p.area===it.a).sort((a,b)=>a.km-b.km);
  return `<div class="day"><div class="d">${d}<small>יום ${w}${x?' · '+x:''}</small></div><div>
  <select data-d="${d}" aria-label="אזור">${Object.entries(AREA).map(([k,n])=>`<option value="${k}"${k===it.a?' selected':''}>${n}</option>`).join('')}</select>
  <div class="picks">${opts.map(p=>{const n=likers(p.id).length;return `<button class="pick" data-d="${d}" data-p="${p.id}" aria-pressed="${it.p.includes(p.id)}">${p.he}${n?' · '+n:''}</button>`}).join('')}</div></div></div>`}).join('');
}
$('plan').addEventListener('change',e=>{const s=e.target.closest('select');if(s){plan[s.dataset.d]={a:s.value,p:[]};savePlan()}});
$('plan').addEventListener('click',e=>{const b=e.target.closest('.pick');if(!b)return;const it=plan[b.dataset.d];const i=it.p.indexOf(b.dataset.p);i<0?it.p.push(b.dataset.p):it.p.splice(i,1);savePlan()});
$('resetPlan').onclick=()=>{plan=JSON.parse(JSON.stringify(DEFAULT_PLAN));savePlan()};
let planT;function savePlan(){renderPlan();clearTimeout(planT);$('planStatus').textContent='שומר…';planT=setTimeout(()=>api&&api.setPlan(plan,me||'').then(()=>$('planStatus').textContent='נשמר').catch(()=>$('planStatus').textContent='השמירה נכשלה'),600)}
function cleanPlan(x){if(!x||typeof x!=='object')return null;const n={};for(const [k] of DAYS){const it=x[k];if(!it||!AREA[it.a]||!Array.isArray(it.p))return null;n[k]={a:it.a,p:it.p.filter(i=>byId[i])}}return n}

/* ---------- photos ---------- */
const DAYOPTS=[['before','לפני הטיול'],...DAYS.map(([d,w])=>[d,`${d} · יום ${w}`]),['after','אחרי הטיול']];
$('phDay').innerHTML=DAYOPTS.map(([k,n])=>`<option value="${k}">${n}</option>`).join('');
{const t=new Date(),d=`${t.getDate()}.${t.getMonth()+1}`;$('phDay').value=t.getFullYear()===2027&&DAYS.some(x=>x[0]===d)?d:(t<new Date(2027,6,23)?'before':'after')}
$('phPlace').innerHTML+=PLACES.slice().sort((a,b)=>a.he.localeCompare(b.he,'he')).map(p=>`<option value="${p.id}">${p.he}</option>`).join('');
let picked=[];
function loadImg(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),i=new Image();i.onload=()=>{res(i)};i.onerror=rej;i.src=u})}
function shrink(img,max,q){const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*s);c.height=Math.round(img.naturalHeight*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);let out=c.toDataURL('image/jpeg',q);while(out.length>900000&&q>0.3){q-=0.1;out=c.toDataURL('image/jpeg',q)}return out}
$('file').onchange=async e=>{picked=[];$('preview').innerHTML='';for(const f of [...e.target.files].slice(0,10)){try{const img=await loadImg(f);picked.push({full:shrink(img,1600,0.75),thumb:shrink(img,480,0.7)})}catch(err){$('upStatus').textContent='תמונה אחת לא נקראה'}}
  $('preview').innerHTML=picked.map(p=>`<img src="${p.thumb}" alt="">`).join('');$('upload').disabled=!picked.length;$('upStatus').textContent=picked.length?`${picked.length} תמונות מוכנות`:''};
$('upload').onclick=async()=>{if(needName()||!picked.length)return;$('upload').disabled=true;let ok=0;
  for(const p of picked){try{$('upStatus').textContent=`מעלה ${ok+1} מתוך ${picked.length}…`;await api.addPhoto({by:me,caption:$('caption').value.trim().slice(0,300),day:$('phDay').value,place:$('phPlace').value,thumb:p.thumb},p.full);ok++}catch(err){$('upStatus').textContent='ההעלאה נכשלה: '+(err.message||'')}}
  if(ok===picked.length){$('upStatus').textContent=`הועלו ${ok} תמונות`;picked=[];$('preview').innerHTML='';$('caption').value='';$('file').value=''}$('upload').disabled=!picked.length};
function renderFeed(){
  if(!photos.length){$('feed').innerHTML='<p class="small">עוד אין תמונות. תהיו הראשונים!</p>';return}
  $('feed').innerHTML=DAYOPTS.map(([k,n])=>{const a=photos.filter(p=>p.day===k);if(!a.length)return '';return `<div class="feedday">${esc(n)}</div><div class="photos">${a.map(p=>{const pl=byId[p.place];const src=typeof p.thumb==='string'&&p.thumb.startsWith('data:image/')?p.thumb:'';
    return `<figure class="ph" style="margin:0"><img src="${src}" data-full="${esc(p.id)}" alt="${esc(p.caption||'תמונה')}" loading="lazy"><figcaption class="tx"><span class="by">${esc(p.by)}${pl?` · ${pl.he}`:''}</span>${p.caption?`<span>${esc(p.caption)}</span>`:''}<span class="small">${new Date(p.t).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})}</span>${p.uid===myUid?`<button class="del" data-del="${esc(p.id)}">מחיקה</button>`:''}</figcaption></figure>`}).join('')}</div>`}).join('');
}
$('feed').onclick=async e=>{const d=e.target.closest('[data-del]');if(d){if(d.dataset.sure){d.textContent='מוחק…';await api.delPhoto(d.dataset.del).catch(()=>d.textContent='המחיקה נכשלה')}else{d.dataset.sure=1;d.textContent='בטוח? לחצו שוב למחיקה'}return}
  const i=e.target.closest('img[data-full]');if(!i)return;const p=photos.find(x=>x.id===i.dataset.full);$('lbImg').src=i.src;$('lbTx').textContent=[p.by,p.caption].filter(Boolean).join(' · ');$('lb').classList.add('on');
  const full=await api.getFull(p.id).catch(()=>null);if(full&&full.startsWith('data:image/')&&$('lb').classList.contains('on'))$('lbImg').src=full};
$('lbClose').onclick=()=>$('lb').classList.remove('on');$('lb').onclick=e=>{if(e.target===$('lb'))$('lb').classList.remove('on')};
addEventListener('keydown',e=>{if(e.key==='Escape')$('lb').classList.remove('on')});

/* ---------- info ---------- */
$('rainList').textContent=PLACES.filter(p=>p.rain&&p.min<150).sort((a,b)=>a.km-b.km).map(p=>`${p.he} (${fmt(p.min)})`).join(' · ');

/* ---------- start ---------- */
chips();initMap();renderVotes();renderFeed();tab(location.hash.slice(1));
try{api=await connect()}catch(e){console.error(e);$('sync').textContent='אין חיבור לשרת · מצב מקומי';api=localApi()}
api.onVotes(v=>{votes=v;renderVotes()});
api.onPlan(d=>{const n=cleanPlan(d);if(n){plan=n;renderPlan()}});
api.onPhotos(a=>{photos=a;renderFeed()});
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
