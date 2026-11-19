/* GastAr — Vista previa SIN Firebase (se activa solo con ?demo en la dirección).
   Simula login y base de datos en memoria con datos de ejemplo. Nada se guarda: al recargar vuelve todo al inicio. */
(function(){
  if (!/[?&]demo(=|&|$)/.test(location.search)) return;
  class Ts { constructor(ms){ this.ms = ms; } toMillis(){ return this.ms; } toDate(){ return new Date(this.ms); } static fromMillis(ms){ return new Ts(ms); } static now(){ return new Ts(Date.now()); } }
  const SERVER = {s: 1}, DEL = {d: 1};
  const FV = {serverTimestamp: () => SERVER, delete: () => DEL, arrayUnion: (...a) => ({au: a}), arrayRemove: (...a) => ({ar: a}), increment: n => ({inc: n})};
  const cl = v => { if (v instanceof Ts) return v; if (Array.isArray(v)) return v.map(cl); if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = cl(v[k]); return o; } return v; };
  const store = new Map(), subs = new Set();
  const notify = () => setTimeout(() => subs.forEach(f => f()), 0);
  const val = (old, v) => {
    if (v === SERVER) return Ts.now();
    if (v && v.au) return (Array.isArray(old) ? old : []).concat(v.au.filter(x => !(old || []).includes(x)));
    if (v && v.ar) return (Array.isArray(old) ? old : []).filter(x => !v.ar.includes(x));
    if (v && v.inc != null) return (Number(old) || 0) + v.inc;
    return cl(v);
  };
  const setDeep = (o, key, v) => {
    const p = key.split('.'); let t = o;
    for (let i = 0; i < p.length - 1; i++) { if (!t[p[i]] || typeof t[p[i]] !== 'object') { if (v === DEL) return; t[p[i]] = {}; } t = t[p[i]]; }
    const k = p[p.length - 1];
    if (v === DEL) delete t[k]; else t[k] = val(t[k], v);
  };
  const write = (path, data, mode) => {
    const old = store.get(path);
    if (mode === 'update' && !old) { const e = new Error('No existe'); e.code = 'not-found'; throw e; }
    const o = mode === 'set' ? {} : cl(old || {});
    for (const k in data) setDeep(o, k, data[k]);
    store.set(path, o);
  };
  const kids = p => [...store.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).sort();
  const snapDoc = path => { const d = store.get(path); return {exists: !!d, id: path.split('/').pop(), ref: docRef(path), data: () => d ? cl(d) : undefined}; };
  const snapCol = (path, filt) => ({docs: kids(path).map(snapDoc).filter(filt || (() => true)), get size(){ return this.docs.length; }, forEach(f){ this.docs.forEach(f); }});
  const listen = (mk, cb) => { const run = () => cb(mk()); subs.add(run); setTimeout(run, 0); return () => subs.delete(run); };
  let n = 0; const newId = () => 'd' + Date.now().toString(36) + (n++);
  function docRef(path){
    return {id: path.split('/').pop(), path,
      collection: name => colRef(path + '/' + name),
      get: async () => snapDoc(path),
      set: async (d, o) => { write(path, d, o && o.merge ? 'merge' : 'set'); notify(); },
      update: async d => { write(path, d, 'update'); notify(); },
      delete: async () => { store.delete(path); notify(); },
      onSnapshot: (cb) => listen(() => snapDoc(path), cb)};
  }
  function colRef(path, filt){
    return {id: path.split('/').pop(), path,
      doc: id => docRef(path + '/' + (id || newId())),
      add: async d => { const id = newId(); write(path + '/' + id, d, 'set'); notify(); return docRef(path + '/' + id); },
      where: (f, op, v) => colRef(path, d => op === '==' && d.data()[f] === v),
      get: async () => snapCol(path, filt),
      onSnapshot: (cb) => listen(() => snapCol(path, filt), cb)};
  }
  const db = {
    collection: p => colRef(p), enablePersistence: () => Promise.resolve(),
    batch: () => { const ops = []; return {
      set(r, d, o){ ops.push(() => write(r.path, d, o && o.merge ? 'merge' : 'set')); },
      update(r, d){ ops.push(() => write(r.path, d, 'update')); },
      delete(r){ ops.push(() => store.delete(r.path)); },
      commit: async () => { ops.forEach(f => f()); notify(); } }; }
  };
  /* Datos de ejemplo */
  const hoy = new Date(), ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const cur = ym(hoy), prox = ym(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1));
  store.set('admins/demo', {activo: true});
  store.set('usuarios/demo', {hogarId: 'hdemo'});
  store.set('invitaciones/DEMO2345', {hogarId: 'hdemo', ownerUid: 'demo'});
  store.set('hogares/hdemo', {nombre: 'Casa de Ruben', ownerUid: 'demo', ownerEmail: 'demo@gastar.app', miembros: ['demo'],
    integrantes: {demo: {nombre: 'Ruben (demo)', email: 'demo@gastar.app'}}, codigoActual: 'DEMO2345', limiteIntegrantes: 5,
    demoHasta: Ts.fromMillis(Date.now() + 14 * 86400000), creado: Ts.now(), version: 1});
  const G = [
    ['Tarjeta Visa', 'deudas', 184500, 'ARS', -3, 920000], ['Expensas', 'hogar', 92000, 'ARS', -1], ['Luz', 'servicios', 38400, 'ARS', 1],
    ['Gas', 'servicios', 21700, 'ARS', 2], ['Internet y cable', 'servicios', 28900, 'ARS', 4], ['Alquiler', 'hogar', 450000, 'ARS', 6],
    ['Netflix', 'suscripciones', 8.99, 'USD', 9], ['Seguro del auto', 'seguros', 61000, 'ARS', 12], ['Cuota colegio', 'educacion', 210000, 'ARS', 16],
    ['Monotributo', 'impuestos', 42000, 'ARS', 20], ['Agua', 'servicios', 15800, 'ARS', -5, null, true], ['Celular', 'servicios', 19900, 'ARS', -6, null, true]
  ];
  G.forEach((g, i) => {
    const id = 'g' + i, f = new Date(hoy.getTime() + g[4] * 86400000);
    const doc = {nombre: g[0], categoria: g[1], monto: g[2], moneda: g[3], tipo: 'fijo', dia: f.getDate(), nota: '', desdeMes: ym(f) === cur ? cur : prox, creado: Ts.now(), creadoPor: 'demo'};
    if (g[5]) doc.saldo = g[5];
    doc.importancia = ['Netflix', 'Cuota colegio'].includes(g[0]) ? 'opcional' : (g[0] === 'Celular' ? 'innecesario' : 'esencial');
    store.set('hogares/hdemo/gastos/' + id, doc);
    if (g[6]) store.set('hogares/hdemo/pagos/' + id + '_' + cur, {gastoId: id, nombreGasto: g[0], mes: cur, fecha: cur + '-' + String(Math.max(1, f.getDate())).padStart(2, '0'), monto: g[2], moneda: g[3], porUid: 'demo', porNombre: 'Ruben', ts: Ts.now()});
  });
  /* Login simulado */
  const user = {uid: 'demo', email: 'rgaraventa@gmail.com', displayName: 'Ruben (demo)'};
  let cu = null; const ls = new Set();
  const fire = () => ls.forEach(f => setTimeout(() => f(cu), 0));
  const authObj = {get currentUser(){ return cu; },
    onAuthStateChanged: f => { ls.add(f); setTimeout(() => f(cu), 400); return () => ls.delete(f); },
    signInWithPopup: async () => { cu = user; fire(); return {user}; },
    signOut: async () => { cu = null; fire(); }};
  const auth = () => authObj; auth.GoogleAuthProvider = function(){};
  const firestore = () => db; firestore.FieldValue = FV; firestore.Timestamp = Ts;
  const messaging = () => ({}); messaging.isSupported = () => false;
  window.firebase = {initializeApp(){}, auth, firestore, messaging};
  window.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div');
    b.textContent = 'VISTA PREVIA · datos de ejemplo, no se guarda nada';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b45309;color:#fff;font:700 12px system-ui;text-align:center;padding:3px;pointer-events:none';
    document.body.appendChild(b);
  });
})();
