const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CFG=window.VERTA_CONFIG||{};
const COL={ready:'var(--ready)',compatible:'var(--compat)',friction:'var(--fric)',blind:'var(--blind)',inconclusive:'var(--mut)'};
const colFor=n=>n==null?'var(--mut)':n>=80?COL.ready:n>=60?COL.compatible:n>=40?COL.friction:COL.blind;
const SHORT=['Find','Meaning','Data','Stock','Price','Rules','Pages','Buy'];
const CAN=['find your store','understand your descriptions','read your product data','tell what is in stock','read your prices','check your shipping and return rules','use your pages','complete a purchase'];
const CANT=['find your store','understand your descriptions','read your product data','tell what is in stock','read your prices','check your shipping and return rules','use your pages reliably','complete a purchase'];

function verdict(r){
  if(r.state.key==='inconclusive')return 'We could read your homepage but not a product page, so this covers the storefront only. Paste a direct product link for a real result.';
  const ls=r.layers.map((l,i)=>({i,s:l.score})).filter(x=>x.s!=null);
  if(ls.length<2)return r.state.line;
  const hi=ls.reduce((a,b)=>b.s>a.s?b:a),lo=ls.reduce((a,b)=>b.s<a.s?b:a);
  if(lo.s>=80)return 'An AI shopping assistant can find, read and buy from this store without trouble.';
  if(hi.s-lo.s<12)return `An AI shopping assistant gets partway: scores are fairly even, so no single layer is the problem. Work through the fixes below in order.`;
  return `An AI shopping assistant can ${CAN[hi.i]}, but may not ${CANT[lo.i]}.`;
}
function profile(r){
  return `<div class="profile" role="img" aria-label="Score for each layer">${r.layers.map((l,i)=>{const nt=l.score==null;return `<div class="col"><b>${nt?'-':l.score}</b><i class="${nt?'nt':''}" style="height:${nt?100:Math.max(l.score,4)}%;background:${colFor(l.score)};animation-delay:${i*50}ms"></i></div>`}).join('')}</div><div class="names">${r.layers.map((l,i)=>`<span>${SHORT[i]||esc(l.name)}</span>`).join('')}</div>`;
}
function checkHtml(c){
  const sev=c.sev?`<span class="sev ${c.sev.toLowerCase()}">${c.sev}</span>`:'';
  const pts=(c.status==='na'||c.status==='info')?'':c.status==='unsure'?`<span class="mut small">couldn't tell</span>`:`<span class="mut small">${c.pts}/${c.max}</span>`;
  return `<div class="chk"><div class="t"><span class="dot ${c.status}"></span><span>${sev}${esc(c.title)} ${pts}</span></div><p><b>What we saw.</b> ${esc(c.evidence)}</p>${c.impact?`<p><b>Why it matters.</b> ${esc(c.impact)}</p>`:''}${c.fix?`<p><b>Fix.</b> ${esc(c.fix)}</p>`:''}${c.code?`<pre>${esc(c.code)}</pre>`:''}</div>`;
}
function topChecks(r){const all=r.layers.flatMap(l=>l.checks);return r.top.map(id=>all.find(c=>c.id===id)).filter(Boolean)}
function emailMsg(r){
  const lines=topChecks(r).slice(0,3).map((c,i)=>`${i+1}. ${c.title}: ${c.evidence}`).join('\n');
  const me=CFG.senderName?`\n\n${CFG.senderName}`:'';
  return `Subject: How AI shopping assistants see ${r.meta.host}\n\nHi,\n\nI ran ${r.meta.host} through a free check of how well AI shopping assistants can find, understand and buy from a store. It scored ${r.score}/100 (${r.state.label}).\n\nThe three things costing you the most:\n${lines||'No major problems found.'}\n\nEach one has a straightforward fix. I can send the full report (it is short) or walk through it in 15 minutes. No charge.${me}`;
}
function dmMsg(r){
  const t=topChecks(r)[0];
  return `Hi, I checked ${r.meta.host} for how AI shopping assistants see it: ${r.score}/100. Biggest issue: ${t?t.title.toLowerCase():'nothing major'}${t&&t.fix?` (${t.fix.split('. ')[0].replace(/\.$/,'')})`:''}. Happy to send the short report if useful.${CFG.senderName?' - '+CFG.senderName:''}`;
}
function reportText(r){
  let t=`Verta Readiness Report: ${r.meta.host}\nScore ${r.score}/100, ${r.state.label}. ${verdict(r)}\nConfidence: ${r.meta.confidence}. Platform: ${r.meta.platform}.\n\n`;
  for(const l of r.layers){t+=`${l.name}: ${l.score==null?'not tested':l.score+'/100'}\n`;for(const c of l.checks)if(c.status==='fail'||c.status==='warn')t+=`  - [${c.sev}] ${c.title}: ${c.evidence} Fix: ${c.fix}\n`}
  return t+'\nVerta scores are a working framework, not a certification.';
}
function ctaHtml(r){
  if(!CFG.bookingUrl&&!CFG.contactEmail)return '';
  const subj=encodeURIComponent(`${CFG.offerName||'Agent audit'} for ${r.meta.host}`),body=encodeURIComponent(`Hi, I scanned ${r.meta.host} (${r.score}/100) and would like the full audit.`);
  const href=CFG.bookingUrl||`mailto:${CFG.contactEmail}?subject=${subj}&body=${body}`;
  return `<div class="panel cta noprint"><h2>Want an agent to actually try buying from ${esc(r.meta.host)}?</h2><p>${esc(CFG.offerLine||'')}</p><div class="row"><a class="btn" href="${esc(href)}">${CFG.bookingUrl?'Book a call':'Ask for the full audit'}</a></div></div>`;
}
function render(r,out){
  const col=COL[r.state.key],all=r.layers.flatMap(l=>l.checks);
  const notes=(r.meta.notes||[]).map(n=>`<div class="note">${esc(n)}</div>`).join('');
  const fixes=topChecks(r).map(c=>`<div class="fix ${(c.sev||'P2').toLowerCase()}"><b>${esc(c.title)}</b><span>${esc(c.fix)}</span></div>`).join('')||'<p class="mut">Nothing urgent found.</p>';
  out.innerHTML=`
  <section class="panel sum"><div class="big" style="color:${col}">${r.score}<small>/100</small></div><div><p class="state" style="color:${col}">${esc(r.state.label)}</p><p class="verdict">${esc(verdict(r))}</p></div>
    <div class="meta">${esc(r.meta.host)}, ${esc(r.meta.platform)}, confidence ${esc(r.meta.confidence)}. ${r.counts.P0} critical, ${r.counts.P1} important, ${r.counts.P2} minor${r.counts.unsure?`, ${r.counts.unsure} we couldn't tell`:''}.</div>${notes}</section>
  <section class="panel"><h2 style="margin-top:0">How an agent scores each layer</h2>${profile(r)}</section>
  <h2>Fix these first</h2><section class="panel">${fixes}</section>
  ${ctaHtml(r)}
  <h2>Every check</h2><section class="panel" style="padding-top:6px;padding-bottom:6px">${r.layers.map(l=>`<details class="layer"><summary><span class="lname">${esc(l.name)}</span><span class="lscore" style="color:${colFor(l.score)}">${l.score==null?'not tested':l.score}</span><span class="lq">${esc(l.question)}</span></summary>${l.checks.map(checkHtml).join('')}</details>`).join('')}</section>
  <section class="panel noprint"><h2 style="margin-top:0">Message for the store owner</h2><p class="mut small">Written from this report. Edit before sending.</p>
    <div class="row" role="tablist"><button class="btn ghost" data-t="email" aria-pressed="true">Email</button><button class="btn ghost" data-t="dm" aria-pressed="false">Short DM</button></div>
    <textarea id="msg" aria-label="Message">${esc(emailMsg(r))}</textarea><div class="row"><button class="btn ghost" id="cm">Copy message</button></div></section>
  <div class="row noprint"><button class="btn ghost" id="cr">Copy report</button><button class="btn ghost" id="sh">Copy share link</button><button class="btn ghost" id="pr">Print or save as PDF</button></div><p class="mut small" id="tip" aria-live="polite"></p>`;
  const tip=m=>{const t=$('#tip');t.textContent=m;setTimeout(()=>{t.textContent=''},2500)};
  const copy=async t=>{try{await navigator.clipboard.writeText(t);tip('Copied.')}catch(e){tip('Copy failed. Select the text and copy it by hand.')}};
  out.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{out.querySelectorAll('[data-t]').forEach(x=>x.setAttribute('aria-pressed',x===b));$('#msg').value=b.dataset.t==='dm'?dmMsg(r):emailMsg(r)});
  $('#cm').onclick=()=>copy($('#msg').value);$('#cr').onclick=()=>copy(reportText(r));$('#pr').onclick=()=>window.print();
  $('#sh').onclick=()=>{try{const b=btoa(unescape(encodeURIComponent(JSON.stringify(r)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');copy(location.origin+location.pathname+'#r='+b)}catch(e){tip('Could not build the link.')}};
}
async function scanUrl(url,ms=40000){
  const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),ms);
  try{const res=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url}),signal:ctl.signal});
    const d=await res.json().catch(()=>({error:'The scanner returned an unreadable answer.'}));if(!res.ok)throw new Error(d.error||'Scan failed.');return d}
  catch(e){throw new Error(e.name==='AbortError'?'The scan took too long. Try a direct product link.':e.message)}finally{clearTimeout(to)}
}
