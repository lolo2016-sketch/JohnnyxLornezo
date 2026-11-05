import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, arrayUnion, arrayRemove, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import * as U from './util.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const esc = U.esc;

if (!firebaseConfig || String(firebaseConfig.apiKey).startsWith('DEIN')) {
  $app.innerHTML = `<div class="auth"><div class="card"><h2>Fast fertig 🔧</h2>
    <p>Trage zuerst deine Firebase-Konfiguration in <code>config.js</code> ein – die Anleitung steht in der README.</p></div></div>`;
  throw new Error('Firebase-Konfiguration fehlt');
}

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
let db;
try {
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  db = initializeFirestore(fbApp, {});
}

/* ------------------------------------------------------------------ State */
const S = {
  user: null, cid: null, couple: null, partnerUid: null,
  logs: {}, supps: [], suppLogs: {}, rewards: [], feed: [], unsub: [],
  view: localStorage.getItem('zw_view') || 'today',
  date: U.today(), lastToday: U.today(),
  pendingPost: null, pendingRewardImg: null, modalOpen: false, installEvt: null
};
if (!['today', 'rewards', 'feed'].includes(S.view)) S.view = 'today';

const uid = () => S.user?.uid;
const col = name => collection(db, 'couples', S.cid, name);
const W = p => Promise.resolve(p).catch(e => { console.error(e); toast('Fehler: ' + (e.code || e.message)); });

const METRICS = {
  uni: { label: 'Uni', emoji: '📚' },
  home: { label: 'Haushalt', emoji: '🧺' },
  total: { label: 'Uni + Haushalt', emoji: '⏱️' },
  supps: { label: 'Supplements', emoji: '💊' }
};
// Eure Fotos (liegen als foto-1.jpg … im Repo). Bildunterschriften hier einfach ändern.
const PHOTOS = [
  { src: 'foto-1.jpg', cap: 'Abende zu zweit ✨' },
  { src: 'foto-2.jpg', cap: 'Abenteuer im Regen ⛰️' },
  { src: 'foto-3.jpg', cap: 'Wellness-Abend 💜💚' },
  { src: 'foto-4.jpg', cap: 'Sommer im Pool ☀️' },
  { src: 'foto-5.jpg', cap: 'Zwischen Blüten 🌺' },
  { src: 'foto-6.jpg', cap: 'Ein Küsschen für unterwegs 😘' },
  { src: 'foto-7.jpg', cap: 'Am Meer 🌊' },
  { src: 'foto-8.jpg', cap: 'Love Calculator sagt: 100 % ❤️' }
];
const photoOfDay = () => Math.floor(Date.now() / 864e5) % PHOTOS.length;

const DEF_PROFILE ={ name: '?', emoji: '🙂', goalUni: 120, goalHome: 30 };
const prof = u => ({ ...DEF_PROFILE, ...(S.couple?.profiles?.[u] || {}) });
const goalOf = (u, m) => m === 'uni' ? prof(u).goalUni : m === 'home' ? prof(u).goalHome : prof(u).goalUni + prof(u).goalHome;
const myName = () => auth.currentUser?.displayName || 'Ich';

/* -------------------------------------------------------- Berechnungen */
const getLog = (u, d) => S.logs[`${u}_${d}`] || {};
function minutes(u, m, d) {
  const l = getLog(u, d);
  return m === 'total' ? (l.uni || 0) + (l.home || 0) : (l[m] || 0);
}
function dueSupps(u, d) {
  const wd = U.weekday(d);
  return S.supps.filter(s => s.uid === u && (s.days || [0, 1, 2, 3, 4, 5, 6]).includes(wd) && (!s.createdDate || s.createdDate <= d));
}
const taken = (u, d, id) => S.suppLogs[`${u}_${d}`]?.taken?.[id] || 0;
function suppStatus(u, d) {
  const due = dueSupps(u, d);
  if (!due.length) return null;
  const done = due.filter(s => taken(u, d, s.id) >= s.times).length;
  return { done, total: due.length, ok: done === due.length };
}
// true = geschafft, false = nicht geschafft, null = zählt nicht (z. B. keine Supplements fällig)
function dayOk(u, m, d, min) {
  if (m === 'supps') { const st = suppStatus(u, d); return st ? st.ok : null; }
  return minutes(u, m, d) >= Math.max(1, min || 1);
}
// Aktuelle Serie. Heute zählt mit, sobald geschafft – ist heute noch offen, bleibt die Serie von gestern bestehen.
function streak(u, m, min, since) {
  let d = U.today(), n = 0;
  if (dayOk(u, m, d, min) === true) n++;
  d = U.addDays(d, -1);
  for (let i = 0; i < 400; i++, d = U.addDays(d, -1)) {
    if (since && d < since) break;
    const ok = dayOk(u, m, d, min);
    if (ok === null) continue;
    if (!ok) break;
    n++;
  }
  return n;
}
function weekMinutes(u) {
  let s = 0;
  for (let d = U.mondayOf(U.today()); d <= U.today(); d = U.addDays(d, 1)) s += minutes(u, 'total', d);
  return s;
}
function condText(r) {
  const t = `${r.days} ${r.days === 1 ? 'Tag' : 'Tage'} in Folge`;
  return r.metric === 'supps' ? `${t} alle Supplements` : `${t} mind. ${U.fmtMin(r.min)} ${METRICS[r.metric].label}`;
}
function daysText(days = []) {
  if (days.length === 7) return 'jeden Tag';
  return [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d)).map(d => U.WD[d]).join(', ');
}

/* ------------------------------------------------------------ Icons */
const ico = p => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const IC = {
  home: ico('<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  gift: ico('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5"/>'),
  msg: ico('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>'),
  gear: ico('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>')
};

/* ------------------------------------------------------------ Auth */
onAuthStateChanged(auth, async user => {
  stopListeners();
  S.user = user;
  if (!user) return renderAuth('login');
  $app.innerHTML = '<div class="spinner"></div>';
  try {
    const us = await getDoc(doc(db, 'users', user.uid));
    const cid = us.exists() ? us.data().coupleId : null;
    cid ? startCouple(cid) : renderPair();
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="auth"><div class="card"><h2>Verbindungsproblem 😕</h2>
      <p class="muted">${esc(e.code || e.message)}</p><button class="btn primary" onclick="location.reload()">Nochmal versuchen</button></div></div>`;
  }
});

function authMsg(code) {
  return ({
    'auth/invalid-credential': 'E-Mail oder Passwort stimmt nicht.',
    'auth/wrong-password': 'E-Mail oder Passwort stimmt nicht.',
    'auth/user-not-found': 'Zu dieser E-Mail gibt es kein Konto.',
    'auth/email-already-in-use': 'Diese E-Mail ist schon registriert – einfach einloggen.',
    'auth/weak-password': 'Das Passwort braucht mindestens 6 Zeichen.',
    'auth/invalid-email': 'Die E-Mail-Adresse sieht ungültig aus.',
    'auth/too-many-requests': 'Zu viele Versuche – bitte kurz warten.',
    'auth/operation-not-allowed': 'E-Mail-Login ist in Firebase noch nicht aktiviert (siehe README).',
    'auth/configuration-not-found': 'E-Mail-Login ist in Firebase noch nicht aktiviert (siehe README).',
    'auth/unauthorized-domain': 'Diese Domain ist in Firebase noch nicht freigegeben (siehe README).',
    'auth/network-request-failed': 'Keine Internetverbindung.'
  })[code] || `Das hat nicht geklappt (${code}).`;
}

function renderAuth(mode) {
  const reg = mode === 'register';
  $app.innerHTML = `<div class="auth">
    <div class="brand">
      <img class="brand-icon" src="icon-192.png" alt="">
      <h1>Zweisam</h1>
      <p>Gemeinsam dranbleiben – Uni, Haushalt, Supplements und kleine Belohnungen füreinander.</p></div>
    <form class="card" data-form="auth" data-mode="${mode}">
      ${reg ? '<label>Dein Name<input name="uname" required maxlength="30" autocomplete="given-name"></label>' : ''}
      <label>E-Mail<input name="email" type="email" required autocomplete="email"></label>
      <label>Passwort<input name="pw" type="password" required minlength="6" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
      <button class="btn primary big full">${reg ? 'Konto erstellen' : 'Einloggen'}</button>
      <p class="err" id="authErr"></p>
      <div class="auth-links">
        <button type="button" class="link" data-a="authMode" data-mode="${reg ? 'login' : 'register'}">${reg ? 'Schon ein Konto? Einloggen' : 'Noch kein Konto? Registrieren'}</button>
        ${reg ? '' : '<button type="button" class="link muted-link" data-a="forgot">Passwort vergessen?</button>'}
      </div>
    </form></div>`;
}

function renderPair() {
  $app.innerHTML = `<div class="auth"><div class="card">
    <div class="center big-emoji">💞</div>
    <h2 class="center">Verbindet euch</h2>
    <p class="muted center">Eine:r von euch erstellt einen gemeinsamen Raum, die andere Person tritt mit dem Code bei.</p>
    <button data-a="createCouple" class="btn primary big full">Neuen Raum erstellen</button>
    <div class="or">oder</div>
    <form data-form="join">
      <label>Code deines Schatzes<input name="code" required placeholder="z. B. K7P2QX9M" autocapitalize="characters" autocomplete="off"></label>
      <button class="btn big full">Beitreten</button>
    </form>
    <p class="err" id="pairErr"></p>
    <div class="center"><button class="link muted-link" data-a="logout">Abmelden</button></div>
  </div></div>`;
}

/* ------------------------------------------------------ Datenabos */
function stopListeners() { S.unsub.forEach(f => f()); S.unsub = []; S.couple = null; }

function startCouple(cid) {
  stopListeners();
  S.cid = cid;
  const since = U.addDays(U.today(), -400);
  const onErr = e => {
    console.error(e);
    if (e.code === 'permission-denied' && !S.couple) renderPair();
    else toast('Sync-Fehler: ' + (e.code || e.message));
  };
  S.unsub.push(onSnapshot(doc(db, 'couples', cid), snap => {
    if (!snap.exists()) return renderPair();
    S.couple = snap.data();
    S.partnerUid = (S.couple.members || []).find(m => m !== uid()) || null;
    schedule();
  }, onErr));
  S.unsub.push(onSnapshot(query(col('logs'), where('date', '>=', since)), snap => {
    S.logs = {}; snap.forEach(d => { S.logs[d.id] = d.data(); }); schedule();
  }, onErr));
  S.unsub.push(onSnapshot(query(col('suppLogs'), where('date', '>=', since)), snap => {
    S.suppLogs = {}; snap.forEach(d => { S.suppLogs[d.id] = d.data(); }); schedule();
  }, onErr));
  S.unsub.push(onSnapshot(col('supplements'), snap => {
    S.supps = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => U.tsMs(a.createdAt) - U.tsMs(b.createdAt));
    schedule();
  }, onErr));
  S.unsub.push(onSnapshot(col('rewards'), snap => {
    S.rewards = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    schedule();
  }, onErr));
  S.unsub.push(onSnapshot(query(col('feed'), orderBy('createdAt', 'desc'), limit(40)), snap => {
    S.feed = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    schedule();
  }, onErr));
}

let rq = 0;
function schedule() {
  if (rq) return;
  rq = requestAnimationFrame(() => {
    rq = 0;
    if (S.couple) { renderMain(); checkRewards(); }
  });
}

/* ------------------------------------------------------------ Layout */
function saveKeep() {
  const out = {};
  document.querySelectorAll('[data-keep]').forEach(el => {
    out[el.id] = { v: el.value, f: document.activeElement === el, s: el.selectionStart };
  });
  document.querySelectorAll('[data-keep-scroll]').forEach(el => { out[el.id] = { scroll: el.scrollLeft }; });
  return out;
}
function restoreKeep(k) {
  for (const id in k) {
    const el = document.getElementById(id);
    if (!el) continue;
    if ('scroll' in k[id]) { el.scrollLeft = k[id].scroll; continue; }
    el.value = k[id].v;
    if (k[id].f) { el.focus(); try { el.setSelectionRange(k[id].s, k[id].s); } catch { } }
  }
}

function unreadCount() {
  const seen = +localStorage.getItem('zw_feedSeen_' + uid()) || 0;
  return S.feed.filter(f => f.uid !== uid() && U.tsMs(f.createdAt) > seen).length;
}

function renderMain() {
  const keep = saveKeep();
  const me = uid(), p = S.partnerUid;
  if (S.view === 'feed') localStorage.setItem('zw_feedSeen_' + me, Date.now());
  const unread = unreadCount();
  const newRewards = S.rewards.some(r => r.to === me && r.unlocked && !r.seen);
  const tabs = [['today', 'Heute', IC.home, false], ['rewards', 'Belohnungen', IC.gift, newRewards], ['feed', 'Pinnwand', IC.msg, unread > 0]];
  $app.innerHTML = `
    <header class="top">
      <div class="top-left">
        <div class="avatar sm me-bg">${esc(prof(me).emoji)}</div>
        <div><div class="hello">Hi ${esc(prof(me).name)}</div>
        <div class="sub">${p ? `zusammen mit ${esc(prof(p).name)} ${esc(prof(p).emoji)}` : 'Warte auf deinen Schatz …'}</div></div>
      </div>
      <button class="icon-btn" data-a="settings" aria-label="Einstellungen">${IC.gear}</button>
    </header>
    <main id="view" class="view-${S.view}">${({ today: vToday, rewards: vRewards, feed: vFeed })[S.view]()}</main>
    <nav class="tabs">${tabs.map(([k, l, ic, dot]) =>
      `<button class="tab ${S.view === k ? 'on' : ''}" data-a="tab" data-v="${k}">${ic}<span>${l}</span>${dot ? '<i class="badge"></i>' : ''}</button>`).join('')}</nav>`;
  restoreKeep(keep);
  tick();
  try { unread ? navigator.setAppBadge?.(unread) : navigator.clearAppBadge?.(); } catch { }
}

/* ------------------------------------------------------------ Heute */
function vToday() {
  return `${moments()}${dateNav()}${forYou()}${S.partnerUid ? duoCard() : inviteCard()}
    ${timeCard('uni')}${timeCard('home')}${suppCard()}
    ${S.partnerUid ? partnerCard() : ''}${upcomingRewards()}`;
}

function moments() {
  const start = photoOfDay();
  const order = PHOTOS.map((_, i) => (start + i) % PHOTOS.length);
  return `<section class="moments-wrap">
    <div class="moments-head"><h3>📸 Unsere Momente</h3><span class="muted small">wischen →</span></div>
    <div class="moments" id="moments" data-keep-scroll>
      ${order.map((i, n) => `<button class="moment" data-a="openPhoto" data-i="${i}" style="--r:${[-2.5, 1.8, -1.2, 2.4, -1.8, 1.2][n % 6]}deg">
        <img src="${PHOTOS[i].src}" alt="${esc(PHOTOS[i].cap)}" loading="${n < 2 ? 'eager' : 'lazy'}">
        <span>${esc(PHOTOS[i].cap)}</span></button>`).join('')}
    </div>
  </section>`;
}

function dateNav() {
  const t = U.today();
  return `<div class="datenav">
    <button class="icon-btn" data-a="day" data-d="-1" aria-label="Vorheriger Tag">‹</button>
    <div class="date-label">${U.prettyDate(S.date)}${S.date !== t ? ' <button class="chip small" data-a="goToday">zu heute</button>' : ''}</div>
    <button class="icon-btn" data-a="day" data-d="1" ${S.date >= t ? 'disabled' : ''} aria-label="Nächster Tag">›</button>
  </div>`;
}

function feedText(f) {
  const n = prof(f.uid).name;
  switch (f.type) {
    case 'nudge': return `👉 ${n} stupst ${f.uid === uid() ? prof(S.partnerUid).name : 'dich'} an – auf geht's!`;
    case 'unlock': return `🎉 ${n} hat „${f.text}“ freigeschaltet!`;
    case 'newReward': return `🎁 ${n} hat eine neue Belohnung eingerichtet: „${f.text}“`;
    default: return f.text || '';
  }
}

function forYou() {
  const p = S.partnerUid;
  if (!p) return '';
  const it = S.feed.find(f => f.uid === p && ['image', 'note', 'nudge'].includes(f.type));
  if (!it || Date.now() - U.tsMs(it.createdAt) > 3 * 864e5) return '';
  return `<section class="card foryou">
    <div class="foryou-head">💌 Von ${esc(prof(p).name)} <span class="muted">· ${U.relTime(it.createdAt)}</span></div>
    ${it.image ? `<img class="polaroid" src="${it.image}" data-a="openImg" data-id="${it.id}" alt="Bild von ${esc(prof(p).name)}">` : ''}
    ${feedText(it) ? `<p class="foryou-text">${esc(feedText(it))}</p>` : ''}
    <button class="link" data-a="tab" data-v="feed">Zur Pinnwand →</button>
  </section>`;
}

function inviteCard() {
  return `<section class="card invite">
    <h3>Lade deinen Schatz ein 💌</h3>
    <p class="muted small">Sie/er registriert sich in der App und gibt diesen Code ein:</p>
    <div class="code">${esc(S.cid)}</div>
    <button class="btn primary full" data-a="shareCode">Code teilen</button>
  </section>`;
}

function person(u, cls) {
  const pr = prof(u);
  return `<div class="person ${cls}">
    <div class="avatar">${esc(pr.emoji)}</div>
    <div class="pname">${esc(pr.name)}</div>
    <div class="flames">
      <span title="Uni-Serie">📚 ${streak(u, 'uni', pr.goalUni)}</span>
      <span title="Haushalt-Serie">🧺 ${streak(u, 'home', pr.goalHome)}</span>
      <span title="Supplement-Serie">💊 ${streak(u, 'supps')}</span>
    </div>
  </div>`;
}

function duoCard() {
  const me = uid(), p = S.partnerUid;
  const a = weekMinutes(me), b = weekMinutes(p);
  const goal = Math.max(1, (S.couple.weeklyGoal || 30) * 60);
  const pa = Math.min(100, a / goal * 100), pb = Math.min(100 - pa, b / goal * 100);
  const done = a + b >= goal;
  return `<section class="card duo">
    <div class="duo-grid">${person(me, 'me')}${person(p, 'you')}</div>
    <p class="muted small center streak-hint">🔥 Tage in Folge mit erreichtem Tagesziel</p>
    <div class="weekgoal">
      <div class="wg-head"><span>🎯 Gemeinsames Wochenziel ${done ? '– geschafft! 🥳' : ''}</span><b>${U.fmtShort(a + b)} / ${U.fmtShort(goal)}</b></div>
      <div class="bar"><span class="me" style="width:${pa}%"></span><span class="you" style="width:${pb}%"></span></div>
      <div class="legend"><span><i class="me"></i>${esc(prof(me).name)} ${U.fmtShort(a)}</span><span><i class="you"></i>${esc(prof(p).name)} ${U.fmtShort(b)}</span></div>
    </div>
  </section>`;
}

function ring(frac) {
  const r = 32, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
  return `<svg class="ring" viewBox="0 0 76 76"><circle cx="38" cy="38" r="${r}" class="ring-bg"/>
    <circle cx="38" cy="38" r="${r}" class="ring-fg ${f >= 1 ? 'done' : ''}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - f)).toFixed(1)}"/></svg>`;
}

const timerKey = cat => `zw_timer_${uid()}_${cat}`;

function timeCard(cat) {
  const me = uid(), v = minutes(me, cat, S.date), goal = goalOf(me, cat);
  const st = streak(me, cat, goal);
  const isToday = S.date === U.today();
  const run = localStorage.getItem(timerKey(cat));
  return `<section class="card time">
    <div class="time-row">
      <div class="ring-wrap">${ring(v / goal)}<span class="ring-emoji">${METRICS[cat].emoji}</span></div>
      <div class="grow">
        <div class="label">${cat === 'home' ? 'Haushalt & Co.' : 'Uni'}</div>
        <div class="big">${U.fmtMin(v)}</div>
        <div class="muted small">Ziel ${U.fmtMin(goal)} · 🔥 ${st} ${st === 1 ? 'Tag' : 'Tage'}</div>
      </div>
      <button class="icon-btn" data-a="editTime" data-cat="${cat}" aria-label="Zeit genau eintragen">✎</button>
    </div>
    <div class="quick">${[-15, 15, 30, 60].map(x =>
      `<button class="qbtn ${x < 0 ? 'minus' : ''}" data-a="addTime" data-cat="${cat}" data-m="${x}">${x > 0 ? '+' : '−'}${Math.abs(x)}</button>`).join('')}</div>
    ${isToday || run ? `<button class="timer ${run ? 'on' : ''}" data-a="timer" data-cat="${cat}">${run
      ? `⏹ Stoppen & eintragen · <span class="tick" data-start="${run}">0:00</span>`
      : '▶ Timer starten'}</button>` : ''}
  </section>`;
}

function suppCard() {
  const me = uid(), due = dueSupps(me, S.date);
  const st = streak(me, 'supps');
  return `<section class="card supps">
    <div class="card-head"><h3>💊 Supplements ${st ? `<span class="pill">🔥 ${st}</span>` : ''}</h3>
      <button class="chip" data-a="manageSupps">Verwalten</button></div>
    ${due.length ? due.map(s => {
      const t = taken(me, S.date, s.id);
      return `<div class="supp ${t >= s.times ? 'complete' : ''}">
        <span class="supp-name">${esc(s.emoji || '💊')} ${esc(s.name)}${s.times > 1 ? ` <span class="muted small">${t}/${s.times}</span>` : ''}</span>
        <div class="dots">${Array.from({ length: s.times }, (_, i) =>
          `<button class="dot ${t > i ? 'on' : ''}" data-a="supp" data-id="${s.id}" data-i="${i}" aria-label="${esc(s.name)} Einnahme ${i + 1}">${t > i ? '✓' : ''}</button>`).join('')}</div>
      </div>`;
    }).join('') : `<p class="muted small">${S.supps.some(s => s.uid === me)
      ? 'An diesem Tag ist nichts fällig. 🌿'
      : 'Noch keine Supplements eingetragen. Tippe auf „Verwalten“, um z. B. Vitamin D hinzuzufügen.'}</p>`}
  </section>`;
}

function partnerCard() {
  const p = S.partnerUid, pr = prof(p), ss = suppStatus(p, S.date);
  return `<section class="card partner">
    <div class="card-head"><h3>${esc(pr.emoji)} ${esc(pr.name)} ${S.date === U.today() ? 'heute' : '· ' + U.prettyDate(S.date)}</h3></div>
    <div class="stats3">
      <div><b>${U.fmtShort(minutes(p, 'uni', S.date))}</b><span>Uni</span></div>
      <div><b>${U.fmtShort(minutes(p, 'home', S.date))}</b><span>Haushalt</span></div>
      <div><b>${ss ? `${ss.done}/${ss.total}` : '–'}</b><span>Supps</span></div>
    </div>
    <div class="actions-row">
      <button class="btn soft" data-a="nudge">👉 Anstupsen</button>
      <button class="btn soft" data-a="cheer" data-t="✋ High Five!">✋ High Five</button>
      <button class="btn soft" data-a="cheer" data-t="🥰 Ich bin stolz auf dich!">🥰 Stolz</button>
    </div>
  </section>`;
}

function rewardProgress(r) {
  const s = Math.min(r.days, streak(r.to, r.metric, r.min, r.since));
  return `<div class="rp">
    <div class="rp-top"><span>🔒 ${esc(r.title)}</span><b>${s}/${r.days}</b></div>
    <div class="bar thin"><span class="${r.to === uid() ? 'me' : 'you'}" style="width:${s / r.days * 100}%"></span></div>
    <div class="muted small">${condText(r)}${r.from === uid() ? '' : ` · von ${esc(prof(r.from).name)}`}</div>
  </div>`;
}

function upcomingRewards() {
  const list = S.rewards.filter(r => r.to === uid() && !r.unlocked);
  if (!list.length) return '';
  return `<section class="card">
    <div class="card-head"><h3>🎁 Deine Überraschungen</h3><button class="chip" data-a="tab" data-v="rewards">Alle</button></div>
    ${list.slice(0, 3).map(rewardProgress).join('')}
  </section>`;
}

/* ------------------------------------------------------- Belohnungen */
const byNewest = (a, b) => U.tsMs(b.createdAt) - U.tsMs(a.createdAt);

function vRewards() {
  const me = uid(), p = S.partnerUid;
  const mine = S.rewards.filter(r => r.to === me).sort(byNewest);
  const given = S.rewards.filter(r => r.from === me).sort(byNewest);
  return `
    ${p ? `<button class="btn primary big full" data-a="newReward">＋ Belohnung für ${esc(prof(p).name)} einrichten</button>`
      : '<div class="card muted">Sobald dein Schatz beigetreten ist, könnt ihr euch gegenseitig Belohnungen einrichten.</div>'}
    <h2 class="section">Für dich</h2>
    ${mine.length ? mine.map(r => r.unlocked
      ? `<button class="card reward unlocked" data-a="openReward" data-id="${r.id}">
           <span class="reward-icon">${r.seen ? '🎁' : '✨'}</span>
           <div class="grow"><b>${esc(r.title)}</b><div class="muted small">Freigeschaltet · tippen zum Öffnen</div></div></button>`
      : `<div class="card reward">${rewardProgress(r)}</div>`).join('')
      : '<p class="muted empty">Noch keine Belohnungen für dich – vielleicht mal lieb nachfragen 😉</p>'}
    <h2 class="section">Von dir</h2>
    ${given.length ? given.map(r => `<div class="card reward">
        <span class="reward-icon">${r.unlocked ? '✅' : '⏳'}</span>
        <div class="grow"><b>${esc(r.title)}</b>
          <div class="muted small">${condText(r)}<br>${r.unlocked ? 'Freigeschaltet 🎉' : `Fortschritt ${Math.min(r.days, streak(r.to, r.metric, r.min, r.since))}/${r.days}`}</div></div>
        <button class="icon-btn" data-a="previewReward" data-id="${r.id}" aria-label="Ansehen">👁</button>
        <button class="icon-btn" data-a="delReward" data-id="${r.id}" aria-label="Löschen">🗑</button>
      </div>`).join('')
      : '<p class="muted empty">Du hast noch nichts eingerichtet.</p>'}`;
}

/* ------------------------------------------------------------ Pinnwand */
function vFeed() {
  const p = S.partnerUid;
  return `<form class="card composer" data-form="post">
      <textarea id="composer" data-keep name="text" rows="2" maxlength="500" placeholder="${p ? `Schreib ${esc(prof(p).name)} etwas Liebes …` : 'Schreib etwas …'}"></textarea>
      ${S.pendingPost ? `<div class="preview"><img src="${S.pendingPost}" alt=""><button type="button" class="chip small" data-a="clearImg">Bild entfernen</button></div>` : ''}
      <div class="composer-row">
        <label class="btn soft">📷 Bild<input type="file" accept="image/*" data-img="post" hidden></label>
        <button class="btn primary">Senden</button>
      </div>
    </form>
    <div class="chips scroll">${['✋ High Five!', '☕ Kaffeepause?', '🥰 Stolz auf dich!', '📚 Lernen wir zusammen?', '🍽️ Essen ist fertig!', '😴 Gute Nacht ❤️']
      .map(t => `<button class="chip" data-a="cheer" data-t="${t}">${t}</button>`).join('')}</div>
    <div class="feed">${S.feed.length ? S.feed.map(feedItem).join('')
      : '<p class="muted empty">Noch nichts los hier. Schick den ersten Gruß! 👋</p>'}</div>`;
}

function feedItem(f) {
  const mine = f.uid === uid(), hearts = f.hearts || [], liked = hearts.includes(uid());
  const sys = ['nudge', 'unlock', 'newReward'].includes(f.type);
  const txt = feedText(f);
  return `<div class="post ${mine ? 'mine' : 'theirs'} ${sys ? 'sys' : ''}">
    <div class="bubble">
      ${f.image ? `<img src="${f.image}" data-a="openImg" data-id="${f.id}" alt="" loading="lazy">` : ''}
      ${txt ? `<p>${esc(txt)}</p>` : ''}
    </div>
    <div class="meta">${esc(prof(f.uid).emoji)} ${U.relTime(f.createdAt)}
      ${!mine ? `· <button class="heart" data-a="heart" data-id="${f.id}" aria-label="Herz">${liked ? '❤️' : '🤍'}</button>` : (hearts.length ? '· ❤️' : '')}
      ${mine ? `· <button class="link small" data-a="delPost" data-id="${f.id}">löschen</button>` : ''}
    </div>
  </div>`;
}

/* ------------------------------------------------------------ Modal & Toast */
function openModal(html) {
  $modal.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  $modal.classList.remove('hidden');
  S.modalOpen = true;
}
function closeModal() {
  $modal.classList.add('hidden');
  $modal.innerHTML = '';
  S.modalOpen = false;
  S.pendingRewardImg = null;
  schedule();
}
$modal.addEventListener('click', e => { if (e.target === $modal) closeModal(); });

let toastT;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

function tick() {
  document.querySelectorAll('.tick').forEach(el => {
    const s = Math.max(0, Math.floor((Date.now() - +el.dataset.start) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    el.textContent = (h ? h + ':' + U.pad(m) : m) + ':' + U.pad(sec);
  });
}
setInterval(tick, 1000);

// Galerie blättert langsam von selbst weiter – pausiert, sobald jemand selbst wischt
let lastSwipe = 0;
document.addEventListener('touchstart', e => { if (e.target.closest('.moments')) lastSwipe = Date.now(); }, { passive: true });
document.addEventListener('wheel', e => { if (e.target.closest('.moments')) lastSwipe = Date.now(); }, { passive: true });
setInterval(() => {
  const m = document.getElementById('moments');
  if (!m || S.modalOpen || document.hidden || Date.now() - lastSwipe < 8000) return;
  const card = m.querySelector('.moment');
  if (!card) return;
  const step = card.offsetWidth + 12;
  const end = m.scrollLeft + m.clientWidth >= m.scrollWidth - 4;
  m.scrollTo({ left: end ? 0 : m.scrollLeft + step, behavior: 'smooth' });
}, 4500);

/* ------------------------------------------------------------ Schreiben */
function setMinutes(cat, d, value) {
  value = Math.max(0, Math.min(1440, Math.round(value)));
  return setDoc(doc(col('logs'), `${uid()}_${d}`),
    { uid: uid(), date: d, [cat]: value, updatedAt: serverTimestamp() }, { merge: true });
}
function post(data) {
  return W(addDoc(col('feed'), { uid: uid(), hearts: [], createdAt: serverTimestamp(), ...data }));
}

/* ------------------------------------------------------------ Belohnungen prüfen */
const unlocking = new Set(), revealed = new Set();
async function checkRewards() {
  const me = uid();
  for (const r of S.rewards) {
    if (r.to !== me || r.unlocked || unlocking.has(r.id)) continue;
    if (streak(me, r.metric, r.min, r.since) >= r.days) {
      unlocking.add(r.id);
      try {
        await updateDoc(doc(col('rewards'), r.id), { unlocked: true, unlockedAt: serverTimestamp() });
        post({ type: 'unlock', text: r.title });
      } catch (e) { unlocking.delete(r.id); console.error(e); }
    }
  }
  if (S.modalOpen) return;
  const fresh = S.rewards.find(r => r.to === me && r.unlocked && !r.seen && !revealed.has(r.id));
  if (fresh) { revealed.add(fresh.id); openReward(fresh.id, true); }
}

async function openReward(id, celebrate) {
  const r = S.rewards.find(x => x.id === id);
  if (!r) return;
  openModal('<div class="spinner"></div>');
  let sec = null;
  for (let i = 0; i < 4 && !sec; i++) {
    try {
      const s = await getDoc(doc(db, 'couples', S.cid, 'rewards', id, 'secret', 'content'));
      sec = s.data() || {};
    } catch (e) { await new Promise(res => setTimeout(res, 1500)); }
  }
  if (!S.modalOpen) return;
  if (!sec) {
    openModal('<p>Die Belohnung konnte nicht geladen werden. Bist du online?</p><div class="modal-actions"><button class="btn" data-a="close">OK</button></div>');
    return;
  }
  if (celebrate) U.confetti();
  const forMe = r.to === uid();
  openModal(`<div class="reveal">
    <div class="reveal-badge">${forMe ? '🎉' : '👁'}</div>
    <h2>${esc(r.title)}</h2>
    <p class="muted small">${forMe ? `von ${esc(prof(r.from).name)}` : `Vorschau für ${esc(prof(r.to).name)}`} · ${condText(r)}</p>
    ${sec.image ? `<img class="reveal-img" src="${sec.image}" alt="">` : ''}
    ${sec.text ? `<p class="reveal-text">${esc(sec.text)}</p>` : ''}
    <div class="modal-actions"><button class="btn" data-a="close">Schließen</button>
      ${forMe ? `<button class="btn primary" data-a="thanks" data-id="${id}">Danke sagen 💕</button>` : ''}</div>
  </div>`);
  if (forMe && !r.seen) W(updateDoc(doc(col('rewards'), id), { seen: true }));
}

/* ------------------------------------------------------------ Aktionen */
const actions = {
  authMode: el => renderAuth(el.dataset.mode),
  async forgot() {
    const em = document.querySelector('input[name=email]')?.value.trim();
    if (!em) return toast('Gib zuerst oben deine E-Mail ein');
    try { await sendPasswordResetEmail(auth, em); toast('Mail zum Zurücksetzen ist unterwegs 📬'); }
    catch (x) { toast(authMsg(x.code)); }
  },
  async logout() { $modal.classList.add('hidden'); S.modalOpen = false; stopListeners(); await signOut(auth); },
  async createCouple(el) {
    el.disabled = true;
    const me = uid(), cid = U.code();
    try {
      await setDoc(doc(db, 'couples', cid), {
        members: [me], weeklyGoal: 30, createdAt: serverTimestamp(),
        profiles: { [me]: { name: myName(), emoji: '🌸', goalUni: 120, goalHome: 30 } }
      });
      await setDoc(doc(db, 'users', me), { coupleId: cid }, { merge: true });
      startCouple(cid);
    } catch (e) {
      el.disabled = false;
      document.getElementById('pairErr').textContent = 'Fehler: ' + (e.code || e.message) + ' – sind die Firestore-Regeln veröffentlicht?';
    }
  },
  tab(el) { S.view = el.dataset.v; localStorage.setItem('zw_view', S.view); window.scrollTo(0, 0); schedule(); },
  day(el) {
    const n = U.addDays(S.date, +el.dataset.d);
    if (n <= U.today()) { S.date = n; schedule(); }
  },
  goToday() { S.date = U.today(); schedule(); },
  addTime(el) {
    const cat = el.dataset.cat;
    W(setMinutes(cat, S.date, minutes(uid(), cat, S.date) + +el.dataset.m));
    if (navigator.vibrate) navigator.vibrate(10);
  },
  editTime(el) {
    const cat = el.dataset.cat, v = minutes(uid(), cat, S.date);
    openModal(`<h2>${METRICS[cat].emoji} ${cat === 'uni' ? 'Uni' : 'Haushalt & Co.'}</h2>
      <p class="muted">${U.prettyDate(S.date)} – Gesamtzeit eintragen</p>
      <form data-form="time" data-cat="${cat}">
        <div class="two">
          <label>Stunden<input name="h" type="number" min="0" max="24" inputmode="numeric" value="${Math.floor(v / 60)}"></label>
          <label>Minuten<input name="m" type="number" min="0" max="59" inputmode="numeric" value="${v % 60}"></label>
        </div>
        <div class="modal-actions"><button type="button" class="btn" data-a="close">Abbrechen</button><button class="btn primary">Speichern</button></div>
      </form>`);
  },
  timer(el) {
    const cat = el.dataset.cat, k = timerKey(cat), st = localStorage.getItem(k);
    if (!st) { localStorage.setItem(k, Date.now()); toast(`⏱️ ${METRICS[cat].label}-Timer läuft – viel Erfolg!`); return schedule(); }
    localStorage.removeItem(k);
    const start = +st, mins = Math.round((Date.now() - start) / 60000);
    if (mins < 1) { toast('Unter 1 Minute – nicht gezählt'); return schedule(); }
    const d = U.ds(new Date(start));
    W(setMinutes(cat, d, minutes(uid(), cat, d) + mins));
    toast(`+${U.fmtMin(mins)} ${METRICS[cat].label} eingetragen ✅`);
    schedule();
  },
  supp(el) {
    const id = el.dataset.id, i = +el.dataset.i, cur = taken(uid(), S.date, id);
    const n = cur > i ? i : i + 1;
    W(setDoc(doc(col('suppLogs'), `${uid()}_${S.date}`), { uid: uid(), date: S.date, taken: { [id]: n } }, { merge: true }));
    if (navigator.vibrate) navigator.vibrate(12);
  },
  manageSupps() {
    const mine = S.supps.filter(s => s.uid === uid());
    openModal(`<h2>💊 Meine Supplements</h2>
      ${mine.length ? `<div class="supp-list">${mine.map(s => `<div class="supp-row">
          <span>${esc(s.emoji || '💊')} <b>${esc(s.name)}</b><br><span class="muted small">${s.times}× täglich · ${daysText(s.days)}</span></span>
          <button class="icon-btn" data-a="delSupp" data-id="${s.id}" aria-label="Löschen">🗑</button></div>`).join('')}</div>`
        : '<p class="muted">Noch keine eingetragen.</p>'}
      <form data-form="supp" class="card inset">
        <b>Neues Supplement</b>
        <div class="two wide-first">
          <label>Name<input name="sname" required maxlength="40" placeholder="z. B. Vitamin D"></label>
          <label>Emoji<input name="emoji" maxlength="4" value="💊"></label>
        </div>
        <label>Wie oft pro Tag?<select name="times">${[1, 2, 3, 4].map(n => `<option value="${n}">${n}× am Tag</option>`).join('')}</select></label>
        <div class="label-like">An welchen Tagen?</div>
        <div class="days">${[1, 2, 3, 4, 5, 6, 0].map(d =>
          `<label class="daychk"><input type="checkbox" name="day" value="${d}" checked><span>${U.WD[d]}</span></label>`).join('')}</div>
        <button class="btn primary full">Hinzufügen</button>
      </form>
      <div class="modal-actions"><button class="btn" data-a="close">Fertig</button></div>`);
  },
  delSupp(el) {
    if (!confirm('Supplement löschen?')) return;
    W(deleteDoc(doc(col('supplements'), el.dataset.id)));
    setTimeout(actions.manageSupps, 150);
  },
  nudge() { post({ type: 'nudge' }); toast('Angestupst 👉'); },
  cheer(el) { post({ type: 'note', text: el.dataset.t }); if (S.view !== 'feed') toast('Gesendet 💌'); },
  clearImg() { S.pendingPost = null; schedule(); },
  heart(el) {
    const f = S.feed.find(x => x.id === el.dataset.id);
    if (!f) return;
    const liked = (f.hearts || []).includes(uid());
    W(updateDoc(doc(col('feed'), f.id), { hearts: liked ? arrayRemove(uid()) : arrayUnion(uid()) }));
  },
  delPost(el) { if (confirm('Beitrag löschen?')) W(deleteDoc(doc(col('feed'), el.dataset.id))); },
  openPhoto(el) {
    const i = (+el.dataset.i + PHOTOS.length) % PHOTOS.length, ph = PHOTOS[i];
    openModal(`<div class="photo-view">
      <img class="full-img" src="${ph.src}" alt="${esc(ph.cap)}">
      <p class="photo-cap">${esc(ph.cap)}</p>
      <div class="modal-actions">
        <button class="btn" data-a="openPhoto" data-i="${i - 1}" aria-label="Vorheriges Foto">‹</button>
        <button class="btn" data-a="close">Schließen</button>
        <button class="btn" data-a="openPhoto" data-i="${i + 1}" aria-label="Nächstes Foto">›</button>
      </div></div>`);
  },
  openImg(el) {
    const f = S.feed.find(x => x.id === el.dataset.id);
    if (f?.image) openModal(`<img class="full-img" src="${f.image}" alt="">
      ${f.text ? `<p>${esc(f.text)}</p>` : ''}<div class="modal-actions"><button class="btn" data-a="close">Schließen</button></div>`);
  },
  newReward() {
    S.pendingRewardImg = null;
    const pn = esc(prof(S.partnerUid).name);
    const presets = ['🍝 Ich koche dir was', '💆 Eine Massage', '🎬 Du suchst den Film aus', '☕ Frühstück ans Bett', '🍦 Eis-Date', '📸 Ein Foto von mir'];
    openModal(`<h2>Neue Belohnung 🎁</h2><p class="muted">für ${pn}</p>
      <form data-form="reward">
        <label>Titel <span class="hint">(sieht ${pn} schon vorher)</span>
          <input name="title" required maxlength="60" placeholder="z. B. Überraschung zum Abendessen"></label>
        <div class="chips wrap">${presets.map(t => `<button type="button" class="chip" data-a="preset" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <label>Geheime Nachricht <span class="hint">(erst nach dem Freischalten sichtbar)</span>
          <textarea name="text" rows="3" maxlength="1000" placeholder="Heute Abend koche ich dir dein Lieblingsessen …"></textarea></label>
        <label class="file">📷 Geheimes Bild hinzufügen (optional)<input type="file" accept="image/*" data-img="reward" hidden></label>
        <div id="rwPreview" class="preview"></div>
        <fieldset><legend>Bedingung</legend>
          <label>Was soll ${pn} schaffen?<select name="rmetric">
            <option value="uni">📚 Uni-Zeit</option><option value="home">🧺 Haushalt-Zeit</option>
            <option value="total">⏱️ Uni + Haushalt zusammen</option><option value="supps">💊 Alle Supplements genommen</option></select></label>
          <div class="two">
            <label id="minRow">Mind. Stunden pro Tag<input name="hours" type="number" min="0.25" max="16" step="0.25" value="3" inputmode="decimal"></label>
            <label>Tage in Folge<input name="days" type="number" min="1" max="100" value="3" inputmode="numeric"></label>
          </div>
          <p class="hint">Gezählt werden nur Tage ab heute.</p>
        </fieldset>
        <div class="modal-actions"><button type="button" class="btn" data-a="close">Abbrechen</button><button class="btn primary">Einrichten</button></div>
      </form>`);
  },
  preset(el) {
    const f = el.closest('form'), t = el.dataset.t;
    f.elements.title.value = t;
    if (!f.elements.text.value) f.elements.text.value = t.replace(/^\S+\s/, '') + ' ❤️';
  },
  openReward(el) { openReward(el.dataset.id, false); },
  previewReward(el) { openReward(el.dataset.id, false); },
  delReward(el) {
    if (!confirm('Belohnung löschen?')) return;
    const b = writeBatch(db);
    b.delete(doc(db, 'couples', S.cid, 'rewards', el.dataset.id, 'secret', 'content'));
    b.delete(doc(col('rewards'), el.dataset.id));
    W(b.commit());
  },
  thanks(el) {
    const r = S.rewards.find(x => x.id === el.dataset.id);
    post({ type: 'note', text: `💕 Danke für „${r?.title || 'die Belohnung'}“!` });
    closeModal();
    toast('Danke gesendet 💕');
  },
  settings() {
    const pr = prof(uid());
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    openModal(`<h2>Einstellungen</h2>
      <form data-form="settings">
        <div class="two wide-first">
          <label>Dein Name<input name="pname" value="${esc(pr.name)}" maxlength="30" required></label>
          <label>Emoji<input name="emoji" value="${esc(pr.emoji)}" maxlength="4"></label>
        </div>
        <div class="two">
          <label>Uni-Tagesziel (Std.)<input name="gu" type="number" step="0.25" min="0.25" max="16" value="${pr.goalUni / 60}" inputmode="decimal"></label>
          <label>Haushalt-Ziel (Min.)<input name="gh" type="number" step="5" min="5" max="600" value="${pr.goalHome}" inputmode="numeric"></label>
        </div>
        <label>Gemeinsames Wochenziel (Std., Uni + Haushalt von euch beiden)
          <input name="wg" type="number" min="1" max="200" value="${S.couple.weeklyGoal || 30}" inputmode="numeric"></label>
        <button class="btn primary full">Speichern</button>
      </form>
      <div class="settings-block"><div class="muted small">Euer Raum-Code</div><div class="code">${esc(S.cid)}</div></div>
      <div class="settings-block"><b>📱 Als App aufs Handy</b>
        <p class="small muted">${standalone ? 'Läuft bereits als App ✨' : ios
          ? 'iPhone: In Safari unten auf „Teilen“ (□↑) tippen → „Zum Home-Bildschirm“.'
          : 'Android: Im Chrome-Menü (⋮) auf „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ tippen.'}</p>
        ${S.installEvt && !standalone ? '<button class="btn soft full" data-a="install">Jetzt installieren</button>' : ''}
      </div>
      <div class="modal-actions"><button class="btn" data-a="close">Schließen</button><button class="btn danger" data-a="logout">Abmelden</button></div>`);
  },
  async install() {
    if (!S.installEvt) return;
    S.installEvt.prompt();
    await S.installEvt.userChoice;
    S.installEvt = null;
    closeModal();
  },
  async shareCode() {
    const text = `Komm in unseren Zweisam-Raum 💞 Code: ${S.cid}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Zweisam', text, url: location.href });
      else { await navigator.clipboard.writeText(`${text}\n${location.href}`); toast('Kopiert 📋'); }
    } catch { }
  },
  close: () => closeModal()
};

/* ------------------------------------------------------------ Formulare */
const forms = {
  async auth(f) {
    const e = f.elements, err = document.getElementById('authErr'), btn = f.querySelector('button.primary');
    err.textContent = ''; btn.disabled = true;
    try {
      if (f.dataset.mode === 'register') {
        const c = await createUserWithEmailAndPassword(auth, e.email.value.trim(), e.pw.value);
        await updateProfile(c.user, { displayName: e.uname.value.trim() });
      } else {
        await signInWithEmailAndPassword(auth, e.email.value.trim(), e.pw.value);
      }
    } catch (x) { err.textContent = authMsg(x.code); btn.disabled = false; }
  },
  async join(f) {
    const err = document.getElementById('pairErr');
    const cid = f.elements.code.value.trim().toUpperCase().replace(/\s/g, '');
    err.textContent = '';
    try {
      const ref = doc(db, 'couples', cid), s = await getDoc(ref);
      if (!s.exists()) { err.textContent = 'Diesen Code gibt es nicht – bitte nochmal prüfen.'; return; }
      const d = s.data();
      if (!d.members.includes(uid())) {
        if (d.members.length >= 2) { err.textContent = 'Dieser Raum ist schon voll.'; return; }
        await updateDoc(ref, {
          members: arrayUnion(uid()),
          [`profiles.${uid()}`]: { name: myName(), emoji: '🌿', goalUni: 120, goalHome: 30 }
        });
      }
      await setDoc(doc(db, 'users', uid()), { coupleId: cid }, { merge: true });
      startCouple(cid);
      toast('Verbunden 💞');
    } catch (x) { err.textContent = 'Fehler: ' + (x.code || x.message); }
  },
  time(f) {
    const v = (+f.elements.h.value || 0) * 60 + (+f.elements.m.value || 0);
    W(setMinutes(f.dataset.cat, S.date, v));
    closeModal();
  },
  supp(f) {
    const e = f.elements;
    const days = [...f.querySelectorAll('input[name=day]:checked')].map(x => +x.value);
    if (!days.length) return toast('Bitte mindestens einen Tag wählen');
    W(addDoc(col('supplements'), {
      uid: uid(), name: e.sname.value.trim(), emoji: e.emoji.value.trim() || '💊',
      times: +e.times.value, days, createdDate: U.today(), createdAt: serverTimestamp()
    }));
    toast('Hinzugefügt ✅');
    setTimeout(actions.manageSupps, 150);
  },
  post(f) {
    const text = f.elements.text.value.trim();
    if (!text && !S.pendingPost) return;
    post({ type: S.pendingPost ? 'image' : 'note', text, image: S.pendingPost || null });
    S.pendingPost = null;
    f.elements.text.value = '';
    schedule();
  },
  reward(f) {
    const e = f.elements, metric = e.rmetric.value;
    const title = e.title.value.trim(), text = e.text.value.trim();
    if (!text && !S.pendingRewardImg) return toast('Bitte eine Nachricht oder ein Bild hinzufügen');
    const hours = parseFloat(String(e.hours.value).replace(',', '.'));
    if (metric !== 'supps' && !(hours > 0)) return toast('Bitte Stunden pro Tag angeben');
    const ref = doc(col('rewards'));
    const b = writeBatch(db);
    b.set(ref, {
      from: uid(), to: S.partnerUid, title, metric,
      min: metric === 'supps' ? 0 : Math.round(hours * 60),
      days: Math.max(1, parseInt(e.days.value) || 1),
      since: U.today(), hasImage: !!S.pendingRewardImg,
      unlocked: false, seen: false, createdAt: serverTimestamp()
    });
    b.set(doc(db, 'couples', S.cid, 'rewards', ref.id, 'secret', 'content'),
      { from: uid(), text, image: S.pendingRewardImg || null });
    W(b.commit());
    post({ type: 'newReward', text: title });
    closeModal();
    toast('Belohnung eingerichtet 🎁');
  },
  settings(f) {
    const e = f.elements, me = uid();
    const gu = parseFloat(String(e.gu.value).replace(',', '.')) || 2;
    W(updateDoc(doc(db, 'couples', S.cid), {
      [`profiles.${me}.name`]: e.pname.value.trim() || 'Ich',
      [`profiles.${me}.emoji`]: e.emoji.value.trim() || '🙂',
      [`profiles.${me}.goalUni`]: Math.max(15, Math.round(gu * 60)),
      [`profiles.${me}.goalHome`]: Math.max(5, parseInt(e.gh.value) || 30),
      weeklyGoal: Math.max(1, parseInt(e.wg.value) || 30)
    }));
    closeModal();
    toast('Gespeichert ✅');
  }
};

/* ------------------------------------------------------------ Events */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.a];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  forms[f.dataset.form]?.(f);
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.matches('[data-img]')) {
    const file = el.files?.[0];
    if (!file) return;
    toast('Bild wird vorbereitet …');
    try {
      const url = await U.compressImage(file);
      if (el.dataset.img === 'post') { S.pendingPost = url; schedule(); }
      else {
        S.pendingRewardImg = url;
        const pv = document.getElementById('rwPreview');
        if (pv) pv.innerHTML = `<img src="${url}" alt="">`;
      }
    } catch { toast('Dieses Bild konnte nicht gelesen werden'); }
  }
  if (el.name === 'rmetric') document.getElementById('minRow').hidden = el.value === 'supps';
});

// Tageswechsel, wenn die App über Nacht offen bleibt
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = U.today();
  if (S.lastToday !== t) { if (S.date === S.lastToday) S.date = t; S.lastToday = t; }
  schedule();
});

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

