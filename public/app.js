/* Verta 2.0 frontend: small render components over the unchanged scanner data. All dynamic text goes through esc(). */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CFG=window.VERTA_CONFIG||{};
const REDUCED=matchMedia('(prefers-reduced-motion: reduce)').matches;
const safe=fn=>{try{return fn()}catch(e){return null}};

/* ---------- icons ---------- */
const P={check:'M5 13l4 4L19 7',alert:'M12 4l9 16H3zM12 10v4M12 17h.01',x:'M6 6l12 12M18 6L6 18',minus:'M6 12h12',info:'M12 8h.01M11 12h1v5h1M12 3a9 9 0 100 18 9 9 0 000-18z',
 chev:'M6 9l6 6 6-6',menu:'M4 7h16M4 12h16M4 17h16',sun:'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7l1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2l-1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',moon:'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
 link:'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',scan:'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16',
 chart:'M5 20V10m7 10V4m7 16v-7',doc:'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6'};
const icon=(n,cls='')=>`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]||''}"/></svg>`;

/* ---------- status model ---------- */
const BANDS={ready:{k:'ready',label:'Ready',icon:'check'},compat:{k:'compat',label:'Compatible',icon:'minus'},fric:{k:'fric',label:'Friction',icon:'alert'},blind:{k:'blind',label:'Blind',icon:'x'},inc:{k:'inc',label:'Not tested',icon:'info'}};
const bandFor=s=>s==null?BANDS.inc:s>=80?BANDS.ready:s>=60?BANDS.compat:s>=40?BANDS.fric:BANDS.blind;
const STATE_BAND={ready:BANDS.ready,compatible:BANDS.compat,friction:BANDS.fric,blind:BANDS.blind,inconclusive:BANDS.inc};
const Badge=(b,text)=>`<span class="badge t-${b.k}">${icon(b.icon)}${esc(text||b.label)}</span>`;
const SEV={P0:{k:'blind',label:'Critical',icon:'alert',cls:'p0'},P1:{k:'fric',label:'Important',icon:'alert',cls:'p1'},P2:{k:'compat',label:'Minor',icon:'info',cls:'p2'}};
const CHK={pass:['ready','Pass','check'],warn:['compat','Needs work','minus'],fail:['blind','Failing','x'],unsure:['inc',"Couldn't tell",'info'],na:['inc','Not applicable','minus'],info:['inc','For your information','info']};
const SHORT={discover:'Discoverability',semantic:'Meaning',infra:'Product data',inventory:'Stock',pricing:'Price',policies:'Policies',interact:'Pages',transact:'Checkout'};
const DESC={discover:'Can agents find your store and its products?',semantic:'Can they understand what each product is?',infra:'Is the catalog readable as structured data?',inventory:'Can they tell what is in stock?',pricing:'Can they read price and currency?',policies:'Can they read shipping and returns rules?',interact:'Can they move around without a mouse and eyes?',transact:'Could an authorized agent reach a purchase?'};
const lname=l=>SHORT[l.id]||l.name, ldesc=l=>DESC[l.id]||l.question;

/* ---------- theme, nav, footer ---------- */
function setTheme(t){document.documentElement.dataset.theme=t;safe(()=>localStorage.setItem('verta_theme',t))}
const isDark=()=>document.documentElement.dataset.theme?document.documentElement.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
const VertaLogo=(app)=>`<a class="logo" href="${app?'/app/':'/'}" aria-label="Verta home"><svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="#3457EB"/><path d="M7.5 9.5l6.5 10 6.5-10" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Verta${app?'<span class="tool-tag">Team</span>':''}</a>`;
const SITE_LINKS=[['/#how','How it works'],['/#faq','FAQ'],['/about','Method']];
const APP_LINKS=[['/app/','Scanner'],['/app/prospects','Prospects'],['/about','Methodology'],['/','Public site']];
function MainNavigation(active,mode='site'){
  const links=(mode==='app'?APP_LINKS:SITE_LINKS).map(([h,t])=>`<a href="${h}"${h===active?' aria-current="page"':''}>${t}</a>`).join('')+(mode==='site'&&(CFG.bookingUrl||CFG.contactEmail)?`<a href="/#contact" class="nav-cta">Free store check</a>`:'');
  $('#nav').innerHTML=`<nav class="nav" aria-label="Main">${VertaLogo(mode==='app')}<div class="nav-links">${links}</div><div class="nav-tools"><button class="icon-btn" id="theme" aria-label="Switch colour theme">${icon(isDark()?'sun':'moon')}</button><button class="icon-btn menu-btn" id="menuBtn" aria-expanded="false" aria-controls="menu" aria-label="Menu">${icon('menu')}</button></div><div class="menu" id="menu" data-open="false">${links}</div></nav>`;
  $('#theme').onclick=()=>{setTheme(isDark()?'light':'dark');$('#theme').innerHTML=icon(isDark()?'sun':'moon')};
  const mb=$('#menuBtn'),mn=$('#menu');mb.onclick=()=>{const o=mn.dataset.open!=='true';mn.dataset.open=o;mb.setAttribute('aria-expanded',o)};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mn.dataset.open==='true'){mn.dataset.open=false;mb.setAttribute('aria-expanded',false);mb.focus()}});
}
function Footer(mode='site'){
  const col=mode==='app'?'<a href="/app/">Scanner</a><a href="/app/prospects">Prospects</a><a href="/about">Methodology</a>':'<a href="/#how">How it works</a><a href="/#faq">FAQ</a><a href="/about">Method</a>';
  $('#foot').innerHTML=`<footer class="foot"><div class="page foot-grid"><div>${VertaLogo(mode==='app')}<p class="muted sm" style="margin-top:12px;max-width:40ch">Verta checks whether AI shopping assistants can find, understand and buy from an online store. The score is a working framework, not a certification.</p></div><div><h3>${mode==='app'?'Team tool':'Verta'}</h3>${col}</div><div><h3>Version</h3><p class="muted sm">Scanner v0.1<br>Interface 2.0</p></div></div></footer>`;
}

/* ---------- messages & text ---------- */
const CAN=['find your store','understand your descriptions','read your product data','tell what is in stock','read your prices','check your shipping and return rules','use your pages','complete a purchase'];
const CANT=['find your store','understand your descriptions','read your product data','tell what is in stock','read your prices','check your shipping and return rules','use your pages reliably','complete a purchase'];
function verdict(r){
  if(r.state.key==='inconclusive')return 'We could read your homepage but not a product page, so this covers the storefront only. Paste a direct product link for a real result.';
  const ls=r.layers.map((l,i)=>({i,s:l.score})).filter(x=>x.s!=null);
  if(ls.length<2)return r.state.line;
  const hi=ls.reduce((a,b)=>b.s>a.s?b:a),lo=ls.reduce((a,b)=>b.s<a.s?b:a);
  if(lo.s>=80)return 'An AI shopping assistant can find, read and buy from this store without trouble.';
  if(hi.s-lo.s<12)return 'An AI shopping assistant gets partway: scores are fairly even, so no single layer is the problem. Work through the fixes below in order.';
  return `An AI shopping assistant can ${CAN[hi.i]}, but may not ${CANT[lo.i]}.`;
}
const topChecks=r=>{const all=r.layers.flatMap(l=>l.checks);return r.top.map(id=>all.find(c=>c.id===id)).filter(Boolean)};
function emailMsg(r){
  const t=topChecks(r),first=t[0],rest=t.slice(1,3).map(c=>`- ${c.title}: ${c.evidence}`).join('\n');
  const me=CFG.senderName?`\n\n${CFG.senderName}`:'';
  const open=first?`While looking at ${r.meta.host} I noticed this: ${first.evidence}`:`I looked at ${r.meta.host} and found nothing major to fix.`;
  const why=first&&first.impact?`\n\nWhy it matters: ${first.impact}`:'';
  const fix=first&&first.fix?`\n\nThe fix: ${first.fix}`:'';
  return `Subject: A product data problem on ${r.meta.host}\n\nHi,\n\n${open}${why}${fix}${rest?`\n\nTwo more things I saw:\n${rest}`:''}\n\nI fix this for a fixed price and show you the before and after. If you want, I will send the short list of what I found, free. No call needed.${me}`;
}
function dmMsg(r){const t=topChecks(r)[0];return `Hi, quick note on ${r.meta.host}: ${t?t.evidence:'your product pages look fine to me'}${t&&t.fix?` Fix: ${t.fix.split('. ')[0].replace(/\.$/,'')}.`:''} I can send the short list of what I found, free.${CFG.senderName?' - '+CFG.senderName:''}`}
function reportText(r){
  let t=`Verta Readiness Report: ${r.meta.host}\nScore ${r.score}/100, ${r.state.label}. ${verdict(r)}\nConfidence: ${r.meta.confidence}. Platform: ${r.meta.platform}.\n\n`;
  for(const l of r.layers){t+=`${l.name}: ${l.score==null?'not tested':l.score+'/100'}\n`;for(const c of l.checks)if(c.status==='fail'||c.status==='warn')t+=`  - [${c.sev}] ${c.title}: ${c.evidence} Fix: ${c.fix}\n`}
  return t+'\nVerta scores are a working framework, not a certification.';
}
const fmtDate=s=>safe(()=>new Date(s).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}))||'';
const encodeReport=r=>btoa(unescape(encodeURIComponent(JSON.stringify(r)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decodeReport=h=>{const m=h.match(/^#r=([\w-]+)/);if(!m)return null;return safe(()=>{let s=m[1].replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const r=JSON.parse(decodeURIComponent(escape(atob(s))));return r&&r.layers&&r.state?r:null})};

/* ---------- report components ---------- */
function ReportHeader(r){const m=r.meta;return `<div class="rep-head"><b>${esc(m.host)}</b><span>${esc(m.platform)}</span>${m.scannedAt?`<span>Scanned ${esc(fmtDate(m.scannedAt))}</span>`:''}</div>`}
function ConfidenceIndicator(r){
  const n=(r.meta.pages||[]).length,c=r.meta.confidence||'unknown',det=!/unknown|custom/i.test(r.meta.platform||'');
  const tip={high:'Several product pages were readable and the platform was recognised.',medium:'Some evidence is thin, so treat details as indicative.',low:'Little could be read, so treat this as a first look only.'}[c]||'';
  return `<div class="conf"><span class="chip" tabindex="0" data-tip="${esc(tip)}">Confidence: ${esc(c)}</span><span class="chip">${n} product page${n===1?'':'s'} tested</span><span class="chip">${det?'Platform detected':'Platform not detected'}</span></div>`;
}
function ReadinessScore(r){
  const b=STATE_BAND[r.state.key]||BANDS.inc;
  return `<section class="card score" aria-labelledby="scoreH"><h2 class="sr" id="scoreH">Overall readiness</h2>
  <div class="score-num t-${b.k}" data-count="${r.score}" aria-label="${r.score} out of 100">${REDUCED?r.score:0}<small>/100</small></div>
  <div>${Badge(b,r.state.label)}</div><p class="verdict">${esc(verdict(r))}</p>${ConfidenceIndicator(r)}</section>`;
}
function LayerScoreRow(l){
  const nt=l.score==null,b=bandFor(l.score);
  return `<li class="lrow"><div class="nm">${esc(lname(l))}<small>${esc(ldesc(l))}</small></div>
  <div class="val">${nt?`<span class="nt-label">Not tested</span>`:`<span class="t-${b.k}">${l.score}</span>`}${Badge(b)}</div>
  <div class="track ${nt?'nt':''}" ${nt?'':`role="img" aria-label="${esc(lname(l))}: ${l.score} out of 100, ${b.label}"`}>${nt?'':`<i class="f-${b.k}" data-w="${Math.max(l.score,2)}"></i>`}</div></li>`;
}
const LayerScoreChart=r=>`<section class="card" aria-labelledby="layH"><h2 class="card-h" id="layH">Score by layer</h2><ul class="layers" style="margin-top:16px">${r.layers.map(LayerScoreRow).join('')}</ul></section>`;
function PriorityIssueCard(c){
  const s=SEV[c.sev]||SEV.P2;
  return `<article class="card issue ${s.cls}"><header><span class="badge t-${s.k}">${icon(s.icon)}${s.label}</span><h3 class="card-h">${esc(c.title)}</h3></header>
  <dl class="kv"><dt>What we saw</dt><dd>${esc(c.evidence)}</dd>${c.impact?`<dt>Why it matters</dt><dd>${esc(c.impact)}</dd>`:''}${c.fix?`<dt>Fix</dt><dd>${esc(c.fix)}</dd>`:''}</dl></article>`;
}
const EvidenceBlock=code=>code?`<dt>Technical evidence</dt><dd><pre class="evidence" tabindex="0">${esc(code)}</pre></dd>`:'';
function CheckRow(c){
  const [k,label,ic]=CHK[c.status]||CHK.info,s=c.sev?SEV[c.sev]:null;
  const pts=(c.status==='na'||c.status==='info'||c.status==='unsure')?'':`<span class="muted sm">${c.pts}/${c.max} pts</span>`;
  return `<div class="chk"><div class="chk-h"><span class="badge t-${k}">${icon(ic)}${label}</span>${s?`<span class="chk-st t-${s.k}">${s.label}</span>`:''}<span>${esc(c.title)}</span>${pts}</div>
  <dl class="kv"><dt>What we saw</dt><dd>${esc(c.evidence)}</dd>${c.impact?`<dt>Why it matters</dt><dd>${esc(c.impact)}</dd>`:''}${c.fix?`<dt>Fix</dt><dd>${esc(c.fix)}</dd>`:''}${EvidenceBlock(c.code)}</dl></div>`;
}
function FindingAccordion(l,open,i){
  const b=bandFor(l.score),id=`acc${i}`;
  return `<div class="acc"><button class="acc-btn" id="${id}-b" aria-expanded="${open}" aria-controls="${id}-p"><span class="t">${esc(l.name)}</span><span class="sc t-${b.k}">${l.score==null?'<span class="nt-label">Not tested</span>':l.score}</span>${icon('chev','chev')}<span class="q">${esc(l.question)}</span></button>
  <div class="acc-panel" id="${id}-p" role="region" aria-labelledby="${id}-b" data-open="${open}"><div><div class="acc-in">${l.checks.map(CheckRow).join('')}</div></div></div></div>`;
}
function ReportLimitations(r){
  const n=(r.meta.pages||[]).length,na=r.layers.reduce((a,l)=>a+l.checks.filter(c=>c.status==='na').length,0),items=[];
  (r.meta.notes||[]).forEach(x=>items.push(x));
  if(n<2&&!(r.meta.notes||[]).some(x=>/one product page/i.test(x)))items.push(n?'Only one product page was tested. Results are indicative, not conclusive.':'No product page could be tested.');
  if(r.counts.unsure)items.push(`${r.counts.unsure} check${r.counts.unsure===1?'':'s'} could not be judged from public pages and are left out of the score.`);
  if(na)items.push(`${na} check${na===1?' does':'s do'} not apply to what was readable.`);
  if(/unknown|custom/i.test(r.meta.platform||''))items.push('The store platform was not confidently detected, so platform-specific advice may be generic.');
  items.push('Verta sees only what a public visitor sees. Checkout and logged-in pages are not tested.');
  return `<section class="card limits" aria-labelledby="limH"><h2 class="card-h" id="limH">What this report can and cannot tell you</h2><ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`;
}
function ctaHtml(r){
  if(!CFG.bookingUrl&&!CFG.contactEmail)return '';
  const subj=encodeURIComponent(`${CFG.offerName||'Agent audit'} for ${r.meta.host}`),body=encodeURIComponent(`Hi, I scanned ${r.meta.host} (${r.score}/100) and would like the full audit.`);
  const href=CFG.bookingUrl||`mailto:${CFG.contactEmail}?subject=${subj}&body=${body}`;
  return `<section class="card pill-cta noprint"><h2 class="sec-h">Want an agent to actually try buying from ${esc(r.meta.host)}?</h2><p style="margin-top:8px">${esc(CFG.offerLine||'')}</p><div class="row"><a class="btn" href="${esc(href)}">${CFG.bookingUrl?'Book a call':'Ask for the full audit'}</a></div></section>`;
}
function OutreachPanel(r,id='o'){
  return `<section class="card noprint" aria-labelledby="${id}H"><h2 class="card-h" id="${id}H">Message for the store owner</h2><p class="muted sm" style="margin:4px 0 0">Written from this report. Edit it before you send. Verta never sends anything for you.</p>
  <div class="tabs" role="group" aria-label="Message format"><button class="btn secondary sm" data-tab="email" aria-pressed="true">Email</button><button class="btn secondary sm" data-tab="dm" aria-pressed="false">Short DM</button></div>
  <label class="sr" for="${id}M">Message</label><textarea id="${id}M">${esc(emailMsg(r))}</textarea>
  <div class="row"><button class="btn sm" data-copy>Copy message</button><span class="toast" role="status"></span></div></section>`;
}
function bindOutreach(root,r,id='o'){
  const ta=$(`#${id}M`,root),toast=$('.toast',root.querySelector(`#${id}H`).closest('section'));
  const drafts={email:emailMsg(r),dm:dmMsg(r)};let cur='email';
  $$('[data-tab]',root).forEach(b=>b.onclick=()=>{drafts[cur]=ta.value;cur=b.dataset.tab;$$('[data-tab]',root).forEach(x=>x.setAttribute('aria-pressed',x===b));ta.value=drafts[cur]});
  $('[data-copy]',root).onclick=()=>copyText(ta.value,toast);
}
async function copyText(t,toast){
  const say=m=>{if(toast){toast.textContent=m;setTimeout(()=>toast.textContent='',2500)}};
  try{await navigator.clipboard.writeText(t);say('Copied to clipboard.')}catch(e){say('Copy failed. Select the text and copy it by hand.')}
}
function ReportView(r,client=false){
  const first=r.layers.reduce((m,l,i)=>(l.score!=null&&(m<0||l.score<r.layers[m].score))?i:m,-1);
  const fixes=topChecks(r);
  return `<div class="report">${ReportHeader(r)}
  <div class="summary">${ReadinessScore(r)}${LayerScoreChart(r)}</div>
  ${ReportLimitations(r)}
  <section aria-labelledby="fixH"><h2 class="sec-h" id="fixH" style="margin-bottom:16px">Fix these first</h2><div class="issues">${fixes.map(PriorityIssueCard).join('')||'<div class="card muted">Nothing urgent found.</div>'}</div></section>
  ${ctaHtml(r)}
  <section aria-labelledby="allH"><h2 class="sec-h" id="allH" style="margin-bottom:16px">Every check, by layer</h2>${r.layers.map((l,i)=>FindingAccordion(l,i===first,i)).join('')}</section>
  ${client?'':`<div id="outreach">${OutreachPanel(r)}</div>`}
  <div class="row noprint"><button class="btn secondary" id="cr">Copy report text</button>${client?'':`<button class="btn secondary" id="sh">${icon('link')} Copy client link</button>`}<button class="btn secondary" id="pr">Print or save as PDF</button>${client?'':`<button class="btn secondary" id="again">Scan another store</button>`}<span class="toast" id="rtoast" role="status"></span></div></div>`;
}
function mountReport(r,out,client=false){
  out.innerHTML=ReportView(r,client);
  $$('.acc-btn',out).forEach(b=>b.onclick=()=>{const o=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',o);$('#'+b.getAttribute('aria-controls')).dataset.open=o});
  if(!client)bindOutreach($('#outreach',out),r);
  const t=$('#rtoast',out);
  $('#cr',out).onclick=()=>copyText(reportText(r),t);$('#pr',out).onclick=()=>window.print();
  if(!client){$('#sh',out).onclick=()=>{try{copyText(location.origin+'/report#r='+encodeReport(r),t)}catch(e){t.textContent='Could not build the link.'}};
  $('#again',out).onclick=()=>{out.innerHTML='';document.body.classList.remove('has-report');const u=$('#u');if(u){u.focus();window.scrollTo({top:0,behavior:'smooth'})}}}
  requestAnimationFrame(()=>requestAnimationFrame(()=>$$('.track i',out).forEach(i=>i.style.width=i.dataset.w+'%')));
  const sn=$('.score-num[data-count]',out);
  if(sn&&!REDUCED){const target=+sn.dataset.count,t0=performance.now(),small=sn.querySelector('small');const tick=now=>{const p=Math.min(1,(now-t0)/800),v=Math.round(target*(1-Math.pow(1-p,3)));sn.firstChild.nodeValue=v;if(p<1)requestAnimationFrame(tick)};requestAnimationFrame(tick)}
  document.body.classList.add('has-report');
}

/* ---------- team access key (the scanner API is closed without it) ---------- */
const getKey=()=>safe(()=>localStorage.getItem('verta_key'))||'';
const setKey=k=>safe(()=>localStorage.setItem('verta_key',k));
const clearKey=()=>safe(()=>localStorage.removeItem('verta_key'));
function Gate(mount,onReady,msg){
  if(getKey()&&!msg){onReady();return}
  mount.innerHTML=`<section class="card" style="max-width:460px;margin:64px auto"><h1 class="card-h" style="font-size:22px">Team access</h1><p class="muted" style="margin:6px 0 16px">This is Verta's internal tool. Enter the team access key to continue.</p>${msg?`<p class="field-err" role="alert">${esc(msg)}</p>`:''}<form id="gf"><label class="sr" for="gk">Access key</label><input class="field" id="gk" type="password" autocomplete="current-password" style="margin-bottom:12px"><button class="btn" type="submit">Continue</button></form></section>`;
  $('#gk').focus();$('#gf').onsubmit=e=>{e.preventDefault();const v=$('#gk').value.trim();if(!v)return;setKey(v);mount.innerHTML='';onReady()};
}
/* ---------- scan flow ---------- */
function normalizeUrl(v){
  v=(v||'').trim();if(!v)return {err:'Enter your store address to start.'};
  if(/\s/.test(v))return {err:'Store addresses cannot contain spaces.'};
  if(/^[a-z]+:\/\//i.test(v)&&!/^https?:\/\//i.test(v))return {err:'Only http and https addresses can be scanned.'};
  const u=safe(()=>new URL(/^https?:\/\//i.test(v)?v:'https://'+v));
  if(!u||!/^[^.]+(\.[^.]+)+$/.test(u.hostname))return {err:'That does not look like a store address. Try something like yourstore.com.'};
  return {url:v};
}
const ScanProgress=()=>`<div class="card progress" role="status"><div class="spin" aria-hidden="true"></div><div><h2 class="card-h">Verta is reading your store</h2><p class="muted" style="margin:4px 0 0">This usually takes 15 to 25 seconds. Large stores can take longer. <span id="elapsed">0s</span></p>
<ul class="checklist" aria-label="What Verta looks at"><li>Homepage, sitemap and robots.txt</li><li>Product pages and structured product data</li><li>Price and stock signals</li><li>Shipping, returns and checkout signals</li></ul><div class="row"><button class="btn secondary sm" id="cancel">Cancel scan</button></div></div></div>`;
function classifyError(msg,status){
  const m=(msg||'').toLowerCase();
  if(status===429||/too many/.test(m))return {t:'Too many scans from your network',next:['Wait a few minutes, then scan again.','If you are scanning a list, do ten stores at a time.']};
  if(/too long|timed? ?out|aborted/.test(m))return {t:'The scan took too long',next:['Paste a direct product link instead of the homepage.','Try again in a minute. Slow stores sometimes need a second attempt.']};
  if(/dns|resolve|not found|enotfound|could not find|reach/.test(m))return {t:'Verta could not reach this store',next:['Check the address for typos.','Open the address in your browser to confirm the store is online.']};
  if(/block|forbidden|403|robot|denied|captcha/.test(m))return {t:'The store blocked the request',next:['Some stores block automated visitors. Try a direct product link.','If it is your store, allow the user agent VertaScanner.']};
  if(/address|http|port|redirect|private|enter|website|username/.test(m))return {t:'That address cannot be scanned',next:['Use a public store address such as yourstore.com.','Remove ports, passwords or private network addresses.']};
  return {t:'The scan did not finish',next:['Try again in a moment.','If it keeps failing, paste a direct product link.']};
}
function ScanError(msg,status){const c=classifyError(msg,status);return `<div class="card err-card" role="alert"><h2 class="card-h t-blind">${esc(c.t)}</h2><p class="muted" style="margin:6px 0 0">${esc(msg||'')}</p><p style="margin:12px 0 0;font-weight:600">What to do</p><ul>${c.next.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><button class="btn secondary sm" id="retry">Try again</button></div>`}
async function scanUrl(url,ms=40000,signal){
  const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),ms);
  if(signal)signal.addEventListener('abort',()=>ctl.abort());
  try{const res=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json','x-verta-key':getKey()},body:JSON.stringify({url}),signal:ctl.signal});
    const d=await res.json().catch(()=>({error:'The scanner returned an unreadable answer.'}));if(res.status===401){clearKey()}if(!res.ok){const e=new Error(d.error||'Scan failed.');e.status=res.status;throw e}return d}
  catch(e){if(e.name==='AbortError'){const x=new Error(signal&&signal.aborted?'Scan cancelled.':'The scan took too long.');x.cancelled=!!(signal&&signal.aborted);throw x}throw e}finally{clearTimeout(to)}
}
