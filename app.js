/* ============================================================
   Vroue Padel Americano — dashboard
   Data en persoonlike inligting leef in Firestore, agter aanmelding.
   In hierdie lêer staan niks persoonliks nie.
   ============================================================ */
import { firebaseConfig, SHARED_EMAIL, SEASON_ID } from "./config.js";

/* Firebase word dinamies gelaai sodat die bladsy nie leeg is as die
   CDN onbereikbaar is nie. */
var FB = null;
var CDN = "https://www.gstatic.com/firebasejs/10.12.5/";
function loadFirebase(){
  return Promise.all([
    import(CDN+"firebase-app.js"),
    import(CDN+"firebase-auth.js"),
    import(CDN+"firebase-firestore.js")
  ]).then(function(m){
    FB = { initializeApp:m[0].initializeApp,
           getAuth:m[1].getAuth, onAuthStateChanged:m[1].onAuthStateChanged,
           signInWithEmailAndPassword:m[1].signInWithEmailAndPassword,
           signOut:m[1].signOut, setPersistence:m[1].setPersistence,
           browserLocalPersistence:m[1].browserLocalPersistence,
           getFirestore:m[2].getFirestore, doc:m[2].doc,
           onSnapshot:m[2].onSnapshot, setDoc:m[2].setDoc };
  });
}

var DEMO = !firebaseConfig || !firebaseConfig.apiKey || /^PLAAS/.test(firebaseConfig.apiKey);
var auth=null, db=null, ref=null, unsub=null;

function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
var app=document.getElementById("app");
/* ========== vaste rotasie ==========
   8 vroue, 8 weke. Elke week twee rondtes; elke rondte is een wedstryd
   tussen twee pare, dus 4 vroue op die baan. Elke vrou speel presies een
   rondte per week — haar naam kom een keer per week voor.

   Die paring is 'n volledige rondomtalie (1-faktorisering van K8): oor
   weke 1–7 speel elke vrou presies een keer saam met elke ander vrou.
   Week 8 is 'n oop finale — die pare word op die dag geloot.

   Formaat: ROT7[week][rondte] = [[speler,speler],[speler,speler]]  */
var ROT7 = [
  [ [[0,1],[3,6]], [[2,7],[4,5]] ],
  [ [[4,7],[5,6]], [[0,2],[1,3]] ],
  [ [[0,3],[2,4]], [[1,5],[6,7]] ],
  [ [[3,5],[2,6]], [[0,4],[1,7]] ],
  [ [[0,5],[3,7]], [[4,6],[1,2]] ],
  [ [[1,4],[2,3]], [[0,6],[5,7]] ],
  [ [[0,7],[3,4]], [[1,6],[2,5]] ]
];
var FINALE = 7;                    /* week-indeks van die finale */
/* Week 8 word deur die stand ná week 7 bepaal:
   Rondte 1 = nr 1 + nr 3  teen  nr 2 + nr 4
   Rondte 2 = nr 5 + nr 7  teen  nr 6 + nr 8   */
function wk(w){
  if(w<FINALE) return ROT7[w];
  var t=ranked(FINALE);
  return [ [[t[0].i,t[2].i],[t[1].i,t[3].i]],
           [[t[4].i,t[6].i],[t[5].i,t[7].i]] ];
}
var TARGET = 32;
var MON = ["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Des"];
var DAYSHORT = ["Ma","Di","Wo","Do","Vr","Sa","So"];
var FONTS = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,400..800&family=Karla:wght@400..700&display=swap";

/* ========== toestand ========== */
function blankWeek(){
  return {groups:[
    {date:"",time:"",confirmed:false,s:null},
    {date:"",time:"",confirmed:false,s:null}
  ]};
}
function defaults(){
  var w=[],i;
  for(i=0;i<8;i++) w.push(blankWeek());
  return {
    v:8,
    startDate:"2026-08-31",
    code:"ORG01",
    courtRate:400,
    regFee:250,
    orgShare:120,
    bank:{holder:"", bank:"", type:"", acc:""},
    players:["Speler 1","Speler 2","Speler 3","Speler 4","Speler 5","Speler 6","Speler 7","Speler 8"],
    regPaid:[false,false,false,false,false,false,false,false],
    weeks:w
  };
}
function migrate(s){
  var d=defaults(),k;
  if(!s||typeof s!=="object") return d;
  for(k in d){ if(!Object.prototype.hasOwnProperty.call(s,k)) s[k]=d[k]; }
  if(!s.bank||typeof s.bank!=="object") s.bank=d.bank;
  if(!Array.isArray(s.players)||s.players.length!==8) s.players=d.players;
  if(!Array.isArray(s.regPaid)||s.regPaid.length!==8) s.regPaid=d.regPaid;
  if(!Array.isArray(s.weeks)||s.weeks.length!==8) s.weeks=d.weeks;
  for(var i=0;i<8;i++){
    var wq=s.weeks[i];
    if(!wq||typeof wq!=="object"){ s.weeks[i]=blankWeek(); continue; }
    if(!Array.isArray(wq.groups)||wq.groups.length!==2) wq.groups=blankWeek().groups;
    for(var g=0;g<2;g++){
      if(!wq.groups[g]||typeof wq.groups[g]!=="object") wq.groups[g]=blankWeek().groups[g];
    }
  }
  return s;
}
var S = defaults();
var SCREEN = "laai";        /* laai | aanmeld | opstel | dashboard */
var LOGIN_ERR = "";

/* ========== sessie-UI geheue ========== */
var UI = {tab:"week", week:0, player:0, org:false, msg:"", codeErr:""};
try{
  var raw = sessionStorage.getItem("pl-ui");
  if(raw){ var o=JSON.parse(raw); if(o&&typeof o==="object"){
    UI.tab=o.tab||UI.tab; UI.week=typeof o.week==="number"?o.week:UI.week;
    UI.player=o.player||0; UI.org=!!o.org; } }
}catch(e){}
function rememberUI(){
  try{ sessionStorage.setItem("pl-ui", JSON.stringify({tab:UI.tab,week:UI.week,player:UI.player,org:UI.org})); }catch(e){}
}
function restoreScroll(){}

/* ========== stoor na Firestore ========== */
var saveTimer=null, saveState="idle", saving=false;
function setSave(st,msg){
  saveState=st; UI.msg=msg||"";
  var el=document.getElementById("savechip");
  if(el){ el.className="savechip "+st; el.textContent=msg||""; }
}
function scheduleSave(){
  if(DEMO){ setSave("err","Demo — nie gestoor nie"); return; }
  setSave("busy","Stoor…");
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer=setTimeout(doSave,700);
}
function doSave(){
  saveTimer=null; saving=true;
  FB.setDoc(ref, JSON.parse(JSON.stringify(S))).then(function(){
    saving=false; setSave("ok","Gestoor");
  }, function(err){
    saving=false;
    setSave("err", (err&&err.code==="permission-denied") ? "Geen toestemming" : "Stoor het misluk");
  });
}
/* ========== datums ========== */
function parseDate(s){
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||""));
  if(!m) return new Date(2026,7,31);
  return new Date(+m[1], +m[2]-1, +m[3]);
}
function iso(d){
  var mm=String(d.getMonth()+1), dd=String(d.getDate());
  return d.getFullYear()+"-"+(mm.length<2?"0"+mm:mm)+"-"+(dd.length<2?"0"+dd:dd);
}
function addDays(d,n){ var x=new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
function weekStart(i){ return addDays(parseDate(S.startDate), i*7); }
function fmtDay(d){ return d.getDate()+" "+MON[d.getMonth()]; }
function weekRange(i){ var a=weekStart(i); return fmtDay(a)+" – "+fmtDay(addDays(a,6)); }
function fmtDate(s){
  if(!s) return "";
  var d=parseDate(s);
  return DAYSHORT[(d.getDay()+6)%7]+" "+d.getDate()+" "+MON[d.getMonth()];
}
function slotLabel(gr){
  var a=fmtDate(gr.date), b=gr.time||"";
  if(a && b) return a+" · "+b;
  return a||b;
}
function currentWeekIndex(){
  var start = parseDate((typeof S!=="undefined"&&S)?S.startDate:"2026-08-31");
  var diff = Math.floor((new Date() - start)/(7*24*3600*1000));
  return Math.max(0, Math.min(7, diff));
}
/* ========== berekeninge ========== */
function money(n,dec){
  var v = Math.round(n*100)/100;
  var s = dec ? v.toFixed(2).replace(".",",") : String(Math.round(v));
  var p = s.split(",");
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g," ");
  return "R"+p.join(",");
}
function costs(){
  var rondtes = 16;
  return {
    rondtes:rondtes,
    fund: S.regFee*8,
    orgTotal: S.orgShare*rondtes,
    fundLeft: S.regFee*8 - S.orgShare*rondtes,
    left: S.courtRate - S.orgShare,
    perPlayer: (S.courtRate - S.orgShare)/4,
    seasonPerPlayer: S.regFee + (S.courtRate - S.orgShare)/4*8
  };
}
function scores(v){ if(v===null||v===undefined) return null; return [v, TARGET-v]; }
function tally(upto){
  var t=[],i;
  for(i=0;i<8;i++) t.push({i:i,name:S.players[i],pts:0,weeks:0,won:0,drew:0});
  for(var w=0;w<upto;w++){
    for(var g=0;g<2;g++){
      var mm=wk(w); if(!mm) continue;
      var sc=scores(S.weeks[w].groups[g].s); if(!sc) continue;
      var m=mm[g];
      for(var side=0;side<2;side++){
        for(var k=0;k<2;k++){
          var p=t[m[side][k]];
          p.pts+=sc[side]; p.weeks++;
          if(sc[side]>sc[1-side]) p.won++; else if(sc[side]===sc[1-side]) p.drew++;
        }
      }
    }
  }
  return t;
}
function ranked(upto){
  return tally(upto).slice().sort(function(a,b){
    return b.pts-a.pts || b.won-a.won || a.name.localeCompare(b.name);
  });
}
function stats(){ return tally(8); }
/* Hoeveel van die 14 rondtes in weke 1–7 het al 'n telling? */
function playedBeforeFinale(){
  var n=0;
  for(var w=0;w<FINALE;w++) for(var g=0;g<2;g++) if(S.weeks[w].groups[g].s!==null && S.weeks[w].groups[g].s!==undefined) n++;
  return n;
}
function finaleFinal(){ return playedBeforeFinale()===FINALE*2; }
function findMe(w,pi){
  var mm=wk(w); if(!mm) return null;
  for(var g=0;g<2;g++){
    var m=mm[g];
    for(var side=0;side<2;side++){
      var k=m[side].indexOf(pi);
      if(k>=0) return {g:g, side:side, mate:m[side][1-k], opp:m[1-side]};
    }
  }
  return null;
}
function plural(n,one,many){ return n+" "+(n===1?one:many); }
/* ========== render ========== */
var TABS_BASE=[["week","Hierdie week"],["skedule","Skedule"],["plan","My speelplan"],
          ["ranglys","Ranglys"],["koste","Kostes"],["hoe","Hoe dit werk"]];
function tabs(){ return UI.org ? TABS_BASE.concat([["stel","Instellings"]]) : TABS_BASE; }

function render(){
  document.getElementById("app").innerHTML =
    header() +
    '<nav class="tabs"><div class="wrap"><div class="tabrow" role="tablist">' +
      tabs().map(function(t){
        return '<button class="tab" role="tab" aria-selected="'+(UI.tab===t[0])+'" data-act="tab" data-tab="'+t[0]+'">'+esc(t[1])+'</button>';
      }).join("") +
    '</div></div></nav>' +
    '<main><div class="wrap">' + body() + '</div></main>' +
    '<footer class="foot"><div class="wrap">' +
      'Vroue Padel Americano · Seisoen 1 · geen pryse, geen wins — ons deel net die baan se koste.' +
    '</div></footer>';
  var chip=document.getElementById("savechip");
  if(chip){ chip.className="savechip "+saveState; chip.textContent=UI.msg; }
}
function header(){
  return '<header class="top"><div class="wrap"><div class="topin">' +
    '<div class="brand"><h1>Vroue Padel Americano</h1><span class="sub">Seisoen 1 · 8 weke</span></div>' +
    '<div class="topact"><span id="savechip" class="savechip idle"></span>' +
    (UI.org ? '<button class="btn ghost tiny" data-act="lockoff">Organiseerder aan</button>'
            : '<button class="btn ghost tiny" data-act="unlock">Organiseerder</button>') +
    '<button class="btn ghost tiny" data-act="signout" title="Meld af">Meld af</button>' +
    '</div></div></div></header>';
}
function readOnlyNotice(){
  if(!DEMO) return "";
  return '<div class="notice" style="margin-bottom:14px">Demo — Firebase is nog nie gekoppel nie, dus word niks gestoor nie.</div>';
}
function body(){
  switch(UI.tab){
    case "week": return tabWeek();
    case "skedule": return tabSkedule();
    case "plan": return tabPlan();
    case "ranglys": return tabRanglys();
    case "koste": return tabKoste();
    case "hoe": return tabHoe();
    case "stel": return UI.org ? tabStel() : tabKoste();
  }
  return "";
}
function pairName(pair){ return esc(S.players[pair[0]])+" + "+esc(S.players[pair[1]]); }

/* ---- Hierdie week ---- */
function tabWeek(){
  var w=UI.week, opts="";
  for(var i=0;i<8;i++) opts += '<option value="'+i+'"'+(i===w?' selected':'')+'>Week '+(i+1)+' · '+esc(weekRange(i))+'</option>';
  return readOnlyNotice() +
    '<div class="sectionhead">' +
      '<div class="weekpick">' +
        '<button class="btn ghost tiny" data-act="wk" data-d="-1"'+(w===0?' disabled':'')+'>←</button>' +
        '<select data-act="wksel" aria-label="Kies week">'+opts+'</select>' +
        '<button class="btn ghost tiny" data-act="wk" data-d="1"'+(w===7?' disabled':'')+'>→</button>' +
      '</div>' +
      '<span class="small muted">Twee rondtes · een wedstryd tot ' + TARGET + ' punte elk</span>' +
    '</div>' +
    (w===FINALE ? finaleBox() : "") +
    '<div class="grid2">' + rondteCard(w,0) + rondteCard(w,1) + '</div>';
}

function finaleBox(){
  var t=ranked(FINALE), done=finaleFinal(), n=playedBeforeFinale();
  var chip = done
    ? '<span class="sumchip ok">Finaal ✓ — al 14 rondtes van weke 1–7 is ingevul</span>'
    : '<span class="sumchip warn">Voorlopig — '+n+' van 14 rondtes van weke 1–7 is ingevul</span>';
  var list="";
  for(var i=0;i<8;i++){
    list += '<div class="frow"><span class="frank">'+(i+1)+'</span>' +
      '<span class="fname">'+esc(t[i].name)+'</span>' +
      '<span class="fpts num">'+t[i].pts+'</span></div>';
  }
  function line(g){
    var a=g*4;
    return '<div class="fpair"><span class="rn">R'+(g+1)+'</span><div class="mt">' +
      '<div class="ta">nr '+(a+1)+' + nr '+(a+3)+' — '+esc(t[a].name)+' + '+esc(t[a+2].name)+'</div>' +
      '<div class="vs">teen nr '+(a+2)+' + nr '+(a+4)+' — '+esc(t[a+1].name)+' + '+esc(t[a+3].name)+'</div>' +
    '</div></div>';
  }
  return '<div class="card" style="padding:16px;margin-bottom:18px">' +
    '<div class="eyebrow">Die finale</div>' +
    '<p class="small muted" style="margin:5px 0 14px;max-width:62ch">Week 8 se pare word nie geloot nie — hulle kom uit die ranglys ná week 7. ' +
      'Nommers 1 en 3 speel saam teen nommers 2 en 4; nommers 5 en 7 speel saam teen nommers 6 en 8.</p>' +
    '<div class="finalegrid">' +
      '<div class="fblock"><div class="eyebrow" style="margin-bottom:9px">Die spanne</div>'+line(0)+line(1)+'</div>' +
      '<div class="fblock"><div class="eyebrow" style="margin-bottom:9px">Stand ná week 7</div>'+list+'</div>' +
    '</div>' +
    '<div style="margin-top:12px">'+chip+'</div>' +
  '</div>';
}

function rondteCard(w,g){
  var mm=wk(w), m=mm?mm[g]:null, gr=S.weeks[w].groups[g], sc=scores(gr.s);
  var a=weekStart(w), lo=iso(a), hi=iso(addDays(a,6));
  var ready = !!(gr.date && gr.time);

  var slot;
  if(gr.confirmed){
    slot = '<div class="slot"><span class="pill ok"><span class="dot"></span>'+esc(slotLabel(gr))+'</span>' +
      '<div class="grow small muted">Tyd bevestig</div>' +
      '<button class="btn ghost tiny" data-act="unconfirm" data-w="'+w+'" data-g="'+g+'">Verander</button></div>';
  } else {
    slot = '<div class="slot"><div class="slotfields">' +
      '<label class="fld">Datum<input type="date" min="'+lo+'" max="'+hi+'" data-act="date" data-w="'+w+'" data-g="'+g+'" value="'+esc(gr.date)+'"></label>' +
      '<label class="fld">Tyd<input type="time" data-act="time" data-w="'+w+'" data-g="'+g+'" value="'+esc(gr.time)+'"></label>' +
      '<button class="btn" data-act="confirm" data-w="'+w+'" data-g="'+g+'"'+(ready?"":" disabled")+'>Bevestig</button>' +
    '</div><div class="small muted" style="flex:1 1 100%">Julle vier kies self die dag en tyd — enigeen kan dit hier bevestig.</div></div>';
  }

  function teamRow(side){
    if(!m) return "";
    var winner = sc && sc[side]>sc[1-side];
    return '<div class="trow'+(winner?" winrow":"")+'">' +
      '<span class="tnames">'+pairName(m[side])+'</span>' +
      '<input type="number" min="0" max="'+TARGET+'" inputmode="numeric" class="'+(winner?"win":"")+'" ' +
        'aria-label="Punte vir '+pairName(m[side])+'" data-act="score" data-w="'+w+'" data-g="'+g+'" data-side="'+side+'" ' +
        'value="'+(sc?sc[side]:"")+'">' +
    '</div>';
  }

  return '<section class="card sess">' +
    '<div class="sesshead"><div class="glabel"><span class="gbadge">'+(g+1)+'</span>' +
      '<div><div class="eyebrow">Rondte '+(g+1)+'</div><div class="small muted">Week '+(w+1)+' · '+esc(weekRange(w))+'</div></div></div>' +
      (gr.confirmed?'':'<span class="pill wait"><span class="dot"></span>'+(gr.date||gr.time?'nog nie bevestig':'geen tyd')+'</span>') +
    '</div>' +
    slot +
    (m
      ? '<div class="eyebrow" style="margin:4px 0 8px">Wedstryd tot '+TARGET+'</div>' +
        '<div class="match" id="m-'+w+'-'+g+'">' + teamRow(0) + '<div class="teen">teen</div>' + teamRow(1) + '</div>'
      : '<div class="notice calm">Die pare vir hierdie rondte kom uit die ranglys.</div>') +
  '</section>';
}

/* ---- Skedule ---- */
function tabSkedule(){
  var rows="";
  for(var w=0;w<8;w++){
    rows += '<tr><td><b>Week '+(w+1)+'</b><div class="small muted datecell">'+esc(weekRange(w))+'</div></td>';
    var mmw=wk(w);
    for(var g=0;g<2;g++){
      var gr=S.weeks[w].groups[g], m=mmw?mmw[g]:null;
      rows += '<td>' + (m
        ? '<div class="mt">' +
          '<div class="ta">'+pairName(m[0])+'</div>' +
          '<div class="vs">teen '+pairName(m[1])+'</div></div>'
        : '<div class="mt"><div class="ta muted">Finale</div><div class="vs">volgens die ranglys</div></div>') +
        '<div style="margin-top:7px">' + (gr.confirmed
          ? '<span class="pill ok"><span class="dot"></span>'+esc(slotLabel(gr))+'</span>'
          : '<span class="pill wait"><span class="dot"></span>'+(slotLabel(gr)?esc(slotLabel(gr))+' — onbevestig':'nog geen tyd')+'</span>') +
        '</div></td>';
    }
    rows += '</tr>';
  }
  return '<div class="sectionhead"><h2>Volle 8-week rotasie</h2>' +
    '<span class="small muted">Elke vrou speel een rondte per week</span></div>' +
    '<div class="card tablewrap"><table><thead><tr><th>Week</th><th>Rondte 1</th><th>Rondte 2</th></tr></thead><tbody>'+rows+'</tbody></table></div>' +
    '<p class="small muted" style="margin-top:12px">Jou spanmaat verander elke week: oor weke 1–7 speel jy presies een keer saam met elke ander vrou in die groep. Week 8 is die finale — daardie pare kom uit die ranglys' + (finaleFinal()?'':' en kan nog verander soos die tellings inkom') + '.</p>';
}

/* ---- My speelplan ---- */
function tabPlan(){
  var pi=UI.player, opts="";
  for(var i=0;i<8;i++) opts+='<option value="'+i+'"'+(i===pi?' selected':'')+'>'+esc(S.players[i])+'</option>';
  var st=stats()[pi];
  var cards="";
  for(var w=0;w<8;w++){
    var f=findMe(w,pi);
    if(!f){
      cards += '<section class="card sess">' +
        '<div class="sesshead"><div class="glabel"><span class="gbadge">'+(w+1)+'</span>' +
        '<div><div class="eyebrow">Week '+(w+1)+' · oop finale</div><div class="small muted">'+esc(weekRange(w))+'</div></div></div></div>' +
        '<p class="small muted" style="margin:0">Die pare word op die dag geloot. Kyk by <b>Hierdie week</b> sodra dit gedoen is.</p>' +
      '</section>';
      continue;
    }
    var gr=S.weeks[w].groups[f.g], sc=scores(gr.s);
    var mine = sc?sc[f.side]:null, theirs = sc?sc[1-f.side]:null;
    var res = sc ? (mine>theirs?'<span class="pill ok"><span class="dot"></span>Gewen</span>'
                  : mine===theirs?'<span class="pill neutral">Gelykop</span>'
                  : '<span class="pill neutral">Verloor</span>') : '';
    cards += '<section class="card sess">' +
      '<div class="sesshead"><div class="glabel"><span class="gbadge">'+(w+1)+'</span>' +
        '<div><div class="eyebrow">Week '+(w+1)+' · rondte '+(f.g+1)+'</div><div class="small muted">'+esc(weekRange(w))+'</div></div></div>' +
        (gr.confirmed
          ? '<span class="pill ok"><span class="dot"></span>'+esc(slotLabel(gr))+'</span>'
          : '<span class="pill wait"><span class="dot"></span>'+(slotLabel(gr)?esc(slotLabel(gr)):'geen tyd')+'</span>') +
      '</div>' +
      '<div class="planline"><span class="rn">MET</span><span class="tname">'+esc(S.players[f.mate])+'</span>' +
        (w===FINALE&&!finaleFinal()?'<span class="pill wait" style="margin-left:auto">voorlopig</span>':'') + '</div>' +
      '<div class="planline"><span class="rn">TEEN</span><span class="tname muted">'+esc(S.players[f.opp[0]])+' + '+esc(S.players[f.opp[1]])+'</span></div>' +
      '<div class="totals"><span class="tot">Jou punte <b>'+(mine===null?"–":mine)+'</b></span>'+(res?'<span style="margin-left:auto">'+res+'</span>':'')+'</div>' +
    '</section>';
  }
  return '<div class="sectionhead"><h2>Speelplan</h2>' +
    '<div class="weekpick"><select data-act="psel" aria-label="Kies speler">'+opts+'</select></div></div>' +
    '<div class="stats" style="margin-bottom:18px">' +
      stat("Weke gespeel", st.weeks+" / 8","") +
      stat("Totale punte", st.pts, "maks "+(TARGET*8)) +
      stat("Gemiddeld per week", st.weeks?(Math.round(st.pts/st.weeks*10)/10).toString().replace(".",","):"–","uit "+TARGET) +
      stat("Gewen", st.won, st.drew?st.drew+" gelykop":"") +
    '</div>' +
    '<div class="grid2">'+cards+'</div>';
}
function stat(h,v,f){
  return '<div class="stat"><div class="h">'+esc(h)+'</div><div class="v">'+esc(v)+'</div>'+(f?'<div class="f">'+esc(f)+'</div>':'')+'</div>';
}

/* ---- Ranglys ---- */
function tabRanglys(){
  var t=stats().slice().sort(function(a,b){ return b.pts-a.pts || b.won-a.won || a.name.localeCompare(b.name); });
  var max=Math.max(1,t[0]?t[0].pts:1);
  var anyPlayed=false;
  for(var i=0;i<t.length;i++) if(t[i].weeks>0) anyPlayed=true;
  var rows=t.map(function(p,i){
    return '<div class="lbrow">' +
      '<div class="lbrank">'+(i+1)+'</div>' +
      '<div><div class="lbname">'+esc(p.name)+'</div>' +
      '<div class="lbmeta">'+(p.weeks?plural(p.weeks,"week","weke")+' · '+p.won+' gewen'+(p.drew?' · '+p.drew+' gelykop':''):'nog nie gespeel nie')+'</div>' +
      '<div class="bar"><span style="width:'+Math.round(p.pts/max*100)+'%"></span></div></div>' +
      '<div class="lbpts">'+p.pts+'</div>' +
    '</div>';
  }).join("");
  return '<div class="sectionhead"><h2>Americano-ranglys</h2>' +
    '<span class="small muted">Maks '+TARGET+' punte per week · '+(TARGET*8)+' oor die seisoen</span></div>' +
    (anyPlayed?"":'<div class="notice calm" style="margin-bottom:14px">Nog geen telling ingevul nie. Tik die wedstryd se punte in op <b>Hierdie week</b> — die ranglys werk homself by.</div>') +
    '<div class="card" style="padding:6px 16px">'+rows+'</div>' +
    '<p class="small muted" style="margin-top:12px">Geen pryse — die telling is net ’n lekker ekstra.</p>';
}

/* ---- Kostes ---- */
function tabKoste(){
  var c=costs(), dec=c.perPlayer%1!==0;
  var tiles='<div class="stats" style="margin-bottom:18px">' +
    stat("Registrasie", money(S.regFee), "eenmalig, vooruit") +
    stat("By die baan", money(c.perPlayer,dec), "elke keer as jy speel") +
    stat("Totaal per vrou", money(c.seasonPerPlayer,c.seasonPerPlayer%1!==0), "oor die hele 8 weke") +
    stat(c.fundLeft>=0?"Fonds oor":"Fonds kort", money(Math.abs(c.fundLeft)), c.fundLeft>=0?"na Seisoen 2":"verhoog registrasie") +
  '</div>';

  var flow='<div class="card" style="padding:18px;margin-bottom:18px">' +
    '<div class="eyebrow" style="margin-bottom:10px">Hoe die geld werk</div>' +
    '<div class="prose" style="max-width:70ch"><p style="margin-bottom:10px">Jou ' + money(S.regFee) + ' registrasie word vooraf aan die organiseerder betaal en gaan in die baanfonds. ' +
    'By elke rondte betaal die organiseerder ' + money(S.orgShare) + ' kontant uit daardie fonds by die baan. ' +
    'Die ' + money(c.left) + ' wat oorbly, word deur die vier vroue op die baan verdeel — ' + money(c.perPlayer,dec) + ' elk.</p>' +
    '<p style="margin-bottom:0">Verder is daar niks: geen admin-, lidmaatskap- of geleentheidsfooi, geen pryse en geen wins. Wat aan die einde in die fonds oorbly, gaan na Seisoen 2 se baanfonds.</p></div></div>';

  var calc='<div class="card" style="padding:16px;margin-bottom:18px">' +
    '<div class="eyebrow" style="margin-bottom:10px">Sakrekenaar' + (UI.org?'':' <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">— net die organiseerder kan dit verstel</span>') + '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">' +
      '<label class="fld">Baanfooi per uur<input type="number" min="0" step="10" data-act="rate" value="'+S.courtRate+'"'+(UI.org?"":" disabled")+'></label>' +
      '<label class="fld">Uit fonds per rondte<input type="number" min="0" step="10" data-act="share" value="'+S.orgShare+'"'+(UI.org?"":" disabled")+'></label>' +
      '<label class="fld">Registrasie per vrou<input type="number" min="0" step="10" data-act="reg" value="'+S.regFee+'"'+(UI.org?"":" disabled")+'></label>' +
    '</div>' +
    '<div class="kv">' +
      '<span class="k">Baanfooi vir een rondte</span><span class="v">'+money(S.courtRate)+'</span>' +
      '<span class="k">Minus die organiseerder se kontantbydrae</span><span class="v">− '+money(S.orgShare)+'</span>' +
      '<span class="rule"></span>' +
      '<span class="k">Die vier vroue betaal saam by die baan</span><span class="v">'+money(c.left)+'</span>' +
      '<span class="k">Elke vrou betaal dus</span><span class="v">'+money(c.perPlayer,dec)+'</span>' +
      '<span class="rule"></span>' +
      '<span class="k">Registrasiefonds · 8 × '+money(S.regFee)+'</span><span class="v">'+money(c.fund)+'</span>' +
      '<span class="k">Bydraes oor 16 rondtes · 16 × '+money(S.orgShare)+'</span><span class="v">− '+money(c.orgTotal)+'</span>' +
      '<span class="k">'+(c.fundLeft>=0?"Oor vir Seisoen 2 se baanfonds":"Tekort in die fonds")+'</span>' +
      '<span class="v" style="color:'+(c.fundLeft>=0?"var(--accent)":"var(--coral)")+'">'+money(c.fundLeft)+'</span>' +
    '</div>' +
    (c.fundLeft<0?'<div class="notice" style="margin-top:12px">Die fonds dek nie 16 rondtes teen '+money(S.orgShare)+' nie. Verlaag die bydrae per rondte of verhoog die registrasiefooi.</div>':'') +
  '</div>';

  var paidCount=0, rows="";
  for(var p=0;p<8;p++){
    if(S.regPaid[p]) paidCount++;
    rows += '<tr><td><b>'+esc(S.players[p])+'</b></td>' +
      '<td class="c">' + (S.regPaid[p]
        ? '<span class="pill ok"><span class="dot"></span>Betaal</span>'
        : '<span class="pill wait"><span class="dot"></span>Uitstaande</span>') + '</td>' +
      '<td class="n">' + (UI.org
        ? '<button class="btn '+(S.regPaid[p]?'ghost ':'')+'tiny" data-act="togglereg" data-p="'+p+'">'+(S.regPaid[p]?"Merk terug":"Merk betaal")+'</button>'
        : '<span class="small muted">—</span>') + '</td></tr>';
  }
  var bnk='<div class="card bankcard" style="padding:16px;margin-bottom:14px">' +
    '<div class="eyebrow" style="margin-bottom:10px">Betaal jou registrasie hierheen</div>' +
    '<div class="bankgrid">' +
      '<div class="bkv"><span class="bk">Rekeninghouer</span><span class="bv">'+esc(S.bank.holder)+'</span></div>' +
      '<div class="bkv"><span class="bk">Bank</span><span class="bv">'+esc(S.bank.bank)+'</span></div>' +
      '<div class="bkv"><span class="bk">Rekeningtipe</span><span class="bv">'+esc(S.bank.type)+'</span></div>' +
      '<div class="bkv"><span class="bk">Rekeningnommer</span>' +
        '<span class="bv num acc">'+esc(S.bank.acc)+'' +
        '<button class="btn ghost tiny" data-act="copyacc" data-acc="'+esc(S.bank.acc)+'">Kopieer</button></span></div>' +
      '<div class="bkv"><span class="bk">Bedrag</span><span class="bv">'+money(S.regFee)+'</span></div>' +
      '<div class="bkv"><span class="bk">Verwysing</span><span class="bv">PADEL + jou naam</span></div>' +
    '</div>' +
    '<p class="small muted" style="margin:12px 0 0">Stuur asseblief jou bewys van betaling vir '+esc(S.bank.holder)+', dan merk sy jou hier af.</p>' +
  '</div>';

  var pay='<div class="sectionhead"><h2>Registrasie</h2>' +
      '<span class="small muted">'+paidCount+' van 8 betaal · '+money(paidCount*S.regFee)+' van '+money(c.fund)+' in die fonds</span></div>' +
    (UI.org?'':'<div class="card" style="padding:16px;margin-bottom:14px;max-width:430px">' +
      '<p class="small muted" style="margin:0 0 10px">Net die organiseerder merk registrasies af. Tik die kode in om te ontsluit.</p>'+codeForm()+'</div>') +
    bnk +
    '<div class="card tablewrap"><table><thead><tr><th>Speler</th><th class="c">Registrasie '+money(S.regFee)+'</th><th class="n"></th></tr></thead><tbody>'+rows+'</tbody></table></div>' +
    '<p class="small muted" style="margin-top:12px">Die bedrag per rondte word by die baan self betaal en word nie hier bygehou nie.</p>';

  return '<div class="sectionhead"><h2>Kostes</h2><span class="small muted">Geen wins · geen ekstra fooie</span></div>' +
    tiles + flow + calc + pay;
}
function codeForm(){
  return '<form data-act="codeform" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">' +
    '<label class="fld" style="flex:1 1 150px">Organiseerder-kode<input type="password" name="code" autocomplete="off"></label>' +
    '<button class="btn" type="submit">Ontsluit</button>' +
    (UI.codeErr?'<span class="small" style="color:var(--coral);flex:1 1 100%">'+esc(UI.codeErr)+'</span>':'') +
  '</form>';
}

/* ---- Hoe dit werk ---- */
function tabHoe(){
  var c=costs(), dec=c.perPlayer%1!==0;
  return '<div class="sectionhead"><h2>Hoe dit werk</h2></div>' +
  '<div class="card" style="padding:20px 22px"><div class="prose">' +
    '<p><b>Die kern:</b> ’n bekostigbare 8-week vroue-padelgroep waar jy een keer per week speel, jou speeldag by jou lewe pas, elke week met ’n ander maat speel, en waar geen wins gemaak word nie — ons deel eenvoudig die koste van die baan.</p>' +
    '<h3>Die formaat</h3>' +
    '<ul><li>8 vroue, 8 weke, een baan.</li>' +
    '<li>Elke week is daar <b>twee rondtes</b>. ’n Rondte is een wedstryd tussen twee pare — vier vroue op die baan.</li>' +
    '<li>Jy speel presies een rondte per week, dus 8 keer oor die seisoen.</li>' +
    '<li><b>Jou maat verander elke week.</b> Oor weke 1 tot 7 speel jy presies een keer saam met elke ander vrou in die groep — sewe weke, sewe ander vroue.</li>' +
    '<li><b>Week 8 is die finale.</b> Teen daardie tyd is elke moontlike paring al gespeel, so die spanne kom uit die ranglys: nommers 1 en 3 speel saam teen nommers 2 en 4, en nommers 5 en 7 speel saam teen nommers 6 en 8. Die dashboard stel dit self op sodra die tellings van weke 1–7 ingevul is.</li></ul>' +
    '<h3>Die tyd</h3>' +
    '<p>Julle vier stem self saam oor wanneer julle daardie week speel — enigeen tik die datum en tyd op die dashboard in en druk <b>Bevestig</b>. Jy hoef dus nie elke week dieselfde dag beskikbaar te wees nie: jy pas padel by jou lewe aan, nie jou lewe by padel nie.</p>' +
    '<h3>Die Americano-reëls</h3>' +
    '<ul><li>Jy speel in ’n paar, maar jou punte tel individueel.</li>' +
    '<li>Die wedstryd gaan tot ' + TARGET + ' punte.</li>' +
    '<li>Elke span dien vier keer, dan gaan die diens oor na die teenstanders.</li>' +
    '<li>Elke bal wat gewen word is een punt.</li>' +
    '<li>Eindig die wedstryd 14–18, kry albei vroue in die eerste span 14 punte en albei in die tweede span 18. Saam altyd ' + TARGET + '.</li>' +
    '<li>Maks ' + TARGET + ' punte per week, ' + (TARGET*8) + ' oor die seisoen.</li></ul>' +
    '<p>Enigeen in die rondte kan die telling ná die tyd hier intik — tik een span se punte en die ander vul homself in. <b>Geen pryse</b> — die ranglys is net ’n lekker ekstra.</p>' +
    '<h3>Wat dit kos</h3>' +
    '<ul><li>' + money(S.regFee) + ' eenmalige registrasie, vooraf aan die organiseerder. Dit gaan in die baanfonds. Die bankbesonderhede staan op die <b>Kostes</b>-blad.</li>' +
    '<li>By elke rondte sit die organiseerder ' + money(S.orgShare) + ' kontant uit die fonds by die baan in.</li>' +
    '<li>Die ' + money(c.left) + ' wat oorbly deel die vier vroue op die baan — ' + money(c.perPlayer,dec) + ' elk, ter plaatse betaal.</li>' +
    '<li>Altesaam ' + money(c.seasonPerPlayer,c.seasonPerPlayer%1!==0) + ' vir die hele program.</li>' +
    '<li>Geen admin-, lidmaatskap- of geleentheidsfooi. Wat oorbly gaan na Seisoen 2 se baanfonds.</li></ul>' +
    '<h3>As jy nie kan speel nie</h3>' +
    '<p>Laat die organiseerder so gou moontlik weet — jou maat staan sonder ’n span as jy nie opdaag nie, so hoe vroeër hoe beter. Kanselleer jy op die nippertjie, bly jy verantwoordelik vir jou deel van daardie rondte se baanfooi, want die baan moet steeds betaal word.</p>' +
  '</div></div>';
}
/* ========== interaksie ========== */

app.addEventListener("click", function(e){
  var el=e.target.closest("[data-act]"); if(!el) return;
  var act=el.getAttribute("data-act");
  if(act==="tab"){ UI.tab=el.getAttribute("data-tab"); rememberUI(); render(); window.scrollTo(0,0); return; }
  if(act==="wk"){ UI.week=Math.max(0,Math.min(7,UI.week+ +el.getAttribute("data-d"))); rememberUI(); render(); return; }
  if(act==="unlock"){ UI.tab="koste"; UI.codeErr=""; rememberUI(); render(); window.scrollTo(0,0);
    var f=app.querySelector('input[name="code"]'); if(f) f.focus(); return; }
  if(act==="lockoff"){ UI.org=false; rememberUI(); render(); return; }
  if(act==="confirm"){
    var w=+el.getAttribute("data-w"), g=+el.getAttribute("data-g"), gr=S.weeks[w].groups[g];
    if(!gr.date || !gr.time) return;
    gr.confirmed=true; render(); scheduleSave(); return;
  }
  if(act==="unconfirm"){
    S.weeks[+el.getAttribute("data-w")].groups[+el.getAttribute("data-g")].confirmed=false;
    render(); scheduleSave(); return;
  }
  if(act==="copyacc"){
    var acc=el.getAttribute("data-acc"), btn=el;
    var done=function(){ btn.textContent="Gekopieer ✓"; setTimeout(function(){ btn.textContent="Kopieer"; },1800); };
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(acc).then(done, function(){});
      }
    }catch(err){}
    return;
  }
  if(act==="togglereg"){
    S.regPaid[+el.getAttribute("data-p")]=!S.regPaid[+el.getAttribute("data-p")];
    render(); scheduleSave(); return;
  }
});

app.addEventListener("submit", function(e){
  var el=e.target.closest("[data-act]"); if(!el) return;
  if(el.getAttribute("data-act")!=="codeform") return;
  e.preventDefault();
  var val=(el.elements.code.value||"").trim();
  if(val.toUpperCase()===String(S.code).trim().toUpperCase()){ UI.org=true; UI.codeErr=""; }
  else UI.codeErr="Daardie kode werk nie. Kyk of jy dit presies so ingetik het.";
  rememberUI(); render();
});

app.addEventListener("change", function(e){
  var el=e.target.closest("[data-act]"); if(!el) return;
  var act=el.getAttribute("data-act");
  if(act==="wksel"){ UI.week=+el.value; rememberUI(); render(); return; }
  if(act==="psel"){ UI.player=+el.value; rememberUI(); render(); return; }
  if(act==="date"){ S.weeks[+el.getAttribute("data-w")].groups[+el.getAttribute("data-g")].date=el.value; render(); scheduleSave(); return; }
  if(act==="time"){ S.weeks[+el.getAttribute("data-w")].groups[+el.getAttribute("data-g")].time=el.value; render(); scheduleSave(); return; }
});

app.addEventListener("input", function(e){
  var el=e.target.closest("[data-act]"); if(!el) return;
  var act=el.getAttribute("data-act");
  if(act==="score"){
    var w=+el.getAttribute("data-w"), g=+el.getAttribute("data-g"), side=+el.getAttribute("data-side");
    var raw=el.value.trim();
    if(raw===""){ S.weeks[w].groups[g].s=null; }
    else{
      var v=Math.max(0,Math.min(TARGET,parseInt(raw,10)||0));
      S.weeks[w].groups[g].s = side===0 ? v : (TARGET-v);
    }
    var sc=scores(S.weeks[w].groups[g].s);
    var box=document.getElementById("m-"+w+"-"+g);
    if(box){
      var ins=box.querySelectorAll('input[data-act="score"]');
      var rows=box.querySelectorAll('.trow');
      var other=ins[1-side];
      if(other) other.value = sc?sc[1-side]:"";
      for(var i=0;i<2;i++){
        var wins = sc && sc[i]>sc[1-i];
        ins[i].className = wins?"win":"";
        rows[i].className = "trow"+(wins?" winrow":"");
      }
    }
    scheduleSave(); return;
  }
  if(act==="rate"){ S.courtRate=Math.max(0,parseInt(el.value,10)||0); refreshCosts(); scheduleSave(); return; }
  if(act==="share"){ S.orgShare=Math.max(0,parseInt(el.value,10)||0); refreshCosts(); scheduleSave(); return; }
  if(act==="reg"){ S.regFee=Math.max(0,parseInt(el.value,10)||0); refreshCosts(); scheduleSave(); return; }
});

var costTimer=null;
function refreshCosts(){
  if(costTimer) clearTimeout(costTimer);
  costTimer=setTimeout(function(){
    if(UI.tab!=="koste") return;
    var active=document.activeElement, key=active?active.getAttribute("data-act"):null;
    var pos=active&&active.selectionStart;
    render();
    if(key){ var back=app.querySelector('[data-act="'+key+'"]'); if(back){ back.focus(); try{ back.setSelectionRange(pos,pos); }catch(e){} } }
  },500);
}

/* ========== aanmeld- en opstelskerms ========== */
function screenLogin(){
  app.innerHTML =
    '<div class="gate"><div class="card gatecard">' +
      '<div class="gatemark">🎾</div>' +
      '<h1>Vroue Padel Americano</h1>' +
      '<p class="small muted">Hierdie bladsy is vir die groep. Tik die groep se wagwoord in om voort te gaan.</p>' +
      '<form data-act="loginform">' +
        '<label class="fld">Wagwoord<input type="password" name="pw" autocomplete="current-password" required></label>' +
        '<button class="btn" type="submit" style="width:100%;margin-top:12px">Gaan in</button>' +
        (LOGIN_ERR?'<p class="small" style="color:var(--coral);margin:10px 0 0">'+esc(LOGIN_ERR)+'</p>':'') +
      '</form>' +
      (DEMO?'<p class="small muted" style="margin:14px 0 0">Firebase is nog nie gekoppel nie — vul <code>config.js</code> in.</p>':'') +
    '</div></div>';
  var f=app.querySelector('input[name="pw"]'); if(f) f.focus();
}

function screenLoading(msg){
  app.innerHTML = '<div class="gate"><div class="card gatecard">' +
    '<div class="gatemark">🎾</div><h1>Vroue Padel Americano</h1>' +
    '<p class="small muted">'+esc(msg||"Laai…")+'</p></div></div>';
}

function screenSetup(){
  var names="";
  for(var i=0;i<8;i++){
    names += '<label class="fld">Speler '+(i+1)+'<input type="text" data-act="setupname" data-p="'+i+'" value="'+esc(S.players[i])+'" maxlength="30"></label>';
  }
  app.innerHTML =
    '<header class="top"><div class="wrap"><div class="topin">' +
      '<div class="brand"><h1>Vroue Padel Americano</h1><span class="sub">Eerste opstelling</span></div>' +
      '<div class="topact"><button class="btn ghost tiny" data-act="signout">Meld af</button></div>' +
    '</div></div></header>' +
    '<main><div class="wrap" style="max-width:760px">' +
      '<div class="notice calm" style="margin-bottom:18px">Die seisoen is nog nie opgestel nie. Vul dit een keer in — dit word in die databasis gestoor, nie in die webwerf se kode nie.</div>' +

      '<div class="card" style="padding:18px;margin-bottom:18px">' +
        '<div class="eyebrow" style="margin-bottom:10px">Die agt spelers</div>' +
        '<label class="fld" style="margin-bottom:12px">Plak agt name, een per re&euml;l' +
          '<textarea data-act="pastenames" rows="4" placeholder="Naam Van&#10;Naam Van&#10;…"></textarea></label>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">'+names+'</div>' +
      '</div>' +

      '<div class="card" style="padding:18px;margin-bottom:18px">' +
        '<div class="eyebrow" style="margin-bottom:10px">Bankbesonderhede vir registrasie</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">' +
          '<label class="fld">Rekeninghouer<input type="text" data-act="bank" data-f="holder" value="'+esc(S.bank.holder)+'"></label>' +
          '<label class="fld">Bank<input type="text" data-act="bank" data-f="bank" value="'+esc(S.bank.bank)+'"></label>' +
          '<label class="fld">Rekeningtipe<input type="text" data-act="bank" data-f="type" value="'+esc(S.bank.type)+'"></label>' +
          '<label class="fld">Rekeningnommer<input type="text" data-act="bank" data-f="acc" value="'+esc(S.bank.acc)+'" inputmode="numeric"></label>' +
        '</div>' +
      '</div>' +

      '<div class="card" style="padding:18px;margin-bottom:18px">' +
        '<div class="eyebrow" style="margin-bottom:10px">Seisoen en koste</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">' +
          '<label class="fld">Week 1 begin (Maandag)<input type="date" data-act="setupstart" value="'+esc(S.startDate)+'"></label>' +
          '<label class="fld">Baanfooi per uur<input type="number" min="0" step="10" data-act="rate" value="'+S.courtRate+'"></label>' +
          '<label class="fld">Uit fonds per rondte<input type="number" min="0" step="10" data-act="share" value="'+S.orgShare+'"></label>' +
          '<label class="fld">Registrasie per vrou<input type="number" min="0" step="10" data-act="reg" value="'+S.regFee+'"></label>' +
          '<label class="fld">Organiseerder-kode<input type="text" data-act="setupcode" value="'+esc(S.code)+'" maxlength="24"></label>' +
        '</div>' +
      '</div>' +

      '<button class="btn" data-act="createseason" style="font-size:15px;padding:11px 20px">Skep die seisoen</button>' +
    '</div></main>';
}

/* ---- Instellings (net met die organiseerder-kode) ---- */
function tabStel(){
  var names="";
  for(var i=0;i<8;i++){
    names += '<label class="fld">Speler '+(i+1)+'<input type="text" data-act="setupname" data-p="'+i+'" value="'+esc(S.players[i])+'" maxlength="30"></label>';
  }
  return '<div class="sectionhead"><h2>Instellings</h2><span class="small muted">Veranderinge stoor outomaties</span></div>' +
    '<div class="card" style="padding:18px;margin-bottom:18px">' +
      '<div class="eyebrow" style="margin-bottom:12px">Die agt spelers</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">'+names+'</div>' +
    '</div>' +
    '<div class="card" style="padding:18px;margin-bottom:18px">' +
      '<div class="eyebrow" style="margin-bottom:12px">Bankbesonderhede</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">' +
        '<label class="fld">Rekeninghouer<input type="text" data-act="bank" data-f="holder" value="'+esc(S.bank.holder)+'"></label>' +
        '<label class="fld">Bank<input type="text" data-act="bank" data-f="bank" value="'+esc(S.bank.bank)+'"></label>' +
        '<label class="fld">Rekeningtipe<input type="text" data-act="bank" data-f="type" value="'+esc(S.bank.type)+'"></label>' +
        '<label class="fld">Rekeningnommer<input type="text" data-act="bank" data-f="acc" value="'+esc(S.bank.acc)+'" inputmode="numeric"></label>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="padding:18px">' +
      '<div class="eyebrow" style="margin-bottom:12px">Seisoen</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">' +
        '<label class="fld">Week 1 begin (Maandag)<input type="date" data-act="setupstart" value="'+esc(S.startDate)+'"></label>' +
        '<label class="fld">Organiseerder-kode<input type="text" data-act="setupcode" value="'+esc(S.code)+'" maxlength="24"></label>' +
      '</div>' +
      '<p class="small muted" style="margin-bottom:0">Die groep se wagwoord verander jy in die Firebase-konsole, nie hier nie.</p>' +
    '</div>';
}

/* ========== ekstra hanteerders ========== */
app.addEventListener("submit", function(e){
  var el=e.target.closest("[data-act]"); if(!el) return;
  if(el.getAttribute("data-act")!=="loginform") return;
  e.preventDefault();
  var pw=el.elements.pw.value;
  if(DEMO){ LOGIN_ERR="Firebase is nog nie gekoppel nie."; screenLogin(); return; }
  var btn=el.querySelector('button[type=submit]');
  btn.disabled=true; btn.textContent="Wag…";
  FB.signInWithEmailAndPassword(auth, SHARED_EMAIL, pw).then(function(){
    LOGIN_ERR="";
  }, function(err){
    var c=err&&err.code;
    LOGIN_ERR = (c==="auth/invalid-credential"||c==="auth/wrong-password"||c==="auth/invalid-login-credentials")
      ? "Daardie wagwoord werk nie. Probeer weer."
      : (c==="auth/too-many-requests" ? "Te veel pogings. Wag 'n paar minute." : "Kon nie aanmeld nie — kyk of jy aanlyn is.");
    screenLogin();
  });
});

app.addEventListener("click", function(e){
  var el=e.target.closest("[data-act]"); if(!el) return;
  var act=el.getAttribute("data-act");
  if(act==="signout"){ if(!DEMO && FB) FB.signOut(auth); return; }
  if(act==="createseason"){
    for(var i=0;i<8;i++) if(!String(S.players[i]).trim()) S.players[i]="Speler "+(i+1);
    doSave(); SCREEN="dashboard"; render(); return;
  }
});

app.addEventListener("input", function(e){
  var el=e.target.closest("[data-act]"); if(!el) return;
  var act=el.getAttribute("data-act");
  if(act==="setupname"){ S.players[+el.getAttribute("data-p")]=el.value; if(SCREEN!=="opstel") scheduleSave(); return; }
  if(act==="bank"){ S.bank[el.getAttribute("data-f")]=el.value; if(SCREEN!=="opstel") scheduleSave(); return; }
  if(act==="setupcode"){ S.code=el.value; if(SCREEN!=="opstel") scheduleSave(); return; }
  if(act==="pastenames"){
    var lines=el.value.split(/\r?\n/).map(function(x){ return x.trim(); }).filter(Boolean);
    if(lines.length>=2){
      for(var i=0;i<8;i++) if(lines[i]) S.players[i]=lines[i];
      var ins=app.querySelectorAll('input[data-act="setupname"]');
      for(var j=0;j<ins.length;j++) ins[j].value=S.players[j];
    }
    return;
  }
});

app.addEventListener("change", function(e){
  var el=e.target.closest("[data-act]"); if(!el) return;
  if(el.getAttribute("data-act")==="setupstart"){
    S.startDate=el.value||S.startDate;
    if(SCREEN!=="opstel"){ UI.week=currentWeekIndex(); render(); scheduleSave(); }
    return;
  }
});

/* ========== opstart ========== */
function boot(){
  if(DEMO){ SCREEN="aanmeld"; screenLogin(); return; }
  screenLoading("Laai…");
  loadFirebase().catch(function(){
    screenLoading("Kon nie by Firebase uitkom nie. Kyk of jy aanlyn is en herlaai die bladsy.");
    throw new Error("cdn");
  }).then(function(){
  auth=FB.getAuth(FB.initializeApp(firebaseConfig));
  db=FB.getFirestore();
  ref=FB.doc(db,"seasons",SEASON_ID);
  FB.setPersistence(auth, FB.browserLocalPersistence).catch(function(){}).then(function(){
    FB.onAuthStateChanged(auth, function(user){
      if(unsub){ unsub(); unsub=null; }
      if(!user){ SCREEN="aanmeld"; screenLogin(); return; }
      screenLoading("Haal die seisoen…");
      unsub = FB.onSnapshot(ref, function(snap){
        if(!snap.exists()){
          if(SCREEN!=="opstel"){ S=defaults(); SCREEN="opstel"; screenSetup(); }
          return;
        }
        if(saving || saveTimer) return;                 /* ons eie skryf — moenie oortik nie */
        var active=document.activeElement;
        var typing = active && active!==document.body && app.contains(active) &&
                     /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
        S = migrate(snap.data());
        SCREEN="dashboard";
        if(!typing) render();
      }, function(){
        screenLoading("Kon nie die data laai nie. Herlaai die bladsy.");
      });
    });
  });
  }).catch(function(){});
}
boot();
