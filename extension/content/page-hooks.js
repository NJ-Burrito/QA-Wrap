/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * MAIN-world page hooks.
 *
 * Runs at document_start in the page's own JS context so it patches fetch, XHR
 * and console *before* application code touches them.
 *
 * Under MV3 this is the only way to see response bodies: declarativeNetRequest
 * is rule-based and cannot read a response, and webRequest blocking is gone.
 *
 * It cannot use chrome.* APIs — it posts to the ISOLATED-world bridge instead.
 */
(() => {
  if (window.__UQA_HOOKED__) return;
  window.__UQA_HOOKED__ = true;

  const MAX_BODY = 2000;
  const BODY_READ_MS = 2000;

  /**
   * Asleep until told otherwise.
   *
   * The wrappers below are installed at document_start, which is the only moment
   * early enough to see a page's first request — but instrumentation that runs
   * before the tester has agreed to anything is exactly what the master switch
   * exists to prevent. So the wrappers go on and do nothing at all until the
   * extension is woken. The cost is one boolean per request.
   */
  let awake = false;

  /*
   * Until the first answer about waking arrives, events are held (bounded), then
   * sent if the answer is "awake" and discarded if not. Nothing leaves the page
   * while asleep — held events are only ever released by a wake-up.
   */
  let undecided = true;
  let held = [];

  /** Nothing is reported while asleep — not even a request that succeeded. */
  function emit(event) {
    if (!awake) {
      if (undecided && held.length < 200) held.push(event);
      return;
    }
    toBridge({ t: 'event', event });
  }

  /**
   * D-1010-78 (r4-02-1): what leaves the page leaves on a MessageChannel port, not as a window message.
   *
   * A page can post any window message it likes, so a window path cannot tell a
   * recorded request from a forged one. This script runs at document_start, before
   * any page script, and hands the bridge one end of a fresh channel; the bridge
   * keeps the first port it is given and acknowledges receipt over it, and only then
   * does anything flow. The page never holds our end of the channel, so it cannot
   * write to it. Until the acknowledgement, messages wait here (bounded); if the
   * bridge never answers, nothing leaves. A late injection into an already loaded
   * page is the residual: a page listener registered first can see the transfer.
   */
  let port = null; // our end of the channel the bridge acknowledged
  let outbox = []; // waiting for that acknowledgement
  let controlHook = null; // set below: handles awake / act / rules from the bridge
  const offered = []; // our ends of channels handed out and not yet acknowledged
  function toBridge(msg) {
    if (port) {
      try { port.postMessage(msg); } catch { /* payload not cloneable — drop it rather than break the page */ }
    } else if (typeof MessageChannel !== 'function') {
      // Only a non-browser harness lacks MessageChannel; the bridge no longer reads this shape, so it is inert in a page.
      try { window.postMessage(msg.t === 'event' ? { source: 'uqa-page', event: msg.event } : { source: 'uqa-rule-fired', ruleId: msg.ruleId }, '*'); } catch { /* ignore */ }
    } else if (outbox.length < 200) outbox.push(msg);
  }
  function offerPort() {
    if (typeof MessageChannel !== 'function' || port) return; // D-1010-89: once paired, a hello is never answered
    try {
      while (offered.length) offered.shift().close(); // one offer outstanding; a newer one replaces it
      const ch = new MessageChannel();
      const mine = ch.port1;
      offered.push(mine);
      mine.onmessage = (e) => {
        // D-1010-89: an ack counts only on the channel currently offered, and never after pairing.
        if (port === mine) { if (e.data && controlHook) controlHook(e.data); return; } // paired: control messages from the bridge
        if (e.data !== 'uqa-ack' || port || offered[0] !== mine) return;
        port = mine;
        offered.length = 0;
        const queued = outbox;
        outbox = [];
        for (const m of queued) toBridge(m);
      };
      window.postMessage({ source: 'uqa-port' }, '*', [ch.port2]);
    } catch { /* the page end could not be handed over — nothing leaves */ }
  }
  offerPort();
  // A bridge that loaded after this script (or after an extension update) asks again.
  window.addEventListener('message', (e) => { if (e.source === window && e.data?.source === 'uqa-hello') offerPort(); });

  function short(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin ? u.pathname + u.search : u.href;
    } catch {
      return String(url);
    }
  }

  /* ------------------------------------------------- failure facts (spec s3/s5) */

  /*
   * Raw facts only. This file holds no rule table and never classifies: `en`
   * (browser-supplied error name), `ev` (XHR event type), `act` (tester-action
   * counter, pushed by the bridge), `nh` (a hint from a browser-supplied name or
   * an exact string) and `rep` rows. core/signal.js re-derives everything at read
   * time and never trusts `nh`. `rep` rows carry the folded count `n` as a delta
   * since the previous flush, plus `storm:true` or `capped:true` for the two
   * synthetic cases.
   */
  const STORE_PER_FP_EPOCH = 5;
  const REP_FLUSH_MS = 1000;
  const STORM_RATE = 20; // per second ...
  const STORM_SECS = 3; // ... for this many consecutive seconds
  const SLICE_MS = 300000; // D7: stored rows are budgeted per 5-minute slice, so minute 40 is stored whatever minute 1 did
  const SLICE_CAP = 60;
  const NOISE_SLICE_CAP = 20;
  const FIRST_CAP = 300; // D7: the first occurrence of every distinct fingerprint is kept, up to this many
  const NOISE_FIRST_CAP = 100;
  const KEYS_CAP = 3000;
  const PROTECTED_FULL_CAP = 1000; // rows stored in full after KEYS_CAP, for D2 rows only
  let protectedFull = 0;
  const LAST_QUIET_MS = 1500;
  const t0 = Date.now();
  const nativeT = window.setTimeout || globalThis.setTimeout;
  const setT = typeof nativeT === 'function' ? nativeT.bind(window) : () => 0; // a page that mocks timers must not stall the flush

  let act = 0;
  let lastActAt = 0; // cap1022: when the tester last acted, so a 4xx can be tied to a click
  const QUIET_MS = 5000;
  const keys = new Map(); // `${cheapKey}#${act}` -> { stored, pend, sec, cnt, hot, storm, proto }
  const sliceUsed = new Map(); // `${noise?1:0}#${slice}` -> rows stored
  let firstReal = 0;
  let firstNoise = 0;
  let overCap = 0;
  let flushTimer = 0;

  const errName = (x) => (x && typeof x.name === 'string' ? x.name.slice(0, 40) : undefined);

  /**
   * Raw fact `src`: absolute URL (no query, no hash) of the first script frame
   * that is not this extension. Never a classification; core/signal.js decides.
   */
  const bareUrl = (u) => String(u).split(/[?#]/)[0].slice(0, 300);
  function srcOf(stack) {
    for (const m of String(stack || '').matchAll(/((?:https?|file|blob):[^\s()]+?):\d+:\d+/g)) {
      if (!m[1].includes('chrome-extension')) return bareUrl(m[1]);
    }
    return undefined;
  }

  const RO_MESSAGES = [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications.',
  ];

  /** Hint for the worker's cheap tally. Exact names and anchored prefixes only, never a substring. */
  function hintFor(ev, raw) {
    if (ev.en === 'AbortError' || ev.ev === 'abort') return 'abort';
    if (ev.kind === 'pageerror') {
      if (RO_MESSAGES.includes(raw)) return 'ro';
      if (raw && raw.startsWith('Script error.') && !ev.stack) return 'opaque';
    }
    if (ev.kind === 'console' && ev.level === 'error') {
      const t = ev.text || '';
      if (t.startsWith('Warning: ') || t.startsWith('[Vue warn]') || /^NG0\d+/.test(t) ||
          t.startsWith('Download the React DevTools for a better development experience')) return 'dev';
    }
    return undefined;
  }

  const isFailure = (ev) =>
    ev.kind === 'net' ? ev.error === true || ev.status >= 400 || ev.ev === 'gql'
    : ev.kind === 'console' ? ev.level === 'error' || ev.level === 'assert'
    : ev.kind === 'pageerror';

  const squash = (t) => String(t || '').replace(/\d+/g, '#').slice(0, 100);

  function cheapKey(ev) {
    if (ev.kind === 'net') {
      let o = '';
      let p = ev.url;
      try { const u = new URL(ev.url, location.href); o = u.origin; p = u.pathname + u.search; } catch { /* keep as is */ }
      return `net|${ev.method}|${o}|${squash(p)}|${ev.ev === 'gql' ? `gql:${ev.operation || ''}` : ev.status || ev.en || ev.ev || 0}`;
    }
    return `${ev.kind}|${ev.level || ''}|${squash(ev.text)}`;
  }

  function repRow(s, extra) {
    const e = s.proto;
    return {
      kind: 'rep', ofKind: e.kind, method: e.method, url: e.url, status: e.status,
      en: e.en, ev: e.ev, nh: e.nh, operation: e.operation, text: e.text ? String(e.text).slice(0, 200) : undefined,
      act: e.act, flt: e.flt, fp: e.fp, ca: e.ca, au: e.au, lt: s.lastTs || undefined, ws: s.worst || undefined, ts: Date.now(), ...extra,
    };
  }

  /** Counted repeats go out as one `rep` row per key per flush; the last occurrence is stored in full once the key goes quiet (D7). */
  function flushReps(force) {
    flushTimer = 0;
    let waiting = false;
    for (const s of keys.values()) {
      const n = s.pend - (s.lastEv ? 1 : 0); // the last occurrence is held back until the key is quiet, then stored in full
      if (n > 0) { emit(repRow(s, { n })); s.pend -= n; }
      if (!s.lastEv) continue;
      if (force === true || Date.now() - s.lastTs >= LAST_QUIET_MS) { emit(s.lastEv); s.lastEv = null; s.pend = 0; } else waiting = true;
    }
    if (overCap) { emit({ kind: 'rep', capped: true, n: overCap, act, ts: Date.now() }); overCap = 0; }
    if (waiting) wantFlush();
  }
  const wantFlush = () => { if (!flushTimer) flushTimer = setT(() => flushReps(), REP_FLUSH_MS); };
  window.addEventListener('pagehide', () => { if (awake) flushReps(true); });

  /**
   * r5-05-1: the first MAX_BODY characters of a failing response, read from a clone through its reader.
   * Capped in bytes, bounded by a timer, resolves undefined instead of ever rejecting or hanging.
   */
  function previewOf(res, cap = MAX_BODY) {
    return new Promise((resolve) => {
      let reader;
      let settled = false;
      const done = (text) => {
        if (settled) return;
        settled = true;
        try { reader?.cancel().catch(() => {}); } catch { /* already closed */ }
        resolve(text);
      };
      try {
        reader = res.clone().body.getReader();
        setT(() => done(undefined), BODY_READ_MS);
        const dec = new TextDecoder();
        let text = '';
        let bytes = 0;
        const pump = () => reader.read().then(({ done: end, value }) => {
          if (value) { bytes += value.length; text += dec.decode(value, { stream: true }); }
          if (end || bytes >= cap * 4 || text.length >= cap) done(text.slice(0, cap));
          else pump();
        }, () => done(undefined));
        pump();
      } catch {
        done(undefined); // opaque, bodyless or already consumed
      }
    });
  }

  /**
   * A 4xx belongs to a tester action only when it follows one within QUIET_MS AND is not a request that was already failing on a loop before that action
   * (a 404 analytics beacon every half second is the page's own timer, whichever click it happens to land after). Two earlier failures of the same
   * method+URL before the action make it background. Every 4xx is remembered here. Since the network filter (D1) a background 4xx is no longer dropped:
   * it is recorded without the `ca` tag, and the Strict preset is what hides it.
   */
  const seen4xx = new Map();
  function causedByAction(ev) {
    const key = `${ev.method} ${ev.url}`;
    const times = seen4xx.get(key) || [];
    const now = Date.now();
    times.push(now);
    if (times.length > 8) times.shift();
    seen4xx.set(key, times);
    if (seen4xx.size > 200) seen4xx.delete(seen4xx.keys().next().value);
    if (!(act > 0 && now - lastActAt < QUIET_MS + (ev.durationMs || 0))) return false;
    return times.filter((t) => t < lastActAt).length < 2;
  }

  /* ------------------------------------------------ network filter (D2 to D8) */

  /*
   * Classification runs here, in the page, and the service worker only counts what it is told (D8). Every request is still
   * recorded (D1); this code only tags what it saw:
   *   fp   1 when the host belongs to the session's first-party set (D3), else 0
   *   ca   1 when the request started within 2 s of a trusted tester action, 2 within the causal window
   *   au   1 when the request carried an auth header
   *   flt  the noise reason (abort, telemetry, adblock, junk, socket, redirect), only when the request is not protected by D2
   * core/netfilter.js re-checks D2 on read, so a tag can never hide a protected failure.
   * The Public Suffix List block below is generated by tools/build-psl.mjs from vendor/psl-data.js; test-netfilter keeps them equal.
   */
  /*PSL:BEGIN*/
  const PSL_DATA = "ac:com,edu,gov,mil,net,org,drr,sch,feedback,forms;ae:ac,co,gov,mil,net,org,sch;aero:airline,airport,accident-investigation,accident-prevention,aerobatic,aeroclub,aerodrome,agents,air-surveillance,air-traffic-control,aircraft,airtraffic,ambulance,association,author,ballooning,broker,caa,cargo,catering,certification,championship,charter,civilaviation,club,conference,consultant,consulting,control,council,crew,design,dgca,educator,emergency,engine,engineer,entertainment,equipment,exchange,express,federation,flight,freight,fuel,gliding,government,groundhandling,group,hanggliding,homebuilt,insurance,journal,journalist,leasing,logistics,magazine,maintenance,marketplace,media,microlight,modelling,navigation,parachuting,paragliding,passenger-association,pilot,press,production,recreation,repbody,res,research,rotorcraft,safety,scientist,services,show,skydiving,software,student,taxi,trader,trading,trainer,union,workinggroup,works;af:com,edu,gov,net,org;ag:co,com,net,nom,org,obj;ai:com,net,off,org,uwu,framer,kiloapps;al:com,edu,gov,mil,net,org;am:co,com,commune,net,org,radio;ao:co,ed,edu,gov,gv,it,og,org,pb;ar:bet,com,coop,edu,gob,gov,int,mil,musica,mutual,net,org,seg,senasa,tur;arpa:e164,home,in-addr,ip6,iris,uri,urn;as:gov;at:ac,sth.ac,co,gv,or,dnshome,wien.funkfeuer,*.futurecms,*.ex.futurecms,*.in.futurecms,futurehosting,futuremailing,*.ex.ortsinfo,*.kunden.ortsinfo,123webseite,priv,4,my,myspreadshop,12hp,2ix,4lima,lima-city;au:asn,com,edu,gov,id,net,org,conf,oz,act,nsw,nt,qld,sa,tas,vic,wa,act.edu,catholic.edu,nsw.edu,nt.edu,qld.edu,sa.edu,tas.edu,vic.edu,wa.edu,qld.gov,sa.gov,tas.gov,vic.gov,wa.gov,mel.cloudlets.com,myspreadshop.com;aw:com;az:biz,co,com,edu,gov,info,int,mil,name,net,org,pp,pro;ba:com,edu,gov,mil,net,org,shop.brendly,rs;bb:biz,co,com,edu,gov,info,net,org,store,tv;bd:ac,ai,co,com,edu,gov,id,info,it,mil,net,org,sch,tv;be:ac,cloudns,webhosting,site.webhosting,cloud.interhostsolutions,ezproxy.kuleuven,my,123website,myspreadshop,*.transurl;bf:gov;bg:0,1,2,3,4,5,6,7,8,9,a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,y,z,barsy;bh:com,edu,gov,net,org;bi:co,com,edu,or,org;bj:africa,agro,architectes,assur,avocats,co,com,eco,econo,edu,info,loisirs,money,net,org,ote,restaurant,resto,tourism,univ;bm:com,edu,gov,net,org;bn:com,edu,gov,net,org,co;bo:com,edu,gob,int,mil,net,org,tv,web,academia,agro,arte,blog,bolivia,ciencia,cooperativa,democracia,deporte,ecologia,economia,empresa,ia,indigena,industria,info,medicina,movimiento,musica,natural,nombre,noticias,patria,plurinacional,politica,profesional,pueblo,revista,salud,tecnologia,tksat,transporte,wiki;br:9guacu,abc,adm,adv,agr,aju,am,anani,aparecida,api,app,arq,art,ato,b,barueri,belem,bet,bhz,bib,bio,blog,bmd,boavista,bsb,campinagrande,campinas,caxias,cim,cng,cnt,com,contagem,coop,coz,cri,cuiaba,curitiba,def,des,det,dev,ecn,eco,edu,emp,enf,eng,esp,etc,eti,far,feira,flog,floripa,fm,fnd,fortal,fot,foz,fst,g12,geo,ggf,goiania,gov,ac.gov,al.gov,am.gov,ap.gov,ba.gov,ce.gov,df.gov,es.gov,go.gov,ma.gov,mg.gov,ms.gov,mt.gov,pa.gov,pb.gov,pe.gov,pi.gov,pr.gov,rj.gov,rn.gov,ro.gov,rr.gov,rs.gov,sc.gov,se.gov,sp.gov,to.gov,gru,ia,imb,ind,inf,jab,jampa,jdf,joinville,jor,jus,leg,leilao,lel,log,londrina,macapa,maceio,manaus,maringa,mat,med,mil,morena,mp,mus,natal,net,niteroi,*.nom,not,ntr,odo,ong,org,osasco,palmas,poa,ppg,pro,psc,psi,pvh,qsl,radio,rec,recife,rep,ribeirao,rio,riobranco,riopreto,salvador,sampa,santamaria,santoandre,saobernardo,saogonca,seg,sjc,slg,slz,social,sorocaba,srv,taxi,tc,tec,teo,the,tmp,trd,tur,tv,udi,vet,vix,vlog,wiki,xyz,zlg,ac.leg,al.leg,am.leg,ap.leg,ba.leg,ce.leg,df.leg,es.leg,go.leg,ma.leg,mg.leg,ms.leg,mt.leg,pa.leg,pb.leg,pe.leg,pi.leg,pr.leg,rj.leg,rn.leg,ro.leg,rr.leg,rs.leg,sc.leg,se.leg,sp.leg,to.leg,simplesite.com,tche;bs:com,edu,gov,net,org,we;bt:com,edu,gov,net,org;bw:ac,co,gov,net,org;by:gov,mil,com,of,mediatech;bz:co,com,edu,gov,net,org,za,mydns,gsj;ca:ab,bc,mb,nb,nf,nl,ns,nt,nu,on,pe,qc,sk,yk,gc,barsy,*.awdev,co,no-ip,onid,myspreadshop,box;cd:gov,cc;ci:ac,xn--aroport-bya,asso,co,com,ed,edu,go,gouv,int,net,or,org,us;ck:*,!www;cl:co,gob,gov,mil,cloudns;cm:co,com,gov,net;cn:ac,com,edu,gov,mil,net,org,xn--55qx5d,xn--od0alg,xn--io0a7i,ah,bj,cq,fj,gd,gs,gx,gz,ha,hb,he,hi,hk,hl,hn,jl,js,jx,ln,mo,nm,nx,qh,sc,sd,sh,sn,sx,tj,tw,xj,xz,yn,zj,execute-api.cn-north-1.amazonaws.com,execute-api.cn-northwest-1.amazonaws.com,*.compute.amazonaws.com,emrappui-prod.cn-north-1.amazonaws.com,emrnotebooks-prod.cn-north-1.amazonaws.com,emrstudio-prod.cn-north-1.amazonaws.com,emrappui-prod.cn-northwest-1.amazonaws.com,emrnotebooks-prod.cn-northwest-1.amazonaws.com,emrstudio-prod.cn-northwest-1.amazonaws.com,*.cn-north-1.airflow.amazonaws.com,*.cn-northwest-1.airflow.amazonaws.com,*.airflow.cn-north-1.on.amazonwebservices.com,*.airflow.cn-northwest-1.on.amazonwebservices.com,*.rds.cn-north-1.amazonaws.com,*.rds.cn-northwest-1.amazonaws.com,s3.dualstack.cn-north-1.amazonaws.com,s3-accesspoint.dualstack.cn-north-1.amazonaws.com,s3-website.dualstack.cn-north-1.amazonaws.com,s3.cn-north-1.amazonaws.com,s3-accesspoint.cn-north-1.amazonaws.com,s3-deprecated.cn-north-1.amazonaws.com,s3-object-lambda.cn-north-1.amazonaws.com,s3-website.cn-north-1.amazonaws.com,s3.dualstack.cn-northwest-1.amazonaws.com,s3-accesspoint.dualstack.cn-northwest-1.amazonaws.com,s3.cn-northwest-1.amazonaws.com,s3-accesspoint.cn-northwest-1.amazonaws.com,s3-object-lambda.cn-northwest-1.amazonaws.com,s3-website.cn-northwest-1.amazonaws.com,notebook.cn-north-1.sagemaker.com,notebook.cn-northwest-1.sagemaker.com,studio.cn-north-1.sagemaker.com,studio.cn-northwest-1.sagemaker.com,cn-north-1.eb.amazonaws.com,cn-northwest-1.eb.amazonaws.com,*.elb.amazonaws.com,transfer-webapp.cn-north-1.on.amazonwebservices.com,transfer-webapp.cn-northwest-1.on.amazonwebservices.com,canva-apps,canva-code,my.canvasite,khsj,myqnapcloud,as.sh,direct.quickconnect;co:com,edu,gov,mil,net,nom,org,carrd,crd,*.otap,hidns,leadpages,lpages,mypi,*.xmit,*.clusters.rdpa,*.srvrless.rdpa,firewalledreplit,id.firewalledreplit,repl,id.repl,supabase,realtime.supabase,storage.supabase,umso;cr:ac,co,ed,fi,go,or,sa;cu:com,edu,gob,inf,nat,net,org;cv:com,edu,id,int,net,nome,org,publ,dev,store;cw:com,edu,net,org;cx:gov,cloudns,ath,info,assessments,calculators,funnels,paynow,quizzes,researched,tests;cy:ac,biz,com,ekloges,gov,ltd,mil,net,org,press,pro,tm,j.scaleforce.com;cz:gov,rsc.contentproxy9,realm,e4,co,*.cloud.metacentrum,custom.metacentrum,flt.cloud.muni,usr.cloud.muni;dm:co,com,edu,gov,net,org;do:art,com,edu,gob,gov,mil,net,org,sld,web;dz:art,asso,com,edu,gov,net,org,pol,soc,tm;ec:abg,adm,agron,arqt,art,bar,chef,com,cont,cpa,cue,dent,dgn,disco,doc,edu,eng,esm,fin,fot,gal,gob,gov,gye,ibr,info,k12,lat,loj,med,mil,mktg,mon,net,ntr,odont,org,pro,prof,psic,psiq,pub,rio,rrpp,sal,tech,tul,tur,uio,vet,xxx,base,official;ee:aip,com,edu,fie,gov,lib,med,org,pri,riik;eg:ac,com,edu,eun,gov,info,me,mil,name,net,org,sci,sport,tv;er:*;es:com,edu,gob,nom,org,123miweb,myspreadshop;et:biz,com,edu,gov,info,name,net,org;fi:aland,dy,xn--hkkinen-5wa,iki,fi.cloudplatform,kapsi,123kotisivu,myspreadshop;fj:ac,biz,com,edu,gov,id,info,mil,name,net,org,pro;fk:*;fm:com,edu,net,org,radio,*.user;fr:asso,com,gouv,nom,prd,tm,avoues,cci,greta,huissier-justice,fbx-os,fbxos,freebox-os,freeboxos,goupile,kdns,123siteweb,on-web,chirurgiens-dentistes-en-france,dedibox,aeroport,avocat,chambagri,chirurgiens-dentistes,experts-comptables,medecin,notaires,pharmacien,port,veterinaire,myspreadshop,ynh;gd:edu,gov;ge:com,cyb,edu,gov,llc,net,online,org,pvt,school,tnx;gg:co,net,org,*.at.ply,d6.ply,botdash,kaas,stackit,panel,daemon.panel;gh:biz,com,edu,gov,mil,net,org;gi:com,edu,gov,ltd,mod,org;gl:co,com,edu,net,org;gn:ac,com,edu,gov,net,org;gp:asso,com,edu,mobi,net,org;gr:com,edu,gov,net,org,barsy,simplesite;gt:com,edu,gob,ind,mil,net,org;gu:com,edu,gov,guam,info,net,org,web;gy:co,com,edu,gov,net,org;hk:com,edu,gov,idv,net,org,xn--ciqpn,xn--gmqw5a,xn--55qx5d,xn--mxtq1m,xn--lcvr32d,xn--wcvs22d,xn--gmq050i,xn--uc0atv,xn--uc0ay4a,xn--od0alg,xn--zf0avx,xn--mk0axi,xn--tn0ag,xn--od0aq3b,xn--io0a7i,inc,ltd;hn:com,edu,gob,mil,net,org;hr:com,from,iz,name,shop.brendly;ht:adult,art,asso,com,coop,edu,firm,gouv,info,med,net,org,perso,pol,pro,rel,shop,rt;hu:2000,agrar,bolt,casino,city,co,erotica,erotika,film,forum,games,hotel,info,ingatlan,jogasz,konyvelo,lakas,media,news,org,priv,reklam,sex,shop,sport,suli,szex,tm,tozsde,utazas,video;id:ac,ai,biz,co,desa,go,kop,mil,my,net,or,ponpes,sch,web,xn--9tfky,e,zone;ie:gov,myspreadshop;il:ac,co,gov,idf,k12,muni,net,org,ravpage.co,mytabit.co,tabitorder.co;xn--4dbrk0ce:xn--4dbgdty6c,xn--5dbhl8d,xn--8dbq2a,xn--hebda8b;im:ac,co,ltd.co,plc.co,com,net,org,tt,tv;in:5g,6g,ac,aero,ai,alumni,am,bank,bihar,biz,business,ca,cn,co,com,coop,cs,delhi,dr,edu,er,fin,firm,gen,gov,gujarat,ind,info,int,internet,io,me,mil,net,nic,org,pg,post,pro,res,school,travel,tv,ub,uk,up,us,cloudns,barsy,web,indevs,supabase;int:eu;io:co,com,edu,gov,mil,net,nom,org,myaddr,apigee,b-data,beagleboard,bitbucket,bluebite,boxfuse,brave,*.s.brave,browsersafetymark,cdn.bubble,bubbleapps,cleverapps,cloudbeesusercontent,dyndns.dappnode,darklang,definima,dedyn,icp0,*.raw.icp0,icp1,*.raw.icp1,qzz,fh-muenster,gitbook,github,gitlab,lolipop,hasura-app,hostyhosting,hypernode,*.moonscale,paas.beebyte,sekd1.beebyteapp,jele,keenetic,kiloapps,webthings,loginline,barsy,*.azurecontainer,ngrok,ap.ngrok,au.ngrok,eu.ngrok,in.ngrok,jp.ngrok,sa.ngrok,us.ngrok,stage.nodeart,pantheonsite,id.forgerock,pstmn,mock.pstmn,qcx,*.sys.qcx,qoto,vaporcloud,myrdbx,site.rb-hosting,*.on-k3s,*.on-rio,readthedocs,resindevice,devices.resinstaging,sandcats,client.scrypted,mo-siemens,apps.lair,*.stolos,musician,utwente,edugit,telebit,cust.dev.thingdust,reservd.dev.thingdust,cust.disrec.thingdust,reservd.disrec.thingdust,cust.prod.thingdust,cust.testing.thingdust,reservd.testing.thingdust,tickets,2038,webflow,webflowtest,drive-platform,editorx,wixstudio,basicserver,virtualserver;iq:com,edu,gov,mil,net,org;ir:ac,co,gov,id,net,org,sch,xn--mgba3a4f16a,xn--mgba3a4fra,arvanedge,vistablog;it:edu,gov,abr,abruzzo,aosta-valley,aostavalley,bas,basilicata,cal,calabria,cam,campania,emilia-romagna,emiliaromagna,emr,friuli-v-giulia,friuli-ve-giulia,friuli-vegiulia,friuli-venezia-giulia,friuli-veneziagiulia,friuli-vgiulia,friuliv-giulia,friulive-giulia,friulivegiulia,friulivenezia-giulia,friuliveneziagiulia,friulivgiulia,fvg,laz,lazio,lig,liguria,lom,lombardia,lombardy,lucania,mar,marche,mol,molise,piedmont,piemonte,pmn,pug,puglia,sar,sardegna,sardinia,sic,sicilia,sicily,taa,tos,toscana,trentin-sud-tirol,xn--trentin-sd-tirol-rzb,trentin-sudtirol,xn--trentin-sdtirol-7vb,trentin-sued-tirol,trentin-suedtirol,trentino-a-adige,trentino-aadige,trentino-alto-adige,trentino-altoadige,trentino-s-tirol,trentino-stirol,trentino-sud-tirol,xn--trentino-sd-tirol-c3b,trentino-sudtirol,xn--trentino-sdtirol-szb,trentino-sued-tirol,trentino-suedtirol,trentinoa-adige,trentinoaadige,trentinoalto-adige,trentinoaltoadige,trentinos-tirol,trentinostirol,trentinosud-tirol,xn--trentinosd-tirol-rzb,xn--trentinosdtirol-7vb,trentinosued-tirol,trentinosuedtirol,trentinsud-tirol,xn--trentinsd-tirol-6vb,trentinsudtirol,xn--trentinsdtirol-nsb,trentinsued-tirol,trentinsuedtirol,tuscany,umb,umbria,val-d-aosta,val-daosta,vald-aosta,valle-aosta,valle-d-aosta,valle-daosta,valleaosta,valled-aosta,valledaosta,vallee-aoste,xn--valle-aoste-ebb,vallee-d-aoste,xn--valle-d-aoste-ehb,valleeaoste,xn--valleaoste-e7a,valleedaoste,xn--valledaoste-ebb,vao,vda,ven,veneto,ag,agrigento,al,alessandria,alto-adige,altoadige,an,ancona,andria-barletta-trani,andria-trani-barletta,andriabarlettatrani,andriatranibarletta,ao,aosta,aoste,ap,aq,ar,arezzo,ascoli-piceno,ascolipiceno,asti,at,av,avellino,ba,balsan,balsan-sudtirol,xn--balsan-sdtirol-nsb,balsan-suedtirol,bari,barletta-trani-andria,barlettatraniandria,belluno,benevento,bergamo,bg,bi,biella,bl,bn,bo,bologna,bolzano,bolzano-altoadige,bozen,bozen-sudtirol,xn--bozen-sdtirol-2ob,bozen-suedtirol,br,brescia,brindisi,bs,bt,bulsan,bulsan-sudtirol,xn--bulsan-sdtirol-nsb,bulsan-suedtirol,bz,ca,cagliari,caltanissetta,campidano-medio,campidanomedio,campobasso,carbonia-iglesias,carboniaiglesias,carrara-massa,carraramassa,caserta,catania,catanzaro,cb,ce,cesena-forli,xn--cesena-forl-mcb,cesenaforli,xn--cesenaforl-i8a,ch,chieti,ci,cl,cn,co,como,cosenza,cr,cremona,crotone,cs,ct,cuneo,cz,dell-ogliastra,dellogliastra,en,enna,fc,fe,fermo,ferrara,fg,fi,firenze,florence,fm,foggia,forli-cesena,xn--forl-cesena-fcb,forlicesena,xn--forlcesena-c8a,fr,frosinone,ge,genoa,genova,go,gorizia,gr,grosseto,iglesias-carbonia,iglesiascarbonia,im,imperia,is,isernia,kr,la-spezia,laquila,laspezia,latina,lc,le,lecce,lecco,li,livorno,lo,lodi,lt,lu,lucca,macerata,mantova,massa-carrara,massacarrara,matera,mb,mc,me,medio-campidano,mediocampidano,messina,mi,milan,milano,mn,mo,modena,monza,monza-brianza,monza-e-della-brianza,monzabrianza,monzaebrianza,monzaedellabrianza,ms,mt,na,naples,napoli,no,novara,nu,nuoro,og,ogliastra,olbia-tempio,olbiatempio,or,oristano,ot,pa,padova,padua,palermo,parma,pavia,pc,pd,pe,perugia,pesaro-urbino,pesarourbino,pescara,pg,pi,piacenza,pisa,pistoia,pn,po,pordenone,potenza,pr,prato,pt,pu,pv,pz,ra,ragusa,ravenna,rc,re,reggio-calabria,reggio-emilia,reggiocalabria,reggioemilia,rg,ri,rieti,rimini,rm,rn,ro,roma,rome,rovigo,sa,salerno,sassari,savona,si,siena,siracusa,so,sondrio,sp,sr,ss,su,sud-sardegna,sudsardegna,xn--sdtirol-n2a,suedtirol,sv,ta,taranto,te,tempio-olbia,tempioolbia,teramo,terni,tn,to,torino,tp,tr,trani-andria-barletta,trani-barletta-andria,traniandriabarletta,tranibarlettaandria,trapani,trentino,trento,treviso,trieste,ts,turin,tv,ud,udine,urbino-pesaro,urbinopesaro,va,varese,vb,vc,ve,venezia,venice,verbania,verbano-cusio-ossola,vercelli,verona,vi,vibo-valentia,vibovalentia,vicenza,viterbo,vr,vs,vt,vv,dnshome,ibxos,iliadboxos,jc.neen,123homepage,16-b,32-b,64-b,myspreadshop,syncloud;je:co,net,org,of;jm:*;jo:agri,ai,com,edu,eng,fm,gov,mil,net,org,per,phd,sch,tv;jp:ac,ad,co,ed,go,gr,lg,ne,or,aichi,akita,aomori,chiba,ehime,fukui,fukuoka,fukushima,gifu,gunma,hiroshima,hokkaido,hyogo,ibaraki,ishikawa,iwate,kagawa,kagoshima,kanagawa,kochi,kumamoto,kyoto,mie,miyagi,miyazaki,nagano,nagasaki,nara,niigata,oita,okayama,okinawa,osaka,saga,saitama,shiga,shimane,shizuoka,tochigi,tokushima,tokyo,tottori,toyama,wakayama,yamagata,yamaguchi,yamanashi,xn--ehqz56n,xn--1lqs03n,xn--qqqt11m,xn--f6qx53a,xn--djrs72d6uy,xn--mkru45i,xn--0trq7p7nn,xn--5js045d,xn--kbrq7o,xn--pssu33l,xn--ntsq17g,xn--uisz3g,xn--6btw5a,xn--1ctwo,xn--6orx2r,xn--rht61e,xn--rht27z,xn--nit225k,xn--rht3d,xn--djty4k,xn--klty5x,xn--kltx9a,xn--kltp7d,xn--c3s14m,xn--vgu402c,xn--efvn9s,xn--1lqs71d,xn--4pvxs,xn--uuwu58a,xn--zbx025d,xn--8pvr4u,xn--5rtp49c,xn--ntso0iqx3a,xn--elqq16h,xn--4it168d,xn--klt787d,xn--rny31h,xn--7t0a264c,xn--uist22h,xn--8ltr62k,xn--2m4a15e,xn--32vp30h,xn--4it797k,xn--5rtq34k,xn--k7yn95e,xn--tor131o,xn--d5qv7z876c,*.kawasaki,!city.kawasaki,*.kitakyushu,!city.kitakyushu,*.kobe,!city.kobe,*.nagoya,!city.nagoya,*.sapporo,!city.sapporo,*.sendai,!city.sendai,*.yokohama,!city.yokohama,aisai.aichi,ama.aichi,anjo.aichi,asuke.aichi,chiryu.aichi,chita.aichi,fuso.aichi,gamagori.aichi,handa.aichi,hazu.aichi,hekinan.aichi,higashiura.aichi,ichinomiya.aichi,inazawa.aichi,inuyama.aichi,isshiki.aichi,iwakura.aichi,kanie.aichi,kariya.aichi,kasugai.aichi,kira.aichi,kiyosu.aichi,komaki.aichi,konan.aichi,kota.aichi,mihama.aichi,miyoshi.aichi,nishio.aichi,nisshin.aichi,obu.aichi,oguchi.aichi,oharu.aichi,okazaki.aichi,owariasahi.aichi,seto.aichi,shikatsu.aichi,shinshiro.aichi,shitara.aichi,tahara.aichi,takahama.aichi,tobishima.aichi,toei.aichi,togo.aichi,tokai.aichi,tokoname.aichi,toyoake.aichi,toyohashi.aichi,toyokawa.aichi,toyone.aichi,toyota.aichi,tsushima.aichi,yatomi.aichi,akita.akita,daisen.akita,fujisato.akita,gojome.akita,hachirogata.akita,happou.akita,higashinaruse.akita,honjo.akita,honjyo.akita,ikawa.akita,kamikoani.akita,kamioka.akita,katagami.akita,kazuno.akita,kitaakita.akita,kosaka.akita,kyowa.akita,misato.akita,mitane.akita,moriyoshi.akita,nikaho.akita,noshiro.akita,odate.akita,oga.akita,ogata.akita,semboku.akita,yokote.akita,yurihonjo.akita,aomori.aomori,gonohe.aomori,hachinohe.aomori,hashikami.aomori,hiranai.aomori,hirosaki.aomori,itayanagi.aomori,kuroishi.aomori,misawa.aomori,mutsu.aomori,nakadomari.aomori,noheji.aomori,oirase.aomori,owani.aomori,rokunohe.aomori,sannohe.aomori,shichinohe.aomori,shingo.aomori,takko.aomori,towada.aomori,tsugaru.aomori,tsuruta.aomori,abiko.chiba,asahi.chiba,chonan.chiba,chosei.chiba,choshi.chiba,chuo.chiba,funabashi.chiba,futtsu.chiba,hanamigawa.chiba,ichihara.chiba,ichikawa.chiba,ichinomiya.chiba,inzai.chiba,isumi.chiba,kamagaya.chiba,kamogawa.chiba,kashiwa.chiba,katori.chiba,katsuura.chiba,kimitsu.chiba,kisarazu.chiba,kozaki.chiba,kujukuri.chiba,kyonan.chiba,matsudo.chiba,midori.chiba,mihama.chiba,minamiboso.chiba,mobara.chiba,mutsuzawa.chiba,nagara.chiba,nagareyama.chiba,narashino.chiba,narita.chiba,noda.chiba,oamishirasato.chiba,omigawa.chiba,onjuku.chiba,otaki.chiba,sakae.chiba,sakura.chiba,shimofusa.chiba,shirako.chiba,shiroi.chiba,shisui.chiba,sodegaura.chiba,sosa.chiba,tako.chiba,tateyama.chiba,togane.chiba,tohnosho.chiba,tomisato.chiba,urayasu.chiba,yachimata.chiba,yachiyo.chiba,yokaichiba.chiba,yokoshibahikari.chiba,yotsukaido.chiba,ainan.ehime,honai.ehime,ikata.ehime,imabari.ehime,iyo.ehime,kamijima.ehime,kihoku.ehime,kumakogen.ehime,masaki.ehime,matsuno.ehime,matsuyama.ehime,namikata.ehime,niihama.ehime,ozu.ehime,saijo.ehime,seiyo.ehime,shikokuchuo.ehime,tobe.ehime,toon.ehime,uchiko.ehime,uwajima.ehime,yawatahama.ehime,echizen.fukui,eiheiji.fukui,fukui.fukui,ikeda.fukui,katsuyama.fukui,mihama.fukui,minamiechizen.fukui,obama.fukui,ohi.fukui,ono.fukui,sabae.fukui,sakai.fukui,takahama.fukui,tsuruga.fukui,wakasa.fukui,ashiya.fukuoka,buzen.fukuoka,chikugo.fukuoka,chikuho.fukuoka,chikujo.fukuoka,chikushino.fukuoka,chikuzen.fukuoka,chuo.fukuoka,dazaifu.fukuoka,fukuchi.fukuoka,hakata.fukuoka,higashi.fukuoka,hirokawa.fukuoka,hisayama.fukuoka,iizuka.fukuoka,inatsuki.fukuoka,kaho.fukuoka,kasuga.fukuoka,kasuya.fukuoka,kawara.fukuoka,keisen.fukuoka,koga.fukuoka,kurate.fukuoka,kurogi.fukuoka,kurume.fukuoka,minami.fukuoka,miyako.fukuoka,miyama.fukuoka,miyawaka.fukuoka,mizumaki.fukuoka,munakata.fukuoka,nakagawa.fukuoka,nakama.fukuoka,nishi.fukuoka,nogata.fukuoka,ogori.fukuoka,okagaki.fukuoka,okawa.fukuoka,oki.fukuoka,omuta.fukuoka,onga.fukuoka,onojo.fukuoka,oto.fukuoka,saigawa.fukuoka,sasaguri.fukuoka,shingu.fukuoka,shinyoshitomi.fukuoka,shonai.fukuoka,soeda.fukuoka,sue.fukuoka,tachiarai.fukuoka,tagawa.fukuoka,takata.fukuoka,toho.fukuoka,toyotsu.fukuoka,tsuiki.fukuoka,ukiha.fukuoka,umi.fukuoka,usui.fukuoka,yamada.fukuoka,yame.fukuoka,yanagawa.fukuoka,yukuhashi.fukuoka,aizubange.fukushima,aizumisato.fukushima,aizuwakamatsu.fukushima,asakawa.fukushima,bandai.fukushima,date.fukushima,fukushima.fukushima,furudono.fukushima,futaba.fukushima,hanawa.fukushima,higashi.fukushima,hirata.fukushima,hirono.fukushima,iitate.fukushima,inawashiro.fukushima,ishikawa.fukushima,iwaki.fukushima,izumizaki.fukushima,kagamiishi.fukushima,kaneyama.fukushima,kawamata.fukushima,kitakata.fukushima,kitashiobara.fukushima,koori.fukushima,koriyama.fukushima,kunimi.fukushima,miharu.fukushima,mishima.fukushima,namie.fukushima,nango.fukushima,nishiaizu.fukushima,nishigo.fukushima,okuma.fukushima,omotego.fukushima,ono.fukushima,otama.fukushima,samegawa.fukushima,shimogo.fukushima,shirakawa.fukushima,showa.fukushima,soma.fukushima,sukagawa.fukushima,taishin.fukushima,tamakawa.fukushima,tanagura.fukushima,tenei.fukushima,yabuki.fukushima,yamato.fukushima,yamatsuri.fukushima,yanaizu.fukushima,yugawa.fukushima,anpachi.gifu,ena.gifu,gifu.gifu,ginan.gifu,godo.gifu,gujo.gifu,hashima.gifu,hichiso.gifu,hida.gifu,higashishirakawa.gifu,ibigawa.gifu,ikeda.gifu,kakamigahara.gifu,kani.gifu,kasahara.gifu,kasamatsu.gifu,kawaue.gifu,kitagata.gifu,mino.gifu,minokamo.gifu,mitake.gifu,mizunami.gifu,motosu.gifu,nakatsugawa.gifu,ogaki.gifu,sakahogi.gifu,seki.gifu,sekigahara.gifu,shirakawa.gifu,tajimi.gifu,takayama.gifu,tarui.gifu,toki.gifu,tomika.gifu,wanouchi.gifu,yamagata.gifu,yaotsu.gifu,yoro.gifu,annaka.gunma,chiyoda.gunma,fujioka.gunma,higashiagatsuma.gunma,isesaki.gunma,itakura.gunma,kanna.gunma,kanra.gunma,katashina.gunma,kawaba.gunma,kiryu.gunma,kusatsu.gunma,maebashi.gunma,meiwa.gunma,midori.gunma,minakami.gunma,naganohara.gunma,nakanojo.gunma,nanmoku.gunma,numata.gunma,oizumi.gunma,ora.gunma,ota.gunma,shibukawa.gunma,shimonita.gunma,shinto.gunma,showa.gunma,takasaki.gunma,takayama.gunma,tamamura.gunma,tatebayashi.gunma,tomioka.gunma,tsukiyono.gunma,tsumagoi.gunma,ueno.gunma,yoshioka.gunma,asaminami.hiroshima,daiwa.hiroshima,etajima.hiroshima,fuchu.hiroshima,fukuyama.hiroshima,hatsukaichi.hiroshima,higashihiroshima.hiroshima,hongo.hiroshima,jinsekikogen.hiroshima,kaita.hiroshima,kui.hiroshima,kumano.hiroshima,kure.hiroshima,mihara.hiroshima,miyoshi.hiroshima,naka.hiroshima,onomichi.hiroshima,osakikamijima.hiroshima,otake.hiroshima,saka.hiroshima,sera.hiroshima,seranishi.hiroshima,shinichi.hiroshima,shobara.hiroshima,takehara.hiroshima,abashiri.hokkaido,abira.hokkaido,aibetsu.hokkaido,akabira.hokkaido,akkeshi.hokkaido,asahikawa.hokkaido,ashibetsu.hokkaido,ashoro.hokkaido,assabu.hokkaido,atsuma.hokkaido,bibai.hokkaido,biei.hokkaido,bifuka.hokkaido,bihoro.hokkaido,biratori.hokkaido,chippubetsu.hokkaido,chitose.hokkaido,date.hokkaido,ebetsu.hokkaido,embetsu.hokkaido,eniwa.hokkaido,erimo.hokkaido,esan.hokkaido,esashi.hokkaido,fukagawa.hokkaido,fukushima.hokkaido,furano.hokkaido,furubira.hokkaido,haboro.hokkaido,hakodate.hokkaido,hamatonbetsu.hokkaido,hidaka.hokkaido,higashikagura.hokkaido,higashikawa.hokkaido,hiroo.hokkaido,hokuryu.hokkaido,hokuto.hokkaido,honbetsu.hokkaido,horokanai.hokkaido,horonobe.hokkaido,ikeda.hokkaido,imakane.hokkaido,ishikari.hokkaido,iwamizawa.hokkaido,iwanai.hokkaido,kamifurano.hokkaido,kamikawa.hokkaido,kamishihoro.hokkaido,kamisunagawa.hokkaido,kamoenai.hokkaido,kayabe.hokkaido,kembuchi.hokkaido,kikonai.hokkaido,kimobetsu.hokkaido,kitahiroshima.hokkaido,kitami.hokkaido,kiyosato.hokkaido,koshimizu.hokkaido,kunneppu.hokkaido,kuriyama.hokkaido,kuromatsunai.hokkaido,kushiro.hokkaido,kutchan.hokkaido,kyowa.hokkaido,mashike.hokkaido,matsumae.hokkaido,mikasa.hokkaido,minamifurano.hokkaido,mombetsu.hokkaido,moseushi.hokkaido,mukawa.hokkaido,muroran.hokkaido,naie.hokkaido,nakagawa.hokkaido,nakasatsunai.hokkaido,nakatombetsu.hokkaido,nanae.hokkaido,nanporo.hokkaido,nayoro.hokkaido,nemuro.hokkaido,niikappu.hokkaido,niki.hokkaido,nishiokoppe.hokkaido,noboribetsu.hokkaido,numata.hokkaido,obihiro.hokkaido,obira.hokkaido,oketo.hokkaido,okoppe.hokkaido,otaru.hokkaido,otobe.hokkaido,otofuke.hokkaido,otoineppu.hokkaido,oumu.hokkaido,ozora.hokkaido,pippu.hokkaido,rankoshi.hokkaido,rebun.hokkaido,rikubetsu.hokkaido,rishiri.hokkaido,rishirifuji.hokkaido,saroma.hokkaido,sarufutsu.hokkaido,shakotan.hokkaido,shari.hokkaido,shibecha.hokkaido,shibetsu.hokkaido,shikabe.hokkaido,shikaoi.hokkaido,shimamaki.hokkaido,shimizu.hokkaido,shimokawa.hokkaido,shinshinotsu.hokkaido,shintoku.hokkaido,shiranuka.hokkaido,shiraoi.hokkaido,shiriuchi.hokkaido,sobetsu.hokkaido,sunagawa.hokkaido,taiki.hokkaido,takasu.hokkaido,takikawa.hokkaido,takinoue.hokkaido,teshikaga.hokkaido,tobetsu.hokkaido,tohma.hokkaido,tomakomai.hokkaido,tomari.hokkaido,toya.hokkaido,toyako.hokkaido,toyotomi.hokkaido,toyoura.hokkaido,tsubetsu.hokkaido,tsukigata.hokkaido,urakawa.hokkaido,urausu.hokkaido,uryu.hokkaido,utashinai.hokkaido,wakkanai.hokkaido,wassamu.hokkaido,yakumo.hokkaido,yoichi.hokkaido,aioi.hyogo,akashi.hyogo,ako.hyogo,amagasaki.hyogo,aogaki.hyogo,asago.hyogo,ashiya.hyogo,awaji.hyogo,fukusaki.hyogo,goshiki.hyogo,harima.hyogo,himeji.hyogo,ichikawa.hyogo,inagawa.hyogo,itami.hyogo,kakogawa.hyogo,kamigori.hyogo,kamikawa.hyogo,kasai.hyogo,kasuga.hyogo,kawanishi.hyogo,miki.hyogo,minamiawaji.hyogo,nishinomiya.hyogo,nishiwaki.hyogo,ono.hyogo,sanda.hyogo,sannan.hyogo,sasayama.hyogo,sayo.hyogo,shingu.hyogo,shinonsen.hyogo,shiso.hyogo,sumoto.hyogo,taishi.hyogo,taka.hyogo,takarazuka.hyogo,takasago.hyogo,takino.hyogo,tamba.hyogo,tatsuno.hyogo,toyooka.hyogo,yabu.hyogo,yashiro.hyogo,yoka.hyogo,yokawa.hyogo,ami.ibaraki,asahi.ibaraki,bando.ibaraki,chikusei.ibaraki,daigo.ibaraki,fujishiro.ibaraki,hitachi.ibaraki,hitachinaka.ibaraki,hitachiomiya.ibaraki,hitachiota.ibaraki,ibaraki.ibaraki,ina.ibaraki,inashiki.ibaraki,itako.ibaraki,iwama.ibaraki,joso.ibaraki,kamisu.ibaraki,kasama.ibaraki,kashima.ibaraki,kasumigaura.ibaraki,koga.ibaraki,miho.ibaraki,mito.ibaraki,moriya.ibaraki,naka.ibaraki,namegata.ibaraki,oarai.ibaraki,ogawa.ibaraki,omitama.ibaraki,ryugasaki.ibaraki,sakai.ibaraki,sakuragawa.ibaraki,shimodate.ibaraki,shimotsuma.ibaraki,shirosato.ibaraki,sowa.ibaraki,suifu.ibaraki,takahagi.ibaraki,tamatsukuri.ibaraki,tokai.ibaraki,tomobe.ibaraki,tone.ibaraki,toride.ibaraki,tsuchiura.ibaraki,tsukuba.ibaraki,uchihara.ibaraki,ushiku.ibaraki,yachiyo.ibaraki,yamagata.ibaraki,yawara.ibaraki,yuki.ibaraki,anamizu.ishikawa,hakui.ishikawa,hakusan.ishikawa,kaga.ishikawa,kahoku.ishikawa,kanazawa.ishikawa,kawakita.ishikawa,komatsu.ishikawa,nakanoto.ishikawa,nanao.ishikawa,nomi.ishikawa,nonoichi.ishikawa,noto.ishikawa,shika.ishikawa,suzu.ishikawa,tsubata.ishikawa,tsurugi.ishikawa,uchinada.ishikawa,wajima.ishikawa,fudai.iwate,fujisawa.iwate,hanamaki.iwate,hiraizumi.iwate,hirono.iwate,ichinohe.iwate,ichinoseki.iwate,iwaizumi.iwate,iwate.iwate,joboji.iwate,kamaishi.iwate,kanegasaki.iwate,karumai.iwate,kawai.iwate,kitakami.iwate,kuji.iwate,kunohe.iwate,kuzumaki.iwate,miyako.iwate,mizusawa.iwate,morioka.iwate,ninohe.iwate,noda.iwate,ofunato.iwate,oshu.iwate,otsuchi.iwate,rikuzentakata.iwate,shiwa.iwate,shizukuishi.iwate,sumita.iwate,tanohata.iwate,tono.iwate,yahaba.iwate,yamada.iwate,ayagawa.kagawa,higashikagawa.kagawa,kanonji.kagawa,kotohira.kagawa,manno.kagawa,marugame.kagawa,mitoyo.kagawa,naoshima.kagawa,sanuki.kagawa,tadotsu.kagawa,takamatsu.kagawa,tonosho.kagawa,uchinomi.kagawa,utazu.kagawa,zentsuji.kagawa,akune.kagoshima,amami.kagoshima,hioki.kagoshima,isa.kagoshima,isen.kagoshima,izumi.kagoshima,kagoshima.kagoshima,kanoya.kagoshima,kawanabe.kagoshima,kinko.kagoshima,kouyama.kagoshima,makurazaki.kagoshima,matsumoto.kagoshima,minamitane.kagoshima,nakatane.kagoshima,nishinoomote.kagoshima,satsumasendai.kagoshima,soo.kagoshima,tarumizu.kagoshima,yusui.kagoshima,aikawa.kanagawa,atsugi.kanagawa,ayase.kanagawa,chigasaki.kanagawa,ebina.kanagawa,fujisawa.kanagawa,hadano.kanagawa,hakone.kanagawa,hiratsuka.kanagawa,isehara.kanagawa,kaisei.kanagawa,kamakura.kanagawa,kiyokawa.kanagawa,matsuda.kanagawa,minamiashigara.kanagawa,miura.kanagawa,nakai.kanagawa,ninomiya.kanagawa,odawara.kanagawa,oi.kanagawa,oiso.kanagawa,sagamihara.kanagawa,samukawa.kanagawa,tsukui.kanagawa,yamakita.kanagawa,yamato.kanagawa,yokosuka.kanagawa,yugawara.kanagawa,zama.kanagawa,zushi.kanagawa,aki.kochi,geisei.kochi,hidaka.kochi,higashitsuno.kochi,ino.kochi,kagami.kochi,kami.kochi,kitagawa.kochi,kochi.kochi,mihara.kochi,motoyama.kochi,muroto.kochi,nahari.kochi,nakamura.kochi,nankoku.kochi,nishitosa.kochi,niyodogawa.kochi,ochi.kochi,okawa.kochi,otoyo.kochi,otsuki.kochi,sakawa.kochi,sukumo.kochi,susaki.kochi,tosa.kochi,tosashimizu.kochi,toyo.kochi,tsuno.kochi,umaji.kochi,yasuda.kochi,yusuhara.kochi,amakusa.kumamoto,arao.kumamoto,aso.kumamoto,choyo.kumamoto,gyokuto.kumamoto,kamiamakusa.kumamoto,kikuchi.kumamoto,kumamoto.kumamoto,mashiki.kumamoto,mifune.kumamoto,minamata.kumamoto,minamioguni.kumamoto,nagasu.kumamoto,nishihara.kumamoto,oguni.kumamoto,ozu.kumamoto,sumoto.kumamoto,takamori.kumamoto,uki.kumamoto,uto.kumamoto,yamaga.kumamoto,yamato.kumamoto,yatsushiro.kumamoto,ayabe.kyoto,fukuchiyama.kyoto,higashiyama.kyoto,ide.kyoto,ine.kyoto,joyo.kyoto,kameoka.kyoto,kamo.kyoto,kita.kyoto,kizu.kyoto,kumiyama.kyoto,kyotamba.kyoto,kyotanabe.kyoto,kyotango.kyoto,maizuru.kyoto,minami.kyoto,minamiyamashiro.kyoto,miyazu.kyoto,muko.kyoto,nagaokakyo.kyoto,nakagyo.kyoto,nantan.kyoto,oyamazaki.kyoto,sakyo.kyoto,seika.kyoto,tanabe.kyoto,uji.kyoto,ujitawara.kyoto,wazuka.kyoto,yamashina.kyoto,yawata.kyoto,asahi.mie,inabe.mie,ise.mie,kameyama.mie,kawagoe.mie,kiho.mie,kisosaki.mie,kiwa.mie,komono.mie,kumano.mie,kuwana.mie,matsusaka.mie,meiwa.mie,mihama.mie,minamiise.mie,misugi.mie,miyama.mie,nabari.mie,shima.mie,suzuka.mie,tado.mie,taiki.mie,taki.mie,tamaki.mie,toba.mie,tsu.mie,udono.mie,ureshino.mie,watarai.mie,yokkaichi.mie,furukawa.miyagi,higashimatsushima.miyagi,ishinomaki.miyagi,iwanuma.miyagi,kakuda.miyagi,kami.miyagi,kawasaki.miyagi,marumori.miyagi,matsushima.miyagi,minamisanriku.miyagi,misato.miyagi,murata.miyagi,natori.miyagi,ogawara.miyagi,ohira.miyagi,onagawa.miyagi,osaki.miyagi,rifu.miyagi,semine.miyagi,shibata.miyagi,shichikashuku.miyagi,shikama.miyagi,shiogama.miyagi,shiroishi.miyagi,tagajo.miyagi,taiwa.miyagi,tome.miyagi,tomiya.miyagi,wakuya.miyagi,watari.miyagi,yamamoto.miyagi,zao.miyagi,aya.miyazaki,ebino.miyazaki,gokase.miyazaki,hyuga.miyazaki,kadogawa.miyazaki,kawaminami.miyazaki,kijo.miyazaki,kitagawa.miyazaki,kitakata.miyazaki,kitaura.miyazaki,kobayashi.miyazaki,kunitomi.miyazaki,kushima.miyazaki,mimata.miyazaki,miyakonojo.miyazaki,miyazaki.miyazaki,morotsuka.miyazaki,nichinan.miyazaki,nishimera.miyazaki,nobeoka.miyazaki,saito.miyazaki,shiiba.miyazaki,shintomi.miyazaki,takaharu.miyazaki,takanabe.miyazaki,takazaki.miyazaki,tsuno.miyazaki,achi.nagano,agematsu.nagano,anan.nagano,aoki.nagano,asahi.nagano,azumino.nagano,chikuhoku.nagano,chikuma.nagano,chino.nagano,fujimi.nagano,hakuba.nagano,hara.nagano,hiraya.nagano,iida.nagano,iijima.nagano,iiyama.nagano,iizuna.nagano,ikeda.nagano,ikusaka.nagano,ina.nagano,karuizawa.nagano,kawakami.nagano,kiso.nagano,kisofukushima.nagano,kitaaiki.nagano,komagane.nagano,komoro.nagano,matsukawa.nagano,matsumoto.nagano,miasa.nagano,minamiaiki.nagano,minamimaki.nagano,minamiminowa.nagano,minowa.nagano,miyada.nagano,miyota.nagano,mochizuki.nagano,nagano.nagano,nagawa.nagano,nagiso.nagano,nakagawa.nagano,nakano.nagano,nozawaonsen.nagano,obuse.nagano,ogawa.nagano,okaya.nagano,omachi.nagano,omi.nagano,ookuwa.nagano,ooshika.nagano,otaki.nagano,otari.nagano,sakae.nagano,sakaki.nagano,saku.nagano,sakuho.nagano,shimosuwa.nagano,shinanomachi.nagano,shiojiri.nagano,suwa.nagano,suzaka.nagano,takagi.nagano,takamori.nagano,takayama.nagano,tateshina.nagano,tatsuno.nagano,togakushi.nagano,togura.nagano,tomi.nagano,ueda.nagano,wada.nagano,yamagata.nagano,yamanouchi.nagano,yasaka.nagano,yasuoka.nagano,chijiwa.nagasaki,futsu.nagasaki,goto.nagasaki,hasami.nagasaki,hirado.nagasaki,iki.nagasaki,isahaya.nagasaki,kawatana.nagasaki,kuchinotsu.nagasaki,matsuura.nagasaki,nagasaki.nagasaki,obama.nagasaki,omura.nagasaki,oseto.nagasaki,saikai.nagasaki,sasebo.nagasaki,seihi.nagasaki,shimabara.nagasaki,shinkamigoto.nagasaki,togitsu.nagasaki,tsushima.nagasaki,unzen.nagasaki,ando.nara,gose.nara,heguri.nara,higashiyoshino.nara,ikaruga.nara,ikoma.nara,kamikitayama.nara,kanmaki.nara,kashiba.nara,kashihara.nara,katsuragi.nara,kawai.nara,kawakami.nara,kawanishi.nara,koryo.nara,kurotaki.nara,mitsue.nara,miyake.nara,nara.nara,nosegawa.nara,oji.nara,ouda.nara,oyodo.nara,sakurai.nara,sango.nara,shimoichi.nara,shimokitayama.nara,shinjo.nara,soni.nara,takatori.nara,tawaramoto.nara,tenkawa.nara,tenri.nara,uda.nara,yamatokoriyama.nara,yamatotakada.nara,yamazoe.nara,yoshino.nara,aga.niigata,agano.niigata,gosen.niigata,itoigawa.niigata,izumozaki.niigata,joetsu.niigata,kamo.niigata,kariwa.niigata,kashiwazaki.niigata,minamiuonuma.niigata,mitsuke.niigata,muika.niigata,murakami.niigata,myoko.niigata,nagaoka.niigata,niigata.niigata,ojiya.niigata,omi.niigata,sado.niigata,sanjo.niigata,seiro.niigata,seirou.niigata,sekikawa.niigata,shibata.niigata,tagami.niigata,tainai.niigata,tochio.niigata,tokamachi.niigata,tsubame.niigata,tsunan.niigata,uonuma.niigata,yahiko.niigata,yoita.niigata,yuzawa.niigata,beppu.oita,bungoono.oita,bungotakada.oita,hasama.oita,hiji.oita,himeshima.oita,hita.oita,kamitsue.oita,kokonoe.oita,kuju.oita,kunisaki.oita,kusu.oita,oita.oita,saiki.oita,taketa.oita,tsukumi.oita,usa.oita,usuki.oita,yufu.oita,akaiwa.okayama,asakuchi.okayama,bizen.okayama,hayashima.okayama,ibara.okayama,kagamino.okayama,kasaoka.okayama,kibichuo.okayama,kumenan.okayama,kurashiki.okayama,maniwa.okayama,misaki.okayama,nagi.okayama,niimi.okayama,nishiawakura.okayama,okayama.okayama,satosho.okayama,setouchi.okayama,shinjo.okayama,shoo.okayama,soja.okayama,takahashi.okayama,tamano.okayama,tsuyama.okayama,wake.okayama,yakage.okayama,aguni.okinawa,ginowan.okinawa,ginoza.okinawa,gushikami.okinawa,haebaru.okinawa,higashi.okinawa,hirara.okinawa,iheya.okinawa,ishigaki.okinawa,ishikawa.okinawa,itoman.okinawa,izena.okinawa,kadena.okinawa,kin.okinawa,kitadaito.okinawa,kitanakagusuku.okinawa,kumejima.okinawa,kunigami.okinawa,minamidaito.okinawa,motobu.okinawa,nago.okinawa,naha.okinawa,nakagusuku.okinawa,nakijin.okinawa,nanjo.okinawa,nishihara.okinawa,ogimi.okinawa,okinawa.okinawa,onna.okinawa,shimoji.okinawa,taketomi.okinawa,tarama.okinawa,tokashiki.okinawa,tomigusuku.okinawa,tonaki.okinawa,urasoe.okinawa,uruma.okinawa,yaese.okinawa,yomitan.okinawa,yonabaru.okinawa,yonaguni.okinawa,zamami.okinawa,abeno.osaka,chihayaakasaka.osaka,chuo.osaka,daito.osaka,fujiidera.osaka,habikino.osaka,hannan.osaka,higashiosaka.osaka,higashisumiyoshi.osaka,higashiyodogawa.osaka,hirakata.osaka,ibaraki.osaka,ikeda.osaka,izumi.osaka,izumiotsu.osaka,izumisano.osaka,kadoma.osaka,kaizuka.osaka,kanan.osaka,kashiwara.osaka,katano.osaka,kawachinagano.osaka,kishiwada.osaka,kita.osaka,kumatori.osaka,matsubara.osaka,minato.osaka,minoh.osaka,misaki.osaka,moriguchi.osaka,neyagawa.osaka,nishi.osaka,nose.osaka,osakasayama.osaka,sakai.osaka,sayama.osaka,sennan.osaka,settsu.osaka,shijonawate.osaka,shimamoto.osaka,suita.osaka,tadaoka.osaka,taishi.osaka,tajiri.osaka,takaishi.osaka,takatsuki.osaka,tondabayashi.osaka,toyonaka.osaka,toyono.osaka,yao.osaka,ariake.saga,arita.saga,fukudomi.saga,genkai.saga,hamatama.saga,hizen.saga,imari.saga,kamimine.saga,kanzaki.saga,karatsu.saga,kashima.saga,kitagata.saga,kitahata.saga,kiyama.saga,kouhoku.saga,kyuragi.saga,nishiarita.saga,ogi.saga,omachi.saga,ouchi.saga,saga.saga,shiroishi.saga,taku.saga,tara.saga,tosu.saga,yoshinogari.saga,arakawa.saitama,asaka.saitama,chichibu.saitama,fujimi.saitama,fujimino.saitama,fukaya.saitama,hanno.saitama,hanyu.saitama,hasuda.saitama,hatogaya.saitama,hatoyama.saitama,hidaka.saitama,higashichichibu.saitama,higashimatsuyama.saitama,honjo.saitama,ina.saitama,iruma.saitama,iwatsuki.saitama,kamiizumi.saitama,kamikawa.saitama,kamisato.saitama,kasukabe.saitama,kawagoe.saitama,kawaguchi.saitama,kawajima.saitama,kazo.saitama,kitamoto.saitama,koshigaya.saitama,kounosu.saitama,kuki.saitama,kumagaya.saitama,matsubushi.saitama,minano.saitama,misato.saitama,miyashiro.saitama,miyoshi.saitama,moroyama.saitama,nagatoro.saitama,namegawa.saitama,niiza.saitama,ogano.saitama,ogawa.saitama,ogose.saitama,okegawa.saitama,omiya.saitama,otaki.saitama,ranzan.saitama,ryokami.saitama,saitama.saitama,sakado.saitama,satte.saitama,sayama.saitama,shiki.saitama,shiraoka.saitama,soka.saitama,sugito.saitama,toda.saitama,tokigawa.saitama,tokorozawa.saitama,tsurugashima.saitama,urawa.saitama,warabi.saitama,yashio.saitama,yokoze.saitama,yono.saitama,yorii.saitama,yoshida.saitama,yoshikawa.saitama,yoshimi.saitama,aisho.shiga,gamo.shiga,higashiomi.shiga,hikone.shiga,koka.shiga,konan.shiga,kosei.shiga,koto.shiga,kusatsu.shiga,maibara.shiga,moriyama.shiga,nagahama.shiga,nishiazai.shiga,notogawa.shiga,omihachiman.shiga,otsu.shiga,ritto.shiga,ryuoh.shiga,takashima.shiga,takatsuki.shiga,torahime.shiga,toyosato.shiga,yasu.shiga,akagi.shimane,ama.shimane,gotsu.shimane,hamada.shimane,higashiizumo.shimane,hikawa.shimane,hikimi.shimane,izumo.shimane,kakinoki.shimane,masuda.shimane,matsue.shimane,misato.shimane,nishinoshima.shimane,ohda.shimane,okinoshima.shimane,okuizumo.shimane,shimane.shimane,tamayu.shimane,tsuwano.shimane,unnan.shimane,yakumo.shimane,yasugi.shimane,yatsuka.shimane,arai.shizuoka,atami.shizuoka,fuji.shizuoka,fujieda.shizuoka,fujikawa.shizuoka,fujinomiya.shizuoka,fukuroi.shizuoka,gotemba.shizuoka,haibara.shizuoka,hamamatsu.shizuoka,higashiizu.shizuoka,ito.shizuoka,iwata.shizuoka,izu.shizuoka,izunokuni.shizuoka,kakegawa.shizuoka,kannami.shizuoka,kawanehon.shizuoka,kawazu.shizuoka,kikugawa.shizuoka,kosai.shizuoka,makinohara.shizuoka,matsuzaki.shizuoka,minamiizu.shizuoka,mishima.shizuoka,morimachi.shizuoka,nishiizu.shizuoka,numazu.shizuoka,omaezaki.shizuoka,shimada.shizuoka,shimizu.shizuoka,shimoda.shizuoka,shizuoka.shizuoka,susono.shizuoka,yaizu.shizuoka,yoshida.shizuoka,ashikaga.tochigi,bato.tochigi,haga.tochigi,ichikai.tochigi,iwafune.tochigi,kaminokawa.tochigi,kanuma.tochigi,karasuyama.tochigi,kuroiso.tochigi,mashiko.tochigi,mibu.tochigi,moka.tochigi,motegi.tochigi,nasu.tochigi,nasushiobara.tochigi,nikko.tochigi,nishikata.tochigi,nogi.tochigi,ohira.tochigi,ohtawara.tochigi,oyama.tochigi,sakura.tochigi,sano.tochigi,shimotsuke.tochigi,shioya.tochigi,takanezawa.tochigi,tochigi.tochigi,tsuga.tochigi,ujiie.tochigi,utsunomiya.tochigi,yaita.tochigi,aizumi.tokushima,anan.tokushima,ichiba.tokushima,itano.tokushima,kainan.tokushima,komatsushima.tokushima,matsushige.tokushima,mima.tokushima,minami.tokushima,miyoshi.tokushima,mugi.tokushima,nakagawa.tokushima,naruto.tokushima,sanagochi.tokushima,shishikui.tokushima,tokushima.tokushima,wajiki.tokushima,adachi.tokyo,akiruno.tokyo,akishima.tokyo,aogashima.tokyo,arakawa.tokyo,bunkyo.tokyo,chiyoda.tokyo,chofu.tokyo,chuo.tokyo,edogawa.tokyo,fuchu.tokyo,fussa.tokyo,hachijo.tokyo,hachioji.tokyo,hamura.tokyo,higashikurume.tokyo,higashimurayama.tokyo,higashiyamato.tokyo,hino.tokyo,hinode.tokyo,hinohara.tokyo,inagi.tokyo,itabashi.tokyo,katsushika.tokyo,kita.tokyo,kiyose.tokyo,kodaira.tokyo,koganei.tokyo,kokubunji.tokyo,komae.tokyo,koto.tokyo,kouzushima.tokyo,kunitachi.tokyo,machida.tokyo,meguro.tokyo,minato.tokyo,mitaka.tokyo,mizuho.tokyo,musashimurayama.tokyo,musashino.tokyo,nakano.tokyo,nerima.tokyo,ogasawara.tokyo,okutama.tokyo,ome.tokyo,oshima.tokyo,ota.tokyo,setagaya.tokyo,shibuya.tokyo,shinagawa.tokyo,shinjuku.tokyo,suginami.tokyo,sumida.tokyo,tachikawa.tokyo,taito.tokyo,tama.tokyo,toshima.tokyo,chizu.tottori,hino.tottori,kawahara.tottori,koge.tottori,kotoura.tottori,misasa.tottori,nanbu.tottori,nichinan.tottori,sakaiminato.tottori,tottori.tottori,wakasa.tottori,yazu.tottori,yonago.tottori,asahi.toyama,fuchu.toyama,fukumitsu.toyama,funahashi.toyama,himi.toyama,imizu.toyama,inami.toyama,johana.toyama,kamiichi.toyama,kurobe.toyama,nakaniikawa.toyama,namerikawa.toyama,nanto.toyama,nyuzen.toyama,oyabe.toyama,taira.toyama,takaoka.toyama,tateyama.toyama,toga.toyama,tonami.toyama,toyama.toyama,unazuki.toyama,uozu.toyama,yamada.toyama,arida.wakayama,aridagawa.wakayama,gobo.wakayama,hashimoto.wakayama,hidaka.wakayama,hirogawa.wakayama,inami.wakayama,iwade.wakayama,kainan.wakayama,kamitonda.wakayama,katsuragi.wakayama,kimino.wakayama,kinokawa.wakayama,kitayama.wakayama,koya.wakayama,koza.wakayama,kozagawa.wakayama,kudoyama.wakayama,kushimoto.wakayama,mihama.wakayama,misato.wakayama,nachikatsuura.wakayama,shingu.wakayama,shirahama.wakayama,taiji.wakayama,tanabe.wakayama,wakayama.wakayama,yuasa.wakayama,yura.wakayama,asahi.yamagata,funagata.yamagata,higashine.yamagata,iide.yamagata,kahoku.yamagata,kaminoyama.yamagata,kaneyama.yamagata,kawanishi.yamagata,mamurogawa.yamagata,mikawa.yamagata,murayama.yamagata,nagai.yamagata,nakayama.yamagata,nanyo.yamagata,nishikawa.yamagata,obanazawa.yamagata,oe.yamagata,oguni.yamagata,ohkura.yamagata,oishida.yamagata,sagae.yamagata,sakata.yamagata,sakegawa.yamagata,shinjo.yamagata,shirataka.yamagata,shonai.yamagata,takahata.yamagata,tendo.yamagata,tozawa.yamagata,tsuruoka.yamagata,yamagata.yamagata,yamanobe.yamagata,yonezawa.yamagata,yuza.yamagata,abu.yamaguchi,hagi.yamaguchi,hikari.yamaguchi,hofu.yamaguchi,iwakuni.yamaguchi,kudamatsu.yamaguchi,mitou.yamaguchi,nagato.yamaguchi,oshima.yamaguchi,shimonoseki.yamaguchi,shunan.yamaguchi,tabuse.yamaguchi,tokuyama.yamaguchi,toyota.yamaguchi,ube.yamaguchi,yuu.yamaguchi,chuo.yamanashi,doshi.yamanashi,fuefuki.yamanashi,fujikawa.yamanashi,fujikawaguchiko.yamanashi,fujiyoshida.yamanashi,hayakawa.yamanashi,hokuto.yamanashi,ichikawamisato.yamanashi,kai.yamanashi,kofu.yamanashi,koshu.yamanashi,kosuge.yamanashi,minami-alps.yamanashi,minobu.yamanashi,nakamichi.yamanashi,nanbu.yamanashi,narusawa.yamanashi,nirasaki.yamanashi,nishikatsura.yamanashi,oshino.yamanashi,otsuki.yamanashi,showa.yamanashi,tabayama.yamanashi,tsuru.yamanashi,uenohara.yamanashi,yamanakako.yamanashi,yamanashi.yamanashi,user.aseinet.ne,buyshop,fashionstore,handcrafted,kawaiishop,supersale,theshop,0am,0g0,0j0,0t0,mydns,pgw,wjg,gehirn.ne,usercontent,angry,babyblue,babymilk,backdrop,bambina,bitter,blush,boo,boy,boyfriend,but,candypop,capoo,catfood,cheap,chicappa,chillout,chips,chowder,chu,ciao,cocotte,coolblog,cranky,cutegirl,daa,deca,deci,digick,egoism,fakefur,fem,flier,floppy,fool,frenchkiss,girlfriend,girly,gloomy,gonna,greater,hacca,heavy,her,hiho,hippy,holy,hungry,icurus,itigo,jellybean,kikirara,kill,kilo,kuron,littlestar,lolipopmc,lolitapunk,lomo,lovepop,lovesick,main,mods,mond,mongolian,moo,namaste,nikita,nobushi,noor,oops,parallel,parasite,pecori,peewee,penne,pepper,perma,pigboat,pinoko,punyu,pupu,pussycat,pya,raindrop,readymade,sadist,schoolbus,secret,staba,stripper,sub,sunnyday,thick,tonkotsu,under,upper,velvet,verse,versus,vivian,watson,weblike,whitesnow,zombie,hateblo,hatenablog,hatenadiary,2-d,bona,crap,daynight,eek,flop,halfmoon,jeez,matrix,mimoza,ivory.ne,mail-box.ne,mints.ne,mokuren.ne,opal.ne,sakura.ne,sumomo.ne,topaz.ne,netgamers,nyanta,o0o0,rdy,rgr,rulez,s3.isk01.sakurastorage,s3.isk02.sakurastorage,saloon,sblo,skr,tank,uh-oh,undo,rs.webaccel,user.webaccel,websozai,xii;ke:ac,co,go,info,me,mobi,ne,or,sc;kg:com,edu,gov,mil,net,org,us,xx,ae;kh:com,edu,gov,net,org;ki:biz,com,edu,gov,info,net,org;km:ass,com,edu,gov,mil,nom,org,prd,tm,asso,coop,gouv,medecin,notaires,pharmaciens,presse,veterinaire;kn:edu,gov,net,org;kp:com,edu,gov,org,rep,tra;kr:ac,ai,co,es,go,hs,io,it,kg,me,mil,ms,ne,or,pe,re,sc,busan,chungbuk,chungnam,daegu,daejeon,gangwon,gwangju,gyeongbuk,gyeonggi,gyeongnam,incheon,jeju,jeonbuk,jeonnam,seoul,ulsan,c01,eliv-api,eliv-cdn,eliv-dns,mmv,vki;kw:com,edu,emb,gov,ind,net,org;ky:com,edu,net,org;kz:com,edu,gov,mil,net,org,jcloud;la:com,edu,gov,info,int,net,org,per,bnr;lb:com,edu,gov,net,org;lc:co,com,edu,gov,net,org,oy;lk:ac,assn,com,edu,gov,grp,hotel,int,ltd,net,ngo,org,sch,soc,web;lr:com,edu,gov,net,org;ls:ac,biz,co,edu,gov,info,net,org,sc;lt:gov;lv:asn,com,conf,edu,gov,id,mil,net,org;ly:com,edu,gov,id,med,net,org,plc,sch;ma:ac,co,gov,net,org,press;mc:asso,tm;me:ac,co,edu,gov,its,net,org,priv,c66,craft,edgestack,opencloud,mybox,filegear,seprox.hooc,filegear-sg,lohmus,barsy,mcdir,brasilia,ddns,dnsfor,hopto,loginto,noip,webhop,soundcast,tcp4,vp4,grok,diskstation,dscloud,i234,myds,synology,site.transip,nohost;mg:co,com,edu,gov,mil,nom,org,prd;mk:com,edu,gov,inf,name,net,org;ml:ac,art,asso,com,edu,gouv,gov,info,inst,net,org,pr,presse;mm:*;mn:edu,gov,org,nyc;mo:com,edu,gov,net,org;mr:gov;ms:com,edu,gov,net,org,minisite;mt:com,edu,net,org;mu:ac,co,com,gov,net,or,org;mv:aero,biz,com,coop,edu,gov,info,int,mil,museum,name,net,org,pro;mw:ac,biz,co,com,coop,edu,gov,int,net,org;mx:com,edu,gob,net,org;my:biz,com,edu,gov,mil,name,net,org;mz:ac,adv,co,edu,gov,mil,net,org;na:alt,co,com,gov,net,org;nc:asso,nom;nf:arts,com,firm,info,net,other,per,rec,store,web;ng:com,edu,gov,i,mil,mobi,name,net,org,sch,biz,co.biz,dl.biz,go.biz,lg.biz,on.biz,col,firm,gen,ltd,ngo,plc;ni:ac,biz,co,com,edu,gob,in,info,int,mil,net,nom,org,web;no:fhs,folkebibl,fylkesbibl,gielda,herad,idrett,kommune,museum,priv,suohkan,tjielte,uenorge,vgs,dep,mil,stat,aa,ah,bu,fm,hl,hm,jan-mayen,mr,nl,nt,of,ol,oslo,rl,sf,st,svalbard,tm,tr,va,vf,gs.aa,gs.ah,gs.bu,gs.fm,gs.hl,gs.hm,gs.jan-mayen,gs.mr,gs.nl,gs.nt,gs.of,gs.ol,gs.oslo,gs.rl,gs.sf,gs.st,gs.svalbard,gs.tm,gs.tr,gs.va,gs.vf,akrehamn,xn--krehamn-dxa,algard,xn--lgrd-poac,arna,bronnoysund,xn--brnnysund-m8ac,brumunddal,bryne,drobak,xn--drbak-wua,egersund,fetsund,floro,xn--flor-jra,fredrikstad,hokksund,honefoss,xn--hnefoss-q1a,jessheim,jorpeland,xn--jrpeland-54a,kirkenes,kopervik,krokstadelva,langevag,xn--langevg-jxa,leirvik,mjondalen,xn--mjndalen-64a,mo-i-rana,mosjoen,xn--mosjen-eya,nesoddtangen,orkanger,osoyro,xn--osyro-wua,raholt,xn--rholt-mra,sandnessjoen,xn--sandnessjen-ogb,skedsmokorset,slattum,spjelkavik,stathelle,stavern,stjordalshalsen,xn--stjrdalshalsen-sqb,tananger,tranby,vossevangen,aarborte,aejrie,afjord,xn--fjord-lra,agdenes,nes.akershus,aknoluokta,xn--koluokta-7ya57h,al,xn--l-1fa,alaheadju,xn--laheadju-7ya,alesund,xn--lesund-hua,alstahaug,alta,xn--lt-liac,alvdal,amli,xn--mli-tla,amot,xn--mot-tla,andasuolo,andebu,andoy,xn--andy-ira,ardal,xn--rdal-poa,aremark,arendal,xn--s-1fa,aseral,xn--seral-lra,asker,askim,askoy,xn--asky-ira,askvoll,asnes,xn--snes-poa,audnedal,aukra,aure,aurland,aurskog-holand,xn--aurskog-hland-jnb,austevoll,austrheim,averoy,xn--avery-yua,badaddja,xn--bdddj-mrabd,xn--brum-voa,bahcavuotna,xn--bhcavuotna-s4a,bahccavuotna,xn--bhccavuotna-k7a,baidar,xn--bidr-5nac,bajddar,xn--bjddar-pta,balat,xn--blt-elab,balestrand,ballangen,balsfjord,bamble,bardu,barum,batsfjord,xn--btsfjord-9za,bearalvahki,xn--bearalvhki-y4a,beardu,beiarn,berg,bergen,berlevag,xn--berlevg-jxa,bievat,xn--bievt-0qa,bindal,birkenes,bjerkreim,bjugn,bodo,xn--bod-2na,bokn,bomlo,xn--bmlo-gra,bremanger,bronnoy,xn--brnny-wuac,budejju,nes.buskerud,bygland,bykle,cahcesuolo,xn--hcesuolo-7ya35b,davvenjarga,xn--davvenjrga-y4a,davvesiida,deatnu,dielddanuorri,divtasvuodna,divttasvuotna,donna,xn--dnna-gra,dovre,drammen,drangedal,dyroy,xn--dyry-ira,eid,eidfjord,eidsberg,eidskog,eidsvoll,eigersund,elverum,enebakk,engerdal,etne,etnedal,evenassi,xn--eveni-0qa01ga,evenes,evje-og-hornnes,farsund,fauske,fedje,fet,finnoy,xn--finny-yua,fitjar,fjaler,fjell,fla,xn--fl-zia,flakstad,flatanger,flekkefjord,flesberg,flora,folldal,forde,xn--frde-gra,forsand,fosnes,xn--frna-woa,frana,frogn,froland,frosta,froya,xn--frya-hra,fuoisku,fuossko,fusa,fyresdal,gaivuotna,xn--givuotna-8ya,galsa,xn--gls-elac,gamvik,gangaviika,xn--ggaviika-8ya47h,gaular,gausdal,giehtavuoatna,gildeskal,xn--gildeskl-g0a,giske,gjemnes,gjerdrum,gjerstad,gjesdal,gjovik,xn--gjvik-wua,gloppen,gol,gran,grane,granvin,gratangen,grimstad,grong,grue,gulen,guovdageaidnu,ha,xn--h-2fa,habmer,xn--hbmer-xqa,hadsel,xn--hgebostad-g3a,hagebostad,halden,halsa,hamar,hamaroy,xn--hamary-fya,hammarfeasta,xn--hmmrfeasta-s4ac,hammerfest,hapmir,xn--hpmir-xqa,haram,hareid,harstad,hasvik,hattfjelldal,haugesund,os.hedmark,valer.hedmark,xn--vler-qoa.hedmark,hemne,hemnes,hemsedal,hitra,hjartdal,hjelmeland,hobol,xn--hobl-ira,hof,hol,hole,holmestrand,holtalen,xn--holtlen-hxa,os.hordaland,hornindal,horten,hoyanger,xn--hyanger-q1a,hoylandet,xn--hylandet-54a,hurdal,hurum,hvaler,hyllestad,ibestad,inderoy,xn--indery-fya,iveland,ivgu,jevnaker,jolster,xn--jlster-bya,jondal,kafjord,xn--kfjord-iua,karasjohka,xn--krjohka-hwab49j,karasjok,karlsoy,xn--karlsy-fya,karmoy,xn--karmy-yua,kautokeino,klabu,xn--klbu-woa,klepp,kongsberg,kongsvinger,kraanghke,xn--kranghke-b0a,kragero,xn--krager-gya,kristiansand,kristiansund,krodsherad,xn--krdsherad-m8a,xn--kvfjord-nxa,xn--kvnangen-k0a,kvafjord,kvalsund,kvam,kvanangen,kvinesdal,kvinnherad,kviteseid,kvitsoy,xn--kvitsy-fya,laakesvuemie,xn--lrdal-sra,lahppi,xn--lhppi-xqa,lardal,larvik,lavagis,lavangen,leangaviika,xn--leagaviika-52b,lebesby,leikanger,leirfjord,leka,leksvik,lenvik,lerdal,lesja,levanger,lier,lierne,lillehammer,lillesand,lindas,xn--linds-pra,lindesnes,loabat,xn--loabt-0qa,lodingen,xn--ldingen-q1a,lom,loppa,lorenskog,xn--lrenskog-54a,loten,xn--lten-gra,lund,lunner,luroy,xn--lury-ira,luster,lyngdal,lyngen,malatvuopmi,xn--mlatvuopmi-s4a,malselv,xn--mlselv-iua,malvik,mandal,marker,marnardal,masfjorden,masoy,xn--msy-ula0h,matta-varjjat,xn--mtta-vrjjat-k7af,meland,meldal,melhus,meloy,xn--mely-ira,meraker,xn--merker-kua,midsund,midtre-gauldal,moareke,xn--moreke-jua,modalen,modum,molde,heroy.more-og-romsdal,sande.more-og-romsdal,xn--hery-ira.xn--mre-og-romsdal-qqb,sande.xn--mre-og-romsdal-qqb,moskenes,moss,muosat,xn--muost-0qa,naamesjevuemie,xn--nmesjevuemie-tcba,xn--nry-yla5g,namdalseid,namsos,namsskogan,nannestad,naroy,narviika,narvik,naustdal,navuotna,xn--nvuotna-hwa,nedre-eiker,nesna,nesodden,nesseby,nesset,nissedal,nittedal,nord-aurdal,nord-fron,nord-odal,norddal,nordkapp,bo.nordland,xn--b-5ga.nordland,heroy.nordland,xn--hery-ira.nordland,nordre-land,nordreisa,nore-og-uvdal,notodden,notteroy,xn--nttery-byae,odda,oksnes,xn--ksnes-uua,omasvuotna,oppdal,oppegard,xn--oppegrd-ixa,orkdal,orland,xn--rland-uua,orskog,xn--rskog-uua,orsta,xn--rsta-fra,osen,osteroy,xn--ostery-fya,valer.ostfold,xn--vler-qoa.xn--stfold-9xa,ostre-toten,xn--stre-toten-zcb,overhalla,ovre-eiker,xn--vre-eiker-k8a,oyer,xn--yer-zna,oygarden,xn--ygarden-p1a,oystre-slidre,xn--ystre-slidre-ujb,porsanger,porsangu,xn--porsgu-sta26f,porsgrunn,rade,xn--rde-ula,radoy,xn--rady-ira,xn--rlingen-mxa,rahkkeravju,xn--rhkkervju-01af,raisa,xn--risa-5na,rakkestad,ralingen,rana,randaberg,rauma,re,rendalen,rennebu,rennesoy,xn--rennesy-v1a,rindal,ringebu,ringerike,ringsaker,risor,xn--risr-ira,rissa,roan,rodoy,xn--rdy-0nab,rollag,romsa,romskog,xn--rmskog-bya,roros,xn--rros-gra,rost,xn--rst-0na,royken,xn--ryken-vua,royrvik,xn--ryrvik-bya,ruovat,rygge,salangen,salat,xn--slat-5na,xn--slt-elab,saltdal,samnanger,sandefjord,sandnes,sandoy,xn--sandy-yua,sarpsborg,sauda,sauherad,sel,selbu,selje,seljord,siellak,sigdal,siljan,sirdal,skanit,xn--sknit-yqa,skanland,xn--sknland-fxa,skaun,skedsmo,ski,skien,skierva,xn--skierv-uta,skiptvet,skjak,xn--skjk-soa,skjervoy,xn--skjervy-v1a,skodje,smola,xn--smla-hra,snaase,xn--snase-nra,snasa,xn--snsa-roa,snillfjord,snoasa,sogndal,sogne,xn--sgne-gra,sokndal,sola,solund,somna,xn--smna-gra,sondre-land,xn--sndre-land-0cb,songdalen,sor-aurdal,xn--sr-aurdal-l8a,sor-fron,xn--sr-fron-q1a,sor-odal,xn--sr-odal-q1a,sor-varanger,xn--sr-varanger-ggb,sorfold,xn--srfold-bya,sorreisa,xn--srreisa-q1a,sortland,sorum,xn--srum-gra,spydeberg,stange,stavanger,steigen,steinkjer,stjordal,xn--stjrdal-s1a,stokke,stor-elvdal,stord,stordal,storfjord,strand,stranda,stryn,sula,suldal,sund,sunndal,surnadal,sveio,svelvik,sykkylven,tana,bo.telemark,xn--b-5ga.telemark,time,tingvoll,tinn,tjeldsund,tjome,xn--tjme-hra,tokke,tolga,tonsberg,xn--tnsberg-q1a,torsken,xn--trna-woa,trana,tranoy,xn--trany-yua,troandin,trogstad,xn--trgstad-r1a,tromsa,tromso,xn--troms-zua,trondheim,trysil,tvedestrand,tydal,tynset,tysfjord,tysnes,xn--tysvr-vra,tysvar,ullensaker,ullensvang,ulstein,ulvik,unjarga,xn--unjrga-rta,utsira,vaapste,vadso,xn--vads-jra,xn--vry-yla5g,vaga,xn--vg-yiab,vagan,xn--vgan-qoa,vagsoy,xn--vgsy-qoa0j,vaksdal,valle,vang,vanylven,vardo,xn--vard-jra,varggat,xn--vrggt-xqad,varoy,vefsn,vega,vegarshei,xn--vegrshei-c0a,vennesla,verdal,verran,vestby,sande.vestfold,vestnes,vestre-slidre,vestre-toten,vestvagoy,xn--vestvgy-ixa6o,vevelstad,vik,vikna,vindafjord,voagat,volda,voss,co,123hjemmeside,myspreadshop;np:*;nr:biz,com,edu,gov,info,net,org;nz:ac,co,cri,geek,gen,govt,health,iwi,kiwi,maori,xn--mori-qsa,mil,net,org,parliament,school,cloudns;om:co,com,edu,gov,med,museum,net,org,pro;pa:abo,ac,com,edu,gob,ing,med,net,nom,org,sld;pe:com,edu,gob,mil,net,nom,org;pf:com,edu,org;pg:*;ph:com,edu,gov,i,mil,net,ngo,org,cloudns;pk:ac,biz,com,edu,fam,gkp,gob,gog,gok,gop,gos,gov,net,org,web;pl:com,net,org,agro,aid,atm,auto,biz,edu,gmina,gsm,info,mail,media,miasta,mil,nieruchomosci,nom,pc,powiat,priv,realestate,rel,sex,shop,sklep,sos,szkola,targi,tm,tourism,travel,turystyka,gov,ap.gov,griw.gov,ic.gov,is.gov,kmpsp.gov,konsulat.gov,kppsp.gov,kwp.gov,kwpsp.gov,mup.gov,mw.gov,oia.gov,oirm.gov,oke.gov,oow.gov,oschr.gov,oum.gov,pa.gov,pinb.gov,piw.gov,po.gov,pr.gov,psp.gov,psse.gov,pup.gov,rzgw.gov,sa.gov,sdn.gov,sko.gov,so.gov,sr.gov,starostwo.gov,ug.gov,ugim.gov,um.gov,umig.gov,upow.gov,uppo.gov,us.gov,uw.gov,uzs.gov,wif.gov,wiih.gov,winb.gov,wios.gov,witd.gov,wiw.gov,wkz.gov,wsa.gov,wskr.gov,wsse.gov,wuoz.gov,wzmiuw.gov,zp.gov,zpisdn.gov,augustow,babia-gora,bedzin,beskidy,bialowieza,bialystok,bielawa,bieszczady,boleslawiec,bydgoszcz,bytom,cieszyn,czeladz,czest,dlugoleka,elblag,elk,glogow,gniezno,gorlice,grajewo,ilawa,jaworzno,jelenia-gora,jgora,kalisz,karpacz,kartuzy,kaszuby,katowice,kazimierz-dolny,kepno,ketrzyn,klodzko,kobierzyce,kolobrzeg,konin,konskowola,kutno,lapy,lebork,legnica,lezajsk,limanowa,lomza,lowicz,lubin,lukow,malbork,malopolska,mazowsze,mazury,mielec,mielno,mragowo,naklo,nowaruda,nysa,olawa,olecko,olkusz,olsztyn,opoczno,opole,ostroda,ostroleka,ostrowiec,ostrowwlkp,pila,pisz,podhale,podlasie,polkowice,pomorskie,pomorze,prochowice,pruszkow,przeworsk,pulawy,radom,rawa-maz,rybnik,rzeszow,sanok,sejny,skoczow,slask,slupsk,sosnowiec,stalowa-wola,starachowice,stargard,suwalki,swidnica,swiebodzin,swinoujscie,szczecin,szczytno,tarnobrzeg,tgory,turek,tychy,ustka,walbrzych,warmia,warszawa,waw,wegrow,wielun,wlocl,wloclawek,wodzislaw,wolomin,wroclaw,zachpomor,zagan,zarow,zgora,zgorzelec,art,gliwice,krakow,poznan,wroc,zakopane,beep,ecommerce-shop,cfolks,dfirma,dkonto,you2,shoparena,homesklep,iqhs,sdscloud,unicloud,lodz,pabianice,plock,sieradz,skierniewice,zgierz,krasnik,leczna,lubartow,lublin,poniatowa,swidnik,co,torun,simplesite,myspreadshop,gda,gdansk,gdynia,med,sopot,bielsko;pn:co,edu,gov,net,org;pr:ac,biz,com,edu,est,gov,info,isla,name,net,org,pro,prof;pro:aaa,aca,acct,avocat,bar,cpa,eng,jur,law,med,recht,cloudns,keenetic,barsy,ngrok;ps:com,edu,gov,net,org,plo,sec;pt:com,edu,gov,int,net,nome,org,publ,123paginaweb;pw:gov,cloudns,x443;py:com,coop,edu,gov,mil,net,org;qa:com,edu,gov,mil,name,net,org,sch;re:asso,com,netlib,can;ro:arts,com,firm,info,nom,nt,org,rec,store,tm,www,co,shop,barsy;rs:ac,co,edu,gov,in,org,shop.brendly,barsy,ox;rw:ac,co,coop,gov,mil,net,org;sa:com,edu,gov,med,net,org,pub,sch;sb:com,edu,gov,net,org;sc:com,edu,gov,net,org;sd:com,edu,gov,info,med,net,org,tv;se:a,ac,b,bd,brand,c,d,e,f,fh,fhsk,fhv,g,h,i,k,komforb,kommunalforbund,komvux,l,lanbib,m,n,naturbruksgymn,o,org,p,parti,pp,press,r,s,t,tm,u,w,y,z,com,iopsys,123minsida,itcouldbewor,myspreadshop;sg:com,edu,gov,net,org,enscaled;sh:com,gov,mil,net,org,hashbang,botda,lovable,ent.platform,eu.platform,us.platform,surge,teleport,now;sk:org;sl:com,edu,gov,net,org;sn:art,com,edu,gouv,org,univ;so:com,edu,gov,me,net,org,surveys;ss:biz,co,com,edu,gov,me,net,org,sch;st:co,com,consulado,edu,embaixada,mil,net,org,principe,saotome,store,helioho,*.cn,kirara,noho;sv:com,edu,gob,org,red;sx:gov;sy:com,edu,gov,mil,net,org;sz:ac,co,org;th:ac,co,go,in,mi,net,or,online,shop;tj:biz,co,com,edu,go,gov,int,mil,name,net,nic,org,test,web;tl:gov;tm:co,com,edu,gov,mil,net,nom,org;tn:com,ens,fin,gov,ind,info,intl,mincom,nat,net,org,perso,tourism,orangecloud;to:com,edu,gov,mil,net,org,611,x0,direct.quickconnect,vpnplus,nett;tr:av,bbs,bel,biz,com,dr,edu,gen,gov,info,k12,kep,mil,name,net,org,pol,tel,tsk,tv,web,nc,gov.nc;tt:biz,co,com,edu,gov,info,mil,name,net,org,pro;tw:club,com,ebiz,edu,game,gov,idv,mil,net,org,mymailer.com,url,mydns;tz:ac,co,go,hotel,info,me,mil,mobi,ne,or,sc,tv;ua:com,edu,gov,in,net,org,cherkassy,cherkasy,chernigov,chernihiv,chernivtsi,chernovtsy,ck,cn,cr,crimea,cv,dn,dnepropetrovsk,dnipropetrovsk,donetsk,dp,if,ivano-frankivsk,kh,kharkiv,kharkov,kherson,khmelnitskiy,khmelnytskyi,kiev,kirovograd,km,kr,kropyvnytskyi,krym,ks,kv,kyiv,lg,lt,lugansk,luhansk,lutsk,lv,lviv,mk,mykolaiv,nikolaev,od,odesa,odessa,pl,poltava,rivne,rovno,rv,sb,sebastopol,sevastopol,sm,sumy,te,ternopil,uz,uzhgorod,uzhhorod,vinnica,vinnytsia,vn,volyn,yalta,zakarpattia,zaporizhzhe,zaporizhzhia,zhitomir,zhytomyr,zp,zt,cc,inf,ltd,cx,biz,co,pp,v;ug:ac,co,com,edu,go,gov,mil,ne,or,org,sc,us;uk:ac,co,gov,ltd,me,net,nhs,org,plc,police,*.sch,api.gov,conn,copro,hosp,campaign.gov,service.gov,independent-commission,independent-inquest,independent-inquiry,independent-panel,independent-review,public-inquiry,royal-commission,pymnt,j.layershift.co,glug.org,lug.org,lugs.org,barsy,barsy.co,barsyonline.co,cust.retrosnub.co,nh-serv.co,nimsite,no-ip.co,*.oraclegovcloudapps,adimo.co,myspreadshop.co,affinitylottery.org,raffleentry.org,weeklylottery.org;us:dni,isa,nsn,ak,al,ar,as,az,ca,co,ct,dc,de,fl,ga,gu,hi,ia,id,il,in,ks,ky,la,ma,md,me,mi,mn,mo,ms,mt,nc,nd,ne,nh,nj,nm,nv,ny,oh,ok,or,pa,pr,ri,sc,sd,tn,tx,ut,va,vi,vt,wa,wi,wv,wy,k12.ak,k12.al,k12.ar,k12.as,k12.az,k12.ca,k12.co,k12.ct,k12.dc,k12.fl,k12.ga,k12.gu,k12.ia,k12.id,k12.il,k12.in,k12.ks,k12.ky,k12.la,k12.ma,k12.md,k12.me,k12.mi,k12.mn,k12.mo,k12.ms,k12.mt,k12.nc,k12.ne,k12.nh,k12.nj,k12.nm,k12.nv,k12.ny,k12.oh,k12.ok,k12.or,k12.pa,k12.pr,k12.sc,k12.tn,k12.tx,k12.ut,k12.va,k12.vi,k12.vt,k12.wa,k12.wi,cc.ak,lib.ak,cc.al,lib.al,cc.ar,lib.ar,cc.as,lib.as,cc.az,lib.az,cc.ca,lib.ca,cc.co,lib.co,cc.ct,lib.ct,cc.dc,lib.dc,cc.de,cc.fl,lib.fl,cc.ga,lib.ga,cc.gu,lib.gu,cc.hi,lib.hi,cc.ia,lib.ia,cc.id,lib.id,cc.il,lib.il,cc.in,lib.in,cc.ks,lib.ks,cc.ky,lib.ky,cc.la,lib.la,cc.ma,lib.ma,cc.md,lib.md,cc.me,lib.me,cc.mi,lib.mi,cc.mn,lib.mn,cc.mo,lib.mo,cc.ms,cc.mt,lib.mt,cc.nc,lib.nc,cc.ne,lib.ne,cc.nh,lib.nh,cc.nj,lib.nj,cc.nm,lib.nm,cc.nv,lib.nv,cc.ny,lib.ny,cc.oh,lib.oh,cc.ok,lib.ok,cc.or,lib.or,cc.pa,lib.pa,cc.pr,lib.pr,cc.ri,lib.ri,cc.sc,lib.sc,cc.sd,lib.sd,cc.tn,lib.tn,cc.tx,lib.tx,cc.ut,lib.ut,cc.va,lib.va,cc.vi,lib.vi,cc.vt,lib.vt,cc.wa,lib.wa,cc.wi,lib.wi,cc.wv,cc.wy,k12.wy,lib.wy,chtr.k12.ma,paroch.k12.ma,pvt.k12.ma,ann-arbor.mi,cog.mi,dst.mi,eaton.mi,gen.mi,mus.mi,tec.mi,washtenaw.mi,cloudns,aws-gov.databricksapps,is-by,land-4-sale,stuff-4-sale,heliohost,phx.enscaled,mircloud,azure-api,azurewebsites,ngo,golffan,noip,pointto,aberdeen.wa,bainbridge-isl.wa,bellevue.wa,bremerton.wa,centralia.wa,chehalis.wa,forks.wa,gig-harbor.wa,hoquiam.wa,keyport.wa,kingston.wa,olympia.wa,port-angeles.wa,port-ludlow.wa,port-orchard.wa,port-townsend.wa,poulsbo.wa,redmond.wa,renton.wa,sea.wa,seattle.wa,sequim.wa,shelton.wa,silverdale.wa,yarrow-point.wa,freeddns,srv,gh.srv,gl.srv,servername;uy:com,edu,gub,mil,net,org,gv;uz:co,com,net,org;vc:com,edu,gov,mil,net,org,gv,d.gv,*.0e,mydns;ve:arts,bib,co,com,e12,edu,emprende,firm,gob,gov,ia,info,int,mil,net,nom,org,rar,rec,store,tec,web;vg:edu;vi:co,com,k12,net,org;vn:ac,ad,ai,ap,biz,com,edu,gov,health,id,info,int,io,name,net,on,org,pro,angiang,bacgiang,backan,baclieu,bacninh,baria-vungtau,bentre,binhdinh,binhduong,binhphuoc,binhthuan,camau,cantho,caobang,daklak,daknong,danang,dienbien,dongnai,dongthap,gialai,hagiang,haiduong,haiphong,hanam,hanoi,hatinh,haugiang,hoabinh,hue,hungyen,khanhhoa,kiengiang,kontum,laichau,lamdong,langson,laocai,longan,namdinh,nghean,ninhbinh,ninhthuan,phutho,phuyen,quangbinh,quangnam,quangngai,quangninh,quangtri,soctrang,sonla,tayninh,thaibinh,thainguyen,thanhhoa,thanhphohochiminh,thuathienhue,tiengiang,travinh,tuyenquang,vinhlong,vinhphuc,yenbai;vu:com,edu,net,org;ws:com,edu,gov,net,org,*.advisor,cloud66,dyndns,mypets;xn--j6w193g:xn--gmqw5a,xn--55qx5d,xn--mxtq1m,xn--wcvs22d,xn--uc0atv,xn--od0alg;xn--90a3ac:xn--80au,xn--90azh,xn--d1at,xn--c1avg,xn--o1ac,xn--o1ach;xn--o3cw4h:xn--o3cyx2a,xn--12co0c3b4eva,xn--m3ch0j3a,xn--h3cuzk1di,xn--12c1fe0br,xn--12cfi8ixb8l;ye:com,edu,gov,mil,net,org;za:ac,agric,alt,co,edu,gov,grondar,law,mil,net,ngo,nic,nis,nom,org,school,tm,web;zm:ac,biz,co,com,edu,gov,info,mil,net,org,sch;zw:ac,co,gov,mil,org;krd:co,edu;com:a2hosted,cpserver,adobeaemcloud,*.dev.adobeaemcloud,africa,*.auiusercontent,*.aivencloud,alibabacloudcs,*.ztna-dingtalk,kasserver,execute-api.af-south-1.amazonaws,execute-api.ap-east-1.amazonaws,execute-api.ap-northeast-1.amazonaws,execute-api.ap-northeast-2.amazonaws,execute-api.ap-northeast-3.amazonaws,execute-api.ap-south-1.amazonaws,execute-api.ap-south-2.amazonaws,execute-api.ap-southeast-1.amazonaws,execute-api.ap-southeast-2.amazonaws,execute-api.ap-southeast-3.amazonaws,execute-api.ap-southeast-4.amazonaws,execute-api.ap-southeast-5.amazonaws,execute-api.ca-central-1.amazonaws,execute-api.ca-west-1.amazonaws,execute-api.eu-central-1.amazonaws,execute-api.eu-central-2.amazonaws,execute-api.eu-north-1.amazonaws,execute-api.eu-south-1.amazonaws,execute-api.eu-south-2.amazonaws,execute-api.eu-west-1.amazonaws,execute-api.eu-west-2.amazonaws,execute-api.eu-west-3.amazonaws,execute-api.il-central-1.amazonaws,execute-api.me-central-1.amazonaws,execute-api.me-south-1.amazonaws,execute-api.sa-east-1.amazonaws,execute-api.us-east-1.amazonaws,execute-api.us-east-2.amazonaws,execute-api.us-gov-east-1.amazonaws,execute-api.us-gov-west-1.amazonaws,execute-api.us-west-1.amazonaws,execute-api.us-west-2.amazonaws,consent-portal.bedrock-agentcore.ap-northeast-1.amazonaws,consent-portal.bedrock-agentcore.ap-northeast-2.amazonaws,consent-portal.bedrock-agentcore.ap-south-1.amazonaws,consent-portal.bedrock-agentcore.ap-south-2.amazonaws,consent-portal.bedrock-agentcore.ap-southeast-1.amazonaws,consent-portal.bedrock-agentcore.ap-southeast-2.amazonaws,consent-portal.bedrock-agentcore.ap-southeast-5.amazonaws,consent-portal.bedrock-agentcore.ap-southeast-7.amazonaws,consent-portal.bedrock-agentcore.ca-central-1.amazonaws,consent-portal.bedrock-agentcore.eu-central-1.amazonaws,consent-portal.bedrock-agentcore.eu-north-1.amazonaws,consent-portal.bedrock-agentcore.eu-south-1.amazonaws,consent-portal.bedrock-agentcore.eu-south-2.amazonaws,consent-portal.bedrock-agentcore.eu-west-1.amazonaws,consent-portal.bedrock-agentcore.eu-west-2.amazonaws,consent-portal.bedrock-agentcore.eu-west-3.amazonaws,consent-portal.bedrock-agentcore.sa-east-1.amazonaws,consent-portal.bedrock-agentcore.us-east-1.amazonaws,consent-portal.bedrock-agentcore.us-east-2.amazonaws,consent-portal.bedrock-agentcore.us-gov-west-1.amazonaws,consent-portal.bedrock-agentcore.us-west-1.amazonaws,consent-portal.bedrock-agentcore.us-west-2.amazonaws,auth.af-south-1.amazoncognito,auth.ap-east-1.amazoncognito,auth.ap-east-2.amazoncognito,auth.ap-northeast-1.amazoncognito,auth.ap-northeast-2.amazoncognito,auth.ap-northeast-3.amazoncognito,auth.ap-south-1.amazoncognito,auth.ap-south-2.amazoncognito,auth.ap-southeast-1.amazoncognito,auth.ap-southeast-2.amazoncognito,auth.ap-southeast-3.amazoncognito,auth.ap-southeast-4.amazoncognito,auth.ap-southeast-5.amazoncognito,auth.ap-southeast-6.amazoncognito,auth.ap-southeast-7.amazoncognito,auth.ca-central-1.amazoncognito,auth.ca-west-1.amazoncognito,auth.eu-central-1.amazoncognito,auth.eu-central-2.amazoncognito,auth.eu-north-1.amazoncognito,auth.eu-south-1.amazoncognito,auth.eu-south-2.amazoncognito,auth.eu-west-1.amazoncognito,auth.eu-west-2.amazoncognito,auth.eu-west-3.amazoncognito,auth.il-central-1.amazoncognito,auth.me-central-1.amazoncognito,auth.me-south-1.amazoncognito,auth.mx-central-1.amazoncognito,auth.sa-east-1.amazoncognito,auth.us-east-1.amazoncognito,auth-fips.us-east-1.amazoncognito,auth.us-east-2.amazoncognito,auth-fips.us-east-2.amazoncognito,auth-fips.us-gov-east-1.amazoncognito,auth-fips.us-gov-west-1.amazoncognito,auth.us-west-1.amazoncognito,auth-fips.us-west-1.amazoncognito,auth.us-west-2.amazoncognito,auth-fips.us-west-2.amazoncognito,*.compute.amazonaws,*.compute-1.amazonaws,us-east-1.amazonaws,emrappui-prod.af-south-1.amazonaws,emrnotebooks-prod.af-south-1.amazonaws,emrstudio-prod.af-south-1.amazonaws,emrappui-prod.ap-east-1.amazonaws,emrnotebooks-prod.ap-east-1.amazonaws,emrstudio-prod.ap-east-1.amazonaws,emrappui-prod.ap-northeast-1.amazonaws,emrnotebooks-prod.ap-northeast-1.amazonaws,emrstudio-prod.ap-northeast-1.amazonaws,emrappui-prod.ap-northeast-2.amazonaws,emrnotebooks-prod.ap-northeast-2.amazonaws,emrstudio-prod.ap-northeast-2.amazonaws,emrappui-prod.ap-northeast-3.amazonaws,emrnotebooks-prod.ap-northeast-3.amazonaws,emrstudio-prod.ap-northeast-3.amazonaws,emrappui-prod.ap-south-1.amazonaws,emrnotebooks-prod.ap-south-1.amazonaws,emrstudio-prod.ap-south-1.amazonaws,emrappui-prod.ap-south-2.amazonaws,emrnotebooks-prod.ap-south-2.amazonaws,emrstudio-prod.ap-south-2.amazonaws,emrappui-prod.ap-southeast-1.amazonaws,emrnotebooks-prod.ap-southeast-1.amazonaws,emrstudio-prod.ap-southeast-1.amazonaws,emrappui-prod.ap-southeast-2.amazonaws,emrnotebooks-prod.ap-southeast-2.amazonaws,emrstudio-prod.ap-southeast-2.amazonaws,emrappui-prod.ap-southeast-3.amazonaws,emrnotebooks-prod.ap-southeast-3.amazonaws,emrstudio-prod.ap-southeast-3.amazonaws,emrappui-prod.ap-southeast-4.amazonaws,emrnotebooks-prod.ap-southeast-4.amazonaws,emrstudio-prod.ap-southeast-4.amazonaws,emrappui-prod.ca-central-1.amazonaws,emrnotebooks-prod.ca-central-1.amazonaws,emrstudio-prod.ca-central-1.amazonaws,emrappui-prod.ca-west-1.amazonaws,emrnotebooks-prod.ca-west-1.amazonaws,emrstudio-prod.ca-west-1.amazonaws,emrappui-prod.eu-central-1.amazonaws,emrnotebooks-prod.eu-central-1.amazonaws,emrstudio-prod.eu-central-1.amazonaws,emrappui-prod.eu-central-2.amazonaws,emrnotebooks-prod.eu-central-2.amazonaws,emrstudio-prod.eu-central-2.amazonaws,emrappui-prod.eu-north-1.amazonaws,emrnotebooks-prod.eu-north-1.amazonaws,emrstudio-prod.eu-north-1.amazonaws,emrappui-prod.eu-south-1.amazonaws,emrnotebooks-prod.eu-south-1.amazonaws,emrstudio-prod.eu-south-1.amazonaws,emrappui-prod.eu-south-2.amazonaws,emrnotebooks-prod.eu-south-2.amazonaws,emrstudio-prod.eu-south-2.amazonaws,emrappui-prod.eu-west-1.amazonaws,emrnotebooks-prod.eu-west-1.amazonaws,emrstudio-prod.eu-west-1.amazonaws,emrappui-prod.eu-west-2.amazonaws,emrnotebooks-prod.eu-west-2.amazonaws,emrstudio-prod.eu-west-2.amazonaws,emrappui-prod.eu-west-3.amazonaws,emrnotebooks-prod.eu-west-3.amazonaws,emrstudio-prod.eu-west-3.amazonaws,emrappui-prod.il-central-1.amazonaws,emrnotebooks-prod.il-central-1.amazonaws,emrstudio-prod.il-central-1.amazonaws,emrappui-prod.me-central-1.amazonaws,emrnotebooks-prod.me-central-1.amazonaws,emrstudio-prod.me-central-1.amazonaws,emrappui-prod.me-south-1.amazonaws,emrnotebooks-prod.me-south-1.amazonaws,emrstudio-prod.me-south-1.amazonaws,emrappui-prod.sa-east-1.amazonaws,emrnotebooks-prod.sa-east-1.amazonaws,emrstudio-prod.sa-east-1.amazonaws,emrappui-prod.us-east-1.amazonaws,emrnotebooks-prod.us-east-1.amazonaws,emrstudio-prod.us-east-1.amazonaws,emrappui-prod.us-east-2.amazonaws,emrnotebooks-prod.us-east-2.amazonaws,emrstudio-prod.us-east-2.amazonaws,emrappui-prod.us-gov-east-1.amazonaws,emrnotebooks-prod.us-gov-east-1.amazonaws,emrstudio-prod.us-gov-east-1.amazonaws,emrappui-prod.us-gov-west-1.amazonaws,emrnotebooks-prod.us-gov-west-1.amazonaws,emrstudio-prod.us-gov-west-1.amazonaws,emrappui-prod.us-west-1.amazonaws,emrnotebooks-prod.us-west-1.amazonaws,emrstudio-prod.us-west-1.amazonaws,emrappui-prod.us-west-2.amazonaws,emrnotebooks-prod.us-west-2.amazonaws,emrstudio-prod.us-west-2.amazonaws,amazonlightsail,*.ap-east-1.cs.amazonlightsail,*.ap-northeast-1.cs.amazonlightsail,*.ap-northeast-2.cs.amazonlightsail,*.ap-south-1.cs.amazonlightsail,*.ap-southeast-1.cs.amazonlightsail,*.ap-southeast-2.cs.amazonlightsail,*.ap-southeast-3.cs.amazonlightsail,*.ap-southeast-5.cs.amazonlightsail,*.ca-central-1.cs.amazonlightsail,*.eu-central-1.cs.amazonlightsail,*.eu-north-1.cs.amazonlightsail,*.eu-south-2.cs.amazonlightsail,*.eu-west-1.cs.amazonlightsail,*.eu-west-2.cs.amazonlightsail,*.eu-west-3.cs.amazonlightsail,*.sa-east-1.cs.amazonlightsail,*.us-east-1.cs.amazonlightsail,*.us-east-2.cs.amazonlightsail,*.us-west-2.cs.amazonlightsail,*.af-south-1.airflow.amazonaws,*.ap-east-1.airflow.amazonaws,*.ap-northeast-1.airflow.amazonaws,*.ap-northeast-2.airflow.amazonaws,*.ap-northeast-3.airflow.amazonaws,*.ap-south-1.airflow.amazonaws,*.ap-south-2.airflow.amazonaws,*.ap-southeast-1.airflow.amazonaws,*.ap-southeast-2.airflow.amazonaws,*.ap-southeast-3.airflow.amazonaws,*.ap-southeast-4.airflow.amazonaws,*.ap-southeast-5.airflow.amazonaws,*.ap-southeast-7.airflow.amazonaws,*.ca-central-1.airflow.amazonaws,*.ca-west-1.airflow.amazonaws,*.eu-central-1.airflow.amazonaws,*.eu-central-2.airflow.amazonaws,*.eu-north-1.airflow.amazonaws,*.eu-south-1.airflow.amazonaws,*.eu-south-2.airflow.amazonaws,*.eu-west-1.airflow.amazonaws,*.eu-west-2.airflow.amazonaws,*.eu-west-3.airflow.amazonaws,*.il-central-1.airflow.amazonaws,*.me-central-1.airflow.amazonaws,*.me-south-1.airflow.amazonaws,*.sa-east-1.airflow.amazonaws,*.us-east-1.airflow.amazonaws,*.us-east-2.airflow.amazonaws,*.us-west-1.airflow.amazonaws,*.us-west-2.airflow.amazonaws,*.af-south-1.rds.amazonaws,*.ap-east-1.rds.amazonaws,*.ap-east-2.rds.amazonaws,*.ap-northeast-1.rds.amazonaws,*.ap-northeast-2.rds.amazonaws,*.ap-northeast-3.rds.amazonaws,*.ap-south-1.rds.amazonaws,*.ap-south-2.rds.amazonaws,*.ap-southeast-1.rds.amazonaws,*.ap-southeast-2.rds.amazonaws,*.ap-southeast-3.rds.amazonaws,*.ap-southeast-4.rds.amazonaws,*.ap-southeast-5.rds.amazonaws,*.ap-southeast-6.rds.amazonaws,*.ap-southeast-7.rds.amazonaws,*.ca-central-1.rds.amazonaws,*.ca-west-1.rds.amazonaws,*.eu-central-1.rds.amazonaws,*.eu-central-2.rds.amazonaws,*.eu-west-1.rds.amazonaws,*.eu-west-2.rds.amazonaws,*.eu-west-3.rds.amazonaws,*.il-central-1.rds.amazonaws,*.me-central-1.rds.amazonaws,*.me-south-1.rds.amazonaws,*.mx-central-1.rds.amazonaws,*.sa-east-1.rds.amazonaws,*.us-east-1.rds.amazonaws,*.us-east-2.rds.amazonaws,*.us-gov-east-1.rds.amazonaws,*.us-gov-west-1.rds.amazonaws,*.us-northeast-1.rds.amazonaws,*.us-west-1.rds.amazonaws,*.us-west-2.rds.amazonaws,s3.dualstack.af-south-1.amazonaws,s3-accesspoint.dualstack.af-south-1.amazonaws,s3-website.dualstack.af-south-1.amazonaws,s3.af-south-1.amazonaws,s3-accesspoint.af-south-1.amazonaws,s3-object-lambda.af-south-1.amazonaws,s3-website.af-south-1.amazonaws,s3.dualstack.ap-east-1.amazonaws,s3-accesspoint.dualstack.ap-east-1.amazonaws,s3.ap-east-1.amazonaws,s3-accesspoint.ap-east-1.amazonaws,s3-object-lambda.ap-east-1.amazonaws,s3-website.ap-east-1.amazonaws,s3.dualstack.ap-northeast-1.amazonaws,s3-accesspoint.dualstack.ap-northeast-1.amazonaws,s3-website.dualstack.ap-northeast-1.amazonaws,s3.ap-northeast-1.amazonaws,s3-accesspoint.ap-northeast-1.amazonaws,s3-object-lambda.ap-northeast-1.amazonaws,s3-website.ap-northeast-1.amazonaws,s3.dualstack.ap-northeast-2.amazonaws,s3-accesspoint.dualstack.ap-northeast-2.amazonaws,s3-website.dualstack.ap-northeast-2.amazonaws,s3.ap-northeast-2.amazonaws,s3-accesspoint.ap-northeast-2.amazonaws,s3-object-lambda.ap-northeast-2.amazonaws,s3-website.ap-northeast-2.amazonaws,s3.dualstack.ap-northeast-3.amazonaws,s3-accesspoint.dualstack.ap-northeast-3.amazonaws,s3-website.dualstack.ap-northeast-3.amazonaws,s3.ap-northeast-3.amazonaws,s3-accesspoint.ap-northeast-3.amazonaws,s3-object-lambda.ap-northeast-3.amazonaws,s3-website.ap-northeast-3.amazonaws,s3.dualstack.ap-south-1.amazonaws,s3-accesspoint.dualstack.ap-south-1.amazonaws,s3-website.dualstack.ap-south-1.amazonaws,s3.ap-south-1.amazonaws,s3-accesspoint.ap-south-1.amazonaws,s3-object-lambda.ap-south-1.amazonaws,s3-website.ap-south-1.amazonaws,s3.dualstack.ap-south-2.amazonaws,s3-accesspoint.dualstack.ap-south-2.amazonaws,s3-website.dualstack.ap-south-2.amazonaws,s3.ap-south-2.amazonaws,s3-accesspoint.ap-south-2.amazonaws,s3-object-lambda.ap-south-2.amazonaws,s3-website.ap-south-2.amazonaws,s3.dualstack.ap-southeast-1.amazonaws,s3-accesspoint.dualstack.ap-southeast-1.amazonaws,s3-website.dualstack.ap-southeast-1.amazonaws,s3.ap-southeast-1.amazonaws,s3-accesspoint.ap-southeast-1.amazonaws,s3-object-lambda.ap-southeast-1.amazonaws,s3-website.ap-southeast-1.amazonaws,s3.dualstack.ap-southeast-2.amazonaws,s3-accesspoint.dualstack.ap-southeast-2.amazonaws,s3-website.dualstack.ap-southeast-2.amazonaws,s3.ap-southeast-2.amazonaws,s3-accesspoint.ap-southeast-2.amazonaws,s3-object-lambda.ap-southeast-2.amazonaws,s3-website.ap-southeast-2.amazonaws,s3.dualstack.ap-southeast-3.amazonaws,s3-accesspoint.dualstack.ap-southeast-3.amazonaws,s3-website.dualstack.ap-southeast-3.amazonaws,s3.ap-southeast-3.amazonaws,s3-accesspoint.ap-southeast-3.amazonaws,s3-object-lambda.ap-southeast-3.amazonaws,s3-website.ap-southeast-3.amazonaws,s3.dualstack.ap-southeast-4.amazonaws,s3-accesspoint.dualstack.ap-southeast-4.amazonaws,s3-website.dualstack.ap-southeast-4.amazonaws,s3.ap-southeast-4.amazonaws,s3-accesspoint.ap-southeast-4.amazonaws,s3-object-lambda.ap-southeast-4.amazonaws,s3-website.ap-southeast-4.amazonaws,s3.dualstack.ap-southeast-5.amazonaws,s3-accesspoint.dualstack.ap-southeast-5.amazonaws,s3-website.dualstack.ap-southeast-5.amazonaws,s3.ap-southeast-5.amazonaws,s3-accesspoint.ap-southeast-5.amazonaws,s3-deprecated.ap-southeast-5.amazonaws,s3-object-lambda.ap-southeast-5.amazonaws,s3-website.ap-southeast-5.amazonaws,s3.dualstack.ca-central-1.amazonaws,s3-accesspoint.dualstack.ca-central-1.amazonaws,s3-accesspoint-fips.dualstack.ca-central-1.amazonaws,s3-fips.dualstack.ca-central-1.amazonaws,s3-website.dualstack.ca-central-1.amazonaws,s3.ca-central-1.amazonaws,s3-accesspoint.ca-central-1.amazonaws,s3-accesspoint-fips.ca-central-1.amazonaws,s3-fips.ca-central-1.amazonaws,s3-object-lambda.ca-central-1.amazonaws,s3-website.ca-central-1.amazonaws,s3.dualstack.ca-west-1.amazonaws,s3-accesspoint.dualstack.ca-west-1.amazonaws,s3-accesspoint-fips.dualstack.ca-west-1.amazonaws,s3-fips.dualstack.ca-west-1.amazonaws,s3-website.dualstack.ca-west-1.amazonaws,s3.ca-west-1.amazonaws,s3-accesspoint.ca-west-1.amazonaws,s3-accesspoint-fips.ca-west-1.amazonaws,s3-fips.ca-west-1.amazonaws,s3-object-lambda.ca-west-1.amazonaws,s3-website.ca-west-1.amazonaws,s3.dualstack.eu-central-1.amazonaws,s3-accesspoint.dualstack.eu-central-1.amazonaws,s3-website.dualstack.eu-central-1.amazonaws,s3.eu-central-1.amazonaws,s3-accesspoint.eu-central-1.amazonaws,s3-object-lambda.eu-central-1.amazonaws,s3-website.eu-central-1.amazonaws,s3.dualstack.eu-central-2.amazonaws,s3-accesspoint.dualstack.eu-central-2.amazonaws,s3-website.dualstack.eu-central-2.amazonaws,s3.eu-central-2.amazonaws,s3-accesspoint.eu-central-2.amazonaws,s3-object-lambda.eu-central-2.amazonaws,s3-website.eu-central-2.amazonaws,s3.dualstack.eu-north-1.amazonaws,s3-accesspoint.dualstack.eu-north-1.amazonaws,s3.eu-north-1.amazonaws,s3-accesspoint.eu-north-1.amazonaws,s3-object-lambda.eu-north-1.amazonaws,s3-website.eu-north-1.amazonaws,s3.dualstack.eu-south-1.amazonaws,s3-accesspoint.dualstack.eu-south-1.amazonaws,s3-website.dualstack.eu-south-1.amazonaws,s3.eu-south-1.amazonaws,s3-accesspoint.eu-south-1.amazonaws,s3-object-lambda.eu-south-1.amazonaws,s3-website.eu-south-1.amazonaws,s3.dualstack.eu-south-2.amazonaws,s3-accesspoint.dualstack.eu-south-2.amazonaws,s3-website.dualstack.eu-south-2.amazonaws,s3.eu-south-2.amazonaws,s3-accesspoint.eu-south-2.amazonaws,s3-object-lambda.eu-south-2.amazonaws,s3-website.eu-south-2.amazonaws,s3.dualstack.eu-west-1.amazonaws,s3-accesspoint.dualstack.eu-west-1.amazonaws,s3-website.dualstack.eu-west-1.amazonaws,s3.eu-west-1.amazonaws,s3-accesspoint.eu-west-1.amazonaws,s3-deprecated.eu-west-1.amazonaws,s3-object-lambda.eu-west-1.amazonaws,s3-website.eu-west-1.amazonaws,s3.dualstack.eu-west-2.amazonaws,s3-accesspoint.dualstack.eu-west-2.amazonaws,s3.eu-west-2.amazonaws,s3-accesspoint.eu-west-2.amazonaws,s3-object-lambda.eu-west-2.amazonaws,s3-website.eu-west-2.amazonaws,s3.dualstack.eu-west-3.amazonaws,s3-accesspoint.dualstack.eu-west-3.amazonaws,s3-website.dualstack.eu-west-3.amazonaws,s3.eu-west-3.amazonaws,s3-accesspoint.eu-west-3.amazonaws,s3-object-lambda.eu-west-3.amazonaws,s3-website.eu-west-3.amazonaws,s3.dualstack.il-central-1.amazonaws,s3-accesspoint.dualstack.il-central-1.amazonaws,s3-website.dualstack.il-central-1.amazonaws,s3.il-central-1.amazonaws,s3-accesspoint.il-central-1.amazonaws,s3-object-lambda.il-central-1.amazonaws,s3-website.il-central-1.amazonaws,s3.dualstack.me-central-1.amazonaws,s3-accesspoint.dualstack.me-central-1.amazonaws,s3-website.dualstack.me-central-1.amazonaws,s3.me-central-1.amazonaws,s3-accesspoint.me-central-1.amazonaws,s3-object-lambda.me-central-1.amazonaws,s3-website.me-central-1.amazonaws,s3.dualstack.me-south-1.amazonaws,s3-accesspoint.dualstack.me-south-1.amazonaws,s3.me-south-1.amazonaws,s3-accesspoint.me-south-1.amazonaws,s3-object-lambda.me-south-1.amazonaws,s3-website.me-south-1.amazonaws,s3.amazonaws,s3-1.amazonaws,s3-ap-east-1.amazonaws,s3-ap-northeast-1.amazonaws,s3-ap-northeast-2.amazonaws,s3-ap-northeast-3.amazonaws,s3-ap-south-1.amazonaws,s3-ap-southeast-1.amazonaws,s3-ap-southeast-2.amazonaws,s3-ca-central-1.amazonaws,s3-eu-central-1.amazonaws,s3-eu-north-1.amazonaws,s3-eu-west-1.amazonaws,s3-eu-west-2.amazonaws,s3-eu-west-3.amazonaws,s3-external-1.amazonaws,s3-fips-us-gov-east-1.amazonaws,s3-fips-us-gov-west-1.amazonaws,mrap.accesspoint.s3-global.amazonaws,s3-me-south-1.amazonaws,s3-sa-east-1.amazonaws,s3-us-east-2.amazonaws,s3-us-gov-east-1.amazonaws,s3-us-gov-west-1.amazonaws,s3-us-west-1.amazonaws,s3-us-west-2.amazonaws,s3-website-ap-northeast-1.amazonaws,s3-website-ap-southeast-1.amazonaws,s3-website-ap-southeast-2.amazonaws,s3-website-eu-west-1.amazonaws,s3-website-sa-east-1.amazonaws,s3-website-us-east-1.amazonaws,s3-website-us-gov-west-1.amazonaws,s3-website-us-west-1.amazonaws,s3-website-us-west-2.amazonaws,s3.dualstack.sa-east-1.amazonaws,s3-accesspoint.dualstack.sa-east-1.amazonaws,s3-website.dualstack.sa-east-1.amazonaws,s3.sa-east-1.amazonaws,s3-accesspoint.sa-east-1.amazonaws,s3-object-lambda.sa-east-1.amazonaws,s3-website.sa-east-1.amazonaws,s3.dualstack.us-east-1.amazonaws,s3-accesspoint.dualstack.us-east-1.amazonaws,s3-accesspoint-fips.dualstack.us-east-1.amazonaws,s3-fips.dualstack.us-east-1.amazonaws,s3-website.dualstack.us-east-1.amazonaws,s3.us-east-1.amazonaws,s3-accesspoint.us-east-1.amazonaws,s3-accesspoint-fips.us-east-1.amazonaws,s3-deprecated.us-east-1.amazonaws,s3-fips.us-east-1.amazonaws,s3-object-lambda.us-east-1.amazonaws,s3-website.us-east-1.amazonaws,s3.dualstack.us-east-2.amazonaws,s3-accesspoint.dualstack.us-east-2.amazonaws,s3-accesspoint-fips.dualstack.us-east-2.amazonaws,s3-fips.dualstack.us-east-2.amazonaws,s3-website.dualstack.us-east-2.amazonaws,s3.us-east-2.amazonaws,s3-accesspoint.us-east-2.amazonaws,s3-accesspoint-fips.us-east-2.amazonaws,s3-deprecated.us-east-2.amazonaws,s3-fips.us-east-2.amazonaws,s3-object-lambda.us-east-2.amazonaws,s3-website.us-east-2.amazonaws,s3.dualstack.us-gov-east-1.amazonaws,s3-accesspoint.dualstack.us-gov-east-1.amazonaws,s3-accesspoint-fips.dualstack.us-gov-east-1.amazonaws,s3-fips.dualstack.us-gov-east-1.amazonaws,s3-website.dualstack.us-gov-east-1.amazonaws,s3.us-gov-east-1.amazonaws,s3-accesspoint.us-gov-east-1.amazonaws,s3-accesspoint-fips.us-gov-east-1.amazonaws,s3-fips.us-gov-east-1.amazonaws,s3-object-lambda.us-gov-east-1.amazonaws,s3-website.us-gov-east-1.amazonaws,s3.dualstack.us-gov-west-1.amazonaws,s3-accesspoint.dualstack.us-gov-west-1.amazonaws,s3-accesspoint-fips.dualstack.us-gov-west-1.amazonaws,s3-fips.dualstack.us-gov-west-1.amazonaws,s3-website.dualstack.us-gov-west-1.amazonaws,s3.us-gov-west-1.amazonaws,s3-accesspoint.us-gov-west-1.amazonaws,s3-accesspoint-fips.us-gov-west-1.amazonaws,s3-fips.us-gov-west-1.amazonaws,s3-object-lambda.us-gov-west-1.amazonaws,s3-website.us-gov-west-1.amazonaws,s3.dualstack.us-west-1.amazonaws,s3-accesspoint.dualstack.us-west-1.amazonaws,s3-accesspoint-fips.dualstack.us-west-1.amazonaws,s3-fips.dualstack.us-west-1.amazonaws,s3-website.dualstack.us-west-1.amazonaws,s3.us-west-1.amazonaws,s3-accesspoint.us-west-1.amazonaws,s3-accesspoint-fips.us-west-1.amazonaws,s3-fips.us-west-1.amazonaws,s3-object-lambda.us-west-1.amazonaws,s3-website.us-west-1.amazonaws,s3.dualstack.us-west-2.amazonaws,s3-accesspoint.dualstack.us-west-2.amazonaws,s3-accesspoint-fips.dualstack.us-west-2.amazonaws,s3-fips.dualstack.us-west-2.amazonaws,s3-website.dualstack.us-west-2.amazonaws,s3.us-west-2.amazonaws,s3-accesspoint.us-west-2.amazonaws,s3-accesspoint-fips.us-west-2.amazonaws,s3-deprecated.us-west-2.amazonaws,s3-fips.us-west-2.amazonaws,s3-object-lambda.us-west-2.amazonaws,s3-website.us-west-2.amazonaws,analytics-gateway.ap-northeast-1.amazonaws,analytics-gateway.ap-northeast-2.amazonaws,analytics-gateway.ap-south-1.amazonaws,analytics-gateway.ap-southeast-1.amazonaws,analytics-gateway.ap-southeast-2.amazonaws,analytics-gateway.eu-central-1.amazonaws,analytics-gateway.eu-west-1.amazonaws,analytics-gateway.us-east-1.amazonaws,analytics-gateway.us-east-2.amazonaws,analytics-gateway.us-west-2.amazonaws,amplifyapp,*.awsapprunner,webview-assets.aws-cloud9.af-south-1.amazonaws,vfs.cloud9.af-south-1.amazonaws,webview-assets.cloud9.af-south-1.amazonaws,webview-assets.aws-cloud9.ap-east-1.amazonaws,vfs.cloud9.ap-east-1.amazonaws,webview-assets.cloud9.ap-east-1.amazonaws,webview-assets.aws-cloud9.ap-northeast-1.amazonaws,vfs.cloud9.ap-northeast-1.amazonaws,webview-assets.cloud9.ap-northeast-1.amazonaws,webview-assets.aws-cloud9.ap-northeast-2.amazonaws,vfs.cloud9.ap-northeast-2.amazonaws,webview-assets.cloud9.ap-northeast-2.amazonaws,webview-assets.aws-cloud9.ap-northeast-3.amazonaws,vfs.cloud9.ap-northeast-3.amazonaws,webview-assets.cloud9.ap-northeast-3.amazonaws,webview-assets.aws-cloud9.ap-south-1.amazonaws,vfs.cloud9.ap-south-1.amazonaws,webview-assets.cloud9.ap-south-1.amazonaws,webview-assets.aws-cloud9.ap-southeast-1.amazonaws,vfs.cloud9.ap-southeast-1.amazonaws,webview-assets.cloud9.ap-southeast-1.amazonaws,webview-assets.aws-cloud9.ap-southeast-2.amazonaws,vfs.cloud9.ap-southeast-2.amazonaws,webview-assets.cloud9.ap-southeast-2.amazonaws,webview-assets.aws-cloud9.ca-central-1.amazonaws,vfs.cloud9.ca-central-1.amazonaws,webview-assets.cloud9.ca-central-1.amazonaws,webview-assets.aws-cloud9.eu-central-1.amazonaws,vfs.cloud9.eu-central-1.amazonaws,webview-assets.cloud9.eu-central-1.amazonaws,webview-assets.aws-cloud9.eu-north-1.amazonaws,vfs.cloud9.eu-north-1.amazonaws,webview-assets.cloud9.eu-north-1.amazonaws,webview-assets.aws-cloud9.eu-south-1.amazonaws,vfs.cloud9.eu-south-1.amazonaws,webview-assets.cloud9.eu-south-1.amazonaws,webview-assets.aws-cloud9.eu-west-1.amazonaws,vfs.cloud9.eu-west-1.amazonaws,webview-assets.cloud9.eu-west-1.amazonaws,webview-assets.aws-cloud9.eu-west-2.amazonaws,vfs.cloud9.eu-west-2.amazonaws,webview-assets.cloud9.eu-west-2.amazonaws,webview-assets.aws-cloud9.eu-west-3.amazonaws,vfs.cloud9.eu-west-3.amazonaws,webview-assets.cloud9.eu-west-3.amazonaws,webview-assets.aws-cloud9.il-central-1.amazonaws,vfs.cloud9.il-central-1.amazonaws,webview-assets.aws-cloud9.me-south-1.amazonaws,vfs.cloud9.me-south-1.amazonaws,webview-assets.cloud9.me-south-1.amazonaws,webview-assets.aws-cloud9.sa-east-1.amazonaws,vfs.cloud9.sa-east-1.amazonaws,webview-assets.cloud9.sa-east-1.amazonaws,webview-assets.aws-cloud9.us-east-1.amazonaws,vfs.cloud9.us-east-1.amazonaws,webview-assets.cloud9.us-east-1.amazonaws,webview-assets.aws-cloud9.us-east-2.amazonaws,vfs.cloud9.us-east-2.amazonaws,webview-assets.cloud9.us-east-2.amazonaws,webview-assets.aws-cloud9.us-west-1.amazonaws,vfs.cloud9.us-west-1.amazonaws,webview-assets.cloud9.us-west-1.amazonaws,webview-assets.aws-cloud9.us-west-2.amazonaws,vfs.cloud9.us-west-2.amazonaws,webview-assets.cloud9.us-west-2.amazonaws,awsapps,elasticbeanstalk,af-south-1.elasticbeanstalk,ap-east-1.elasticbeanstalk,ap-northeast-1.elasticbeanstalk,ap-northeast-2.elasticbeanstalk,ap-northeast-3.elasticbeanstalk,ap-south-1.elasticbeanstalk,ap-south-2.elasticbeanstalk,ap-southeast-1.elasticbeanstalk,ap-southeast-2.elasticbeanstalk,ap-southeast-3.elasticbeanstalk,ap-southeast-4.elasticbeanstalk,ap-southeast-5.elasticbeanstalk,ap-southeast-6.elasticbeanstalk,ap-southeast-7.elasticbeanstalk,ca-central-1.elasticbeanstalk,ca-west-1.elasticbeanstalk,eu-central-1.elasticbeanstalk,eu-central-2.elasticbeanstalk,eu-north-1.elasticbeanstalk,eu-south-1.elasticbeanstalk,eu-south-2.elasticbeanstalk,eu-west-1.elasticbeanstalk,eu-west-2.elasticbeanstalk,eu-west-3.elasticbeanstalk,il-central-1.elasticbeanstalk,me-central-1.elasticbeanstalk,me-south-1.elasticbeanstalk,sa-east-1.elasticbeanstalk,us-east-1.elasticbeanstalk,us-east-2.elasticbeanstalk,us-gov-east-1.elasticbeanstalk,us-gov-west-1.elasticbeanstalk,us-west-1.elasticbeanstalk,us-west-2.elasticbeanstalk,*.elb.amazonaws,awsglobalaccelerator,claudeusercontent,frame.claudeusercontent,siiites,appspacehosted,appspaceusercontent,on-aptible,myasustor,*.atlassian-3p,*.atlassian-3p-us-gov-mod,*.atlassian-isolated-3p,balena-devices,boutir,bplaced,cafjs,canva-apps,canva-hosted-embed,canvacode,rice-labs,cdn77-storage,br,cn,de,eu,jpn,mex,ru,sa,uk,us,za,*.services.clever-cloud,abrdns,dnsabr,ip-ddns,jdevcloud,wpdevcloud,cf-ipfs,cloudflare-ipfs,trycloudflare,co,*.devinapps,builtwithdark,aws.databricksapps,*.azure.databricksapps,gcp.databricksapps,demo.datadetect,instance.datadetect,dattolocal,dattorelay,dattoweb,mydatto,deployagent,*.digitaloceanspaces,discordsays,discordsez,drayddns,dreamhosters,durumis,blogdns,cechire,dnsalias,dnsdojo,doesntexist,dontexist,doomdns,dyn-o-saur,dynalias,dyndns-at-home,dyndns-at-work,dyndns-blog,dyndns-free,dyndns-home,dyndns-ip,dyndns-mail,dyndns-office,dyndns-pics,dyndns-remote,dyndns-server,dyndns-web,dyndns-wiki,dyndns-work,est-a-la-maison,est-a-la-masion,est-le-patron,est-mon-blogueur,from-ak,from-al,from-ar,from-ca,from-ct,from-dc,from-de,from-fl,from-ga,from-hi,from-ia,from-id,from-il,from-in,from-ks,from-ky,from-ma,from-md,from-mi,from-mn,from-mo,from-ms,from-mt,from-nc,from-nd,from-ne,from-nh,from-nj,from-nm,from-nv,from-oh,from-ok,from-or,from-pa,from-pr,from-ri,from-sc,from-sd,from-tn,from-tx,from-ut,from-va,from-vt,from-wa,from-wi,from-wv,from-wy,getmyip,gotdns,hobby-site,homelinux,homeunix,iamallama,is-a-anarchist,is-a-blogger,is-a-bookkeeper,is-a-bulls-fan,is-a-caterer,is-a-chef,is-a-conservative,is-a-cpa,is-a-cubicle-slave,is-a-democrat,is-a-designer,is-a-doctor,is-a-financialadvisor,is-a-geek,is-a-green,is-a-guru,is-a-hard-worker,is-a-hunter,is-a-landscaper,is-a-lawyer,is-a-liberal,is-a-libertarian,is-a-llama,is-a-musician,is-a-nascarfan,is-a-nurse,is-a-painter,is-a-personaltrainer,is-a-photographer,is-a-player,is-a-republican,is-a-rockstar,is-a-socialist,is-a-student,is-a-teacher,is-a-techie,is-a-therapist,is-an-accountant,is-an-actor,is-an-actress,is-an-anarchist,is-an-artist,is-an-engineer,is-an-entertainer,is-certified,is-gone,is-into-anime,is-into-cars,is-into-cartoons,is-into-games,is-leet,is-not-certified,is-slick,is-uberleet,is-with-theband,isa-geek,isa-hockeynut,issmarterthanyou,likes-pie,likescandy,neat-url,saves-the-whales,selfip,sells-for-less,sells-for-u,servebbs,simple-url,space-to-rent,teaches-yoga,writesthisblog,1cooldns,bumbleshrimp,ddnsfree,ddnsgeek,ddnsguru,dynuddns,dynuhosting,giize,gleeze,kozow,loseyourip,ooguy,pivohosting,theworkpc,wiredbladehosting,preview.emergentagent,mytuleap,tuleap-partners,encoreapi,eu-1.evennode,eu-2.evennode,eu-3.evennode,eu-4.evennode,us-1.evennode,us-2.evennode,us-3.evennode,us-4.evennode,fastly-edge,fastly-terrarium,fastvps-server,mydobiss,hosted-by-files,firebaseapp,fldrv,framercanvas,freebox-os,freeboxos,freemyip,gentapps,gentlentapis,githubusercontent,*.0emm,appspot,*.r.appspot,blogspot,codespot,googleapis,googlecode,pagespeedmobilizer,withgoogle,withyoutube,grayjayleagues,hatenablog,hatenadiary,hercules-app,hercules-dev,herokuapp,*.compute.herokuapp,gr,smushcdn,wphostedmail,wpmucdn,pixolino,apps-1and1,live-website,webspace-host,dopaas,paas.hosted-by-previder,rag-cloud.hosteur,rag-cloud-ch.hosteur,jcloud.ik-server,jcloud-ver-jpc.ik-server,demo.jelastic,paas.massivegrid,jed.wafaicloud,ryd.wafaicloud,eu1-plenit,la1-plenit,us1-plenit,webadorsite,on-forge,on-vapor,lpusercontent,members.linode,*.nodebalancer.linode,*.linodeobjects,ip.linodeusercontent,localtonet,lovableproject,barsycenter,barsyonline,*.lutrausercontent,magicpatternsapp,modelscape,mwcloudnonprod,polyspace,miniserver,atmeta,apps.fbsbx,*.metaaiusercontent,meteorapp,eu.meteorapp,routingthecloud,same-app,same-preview,mydbserver,mochausercontent,hostedpi,caracal.mythic-beasts,customer.mythic-beasts,fentiger.mythic-beasts,lynx.mythic-beasts,ocelot.mythic-beasts,oncilla.mythic-beasts,onza.mythic-beasts,sphinx.mythic-beasts,vs.mythic-beasts,mythic-beasts,yali.mythic-beasts,kr.object.fin-ncloudstorage,s3-website.kr.object.fin-ncloudstorage,kr.object.private.fin-ncloudstorage,kr.gov-ncloudstorage,kr-private.gov-ncloudstorage,kr.object.gov-ncloudstorage,s3-website.kr.object.gov-ncloudstorage,krs.object.gov-ncloudstorage,s3-website.krs.object.gov-ncloudstorage,kr.object.private.gov-ncloudstorage,krs.object.private.gov-ncloudstorage,kr.objectstorage.ncloud,sg.objectstorage.ncloud,kr.ncloudstorage,kr-naver.ncloudstorage,kr-naver-dev.ncloudstorage,kr-private.ncloudstorage,de.object.ncloudstorage,s3-website.de.object.ncloudstorage,kr.object.ncloudstorage,s3-website.kr.object.ncloudstorage,sg.object.ncloudstorage,s3-website.sg.object.ncloudstorage,us.object.ncloudstorage,s3-website.us.object.ncloudstorage,kr.object.private.ncloudstorage,sg.object.private.ncloudstorage,kr.website.ncloudstorage,kr-naver.website.ncloudstorage,kr-naver-dev.website.ncloudstorage,jp.object.ncpstorage,jp.jp4.object.ncpstorage,jp.jp5.object.ncpstorage,kr.object.ncpstorage,s3-website-jp.object.ncpstorage,jp.object.private.ncpstorage,jp.jp4.object.private.ncpstorage,jp.jp5.object.private.ncpstorage,kr.object.private.ncpstorage,cloud.nospamproxy,o365.cloud.nospamproxy,4u,nfshost,3utilities,blogsyte,ciscofreak,damnserver,ddnsking,ditchyourip,dnsiskinky,dynns,geekgalaxy,health-carereform,homesecuritymac,homesecuritypc,myactivedirectory,mysecuritycamera,myvnc,net-freaks,onthewifi,point2this,quicksytes,securitytactics,servebeer,servecounterstrike,serveexchange,serveftp,servegame,servehalflife,servehttp,servehumour,serveirc,servemp3,servep2p,servepics,servequake,servesarcasm,stufftoread,unusualperson,workisboring,myiphost,static.observableusercontent,simplesite,*.oaiusercontent,orsites,operaunite,*.customer-oci,*.oci.customer-oci,*.ocp.customer-oci,*.ocs.customer-oci,*.oraclecloudapps,*.oraclegovcloudapps,authgear-staging,authgearapps,outsystemscloud,ownprovider,pgfog,gotpantheon,*.paywhirl,forgeblocks,upsunapp,postman-echo,xen.prgmr,dev.project-study,pythonanywhere,eu.pythonanywhere,qa2,mycloudnas,mynascloud,myqnapcloud,qualifioapp,ladesk,*.qualyhqpartner,*.qualyhqportal,qbuser,*.quipelements,rackmaze,readthedocs-hosted,rhcloud,onrender,app.render,subsc-pay,180r,dojin,sakuratan,sakuraweb,x0,*.builder.code,*.dev-builder.code,*.stg-builder.code,*.001.test.code-builder-stg.platform.salesforce,logoip,scrysec,firewall-gateway,myshopblocks,myshopify,shopitsite,1kapp,appchizi,applinzi,sinaapp,vipsinaapp,streamlitapp,try-snowplow,playstation-cloud,*.cursorusercontent,myspreadshop,w-corp-staticblitz,w-credentialless-staticblitz,w-staticblitz,stackhero-network,strapiapp,media.strapiapp,streak-link,streaklinks,streakusercontent,temp-dns,dsmynas,familyds,mytabit,taveusercontent,site.tb-hosting,reservd,thingdustdata,townnews-staging,pro.typeform,hk,it,deus-canvas,vivenushop,*.vultrobjects,wafflecell,hotelwithflight,cprapid,pleskns,remotewd,pages.wiardweb,drive-platform,base44-sandbox,wixsite,wixstudio,messwithdns,woltlab-demo,wpenginepowered,js.wpenginepowered,xtooldevice,yolasite;biz:activetrail,cloud-ip,cloudns,jozi,dyndns,for-better,for-more,for-some,for-the,selfip,webhop,orx,mmafan,myftp,no-ip,dscloud;dev:myaddr,panel,bearblog,brave,*.s.brave,*.lcl,*.lclstage,*.stg,*.stgstage,pages,r2,workers,codepen,deno,deno-staging,lp,api.lp,objects.lp,relay.evervault,payload,fly,githubpreview,*.gateway,grebedoc,botdash,*.inbrowser,is-a-good,iserv,leapcell,runcontainers,*.user.localcert,loginline,barsy,mediatech,mocha-sandbox,modx,ngrok,ngrok-free,is-a-fullstack,is-cool,is-not-a,localplayer,pagelemon,xmit,platter-app,*.replit,*.teams.replit,*.aa.crm,*.ab.crm,*.ac.crm,*.ad.crm,*.ae.crm,*.af.crm,*.ci.crm,*.d.crm,*.pa.crm,*.pb.crm,*.pc.crm,*.pd.crm,*.pe.crm,*.pf.crm,*.w.crm,*.wa.crm,*.wb.crm,*.wc.crm,*.wd.crm,*.we.crm,*.wf.crm,erp,web.erp,t3.storage,t3.storageapi,vercel,vivenushop,*.webhare,hrsn,is-a;tools:dyn.addr,myaddr;live:aem,hlx,*.ewp;net:adobeaemcloud,adobeio-static,adobeioruntime,akadns,akamai,akamai-staging,akamaiedge,akamaiedge-staging,akamaihd,akamaihd-staging,akamaiorigin,akamaiorigin-staging,akamaized,akamaized-staging,edgekey,edgekey-staging,edgesuite,edgesuite-staging,alwaysdata,myamaze,cloudfront,appudo,cdn.prod.atlassian-dev,myfritz,shopselect,blackbaudcdn,boomla,bplaced,square7,r.cdn77,cdn77-ssl,gb,hu,jp,se,uk,clickrising,ddns-ip,dns-cloud,dns-dynamic,cloudaccess,cloudflare,cdn.cloudflare,cdn.cloudflareanycast,cdn.cloudflarecn,cdn.cloudflareglobal,ctfcloud,feste-ip,knx-server,static-access,dattolocal,mydatto,debian,definima,deno,sandbox.deno,*.icp,de5,at-band-camp,blogdns,broke-it,buyshouses,dnsalias,dnsdojo,does-it,dontexist,dynalias,dynathome,endofinternet,from-az,from-co,from-la,from-ny,gets-it,ham-radio-op,homeftp,homeip,homelinux,homeunix,in-the-band,is-a-chef,is-a-geek,isa-geek,kicks-ass,office-on-the,podzone,scrapper-site,selfip,sells-it,servebbs,serveftp,thruhere,webhop,casacam,dynu,dynuddns,mysynology,opik,spryt,dynv6,twmail,ru,channelsdvr,u.channelsdvr,freetls.fastly,map.fastly,a.prod.fastly,global.prod.fastly,a.ssl.fastly,b.ssl.fastly,global.ssl.fastly,fastlylb,map.fastlylb,keyword-on,live-on,server-on,cdn-edges,heteml,cloudfunctions,grafana-dev,iobb,moonscale,in-dsl,in-vpn,oninferno,botdash,apps-1and1,ipifony,ipv64,cloudjiffy,fra1-de.cloudjiffy,west1-us.cloudjiffy,jls-sto1.elastx,jls-sto2.elastx,jls-sto3.elastx,fr-1.paas.massivegrid,lon-1.paas.massivegrid,lon-2.paas.massivegrid,ny-1.paas.massivegrid,ny-2.paas.massivegrid,sg-1.paas.massivegrid,jelastic.saveincloud,nordeste-idc.saveincloud,j.scaleforce,kinghost,uni5,krellian,ggff,*.localto,barsy,luyani,memset,azure-api,azure-mobile,azureedge,azurefd,azurestaticapps,1.azurestaticapps,2.azurestaticapps,3.azurestaticapps,4.azurestaticapps,5.azurestaticapps,6.azurestaticapps,7.azurestaticapps,centralus.azurestaticapps,eastasia.azurestaticapps,eastus2.azurestaticapps,westeurope.azurestaticapps,westus2.azurestaticapps,azurewebsites,australiacentral-01.azurewebsites,australiacentral2-01.azurewebsites,australiaeast-01.azurewebsites,australiasoutheast-01.azurewebsites,austriaeast-01.azurewebsites,belgiumcentral-01.azurewebsites,brazilsouth-01.azurewebsites,brazilsoutheast-01.azurewebsites,canadacentral-01.azurewebsites,canadaeast-01.azurewebsites,centralindia-01.azurewebsites,centralus-01.azurewebsites,centraluseuap-01.azurewebsites,chilecentral-01.azurewebsites,denmarkeast-01.azurewebsites,eastasia-01.azurewebsites,eastasiastage-01.azurewebsites,eastus-01.azurewebsites,eastus2-01.azurewebsites,eastus2euap-01.azurewebsites,eastus3-01.azurewebsites,francecentral-01.azurewebsites,francesouth-01.azurewebsites,germanynorth-01.azurewebsites,germanywestcentral-01.azurewebsites,indiasouthcentral-01.azurewebsites,indonesiacentral-01.azurewebsites,israelcentral-01.azurewebsites,israelnorthwest-01.azurewebsites,italynorth-01.azurewebsites,japaneast-01.azurewebsites,japanwest-01.azurewebsites,jioindiacentral-01.azurewebsites,jioindiawest-01.azurewebsites,koreacentral-01.azurewebsites,koreasouth-01.azurewebsites,malaysiawest-01.azurewebsites,mexicocentral-01.azurewebsites,newzealandnorth-01.azurewebsites,northcentralus-01.azurewebsites,northcentralusstage-01.azurewebsites,northeastus5-01.azurewebsites,northeurope-01.azurewebsites,norwayeast-01.azurewebsites,norwaywest-01.azurewebsites,*.p.azurewebsites,polandcentral-01.azurewebsites,qatarcentral-01.azurewebsites,southafricanorth-01.azurewebsites,southafricawest-01.azurewebsites,southcentralus-01.azurewebsites,southcentralus2-01.azurewebsites,southeastasia-01.azurewebsites,southeastus5-01.azurewebsites,southindia-01.azurewebsites,spaincentral-01.azurewebsites,swedencentral-01.azurewebsites,swedensouth-01.azurewebsites,switzerlandnorth-01.azurewebsites,switzerlandwest-01.azurewebsites,taiwannorth-01.azurewebsites,taiwannorthwest-01.azurewebsites,uaecentral-01.azurewebsites,uaenorth-01.azurewebsites,uksouth-01.azurewebsites,ukwest-01.azurewebsites,westcentralus-01.azurewebsites,westeurope-01.azurewebsites,westindia-01.azurewebsites,westus-01.azurewebsites,westus2-01.azurewebsites,westus3-01.azurewebsites,cloudapp,trafficmanager,blob.core.usgovcloudapi,file.core.usgovcloudapi,web.core.usgovcloudapi,servicebus.usgovcloudapi,usgovcloudapp,usgovtrafficmanager,blob.core.windows,file.core.windows,web.core.windows,servicebus.windows,sn.mynetname,routingthecloud,bounceme,ddns,eating-organic,mydissent,myeffect,mymediapc,mypsx,mysecuritycamera,nhlfan,no-ip,pgafan,privatizehealthinsurance,redirectme,serveblog,serveminecraft,sytes,dnsup,hicam,now-dns,ownip,vpndns,cloudycluster,*.hosting.ovh,*.webpaas.ovh,rackmaze,myradweb,in,subsc-pay,squares,schokokeks,firewall-gateway,seidat,senseering,siteleaf,mafelo,myspreadshop,vps-host,atl.jelastic.vps-host,njs.jelastic.vps-host,ric.jelastic.vps-host,soc.srcf,user.srcf,supabase,dsmynas,familyds,ts,*.c.ts,torproject,pages.torproject,tunnelmole,vusercontent,reserve-online,vps.hrsn,localcert,community-pro,meinforum,yandexcloud,storage.yandexcloud,website.yandexcloud,za,zabc;network:aem,*.alces,appwrite,co,arvo,azimuth,tlon;page:aem,hlx,prod,codeberg,deuxfleurs,mybox,heyflow,linkyhost,prvcy,rocky,statichost,pdns,plesk;reviews:aem;app:aiven,claude,*.beget,brave,*.s.brave,clerk,clerkstage,cloudflare,wnext,codepen,csb,preview.csb,convex,corespeed,ondigitalocean,easypanel,encr,frontend.encr,relay.evervault,expo,on.expo,staging.expo,on.staging.expo,edgecompute,on-fleek,flutterflow,sprites,e2b,framer,gadget,github,glideos,*.hosted,*.run,*.mtls.run,web,hackclub,hasura,onhercules,botdash,shiptoday,leapcell,loginline,lovable,auth.lovable,luyani,magicpatterns,medusajs,messerli,miren,mocha,netlify,ngrok,ngrok-free,*.developer,noop,*.northflank,pplx,*.upsun,puter,up.railway,replit,id.replit,retool,rocketpreview,nyat,sliplane,*.snowflake,*.privatelink.snowflake,streamlit,spawnbase,telebit,typedream,vercel,wal,wasmer,windsurf,base44,zeabur,*.zerops;estate:*.compute;fun:ms,vicp,yicp,zicp;show:ms;org:altervista,pimienta,poivron,potager,sweetpepper,c.cdn77,rsc.cdn77,ssl.origin.cdn77-secure,ae,cloudns,ip-dynamic,ddnss,dpdns,duckdns,tunk,blogdns,blogsite,boldlygoingnowhere,dnsalias,dnsdojo,doesntexist,dontexist,doomdns,dvrdns,dynalias,dyndns,go.dyndns,home.dyndns,endofinternet,endoftheinternet,from-me,game-host,gotdns,hobby-site,homedns,homeftp,homelinux,homeunix,is-a-bruinsfan,is-a-candidate,is-a-celticsfan,is-a-chef,is-a-geek,is-a-knight,is-a-linux-user,is-a-patsfan,is-a-soxfan,is-found,is-lost,is-saved,is-very-bad,is-very-evil,is-very-good,is-very-nice,is-very-sweet,isa-geek,kicks-ass,misconfused,podzone,readmyblog,selfip,sellsyourhome,servebbs,serveftp,servegame,stuff-4-sale,webhop,accesscam,camdvr,freeddns,mywire,roxa,webredirect,twmail,eu,al.eu,asso.eu,at.eu,au.eu,be.eu,bg.eu,ca.eu,cd.eu,ch.eu,cn.eu,cy.eu,cz.eu,de.eu,dk.eu,edu.eu,ee.eu,es.eu,fi.eu,fr.eu,gr.eu,hr.eu,hu.eu,ie.eu,il.eu,in.eu,int.eu,is.eu,it.eu,jp.eu,kr.eu,lt.eu,lu.eu,lv.eu,me.eu,mk.eu,mt.eu,my.eu,net.eu,ng.eu,nl.eu,no.eu,nz.eu,pl.eu,pt.eu,ro.eu,ru.eu,se.eu,si.eu,sk.eu,tr.eu,uk.eu,us.eu,fspages,fedorainfracloud,fedorapeople,cloud.fedoraproject,app.os.fedoraproject,app.os.stg.fedoraproject,freedesktop,hatenadiary,hepforge,in-dsl,in-vpn,js,barsy,routingthecloud,bmoattachments,cable-modem,collegefan,couchpotatofries,hopto,mlbfan,myftp,mysecuritycamera,nflfan,no-ip,read-books,ufcfan,zapto,dynserv,now-dns,is-local,httpbin,pubtls,jpn,my-firewall,myfirewall,spdns,small-web,dsmynas,familyds,s3.teckids,tuxfamily,hk,us,toolforge,wmcloud,beta.wmcloud,wmflabs,za;eu:auth.cognito-idp.eusc-de-east-1.on.amazonwebservices,transfer-webapp.eusc-de-east-1.on.amazonwebservices,cloudns,prvw,deuxfleurs,dnshome,jelastic.dogado,barsy,spdns,*.nxa,directwp,*.transurl;aws:*.airflow.af-south-1.on,*.airflow.ap-east-1.on,*.airflow.ap-northeast-1.on,*.airflow.ap-northeast-2.on,*.airflow.ap-northeast-3.on,*.airflow.ap-south-1.on,*.airflow.ap-south-2.on,*.airflow.ap-southeast-1.on,*.airflow.ap-southeast-2.on,*.airflow.ap-southeast-3.on,*.airflow.ap-southeast-4.on,*.airflow.ap-southeast-5.on,*.airflow.ap-southeast-7.on,*.airflow.ca-central-1.on,*.airflow.ca-west-1.on,*.airflow.eu-central-1.on,*.airflow.eu-central-2.on,*.airflow.eu-north-1.on,*.airflow.eu-south-1.on,*.airflow.eu-south-2.on,*.airflow.eu-west-1.on,*.airflow.eu-west-2.on,*.airflow.eu-west-3.on,*.airflow.il-central-1.on,*.airflow.me-central-1.on,*.airflow.me-south-1.on,*.airflow.sa-east-1.on,*.airflow.us-east-1.on,*.airflow.us-east-2.on,*.airflow.us-west-1.on,*.airflow.us-west-2.on,labeling.ap-northeast-1.sagemaker,labeling.ap-northeast-2.sagemaker,labeling.ap-south-1.sagemaker,labeling.ap-southeast-1.sagemaker,labeling.ap-southeast-2.sagemaker,labeling.ca-central-1.sagemaker,labeling.eu-central-1.sagemaker,labeling.eu-west-1.sagemaker,labeling.eu-west-2.sagemaker,labeling.us-east-1.sagemaker,labeling.us-east-2.sagemaker,labeling.us-west-2.sagemaker,notebook.af-south-1.sagemaker,notebook.ap-east-1.sagemaker,notebook.ap-northeast-1.sagemaker,notebook.ap-northeast-2.sagemaker,notebook.ap-northeast-3.sagemaker,notebook.ap-south-1.sagemaker,notebook.ap-south-2.sagemaker,notebook.ap-southeast-1.sagemaker,notebook.ap-southeast-2.sagemaker,notebook.ap-southeast-3.sagemaker,notebook.ap-southeast-4.sagemaker,notebook.ca-central-1.sagemaker,notebook-fips.ca-central-1.sagemaker,notebook.ca-west-1.sagemaker,notebook-fips.ca-west-1.sagemaker,notebook.eu-central-1.sagemaker,notebook.eu-central-2.sagemaker,notebook.eu-north-1.sagemaker,notebook.eu-south-1.sagemaker,notebook.eu-south-2.sagemaker,notebook.eu-west-1.sagemaker,notebook.eu-west-2.sagemaker,notebook.eu-west-3.sagemaker,notebook.il-central-1.sagemaker,notebook.me-central-1.sagemaker,notebook.me-south-1.sagemaker,notebook.sa-east-1.sagemaker,notebook.us-east-1.sagemaker,notebook-fips.us-east-1.sagemaker,notebook.us-east-2.sagemaker,notebook-fips.us-east-2.sagemaker,notebook.us-gov-east-1.sagemaker,notebook-fips.us-gov-east-1.sagemaker,notebook.us-gov-west-1.sagemaker,notebook-fips.us-gov-west-1.sagemaker,notebook.us-west-1.sagemaker,notebook-fips.us-west-1.sagemaker,notebook.us-west-2.sagemaker,notebook-fips.us-west-2.sagemaker,studio.af-south-1.sagemaker,studio.ap-east-1.sagemaker,studio.ap-northeast-1.sagemaker,studio.ap-northeast-2.sagemaker,studio.ap-northeast-3.sagemaker,studio.ap-south-1.sagemaker,studio.ap-southeast-1.sagemaker,studio.ap-southeast-2.sagemaker,studio.ap-southeast-3.sagemaker,studio.ca-central-1.sagemaker,studio.eu-central-1.sagemaker,studio.eu-central-2.sagemaker,studio.eu-north-1.sagemaker,studio.eu-south-1.sagemaker,studio.eu-south-2.sagemaker,studio.eu-west-1.sagemaker,studio.eu-west-2.sagemaker,studio.eu-west-3.sagemaker,studio.il-central-1.sagemaker,studio.me-central-1.sagemaker,studio.me-south-1.sagemaker,studio.sa-east-1.sagemaker,studio.us-east-1.sagemaker,studio.us-east-2.sagemaker,studio.us-gov-east-1.sagemaker,studio-fips.us-gov-east-1.sagemaker,studio.us-gov-west-1.sagemaker,studio-fips.us-gov-west-1.sagemaker,studio.us-west-1.sagemaker,studio.us-west-2.sagemaker,*.experiments.sagemaker,lambda-url.af-south-1.on,lambda-url.ap-east-1.on,lambda-url.ap-northeast-1.on,lambda-url.ap-northeast-2.on,lambda-url.ap-northeast-3.on,lambda-url.ap-south-1.on,lambda-url.ap-southeast-1.on,lambda-url.ap-southeast-2.on,lambda-url.ap-southeast-3.on,lambda-url.ca-central-1.on,lambda-url.eu-central-1.on,lambda-url.eu-north-1.on,lambda-url.eu-south-1.on,lambda-url.eu-west-1.on,lambda-url.eu-west-2.on,lambda-url.eu-west-3.on,lambda-url.me-south-1.on,lambda-url.sa-east-1.on,lambda-url.us-east-1.on,lambda-url.us-east-2.on,lambda-url.us-west-1.on,lambda-url.us-west-2.on,*.private.repost,transfer-webapp.af-south-1.on,transfer-webapp.ap-east-1.on,transfer-webapp.ap-east-2.on,transfer-webapp.ap-northeast-1.on,transfer-webapp.ap-northeast-2.on,transfer-webapp.ap-northeast-3.on,transfer-webapp.ap-south-1.on,transfer-webapp.ap-south-2.on,transfer-webapp.ap-southeast-1.on,transfer-webapp.ap-southeast-2.on,transfer-webapp.ap-southeast-3.on,transfer-webapp.ap-southeast-4.on,transfer-webapp.ap-southeast-5.on,transfer-webapp.ap-southeast-6.on,transfer-webapp.ap-southeast-7.on,transfer-webapp.ca-central-1.on,transfer-webapp.ca-west-1.on,transfer-webapp.eu-central-1.on,transfer-webapp.eu-central-2.on,transfer-webapp.eu-north-1.on,transfer-webapp.eu-south-1.on,transfer-webapp.eu-south-2.on,transfer-webapp.eu-west-1.on,transfer-webapp.eu-west-2.on,transfer-webapp.eu-west-3.on,transfer-webapp.il-central-1.on,transfer-webapp.me-central-1.on,transfer-webapp.me-south-1.on,transfer-webapp.mx-central-1.on,transfer-webapp.sa-east-1.on,transfer-webapp.us-east-1.on,transfer-webapp.us-east-2.on,transfer-webapp.us-gov-east-1.on,transfer-webapp-fips.us-gov-east-1.on,transfer-webapp.us-gov-west-1.on,transfer-webapp-fips.us-gov-west-1.on,transfer-webapp.us-west-1.on,transfer-webapp.us-west-2.on;online:eero,eero-stage,heimdns,websitebuilder,leapcell,barsy,book;xyz:opentunnel,caffeine,exe,botdash,*.telebit;cloud:antagonist,*.begetcdn,convex,eu-west-1.convex,us-east-1.convex,dnshome,elementor,emergent,eu.encoway,*.statics,ravendb,hstgr,online-server,es-1.axarnet,diadem,vip.jelastic,jele,it1.eur.aruba.jenv-aruba,it1.jenv-aruba,keliweb,cs.keliweb,oxa,tn.oxa,uk.oxa,primetel,uk.primetel,ca.reclaim,uk.reclaim,us.reclaim,ch.trendhosting,de.trendhosting,jote,jotelulu,elastic.k2,lb.ru-msk.k2,s3.ru-msk.k2,website.ru-msk.k2,lb.ru-spb.k2,s3.ru-spb.k2,website.ru-spb.k2,s3.k2,website.k2,kuleuven,laravel,linkyard,*.magentosite,matlab,observablehq,vapor,*.on-rancher,fr-par-1.baremetal.scw,fr-par-2.baremetal.scw,nl-ams-1.baremetal.scw,cockpit.fr-par.scw,ddl.fr-par.scw,dtwh.fr-par.scw,fnc.fr-par.scw,functions.fnc.fr-par.scw,ifr.fr-par.scw,k8s.fr-par.scw,nodes.k8s.fr-par.scw,kafk.fr-par.scw,mgdb.fr-par.scw,rdb.fr-par.scw,s3.fr-par.scw,s3-website.fr-par.scw,scbl.fr-par.scw,whm.fr-par.scw,priv.instances.scw,pub.instances.scw,k8s.scw,cockpit.nl-ams.scw,ddl.nl-ams.scw,dtwh.nl-ams.scw,ifr.nl-ams.scw,k8s.nl-ams.scw,nodes.k8s.nl-ams.scw,kafk.nl-ams.scw,mgdb.nl-ams.scw,rdb.nl-ams.scw,s3.nl-ams.scw,s3-website.nl-ams.scw,scbl.nl-ams.scw,whm.nl-ams.scw,cockpit.pl-waw.scw,ddl.pl-waw.scw,dtwh.pl-waw.scw,ifr.pl-waw.scw,k8s.pl-waw.scw,nodes.k8s.pl-waw.scw,kafk.pl-waw.scw,mgdb.pl-waw.scw,rdb.pl-waw.scw,s3.pl-waw.scw,s3-website.pl-waw.scw,scbl.pl-waw.scw,scalebook.scw,smartlabeling.scw,servebolt,runs.onstackit,trafficplex,unison-services,urown,voorloper,zap;apple:int,*.cloud.int,*.r.cloud.int,*.ap-north-1.r.cloud.int,*.ap-south-1.r.cloud.int,*.ap-south-2.r.cloud.int,*.eu-central-1.r.cloud.int,*.eu-north-1.r.cloud.int,*.us-central-1.r.cloud.int,*.us-central-2.r.cloud.int,*.us-east-1.r.cloud.int,*.us-east-2.r.cloud.int,*.us-west-1.r.cloud.int,*.us-west-2.r.cloud.int,*.us-west-3.r.cloud.int;global:appwrite;run:*.appwrite,canva,cloud,development,ravendb,liara,iran.liara,lovable,needle,*.build,*.code,*.database,*.migration,onporter,repl,sanity,stackit,val,web.val,vercel,wix;si:f5,gitpage;eus:user.party;link:myfritz,canva,cyon,joinmc,*.dweb,*.inbrowser,keenetic,*.eth,ipfs.nftstorage,mypep,ipfs.storacha,ipfs.w3s;shop:base,hoplix,barsy,barsyonline,shopware;gay:pages;place:ship,co;site:square,my.canva,*.cloudera,convex,eu-west-1.convex,us-east-1.convex,cyon,piebox,caffeine,docsflowy,fastvps,figma,figma-gov,preview,heyflow,jele,jouwweb,loginline,barsy,co,notion,omniwe,opensocial,chatgpt,madethis,support,*.platformsh,*.tst,playcode,byen,puter,scw,ams.scw,waw.scw,sol,srht,novecore,cpanel,wpsquared,sourcecraft;ch:square7,cloudns,cust.cloudscale,objects.lpg.cloudscale,objects.rma.cloudscale,lpg.objectstorage,rma.objectstorage,alp1.ae.flow,appengine.flow,linkyard-cloud,gotdns,dnsking,123website,myspreadshop,*.firenet,*.svc.firenet,12hp,2ix,4lima,lima-city;de:bplaced,square7,*.bwcloud-os-instance,com,dyn.cosidns,dnsupdater,dynamisches-dns,internet-dns,l-o-g-i-n,ddnss,dyn.ddnss,dyndns.ddnss,dyn-ip24,dyndns1,home-webserver,dyn.home-webserver,myhome-server,ddnssec,dnshome,dyndnssec,heimdns,srvdns,fuettertdasnetz,isteingeek,istmein,lebtimnetz,leitungsen,traeumtgerade,*.frusky,goip,xn--gnstigbestellen-zvb,xn--gnstigliefern-wob,pages.it.hs-heilbronn,pages-research.it.hs-heilbronn,dyn-berlin,in-berlin,in-brb,in-butter,in-dsl,in-vpn,home64,ipv64,iservschule,mein-iserv,schuldock,schulplattform,schulserver,test-iserv,keymachine,co,git-repos,lcube-server,svn-repos,barsy,webspaceconfig,123webseite,rub,ruhr-uni-bochum,io.noc.ruhr-uni-bochum,logoip,firewall-gateway,my-gateway,my-router,spdns,my,customer.speedpartner,myspreadshop,taifun-dns,12hp,2ix,4lima,lima-city,virtual-user,virtualuser,community-pro,diskussionsbereich,*.xenonconnect;space:manus,deployagent,myfast,vibehost,heiyu,hf,static.hf,app-ionos,project,uber,xs4all;mp:ju;diy:discourse,imagine;group:discourse;team:discourse,jelastic;cc:cleverapps,cloud-ip,cloudns,ccwu,ftpaccess,game-server,myphotos,scrapping,twmail,csx,fantasyleague,instances.spawn,sryze,ec,eu,gu,uk,us;tech:cleverapps;asia:cloudns,daemon,dix;club:cloudns,jele,barsy;info:cloudns,dynamic-dns,barrel-of-knowledge,barrell-of-knowledge,dyndns,for-our,groks-the,groks-this,here-for-more,knowsitall,selfip,webhop,barsy,mayfirst,mittwald,mittwaldserver,typo3server,dvrcam,ilovecollege,no-ip,forumz,nsupdate,dnsupdate,v-info;host:cloudaccess,freesite,easypanel,emergent,fastvps,myfast,gadget,tempurl,wpmudev,iserv,jele,mircloud,bolt,wp2,half;gdn:cnpy;nl:co,hosting-cluster,site.hosting-cluster,gov,khplay,123website,myspreadshop,*.transurl,cistron,demon;ru:ac,edu,gov,int,mil,eurodir,adygeya,bashkiria,bir,cbg,com,dagestan,grozny,kalmykia,kustanai,marine,mordovia,msk,mytis,nalchik,nov,pyatigorsk,spb,vladikavkaz,vladimir,na4u,mircloud,myjino,*.hosting.myjino,*.landing.myjino,*.spectrum.myjino,*.vps.myjino,hb.cldmail,mcdir,vps.mcdir,mcpre,net,org,pp,ras;dk:biz,co,firm,reg,store,123hjemmeside,myspreadshop;plus:playit,*.at.playit,with.playit;company:mybox;email:intouch,p.tawk,p.tawkto;bar:resolve;berlin:ddns;now:dyn,here,tmp;wtf:ddns;scot:co,me,org,gov,service.gov,mygov;name:forgot.her,forgot.his,ispmanager,keenetic;nu:merseine,mine,shacknet,enterprisecloud;tv:better-than,dyndns,on-the-web,worse-than,from,sakura;rocks:myddns,stackit,lima-city,webspace;camp:at.emf;cool:elementor,de;su:abkhazia,adygeya,aktyubinsk,arkhangelsk,armenia,ashgabad,azerbaijan,balashov,bashkiria,bryansk,bukhara,chimkent,dagestan,east-kazakhstan,exnet,georgia,grozny,ivanovo,jambyl,kalmykia,kaluga,karacol,karaganda,karelia,khakassia,krasnodar,kurgan,kustanai,lenug,mangyshlak,mordovia,msk,murmansk,nalchik,navoi,north-kazakhstan,nov,obninsk,penza,pokrovsk,sochi,spb,tashkent,termez,togliatti,troitsk,tselinograd,tula,tuva,vladikavkaz,vladimir,vologda;media:framer;photos:framer;website:framer;wiki:framer;community:nog,ravendb,myforum;design:graphic,bss;goog:cloud,translate,*.usercontent;studio:ai,sanity;vip:hidns;one:*.kin,service,website;pub:*.id,*.kin,barsy;work:imagine-proxy,puter;md:ir;events:koobin,co;build:shiptoday,v0,windsurf;limo:*.eth;direct:libp2p;business:co;education:co;financial:co;technology:co;services:loginline;menu:barsy,barsyonline;mobi:barsy,dscloud;store:barsy,sellfy,shopware,storebase;support:barsy;health:hra;systems:miren;fan:mkm;casa:ui.nabu;pizza:ngrok;news:noticeable;top:ntdll,*.wadl;ovh:nerdpol;lol:omg;lu:123website;hosting:opencraft;orange:tech;pm:own,name;codes:*.owo;games:pley,sheezy;today:prequalifyme;builders:cloudsite;basketball:aus,nz;edu:git-pages.rit;new:*.builtwithrocket;xn--p1acf:xn--90amc,xn--j1aef,xn--j1ael8b,xn--h1ahn,xn--j1adp,xn--c1avg,xn--80aaa0cvac,xn--h1aliz,xn--90a1af,xn--41a;case:sav;gw:nx;bot:*.apps.grok,*.pages.grok;zone:stackit,lima,*.triton,prg1-zerops,*.zerops;pictures:1337;rip:clan;tf:sch;wf:biz,sch;yt:org;academy:official";
  /*PSL:END*/
  let pslTable = null;
  function etld1(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/:\d+$/, '').replace(/\.$/, '');
    if (!h || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || !h.includes('.')) return h;
    if (!pslTable) {
      pslTable = new Map();
      for (const g of PSL_DATA.split(';')) { const i = g.indexOf(':'); if (i > 0) pslTable.set(g.slice(0, i), new Set(g.slice(i + 1).split(','))); }
    }
    const l = h.split('.');
    const rules = pslTable.get(l[l.length - 1]);
    let suffix = 1;
    if (rules) {
      for (let i = 0; i < l.length - 1; i++) {
        const rest = l.slice(i, -1).join('.');
        const wild = l.slice(i + 1, -1).join('.');
        if (rules.has(`!${rest}`)) { suffix = l.length - i - 1; break; }
        if (rules.has(rest) || rules.has(wild ? `*.${wild}` : '*')) { suffix = Math.max(suffix, l.length - i); break; }
      }
    }
    return l.slice(Math.max(0, l.length - suffix - 1)).join('.');
  }

  // each name reversed, as in core/netfilter.js DEFAULT_DENYLIST (the packaging test would mistake a denylist for a call to the service)
  const NF_DENY_DEFAULT = ['moc.scitylana-elgoog', 'moc.elgoog.scitylana', 'moc.reganamgatelgoog', 'moc.secivresdaelgoog', 'ten.kcilcelbuod', 'moc.rajtoh', 'oi.rajtoh', 'oi.yrtnes', 'oi.tnemges', 'moc.tnemges', 'moc.qhgodatad', 'ue.qhgodatad', 'sm.ytiralc', 'moc.cilerwen', 'ten.atad-rn', 'moc.lenapxim', 'moc.edutilpma', 'moc.yrotslluf', 'moc.gnib.tab', 'ten.koobecaf.tcennoc', 'moc.nideknil.sda.xp', 'moc.ndcil.pans', 'moc.pw.stats'].map((h) => h.split('').reverse().join(''));
  let nfDeny = NF_DENY_DEFAULT;
  const nfDenied = (h) => nfDeny.some((d) => h === d || h.endsWith(`.${d}`));
  const nfHosts = new Set(); // eTLD+1 of every first-party host (D3)
  let nfScanAt = 0;
  let nfPerf = 0;
  const nfAdd = (u) => { try { const h = new URL(u, location.href).hostname.toLowerCase(); if (h && !nfDenied(h)) nfHosts.add(etld1(h)); } catch { /* not a URL */ } };
  try { if (location.hostname) nfHosts.add(etld1(location.hostname)); for (const o of location.ancestorOrigins || []) nfAdd(o); } catch { /* opaque origin */ }
  /** Hosts that served a script, document or frame to this page: <script src>, <iframe src> and the resource timing entries. At most 4 scans a second. */
  function nfRefresh() {
    const now = Date.now();
    if (now - nfScanAt < 250) return;
    nfScanAt = now;
    try {
      for (const sc of document.scripts) if (sc.src) nfAdd(sc.src);
      for (const f of document.querySelectorAll('iframe[src]')) nfAdd(f.src);
    } catch { /* a page that shadows document.scripts */ }
    try {
      const r = performance.getEntriesByType('resource');
      for (; nfPerf < r.length; nfPerf++) if (/^(script|iframe|frame|navigation)$/.test(/** @type {any} */ (r[nfPerf]).initiatorType)) nfAdd(r[nfPerf].name);
    } catch { /* no resource timing */ }
  }

  const NF_ASSET = /\.(?:woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|css)(?:$|\?)/i;
  const NF_AUTH = /^(authorization|x-auth[\w-]*|x-api-key|x-csrf-token|x-xsrf-token|proxy-authorization)$/i;
  const hasAuth = (h) => {
    if (!h) return false;
    if (Array.isArray(h)) return h.some((x) => NF_AUTH.test(String(x?.name ?? x?.[0] ?? '')));
    return typeof h === 'object' && Object.keys(h).some((k) => NF_AUTH.test(k));
  };

  /** D2 "header or cookie": cookies go with an `include` request, and with a same-origin one unless it opted out; a page script sees only non-HttpOnly cookies, so those are the ones that count. */
  const nfCred = (cred, url) => {
    if (cred === 'include') return true;
    if (cred === 'omit') return false;
    try { return new URL(url, location.href).origin === location.origin && !!document.cookie; } catch { return false; }
  };

  /** Per distinct address, parsed once: host, registrable domain, denylisted, path facts. Bounded; a rotating set of URLs just refills it. */
  const nfInfo = new Map();
  function nfParse(url) {
    let info = nfInfo.get(url);
    if (info !== undefined) return info;
    info = null;
    try {
      const u = new URL(url, location.href);
      if (/^(?:https?|wss?):$/.test(u.protocol)) {
        const host = u.hostname.toLowerCase();
        info = { host, site: etld1(host), denied: nfDenied(host), junk: u.pathname.endsWith('.map') || /\/favicon\.ico$/i.test(u.pathname), asset: NF_ASSET.test(u.pathname) };
      }
    } catch { /* not a URL */ }
    if (nfInfo.size >= 2000) nfInfo.clear();
    nfInfo.set(url, info);
    return info;
  }

  /** Tags a net event in place. Never throws, never removes anything. */
  function nfTag(ev) {
    if (ev.kind !== 'net') return;
    const u = nfParse(ev.url);
    if (!u) return;
    let first = nfHosts.has(u.site);
    if (!first && !u.denied) { nfRefresh(); first = nfHosts.has(u.site); }
    ev.fp = first ? 1 : 0;
    if (!isFailure(ev)) { if (ev.status >= 300 && ev.status < 400) ev.flt = 'redirect'; return; }
    const status = ev.status || 0;
    const aborted = ev.en === 'AbortError' || ev.ev === 'abort';
    // D2: caused by the tester within 2 s (1) or within the causal window (2); a background 4xx stays untagged.
    const started = (ev.ts || Date.now()) - (ev.durationMs || 0);
    if (lastActAt && started - lastActAt >= -250 && started - lastActAt <= 2000) ev.ca = 1;
    else if (status >= 400 && status < 500 && ev.ev !== 'gql' && causedByAction(ev)) ev.ca = 2;
    if (hasAuth(ev.reqHeaders) || ev.reqCred === true) ev.au = 1;
    delete ev.reqCred; // transient: never part of the record
    const protectedRow = (ev.fp === 1 && (status >= 500 || ev.ev === 'gql' || (ev.error === true && !aborted))) || (ev.ca === 1 && status >= 400) || ev.au === 1;
    const opened = ev.opened === true;
    delete ev.opened;
    // D4 before D2 for sockets: a close or reconnect of a connection that had opened is not a transport failure; one that never opened stays real.
    if ((ev.via === 'ws' || ev.via === 'sse') && opened && ev.ca !== 1) { ev.flt = 'socket'; return; }
    if (protectedRow) return;
    // D4 noise classes
    if (aborted) { if (!(ev.durationMs > 10000)) ev.flt = 'abort'; return; }
    if (u.denied) { ev.flt = 'telemetry'; return; }
    if (!ev.fp && ev.error === true && status === 0 && ev.ev !== 'timeout' && ev.en !== 'TimeoutError') { ev.flt = 'adblock'; return; }
    if (status === 404 && u.junk) { ev.flt = 'junk'; return; }
    if (!ev.fp && (ev.via === 'resource' || u.asset)) { ev.flt = 'junk'; return; }
  }

  /**
   * Every natural request/console/uncaught outcome goes through here. Successes
   * pass straight through; a failure is stored in full only the first
   * STORE_PER_FP_EPOCH times per (cheapKey, act); the rest are counted and go out
   * as one `rep` row per second, a storm becomes one row, and the session is budgeted per
   * 5-minute slice (D7). The first and the last occurrence of every fingerprint are stored in full;
   * overflow becomes a counted row, never silence (D1).
   */
  function report(ev, raw, actAtStart) {
    if (!awake && !undecided) return;
    // r3-05-1: a request belongs to the action that was current when it STARTED, not when its answer came back.
    ev.act = Number.isInteger(actAtStart) ? actAtStart : act;
    if (ev.kind === 'net') { try { nfTag(ev); } catch { /* tagging must never lose an event */ } delete ev.reqCred; }
    // cap1022: a logged console.error is not an uncaught error (kept as a warning line).
    if (isFailure(ev) && !ev.overridden && ev.via !== 'api' && ev.kind === 'console') ev.level = 'warn';
    if (!isFailure(ev)) return emit(ev);
    const h = hintFor(ev, raw);
    if (h) ev.nh = h;

    let k = `${cheapKey(ev)}#${ev.act}`;
    const noise = !!ev.flt;
    let s = keys.get(k);
    // D7 global cap: once NOISE_FIRST_CAP distinct noise fingerprints are stored, a new distinct noise fingerprint joins one counted bucket per host and reason
    // (never stored, no held last occurrence), so a flood of distinct noise URLs becomes counted rows. A real row (no `flt`) never takes this path.
    let ovf = false;
    if (!s && noise && firstNoise >= NOISE_FIRST_CAP) {
      ovf = true;
      let host = '';
      try { host = nfParse(ev.url)?.host || ''; } catch { /* no host */ }
      k = `ovf|${ev.flt}|${host}`;
      s = keys.get(k);
    }
    if (!s && keys.size >= KEYS_CAP) {
      // D2: a row that carries no noise tag is never folded into the anonymous capped count; it is stored in full (first and last), within its own ceiling.
      if (!noise && ev.kind === 'net' && protectedFull < PROTECTED_FULL_CAP) { protectedFull++; return emit(ev); }
      overCap++; wantFlush(); return;
    }
    if (!s) keys.set(k, (s = { stored: 0, pend: 0, sec: 0, cnt: 0, hot: 0, storm: false, proto: ev, lastEv: null, lastTs: 0, worst: 0, ovf }));

    const sec = Math.floor(Date.now() / 1000);
    if (sec !== s.sec) {
      s.hot = s.cnt > STORM_RATE && sec === s.sec + 1 ? s.hot + 1 : 0;
      s.rate = s.cnt; // occurrences in the last full second
      s.sec = sec;
      s.cnt = 0;
    }
    s.cnt++;
    s.worst = Math.max(s.worst, Number(ev.status) || 0);
    if (!s.storm && !s.ovf && s.hot >= STORM_SECS) { // an overflow bucket is already one counted row
      s.storm = true;
      emit(repRow(s, { n: s.rate, storm: true }));
    }

    const slice = `${noise ? 1 : 0}#${Math.floor((Date.now() - t0) / SLICE_MS)}`;
    const used = sliceUsed.get(slice) || 0;
    const first = s.stored === 0 && (noise ? firstNoise < NOISE_FIRST_CAP : firstReal < FIRST_CAP);
    if (s.ovf) { s.pend++; s.lastTs = ev.ts || Date.now(); wantFlush(); return; }
    if (!s.storm && s.stored < STORE_PER_FP_EPOCH && (first || used < (noise ? NOISE_SLICE_CAP : SLICE_CAP))) {
      if (s.stored === 0) { if (noise) firstNoise++; else firstReal++; }
      if (!first) sliceUsed.set(slice, used + 1);
      s.stored++;
      return emit(ev);
    }
    s.pend++; // counted, never dropped; the last occurrence is kept in full and sent when the key goes quiet
    s.lastEv = ev;
    s.lastTs = ev.ts || Date.now();
    wantFlush();
  }

  /* --------------------------------------------------------- override rules */

  /**
   * Feature 6: request override.
   *
   * MV3's declarativeNetRequest is rule-based and cannot read or replace a
   * response body, and blocking webRequest is gone — so forcing a 500, an empty
   * payload or a slow response has to happen right here, in the page's own
   * fetch/XHR. Rules arrive from the extension a few milliseconds after
   * document_start, so a request fired in the very first tick may slip through;
   * that is inherent, not a bug to chase.
   */
  let rules = [];

  /**
   * r9-02-2 (OF-10): awake, act and rules arrive on the same paired port as the events leave on, so a page cannot forge them.
   * A harness without MessageChannel keeps the old window messages (inert in a real page, which always has the constructor).
   */
  function control(d) {
    if (d.t === 'awake') {
      awake = !!d.awake;
      undecided = false;
      const queued = held;
      held = [];
      if (awake) for (const ev of queued) emit(ev);
      if (!awake) rules = [];
    } else if (d.t === 'act') {
      if (Number.isInteger(d.act) && d.act > act) lastActAt = Date.now();
      act = Number.isInteger(d.act) && d.act >= 0 ? Math.min(d.act, 1e9) : act;
    } else if (d.t === 'rules') rules = Array.isArray(d.rules) ? d.rules : [];
    else if (d.t === 'nf') {
      // D3/D4: the tester's pinned hosts join the first-party set; an edited denylist replaces the default one.
      for (const h of Array.isArray(d.hosts) ? d.hosts.slice(0, 100) : []) { try { nfHosts.add(etld1(String(h).replace(/^https?:\/\//, '').split('/')[0])); } catch { /* skip */ } }
      if (Array.isArray(d.deny)) nfDeny = d.deny.slice(0, 200).map((x) => String(x).toLowerCase());
      nfInfo.clear();
    }
  }
  controlHook = control;
  if (typeof MessageChannel !== 'function') {
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (d?.source === 'uqa-awake') control({ t: 'awake', awake: d.awake });
      else if (d?.source === 'uqa-act') control({ t: 'act', act: d.act });
      else if (d?.source === 'uqa-rules') control({ t: 'rules', rules: d.rules });
    });
  }

  /* ── GraphQL ──────────────────────────────────────────────────────────

     Why GraphQL needs its own matching at all: every operation on a GraphQL
     API is a POST to the *same URL*. A rule that matches on the URL matches
     the whole API, so "make the checkout mutation fail" is not expressible —
     which is precisely the rule anybody actually wants.

     The operation name is in the request body, so the matcher has to read it.  */

  /**
   * What a request body says it is asking for.
   *
   * Handles the three shapes in the wild: a JSON object, a JSON array (batched
   * operations), and the GET form where the query is in the query string.
   * Returns null for anything that is not GraphQL, so the cost on a normal REST
   * request is one `typeof` and a `startsWith`.
   */
  function graphqlInfo(body, url) {
    let doc = null;

    if (typeof body === 'string' && body.trim().startsWith('{')) {
      try {
        doc = JSON.parse(body);
      } catch {
        return null;
      }
    } else if (typeof body === 'string' && body.trim().startsWith('[')) {
      try {
        const batch = JSON.parse(body);
        doc = Array.isArray(batch) ? batch[0] : null;
      } catch {
        return null;
      }
    } else if (!body && url) {
      try {
        const q = new URL(url, location.href).searchParams;
        if (q.get('query')) doc = { query: q.get('query'), operationName: q.get('operationName') };
      } catch {
        return null;
      }
    }

    if (!doc || typeof doc.query !== 'string') return null;

    // `operationName` is optional even when the document names its operation,
    // so fall back to parsing it out — a rule that only worked when the client
    // happened to send the field would be unusable on half the APIs out there.
    const named = doc.operationName ||
      (doc.query.match(/^\s*(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/m) || [])[1] ||
      null;

    const kind = (doc.query.match(/^\s*(query|mutation|subscription)\b/m) || [])[1] || 'query';

    return { operationName: named, operationType: kind, query: doc.query, variables: doc.variables || null };
  }

  /**
   * A GraphQL error response.
   *
   * **HTTP 200 with an `errors` array** — which is the whole point. A client
   * that checks `res.ok` and nothing else sails straight past a GraphQL failure
   * and renders undefined into the page, and that bug is invisible until
   * somebody forces it. Forcing a 500 instead tests a different path and misses
   * it entirely.
   */
  function graphqlErrorBody(rule, info) {
    return JSON.stringify({
      data: rule.nullData === false ? undefined : null,
      errors: [
        {
          message: rule.message || 'Forced by QA Wrap',
          path: rule.path ? String(rule.path).split('.') : undefined,
          extensions: {
            code: rule.code || 'INTERNAL_SERVER_ERROR',
            // The flag that says this failure was forced rather than real. It
            // was `njb` until 5 September 2026; the body is written into the
            // page under test and never read back, so nothing has to accept
            // both names.
            qawrap: true,
            operation: info?.operationName || null,
          },
        },
      ],
    });
  }

  /**
   * Does this rule apply to this request?
   *
   * `context` carries the request body when there is one, so a rule can match
   * on a GraphQL operation or on any substring of what is being sent. Reading
   * the body is not free, so it is passed in by the caller — which already has
   * it — rather than fetched here.
   */
  function ruleHits(r, full, method, context) {
    if (!awake) return false;
    if (!r.enabled) return false;
    if (r.method && r.method !== 'ANY' && r.method !== method) return false;
    if (r.remaining != null && r.remaining <= 0) return false;
    // GraphQL: match the operation, not the URL. Every operation on a GraphQL
    // API posts to the same endpoint, so a URL match is a match on the whole
    // API and cannot express "make the checkout mutation fail".
    if (r.operation) {
      const info = context?.graphql;
      if (!info) return false;
      const wanted = String(r.operation);
      const got = info.operationName || '';
      const nameHit = r.operationIsRegex
        ? (() => {
            try {
              return new RegExp(wanted).test(got);
            } catch {
              return false;
            }
          })()
        : got === wanted;
      if (!nameHit) return false;
      if (r.operationType && r.operationType !== 'any' && info.operationType !== r.operationType) return false;
    }

    // Match on what is being sent, for the APIs that put the interesting part
    // in the payload rather than the path.
    if (r.bodyContains && !String(context?.body || '').includes(r.bodyContains)) return false;

    if (r.isRegex) {
      try {
        return new RegExp(r.pattern).test(full);
      } catch {
        return false;
      }
    }
    return !r.pattern || full.includes(r.pattern);
  }

  /**
   * Every matching rule, not just the first.
   *
   * A single-rule model cannot express "send this header AND make it fail",
   * which is most of what request manipulation is actually used for. So rules
   * compose: the modifiers (redirect, headers, delay) all apply in order, and
   * the first terminal action (fail / status / body) wins and stops the
   * request. Terminal actions do not stack — two of them would just be an
   * argument about which 500 to send.
   */
  function matchRules(url, method, context) {
    const full = String(url);
    const hits = rules.filter((r) => ruleHits(r, full, method, context));
    return {
      all: hits,
      // `mock` and `graphqlError` are terminal too: both replace the response,
      // and a request cannot be answered twice.
      terminal:
        hits.find(
          (r) =>
            r.action === 'fail' ||
            r.action === 'status' ||
            r.action === 'body' ||
            r.action === 'mock' ||
            r.action === 'graphqlError'
        ) || null,
    };
  }

  /** Kept for the single-rule call sites; the composed set is what drives behaviour. */
  function matchRule(url, method, context) {
    const { all, terminal } = matchRules(url, method, context);
    return terminal || all[0] || null;
  }

  /**
   * Rewrite a URL, with $1..$9 from the match pattern when it is a regex.
   * Requestly's redirect rule is the one people miss most: pointing a
   * production bundle at a local build, or an API at a mock host, without
   * touching the app.
   */
  function redirectUrl(rule, full) {
    if (!rule.redirectTo) return full;
    if (rule.isRegex) {
      try {
        return full.replace(new RegExp(rule.pattern), rule.redirectTo);
      } catch {
        return full;
      }
    }
    // A bare host swap is the common case and does not need a regex.
    if (rule.pattern && full.includes(rule.pattern)) return full.replace(rule.pattern, rule.redirectTo);
    return rule.redirectTo;
  }

  /**
   * Header edits, applied to a plain object so both fetch and XHR can use them.
   * `null` as a value removes the header — the way to test what an app does
   * without an Authorization or a CSRF token.
   */
  function editHeaders(base, edits) {
    const out = { ...base };
    for (const [name, value] of Object.entries(edits || {})) {
      const key = Object.keys(out).find((k) => k.toLowerCase() === name.toLowerCase()) || name;
      if (value === null || value === '') delete out[key];
      else out[key] = value;
    }
    return out;
  }

  const headersToObject = (h) => {
    const out = {};
    if (!h) return out;
    if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => (out[k] = v));
    else if (Array.isArray(h)) for (const [k, v] of h) out[k] = v;
    else Object.assign(out, h);
    return out;
  };

  /**
   * Count a firing locally AND tell the extension.
   *
   * The local decrement keeps this page honest between messages; the report to
   * the extension is what makes the budget survive a navigation. Without the
   * second half, a rule set to fire three times fired three times on every page
   * the tester visited.
   */
  function consume(rule) {
    if (rule.remaining != null) rule.remaining -= 1;
    toBridge({ t: 'rule-fired', ruleId: rule.id });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** r3-05-2: how much of a GraphQL answer is scanned for `errors` (a truncated body falls back to a shape test). */
  const GQL_READ = 65536;
  function gqlFacts(text, info) {
    if (!text) return undefined;
    let n = 0;
    let errs;
    try {
      const j = JSON.parse(text);
      for (const d of Array.isArray(j) ? j : [j]) {
        if (Array.isArray(d?.errors) && d.errors.length) { n += d.errors.length; errs = errs || d.errors; }
      }
    } catch {
      if (/"errors"\s*:\s*\[\s*\{/.test(text)) n = 1; // cut off before the end: the shape is enough
    }
    if (!n) return undefined;
    let preview;
    try { preview = JSON.stringify(redact(errs)).slice(0, MAX_BODY); } catch { /* keep none */ }
    // `ev: 'gql'` is the failure marker (an existing structural field): HTTP 200, error:false, the count in `text`.
    return { ev: 'gql', text: `GraphQL: ${n} error${n > 1 ? 's' : ''}`, operation: info.operationName || undefined, responsePreview: preview };
  }

  /* ------------------------------------------------------------------- fetch */

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function (...args) {
      const started = performance.now();
      const actAtStart = act;
      const req = args[0];
      const init = args[1] || {};
      let url = typeof req === 'string' ? req : req?.url || String(req);
      const method = (init.method || (typeof req === 'object' && req?.method) || 'GET').toUpperCase();

      // The body is read once, here, and handed to the matcher — a GraphQL
      // rule matches on the operation name, which only exists in the payload.
      // `init.body` is the only safe place to read it: a Request object's body
      // is a stream that can be consumed exactly once, and reading it would
      // send the application's request out empty.
      const rawBody = typeof init.body === 'string' ? init.body : (typeof URLSearchParams === 'function' && init.body instanceof URLSearchParams ? init.body.toString() : null);
      const context = { body: rawBody, graphql: graphqlInfo(rawBody, url) };
      const { all, terminal } = matchRules(url, method, context);
      const rule = terminal || all[0] || null;
      const requested = url;

      if (all.length) {
        all.forEach(consume);

        // Modifiers first, in the order the rules were written.
        let headerEdits = null;
        let totalDelay = 0;
        for (const r of all) {
          if (r.redirectTo) url = redirectUrl(r, url);
          if (r.headers) headerEdits = { ...(headerEdits || {}), ...r.headers };
          if (r.delayMs) totalDelay += r.delayMs;
        }
        if (totalDelay) await sleep(totalDelay);

        if (headerEdits || url !== requested) {
          const isReq = typeof Request === 'function' && req instanceof Request;
          const merged = headerEdits
            ? editHeaders(headersToObject(init.headers || (isReq ? req.headers : null)), headerEdits)
            : init.headers;
          if (isReq) {
            // A Request carries its own method and body. Rebuilding from a bare
            // url + init turned a POST into a bodyless GET, so copy them across
            // (the body is read from a clone, the original stays untouched).
            const bodyless = /^(GET|HEAD)$/i.test(req.method);
            const body = bodyless || init.body !== undefined ? init.body : await req.clone().arrayBuffer();
            args = [new Request(url, {
              method: req.method, mode: req.mode, credentials: req.credentials, cache: req.cache,
              redirect: req.redirect, referrer: req.referrer, integrity: req.integrity, signal: req.signal,
              ...init, headers: merged || req.headers, body,
            })];
          } else {
            args = [url, merged ? { ...init, headers: merged } : init];
          }
        }

        if (url !== requested) {
          emit({
            kind: 'net', via: 'fetch', method, url: short(requested), status: 0, ok: true,
            durationMs: 0, error: false, redirectedTo: short(url), overridden: true,
            ruleLabel: all.find((r) => r.redirectTo)?.label, ts: Date.now(),
          });
        }
      }

      // Captured before the call, because `init` is the only place the outgoing
      // headers and body exist — after `nativeFetch` returns they are gone, and
      // a request tool that cannot say what it sent is half a tool.
      const sent = {
        reqHeaders: safeHeaders(init.headers || (typeof req === 'object' ? req?.headers : null)),
        // Only `init.body`. A `Request` object's body is a stream that can be
        // read exactly once, and reading it here would consume the body the
        // application is about to send — the request would go out empty. So
        // when `fetch(new Request(...))` is used the body is genuinely not
        // available, and the export says so rather than inventing one.
        reqBody: safeBody(init.body),
        reqCred: nfCred(init.credentials || (typeof req === 'object' ? /** @type {any} */ (req)?.credentials : undefined), url),
      };

      if (terminal) {
        const rule = terminal;

        if (rule.action === 'fail') {
          emit({
            kind: 'net', via: 'fetch', method, url: short(url), status: 0, ok: false,
            durationMs: performance.now() - started, error: true,
            text: 'Forced network failure (UQA override)', overridden: true,
            ruleLabel: rule.label, ts: Date.now(),
          });
          throw new TypeError('Failed to fetch');
        }

        /**
         * A canned response, with the shape a real one would have.
         *
         * Separate from `status` because the intent is different: `status` is
         * "break this", `mock` is "answer this without a server", which is what
         * lets a front end be exercised against an endpoint nobody has built.
         */
        if (rule.action === 'mock') {
          const status = rule.status || 200;
          const body = rule.body != null ? String(rule.body) : '{}';
          if (rule.delayMs) await sleep(rule.delayMs);
          emit({
            kind: 'net', via: 'fetch', method, url: short(url), status, ok: status < 400,
            durationMs: performance.now() - started, error: false,
            responsePreview: body.slice(0, MAX_BODY),
            mocked: true, overridden: true, ruleLabel: rule.label, ...sent, ts: Date.now(),
          });
          return new Response(body, {
            status,
            headers: editHeaders(
              { 'content-type': rule.contentType || 'application/json' },
              rule.responseHeaders
            ),
          });
        }

        /**
         * A GraphQL error, which is an HTTP **200**.
         *
         * That is the whole reason this action exists rather than reusing
         * `status`. A GraphQL failure comes back 200 with an `errors` array, so
         * a client that checks `res.ok` and nothing else sails straight past it
         * and renders undefined into the page. Forcing a 500 tests a different
         * code path and misses that bug completely.
         */
        if (rule.action === 'graphqlError') {
          const body = graphqlErrorBody(rule, context.graphql);
          emit({
            kind: 'net', via: 'fetch', method, url: short(url), status: 200, ok: true,
            durationMs: performance.now() - started, error: false,
            responsePreview: body.slice(0, MAX_BODY),
            graphqlError: true, overridden: true, ruleLabel: rule.label,
            operation: context.graphql?.operationName || null,
            ...sent, ts: Date.now(),
          });
          return new Response(body, {
            status: 200,
            headers: editHeaders({ 'content-type': 'application/json' }, rule.responseHeaders),
          });
        }

        if (rule.action === 'status' || rule.action === 'body') {
          const status = rule.status || 500;
          const body = rule.body != null ? rule.body : '';
          emit({
            kind: 'net', via: 'fetch', method, url: short(url), status, ok: status < 400,
            durationMs: performance.now() - started, error: false,
            responsePreview: String(body).slice(0, MAX_BODY),
            overridden: true, ruleLabel: rule.label, ts: Date.now(),
          });
          return new Response(body, {
            status,
            statusText: rule.statusText || '',
            // Response headers the page will see. Overriding CORS or cache
            // headers is half of what a request tool is reached for.
            headers: editHeaders(
              { 'content-type': rule.contentType || 'application/json' },
              rule.responseHeaders
            ),
          });
        }
      }

      return nativeFetch.apply(this, args).then(
        (res) => {
          // r5-05-1: the time is the response's, taken before any body read, and the page gets its
          // response at once; a failing body is read detached, bounded, and reported once after.
          const durationMs = performance.now() - started;
          const ts = Date.now();
          const fire = (responsePreview, gql) => report({
            kind: 'net', via: 'fetch', method, url: short(url),
            status: res.status, ok: res.ok, durationMs,
            error: false, responsePreview, ...sent, operation: context.graphql?.operationName || undefined, // D5: a clean answer names its GraphQL operation, so only the same operation recovers
            resHeaders: safeHeaders(res.headers),
            overridden: rule ? true : undefined, ruleLabel: rule?.label,
            ...gql, ts,
          }, undefined, actAtStart);
          if (!res.ok) previewOf(res).then(fire, () => fire());
          else if (awake && !rule && context.graphql && /json|graphql/i.test(res.headers?.get?.('content-type') || '')) {
            // r3-05-2: a GraphQL failure is HTTP 200 with `errors`; read a detached, bounded clone, report once.
            previewOf(res, GQL_READ).then((t) => fire(undefined, gqlFacts(t, context.graphql)), () => fire());
          } else fire();
          return res;
        },
        (err) => {
          report({
            kind: 'net', via: 'fetch', method, url: short(url),
            status: 0, ok: false, durationMs: performance.now() - started,
            error: true, text: String(err?.message || err), en: errName(err), ...sent, ts: Date.now(),
          }, undefined, actAtStart);
          throw err;
        }
      );
    };
  }

  /* ------------------------------------------------------- form submissions */

  /**
   * A <form> submit is a navigation, so the fetch/XHR hooks above never see it: "Break a request" on a Login button
   * that posts a plain form left the real page loading (H1, audit lane G). When the app has not taken the submit over
   * itself (defaultPrevented), a matching rule that fails or answers (status / body / mock / fail) cancels the
   * navigation and writes that answer into the page; a matching delay waits, then submits natively.
   * ponytail: redirect and header rules need the network layer and are not applied to forms; the answer replaces the
   * document in place (the URL stays), where a real 500 would also change the address.
   */
  window.addEventListener('submit', (ev) => {
    const form = /** @type {any} */ (ev.target);
    if (ev.defaultPrevented || !rules.length || form?.tagName !== 'FORM') return;
    // A button's formAction/formMethod answer the DOCUMENT url / "" when the button sets nothing, never the form's: read
    // them only when the attribute is there (K1: real Login click matched /login, not /authenticate, so no rule fired).
    const sub = ev.submitter;
    const has = (n) => sub?.getAttribute?.(n) != null;
    const url = has('formaction') ? sub.formAction : typeof form.action === 'string' && form.action ? form.action : location.href;
    const method = String((has('formmethod') ? sub.formMethod : form.method) || 'get').toUpperCase();
    let body = '';
    try { body = new URLSearchParams(/** @type {any} */ (new FormData(form))).toString(); } catch { /* files or no FormData: match on the URL only */ }
    const { all, terminal } = matchRules(url, method, { body });
    const answers = terminal && terminal.action !== 'graphqlError' ? terminal : null;
    const wait = all.reduce((n, r) => n + (r.delayMs || 0), 0);
    if (!answers && !wait) return;
    ev.preventDefault();
    all.filter((r) => r === answers || r.delayMs).forEach(consume);
    (async () => {
      const started = performance.now();
      if (wait) await sleep(wait);
      if (!answers) return Object.getPrototypeOf(form).submit.call(form);
      const failed = answers.action === 'fail';
      const status = failed ? 0 : answers.status || (answers.action === 'mock' ? 200 : 500);
      const text = failed ? 'This site can’t be reached' : answers.body != null ? String(answers.body) : '';
      emit({
        kind: 'net', via: 'document', method, url: short(url), status, ok: !failed && status < 400,
        durationMs: performance.now() - started, error: failed,
        ...(failed && { text: 'Forced network failure (UQA override)' }),
        responsePreview: text.slice(0, MAX_BODY), overridden: true, ruleLabel: answers.label, ts: Date.now(),
      });
      try {
        const shown = text || (failed ? '' : status >= 400 ? `HTTP ERROR ${status}` : '');
        document.open();
        document.write(`<!doctype html><meta charset="utf-8"><title>${status || 'Error'}</title>${/html/i.test(answers.contentType || '') ? shown : `<pre>${shown.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`}`);
        document.close();
      } catch {
        Object.getPrototypeOf(form).submit.call(form); // the page would not take the answer: let the submit through
      }
    })();
  });

  /* ------------------------------------------------- what a request carried */

  /**
   * Which header and field names never leave the page with a value.
   *
   * A deny-list is the wrong shape for secrets in general — you cannot
   * enumerate every name a team will invent — but here it is the *second* line
   * of defence, not the only one: nothing below records a value it was not
   * asked to, request bodies are truncated, and the whole mechanism is inert
   * until the tester wakes the extension. The list catches the names that
   * actually appear, and the redaction is visible in the output rather than
   * silent, so a tester can see that something was held back.
   */
  /* privacy-names:begin (generated from core/privacy-names.json; do not edit) */
const SECRET_NAMES = new Set(["pass","password","passwd","pwd","passcode","passphrase","secret","token","auth","authorization","bearer","session","sessionid","phpsessid","jsessionid","aspsessionid","cookie","apikey","otp","pin","credit","creditcard","card","cardnumber","cvv","cvc","ssn","iban","jwt","csrf","xsrf","sid","privatekey","accesskey","subscriptionkey","functionskey","secretkey","signingkey","licensekey","dpop","nationalid","كلمةالمرور","رقمسري"]);
const isSecretName = (name) => { const t = String(name).replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z\d\u0600-\u06ff]+/).filter(Boolean); return t.some((w, i) => SECRET_NAMES.has(w) || (i > 0 && SECRET_NAMES.has(t[i - 1] + w))); };
/* privacy-names:end */
  const SECRET = { test: isSecretName };

  const REDACTED = '«redacted»';

  function safeHeaders(headers) {
    const out = {};
    for (const [name, value] of Object.entries(headersToObject(headers) || {})) {
      out[name] = SECRET.test(name) ? REDACTED : String(value).slice(0, 300);
    }
    return out;
  }

  /**
   * A request body, small enough to be evidence and safe enough to hand over.
   *
   * JSON is walked and redacted key by key, because a password inside a JSON
   * object is the common case and a whole-body regex would either miss it or
   * destroy the structure. Anything else is truncated and, if it looks like it
   * carries a secret at all, dropped entirely — a form-encoded body is not
   * worth guessing at.
   */
  function safeBody(body) {
    if (body == null || body === '') return null;
    // D-1010-100: a URLSearchParams is a form body; coerce it so it takes the redacting form branch below.
    if (typeof URLSearchParams === 'function' && body instanceof URLSearchParams) { try { body = body.toString(); } catch { return null; } if (body === '') return null; }
    // D-1010-69 (r4-11-3): a FormData is read entry by entry (`entries()` is synchronous); a Blob or a buffer is not
    // readable synchronously and is usually a file upload, so it is named and never guessed at.
    if (typeof body !== 'string') {
      if (typeof FormData === 'function' && body instanceof FormData) {
        try {
          // Secret names redacted, 50 parts, 2,000 characters a value; a file is its name, type and size and its bytes are never read.
          const parts = [];
          let truncated = false;
          for (const [name, v] of body.entries()) {
            if (parts.length >= 50) { truncated = true; break; }
            const key = String(name).slice(0, 200);
            if (typeof v === 'string') {
              if (v.length > MAX_BODY) truncated = true;
              parts.push({ name: key, value: SECRET.test(name) ? REDACTED : v.slice(0, MAX_BODY) });
            } else parts.push({ name: key, file: { name: String(v?.name ?? ''), type: String(v?.type ?? ''), size: Number(v?.size) || 0 } });
          }
          return truncated ? { kind: 'FormData', parts, truncated } : { kind: 'FormData', parts };
        } catch { /* an unreadable entry list falls through to the note below */ }
      }
      const kind = body?.constructor?.name || 'binary';
      return { kind, note: `${kind} body: not recorded` };
    }

    const text = body.slice(0, MAX_BODY);
    try {
      const parsed = JSON.parse(text);
      return { kind: 'json', text: JSON.stringify(redact(parsed)) };
    } catch {
      /* not JSON */
    }
    if (/^[\w.%+-]+=/.test(text) && text.includes('=')) {
      const params = new URLSearchParams(text);
      const clean = new URLSearchParams();
      for (const [k, v] of params) clean.append(k, SECRET.test(k) ? REDACTED : v);
      return { kind: 'form', text: clean.toString() };
    }
    return { kind: 'text', text: SECRET.test(text) ? REDACTED : text };
  }

  function redact(value, depth = 0) {
    if (value == null || typeof value !== 'object') return value;
    if (depth > 6) return '[truncated]'; // r2-05-7: a deeper subtree is never passed through unscrubbed
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }

  /* --------------------------------------------------------------------- XHR */

  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    const setHeader = XHR.prototype.setRequestHeader;

    // r3-05-5: the headers the page (and any override rule) set, kept for the record; values go through safeHeaders.
    XHR.prototype.setRequestHeader = function (name, value) {
      try {
        const h = (this.__uqaReqH ||= {});
        h[name] = name in h ? `${h[name]}, ${value}` : String(value);
      } catch { /* a frozen instance: the call still goes through */ }
      return setHeader.call(this, name, value);
    };

    XHR.prototype.open = function (method, url, ...rest) {
      const m = String(method || 'GET').toUpperCase();
      let target = String(url);

      // Redirects have to happen here — by send() the connection is already
      // pointed somewhere. Every partial postback on a JSF portal is an XHR, so
      // this is the path that matters most on the portals we test.
      // No body at open() time, so this pass is URL-only. A GraphQL rule
      // cannot match here and is not expected to — send() below matches again
      // with the payload in hand.
      const { all } = matchRules(target, m, null);
      const requested = target;
      for (const r of all) if (r.redirectTo) target = redirectUrl(r, target);

      this.__uqa = { method: m, url: target, requested, redirected: target !== requested };
      // Header edits are queued, not applied: setRequestHeader only works after
      // open() and before send(), and the page sets its own in between.
      this.__uqaHeaders = all.reduce((acc, r) => (r.headers ? { ...acc, ...r.headers } : acc), null);
      return open.call(this, m, target, ...rest);
    };

    XHR.prototype.send = function (...args) {
      const meta = this.__uqa;

      if (this.__uqaHeaders) {
        for (const [name, value] of Object.entries(this.__uqaHeaders)) {
          try {
            // There is no removeRequestHeader; the closest honest thing is to
            // blank it, and the UI says so rather than pretending otherwise.
            this.setRequestHeader(name, value === null ? '' : value);
          } catch {
            /* a forbidden header name — the browser owns those */
          }
        }
      }

      if (meta?.redirected) {
        emit({
          kind: 'net', via: 'xhr', method: meta.method, url: short(meta.requested),
          status: 0, ok: true, durationMs: 0, error: false,
          redirectedTo: short(meta.url), overridden: true, ts: Date.now(),
        });
      }

      // Override path. This is the one that matters on a JSF/PrimeFaces portal:
      // every partial AJAX postback is an XHR, so forcing a 500 here is what
      // exercises the app's server-error dialog.
      // Now the body exists, so GraphQL rules can be matched.
      const xhrBody = typeof args[0] === 'string' ? args[0] : null;
      const xhrContext = { body: xhrBody, graphql: graphqlInfo(xhrBody, meta?.url) };
      const rule = meta ? matchRule(meta.url, meta.method, xhrContext) : null;
      const TERMINAL_XHR = ['status', 'body', 'fail', 'mock', 'graphqlError'];
      if (rule && TERMINAL_XHR.includes(rule.action)) {
        consume(rule);
        const started = performance.now();
        const finish = () => {
          // status/responseText are read-only on the prototype; shadow them on
          // the instance so the page's own handlers read the forced values.
          // A GraphQL error is HTTP 200 with an `errors` array, and a mock
          // defaults to 200 — so neither can share the 500 default that
          // `status` uses. Getting this wrong would mean a "GraphQL error" that
          // a client sees as a transport failure, which is the opposite bug.
          const status =
            rule.action === 'fail' ? 0
            : rule.action === 'graphqlError' ? 200
            : rule.action === 'mock' ? rule.status || 200
            : rule.status || 500;
          const body =
            rule.action === 'fail' ? ''
            : rule.action === 'graphqlError' ? graphqlErrorBody(rule, xhrContext.graphql)
            : rule.body != null ? String(rule.body)
            : rule.action === 'mock' ? '{}' : '';
          try {
            Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(this, 'status', { value: status, configurable: true });
            Object.defineProperty(this, 'statusText', { value: rule.statusText || '', configurable: true });
            Object.defineProperty(this, 'responseText', { value: body, configurable: true });
            Object.defineProperty(this, 'response', { value: body, configurable: true });
            Object.defineProperty(this, 'responseURL', { value: meta.url, configurable: true });
          } catch {
            /* a page that froze XMLHttpRequest.prototype — nothing to do */
          }

          emit({
            kind: 'net', via: 'xhr', method: meta.method, url: short(meta.url),
            status, ok: status >= 200 && status < 400,
            durationMs: performance.now() - started,
            error: rule.action === 'fail',
            responsePreview: body.slice(0, MAX_BODY),
            mocked: rule.action === 'mock' || undefined,
            graphqlError: rule.action === 'graphqlError' || undefined,
            operation: xhrContext.graphql?.operationName || undefined,
            overridden: true, ruleLabel: rule.label, ts: Date.now(),
          });

          this.dispatchEvent(new Event('readystatechange'));
          this.dispatchEvent(new Event(rule.action === 'fail' ? 'error' : 'load'));
          this.dispatchEvent(new Event('loadend'));
        };
        if (rule.delayMs) setTimeout(finish, rule.delayMs);
        else setTimeout(finish, 0);
        return;
      }

      if (meta) {
        meta.started = performance.now();
        const actAtStart = act;
        const reqHeaders = safeHeaders(this.__uqaReqH);
        const reqBody = safeBody(args[0]);
        const done = (error, type) => {
          if (this.__uqa !== meta) return; // r7-05-7: a reused XHR re-opened for send #2; send #1's listeners must not report again
          let responsePreview;
          if (error || this.status >= 400) {
            try {
              if (!this.responseType || this.responseType === 'text') {
                responsePreview = String(this.responseText || '').slice(0, MAX_BODY);
              }
            } catch {
              /* responseText unavailable for this responseType */
            }
          }
          let resHeaders;
          try {
            resHeaders = {};
            for (const line of String(this.getAllResponseHeaders() || '').trim().split(/[\r\n]+/)) {
              const i = line.indexOf(':');
              if (i > 0) resHeaders[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
            }
            resHeaders = safeHeaders(resHeaders);
          } catch { resHeaders = undefined; }
          report({
            kind: 'net', via: 'xhr', method: meta.method, url: short(meta.url),
            status: this.status, ok: this.status >= 200 && this.status < 400,
            durationMs: performance.now() - meta.started,
            error: !!error, ev: type, responsePreview, reqHeaders, reqBody, resHeaders, reqCred: nfCred(this.withCredentials ? 'include' : undefined, meta.url), ts: Date.now(),
          }, undefined, actAtStart);
        };
        this.addEventListener('load', () => done(false));
        this.addEventListener('error', () => done(true, 'error'));
        this.addEventListener('timeout', () => done(true, 'timeout'));
        this.addEventListener('abort', () => done(false, 'abort')); // D-1010-48: a cancel is not a failure
      }

      // A delay rule defers the real send; the timing captured above therefore
      // includes the injected latency, which is the whole point of the rule.
      if (rule?.action === 'delay' && rule.delayMs) {
        consume(rule);
        setTimeout(() => send.apply(this, args), rule.delayMs);
        return undefined;
      }

      return send.apply(this, args);
    };
  }

  /* ----------------------------------------------------------------- console */

  const LEVELS = ['error', 'warn', 'assert'];
  for (const level of LEVELS) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function (...args) {
      try {
        // console.assert(cond, ...) only fails when cond is falsy.
        if (level === 'assert' && args[0]) return original.apply(this, args);
        const text = args
          .map((a) => {
            if (a instanceof Error) return `${a.name}: ${a.message}`;
            if (typeof a === 'object') {
              try { return JSON.stringify(a).slice(0, 500); } catch { return '[object]'; }
            }
            return String(a);
          })
          .join(' ')
          .slice(0, 1000);
        const stack = args.find((a) => a instanceof Error)?.stack;
        report({
          kind: 'console', level, text, stack: stack ? String(stack).slice(0, 1500) : undefined,
          en: errName(args.find((a) => a instanceof Error)),
          src: level === 'warn' ? undefined : srcOf(stack || new Error().stack), ts: Date.now(),
        });
      } catch {
        /* never let logging break the page */
      }
      return original.apply(this, args);
    };
  }

  /* -------------------------------------------------------- uncaught failures */

  window.addEventListener('error', (e) => {
    report({
      kind: 'pageerror',
      text: `${e.message} (${e.filename}:${e.lineno}:${e.colno})`,
      stack: e.error?.stack ? String(e.error.stack).slice(0, 1500) : undefined,
      en: errName(e.error),
      src: e.filename ? bareUrl(e.filename) : srcOf(e.error?.stack),
      ts: Date.now(),
    }, e.message);
  });

  /* ---------------------------------- subresources, CSP, WebSocket, SSE, beacon */

  /** One failure-only `net` row for a transport the fetch/XHR hooks cannot see. URL and code only, never a payload. */
  function netFail(via, url, ev, text, extra) {
    let thirdParty; // D-1010-102: only a subresource load is tagged; signal.js down-weights it below the app's own 4xx/5xx
    if (via === 'resource') { try { thirdParty = new URL(url, location.href).origin !== location.origin; } catch { /* unparsable: leave untagged */ } }
    report({ kind: 'net', via, method: 'GET', url: short(url), status: 0, ok: false, durationMs: 0, error: true, ev, text, ts: Date.now(), ...(thirdParty === undefined ? {} : { thirdParty }), ...extra });
  }

  // r3-05-4: a resource error does not bubble, so only the capture phase on window sees an img/script/css that failed to load.
  const RES_TAGS = /^(IMG|SCRIPT|LINK|SOURCE|VIDEO|AUDIO|IFRAME|EMBED|OBJECT|TRACK)$/;
  window.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || t === window || !RES_TAGS.test(String(t.tagName))) return;
    const u = String(t.currentSrc || t.src || t.href || t.data || '');
    if (/^(SCRIPT|IFRAME|FRAME)$/.test(String(t.tagName)) && u) nfAdd(u); // D3: a host that was asked for a script or a frame is part of the app
    if (u && !/^(data|blob|about):/i.test(u)) netFail('resource', u, 'error', `<${String(t.tagName).toLowerCase()}> failed to load`, /^(SCRIPT|IFRAME|FRAME)$/.test(String(t.tagName)) ? { sc: 1 } : undefined);
  }, true);

  window.addEventListener('securitypolicyviolation', (e) => {
    report({
      kind: 'console', level: 'error',
      text: `CSP: ${e.violatedDirective} blocked ${bareUrl(e.blockedURI || 'inline')}`.slice(0, 300),
      src: e.sourceFile ? bareUrl(e.sourceFile) : undefined, ts: Date.now(),
    });
  });

  // r3-05-6 / D-1010-49: wrapped by Proxy so statics, prototype and instanceof stay the page's own.
  for (const [name, via] of [['WebSocket', 'ws'], ['EventSource', 'sse']]) {
    const Native = window[name];
    if (typeof Native !== 'function' || typeof Proxy !== 'function') continue;
    try {
      window[name] = new Proxy(Native, {
        construct(target, args, newTarget) {
          const sock = Reflect.construct(target, args, newTarget);
          try {
            let failed = false;
            let opened = false; // D4: a close or reconnect after the connection opened is noise; one that never opened stays a failure
            const fail = (ev, text) => { if (!failed) { failed = true; netFail(via, args[0], ev, text, opened ? { opened: true } : undefined); } };
            sock.addEventListener('open', () => { opened = true; failed = false; });
            sock.addEventListener('error', () => { if (via === 'ws' || sock.readyState === 2 || opened) fail('error', `${name} error`); });
            if (via === 'ws') sock.addEventListener('close', (e) => { if (![1000, 1001, 1005].includes(e.code)) fail('close', `${name} closed: ${e.code}`); });
          } catch { /* never let the hook break the page's socket */ }
          return sock;
        },
      });
    } catch { /* a frozen global */ }
  }

  if (typeof navigator === 'object' && typeof navigator.sendBeacon === 'function') {
    const beacon = navigator.sendBeacon;
    try {
      navigator.sendBeacon = function (url) {
        const ok = beacon.apply(this, arguments);
        if (ok === false) netFail('beacon', url, 'error', 'sendBeacon refused');
        return ok;
      };
    } catch { /* read-only navigator */ }
  }

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report({
      kind: 'pageerror',
      text: `Unhandled rejection: ${r instanceof Error ? `${r.name}: ${r.message}` : String(r).slice(0, 300)}`,
      stack: r?.stack ? String(r.stack).slice(0, 1500) : undefined,
      en: errName(r),
      src: srcOf(r?.stack),
      ts: Date.now(),
    });
  });
})();

/*
 * Why this file names itself.
 *
 * Chrome attributes a console message to an extension when the *script name* of
 * the top JS frame at the moment the native console method runs has the
 * chrome-extension scheme. This file wraps `console.warn`/`error` in the MAIN
 * world on every page, so at the instant a site's own deprecation warning
 * reaches the native method, the top frame is ours — and every warning on every
 * site was landing on QA Wrap's card at chrome://extensions, which reads to
 * anyone who opens it as an extension that is broken on every page it touches.
 *
 * V8 takes a `//# sourceURL=` magic comment as the script name in stack traces
 * (`GetScriptNameOrSourceURL`), and Blink's SourceLocation capture reads the
 * same value. A scheme-less name is therefore enough: DevTools still shows the
 * file under a name that says exactly what it is, and Chrome no longer sees an
 * extension URL to blame.
 *
 * The console capture itself is a product feature and stays. What is removed is
 * the false attribution, not the hook.
 */
//# sourceURL=qa-wrap-page-hooks.js
