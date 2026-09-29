// Forbinder appen med Firebase: login med Google, fælles database og hvem der er online.
// Siden selv (index.html) kalder window.claude.use('db' | 'room' | 'user' | 'app'), og denne fil leverer svarene.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, setDoc, deleteDoc, getDoc, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const CFG = window.APP_CONFIG || {};
const FB = CFG.firebase || {};
const PID = window.__PID || 'projekt';
const slug = window.__slug || (s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const $ = id => document.getElementById(id);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});

/* ---------- log ind-skærmen ---------- */
function showGate(title, text, button, onClick, withLogout){
  $('gate').hidden = false;
  $('gateTitle').textContent = title;
  $('gateText').textContent = text || '';
  const b = $('gateBtn');
  b.hidden = !button; b.textContent = button || ''; b.onclick = onClick || null;
  $('gateOut').hidden = !withLogout;
}
const hideGate = () => { $('gate').hidden = true; };
const titleFromId = id => id.split('-').filter(Boolean).map((w, i) => i === 0 ? w[0].toUpperCase() + w.slice(1) : (w.length <= 3 ? w.toUpperCase() : w)).join(' ') || 'Projekt';

const configured = typeof FB.apiKey === 'string' && FB.apiKey && !/INDS/i.test(FB.apiKey) && typeof FB.projectId === 'string' && !/INDS/i.test(FB.projectId);
if (!configured){
  showGate('Appen er ikke sat op endnu', 'Åbn filen firebase-config.js og indsæt jeres Firebase-oplysninger. Se VEJLEDNING.md, trin 1.');
} else {
  start();
}

function start(){
  const app = initializeApp(FB);
  const auth = getAuth(app);
  let fs;
  try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e) { fs = initializeFirestore(app, {}); }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const appName = CFG.appName || 'Projektplan';
  let started = false;

  $('gateOut').onclick = () => signOut(auth).then(() => location.reload());

  async function login(){
    try { await signInWithPopup(auth, provider); }
    catch (e) {
      const code = e && e.code;
      const msg = code === 'auth/popup-blocked' ? 'Browseren blokerede login-vinduet. Tillad pop op-vinduer for siden, og prøv igen.'
        : code === 'auth/unauthorized-domain' ? `Adressen ${location.hostname} er ikke godkendt i Firebase. Tilføj den under Authentication → Settings → Authorized domains.`
        : code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' ? 'Login-vinduet blev lukket. Prøv igen.'
        : code === 'auth/operation-not-allowed' ? 'Google-login er ikke slået til i Firebase. Se VEJLEDNING.md, trin 1.2.'
        : 'Login mislykkedes. Prøv igen.';
      showGate('Log ind', msg, 'Log ind med Google', login);
    }
  }

  onAuthStateChanged(auth, async u => {
    if (!u){
      if (started){ location.reload(); return; }
      showGate(appName, 'Log ind med din Google-konto for at åbne planen.', 'Log ind med Google', login);
      return;
    }
    if (started) return;
    const email = String(u.email || '').toLowerCase();
    showGate('Logger ind…', email);
    try {
      // Ejeren er den, hvis mail står i firestore.rules. Alle andre skal stå på medlemslisten.
      let isOwner = false;
      try { await getDoc(doc(fs, 'meta', 'owner')); isOwner = true; }
      catch (e) { if (!e || e.code !== 'permission-denied') throw e; }
      if (!isOwner){
        const m = await getDoc(doc(fs, 'members', email));
        if (!m.exists()) throw Object.assign(new Error('Ingen adgang'), { code: 'permission-denied' });
      }
      const pref = doc(fs, 'projects', PID);
      const ps = await getDoc(pref);
      const projectTitle = ps.exists() ? String(ps.data().title || titleFromId(PID)) : titleFromId(PID);
      if (!ps.exists()) await setDoc(pref, { title: projectTitle, createdAt: serverTimestamp(), createdBy: email });
      started = true;
      hideGate();
      window.__appReady({
        db: makeDb(fs),
        room: makeRoom(fs, u),
        user: { can: async () => true, isOwner: async () => isOwner, canEdit: async () => true },
        app: makeApp(fs, auth, email, u, isOwner, projectTitle)
      });
    } catch (e) {
      const code = e && e.code;
      if (code === 'permission-denied') showGate('Du har ikke adgang endnu', `Du er logget ind som ${email}. Bed den, der har sat appen op, om at give dig adgang under Projekt → Del appen. Er det dig, der har sat appen op, så tjek, at din mail står i firestore.rules (VEJLEDNING.md, trin 1.4).`, 'Prøv igen', () => location.reload(), true);
      else if (code === 'unavailable') showGate('Ingen forbindelse', 'Appen kan ikke nå databasen. Tjek internetforbindelsen, og prøv igen.', 'Prøv igen', () => location.reload(), true);
      else showGate('Noget gik galt', (e && e.message) || String(e), 'Prøv igen', () => location.reload(), true);
    }
  });
}

/* ---------- database: samme form som siden forventer ---------- */
function mapErr(e){
  const c = e && e.code;
  return { code: c === 'permission-denied' ? 'invalid_argument' : c === 'resource-exhausted' ? 'quota_exceeded' : 'unavailable', message: (e && e.message) || '' };
}
const docSnap = s => ({ id: s.id, exists: s.exists(), data: () => s.data() });
function makeDb(fs){
  const seg = path => ['projects', PID, ...String(path).split('/')];
  return {
    doc(path){
      const ref = doc(fs, ...seg(path));
      return {
        set: d => setDoc(ref, d).catch(e => { throw mapErr(e); }),
        delete: () => deleteDoc(ref).catch(e => { throw mapErr(e); }),
        onSnapshot: (next, err) => onSnapshot(ref, s => next(docSnap(s)), e => { if (err) err(mapErr(e)); })
      };
    },
    collection(path){
      const ref = collection(fs, ...seg(path));
      return {
        onSnapshot: (next, err) => onSnapshot(ref, s => next({ docs: s.docs.map(docSnap), size: s.size, empty: s.empty }), e => { if (err) err(mapErr(e)); })
      };
    }
  };
}

/* ---------- hvem er her nu: hver fane skriver et lille "jeg er her"-dokument ---------- */
function makeRoom(fs, u){
  const clientId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/[^A-Za-z0-9-]/g, '');
  const col = collection(fs, 'projects', PID, 'presence');
  const mine = doc(col, clientId);
  const STALE = 100000, BEAT = 40000;
  let state = {}, docs = [], peers = [], timer = null;
  const handlers = new Set();
  const write = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { setDoc(mine, { ...state, uid: u.uid, at: serverTimestamp() }).catch(() => {}); }, 200);
  };
  const emit = () => {
    const now = Date.now();
    peers = [];
    for (const d of docs){
      const v = d.data({ serverTimestamps: 'estimate' }) || {};
      const at = v.at && v.at.toMillis ? v.at.toMillis() : now;
      if (now - at > 86400000 && d.id !== clientId){ deleteDoc(d.ref).catch(() => {}); continue; }
      if (now - at > STALE && d.id !== clientId) continue;
      const presence = {};
      if (typeof v.member === 'string') presence.member = v.member;
      if (typeof v.editing === 'string') presence.editing = v.editing;
      peers.push({ kind: 'viewer', peer: d.id, by: null, guest: false, isMe: v.uid === u.uid, sameTab: d.id === clientId, presence, updatedAt: now });
    }
    handlers.forEach(h => { try { h({ peers, joined: [], left: [], updated: [] }); } catch (e) {} });
  };
  onSnapshot(col, s => { docs = s.docs; emit(); }, () => {});
  setInterval(write, BEAT);
  setInterval(emit, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') write(); });
  window.addEventListener('pagehide', () => { deleteDoc(mine).catch(() => {}); });
  write();
  return {
    presence(patch){
      for (const [k, v] of Object.entries(patch || {})){ if (v === null || v === undefined) delete state[k]; else state[k] = v; }
      write();
      return Promise.resolve();
    },
    onPeers(h){ handlers.add(h); setTimeout(() => h({ peers, joined: [], left: [], updated: [] }), 0); return () => handlers.delete(h); },
    peers: () => peers,
    connected: () => true
  };
}

/* ---------- projekter, deling og konto ---------- */
function makeApp(fs, auth, email, u, isOwner, projectTitle){
  return {
    user: { email, name: u.displayName || '', photo: u.photoURL || '' },
    isOwner, projectId: PID, projectTitle,
    url: location.origin + location.pathname,
    async listProjects(){
      const s = await getDocs(collection(fs, 'projects'));
      return s.docs.map(d => ({ id: d.id, title: String((d.data() || {}).title || d.id) })).sort((a, b) => a.title.localeCompare(b.title, 'da'));
    },
    async createProject(title){
      const base = slug(title) || 'projekt';
      const taken = new Set((await getDocs(collection(fs, 'projects'))).docs.map(d => d.id));
      let id = base, n = 2;
      while (taken.has(id)) id = `${base}-${n++}`;
      await setDoc(doc(fs, 'projects', id), { title: String(title).slice(0, 60), createdAt: serverTimestamp(), createdBy: email });
      return id;
    },
    renameProject(title){ return setDoc(doc(fs, 'projects', PID), { title: String(title).slice(0, 60) }, { merge: true }); },
    openProject(id){
      try { localStorage.setItem('app-last-project', id); } catch (e) {}
      location.href = location.pathname + '?p=' + encodeURIComponent(id);
    },
    async listMembers(){ const s = await getDocs(collection(fs, 'members')); return s.docs.map(d => d.id).sort(); },
    addMember(mail){ return setDoc(doc(fs, 'members', String(mail).trim().toLowerCase()), { addedAt: serverTimestamp(), addedBy: email }); },
    removeMember(mail){ return deleteDoc(doc(fs, 'members', mail)); },
    signOut(){ return signOut(auth).then(() => location.reload()); }
  };
}
