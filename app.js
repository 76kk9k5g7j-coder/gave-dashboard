(async function(){
let D = window.GAVE_DATA;
if(!D){ // repli : lecture des JSON via un serveur
  D = {}; for (const k of ['meta','g15','g17','profits','cac','sources']) { try{ D[k]=await (await fetch('data/'+k+'.json')).json(); }catch(e){} }
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
// ---------- Bulles d'information (survol souris / appui sur mobile)
const TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
function plot(id, traces, layout, _cfg, opt={}){
  const xf = opt.xfmt===undefined ? '%B %Y' : opt.xfmt;
  traces.forEach(t=>{
    if(!t.hovertemplate && t.hoverinfo!=='skip'){ const u=t.u!==undefined?t.u:(opt.unit||''), f=t.f||opt.yfmt||',.2f';
      const xs = (opt.hovermode==='closest') ? ((t.xf||xf) ? '%{x|'+(t.xf||xf)+'}' : '%{x}') + ' — ' : '';
      t.hovertemplate = '<b>'+t.name+'</b> : '+xs+'%{y:'+f+'}'+u+'<extra></extra>'; }
    delete t.u; delete t.f; delete t.xf; });
  const L = {...layout, hovermode: opt.hovermode||'x unified', dragmode: TOUCH?false:'zoom', hoverdistance: 60, spikedistance: -1,
    hoverlabel:{bgcolor:'#0d1117',bordercolor:'#8b949e',font:{color:'#e6edf3',size:13},namelength:-1},
    xaxis:{...(dark.xaxis||{}), ...(layout.xaxis||{}), ...(xf?{hoverformat:xf}:{}), showspikes:true, spikemode:'across', spikethickness:1, spikecolor:'#8b949e', spikedash:'dot'}};
  const C = {responsive:true, displaylogo:false, locale:'fr', scrollZoom:false, displayModeBar: !TOUCH,
    modeBarButtonsToRemove:['lasso2d','select2d']};
  return Plotly.newPlot(id, traces, L, C).then(gd=>{ if(TOUCH) addTouchHover(gd); return gd; });
}
// Sur écran tactile : un appui (ou un appui long en glissant le doigt) affiche la bulle au point touché.
function addTouchHover(gd){
  let last=null;
  const show = ()=>{ if(!last) return; const d=gd._dragging; gd._dragging=false;
    try{ Plotly.Fx.hover(gd, last); } finally { gd._dragging=d; } };
  const pos = ev=>{
    const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]); if(!t) return null;
    const area = gd.querySelector('.nsewdrag'); if(!area) return null;
    const bb = area.getBoundingClientRect(), xpx=t.clientX-bb.left, ypx=t.clientY-bb.top;
    return (xpx<0||xpx>bb.width||ypx<0||ypx>bb.height) ? null : {xpx, ypx};
  };
  gd.addEventListener('touchstart', ev=>{ last=pos(ev); show(); }, {passive:true, capture:true});
  gd.addEventListener('touchmove',  ev=>{ const p=pos(ev); if(p){ last=p; show(); } }, {passive:true, capture:true});
  // après le relâchement, Plotly efface la bulle : on la réaffiche pour qu'elle reste lisible
  gd.addEventListener('touchend', ()=>{ setTimeout(show, 60); }, {passive:true, capture:true});
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
 (D.profits? `<div class="sig"><div class="sub">Contexte · Profits US (1 an)</div><div class="big">${pct(D.profits.current.profits/100)}</div>
  <div>emploi US sur 1 an : ${pct(D.profits.current.emploi/100)} (${fm(D.profits.current.emploi_date)})</div></div>`:'') +
 (D.dette? `<div class="sig"><div class="sub">Contexte · Dette publique France</div><div class="big">${num(D.dette.current.q?D.dette.current.q.v:D.dette.current.v)} %</div><div>du PIB (${D.dette.current.q?D.dette.current.q.q.replace('-Q',', T'):D.dette.current.year})</div></div>`:'');
document.getElementById('synthtxt').innerHTML = comb + (fragile? " <span class='warn'>Attention : au moins un ratio est à moins de 5 % de sa moyenne. Dans cette zone, la règle a souvent produit des allers-retours.</span>":"") +
 "<br><span class='sub'>Lecture mécanique des règles publiées par Charles Gave. Information, pas un conseil en investissement.</span>";

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
<li><b>Bulles d'information</b> : la date affichée est le mois (séries mensuelles : fin de mois ou moyenne du mois selon la source), le trimestre ou l'année. Il n'y a pas de données quotidiennes.</li>
<li><b>Fréquence</b> : mensuelle pour les graphiques de marché et le change, trimestrielle ou annuelle pour la dette et les dépenses. Le dernier point est le mois en cours, recalculé à chaque mise à jour hebdomadaire. Un signal en cours de mois peut donc encore changer avant la fin du mois.</li></ul>
<h3>Comparaison avec les graphiques du livre</h3><ul>
<li><b>Graphique 15</b> : les grandes phases tombent aux mêmes dates (or → obligations vers 1983, → or vers 2003–2004, → obligations vers 2013–2014, → or vers 2019–2020). Les <b>niveaux sont plus bas</b> que ceux du livre : fin 2024, environ 230 contre 146 pour la moyenne ici, contre 247 / 165 dans le livre. Le pic de 1980 est à ~1 100 au lieu de ~1 500, car on utilise des prix mensuels et non des cours de fin de journée.</li>
<li><b>Graphique 17</b> : les dates de sortie (1931, 1972, 2002) sont proches de celles du livre (5/1931, 4/1972, 10/2002). La fin 2024 donne ici ~72 pour le ratio et ~67 pour la moyenne. Sur la photo, l'axe du livre ne semble pas correspondre à une « base 100 en 2000 » (le pic de 2000 y est vers 50). Ses étiquettes finales (~70 / 63,2) sont donc difficiles à comparer avec certitude.</li>
<li><b>Dette, dépenses, change</b> : les grandes tendances du livre se retrouvent (voir les détails sous chaque graphique), avec des niveaux différents à cause des révisions statistiques. Pour le DM, la BRI donne un pic de ~113 en 1995 au lieu de ~130 chez Gave, car le panier de monnaies est différent.</li>
<li><b>Graphique 23</b> : on retrouve les grands creux (1934, 1980, 2011) et le sommet de 1997–2000. Le pic de 2000 est à ~1,8 g, au-dessus du ~1,5 g du livre. Le niveau actuel (~0,64 g) est proche du 0,660 inscrit en fin de courbe dans le livre. La ligne « dividendes en dollars » du livre (53,404 en fin de courbe) n'a pas la même échelle que les données de Shiller (~80 $ aujourd'hui) : je ne sais pas quelle unité il utilise.</li>
<li><b>Rente / profits et exportations</b> : les écarts sont détaillés sous chaque graphique (2002 : rente ~550 / ~346 contre ~450 / ~300 ; part de la France à l'export ~94 contre ~75).</li></ul>
<h3>Limites importantes</h3><ul>
<li>Les règles ont été conçues et calibrées <b>après coup</b> sur ces mêmes données. Leurs bons résultats passés sont en partie un effet de sélection.</li>
<li>Elles sont <b>lentes</b> : elles ratent le début et la fin des mouvements. Près de la moyenne, elles donnent des <b>allers-retours</b> que les graphiques du livre ne montrent pas.</li>
<li>Tout est mesuré <b>en dollars et pour les marchés US</b>. Pour un épargnant en euros, le change EUR/USD, la fiscalité (PEA, assurance-vie…) et les frais changent beaucoup le résultat.</li>
<li>Avant 1971, l'or était à prix fixe : les ratios ne reflètent alors que les actions ou les obligations.</li>
<li>Les sources gratuites (Yahoo notamment) peuvent changer de format ou couper l'accès. En cas d'échec, le script réutilise la dernière copie en cache, signalée ci-dessous.</li></ul>
<h3>État des sources à la dernière mise à jour</h3><table>${srcRows}</table>`;
})();
