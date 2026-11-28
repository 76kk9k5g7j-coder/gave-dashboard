(async function(){
let D = window.GAVE_DATA;
if(!D){ // repli : lecture des JSON via un serveur
  D = {}; for (const k of ['meta','g15','g17','g23','profits','cac','dette','depenses','change','rente','export','quadrants','wicksell','frbonds','surachat','sources']) { try{ D[k]=await (await fetch('data/'+k+'.json')).json(); }catch(e){} }
  D.last_updated = D.meta && D.meta.last_updated;
}
const MOIS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const fm = p => { if(!p) return '—'; const [y,m]=p.split('-'); return MOIS[+m-1]+' '+y; };
const pct = x => (x>=0?'+':'')+(x*100).toFixed(1).replace('.',',')+' %';
const num = (x,d=1) => x.toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d});
const LBL = {or:'OR', obligations:'OBLIGATIONS', actions:'ACTIONS'};
const upd = new Date(D.last_updated);
document.getElementById('upd').textContent = isNaN(upd)? D.last_updated : upd.toLocaleString('fr-FR',{dateStyle:'long',timeStyle:'short'});
const dark = {paper_bgcolor:'#161b22',plot_bgcolor:'#0d1117',font:{color:'#e6edf3',size:12},margin:{l:50,r:14,t:10,b:40},
  legend:{orientation:'h',y:-0.15},xaxis:{gridcolor:'#21262d'},yaxis:{gridcolor:'#21262d',type:'log'},hovermode:'x unified'};
const cfg = {responsive:true,displaylogo:false,modeBarButtonsToRemove:['lasso2d','select2d']};
const toDate = p => p.length===7? p+'-01' : p;
// ---------- Bulles d'information (survol souris / appui sur mobile) + périodes, zoom, déplacement, plein écran
const TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
const YR = 365.25*864e5;
const toY = x => { if(typeof x==='number') return x; let s=String(x); if(s.length===7) s+='-01';
  s = s.length===10 ? s+'T00:00:00Z' : s.replace(' ','T')+'Z'; return Date.parse(s)/YR+1970; };
const fromY = (v,isDate) => isDate ? new Date((v-1970)*YR).toISOString().replace('T',' ').slice(0,19) : v;
const PERIODS = [['1 mois',1/12],['3 mois',0.25],['6 mois',0.5],['1 an',1],['5 ans',5],['10 ans',10],['20 ans',20],['30 ans',30]];
const MINPTS = 6; // un bouton de période n'est affiché que si la fenêtre contient au moins 6 points
const yAxes = gd => Object.keys(gd._fullLayout).filter(k=>/^yaxis\d*$/.test(k));
function plot(id, traces, layout, _cfg, opt={}){
  layout = JSON.parse(JSON.stringify(layout)); // copie : Plotly modifie les axes en place et `dark` est partagé entre graphiques
  const xf = opt.xfmt===undefined ? '%B %Y' : opt.xfmt;
  traces.forEach(t=>{
    if(!t.hovertemplate && t.hoverinfo!=='skip'){ const u=t.u!==undefined?t.u:(opt.unit||''), f=t.f||opt.yfmt||',.2f';
      const xs = (opt.hovermode==='closest') ? ((t.xf||xf) ? '%{x|'+(t.xf||xf)+'}' : '%{x}') + ' — ' : '';
      t.hovertemplate = '<b>'+t.name+'</b> : '+xs+'%{y:'+f+'}'+u+'<extra></extra>'; }
    delete t.u; delete t.f; delete t.xf; });
  const L = {...layout, hovermode: opt.hovermode||'x unified', dragmode: TOUCH?false:'zoom', hoverdistance: 60, spikedistance: -1,
    hoverlabel:{bgcolor:'#0d1117',bordercolor:'#8b949e',font:{color:'#e6edf3',size:13},namelength:-1},
    xaxis:{...(dark.xaxis||{}), ...(layout.xaxis||{}), ...(xf?{hoverformat:xf}:{}), showspikes:true, spikemode:'across', spikethickness:1, spikecolor:'#8b949e', spikedash:'dot'}};
  // molette désactivée par défaut (elle capturerait le défilement de la page) ; activée en plein écran sur ordinateur
  const C = {responsive:true, displaylogo:false, locale:'fr', scrollZoom:false, displayModeBar: !TOUCH, doubleClick:'reset',
    modeBarButtonsToRemove:['lasso2d','select2d','autoScale2d','zoomIn2d','zoomOut2d']};
  const el = document.getElementById(id), wrap = ensureWrap(el);
  return Plotly.newPlot(el, traces, L, C).then(gd=>{
    gd._gvC = C; initView(gd, wrap);
    if(TOUCH && !gd._touchHooked){ gd._touchHooked=true; addTouchHover(gd); }
    return gd; });
}
// Barre d'outils au-dessus de chaque graphique
function ensureWrap(el){
  if(el.parentNode.classList.contains('cwrap')) return el.parentNode;
  const w=document.createElement('div'); w.className='cwrap'; el.parentNode.insertBefore(w, el);
  const bar=document.createElement('div'); bar.className='ctools';
  bar.innerHTML=`<div class="per" role="group" aria-label="Période"></div><div class="act">
   <button type="button" data-a="in" title="Zoomer" aria-label="Zoomer">＋</button><button type="button" data-a="out" title="Dézoomer" aria-label="Dézoomer">－</button>
   <button type="button" data-a="pan" aria-pressed="false" title="Glisser pour déplacer la période">✋ Déplacer</button>
   <button type="button" data-a="reset" title="Revenir à la vue complète">⟲ Réinitialiser</button>
   <button type="button" data-a="fs" class="fsb" title="Plein écran">⛶ Plein écran</button></div>`;
  w.append(bar, el);
  bar.addEventListener('click', ev=>{ const b=ev.target.closest('button'); if(!b) return; const gd=el; if(!gd._gv) return;
    if(b.dataset.p!==undefined) applyPeriod(gd, b.dataset.p==='all'?'all':+b.dataset.p);
    else ({in:()=>zoomBy(gd,0.5), out:()=>zoomBy(gd,2), pan:()=>setPan(gd,!gd._gv.pan), reset:()=>applyPeriod(gd,'all'), fs:()=>toggleFS(w,gd)})[b.dataset.a]();
  });
  return w;
}
function initView(gd, wrap){
  const tx = gd.data.map(t=>Array.isArray(t.x)? t.x.map(toY) : null);
  let xmin=Infinity,xmax=-Infinity,dense=null;
  tx.forEach(a=>{ if(!a||!a.length) return; for(const v of a){ if(v<xmin) xmin=v; if(v>xmax) xmax=v; } if(!dense||a.length>dense.length) dense=a; });
  const sp = dense? dense.slice(1).map((v,i)=>v-dense[i]).sort((a,b)=>a-b) : [1];
  const step = sp.length? sp[sp.length>>1] : 1, fine = step < 0.12;  // fine = mensuel ou plus fin
  const orig={}; yAxes(gd).forEach(k=>{ const r=gd.layout[k]&&gd.layout[k].range; orig[k]= r? r.slice() : null; });
  const prev = gd._gv || {};
  gd._gv = {tx, xmin, xmax, step, isDate: gd._fullLayout.xaxis.type==='date', orig, pan:false, busy:false, period:'all', wrap};
  // périodes proposées : mensuel → jusqu'à 20 ans ; annuel → 10, 20, 30 ans. On masque celles qui donneraient < 6 points
  // ou qui couvrent déjà tout l'historique.
  const cand = fine ? PERIODS.filter(p=>p[1]<=20) : PERIODS.filter(p=>p[1]>=10);
  const avail = cand.filter(([_,p])=> p < (xmax-xmin)*0.95 && dense && dense.filter(v=>v>=xmax-p-1e-6).length>=MINPTS);
  gd._gv.periods = avail.map(p=>p[1]);
  wrap.querySelector('.per').innerHTML = avail.map(([l,p])=>`<button type="button" data-p="${p}">${l}</button>`).join('') + `<button type="button" data-p="all">Tout</button>`;
  gd.on('plotly_relayout', ev=>onRelayout(gd, ev));
  if(prev.pan) setPan(gd, true);
  if(prev.period && prev.period!=='all' && gd._gv.periods.includes(prev.period)) applyPeriod(gd, prev.period); else markPeriod(gd,'all');
}
function markPeriod(gd, p){ gd._gv.period=p; gd._gv.wrap.querySelectorAll('.per button').forEach(b=>b.classList.toggle('on', p!==null && String(b.dataset.p)===String(p))); }
function fitY(gd, x0, x1){
  const by={}, out={};
  gd.data.forEach((t,i)=>{ const a=gd._gv.tx[i]; if(!a||!t.y||t.visible===false||t.visible==='legendonly') return;
    const ax = t.yaxis||'y', s = by[ax]||(by[ax]={lo:Infinity,hi:-Infinity,bar:false}); if(t.type==='bar') s.bar=true;
    const log = (gd._fullLayout[ax==='y'?'yaxis':'yaxis'+ax.slice(1)]||{}).type==='log';
    for(let k=0;k<a.length;k++){ if(a[k]<x0||a[k]>x1) continue; let y=t.y[k]; if(y==null||!isFinite(y)) continue; y=+y;
      if(log){ if(y<=0) continue; y=Math.log10(y); } if(y<s.lo) s.lo=y; if(y>s.hi) s.hi=y; }
    if(s.bar && !log){ s.lo=Math.min(s.lo,0); s.hi=Math.max(s.hi,0); } });
  for(const [ax,s] of Object.entries(by)){ if(!isFinite(s.lo)) continue; const k = ax==='y'?'yaxis':'yaxis'+ax.slice(1);
    const pad = (s.hi-s.lo)*0.07 || Math.max(Math.abs(s.hi)*0.05, 0.05); out[k+'.range']=[s.lo-pad, s.hi+pad]; }
  return out;
}
function relay(gd, upd){ const st=gd._gv; st.busy=true; return Plotly.relayout(gd, upd).catch(()=>{}).finally(()=>{ st.busy=false; }); }
function setRange(gd, x0, x1){ const st=gd._gv;
  return relay(gd, {'xaxis.range':[fromY(x0,st.isDate), fromY(x1,st.isDate)], ...fitY(gd, x0, x1)}); }
function applyPeriod(gd, p){ const st=gd._gv;
  if(p==='all'){ const upd={'xaxis.autorange':true}; for(const [k,r] of Object.entries(st.orig)) upd[k+(r?'.range':'.autorange')] = r? r.slice() : true;
    markPeriod(gd,'all'); return relay(gd, upd); }
  markPeriod(gd,p); return setRange(gd, st.xmax-p-st.step*0.5, st.xmax+st.step*0.5);
}
function curX(gd){ const r=gd._fullLayout.xaxis.range; return [toY(r[0]), toY(r[1])]; }
function zoomBy(gd, f){ const st=gd._gv, [a,b]=curX(gd), full=(st.xmax-st.xmin)+st.step;
  let h=Math.max((b-a)/2*f, st.step*3), c=(a+b)/2; if(2*h>=full) return applyPeriod(gd,'all');
  if(b>=st.xmax) c=st.xmax+st.step/2-h; // vue collée à la fin des données : on garde le dernier point visible
  c=Math.min(Math.max(c, st.xmin-st.step/2+h), st.xmax+st.step/2-h); markPeriod(gd,null); return setRange(gd, c-h, c+h); }
function setPan(gd, on){ const st=gd._gv; st.pan=on;
  const upd={dragmode: on?'pan':(TOUCH?false:'zoom')}; yAxes(gd).forEach(k=>upd[k+'.fixedrange']=on);  // déplacement horizontal seulement, axe vertical recalé
  st.wrap.classList.toggle('panning', on); const b=st.wrap.querySelector('[data-a="pan"]'); b.setAttribute('aria-pressed', on); b.classList.toggle('on', on);
  return relay(gd, upd); }
function onRelayout(gd, ev){ const st=gd._gv; if(!st||st.busy) return; const ks=Object.keys(ev);
  if(ev['xaxis.autorange']){ markPeriod(gd,'all'); // double-clic Plotly : on restaure les échelles d'origine
    const upd={}; for(const [k,r] of Object.entries(st.orig)) if(r) upd[k+'.range']=r.slice(); if(Object.keys(upd).length) relay(gd, upd); return; }
  const xk = ks.some(k=>k.startsWith('xaxis.range')), yk = ks.some(k=>/^yaxis\d*\.range/.test(k));
  if(xk){ markPeriod(gd,null); if(!yk){ const [a,b]=curX(gd); relay(gd, fitY(gd,a,b)); } }
}
// Plein écran : API Fullscreen si disponible, sinon calque CSS couvrant tout l'écran (iPhone)
let FSW=null;
function toggleFS(w, gd){ if(FSW) exitFS(); else enterFS(w, gd); }
function enterFS(w, gd){ FSW=w; w.classList.add('fs'); document.body.classList.add('noscroll');
  w.querySelector('.fsb').textContent='✕ Fermer'; w.querySelector('.fsb').title='Quitter le plein écran (Échap)';
  const after=()=>{ try{ screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(()=>{}); }catch(e){} };
  if(w.requestFullscreen && !w._noNative){ w.requestFullscreen({navigationUI:'hide'}).then(after).catch(()=>{}); }
  else if(w.webkitRequestFullscreen){ try{ w.webkitRequestFullscreen(); }catch(e){} }
  gd._legY = gd.layout.legend && gd.layout.legend.y; if(gd._legY!=null && gd._legY<0) relay(gd, {'legend.y': -0.06});
  setWheel(gd, true); resizeSoon(gd);
}
function exitFS(){ const w=FSW; if(!w) return; FSW=null; const gd=w.querySelector('.js-plotly-plot');
  w.classList.remove('fs'); document.body.classList.remove('noscroll');
  w.querySelector('.fsb').textContent='⛶ Plein écran'; w.querySelector('.fsb').title='Plein écran';
  try{ screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); }catch(e){}
  const fe=document.fullscreenElement||document.webkitFullscreenElement; if(fe){ (document.exitFullscreen||document.webkitExitFullscreen).call(document).catch?.(()=>{}); }
  if(gd){ if(gd._legY!=null && gd._legY<0) relay(gd, {'legend.y': gd._legY}); setWheel(gd,false); resizeSoon(gd); }
}
function setWheel(gd, on){ if(TOUCH || !gd._gvC) return; const st=gd._gv, r=gd._fullLayout.xaxis.range.slice(), per=st.period, pan=st.pan;
  gd._gvC = {...gd._gvC, scrollZoom:on};
  Plotly.react(gd, gd.data, gd.layout, gd._gvC).then(()=>{ gd.on('plotly_relayout', ev=>onRelayout(gd, ev)); st.pan=pan; markPeriod(gd, per); });
}
function resizeSoon(gd){ requestAnimationFrame(()=>{ Plotly.Plots.resize(gd); setTimeout(()=>Plotly.Plots.resize(gd),250); }); }
['fullscreenchange','webkitfullscreenchange'].forEach(e=>document.addEventListener(e, ()=>{
  const fe=document.fullscreenElement||document.webkitFullscreenElement; if(!fe && FSW) exitFS(); else if(fe){ const gd=fe.querySelector('.js-plotly-plot'); gd&&resizeSoon(gd); } }));
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && FSW) exitFS(); });
window.addEventListener('orientationchange', ()=>{ if(FSW){ const gd=FSW.querySelector('.js-plotly-plot'); gd&&setTimeout(()=>Plotly.Plots.resize(gd),300); } });

// Sur écran tactile : un appui (ou un appui long en glissant le doigt) affiche la bulle au point touché.
// En mode « Déplacer », le doigt fait glisser la période et la bulle est mise en pause. Double appui = vue complète.
function addTouchHover(gd){
  let last=null, t0=null, moved=false, lastTap=0, lastTapXY=null;
  const show = ()=>{ if(!last || (gd._gv&&gd._gv.pan)) return; const d=gd._dragging; gd._dragging=false;
    try{ Plotly.Fx.hover(gd, last); } finally { gd._dragging=d; } };
  const pos = ev=>{
    const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]); if(!t) return null;
    const area = gd.querySelector('.nsewdrag'); if(!area) return null;
    const bb = area.getBoundingClientRect(), xpx=t.clientX-bb.left, ypx=t.clientY-bb.top;
    return (xpx<0||xpx>bb.width||ypx<0||ypx>bb.height) ? null : {xpx, ypx, cx:t.clientX, cy:t.clientY};
  };
  gd.addEventListener('touchstart', ev=>{ last=pos(ev); t0=last; moved=false; if(ev.touches.length===1) show(); }, {passive:true, capture:true});
  gd.addEventListener('touchmove',  ev=>{ const p=pos(ev); if(p){ if(t0 && Math.hypot(p.cx-t0.cx,p.cy-t0.cy)>12) moved=true; last=p; show(); } }, {passive:true, capture:true});
  gd.addEventListener('touchend', ()=>{
    const now=Date.now();
    if(!moved && t0){ if(now-lastTap<320 && lastTapXY && Math.hypot(t0.cx-lastTapXY.cx,t0.cy-lastTapXY.cy)<40){ lastTap=0; Plotly.Fx.unhover(gd); applyPeriod(gd,'all'); return; }
      lastTap=now; lastTapXY=t0; }
    // après le relâchement, Plotly efface la bulle : on la réaffiche pour qu'elle reste lisible
    setTimeout(show, 60); }, {passive:true, capture:true});
}

function recentFlips(ev, months=24){
  const lim = new Date(); lim.setMonth(lim.getMonth()-months);
  return ev.filter(e=>new Date(toDate(e.date))>=lim).length;
}
function ruleChart(id, g, colA, nameRatio, labelUp, labelDown){
  const x = g.dates.map(toDate), i = {}; g.dates.forEach((d,k)=>i[d]=k);
  const up = g.events.filter(e=>e.to===labelUp), dn = g.events.filter(e=>e.to===labelDown);
  const tr = [
    {x, y:g.ratio, name:nameRatio, line:{color:'#f85149',width:1.6}},
    {x, y:g.ma, name:'Moyenne mobile 7 ans', line:{color:'#58a6ff',width:2}},
    {x:up.map(e=>toDate(e.date)), y:up.map(e=>g.ratio[i[e.date]]), mode:'markers', name:'Passage au-dessus → '+labelUp, hoverinfo:'skip',
     marker:{symbol:'triangle-up',size:10,color:'#3fb950'}},
    {x:dn.map(e=>toDate(e.date)), y:dn.map(e=>g.ratio[i[e.date]]), mode:'markers', name:'Passage en dessous → '+labelDown, hoverinfo:'skip',
     marker:{symbol:'triangle-down',size:10,color:'#e3b341'}}];
  plot(id, tr, dark, cfg, {yfmt:'.4~r'});
}
function curCard(el, g, title){
  const c = g.current, flips = recentFlips(g.events);
  const near = Math.abs(c.gap_pct) < 0.05;
  document.getElementById(el).innerHTML = `
   <div class="sig"><div class="sub">${title} — règle de Gave</div><div class="big ${c.signal}">${LBL[c.signal]}</div>
   <div>Ratio <b>${c.above?'au-dessus':'en dessous'}</b> de sa moyenne 7 ans depuis <b>${fm(c.since)}</b></div></div>
   <div class="sig"><div class="sub">Dernier point (${fm(c.date)})</div><div>Ratio : <b>${num(c.ratio)}</b> · Moyenne 7 ans : <b>${num(c.ma)}</b></div>
   <div>Écart : <b>${pct(c.gap_pct)}</b> ${near?'<span class="warn">— proche du seuil, signal fragile</span>':''}</div>
   <div class="sub">${flips} croisement(s) sur les 24 derniers mois</div></div>`;
}
function btTable(el, g, nA, nB){
  const b = g.backtest, r = s => `<td>${pct(s.cagr)}</td><td>${pct(s.maxdd)}</td>`;
  document.getElementById(el).innerHTML = `<details><summary>Test historique mécanique (depuis ${fm(b.start)}, sans frais ni impôts)</summary>
  <table><tr><th></th><th>Rendement annuel moyen</th><th>Pire baisse</th></tr>
  <tr><td>Règle appliquée chaque mois</td>${r(b.rule)}</tr><tr><td>Toujours ${nA}</td>${r(b.hold_above)}</tr><tr><td>Toujours ${nB}</td>${r(b.hold_below)}</tr></table>
  <p class="sub">Signal lu en fin de mois, appliqué le mois suivant, 100 % dans un actif ou dans l'autre. Résultat <b>en dollars</b>, flatté : la durée de 7 ans a été choisie <i>après coup</i> en regardant ces mêmes données. Les allers-retours, les frais, la fiscalité et le change EUR/USD ne sont pas comptés. Ce test ne prouve pas que la règle marchera à l'avenir.</p></details>`;
}

// Graphique 15 & 17
const g15=D.g15, g17=D.g17;
ruleChart('c15', g15, '#e3b341', 'Ratio or / obligations US', 'or', 'obligations');
ruleChart('c17', g17, '#3fb950', 'Ratio S&P 500 TR / or', 'actions', 'or');
curCard('cur15', g15, 'Or ou obligations'); curCard('cur17', g17, 'Actions ou or');
btTable('bt15', g15, 'en or', 'en obligations US'); btTable('bt17', g17, 'en actions US', 'en or');

// Synthèse
const s15=g15.current.signal, s17=g17.current.signal;
let comb;
if(s17==='or' && s15==='or') comb = "Les deux règles vont dans le même sens : <b class='or'>l'or</b> fait mieux que les actions (graphique 17) et que les obligations (graphique 15).";
else if(s17==='actions' && s15==='or') comb = "Le graphique 17 dit de garder des <b class='actions'>actions</b> (au moins ~33 %). Le graphique 15 préfère l'<b class='or'>or</b> aux obligations pour le reste.";
else if(s17==='actions' && s15==='obligations') comb = "Régime de désinflation : selon les deux règles, <b class='actions'>actions</b> et <b class='obligations'>obligations</b> passent devant l'or.";
else comb = "Signaux en partie contradictoires : le graphique 17 préfère l'<b class='or'>or</b> aux actions, mais le graphique 15 préfère les <b class='obligations'>obligations</b> à l'or.";
const fragile = [g15,g17].filter(g=>Math.abs(g.current.gap_pct)<0.05).length;
document.getElementById('synth').innerHTML = [[g15,'Graphique 15 · Or vs obligations'],[g17,'Graphique 17 · Actions vs or']].map(([g,t])=>
 `<div class="sig"><div class="sub">${t}</div><div class="big ${g.current.signal}">${LBL[g.current.signal]}</div>
  <div>depuis ${fm(g.current.since)} · écart à la moyenne ${pct(g.current.gap_pct)}</div></div>`).join('') +
 (D.g23? `<div class="sig"><div class="sub">Graphique 23 · Dividendes S&amp;P en or</div><div class="big">${num(D.g23.current.ratio,2)} g</div><div>${D.g23.current.ratio<=D.g23.levels.bas?'zone basse (actions bon marché vs or)':D.g23.current.ratio>=D.g23.levels.haut?'zone haute (actions chères vs or)':'entre les seuils 0,459 g et 1,465 g'} · médiane ${num(D.g23.current.median,2)} g</div></div>`:'') +
 (D.quadrants? `<div class="sig"><div class="sub">Quadrant (hypothèse MM 7 ans)</div><div class="big">${D.quadrants.current.label}</div><div>actifs permis : ${D.quadrants.current.allowed.join(' + ')} · depuis ${fm(D.quadrants.current.since)}</div></div>`:'') +
 (D.wicksell? `<div class="sig"><div class="sub">Wicksell · 10 ans US vs croissance</div><div class="big ${D.wicksell.current.signal}">${LBL[D.wicksell.current.signal]}</div><div>${num(D.wicksell.current.taux,2)} % contre ${num(D.wicksell.current.croissance,2)} %</div></div>`:'') +
 (D.profits? `<div class="sig"><div class="sub">Contexte · Profits US (1 an)</div><div class="big">${pct(D.profits.current.profits/100)}</div>
  <div>emploi US sur 1 an : ${pct(D.profits.current.emploi/100)} (${fm(D.profits.current.emploi_date)})</div></div>`:'') +
 (D.dette? `<div class="sig"><div class="sub">Contexte · Dette publique France</div><div class="big">${num(D.dette.current.q?D.dette.current.q.v:D.dette.current.v)} %</div><div>du PIB (${D.dette.current.q?D.dette.current.q.q.replace('-Q',', T'):D.dette.current.year})</div></div>`:'');
document.getElementById('synthtxt').innerHTML = comb + (fragile? " <span class='warn'>Attention : au moins un ratio est à moins de 5 % de sa moyenne. Dans cette zone, la règle a souvent produit des allers-retours.</span>":"") +
 "<br><span class='sub'>Lecture mécanique des règles publiées par Charles Gave. Information, pas un conseil en investissement.</span>";

// ---------- Tableau des signaux (calculé à partir de data/*.json à chaque chargement)
(function signalTable(){
  const host=document.getElementById('sigtab'); if(!host) return;
  const CASH='Cash / prudence (par défaut)';
  const A = s => `<span class="asset ${s}">${({or:'Or',obligations:'Obligations',actions:'Actions'})[s]}</span>`;
  const A2 = s => `<span class="asset ${s}">${({or:'Or',obligations:'Obligations',actions:'Actions',cash:'Cash'})[s]}</span>`;
  const ctx = '<span class="st ctx">Indéfini / contexte</span>';
  const rows=[];
  const rule = (g, href, name, nm) => { if(!g) return; const c=g.current, near=Math.abs(c.gap_pct)<0.05;
    rows.push({href, name, val:`${num(c.ratio)}<div class="sub">${fm(c.date)}</div>`, ref:`Moyenne mobile 7 ans : ${num(c.ma)}<div class="sub">${nm}</div>`,
      gap:pct(c.gap_pct), st:`<span class="st ok">✅ Validé</span>${near?'<div class="sub warn">à moins de 5 % de la moyenne : signal fragile</div>':''}`,
      asset:A(c.signal)+`<div class="sub">depuis ${fm(c.since)}</div>`, rule:true, sig:c.signal}); };
  rule(D.g15,'g15','Graphique 15 · Or / obligations US','au-dessus → or ; en dessous → obligations');
  rule(D.g17,'g17','Graphique 17 · Actions (S&amp;P 500 TR) / or','au-dessus → actions ; en dessous → or');
  if(D.g23){ const g=D.g23, c=g.current, L=g.levels; let st, asset, gap, sig=null;
    if(c.ratio>=L.haut){ st='<span class="st ok">✅ Validé (zone haute)</span>'; sig='or'; asset=A('or')+'<div class="sub">« vendre les actions et acheter de l\'or »</div>'; gap=pct(c.ratio/L.haut-1)+'<div class="sub">vs 1,465 g</div>'; }
    else if(c.ratio<=L.bas){ st='<span class="st ok">✅ Validé (zone basse)</span>'; sig='actions'; asset=A('actions')+'<div class="sub">« vendre l\'or et acheter des actions »</div>'; gap=pct(c.ratio/L.bas-1)+'<div class="sub">vs 0,459 g</div>'; }
    else { st='<span class="st no">❌ Non validé</span><div class="sub">entre les deux seuils</div>'; asset = (D.quadrants&&D.quadrants.current)? `<span class="sub">aucun seuil atteint → voir le quadrant :</span><div>${D.quadrants.current.allowed.map(a=>`<span class="asset ${a}">${({or:'Or',obligations:'Obligations',actions:'Actions',cash:'Cash'})[a]}</span>`).join(' + ')}</div>` : `<span class="asset cash">${CASH}</span><div class="sub">aucun seuil atteint</div>`;
      const dB=c.ratio/L.bas-1, dH=c.ratio/L.haut-1; gap=`${pct(dB)} <span class="sub">vs 0,459 g</span><div>${pct(dH)} <span class="sub">vs 1,465 g</span></div>`; }
    rows.push({href:'g23', name:'Graphique 23 · Dividendes du S&amp;P 500 en grammes d\'or', val:`${num(c.ratio,3)} g<div class="sub">${fm(c.date)}</div>`,
      ref:'≤ 0,459 g → actions · ≥ 1,465 g → or<div class="sub">repères intermédiaires 0,66 g et 1 g (sans signal)</div>', gap, st, asset, rule:true, sig}); }
  // Articles de Gave (Institut des Libertés)
  const AN={or:'Or',obligations:'Obligations',actions:'Actions',cash:'Cash'}, CH=a=>`<span class="asset ${a}">${AN[a]}</span>`, P2=x=>(x>=0?'+':'')+num(x,2)+' pt';
  const Q=D.quadrants&&D.quadrants.current;
  if(Q){ rows.push({href:'quadrants', name:'Quadrants inflation / croissance (« Les cycles longs »)', val:`<b>${Q.label}</b><div class="sub">${fm(Q.date)} · depuis ${fm(Q.since)}</div>`,
      ref:'Inflation = or / cash au-dessus de sa MM 7 ans<div class="sub">Croissance = actions / or au-dessus de sa MM 7 ans</div><div class="sub warn">MM 7 ans : hypothèse du site, Gave ne donne pas le critère</div>',
      gap:`${pct(Q.gold_cash_gap)} <span class="sub">or/cash</span><div>${pct(Q.r17_gap)} <span class="sub">actions/or</span></div>`,
      st:'<span class="st ok">✅ Validé (hypothèse)</span>', asset:Q.allowed.map(CH).join(' + ')+`<div class="sub">exclus : ${Q.excluded.map(a=>AN[a].toLowerCase()).join(', ')}</div>`, rule:true, sig:null, allowed:Q.allowed}); }
  else rows.push({href:'quadrants',name:'Quadrants inflation / croissance',val:'—',ref:'—',gap:'—',st:'<span class="st no">Données indisponibles</span>',asset:'—'});
  if(D.wicksell){ const c=D.wicksell.current;
    rows.push({href:'wicksell', name:'Règle de Wicksell · 10 ans US vs croissance nominale', val:`${num(c.taux,2)} %<div class="sub">10 ans US, ${fm(c.date)}</div>`,
      ref:`Croissance moyenne du PIB nominal sur 7 ans : ${num(c.croissance,2)} %<div class="sub">taux &lt; croissance → or ; vente de l'or seulement si 10 ans ≥ 5,9 %</div>`,
      gap:P2(c.ecart)+`<div class="sub">${P2(c.taux-5.9)} vs 5,9 %</div>`, st:'<span class="st ok">✅ Validé</span>', asset:CH(c.signal)+`<div class="sub">depuis ${fm(c.since)}</div>`, rule:true, sig:c.signal}); }
  else rows.push({href:'wicksell',name:'Règle de Wicksell',val:'—',ref:'—',gap:'—',st:'<span class="st no">Données indisponibles</span>',asset:'—'});
  if(D.frbonds){ const c=D.frbonds.current;
    rows.push({href:'frbonds', name:'Taux 10 ans France vs moyenne 7 ans', val:`${num(c.taux,2)} %<div class="sub">${fm(c.date)}</div>`, ref:`Moyenne 7 ans : ${num(c.ma,2)} %<div class="sub">au-dessus → pas d'obligations</div>`,
      gap:P2(c.taux-c.ma), st:'<span class="st ok">✅ Validé</span>', asset:c.above?`<span class="asset obligations">Pas d'obligations françaises</span><div class="sub">depuis ${fm(c.since)}</div>`:CH('obligations')+'<div class="sub">permises</div>', rule:true, sig:null, excl:c.above?'obligations':null});
    const R={acheter:['✅ Validé (> 5 %)','Acheter les obligations longues','ok'],neutre:['❌ Non validé (entre 2 et 5 %)','Pas de signal','no'],commencer_vendre:['✅ Validé (entre 1 et 2 %)','Obligations françaises : commencer à vendre','ok'],tout_vendre:['✅ Validé (< 1 %)','Obligations françaises : tout vendre','ok']}[c.real_status];
    rows.push({href:'frbonds', name:'Rendement réel des obligations françaises (« loi de Gresham »)', val:`${num(c.real,2)} %<div class="sub">${num(c.taux_real_date,2)} % − inflation ${num(c.infl,2)} %, ${fm(c.real_date)}</div>`,
      ref:'> 5 % acheter · < 2 % commencer à vendre · < 1 % tout vendre<div class="sub">moyenne de long terme 2 % selon Gave</div>', gap:`${P2(c.real-2)} <span class="sub">vs 2 %</span><div>${P2(c.real-1)} <span class="sub">vs 1 %</span></div>`,
      st:`<span class="st ${R[2]}">${R[0]}</span>`, asset:`<span class="asset obligations">${R[1]}</span>`, rule:true, sig:null, excl:(c.real_status==='commencer_vendre'||c.real_status==='tout_vendre')?'obligations':null}); }
  else rows.push({href:'frbonds',name:'Obligations françaises',val:'—',ref:'—',gap:'—',st:'<span class="st no">Données indisponibles</span>',asset:'—'});
  if(D.surachat){ const c=D.surachat.current;
    rows.push({href:'surachat', name:'Or « suracheté » (hausse ≥ 65 % sur 12 mois)', val:`${pct(c.yoy)}<div class="sub">sur 12 mois, ${fm(c.date)}</div>`, ref:`+65 %<div class="sub">max. des 12 derniers mois : ${pct(c.max_12m)} (${fm(c.max_12m_date)})</div>`,
      gap:P2((c.yoy-0.65)*100).replace(' pt',' pts'), st:c.alert?'<span class="st no">⚠️ Avertissement</span><div class="sub">repli technique probable, pas un signal de vente</div>':'<span class="st ctx">Pas d\'alerte</span><div class="sub">« Avertissement », jamais un signal de vente</div>', asset:'<span class="sub">—</span>'}); }
  else rows.push({href:'surachat',name:'Or « suracheté »',val:'—',ref:'—',gap:'—',st:'<span class="st no">Données indisponibles</span>',asset:'—'});
  const ctxRow = (href,name,val,ref,gap,why) => rows.push({href,name,val,ref,gap,st:ctx+`<div class="sub">${why}</div>`,asset:'<span class="sub">—</span>'});
  if(D.cac){ const c=D.cac.current; ctxRow('cac','CAC 40 en USD / S&amp;P 500',`${num(c.ratio)}<div class="sub">${fm(c.date)} · base 100 = 1999</div>`,`Moyenne 7 ans : ${num(c.ma)}<div class="sub">indicative</div>`,pct(c.ratio/c.ma-1),'pas de règle de décision dans les pages du livre'); }
  if(D.profits){ const c=D.profits.current; ctxRow('profits','Profits US / emploi (sur 1 an)',`${pct(c.profits/100)}<div class="sub">profits, ${fm(c.profits_date)}</div>`,`Emploi : ${pct(c.emploi/100)}<div class="sub">${fm(c.emploi_date)}</div>`,'—','indicateur avancé de l\'emploi, pas de seuil'); }
  if(D.dette){ const c=D.dette.current, v=c.q?c.q.v:c.v; ctxRow('dette','Dette publique France (% du PIB)',`${num(v)} %<div class="sub">${c.q?c.q.q.replace('-Q',', T'):c.year}</div>`,'60 %<div class="sub">plafond de Maastricht, pas une règle de Gave</div>',`${v>=60?'+':''}${num(v-60)} pts`,'aucun seuil d\'investissement chez Gave'); }
  if(D.depenses){ const f=D.depenses.countries.FRA; if(f&&f.total_pct_pib) ctxRow('depenses','Dépense publique France (% du PIB)',`${num(f.total_pct_pib.v)} %<div class="sub">${f.total_pct_pib.year}</div>`,'—','—','comparaison de croissance État / PIB, pas de seuil'); }
  if(D.change){ const c=D.change.current; ctxRow('change','Change effectif de l\'euro (nominal)',`${num(c.nominal)}<div class="sub">${fm(c.date)}</div>`,'100 = octobre 1990<div class="sub">base de l\'indice</div>',pct(c.nominal/100-1),'pas de signal d\'investissement'); }
  if(D.rente){ const c=D.rente.current; ctxRow('rente','Rente française / profits (base 100 en 1981)',`${num(c.rente_fr,0)}<div class="sub">rente, ${fm(c.rente_date)}</div>`,`Profits : ${num(c.profits,0)}<div class="sub">${c.profits_year}</div>`,pct(c.rente_fr/c.profits-1),'lien avec le chômage, pas de seuil'); }
  if(D.export){ const c=D.export.current; ctxRow('export','Part de la France dans les exportations OCDE',`${num(c.fra_idx,0)}<div class="sub">${c.year} · part ${num(c.fra_share,2)} %</div>`,'100 = 1982<div class="sub">base de l\'indice</div>',pct(c.fra_idx/100-1),'indicateur de compétitivité, pas de seuil'); }
  const H=['Indicateur','Valeur actuelle','Référence de la règle','Écart','Statut','Actif désigné'];
  const sigs=[...new Set(rows.filter(r=>r.rule&&r.sig).map(r=>r.sig))];
  const noSig = rows.filter(r=>r.rule&&!r.sig&&!r.allowed&&!r.excl&&/Non validé/.test(r.st)).length;
  const exclB = rows.some(r=>r.excl==='obligations');
  const Qs = D.quadrants&&D.quadrants.current;
  let summary;
  if(Qs){ const conflict=sigs.filter(a=>!Qs.allowed.includes(a));
    summary = `<p><b>Régime selon les quadrants</b> (hypothèse MM 7 ans) : <b>${Qs.label}</b> → ${Qs.allowed.map(A2).join(' + ')} ; exclus : ${Qs.excluded.map(a=>({or:'or',obligations:'obligations',actions:'actions',cash:'cash'})[a]).join(', ')}.
      Règles chiffrées validées : ${sigs.length?sigs.map(A2).join(' · '):'aucune'}${exclB?' · <span class="asset obligations">pas d\'obligations françaises</span>':''}.
      ${conflict.length?`<span class="warn">Contradiction : ${conflict.map(a=>AN[a].toLowerCase()).join(', ')} désigné(es) par une règle mais exclu(es) par le quadrant.</span>`:'Pas de contradiction entre les règles validées et le quadrant.'}</p>
      <p class="sub"><b>Cash</b> : dans ce site, le cash n'est plus seulement un statut par défaut. Il est <b>désigné par le quadrant</b> quand celui-ci l'autorise (bust déflationniste, bust inflationniste) et exclu en boom déflationniste. Quand une règle (graphique 23) n'atteint aucun seuil, elle renvoie au quadrant. Si les données des quadrants manquent, on revient au statut « ${CASH} ». Les indicateurs sans règle chiffrée restent « Indéfini / contexte ». Touchez une ligne pour aller au graphique.<br><b>Information, pas un conseil en investissement.</b></p>`; }
  else summary = `<p>Actifs désignés par les règles chiffrées validées : ${sigs.length? sigs.map(A).join(' · ') : ''}${noSig? (sigs.length?' · ':'')+`<span class="asset cash">${CASH}</span> pour ${noSig} règle(s) sans seuil atteint`:''}${!sigs.length&&!noSig?`<span class="asset cash">${CASH}</span>`:''}.</p>
    <p class="sub"><b>Cash</b> : Gave ne donne pas de seuil chiffré pour le cash. « ${CASH} » est un statut affiché quand aucune règle chiffrée ne désigne l'or, les obligations ou les actions : c'est un statut par défaut, pas une règle. Touchez une ligne pour aller au graphique.<br><b>Information, pas un conseil en investissement.</b></p>`;
  host.innerHTML = `<table class="sigt"><thead><tr>${H.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>`+
    rows.map(r=>`<tr data-href="${r.href}" tabindex="0" role="link" aria-label="Aller au graphique"><td data-l="${H[0]}"><b>${r.name}</b></td>${[r.val,r.ref,r.gap,r.st,r.asset].map((v,i)=>`<td data-l="${H[i+1]}"><div>${v}</div></td>`).join('')}</tr>`).join('')+
    `</tbody></table>${summary}`;
  host.querySelectorAll('tr[data-href]').forEach(tr=>{ const go=()=>document.getElementById(tr.dataset.href).scrollIntoView({behavior:'smooth',block:'start'});
    tr.addEventListener('click', go); tr.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); go(); } }); });
})();

// Profits / emploi
if(D.profits){ const p=D.profits;
 plot('cp',[
  {x:p.profits_lead9.dates,y:p.profits_lead9.v,name:'Profits US, var. 1 an, avancés de 9 mois (éch. gauche)',line:{color:'#e3b341'}},
  {x:p.emploi.dates,y:p.emploi.v,name:'Emploi US, var. 1 an (éch. droite)',yaxis:'y2',line:{color:'#58a6ff'}}],
  {...dark,yaxis:{gridcolor:'#21262d',title:'Profits %',zeroline:true,zerolinecolor:'#444'},
   yaxis2:{overlaying:'y',side:'right',title:'Emploi %',showgrid:false,range:[-6,8]},margin:{l:50,r:50,t:10,b:40}},cfg,{unit:' %',yfmt:'.1f'});
 document.getElementById('curp').innerHTML=`<div class="sig"><div class="sub">Profits après impôts (${fm(p.current.profits_date)}, trimestre)</div><div class="big">${pct(p.current.profits/100)}</div><div class="sub">sur 1 an</div></div>
  <div class="sig"><div class="sub">Emplois non agricoles (${fm(p.current.emploi_date)})</div><div class="big">${pct(p.current.emploi/100)}</div><div class="sub">sur 1 an</div></div>`;
} else document.getElementById('cp').innerHTML='<p class="warn">Données indisponibles (FRED).</p>';

// CAC / S&P
if(D.cac){ const c=D.cac;
 plot('cc',[{x:c.dates.map(toDate),y:c.ratio,name:'CAC 40 en USD / S&P 500',line:{color:'#f85149'}},
  {x:c.dates.map(toDate),y:c.ma,name:'Moyenne mobile 7 ans',line:{color:'#58a6ff'}}],{...dark,yaxis:{gridcolor:'#21262d'}},cfg,{yfmt:'.1f'});
 document.getElementById('curc').innerHTML=`<div class="sig"><div class="sub">Dernier point (${fm(c.current.date)})</div><div class="big">${num(c.current.ratio)}</div>
  <div>${c.current.above?'au-dessus':'en dessous'} de la moyenne 7 ans (${num(c.current.ma)}) depuis ${fm(c.current.since)}</div><div class="sub">Base 100 = janvier 1999 : Paris a fait ${pct(c.current.ratio/100-1)} par rapport à Wall Street (en USD, hors dividendes)</div></div>`;
} else document.getElementById('cc').innerHTML='<p class="warn">Données indisponibles.</p>';


// ---------- Dette France
const CN = {FRA:'France',GBR:'Royaume-Uni',NLD:'Pays-Bas',DEU:'Allemagne'}, CC = {FRA:'#58a6ff',GBR:'#f85149',NLD:'#e3b341',DEU:'#8b949e'};
if(D.dette){ const d=D.dette, ff=d.forecast_from, tr=[];
 for(const [c,s] of Object.entries(d.series)){
  const a=s.years.map((y,i)=>[y,s.v[i]]), act=a.filter(x=>x[0]<ff), fc=a.filter(x=>x[0]>=ff-1);
  const w = c==='FRA'?3:1.3;
  tr.push({x:act.map(x=>x[0]+'-07-01'),y:act.map(x=>x[1]),name:CN[c],line:{color:CC[c],width:w},legendgroup:c});
  tr.push({x:fc.map(x=>x[0]+'-07-01'),y:fc.map(x=>x[1]),name:CN[c]+' (prévision)',line:{color:CC[c],width:w,dash:'dot'},legendgroup:c,showlegend:false});
 }
 if(d.fr_quarterly.length){ const qd=q=>{const [y,qq]=q.split('-Q');return y+'-'+String(qq*3-1).padStart(2,'0')+'-15';};
  tr.push({x:d.fr_quarterly.map(o=>qd(o.q)),y:d.fr_quarterly.map(o=>o.v),mode:'markers',name:'France, trimestriel (Eurostat)',text:d.fr_quarterly.map(o=>o.q.replace('-Q',', T')),hovertemplate:'<b>France %{text}</b> : %{y:.1f} % du PIB<extra></extra>',marker:{color:'#58a6ff',size:6,symbol:'circle-open'}});}
 plot('cd',tr,{...dark,yaxis:{gridcolor:'#21262d',ticksuffix:' %'},
   shapes:[{type:'line',xref:'paper',x0:0,x1:1,y0:60,y1:60,line:{color:'#8b949e',dash:'dash',width:1}}],
   annotations:[{xref:'paper',x:0.01,y:60,text:'60 % (Maastricht)',showarrow:false,yshift:9,font:{color:'#8b949e',size:11}}]},cfg,{xfmt:'%Y',unit:' % du PIB',yfmt:'.1f',hovermode:'closest'});
 const c=d.current, q=c.q;
 document.getElementById('curd').innerHTML=`<div class="sig"><div class="sub">France, fin ${c.year} (AMECO)</div><div class="big">${num(c.v)} %</div><div class="sub">contre ${num(c.first_v)} % en ${c.first_year}</div></div>`+
  (q?`<div class="sig"><div class="sub">Dernier point trimestriel (${q.q.replace('-Q',', T')}, Eurostat)</div><div class="big">${num(q.v)} %</div><div class="sub">données provisoires</div></div>`:'');
} else document.getElementById('cd').innerHTML='<p class="warn">Données indisponibles (AMECO).</p>';

// ---------- Dépenses vs PIB
if(D.depenses){ const S=D.depenses, ff=S.forecast_from, bases=[1960,1978,1982,1995,2000,2010];
 const sel=document.getElementById('baseSel');
 bases.forEach(b=>{const a=document.createElement('a');a.href='#depenses';a.textContent=b;a.style.marginRight='10px';a.dataset.b=b;a.onclick=e=>{e.preventDefault();draw(b);};sel.appendChild(a);});
 const host=document.getElementById('cs');
 host.innerHTML=Object.keys(S.countries).map(c=>`<div><div id="cs_${c}" style="height:320px"></div><div id="csc_${c}" class="sig" style="margin-top:6px"></div></div>`).join('');
 const reb=(ys,vs,b)=>{const i=ys.indexOf(b); if(i<0) return null; const a=[],v=[]; ys.forEach((y,k)=>{if(y>=b&&y<ff){a.push(y);v.push(100*vs[k]/vs[i]);}}); return {x:a,y:v};};
 const cagr=(r)=>r&&r.x.length>1? Math.pow(r.y[r.y.length-1]/100,1/(r.x[r.x.length-1]-r.x[0]))-1 : null;
 function draw(b){
  [...sel.querySelectorAll('a')].forEach(a=>{a.style.fontWeight=(+a.dataset.b===b)?'700':'400';a.style.color=(+a.dataset.b===b)?'#e6edf3':'';});
  for(const [c,v] of Object.entries(S.countries)){
   const g=reb(v.years,v.pib,b), co=reb(v.conso.years,v.conso.v,b), to=v.total?reb(v.total.years,v.total.v,b):null, tr=[];
   if(g) tr.push({x:g.x,y:g.y,name:'PIB en volume',line:{color:'#e6edf3',dash:'dash'}});
   if(co) tr.push({x:co.x,y:co.y,name:'Conso. publique en volume',line:{color:CC[c]}});
   if(to) tr.push({x:to.x,y:to.y,name:'Dépense publique totale en volume',line:{color:'#3fb950'}});
   plot('cs_'+c,tr,{...dark,yaxis:{gridcolor:'#21262d'},margin:{l:40,r:10,t:30,b:30},title:{text:CN[c]+' — base 100 en '+b,font:{size:13}},legend:{orientation:'h',y:-0.18,font:{size:10}}},cfg,{xfmt:null,yfmt:'.1f'});
   const gp=cagr(g), cp=cagr(co), tp=cagr(to), last=g?g.x[g.x.length-1]:'';
   let h=`<div class="sub">Croissance annuelle moyenne ${b}–${last}</div><div>PIB : <b>${gp!=null?pct(gp):'—'}</b> · Conso. publique : <b>${cp!=null?pct(cp):'—'}</b>${tp!=null?` · Dépense totale : <b>${pct(tp)}</b>`:''}</div>`;
   if(v.total_pct_pib) h+=`<div class="sub">Dépense publique totale ${v.total_pct_pib.year} : ${num(v.total_pct_pib.v)} % du PIB</div>`;
   if(!to && v.total) h+=`<div class="sub warn">Dépense totale disponible seulement à partir de ${v.total.years[0]}</div>`;
   if(!v.total) h+=`<div class="sub">Dépense totale non publiée par AMECO pour ce pays</div>`;
   document.getElementById('csc_'+c).innerHTML=h;
  }
 }
 draw(1978);
} else document.getElementById('cs').innerHTML='<p class="warn">Données indisponibles (AMECO).</p>';

// ---------- DM / euro
if(D.change){ const x=D.change;
 plot('cx',[{x:x.nominal.dates.map(toDate),y:x.nominal.v,name:'Nominal (DM puis euro)',line:{color:'#e3b341'}},
   {x:x.reel.dates.map(toDate),y:x.reel.v,name:'Réel (corrigé de l\'inflation)',line:{color:'#58a6ff',width:1.2}}],
  {...dark,yaxis:{gridcolor:'#21262d'},
   shapes:[{type:'line',x0:'1999-01-01',x1:'1999-01-01',yref:'paper',y0:0,y1:1,line:{color:'#8b949e',dash:'dot'}},
           {type:'line',x0:'1990-10-01',x1:'1990-10-01',yref:'paper',y0:0,y1:1,line:{color:'#8b949e',dash:'dot'}}],
   annotations:[{x:'1999-01-01',yref:'paper',y:1,text:'euro',showarrow:false,font:{color:'#8b949e'}},{x:'1990-10-01',yref:'paper',y:1,text:'réunification = 100',showarrow:false,font:{color:'#8b949e'}}]},cfg,{yfmt:'.1f'});
 const c=x.current;
 document.getElementById('curx').innerHTML=`<div class="sig"><div class="sub">Euro, ${fm(c.date)}</div><div class="big">${num(c.nominal)}</div><div class="sub">nominal (base 100 = oct. 1990) · réel : ${num(c.reel)} · sur 1 an : ${pct(c.yoy)}</div></div>
  <div class="sig"><div class="sub">Repères historiques</div><div>Pic du DM : <b>${num(c.dm_peak)}</b> (${fm(c.dm_peak_date)})</div><div>Point bas de l'euro : <b>${num(c.euro_low)}</b> (${fm(c.euro_low_date)})</div></div>`;
} else document.getElementById('cx').innerHTML='<p class="warn">Données indisponibles (BRI).</p>';

// ---------- Graphique 23 : dividendes / or
if(D.g23){ const g=D.g23, x=g.dates.map(toDate), L=g.levels, c=g.current;
 const lv=[[L.haut,'1,465 g','#f85149'],[L.milieu,'1 g','#8b949e'],[L.moyen,'0,66 g','#8b949e'],[L.bas,'0,459 g','#3fb950']];
 plot('c23',[
   {x,y:g.ratio,name:'Dividendes en grammes d\'or',line:{color:'#e3b341',width:1.8},u:' g',f:'.3f'},
   {x,y:g.div,name:'Dividendes en dollars (12 mois)',yaxis:'y2',line:{color:'#58a6ff',width:1.4},u:' $',f:'.2f'}],
  {...dark,yaxis:{gridcolor:'#21262d',type:'log',title:'grammes d\'or',tickvals:[0.25,0.5,1,2,3],ticktext:['0,25','0,5','1','2','3']},yaxis2:{type:'log',overlaying:'y',side:'right',showgrid:false,title:'dollars',tickvals:[0.5,1,2,5,10,20,50,100],ticktext:['0,5','1','2','5','10','20','50','100']},
   margin:{l:55,r:55,t:10,b:40},
   shapes:lv.map(([v,_,col])=>({type:'line',xref:'paper',x0:0,x1:1,y0:v,y1:v,line:{color:col,dash:'dash',width:1}})),
   annotations:lv.map(([v,t,col])=>({xref:'paper',x:0.005,y:Math.log10(v),text:t,showarrow:false,yshift:8,xanchor:'left',font:{color:col,size:11}})).concat(
     [['1999-12','Vendre les actions<br>et acheter de l\'or',-40,-30,'#f85149'],['1980-01','Vendre l\'or et<br>acheter des actions',50,25,'#3fb950'],['1934-01','Dévaluation<br>du dollar (1934)',35,30,'#8b949e']]
     .map(([d,t,ax,ay,col])=>{const k=g.dates.indexOf(d); return {x:toDate(d),y:Math.log10(g.ratio[k]),text:t,showarrow:true,arrowcolor:col,ax,ay,font:{color:col,size:11},bgcolor:'rgba(13,17,23,0.8)'};}))},cfg);
 let zone, cls;
 if(c.ratio>=L.haut){zone='Zone haute (≥ 1,465 g) : selon le graphique du livre, « vendre les actions et acheter de l\'or »';cls='or';}
 else if(c.ratio<=L.bas){zone='Zone basse (≤ 0,459 g) : selon le graphique du livre, « vendre l\'or et acheter des actions »';cls='actions';}
 else {zone='Entre les deux seuils : pas de signal extrême. '+(c.ratio<L.moyen?'Le ratio est sous 0,66 g, plutôt du côté bas (or cher par rapport aux dividendes).':(c.ratio>L.milieu?'Le ratio est au-dessus de 1 g, plutôt du côté haut.':'Le ratio est proche de sa zone habituelle.'));cls='';}
 document.getElementById('cur23').innerHTML=`<div class="sig"><div class="sub">${fm(c.date)}</div><div class="big ${cls}">${num(c.ratio,3)} g</div><div>${zone}</div></div>
  <div class="sig"><div class="sub">Détail</div><div>Dividendes sur 12 mois : <b>${num(c.div,2)} $</b> · or : <b>${num(c.gold_oz,0)} $/once</b> (${num(c.gold_g,2)} $/g)</div>
  <div class="sub">Médiane depuis 1925 : ${num(c.median,2)} g · le ratio a été plus bas que maintenant ${Math.round(c.pct_below*100)} % du temps</div></div>`;
} else document.getElementById('c23').innerHTML='<p class="warn">Données indisponibles.</p>';

// ---------- Articles de Gave (Institut des Libertés) : quadrants, Wicksell, obligations françaises, or suracheté
const nextM = p => { let [y,m]=p.split('-').map(Number); m++; if(m>12){m=1;y++;} return `${y}-${String(m).padStart(2,'0')}-01`; };
const band = (p, col) => ({type:'rect',xref:'x',yref:'paper',x0:toDate(p.start),x1:nextM(p.end),y0:0,y1:1,fillcolor:col,line:{width:0},layer:'below'});
const hline = (y, col, dash='dash', yref='y') => ({type:'line',xref:'paper',x0:0,x1:1,yref,y0:y,y1:y,line:{color:col,dash,width:1}});
const hlab = (y, t, col, yref='y', log=false) => ({xref:'paper',x:0.005,yref,y:log?Math.log10(y):y,text:t,showarrow:false,yshift:8,xanchor:'left',font:{color:col,size:11},bgcolor:'rgba(13,17,23,0.75)'});
const NA = (id, what) => { const e=document.getElementById(id); if(e) e.innerHTML=`<p class="warn">Données indisponibles${what?' ('+what+')':''}.</p>`; };
const QCOL = {boom_defl:'rgba(63,185,80,0.13)', bust_defl:'rgba(88,166,255,0.13)', boom_infl:'rgba(227,179,65,0.13)', bust_infl:'rgba(248,81,73,0.15)'};
const QTXT = {boom_defl:'Boom déflationniste', bust_defl:'Bust déflationniste', boom_infl:'Boom inflationniste', bust_infl:'Bust inflationniste'};
const QRULE = {boom_defl:'ni or ni cash', bust_defl:'ni actions ni or : du cash', boom_infl:'aucune obligation', bust_infl:'ni obligations ni actions : or et cash'};
const ANAME = {or:'Or', obligations:'Obligations', actions:'Actions', cash:'Cash'};
const chip = a => `<span class="asset ${a}">${ANAME[a]}</span>`;
const pt = x => (x>=0?'+':'')+num(x,2)+' pt';

if(D.quadrants){ const q=D.quadrants, c=q.current, x=q.dates.map(toDate);
 const i17={}; D.g17.dates.forEach((d,k)=>i17[d]=k);
 plot('cq',[
   {x,y:q.ratio,name:'Or / cash (bons du Trésor 3 mois capitalisés)',line:{color:'#e3b341',width:1.6},f:'.1f'},
   {x,y:q.ma,name:'Moyenne mobile 7 ans (or / cash)',line:{color:'#58a6ff',width:1.6,dash:'dot'},f:'.1f'},
   {x,y:q.dates.map(d=>D.g17.ratio[i17[d]]),name:'Actions (S&P 500 TR) / or',yaxis:'y2',line:{color:'#3fb950',width:1.6},f:'.1f'},
   {x,y:q.dates.map(d=>D.g17.ma[i17[d]]),name:'Moyenne mobile 7 ans (actions / or)',yaxis:'y2',line:{color:'#58a6ff',width:1.6,dash:'dot'},f:'.1f'}],
  {...dark, margin:{l:55,r:14,t:10,b:40},
   yaxis:{gridcolor:'#21262d',type:'log',domain:[0.53,1],title:{text:'inflation : or / cash',font:{size:11}}},
   yaxis2:{gridcolor:'#21262d',type:'log',domain:[0,0.47],title:{text:'croissance : actions / or',font:{size:11}}},
   shapes:q.periods.map(p=>band(p,QCOL[p.code]))},cfg);
 document.getElementById('curq').innerHTML=`<div class="sig"><div class="sub">Quadrant actuel (${fm(c.date)}) — hypothèse MM 7 ans</div><div class="big">${c.label}</div>
   <div>depuis <b>${fm(c.since)}</b> · Gave : « ${QRULE[c.code]} »</div><div>Actifs permis : ${c.allowed.map(chip).join(' · ')} · exclus : ${c.excluded.map(a=>ANAME[a]).join(', ')}</div></div>
  <div class="sig"><div class="sub">Les deux tests</div><div>Inflation (l'or bat le cash) : <b>${c.inflation?'oui':'non'}</b> · or/cash ${pct(c.gold_cash_gap)} vs sa MM 7 ans</div>
   <div>Croissance (les actions battent l'or) : <b>${c.croissance?'oui':'non'}</b> · actions/or ${pct(c.r17_gap)} vs sa MM 7 ans</div>
   <div class="sub">Cash : taux 3 mois US (FRED TB3MS, dernier ${fm(q.cash_last_rate_date)} : ${num(c.tb3,2)} %), prolongé au dernier taux connu.</div></div>`;
 document.getElementById('qleg').innerHTML=Object.keys(QTXT).map(k=>`<span class="qchip" style="background:${QCOL[k].replace(/0\.1[35]\)/,'0.45)')}">${QTXT[k]}</span>`).join(' ');
 const hist=q.periods.filter(p=>p.end>='1980'), long=hist.filter(p=>{const [a,b]=[p.start,p.end].map(s=>+s.slice(0,4)*12+ +s.slice(5)); return b-a>=11;});
 document.getElementById('qhist').innerHTML=long.map(p=>`<li>${fm(p.start)} → ${fm(p.end)} : <b>${p.label}</b></li>`).join('');
} else NA('cq','FRED TB3MS');

if(D.wicksell){ const w=D.wicksell, c=w.current, x=w.dates.map(toDate);
 plot('cw',[
   {x,y:w.taux,name:'Taux 10 ans US',line:{color:'#58a6ff',width:1.8},u:' %',f:'.2f'},
   {x,y:w.croissance,name:'Croissance annuelle moyenne du PIB nominal US sur 7 ans',line:{color:'#f85149',width:1.8},u:' %',f:'.2f'}],
  {...dark,yaxis:{gridcolor:'#21262d',type:'linear',title:'%'},shapes:w.periods.filter(p=>p.code==='or').map(p=>band(p,'rgba(227,179,65,0.12)')).concat([hline(w.gave_threshold,'#e3b341')]),
   annotations:[hlab(w.gave_threshold,'5,9 % : seuil de vente de l\'or cité par Gave','#e3b341')]},cfg);
 document.getElementById('curw').innerHTML=`<div class="sig"><div class="sub">Règle de Wicksell (${fm(c.date)})</div><div class="big ${c.signal}">${LBL[c.signal]}</div>
   <div>Taux 10 ans <b>${num(c.taux,2)} %</b> ${c.taux<c.croissance?'&lt;':'≥'} croissance nominale moyenne sur 7 ans <b>${num(c.croissance,2)} %</b> (écart ${pt(c.ecart)})</div><div>depuis ${fm(c.since)}</div></div>
  <div class="sig"><div class="sub">Seuil de Gave pour vendre son or</div><div>10 ans US ≥ <b>5,9 %</b> : il manque <b>${pt(5.9-c.taux)}</b></div><div class="sub">PIB : dernier trimestre publié ${w.gdp_last.replace('Q',' T')} ; les mois suivants reprennent ce chiffre.</div></div>`;
} else NA('cw','FRED GDP / GS10');

if(D.frbonds){ const f=D.frbonds, c=f.current, x=f.dates.map(toDate), i={}; f.dates.forEach((d,k)=>i[d]=k);
 const up=f.events.filter(e=>e.to==='au-dessus'), dn=f.events.filter(e=>e.to==='en dessous');
 plot('cf',[
   {x,y:f.taux,name:'Taux 10 ans France',line:{color:'#f85149',width:1.8},u:' %',f:'.2f'},
   {x,y:f.ma,name:'Moyenne mobile 7 ans',line:{color:'#58a6ff',width:2},u:' %',f:'.2f'},
   {x:up.map(e=>toDate(e.date)),y:up.map(e=>f.taux[i[e.date]]),mode:'markers',name:'Passage au-dessus → pas d\'obligations',hoverinfo:'skip',marker:{symbol:'triangle-up',size:10,color:'#f85149'}},
   {x:dn.map(e=>toDate(e.date)),y:dn.map(e=>f.taux[i[e.date]]),mode:'markers',name:'Passage en dessous → obligations permises',hoverinfo:'skip',marker:{symbol:'triangle-down',size:10,color:'#3fb950'}}],
  {...dark,yaxis:{gridcolor:'#21262d',type:'linear',title:'%'}},cfg);
 const L=f.levels, rx=f.real.dates.map(toDate);
 plot('cfr',[
   {x:rx,y:f.real.v,name:'Rendement réel (10 ans − inflation sur 1 an)',line:{color:'#e3b341',width:1.8},u:' %',f:'.2f'},
   {x:rx,y:f.real.infl,name:'Inflation France sur 1 an',line:{color:'#8b949e',width:1},u:' %',f:'.2f',visible:'legendonly'}],
  {...dark,yaxis:{gridcolor:'#21262d',type:'linear',title:'%',zeroline:true,zerolinecolor:'#444'},
   shapes:[hline(L.acheter,'#3fb950'),hline(L.commencer_vendre,'#d29922'),hline(L.tout_vendre,'#f85149'),hline(c.real_mean,'#8b949e','dot')].concat(f.cpi_split?[{type:'line',x0:nextM(f.cpi_split),x1:nextM(f.cpi_split),yref:'paper',y0:0,y1:1,line:{color:'#8b949e',dash:'dot',width:1}}]:[]),
   annotations:[hlab(L.acheter,'5 % : acheter les obligations les plus longues','#3fb950'),hlab(L.commencer_vendre,'2 % : commencer à vendre (moyenne de long terme selon Gave)','#d29922'),hlab(L.tout_vendre,'1 % : tout vendre','#f85149'),
     {xref:'paper',x:0.995,xanchor:'right',y:c.real_mean,text:`moyenne ici depuis ${c.real_mean_from.slice(0,4)} : ${num(c.real_mean,2)} %`,showarrow:false,yshift:-9,font:{color:'#8b949e',size:11}}]},cfg);
 const RS={acheter:['Au-dessus de 5 % : acheter les obligations les plus longues','actions'],neutre:['Entre 2 % et 5 % : pas de signal (garder)',''],commencer_vendre:['Entre 1 % et 2 % : commencer à vendre','warn'],tout_vendre:['Sous 1 % : tout vendre (cash ou un autre marché obligataire)','or']}[c.real_status];
 document.getElementById('curf').innerHTML=`<div class="sig"><div class="sub">Taux 10 ans France (${fm(c.date)})</div><div class="big">${num(c.taux,2)} %</div>
   <div>${c.above?'<b>au-dessus</b>':'<b>en dessous</b>'} de sa moyenne 7 ans (${num(c.ma,2)} %) depuis <b>${fm(c.since)}</b> → ${c.above?'<b>pas d\'obligations françaises</b>':'obligations permises'}</div></div>
  <div class="sig"><div class="sub">Rendement réel (${fm(c.real_date)})</div><div class="big ${RS[1]}">${num(c.real,2)} %</div><div>${num(c.taux_real_date,2)} % − inflation ${num(c.infl,2)} % · ${RS[0]}</div></div>`;
} else { NA('cf','FRED IRLTLT01FRM156N'); NA('cfr','FRED IPC France'); }

if(D.surachat){ const s=D.surachat, c=s.current, x=s.dates.map(toDate);
 plot('co',[{x,y:s.v,name:'Or : variation sur 12 mois',line:{color:'#e3b341',width:1.6},u:' %',f:'.1f'}],
  {...dark,yaxis:{gridcolor:'#21262d',type:'linear',title:'%',zeroline:true,zerolinecolor:'#444'},
   shapes:s.periods.map(p=>band(p,'rgba(248,81,73,0.18)')).concat([hline(s.threshold,'#f85149')]),annotations:[hlab(s.threshold,'+65 % : or « suracheté »','#f85149')]},cfg);
 document.getElementById('curo').innerHTML=`<div class="sig"><div class="sub">Or sur 12 mois (${fm(c.date)})</div><div class="big ${c.alert?'warn':''}">${pct(c.yoy)}</div>
   <div>${c.alert?'⚠️ <b>Avertissement</b> : hausse ≥ 65 % sur un an, repli technique probable (pas un signal de vente)':'Pas d\'alerte : hausse inférieure à 65 % sur un an'}</div></div>
  <div class="sig"><div class="sub">Sur les 12 derniers mois</div><div>Maximum : <b>${pct(c.max_12m)}</b> (${fm(c.max_12m_date)})</div><div class="sub">Once : ${num(c.gold,0)} $ contre ${num(c.gold_12m,0)} $ un an plus tôt</div></div>`;
} else NA('co','or');

// ---------- Rente et profits
if(D.rente){ const r=D.rente, c=r.current;
 plot('cr',[
  {x:r.rente_fr.dates.map(toDate),y:r.rente_fr.v,name:'Rente française (3 mois capitalisé)',line:{color:'#f85149'},f:'.0f'},
  {x:r.rente_de.dates.map(toDate),y:r.rente_de.v,name:'Rente allemande (3 mois capitalisé)',line:{color:'#e3b341'},f:'.0f'},
  {x:r.profits.years.map(y=>y+'-07-01'),y:r.profits.v,name:'Profits des sociétés (EBE, annuel)',mode:'lines+markers',marker:{size:4},line:{color:'#3fb950'},f:'.0f',xf:'%Y'}],
  {...dark,yaxis:{gridcolor:'#21262d',type:'linear',title:'base 100 = 1981'}},cfg,{hovermode:'closest'});
 plot('cr2',[
  {x:r.ratio_var.years,y:r.ratio_var.v,type:'bar',name:'Ratio rente/profits, var. sur 1 an',marker:{color:'#e3b341'},u:' %',f:'.1f'},
  {x:r.chomage.years.slice(1),y:r.chomage.years.slice(1).map((y,i)=>+(r.chomage.v[i+1]-r.chomage.v[i]).toFixed(2)),name:'Chômage, var. sur 1 an',yaxis:'y2',line:{color:'#58a6ff'},u:' pt',f:'.1f'}],
  {...dark,yaxis:{gridcolor:'#21262d',title:'%',zeroline:true,zerolinecolor:'#444'},yaxis2:{overlaying:'y',side:'right',title:'points',showgrid:false,zeroline:false},margin:{l:50,r:50,t:10,b:40}},cfg,{xfmt:null});
 document.getElementById('curr').innerHTML=`<div class="sig"><div class="sub">100 placés en janvier 1981 → ${fm(c.rente_date)}</div><div>Rentier français : <b>${num(c.rente_fr,0)}</b> · allemand : <b>${num(c.rente_de,0)}</b></div><div>Profits des sociétés (${c.profits_year}) : <b>${num(c.profits,0)}</b></div></div>
  <div class="sig"><div class="sub">En janvier 2002 (date du livre)</div><div>Français : <b>${num(c.rente_fr_2002,0)}</b> · Allemand : <b>${num(c.rente_de_2002,0)}</b> · Profits : <b>${num(c.profits_2002,0)}</b></div><div class="sub">Livre : ~450 / ~300 / ~280</div></div>`;
 document.getElementById('corr').innerHTML = c.corr!=null? `sur ${r.ratio_var.years.length} années, la corrélation entre la variation du ratio et celle du chômage la même année est de <b>${num(c.corr,2)}</b>, et de <b>${num(c.corr_lag,2)}</b> avec le chômage de l'année suivante`:'non calculable';
} else document.getElementById('cr').innerHTML='<p class="warn">Données indisponibles (FRED/AMECO).</p>';

// ---------- Parts de marché à l'export
if(D.export){ const e=D.export, c=e.current;
 plot('ce',[
  {x:e.series.FRA.years,y:e.series.FRA.base100,name:'France',line:{color:'#58a6ff',width:2.5},customdata:e.series.FRA.share,hovertemplate:'<b>France</b> : %{y:.1f} (part : %{customdata:.2f} %)<extra></extra>'},
  {x:e.series.USA.years,y:e.series.USA.base100,name:'États-Unis',line:{color:'#f85149',width:2.5},customdata:e.series.USA.share,hovertemplate:'<b>États-Unis</b> : %{y:.1f} (part : %{customdata:.2f} %)<extra></extra>'}],
  {...dark,yaxis:{gridcolor:'#21262d'},shapes:[{type:'line',x0:1982,x1:1982,yref:'paper',y0:0,y1:1,line:{color:'#8b949e',dash:'dot'}}]},cfg,{xfmt:null});
 document.getElementById('cure').innerHTML=`<div class="sig"><div class="sub">France, ${c.year}</div><div class="big">${num(c.fra_idx,0)}</div><div class="sub">base 100 en 1982 · part : ${num(c.fra_share,2)} % contre ${num(c.fra_1982,2)} % en 1982</div></div>
  <div class="sig"><div class="sub">États-Unis, ${c.year}</div><div class="big">${num(c.usa_idx,0)}</div><div class="sub">part : ${num(c.usa_share,2)} % contre ${num(c.usa_1982,2)} % en 1982</div></div>`;
} else document.getElementById('ce').innerHTML='<p class="warn">Données indisponibles (Banque mondiale).</p>';

// Méthodologie
const src = D.sources||{};
const srcRows = Object.entries(src).map(([k,v])=>`<tr><td>${k}</td><td>${v.ok?'✅ téléchargé':(v.cache?'⚠️ échec, cache utilisé':'❌ échec')}</td></tr>`).join('');
document.getElementById('methodo-body').innerHTML = `
<h3>Comment les séries sont construites</h3><ul>
<li><b>Or</b> : prix mensuel de l'once en USD (dataset public <i>datasets/gold-prices</i>, LBMA/Banque mondiale, depuis 1833), complété pour le mois en cours par le dernier cours du contrat à terme COMEX (Yahoo <code>GC=F</code>). Le future est légèrement plus cher que le prix spot.</li>
<li><b>Obligations US (graphique 15)</b> : <b>indice synthétique</b>. Chaque mois, on « achète » un emprunt d'État US à 10 ans au pair au taux du mois précédent, on encaisse le coupon et on le revalorise au taux du mois. Taux 10 ans : Shiller avant 1953, puis FRED <code>GS10</code> (moyenne mensuelle), puis Yahoo <code>^TNX</code> pour le mois en cours. Gave utilise un indice de marché qui n'est pas précisé : les niveaux diffèrent du livre.</li>
<li><b>S&amp;P 500 dividendes réinvestis (graphique 17)</b> : reconstruit avant 1988 à partir des données de R. Shiller (prix moyen mensuel + dividende/12), puis indice officiel <code>^SP500TR</code> (Yahoo) à partir de janvier 1988, avec raccord des deux séries.</li>
<li><b>Moyenne mobile 7 ans</b> : moyenne arithmétique des 84 derniers points mensuels. Pour le graphique 15, comme dans le livre, la moyenne démarre en 1972 avec les mois disponibles (au moins 12) : elle n'est pas une « vraie » moyenne 7 ans avant ${fm(g15.partial_ma_until)}.</li>
<li><b>Dette publique</b> : AMECO, série <code>UDGGL</code> (dette brute consolidée au sens de Maastricht, % du PIB, raccordée par la Commission avant 1995). Les années à partir de ${D.dette?D.dette.forecast_from:'—'} sont des prévisions de la Commission. Derniers trimestres : Eurostat <code>gov_10q_ggdebt</code>. Les séries longues du FMI (depuis 1880) n'ont pas pu être téléchargées : accès refusé (403).</li>
<li><b>Dépenses / PIB</b> : AMECO. PIB en volume <code>OVGD</code>. Consommation publique <code>UCTG</code> et dépense publique totale <code>UUTG</code> à prix courants, divisées par le prix du PIB <code>PVGD</code>. Dépense totale disponible depuis 1978 pour la France, 1995 pour les Pays-Bas, et absente pour le Royaume-Uni. Mise à jour par la Commission environ deux fois par an.</li>
<li><b>Taux de change effectif</b> : BRI, <code>WS_EER</code>, panier étroit (27 économies), nominal et réel. Allemagne (<code>DE</code>) jusqu'en 12/1998, puis zone euro (<code>XM</code>) recalée sur le niveau allemand en 01/1999. Base 100 en octobre 1990.</li>
<li><b>Graphique 23</b> : dividendes de Shiller (moyenne mensuelle annualisée) jusqu'en ${D.g23?fm(D.g23.splice):'—'}. Ensuite, dividendes <b>implicites</b> sur 12 mois, déduits de l'écart entre le S&amp;P 500 avec et sans dividendes (Yahoo <code>^SP500TR</code> et <code>^GSPC</code>) ; l'écart avec Shiller est d'environ 1 % sur 2005–2024. Or : prix mensuel divisé par 31,1035 g/once.</li>
<li><b>Rente / profits</b> : taux interbancaires à 3 mois de l'OCDE via FRED (<code>IR3TIB01FRM156N</code>, <code>IR3TIB01DEM156N</code>), capitalisés chaque mois, avant impôts. Profits : AMECO <code>UOGC</code> (excédent brut d'exploitation des sociétés, nominal). Chômage : AMECO <code>ZUTN</code>.</li>
<li><b>Exportations</b> : Banque mondiale <code>TX.VAL.MRCH.CD.WT</code> (exportations de marchandises en dollars courants) pour la France, les États-Unis et l'agrégat OCDE (<code>OED</code>, membres actuels sur tout l'historique).</li>
<li><b>Quadrants (hypothèse)</b> : cash = bons du Trésor US à 3 mois (FRED <code>TB3MS</code>), capitalisés chaque mois au taux du mois précédent ; or / cash et actions / or (graphique 17) comparés à leur moyenne mobile 7 ans. Le critère de la moyenne 7 ans est <b>une hypothèse du site</b> : Gave ne le précise pas.</li>
<li><b>Wicksell</b> : croissance annuelle moyenne du PIB nominal US sur 28 trimestres (FRED <code>GDP</code>), appliquée aux trois mois du trimestre puis prolongée jusqu'au mois en cours ; taux 10 ans identique à celui du graphique 15.</li>
<li><b>Obligations françaises</b> : taux 10 ans OCDE (FRED <code>IRLTLT01FRM156N</code>). Inflation sur 12 mois : IPC OCDE (<code>FRACPIALLMINMEI</code>) jusqu'en ${D.frbonds&&D.frbonds.cpi_split?fm(D.frbonds.cpi_split):'—'}, puis IPCH Eurostat (<code>CP0000FRM086NEST</code>), car la série OCDE n'est plus mise à jour sur FRED.</li>
<li><b>Or suracheté</b> : variation sur 12 mois du prix mensuel de l'or ; seuil de 65 % donné par Gave.</li>
<li><b>Téléchargements</b> : délais courts (8 s pour la connexion, 30 s pour la lecture) et 2 essais. Si un serveur ne répond pas, les autres séries de ce serveur sont lues directement dans le cache. Si un bloc ne peut pas être recalculé, la version déjà publiée est conservée.</li>
<li><b>Bulles d'information</b> : la date affichée est le mois (séries mensuelles : fin de mois ou moyenne du mois selon la source), le trimestre ou l'année. Il n'y a pas de données quotidiennes.</li>
<li><b>Fréquence</b> : mensuelle pour les graphiques de marché et le change, trimestrielle ou annuelle pour la dette et les dépenses. Le dernier point est le mois en cours, recalculé à chaque mise à jour hebdomadaire. Un signal en cours de mois peut donc encore changer avant la fin du mois.</li></ul>
<h3>Comparaison avec les graphiques du livre</h3><ul>
<li><b>Graphique 15</b> : les grandes phases tombent aux mêmes dates (or → obligations vers 1983, → or vers 2003–2004, → obligations vers 2013–2014, → or vers 2019–2020). Les <b>niveaux sont plus bas</b> que ceux du livre : fin 2024, environ 230 contre 146 pour la moyenne ici, contre 247 / 165 dans le livre. Le pic de 1980 est à ~1 100 au lieu de ~1 500, car on utilise des prix mensuels et non des cours de fin de journée.</li>
<li><b>Graphique 17</b> : les dates de sortie (1931, 1972, 2002) sont proches de celles du livre (5/1931, 4/1972, 10/2002). La fin 2024 donne ici ~72 pour le ratio et ~67 pour la moyenne. Sur la photo, l'axe du livre ne semble pas correspondre à une « base 100 en 2000 » (le pic de 2000 y est vers 50). Ses étiquettes finales (~70 / 63,2) sont donc difficiles à comparer avec certitude.</li>
<li><b>Dette, dépenses, change</b> : les grandes tendances du livre se retrouvent (voir les détails sous chaque graphique), avec des niveaux différents à cause des révisions statistiques. Pour le DM, la BRI donne un pic de ~113 en 1995 au lieu de ~130 chez Gave, car le panier de monnaies est différent.</li>
<li><b>Graphique 23</b> : on retrouve les grands creux (1934, 1980, 2011) et le sommet de 1997–2000. Le pic de 2000 est à ~1,8 g, au-dessus du ~1,5 g du livre. Le niveau actuel (~0,64 g) est proche du 0,660 inscrit en fin de courbe dans le livre. La ligne « dividendes en dollars » du livre (53,404 en fin de courbe) n'a pas la même échelle que les données de Shiller (~80 $ aujourd'hui) : je ne sais pas quelle unité il utilise.</li>
<li><b>Graphique 17, date du dernier passage à l'or</b> : ici, février 2025 (écart de −0,6 % seulement ce mois-là, puis sous la moyenne tous les mois suivants). Gave parle de juillet 2025. Avec des fins de mois, des données hebdomadaires ou quotidiennes, ou le S&amp;P sans dividendes, on obtient janvier à mars 2025, jamais juillet. L'écart vient sans doute de ses séries ou de son mode de calcul, qu'il ne publie pas.</li>
<li><b>Rente / profits et exportations</b> : les écarts sont détaillés sous chaque graphique (2002 : rente ~550 / ~346 contre ~450 / ~300 ; part de la France à l'export ~94 contre ~75).</li></ul>
<h3>Limites importantes</h3><ul>
<li>Les règles ont été conçues et calibrées <b>après coup</b> sur ces mêmes données. Leurs bons résultats passés sont en partie un effet de sélection.</li>
<li>Elles sont <b>lentes</b> : elles ratent le début et la fin des mouvements. Près de la moyenne, elles donnent des <b>allers-retours</b> que les graphiques du livre ne montrent pas.</li>
<li>Tout est mesuré <b>en dollars et pour les marchés US</b>. Pour un épargnant en euros, le change EUR/USD, la fiscalité (PEA, assurance-vie…) et les frais changent beaucoup le résultat.</li>
<li>Avant 1971, l'or était à prix fixe : les ratios ne reflètent alors que les actions ou les obligations.</li>
<li>Les sources gratuites (Yahoo notamment) peuvent changer de format ou couper l'accès. En cas d'échec, le script réutilise la dernière copie en cache, signalée ci-dessous.</li></ul>
<h3>État des sources à la dernière mise à jour</h3><table>${srcRows}</table>`;
})();
