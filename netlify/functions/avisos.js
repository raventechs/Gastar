/*
  GastAr — Función de avisos de vencimientos (Netlify) v1.0.0 · 2026-11-18
  Se dispara desde cron-job.org (una vez por día a la mañana, o cada hora: no duplica avisos).
  URL: https://<tu-sitio>.netlify.app/.netlify/functions/avisos?key=<CRON_KEY>
  Variables de entorno en Netlify:
    FIREBASE_SERVICE_ACCOUNT_B64  clave de cuenta de servicio de Firebase, en base64 (como en SaludAR)
    CRON_KEY                      una clave larga inventada por vos, para que nadie más pueda disparar la función
    APP_URL                       (opcional) https://gastar.raventechsapp.com
  Avisa: 3 días antes, 1 día antes, el mismo día y 1 día después (vencido). Cada aviso se manda una sola vez
  por vencimiento (queda registrado en hogares/{id}/avisos). Solo envía entre las 8 y las 21 hs de Argentina.
*/

const TZ = 'America/Argentina/Buenos_Aires';

/* ───────── Lógica pura (se prueba sin Firebase) ───────── */
const pad = n => String(n).padStart(2, '0');
function partesArgentina(fecha) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = {};
  fmt.formatToParts(fecha || new Date()).forEach(x => { p[x.type] = x.value; });
  if (p.hour === '24') p.hour = '00';
  return p;
}
const addMonths = (ym, n) => { let [y, m] = ym.split('-').map(Number); m = m - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad(m + 1); };
const dim = (y, m) => new Date(y, m, 0).getDate();
const diffDays = (a, b) => { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000); };
function fechaDe(g, ym) {
  if (g.tipo === 'unico') return (g.fecha && g.fecha.slice(0, 7) === ym) ? g.fecha : null;
  if (g.desdeMes && ym < g.desdeMes) return null;
  if (g.hastaMes && ym > g.hastaMes) return null;
  const [y, m] = ym.split('-').map(Number);
  return ym + '-' + pad(Math.min(Number(g.dia) || 1, dim(y, m)));
}
const clave = (g, ym) => g.tipo === 'unico' ? g.id + '_u' : g.id + '_' + ym;

/* Devuelve los avisos que corresponden hoy: [{tipo, key, g, fecha}] — sin los ya enviados ni los pagados. */
function calcularAvisos(gastos, pagadas /* Set de claves */, enviados /* Set de claves_tipo */, hoy) {
  const cur = hoy.slice(0, 7);
  const meses = [addMonths(cur, -1), cur, addMonths(cur, 1)];
  const out = [];
  const tipoDe = d => d === 3 ? 'd3' : d === 1 ? 'd1' : d === 0 ? 'd0' : d === -1 ? 'v1' : null;
  for (const g of gastos) {
    const ocs = g.tipo === 'unico' ? (g.fecha ? [[g.fecha.slice(0, 7), g.fecha]] : []) : meses.map(ym => [ym, fechaDe(g, ym)]).filter(x => x[1]);
    for (const [ym, fecha] of ocs) {
      const key = clave(g, ym);
      if (pagadas.has(key)) continue;
      const tipo = tipoDe(diffDays(fecha, hoy));
      if (!tipo || enviados.has(key + '_' + tipo)) continue;
      out.push({ tipo, key, g, fecha });
    }
  }
  return out;
}
const fmtMonto = (n, cur) => (cur === 'USD' ? 'US$ ' : '$ ') + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const TITULOS = { d3: '📅 Vence en 3 días', d1: '⏰ Vence mañana', d0: '🔴 Vence hoy', v1: '⚠️ Quedó vencido' };
function armarMensaje(tipo, items) {
  const partes = items.slice(0, 4).map(o => o.g.nombre + ' ' + fmtMonto(o.g.monto, o.g.moneda));
  if (items.length > 4) partes.push('y ' + (items.length - 4) + ' más');
  return { title: TITULOS[tipo], body: partes.join(' · ') };
}

/* ───────── Servidor ───────── */
let _admin = null;
function fb() {
  if (_admin) return _admin;
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_B64 || '').replace(/\s/g, '');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))) });
  }
  _admin = admin;
  return admin;
}

exports.handler = async (event) => {
  const key = (event.queryStringParameters || {}).key;
  if (!process.env.CRON_KEY || key !== process.env.CRON_KEY) return { statusCode: 401, body: 'no autorizado' };
  const p = partesArgentina();
  const hoy = p.year + '-' + p.month + '-' + p.day, hora = parseInt(p.hour, 10);
  if (hora < 8 || hora >= 21) return { statusCode: 200, body: JSON.stringify({ ok: true, omitido: 'fuera de horario', hoy, hora }) };

  const admin = fb(), db = admin.firestore();
  const appUrl = process.env.APP_URL || 'https://gastar.raventechsapp.com';
  const resumen = { hoy, hogares: 0, avisosEnviados: 0, tokensLimpiados: 0 };
  try {
    const hogares = await db.collection('hogares').get();
    for (const hd of hogares.docs) {
      const h = hd.data();
      if (h.demoHasta && h.demoHasta.toMillis() < Date.now()) continue; // prueba vencida: no se avisa
      resumen.hogares++;
      const [gs, ps, avs] = await Promise.all([hd.ref.collection('gastos').get(), hd.ref.collection('pagos').get(), hd.ref.collection('avisos').get()]);
      const gastos = gs.docs.map(d => Object.assign({ id: d.id }, d.data()));
      const pendientes = calcularAvisos(gastos, new Set(ps.docs.map(d => d.id)), new Set(avs.docs.map(d => d.id)), hoy);
      if (!pendientes.length) continue;

      // Tokens de todos los integrantes del hogar
      const usuarios = await Promise.all((h.miembros || []).map(uid => db.collection('usuarios').doc(uid).get()));
      const tokens = [];
      usuarios.forEach(u => { if (u.exists) (u.data().fcmTokens || []).forEach(t => tokens.push({ uid: u.id, t })); });
      if (!tokens.length) continue;

      const porTipo = {};
      pendientes.forEach(o => (porTipo[o.tipo] = porTipo[o.tipo] || []).push(o));
      for (const tipo of Object.keys(porTipo)) {
        const m = armarMensaje(tipo, porTipo[tipo]);
        let ok = 0;
        for (const { uid, t } of tokens) {
          try {
            await admin.messaging().send({ token: t, notification: { title: m.title, body: m.body }, webpush: { fcmOptions: { link: appUrl } } });
            ok++;
          } catch (e) {
            if (e.code === 'messaging/registration-token-not-registered' || e.code === 'messaging/invalid-registration-token' || e.code === 'messaging/invalid-argument') {
              await db.collection('usuarios').doc(uid).update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(t) }).catch(() => {});
              resumen.tokensLimpiados++;
            } else console.error('Error enviando aviso:', e.code || e.message);
          }
        }
        if (ok > 0) {
          const b = db.batch();
          porTipo[tipo].forEach(o => b.set(hd.ref.collection('avisos').doc(o.key + '_' + tipo), { ts: admin.firestore.FieldValue.serverTimestamp(), tipo, nombre: o.g.nombre }));
          await b.commit();
          resumen.avisosEnviados += porTipo[tipo].length;
        }
      }
    }
    return { statusCode: 200, body: JSON.stringify(Object.assign({ ok: true }, resumen)) };
  } catch (e) {
    console.error('Error en avisos:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

exports._test = { calcularAvisos, armarMensaje, fechaDe, diffDays, partesArgentina };
