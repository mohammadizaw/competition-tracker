/* Math Competitions Tracker — app logic.
   Storage: Firebase Auth + Firestore (one private document per teacher) when firebase-config.js is filled in,
   otherwise a browser-only demo store so the design can be previewed. */

const CFG = window.FIREBASE_CONFIG;
const SET = window.MCT_SETTINGS || {};
const CONTACTS = SET.contacts || {};
const STATUS = [{k:'Action needed',c:'action'},{k:'In progress',c:'progress'},{k:'Registered',c:'registered'},{k:'Planned',c:'planned'},{k:'Done',c:'done'},{k:'Closed',c:'closed'}];
const PSTAT = ['Nominated','Registered','Training','Submitted','Qualified','Awarded','Withdrawn'];
const PICK = {
  'ikmc':{max:1,note:'Choose 1 student: the strongest across all your classes. Mr. Abdullah needs the full name and class.'},
  'challenge-me':{note:'Band 2 (Grades 9–10). Any group size. Mr. Abdullah asked for at least one group per teacher, ideally one per class.'},
  'steam-champions':{max:3,note:'One team of 1–3 students. Pick students who like projects, coding or design as well as maths.'},
  'amc':{note:'Only if the school registered. Grade 9 students sit AMC 10.'},
  'caribou':{note:'Online rounds through the year. Needs approval via Mr. Mahmoud first.'},
  'amo-sasmo-immo':{note:'Online olympiads. Needs approval via Mr. Mahmoud first.'},
  'kenken':{note:'Logic puzzle contest. Needs approval via Mr. Mahmoud first.'},
  'cemc':{note:'Grade 9 sit the Pascal contest (February). School registration is done by Mr. Abdullah.'},
  'rit-dubai':{max:3,note:'Teams of three, Grades 11–12. Form the team early.'},
  'future-science-challenge':{max:3,note:'2–3 students + you as supervisor. Registration closed 24 Oct; record your registered team here.'},
  'young-entrepreneur':{max:3,note:'1–3 students per project. Record the registered project team here.'}
};

/* ---------- small helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
const iso = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const pd = s => { if (!s) return null; const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const fmt = (s, y = true) => { const d = pd(s); return d ? d.toLocaleDateString('en-GB', y ? {day:'numeric',month:'short',year:'numeric'} : {weekday:'short',day:'numeric',month:'short'}) : 'TBC'; };
const dleft = s => Math.round((pd(s) - today) / 864e5);
const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const scls = k => (STATUS.find(x => x.k === k) || STATUS[3]).c;
const shortName = n => n.split(' ').slice(0, 2).join(' ');
const compShort = c => c.name.replace(/ \(.*?\)/g, '').replace(/ 2026–27$/, '').replace(/ –.*$/, '').split(':')[0];

function toast(m) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; $('toasts').appendChild(t); setTimeout(() => t.remove(), 2400); }
function banner(m) { const b = $('banner'); if (!m) { b.hidden = true; return; } b.textContent = m; b.hidden = false; }
function confirmDlg(title, body, yes = 'Remove') {
  return new Promise(res => {
    $('cfTitle').textContent = title; $('cfBody').textContent = body; $('cfYes').textContent = yes;
    const d = $('confirmDlg'); const done = v => { d.close(); $('cfYes').onclick = $('cfNo').onclick = null; res(v); };
    $('cfYes').onclick = () => done(true); $('cfNo').onclick = () => done(false); d.onclose = () => res(false); d.showModal();
  });
}

/* ---------- state ---------- */
const S = {
  tab: 'home', comps: [], templates: [], user: null,
  data: null, // private teacher document
  pickComp: 'ikmc', rq: '', rclass: 'all', rsort: 'score', open: new Set(), calMonth: null, calSel: null, showDone: false
};
const blank = () => ({ displayName: '', actions: [], stepsDone: {}, compState: {}, roster: [], participants: [], updatedAt: now() });

/* ---------- storage adapters ---------- */
let store; // { onAuth(cb), signIn, signUp, signOut, reset, load(), save(doc), updateName }

function demoStore() {
  const K = 'mct-demo';
  const read = () => { try { return JSON.parse(localStorage.getItem(K) || '{}'); } catch { return {}; } };
  const write = o => { try { localStorage.setItem(K, JSON.stringify(o)); } catch {} };
  let cb = null;
  const user = () => read().user || null;
  return {
    demo: true,
    onAuth(f) { cb = f; f(user()); },
    async signUp(email, pass, name) { const o = read(); o.user = { uid: 'demo', email, displayName: name }; write(o); cb(o.user); },
    async signIn(email) { const o = read(); o.user = o.user || { uid: 'demo', email, displayName: '' }; o.user.email = email; write(o); cb(o.user); },
    async signOut() { const o = read(); delete o.user; write(o); cb(null); },
    async reset() { throw new Error('Password reset needs Firebase. In demo mode just sign in with any password.'); },
    async load() { const o = read(); return o.doc || null; },
    async save(doc) { const o = read(); o.doc = doc; write(o); },
    async updateName(n) { const o = read(); if (o.user) { o.user.displayName = n; write(o); } }
  };
}

async function firebaseStore() {
  const V = '10.14.1';
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
  ]);
  const app = initializeApp(CFG);
  const a = auth.getAuth(app);
  const db = fs.getFirestore(app);
  const ref = () => fs.doc(db, 'teachers', a.currentUser.uid);
  const nice = e => ({
    'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'No account with this email. Create one first.',
    'auth/email-already-in-use': 'This email already has an account. Sign in instead.', 'auth/weak-password': 'Please use at least 8 characters.',
    'auth/invalid-email': 'That email address does not look right.', 'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No connection. Check your internet and try again.', 'permission-denied': 'You are not allowed to do that.'
  }[e?.code] || e?.message || 'Something went wrong.');
  const wrap = p => p.catch(e => { throw new Error(nice(e)); });
  return {
    demo: false,
    onAuth(f) { auth.onAuthStateChanged(a, u => f(u ? { uid: u.uid, email: u.email, displayName: u.displayName || '' } : null)); },
    signUp: (email, pass, name) => wrap((async () => { const c = await auth.createUserWithEmailAndPassword(a, email, pass); if (name) await auth.updateProfile(c.user, { displayName: name }); })()),
    signIn: (email, pass) => wrap(auth.signInWithEmailAndPassword(a, email, pass)),
    signOut: () => auth.signOut(a),
    reset: email => wrap(auth.sendPasswordResetEmail(a, email)),
    async load() { const s = await wrap(fs.getDoc(ref())); return s.exists() ? s.data() : null; },
    save: doc => wrap(fs.setDoc(ref(), doc)),
    updateName: n => wrap(auth.updateProfile(a.currentUser, { displayName: n }))
  };
}

/* save with a short debounce so quick edits do not spam the database */
let saveT = null, saving = false;
function persist(immediate = false) {
  if (!S.data) return;
  S.data.updatedAt = now();
  clearTimeout(saveT);
  const run = async () => { saving = true; try { await store.save(JSON.parse(JSON.stringify(S.data))); banner(''); } catch (e) { banner('Your last change could not be saved: ' + e.message); } saving = false; };
  if (immediate) return run();
  saveT = setTimeout(run, 400);
}
window.addEventListener('beforeunload', () => { if (saveT) { clearTimeout(saveT); store.save(JSON.parse(JSON.stringify(S.data))); } });

/* ---------- derived data ---------- */
const comp = id => S.comps.find(c => c.id === id);
const mine = cid => S.data.participants.filter(p => p.compId === cid);
const compsOfStudent = n => S.data.participants.filter(p => p.student === n).map(p => p.compId);
const myState = c => Object.assign({}, c, S.data.compState[c.id] || {});
const nextDate = c => (c.dates || []).filter(x => x.date && dleft(x.end || x.date) >= 0).sort((a, b) => a.date < b.date ? -1 : 1)[0] || null;
const teacherName = () => S.data.displayName || S.user.displayName || '';
const lvl = s => s >= 80 ? 'high' : s >= 60 ? 'pass' : 'failed';

function setMine(id, field, val) { S.data.compState[id] = Object.assign({}, S.data.compState[id], { [field]: val }); persist(); }
function dueChip(s, done) {
  if (done) return '<span class="days ok">done</span>';
  if (!s) return '<span class="days">no date</span>';
  const n = dleft(s);
  if (n < 0) return `<span class="days soon">${-n} day${n === -1 ? '' : 's'} late</span>`;
  return `<span class="days ${n <= 2 ? 'soon' : n <= 7 ? 'mid' : ''}">${n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days'}</span>`;
}

/* ---------- email drafts ---------- */
const E = k => CONTACTS[k]?.email || '';
function studentLines(list) { return list.length ? list.map((p, i) => `${i + 1}. ${p.student} – ${p.cls}`).join('\n') : '[No students added yet — pick them in the “Students” tab]'; }
function draft(type, cid) {
  const c = comp(cid) || { name: 'the competition' }, me = teacherName() || '[Your name]', ps = cid ? mine(cid) : [];
  const sign = `\n\nBest regards,\n${me}\nMathematics Teacher`;
  const groups = () => S.comps.map(x => ({ x, ps: mine(x.id) })).filter(g => g.ps.length);
  let d;
  switch (type) {
    case 'nominee': d = { to: [E('abdullah')], cc: [E('habib')], subject: 'IKMC 2026–2027 – My nominee',
      body: `Dear Mr. Abdullah,\n\nFollowing your email about the International Kangaroo Mathematics Competition (IKMC) 2026–2027, my nominee from my classes is:\n\n${studentLines(ps)}\n\nI have informed the student and will start the preparation with past Kangaroo papers.${sign}` }; break;
    case 'challenge': d = { to: [E('habib')], cc: [E('abdullah')], subject: 'Challenge ME – My Band 2 students',
      body: `Dear Mr. Habib,\n\nI have logged in to my Challenge ME teacher account. These are my Band 2 (Grade 9) students for the championship:\n\n${studentLines(ps)}\n\nThey will practise the weekly quests before the Stage 2 Invitationals on 23 November. Please let me know if anything else is needed.${sign}` }; break;
    case 'steam': d = { to: [E('habib')], cc: [E('abdullah')], subject: 'STEAM Champions UAE 2026–2027 – My team details',
      body: `Dear Mr. Habib,\n\nPlease find my team details for the STEAM Champions MOE template:\n\nTeam name: [team name]\nCategory: [Technovation Digital Venture / FIRA Innovation & Business / FIRA Mission Impossible]\nCoach: ${me}\nStudents:\n${studentLines(ps)}\n\nI will complete the Level 1 Coach Certification before the 15 November deadline.${sign}` }; break;
    case 'mahmoud': { const g = groups(); d = { to: [E('mahmoud')], cc: [E('abdullah'), E('habib')], subject: 'Competition participants to add to the ATS competition platform',
      body: `Dear Mr. Mahmoud,\n\nPlease add the following participants to the ATS competition platform. Supervising teacher: ${me}.\n\n${g.length ? g.map(x => `${x.x.name}:\n${studentLines(x.ps)}`).join('\n\n') : '[No students added yet]'}${sign}` }; break; }
    case 'amc': d = { to: [E('abdullah')], cc: [E('habib')], subject: 'AMC 10/12 – Registration status',
      body: `Dear Mr. Abdullah,\n\nCould you please confirm whether our school registered for the MAA AMC 10/12 this year? The contests are on 5 November (A) and 13 November (B).\n\nIf we are registered, I would like to enter these Grade 9 students in AMC 10:\n\n${studentLines(mine('amc'))}${sign}` }; break;
    case 'followup': d = { to: [E('habib')], cc: [E('abdullah')], subject: 'Competitions follow-up – My update',
      body: `Dear Mr. Habib,\n\nHere is my competitions update:\n\n${groups().map(g => `• ${g.x.name}: ${g.ps.map(p => shortName(p.student) + ' (' + p.cls + ')').join(', ')}`).join('\n') || '• No students registered yet.'}\n\nI have also filled in the Competitions Follow-up form.${sign}` }; break;
    default: d = { to: [E('habib')], cc: [E('abdullah')], subject: `${c.name} – Students I would like to register`,
      body: `Dear Mr. Habib,\n\nI would like to register the following students in ${c.name}:\n\n${studentLines(ps)}\n\nPlease advise on the next step (approval through Mr. Mahmoud and registration).${sign}` };
  }
  d.empty = (!['followup', 'mahmoud', 'amc'].includes(type) && ps.length === 0) || (type === 'mahmoud' && !S.data.participants.length);
  return d;
}
let mailCtx = null;
function openMail(type, cid, actId) {
  const d = draft(type, cid); mailCtx = { actId };
  $('mTitle').textContent = d.subject; $('mTo').value = d.to.join('; '); $('mCc').value = d.cc.join('; '); $('mSubj').value = d.subject; $('mBody').value = d.body;
  $('mWarn').hidden = !d.empty; $('mWarn').textContent = 'You have not picked students for this yet. Pick them first so the list fills in automatically.';
  $('mDone').hidden = !actId; updateMailto(); $('mailDlg').showModal();
}
function updateMailto() {
  const q = '?cc=' + encodeURIComponent($('mCc').value.replace(/;\s*/g, ',')) + '&subject=' + encodeURIComponent($('mSubj').value) + '&body=' + encodeURIComponent($('mBody').value);
  $('mOpen').href = 'mailto:' + $('mTo').value.replace(/;\s*/g, ',') + q;
}
['mTo', 'mCc', 'mSubj', 'mBody'].forEach(i => $(i).addEventListener('input', updateMailto));
async function copyMail() {
  const txt = `To: ${$('mTo').value}\nCc: ${$('mCc').value}\nSubject: ${$('mSubj').value}\n\n${$('mBody').value}`;
  try { await navigator.clipboard.writeText(txt); toast('Email copied'); } catch { $('mBody').select(); toast('Press Ctrl+C to copy'); }
}
$('mCopy').addEventListener('click', copyMail);
$('mDone').addEventListener('click', async () => { await copyMail(); if (mailCtx?.actId) toggleAct(mailCtx.actId, true); $('mailDlg').close(); });
$('mClose').addEventListener('click', () => $('mailDlg').close());

/* ---------- Home: actions + calendar ---------- */
function toggleAct(id, v) { const a = S.data.actions.find(x => x.id === id); if (!a) return; a.done = v === undefined ? !a.done : v; a.doneAt = a.done ? now() : null; if (!a.done) a.hidden = false; persist(); render(); }
function hideAct(id, v) { const a = S.data.actions.find(x => x.id === id); if (!a) return; a.hidden = v; persist(); render(); toast(v ? 'Hidden' : 'Back in your list'); }
function actRow(a) {
  const c = comp(a.comp); const b = [];
  if (a.email) b.push(`<button class="btn small primary" type="button" data-mail="${a.email}" data-cid="${a.comp || ''}" data-act="${a.id}">Write email</button>`);
  if (a.comp && PICK[a.comp]) b.push(`<button class="btn small" type="button" data-gopick="${a.comp}">Pick students (${mine(a.comp).length})</button>`);
  if (a.comp && c) b.push(`<button class="btn small" type="button" data-gocomp="${a.comp}">Details</button>`);
  if (a.done && !a.hidden) b.push(`<button class="btn small ghost" type="button" data-hide="${a.id}">Hide</button>`);
  if (a.hidden) b.push(`<button class="btn small ghost" type="button" data-unhide="${a.id}">Show again</button>`);
  if (a.custom) b.push(`<button class="btn small ghost" type="button" data-delact="${a.id}">Delete</button>`);
  return `<div class="act ${a.done ? 'done' : ''}"><input type="checkbox" ${a.done ? 'checked' : ''} data-tick="${a.id}" aria-label="Mark ${esc(a.title)} done">
    <div style="min-width:0"><div class="t">${esc(a.title)}</div><div class="c">${c ? esc(compShort(c)) + ' · ' : ''}${a.due ? esc(fmt(a.due, false)) : ''}</div>${a.hint ? `<div class="c">${esc(a.hint)}</div>` : ''}
    ${b.length ? `<div class="btn-row n${Math.min(b.length,4)}">${b.join('')}</div>` : ''}</div>${dueChip(a.due, a.done)}</div>`;
}
function viewHome() {
  const A = S.data.actions;
  const open = A.filter(a => !a.hidden).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
  const hidden = A.filter(a => a.hidden);
  const g = [['Late', open.filter(a => a.due && dleft(a.due) < 0 && !a.done)], ['This week', open.filter(a => a.due && dleft(a.due) >= 0 && dleft(a.due) <= 7)], ['Later', open.filter(a => !a.due || dleft(a.due) > 7)], ['Done', open.filter(a => a.done && a.due && dleft(a.due) < 0)]].filter(x => x[1].length);
  const openCount = A.filter(a => !a.done).length;
  const stats = `<div class="stats"><div class="stat"><b>${openCount}</b><span>open actions</span></div><div class="stat"><b>${S.data.roster.length}</b><span>students in your list</span></div><div class="stat"><b>${new Set(S.data.participants.map(p => p.compId)).size}</b><span>competitions with your students</span></div></div>`;
  const list = (g.length ? g.map(([h, xs]) => `<div><p class="group-title">${h} · ${xs.filter(x => !x.done).length} to do</p>${xs.map(actRow).join('')}</div>`).join('') : `<p class="empty">All your actions are done. Add a reminder below if you need one.</p>`)
    + (hidden.length ? `<div><button class="btn small ghost" type="button" id="togDone">${S.showDone ? 'Hide' : 'Show'} ${hidden.length} hidden</button>${S.showDone ? hidden.map(actRow).join('') : ''}</div>` : '');
  const greet = teacherName() ? `Hello, ${esc(teacherName().split(' ')[0])}` : 'What to do next';
  return `${stats}<div class="cols"><section class="panel"><div class="panel-head"><h2>${greet}</h2><span class="hint">Tick each action when done</span></div>${list}
    <form class="addact" id="addAct"><div class="field"><label for="aaT">Add your own reminder</label><input id="aaT" placeholder="e.g. Collect permission slips" required></div><div class="field"><label for="aaD">Date</label><input id="aaD" type="date" required></div><button class="btn primary" type="submit">Add</button></form></section>
    <section class="panel">${viewCal()}</section></div>`;
}
function calItems() {
  const m = {};
  S.data.actions.forEach(a => { if (a.due) (m[a.due] = m[a.due] || []).push({ k: a.done ? 'dn' : 'act', t: a.title }); });
  S.comps.forEach(c => { if (myState(c).status === 'Closed') return; (c.dates || []).forEach(x => { if (x.date) (m[x.date] = m[x.date] || []).push({ k: 'ev', t: x.label + ' – ' + compShort(c) }); }); });
  return m;
}
function viewCal() {
  const base = S.calMonth || new Date(today.getFullYear(), today.getMonth(), 1);
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const m = calItems(); let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = iso(d), its = m[k] || [];
    cells += `<button type="button" class="day ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${k === iso(today) ? 'today' : ''} ${S.calSel === k ? 'sel' : ''}" data-day="${k}" aria-label="${fmt(k)}${its.length ? ', ' + its.length + ' items' : ''}"><span>${d.getDate()}</span><span class="dots">${its.slice(0, 6).map(x => `<i class="dot ${x.k === 'ev' ? 'ev' : x.k === 'dn' ? 'dn' : ''}"></i>`).join('')}</span></button>`;
  }
  const sel = S.calSel ? (m[S.calSel] ? `<div class="daylist"><b>${esc(fmt(S.calSel, false))}</b><ul>${m[S.calSel].map(x => `<li>${x.k === 'ev' ? 'Event: ' : x.k === 'dn' ? 'Done: ' : 'To do: '}${esc(x.t)}</li>`).join('')}</ul></div>` : `<p class="hint">Nothing on ${esc(fmt(S.calSel, false))}.</p>`) : '';
  return `<div class="calhead"><button class="btn icon" type="button" data-cal="-1" aria-label="Previous month">‹</button><h2>${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2><button class="btn icon" type="button" data-cal="1" aria-label="Next month">›</button></div>
    <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('')}${cells}</div>
    <div class="legend"><span><i class="dot"></i>My action</span><span><i class="dot ev"></i>Competition date</span><span><i class="dot dn"></i>Done</span></div>${sel}
    <div class="btn-row two"><button class="btn" type="button" data-cal="0">Today</button><button class="btn" type="button" id="icsBtn">Add to Outlook calendar</button></div>
    <p class="hint">Downloads a calendar file with each open action and a reminder the day before.</p>`;
}
function buildIcs() {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ATS Math//Competitions Tracker//EN', 'CALSCALE:GREGORIAN'];
  const st = now().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const clean = s => String(s).replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  S.data.actions.filter(a => !a.done && a.due).forEach(a => {
    const d = a.due.replace(/-/g, ''), e = pd(a.due); e.setDate(e.getDate() + 1); const c = comp(a.comp);
    L.push('BEGIN:VEVENT', 'UID:' + a.id + '@ats-math-tracker', 'DTSTAMP:' + st, 'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + iso(e).replace(/-/g, ''),
      'SUMMARY:' + clean('Competition: ' + a.title), 'DESCRIPTION:' + clean((c ? c.name + ' – ' : '') + (a.hint || 'Open the Math Competitions Tracker for details.')),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + clean(a.title), 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT');
  });
  L.push('END:VCALENDAR'); return L.join('\r\n');
}
function downloadIcs() {
  const blob = new Blob([buildIcs()], { type: 'text/calendar' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'competition-reminders.ics'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('Calendar file downloaded');
}

/* ---------- Students ---------- */
function stepsBlock(c) {
  const st = c.steps || []; if (!st.length) return `<h4>Next steps</h4><p class="hint">No step list for this competition.</p>`;
  const dn = S.data.stepsDone[c.id] || []; const pct = Math.round(dn.length / st.length * 100);
  return `<h4>Next steps · ${dn.length}/${st.length}</h4><div class="prog"><i style="width:${pct}%"></i></div>
    <ol class="steps">${st.map((s, i) => `<li class="${dn.includes(i) ? 'dn' : ''}"><input type="checkbox" data-step="${c.id}" data-i="${i}" ${dn.includes(i) ? 'checked' : ''} aria-label="Step ${i + 1}"><span>${i + 1}. ${esc(s)}</span></li>`).join('')}</ol>`;
}
function emailBtnFor(cid) {
  const t = { ikmc: 'nominee', 'challenge-me': 'challenge', 'steam-champions': 'steam', amc: 'amc' }[cid] || 'register';
  return `<button class="btn primary" type="button" data-mail="${t}" data-cid="${cid}">Email the coordinators</button>`;
}
function viewStudents() {
  const elig = Object.keys(PICK).filter(id => comp(id) && myState(comp(id)).status !== 'Closed');
  if (!elig.includes(S.pickComp)) S.pickComp = elig[0];
  const c = comp(S.pickComp); const rule = PICK[c.id], chosen = mine(c.id);
  const chosenNames = new Set(chosen.map(p => p.student)); const full = rule.max && chosen.length >= rule.max;
  const chips = elig.map(id => `<button type="button" class="chip ${id === S.pickComp ? 'on' : ''}" data-pc="${id}">${esc(compShort(comp(id)))}<span class="n">${mine(id).length}</span></button>`).join('');
  const R = S.data.roster;
  const sugg = R.filter(s => !chosenNames.has(s.n)).sort((a, b) => (b.s || 0) - (a.s || 0) || compsOfStudent(a.n).length - compsOfStudent(b.n).length).slice(0, 6);
  const addBtn = s => chosenNames.has(s.n) ? `<button class="btn small soft" type="button" data-rm-name="${esc(s.n)}">Added ✓</button>` : `<button class="btn small" type="button" data-add="${esc(s.n)}" ${full ? 'disabled' : ''}>+ Add</button>`;
  const classes = [...new Set(R.map(s => s.cls))].sort();
  let rows = R.filter(s => (S.rclass === 'all' || s.cls === S.rclass) && (!S.rq || s.n.toLowerCase().includes(S.rq)));
  rows.sort(S.rsort === 'name' ? (a, b) => a.n < b.n ? -1 : 1 : (a, b) => (b.s || 0) - (a.s || 0));
  const tags = n => compsOfStudent(n).map(id => comp(id)).filter(Boolean).map(x => `<span class="tag">${esc(compShort(x))}</span>`).join('');
  const sc = s => s.s != null ? `<span class="score ${lvl(s.s)}">${s.s}%</span>` : '<span class="score">—</span>';
  return `<div class="chips" role="tablist" aria-label="Competition">${chips}</div>
  <div class="cols">
    <section class="panel">
      <div><h2>${esc(c.name)}</h2><div class="meta">${esc(c.grades || '')}${c.team ? ' · ' + esc(c.team) : ''}</div></div>
      <div class="callout info">${esc(rule.note)}</div>
      <div><h4>Your students for this competition · ${chosen.length}${rule.max ? ' of ' + rule.max : ''}</h4>
        ${chosen.length ? `<ul class="sel">${chosen.map(p => `<li><span class="nm">${esc(p.student)}<small>${esc(p.cls)}${p.score != null ? ' · SBQ1 ' + p.score + '%' : ''}</small></span>
          <select data-pstat="${p.id}" aria-label="Status">${PSTAT.map(x => `<option ${x === p.status ? 'selected' : ''}>${x}</option>`).join('')}</select>
          <button class="btn small ghost" type="button" data-pdel="${p.id}" aria-label="Remove ${esc(p.student)}">Remove</button></li>`).join('')}</ul>` : `<p class="empty">No students yet. Tap “+ Add” next to a student below.</p>`}
      </div>
      <div class="btn-row two">${emailBtnFor(c.id)}<button class="btn" type="button" data-mail="mahmoud" data-cid="">List for Mr. Mahmoud</button></div>
    </section>
    <section class="panel">${stepsBlock(c)}</section>
  </div>
  <section class="panel">
    <div class="panel-head"><h2>Your students</h2><div class="btn-row two" style="min-width:min(100%,320px)"><button class="btn" type="button" id="addStudentBtn">+ Add student</button><label class="btn" for="csvIn">Import CSV</label><input id="csvIn" type="file" accept=".csv,text/csv" hidden></div></div>
    ${R.length ? `<div><h4>Suggested for ${esc(compShort(c))}</h4><p class="hint" style="margin-bottom:8px">Highest SBQ1 score first; students in fewer competitions come first on ties.</p>
      <div class="sug">${sugg.map(s => `<div class="sugc"><span><b>${esc(s.n)}</b><small>${esc(s.cls)} · ${sc(s)} ${tags(s.n)}</small></span>${addBtn(s)}</div>`).join('') || '<p class="hint">Everyone is already added.</p>'}</div></div>
    <div class="filters"><input class="search" type="search" id="rq" placeholder="Search a student…" value="${esc(S.rq)}" aria-label="Search students">
      <select id="rclass" aria-label="Class"><option value="all">All classes (${R.length})</option>${classes.map(x => `<option ${x === S.rclass ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="rsort" aria-label="Sort"><option value="score" ${S.rsort === 'score' ? 'selected' : ''}>Highest score first</option><option value="name" ${S.rsort === 'name' ? 'selected' : ''}>A–Z</option></select></div>
    <div class="tbl"><table><thead><tr><th>Student</th><th>Class</th><th>SBQ1</th><th>Competitions</th><th></th></tr></thead><tbody>
      ${rows.map(s => `<tr><td style="font-weight:600">${esc(s.n)}</td><td style="white-space:nowrap">${esc(s.cls)}</td><td>${sc(s)}</td><td>${tags(s.n)}</td><td><div class="actions">${addBtn(s)}<button class="btn small ghost" type="button" data-edit="${esc(s.n)}" aria-label="Edit">Edit</button><button class="btn small ghost" type="button" data-delstu="${esc(s.n)}" aria-label="Delete">Remove</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="hint">No student matches.</td></tr>'}
    </tbody></table></div>` : `<p class="empty">No students yet. Add them one by one, or import a CSV with Name, Class and SBQ1 columns.</p>`}
  </section>`;
}
function addStudentTo(name) {
  const c = comp(S.pickComp), s = S.data.roster.find(x => x.n === name); if (!c || !s) return;
  const rule = PICK[c.id]; if (rule.max && mine(c.id).length >= rule.max) { toast(`Only ${rule.max} allowed — remove one first`); return; }
  if (mine(c.id).some(p => p.student === name)) return;
  S.data.participants.push({ id: uid(), compId: c.id, student: s.n, cls: s.cls, score: s.s ?? null, status: 'Nominated', createdAt: now() });
  persist(); render(); toast('Added ' + s.n.split(' ')[0]);
}
function parseCsv(txt) {
  const lines = txt.replace(/\r/g, '').split('\n').filter(Boolean); if (!lines.length) return null;
  const split = l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(x => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')).slice(0, -1);
  const h = split(lines[0]).map(x => x.trim().toLowerCase());
  const iN = h.findIndex(x => x === 'name' || x === 'student' || x === 'student name'), iC = h.findIndex(x => x === 'class' || x === 'section'), iS = h.findIndex(x => x.startsWith('sbq') || x.startsWith('score') || x.startsWith('result') || x.startsWith('average'));
  if (iN < 0 || iC < 0) return null;
  return lines.slice(1).map(split).filter(r => r[iN]).map(r => {
    const cl = r[iC].trim(), m = cl.match(/^(\d+)\s+(\d+)\s+(\w+)/); const sv = iS >= 0 ? Number(String(r[iS]).replace('%', '')) : NaN;
    return { n: r[iN].trim(), cls: m ? `${m[2]} ${m[3][0].toUpperCase() + m[3].slice(1)}-${m[1]}` : cl, s: isNaN(sv) ? null : sv };
  });
}
let editing = null;
function openStudent(name) {
  editing = name || null; const s = name ? S.data.roster.find(x => x.n === name) : null;
  $('sTitle').textContent = s ? 'Edit student' : 'Add a student'; $('sSave').textContent = s ? 'Save changes' : 'Save student';
  $('sName').value = s ? s.n : ''; $('sClass').value = s ? s.cls : (S.rclass !== 'all' ? S.rclass : ''); $('sScore').value = s && s.s != null ? s.s : ''; $('sMsg').textContent = '';
  $('classList').innerHTML = [...new Set(S.data.roster.map(x => x.cls))].sort().map(c => `<option value="${esc(c)}">`).join('');
  $('studentDlg').showModal(); $('sName').focus();
}
$('sCancel').addEventListener('click', () => $('studentDlg').close());
$('studentForm').addEventListener('submit', e => {
  e.preventDefault();
  const n = $('sName').value.trim().replace(/\s+/g, ' '), cls = $('sClass').value.trim(), sv = $('sScore').value === '' ? null : Number($('sScore').value);
  if (!n || !cls) { $('sMsg').textContent = 'Name and class are required.'; $('sMsg').className = 'msg err'; return; }
  if (S.data.roster.some(x => x.n === n && x.n !== editing)) { $('sMsg').textContent = 'This student is already in your list.'; $('sMsg').className = 'msg err'; return; }
  if (editing) { const s = S.data.roster.find(x => x.n === editing); s.n = n; s.cls = cls; s.s = sv; S.data.participants.forEach(p => { if (p.student === editing) { p.student = n; p.cls = cls; p.score = sv; } }); }
  else S.data.roster.push({ n, cls, s: sv });
  persist(); render(); $('studentDlg').close(); toast(editing ? 'Student updated' : 'Student added');
});

/* ---------- Competitions ---------- */
function card(c0) {
  const c = myState(c0); const open = S.open.has(c.id), nx = nextDate(c), cls = scls(c.status), ps = mine(c.id);
  const head = `<button class="head" type="button" data-toggle="${c.id}" aria-expanded="${open}"><span class="mark"></span>
    <div style="min-width:0"><h3>${esc(c.name)}</h3><div class="meta"><span>${esc(c.organizer || '')}</span><span>${ps.length} student${ps.length === 1 ? '' : 's'}</span>${nx ? `<span>${esc(nx.label)} · ${esc(fmt(nx.date))}</span>` : ''}</div></div>
    <div class="right"><span class="pill p-${cls}">${esc(c.status)}</span><span class="hint">${open ? 'Hide' : 'Open'}</span></div></button>`;
  if (!open) return `<article class="card s-${cls}" id="c-${c.id}">${head}</article>`;
  const dates = (c.dates || []).map(x => `<li class="${x.date && dleft(x.end || x.date) < 0 ? 'past' : ''}"><span class="dd">${x.date ? esc(fmt(x.date)) + (x.end ? ' – ' + esc(fmt(x.end)) : '') : 'TBC'}</span>${esc(x.label)}</li>`).join('');
  const links = (c.links || []).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a>`).join('');
  const src = (c.emails || []).map(e => `<li>${esc(e.date)} · ${esc(e.from)} · “${esc(e.subject)}”</li>`).join('');
  return `<article class="card s-${cls}" id="c-${c.id}">${head}<div class="body"><div class="sec">
      ${c.action ? `<div class="callout warn"><b>Action needed:</b> ${esc(c.action)}</div>` : ''}
      ${c.summary ? `<p>${esc(c.summary)}</p>` : ''}
      <dl class="facts">${c.grades ? `<dt>Eligibility</dt><dd>${esc(c.grades)}</dd>` : ''}${c.team ? `<dt>Team</dt><dd>${esc(c.team)}</dd>` : ''}${c.fee ? `<dt>Cost</dt><dd>${esc(c.fee)}</dd>` : ''}${(c.sentBy || []).length ? `<dt>Sent by</dt><dd>${esc(c.sentBy.join(' & '))}</dd>` : ''}</dl>
      ${dates ? `<div><h4>Key dates</h4><ul class="dates">${dates}</ul></div>` : ''}
      ${links ? `<div class="links"><h4>Links</h4>${links}</div>` : ''}
      ${src ? `<div><h4>Source emails</h4><ul class="src">${src}</ul></div>` : ''}
    </div><div class="sec">
      ${c.steps ? `<div>${stepsBlock(c)}</div>` : ''}
      <div><h4>My students · ${ps.length}</h4>${ps.length ? `<ul class="sel">${ps.map(p => `<li><span class="nm">${esc(p.student)}<small>${esc(p.cls)}</small></span><span class="pill p-progress">${esc(p.status)}</span><button class="btn small ghost" type="button" data-pdel="${p.id}" aria-label="Remove">Remove</button></li>`).join('')}</ul>` : `<p class="hint">No students yet.</p>`}</div>
      <div class="btn-row two">${PICK[c.id] ? `<button class="btn" type="button" data-gopick="${c.id}">Pick students</button>` : '<span></span>'}${emailBtnFor(c.id)}</div>
      <div class="grid2"><div class="field"><label for="st-${c.id}">My status</label><select id="st-${c.id}" data-status="${c.id}">${STATUS.map(s => `<option ${s.k === c.status ? 'selected' : ''}>${s.k}</option>`).join('')}</select></div>
        <div class="field"><label for="ld-${c.id}">Teacher in charge</label><input id="ld-${c.id}" data-lead="${c.id}" value="${esc(c.lead || '')}" placeholder="optional"></div></div>
      <div class="field"><label for="nt-${c.id}">My notes</label><textarea id="nt-${c.id}" data-notes="${c.id}" placeholder="Only you can see these notes.">${esc(c.notes || '')}</textarea></div>
    </div></div></article>`;
}
function viewComps() {
  const order = Object.fromEntries(STATUS.map((s, i) => [s.k, i]));
  const f = [...S.comps].sort((a, b) => { const A = myState(a), B = myState(b); const o = (order[A.status] ?? 9) - (order[B.status] ?? 9); if (o) return o; const na = nextDate(a), nb = nextDate(b); if (na && nb) return na.date < nb.date ? -1 : 1; return na ? -1 : nb ? 1 : 0; });
  return `<div class="panel-head"><h2>All competitions</h2><span class="hint">${f.length} this year · tap a card for details</span></div><div class="list">${f.map(card).join('')}</div>`;
}

/* ---------- render & events ---------- */
let pending = false;
function render() {
  if (!S.data) return;
  const a = document.activeElement;
  if (a && $('view').contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox' && a.id !== 'rq') { pending = true; return; }
  pending = false;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === S.tab));
  const late = S.data.actions.filter(x => !x.done && x.due && dleft(x.due) <= 7).length; $('homeCnt').hidden = !late; $('homeCnt').textContent = late;
  const keep = a && a.id === 'rq' ? { pos: a.selectionStart } : null;
  $('view').innerHTML = S.tab === 'home' ? viewHome() : S.tab === 'students' ? viewStudents() : viewComps();
  if (keep && $('rq')) { $('rq').focus(); $('rq').setSelectionRange(keep.pos, keep.pos); }
  $('userInitials').textContent = (teacherName() || S.user.email || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
$('view').addEventListener('focusout', () => setTimeout(() => { if (pending) render(); }, 0));
function go(tab) { S.tab = tab; try { history.replaceState(null, '', '#' + tab); } catch { location.hash = tab; } render(); window.scrollTo({ top: 0 }); }
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.tab)));
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (['home', 'students', 'competitions'].includes(h) && h !== S.tab) { S.tab = h; render(); } });

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-toggle],[data-pc],[data-add],[data-rm-name],[data-pdel],[data-mail],[data-gopick],[data-gocomp],[data-cal],[data-day],[data-delact],[data-hide],[data-unhide],[data-edit],[data-delstu],#togDone,#icsBtn,#addStudentBtn'); if (!t) return;
  const d = t.dataset;
  if (d.toggle) { S.open.has(d.toggle) ? S.open.delete(d.toggle) : S.open.add(d.toggle); render(); }
  else if (d.pc) { S.pickComp = d.pc; render(); }
  else if (d.add) addStudentTo(d.add);
  else if (d.rmName) { const p = mine(S.pickComp).find(x => x.student === d.rmName); if (p) { S.data.participants = S.data.participants.filter(x => x.id !== p.id); persist(); render(); toast('Removed'); } }
  else if (d.pdel) { S.data.participants = S.data.participants.filter(x => x.id !== d.pdel); persist(); render(); toast('Removed'); }
  else if (d.mail) openMail(d.mail, d.cid || null, d.act || null);
  else if (d.gopick) { S.pickComp = d.gopick; go('students'); }
  else if (d.gocomp) { S.open.add(d.gocomp); go('competitions'); setTimeout(() => $('c-' + d.gocomp)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50); }
  else if (d.cal !== undefined) { if (d.cal === '0') { S.calMonth = null; S.calSel = iso(today); } else { const b = S.calMonth || new Date(today.getFullYear(), today.getMonth(), 1); S.calMonth = new Date(b.getFullYear(), b.getMonth() + Number(d.cal), 1); } render(); }
  else if (d.day) { S.calSel = S.calSel === d.day ? null : d.day; render(); }
  else if (d.hide) hideAct(d.hide, true);
  else if (d.unhide) hideAct(d.unhide, false);
  else if (d.delact) { if (await confirmDlg('Delete this reminder?', 'It will be removed from your list and calendar.', 'Delete')) { S.data.actions = S.data.actions.filter(x => x.id !== d.delact); persist(); render(); } }
  else if (d.edit) openStudent(d.edit);
  else if (d.delstu) { if (await confirmDlg('Remove ' + shortName(d.delstu) + '?', 'The student is removed from your list and from any competition you picked them for.')) { S.data.roster = S.data.roster.filter(x => x.n !== d.delstu); S.data.participants = S.data.participants.filter(p => p.student !== d.delstu); persist(); render(); toast('Removed'); } }
  else if (t.id === 'togDone') { S.showDone = !S.showDone; render(); }
  else if (t.id === 'icsBtn') downloadIcs();
  else if (t.id === 'addStudentBtn') openStudent(null);
});
document.addEventListener('change', async e => {
  const t = e.target, d = t.dataset;
  if (d.tick) toggleAct(d.tick, t.checked);
  else if (d.step) { const a = new Set(S.data.stepsDone[d.step] || []), i = Number(d.i); t.checked ? a.add(i) : a.delete(i); S.data.stepsDone[d.step] = [...a].sort((x, y) => x - y); persist(); render(); }
  else if (d.status) { setMine(d.status, 'status', t.value); render(); }
  else if (d.lead !== undefined) setMine(d.lead, 'lead', t.value.trim());
  else if (d.notes !== undefined) setMine(d.notes, 'notes', t.value);
  else if (d.pstat) { const p = S.data.participants.find(x => x.id === d.pstat); if (p) { p.status = t.value; persist(); } }
  else if (t.id === 'rclass') { S.rclass = t.value; render(); }
  else if (t.id === 'rsort') { S.rsort = t.value; render(); }
  else if (t.id === 'csvIn' && t.files[0]) {
    const rows = parseCsv(await t.files[0].text()); t.value = '';
    if (!rows || !rows.length) { banner('That file needs Name and Class columns (plus an optional SBQ1 or Score column).'); return; }
    let added = 0; rows.forEach(r => { const ex = S.data.roster.find(x => x.n === r.n); if (ex) { ex.cls = r.cls; if (r.s != null) ex.s = r.s; } else { S.data.roster.push(r); added++; } });
    persist(); render(); toast(`${added} new student${added === 1 ? '' : 's'} imported (${rows.length - added} updated)`);
  }
});
let rqT; document.addEventListener('input', e => { if (e.target.id === 'rq') { clearTimeout(rqT); rqT = setTimeout(() => { S.rq = e.target.value.trim().toLowerCase(); render(); }, 150); } });
document.addEventListener('submit', e => {
  if (e.target.id === 'addAct') { e.preventDefault(); const t = $('aaT').value.trim(), dd = $('aaD').value; if (!t || !dd) return; S.data.actions.push({ id: 'c' + uid(), title: t, due: dd, done: false, custom: true }); persist(); render(); toast('Reminder added'); }
});

/* ---------- theme ---------- */
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('mct-theme', t); } catch {}
  document.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('on', b.dataset.theme === t));
}
document.querySelectorAll('.seg.theme [data-theme]').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.theme)));
applyTheme((() => { try { return localStorage.getItem('mct-theme') || 'auto'; } catch { return 'auto'; } })());

/* ---------- account dialog ---------- */
$('userBtn').addEventListener('click', () => { $('acName').value = teacherName(); $('acEmail').textContent = S.user.email; $('accountDlg').showModal(); });
$('accountForm').addEventListener('submit', async e => { e.preventDefault(); S.data.displayName = $('acName').value.trim(); persist(); try { await store.updateName(S.data.displayName); } catch {} $('accountDlg').close(); render(); toast('Saved'); });
$('signOutBtn').addEventListener('click', async () => { $('accountDlg').close(); await persist(true); await store.signOut(); });

/* ---------- auth screen ---------- */
let mode = 'in';
document.querySelectorAll('[data-auth]').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.auth; document.querySelectorAll('[data-auth]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
  $('nameField').hidden = mode === 'in'; $('passHint').hidden = mode === 'in'; $('authSubmit').textContent = mode === 'in' ? 'Sign in' : 'Create account';
  $('auPass').autocomplete = mode === 'in' ? 'current-password' : 'new-password'; $('authMsg').textContent = '';
}));
$('pwToggle').addEventListener('click', () => { const p = $('auPass'); p.type = p.type === 'password' ? 'text' : 'password'; });
$('forgotBtn').addEventListener('click', async () => {
  const email = $('auEmail').value.trim(); const m = $('authMsg');
  if (!email) { m.textContent = 'Type your email first, then tap Forgot password.'; m.className = 'msg err'; return; }
  try { await store.reset(email); m.textContent = 'Reset email sent. Check your inbox (and junk folder).'; m.className = 'msg ok'; } catch (e) { m.textContent = e.message; m.className = 'msg err'; }
});
$('authForm').addEventListener('submit', async e => {
  e.preventDefault(); const m = $('authMsg'), email = $('auEmail').value.trim(), pass = $('auPass').value, name = $('auName').value.trim();
  if (!email || !pass) { m.textContent = 'Email and password are required.'; m.className = 'msg err'; return; }
  if (mode === 'up' && pass.length < 8) { m.textContent = 'Please use at least 8 characters.'; m.className = 'msg err'; return; }
  $('authSubmit').disabled = true; m.textContent = mode === 'in' ? 'Signing in…' : 'Creating your account…'; m.className = 'msg';
  try { if (mode === 'in') await store.signIn(email, pass); else await store.signUp(email, pass, name); m.textContent = ''; }
  catch (err) { m.textContent = err.message; m.className = 'msg err'; }
  $('authSubmit').disabled = false;
});

/* ---------- boot ---------- */
async function loadShared() {
  const [c, t] = await Promise.all([fetch('data/competitions.json').then(r => r.json()), fetch('data/actions.json').then(r => r.json())]);
  S.comps = c; S.templates = t;
}
async function enter(user) {
  S.user = user;
  let doc = null;
  try { doc = await store.load(); } catch (e) { banner('Could not load your data: ' + e.message); }
  const fresh = !doc;
  S.data = Object.assign(blank(), doc || {});
  if (!S.data.displayName && user.displayName) S.data.displayName = user.displayName;
  // Add any new department-wide reminders this teacher has not seen yet (never duplicates, never touches their own).
  const seen = new Set(S.data.actions.map(a => a.id));
  S.templates.forEach(t => { if (!seen.has(t.id)) S.data.actions.push(Object.assign({}, t, { done: false, hidden: false })); });
  if (fresh) persist();
  $('authView').hidden = true; $('app').hidden = false;
  const h = location.hash.slice(1); if (['home', 'students', 'competitions'].includes(h)) S.tab = h;
  render();
}
function leave() { S.user = null; S.data = null; $('app').hidden = true; $('authView').hidden = false; $('auPass').value = ''; }

(async () => {
  $('schoolLine').textContent = SET.schoolLine || ''; $('schoolLine2').textContent = (SET.schoolLine || '').split('·')[0].trim();
  try { await loadShared(); } catch { banner('Could not load the competitions list. Check your connection and reload.'); }
  try { store = CFG ? await firebaseStore() : demoStore(); }
  catch (e) { store = demoStore(); banner('Firebase could not start (' + e.message + '). Running in demo mode.'); }
  $('demoNote').hidden = !store.demo;
  store.onAuth(u => u ? enter(u) : leave());
})();
