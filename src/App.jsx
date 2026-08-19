import React, { useState, useEffect, useRef, useCallback, useReducer } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInAnonymously, linkWithPopup, onAuthStateChanged, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import {
  Plus, Pencil, Trash2, Camera, X, Check, Star, Dumbbell,
  Loader2, ChevronDown, Search, Download, Upload, ChevronRight,
  Cloud, RefreshCw, AlertTriangle, Sparkles, Users, Send, Copy, Calendar,
  Home, User, WifiOff, Clock, Flame, Volume2, VolumeX,
} from "lucide-react";

// ---- Fill these in once your repo exists — see the setup steps at the end of the chat ----
// ---- Fill in with your Firebase project config (Firebase console → Project settings) ----
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC-3xO7UKMW4b9BYTkUHXZROeOnCSiQgFI",
  authDomain: "training-log-eb31b.firebaseapp.com",
  projectId: "training-log-eb31b",
  storageBucket: "training-log-eb31b.firebasestorage.app",
  messagingSenderId: "303445078047",
  appId: "1:303445078047:web:2353aedb4bab7d924b652a",
};

// ---- Weight tiers, recolored to follow "temper colors" — the sequence tool
// steel runs through as it's heat-treated (pale straw → gold → bronze →
// purple → deep blue). Light loads read as pale/warm, heavy loads read as
// deep/cool — one coherent ramp instead of five unrelated hues. ----
const WEIGHT_INFO = {
  Light: { bg: "bg-w1-soft", text: "text-w1-strong", ring: "ring-w1-ring", dot: "bg-w1", solid: "bg-w1-strong", accent: "text-w1", hex: "#e7b740", desc: "fails ~15-20 reps" },
  "Light-Medium": { bg: "bg-w2-soft", text: "text-w2-strong", ring: "ring-w2-ring", dot: "bg-w2", solid: "bg-w2-strong", accent: "text-w2", hex: "#d98b2b", desc: "fails ~12-18 reps" },
  Medium: { bg: "bg-w3-soft", text: "text-w3-strong", ring: "ring-w3-ring", dot: "bg-w3", solid: "bg-w3-strong", accent: "text-w3", hex: "#b5652e", desc: "fails ~8-15 reps" },
  "Medium-Heavy": { bg: "bg-w4-soft", text: "text-w4-strong", ring: "ring-w4-ring", dot: "bg-w4", solid: "bg-w4-strong", accent: "text-w4", hex: "#7a56a8", desc: "fails ~6-10 reps" },
  Heavy: { bg: "bg-w5-soft", text: "text-w5-strong", ring: "ring-w5-ring", dot: "bg-w5", solid: "bg-w5-strong", accent: "text-w5", hex: "#3a5686", desc: "fails ~4-8 reps" },
};
const WEIGHT_OPTIONS = ["Light", "Light-Medium", "Medium", "Medium-Heavy", "Heavy"];
const STORAGE_KEY = "training-log-plans-v4";
const ONBOARD_KEY = "training-log-onboarded";
const emptyForm = { name: "", muscle: "", focus: false, sets: 3, reps: "", weight: "Medium", rest: "60 sec", image: null };

function ex(id, name, muscle, focus, sets, reps, weight, rest) {
  return { id, name, muscle, focus, sets, reps, weight, rest, image: null };
}
function mkDay(id, label, title, tagline, exercises) { return { id, label, title, tagline, exercises }; }

const ESTABLISHED_DAYS = [
  mkDay("day1", "Day 1", "Lower A", "Glutes + calves focus", [
    ex("d1e1", "Back squat (shoulder-width)", "Quads / glute max", false, 3, "6-8", "Heavy", "2.5-3 min"),
    ex("d1e2", "Walking lunge (dumbbell or barbell)", "Glute max", true, 4, "10-12/leg", "Medium", "2 min"),
    ex("d1e3", "Leg press (either machine type, mid-platform foot placement)", "Quads", false, 3, "10-15", "Medium", "90 sec"),
    ex("d1e4", "Standing calf raise", "Calves", true, 4, "12-15", "Medium", "60 sec"),
    ex("d1e5", "Hanging leg raise", "Core", true, 3, "10-15", "Medium", "60 sec"),
  ]),
  mkDay("day2", "Day 2", "Upper A", "Posture fix — delts, traps, forearms, core", [
    ex("d2e1", "Overhead press", "Delts (front)", true, 3, "6-8", "Heavy", "2-3 min"),
    ex("d2e2", "Cable lateral raise (single-arm, lean away)", "Delts (side)", true, 4, "12-15", "Light-Medium", "60 sec"),
    ex("d2e7", "Cable external rotation (elbow at side)", "Rotator cuff / shoulder posture", true, 3, "12-15/side", "Light", "60 sec"),
    ex("d2e4", "Dumbbell shrug", "Traps", true, 4, "10-15", "Medium-Heavy", "90 sec"),
    ex("d2e5", "Reverse curl", "Forearms", true, 3, "10-15", "Medium", "60 sec"),
    ex("d2e3", "Incline dumbbell press", "Chest (maintenance)", false, 2, "8-10", "Medium", "90 sec"),
  ]),
  mkDay("day3", "Day 3", "Lower B", "Glutes + hamstrings + core focus", [
    ex("d3e1", "Romanian deadlift", "Hamstrings / glute max", true, 3, "6-10", "Heavy", "2.5 min"),
    ex("d3e2", "Bulgarian split squat", "Glute max", true, 3, "8-12/leg", "Medium", "90 sec"),
    ex("d3e3", "Leg press (feet high + wide for glute bias)", "Glute max", true, 3, "12-15", "Medium", "90 sec"),
    ex("d3e4", "Calf raise on leg press (toes on platform edge)", "Calves", true, 3, "15-20", "Medium", "60 sec"),
    ex("d3e5", "Reverse crunch (floor)", "Core", true, 3, "12-15", "Light-Medium", "60 sec"),
    ex("d3e6", "Suitcase carry (single-arm, per side)", "Core (anti-lateral-flexion)", true, 2, "30-40m/side", "Medium-Heavy", "60 sec"),
  ]),
  mkDay("day4", "Day 4", "Upper B", "Posture fix — rear delts, traps, forearms", [
    ex("d4e1", "Face pull", "Rear delt / traps", true, 4, "15-20", "Light", "60 sec"),
    ex("d4e8", "Prone Y-raise (incline bench, thumbs up)", "Lower traps / posture", true, 3, "12-15", "Light", "60 sec"),
    ex("d4e4", "Barbell shrug", "Traps", true, 3, "8-12", "Heavy", "90 sec"),
    ex("d4e5", "Farmer's hold (static, no walking)", "Forearms / grip", true, 3, "30-40 sec", "Heavy", "90 sec"),
    ex("d4e7", "Pull-up (vary grip between sets)", "Back (maintenance)", false, 3, "max reps", "Heavy", "2 min"),
  ]),
];

const STEP_DOWN = { Heavy: "Medium-Heavy", "Medium-Heavy": "Medium", Medium: "Light-Medium", "Light-Medium": "Light", Light: "Light" };
const RETURNING_DAYS = ESTABLISHED_DAYS.map((d) => ({ ...d, tagline: `${d.tagline} · ramp-up weeks 1-3`, exercises: d.exercises.map((e) => ({ ...e, weight: STEP_DOWN[e.weight] || e.weight, sets: Math.max(2, e.sets - 1) })) }));

const STARTER_DAYS = [
  mkDay("sday1", "Day 1", "Full body A", "Whole-body foundation", [
    ex("s1e1", "Back squat", "Quads / glutes", false, 3, "8-10", "Medium", "2 min"),
    ex("s1e2", "Flat bench press", "Chest", false, 3, "8-10", "Medium", "2 min"),
    ex("s1e3", "Seated cable row", "Back", false, 3, "10-12", "Medium", "90 sec"),
    ex("s1e4", "Plank", "Core", false, 3, "20-40 sec hold", "Light-Medium", "60 sec"),
    ex("s1e5", "Standing calf raise", "Calves", false, 2, "12-15", "Light-Medium", "60 sec"),
  ]),
  mkDay("sday2", "Day 2", "Full body B", "Whole-body foundation", [
    ex("s2e1", "Romanian deadlift", "Hamstrings / glutes", false, 3, "8-10", "Medium", "2 min"),
    ex("s2e2", "Overhead press", "Delts", false, 3, "8-10", "Light-Medium", "2 min"),
    ex("s2e3", "Lat pulldown", "Back", false, 3, "10-12", "Medium", "90 sec"),
    ex("s2e4", "Hanging knee raise", "Core", false, 3, "8-12", "Light-Medium", "60 sec"),
    ex("s2e5", "Dumbbell shrug", "Traps", false, 2, "10-12", "Light-Medium", "60 sec"),
  ]),
  mkDay("sday3", "Day 3", "Full body C", "Whole-body foundation", [
    ex("s3e1", "Leg press", "Quads", false, 3, "10-12", "Medium", "90 sec"),
    ex("s3e2", "Incline dumbbell press", "Chest", false, 3, "10-12", "Light-Medium", "90 sec"),
    ex("s3e3", "Seated cable row (wide grip)", "Back", false, 3, "10-12", "Medium", "90 sec"),
    ex("s3e4", "Bicep curl", "Biceps", false, 2, "10-12", "Light-Medium", "60 sec"),
    ex("s3e5", "Triceps pushdown", "Triceps", false, 2, "10-12", "Light-Medium", "60 sec"),
  ]),
];

const GENERAL_DAYS = [
  mkDay("gday1", "Day 1", "Lower A", "Balanced — no aesthetic skew", [
    ex("g1e1", "Back squat", "Quads / glutes", false, 3, "6-8", "Heavy", "2.5 min"),
    ex("g1e2", "Leg curl", "Hamstrings", false, 3, "10-12", "Medium", "90 sec"),
    ex("g1e3", "Leg press", "Quads", false, 3, "10-15", "Medium", "90 sec"),
    ex("g1e4", "Standing calf raise", "Calves", false, 3, "12-15", "Medium", "60 sec"),
    ex("g1e5", "Cable crunch", "Core", false, 3, "12-15", "Medium", "60 sec"),
  ]),
  mkDay("gday2", "Day 2", "Upper A", "Balanced — no aesthetic skew", [
    ex("g2e1", "Flat bench press", "Chest", false, 3, "6-8", "Heavy", "2.5 min"),
    ex("g2e2", "Seated cable row", "Back", false, 3, "8-12", "Medium-Heavy", "90 sec"),
    ex("g2e3", "Overhead press", "Delts", false, 3, "8-10", "Medium", "90 sec"),
    ex("g2e4", "Lat pulldown", "Back", false, 3, "10-12", "Medium", "90 sec"),
    ex("g2e5", "EZ bar curl", "Biceps", false, 2, "10-12", "Medium", "60 sec"),
  ]),
  mkDay("gday3", "Day 3", "Lower B", "Balanced — no aesthetic skew", [
    ex("g3e1", "Deadlift", "Posterior chain", false, 3, "5-6", "Heavy", "3 min"),
    ex("g3e2", "Walking lunge", "Quads / glutes", false, 3, "10-12/leg", "Medium", "90 sec"),
    ex("g3e3", "Leg extension", "Quads", false, 3, "12-15", "Medium", "60 sec"),
    ex("g3e4", "Seated calf raise", "Calves", false, 3, "15-20", "Medium", "60 sec"),
    ex("g3e5", "Hanging leg raise", "Core", false, 3, "10-15", "Medium", "60 sec"),
  ]),
  mkDay("gday4", "Day 4", "Upper B", "Balanced — no aesthetic skew", [
    ex("g4e1", "Incline dumbbell press", "Chest", false, 3, "8-10", "Medium-Heavy", "2 min"),
    ex("g4e2", "Pull-up (assisted if needed)", "Back", false, 3, "6-10", "Medium-Heavy", "2 min"),
    ex("g4e3", "Lateral raise", "Delts", false, 3, "12-15", "Light-Medium", "60 sec"),
    ex("g4e4", "Face pull", "Rear delt", false, 3, "15-20", "Light", "60 sec"),
    ex("g4e5", "Triceps pushdown", "Triceps", false, 2, "10-12", "Medium", "60 sec"),
  ]),
];

const LEVELS = [
  { id: "starter", name: "Beginner", days: STARTER_DAYS, blurb: "3 days/week, full body. No experience needed." },
  { id: "general", name: "General", days: GENERAL_DAYS, blurb: "4 days/week, balanced across every muscle, no particular focus." },
  { id: "returning", name: "Returning after a break", days: RETURNING_DAYS, blurb: "4 days/week at lighter loads for a 2-4 week ramp-up." },
  { id: "established", name: "Author's plan", days: ESTABLISHED_DAYS, blurb: "4 days/week — glutes/core/calves/traps/delts/forearms focus." },
];

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function makePlan(name, levelId, author) {
  const level = LEVELS.find((l) => l.id === levelId) || LEVELS[0];
  return { id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, level: levelId, author: author || null, blockStartDate: new Date().toISOString(), days: deepClone(level.days) };
}

function resizeImage(file, maxDim = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("load failed"));
      img.onload = () => {
        let { width, height } = img;
        const side = Math.min(width, height);
        const scale = Math.min(1, maxDim / side);
        width = Math.round(width * scale); height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---- GitHub Gist sync (personal data) ----
// ---- Firebase (anonymous try-it-out + Google to actually save) ----
const firebaseApp = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
const auth = getAuth(firebaseApp);
const dbase = getFirestore(firebaseApp);

function startAnon() { return signInAnonymously(auth); }
function upgradeToGoogle() { return linkWithPopup(auth.currentUser, new GoogleAuthProvider()); }
function signInGoogle() { return signInWithPopup(auth, new GoogleAuthProvider()); }
function signUpEmail(email, pw) { return createUserWithEmailAndPassword(auth, email, pw); }
function signInEmail(email, pw) { return signInWithEmailAndPassword(auth, email, pw); }
function signOutUser() { return signOut(auth); }
function subscribeAuth(cb) { return onAuthStateChanged(auth, cb); }
function isRealAccount(user) { return !!user && !user.isAnonymous; }

async function loadUserData(uid) {
  const snap = await getDoc(doc(dbase, "users", uid));
  return snap.exists() ? snap.data() : null;
}
async function saveUserData(uid, name, data) {
  await setDoc(doc(dbase, "users", uid), { name, data, lastActive: serverTimestamp() }, { merge: true });
}
async function saveProfileInfo(uid, firstName, familyName, email) {
  await setDoc(doc(dbase, "users", uid), { firstName, familyName, email, lastActive: serverTimestamp() }, { merge: true });
}
async function fetchCommunityPlans() {
  const q = query(collection(dbase, "community"), where("approved", "==", true));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function submitPlanForReview(plan, uid, name) {
  const clean = { ...plan, days: plan.days.map((d) => ({ ...d, exercises: d.exercises.map(({ image, ...rest }) => rest) })) };
  await addDoc(collection(dbase, "community"), { ...clean, ownerId: uid, author: name, approved: false, submittedAt: serverTimestamp() });
}

function WeightBadge({ weight, size = "sm" }) {
  const s = WEIGHT_INFO[weight] || WEIGHT_INFO.Medium;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold ring-1 font-mono ${s.bg} ${s.text} ${s.ring} ${size === "lg" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs"}`}>
      <span className={`w-2 h-2 rounded-full ${s.dot}`} />{weight}
    </span>
  );
}

// The signature element: one continuous ramp — the same colors steel runs
// through as it's tempered — standing in for how heavy a lift feels.
function WeightLegend() {
  return (
    <div className="mb-5 rounded-2xl border border-line bg-card px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Flame className="w-3.5 h-3.5 text-ink-faint" />
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">Load, at a glance</p>
      </div>
      <div
        className="h-2 rounded-full mb-2.5"
        style={{ background: "linear-gradient(to right, #e7b740, #d98b2b, #b5652e, #7a56a8, #3a5686)" }}
      />
      <div className="flex justify-between gap-1">
        {WEIGHT_OPTIONS.map((w) => (
          <div key={w} className="text-center flex-1">
            <div className="text-[10px] font-bold text-ink leading-tight">{w}</div>
            <div className="text-[9px] text-ink-faint leading-tight font-mono">{WEIGHT_INFO[w].desc.replace("fails ", "")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhotoChooser({ libraryImage, onPickUpload, onUseLibrary, onCancel }) {
  const inputRef = useRef(null);
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink/50 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="p-5 space-y-2.5">
          <h3 className="font-display font-black text-lg text-ink mb-2">Add a photo</h3>
          {libraryImage && (
            <button onClick={() => onUseLibrary(libraryImage)} className="w-full flex items-center gap-3 p-3 rounded-2xl border border-line text-left hover:border-charge/50 hover:bg-charge-soft/40 transition-colors">
              <img src={libraryImage} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
              <span><span className="font-bold text-ink block text-sm">Use library photo</span><span className="text-xs text-ink-faint">Already matched to this exercise</span></span>
            </button>
          )}
          <button onClick={() => inputRef.current?.click()} className="w-full flex items-center gap-3 p-3 rounded-2xl border border-line text-left hover:border-charge/50 hover:bg-charge-soft/40 transition-colors">
            <span className="w-14 h-14 rounded-xl bg-mist flex items-center justify-center shrink-0"><Camera className="w-6 h-6 text-ink-faint" /></span>
            <span><span className="font-bold text-ink block text-sm">Upload your own</span><span className="text-xs text-ink-faint">From your device</span></span>
          </button>
          <button onClick={onCancel} className="w-full py-3 text-sm font-bold text-ink-faint mt-1">Cancel</button>
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { onPickUpload(await resizeImage(f)); } catch (err) { /* ignore */ } e.target.value = ""; }} />
      </div>
    </div>
  );
}

function BigPhoto({ image, onPick, readOnly, libraryImage }) {
  const inputRef = useRef(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const handleTap = () => { if (libraryImage) setChooserOpen(true); else inputRef.current?.click(); };
  return (
    <>
      <button type="button" disabled={readOnly} onClick={handleTap}
        className="relative w-full aspect-square rounded-t-3xl overflow-hidden bg-mist flex items-center justify-center group">
        {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : (
          <div className="flex flex-col items-center gap-1.5 text-ink-faint">
            <Camera className="w-8 h-8" /><span className="text-sm font-semibold">{readOnly ? "No photo" : "Add photo"}</span>
          </div>
        )}
        {!readOnly && (
          <span className="absolute inset-0 bg-ink/0 group-hover:bg-ink/30 active:bg-ink/30 transition-colors flex items-center justify-center">
            <Pencil className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity" />
          </span>
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { onPick(await resizeImage(f)); } catch (err) { /* ignore */ } e.target.value = ""; }} />
      {chooserOpen && (
        <PhotoChooser
          libraryImage={libraryImage}
          onCancel={() => setChooserOpen(false)}
          onUseLibrary={(img) => { onPick(img); setChooserOpen(false); }}
          onPickUpload={(img) => { onPick(img); setChooserOpen(false); }}
        />
      )}
    </>
  );
}

function Field({ label, children }) { return <div><label className="block text-sm font-bold text-ink-soft mb-1.5">{label}</label>{children}</div>; }
const inputClass = "w-full rounded-2xl border border-line px-4 py-3.5 text-base bg-card focus:outline-none focus:ring-2 focus:ring-charge focus:border-charge transition-shadow";
const sheetClass = "bg-card w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl max-h-[92vh] overflow-y-auto shadow-2xl";
function parseYoutubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : (/^[\w-]{11}$/.test(url.trim()) ? url.trim() : null);
}

function ExerciseModal({ initial, onCancel, onSave, title }) {
  const [form, setForm] = useState(initial);
  const [videoUrl, setVideoUrl] = useState(initial.videoId ? `https://youtu.be/${initial.videoId}` : "");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSave = form.name.trim().length > 0 && form.muscle.trim().length > 0 && form.reps.trim().length > 0;
  const searchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent((form.name || "exercise") + " exercise proper form")}`;
  const match = findLibraryMatch(form.name);
  const applyLibrary = () => {
    if (!match) return;
    setForm((f) => ({ ...f, muscle: match.muscle, sets: match.sets, reps: match.reps, weight: match.weight, rest: match.rest, image: f.image || match.image }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-card flex items-center justify-between px-5 py-4 border-b border-line z-10">
          <h2 className="text-xl font-black text-ink font-display">{title}</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <BigPhoto image={form.image} onPick={(img) => setForm((f) => ({ ...f, image: img }))} libraryImage={match?.image} />
        {(form.videoId || match?.youtubeId) && (
          <div className="px-5 pt-3">
            <div className="aspect-video rounded-2xl overflow-hidden bg-ink">
              <iframe className="w-full h-full" src={youtubeEmbedUrl(form.videoId || match.youtubeId)} title="Exercise video" allowFullScreen />
            </div>
          </div>
        )}
        <div className="px-5 pt-3">
          <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-bold text-charge hover:text-charge-strong">
            <Search className="w-4 h-4" /> Search images for "{form.name || "this exercise"}" <ChevronRight className="w-4 h-4" />
          </a>
        </div>
        <div className="p-5 pt-4 space-y-4">
          <Field label="Exercise name">
            <input value={form.name} onChange={set("name")} placeholder="Start typing — known exercises autocomplete" list="exercise-library-names" className={inputClass} />
            <datalist id="exercise-library-names">{EXERCISE_LIBRARY.map((e) => <option key={e.name} value={e.name} />)}</datalist>
            {match && (
              <button type="button" onClick={applyLibrary} className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-charge-strong bg-charge-soft px-3 py-1.5 rounded-full"><Check className="w-3.5 h-3.5" /> Use standard muscle/sets/reps for "{match.name}"</button>
            )}
          </Field>
          {!match && form.name.trim() && (
            <p className="text-xs text-ink-faint -mt-2">Not in the standard list — this one's custom, only visible in your own plan.</p>
          )}
          {!match?.youtubeId && (
            <Field label="Video (optional)">
              <input value={videoUrl} onChange={(e) => { setVideoUrl(e.target.value); setForm((f) => ({ ...f, videoId: parseYoutubeId(e.target.value) })); }} placeholder="Paste a YouTube link" className={inputClass} />
              {videoUrl && !parseYoutubeId(videoUrl) && <p className="text-xs text-danger mt-1">Doesn't look like a valid YouTube link</p>}
            </Field>
          )}
          <Field label="Muscle"><input value={form.muscle} onChange={set("muscle")} placeholder="e.g. Glute max" className={inputClass} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Sets"><input type="number" min="1" inputMode="numeric" value={form.sets} onChange={(e) => setForm((f) => ({ ...f, sets: e.target.value.replace(/[^0-9]/g, "") }))} className={inputClass} /></Field>
            <Field label="Reps"><input value={form.reps} onChange={set("reps")} placeholder="8-12" className={inputClass} /></Field>
            <Field label="Rest"><input value={form.rest} onChange={set("rest")} placeholder="90 sec" className={inputClass} /></Field>
          </div>
          <Field label="Weight">
            <div className="flex flex-wrap gap-2">
              {WEIGHT_OPTIONS.map((w) => (
                <button key={w} type="button" onClick={() => setForm((f) => ({ ...f, weight: w }))} className={`px-3.5 py-2.5 rounded-full text-sm font-bold ring-1 transition ${form.weight === w ? `${WEIGHT_INFO[w].bg} ${WEIGHT_INFO[w].text} ${WEIGHT_INFO[w].ring}` : "bg-card text-ink-faint ring-line"}`}>{w}</button>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2.5 text-base text-ink-soft cursor-pointer w-fit py-1">
            <input type="checkbox" checked={form.focus} onChange={(e) => setForm((f) => ({ ...f, focus: e.target.checked }))} className="w-5 h-5 rounded border-line accent-charge" />
            Mark as a focus muscle
          </label>
        </div>
        <div className="sticky bottom-0 bg-card flex items-center gap-2 px-5 py-4 border-t border-line">
          <button onClick={onCancel} className="flex-1 py-3.5 rounded-2xl text-base font-bold text-ink-soft hover:bg-mist">Cancel</button>
          <button disabled={!canSave} onClick={() => canSave && onSave({ ...form, sets: Number(form.sets) || 1 })} className="flex-1 py-3.5 rounded-2xl text-base font-bold bg-charge text-white disabled:opacity-30 flex items-center justify-center gap-1.5 hover:bg-charge-strong transition-colors"><Check className="w-4 h-4" /> Save</button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({ ex: item, onCancel }) {
  const match = findLibraryMatch(item.name);
  const videoId = item.videoId || match?.youtubeId;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-card flex items-center justify-between px-5 py-4 border-b border-line z-10">
          <h2 className="text-xl font-black text-ink font-display">{item.name}</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        {item.image ? <img src={item.image} alt="" className="w-full aspect-square object-cover" /> : (
          <div className="w-full aspect-square bg-mist flex items-center justify-center"><Dumbbell className="w-10 h-10 text-ink-faint" /></div>
        )}
        {videoId ? (
          <div className="px-5 pt-4">
            <div className="aspect-video rounded-2xl overflow-hidden bg-ink">
              <iframe className="w-full h-full" src={youtubeEmbedUrl(videoId)} title="Exercise video" allowFullScreen />
            </div>
          </div>
        ) : (
          <p className="px-5 pt-4 text-sm text-ink-faint">No video added for this exercise yet.</p>
        )}
        <div className="p-5 space-y-3">
          <p className="text-ink-soft">{item.muscle}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-mono font-bold text-ink bg-mist rounded-full px-3 py-1.5"><Dumbbell className="w-3.5 h-3.5" /> {item.sets} sets · {item.reps}</span>
            <WeightBadge weight={item.weight} size="lg" />
            <span className="inline-flex items-center gap-1 text-sm font-mono text-ink-faint"><Clock className="w-3.5 h-3.5" /> {item.rest}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExerciseCard({ ex: item, onOpenEdit, onDelete, onQuickPhoto, readOnly }) {
  const [detailOpen, setDetailOpen] = useState(false);
  return (
    <div className={`rounded-3xl bg-card border overflow-hidden shadow-[0_1px_3px_rgba(21,23,26,0.06)] transition-shadow hover:shadow-[0_6px_20px_rgba(21,23,26,0.08)] ${item.focus ? "border-w2 ring-1 ring-w2-soft" : "border-line"}`}>
      <div className="relative">
        <BigPhoto image={item.image} onPick={onQuickPhoto} readOnly={readOnly} />
        {item.focus && <span className="absolute top-3 left-3 inline-flex items-center gap-1 bg-w2-strong text-white text-xs font-bold px-2.5 py-1.5 rounded-full shadow"><Star className="w-3.5 h-3.5 fill-white" /> Focus</span>}
        {!readOnly && (
          <div className="absolute top-3 right-3 flex gap-1.5">
            <button onClick={onOpenEdit} className="p-2.5 rounded-full bg-white/95 text-ink-soft hover:text-ink shadow" aria-label="Edit"><Pencil className="w-4 h-4" /></button>
            <button onClick={onDelete} className="p-2.5 rounded-full bg-white/95 text-ink-soft hover:text-danger shadow" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
          </div>
        )}
      </div>
      <button type="button" onClick={() => setDetailOpen(true)} className="p-4 text-left w-full">
        <h3 className="font-black text-ink text-lg leading-snug">{item.name}</h3>
        <p className="text-sm text-ink-faint mb-3">{item.muscle}</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-paper rounded-xl px-2 py-2.5 text-center">
            <div className="text-[10px] font-bold uppercase text-ink-faint tracking-wide">Sets</div>
            <div className="text-lg font-black text-ink font-mono">{item.sets}</div>
          </div>
          <div className="bg-paper rounded-xl px-2 py-2.5 text-center">
            <div className="text-[10px] font-bold uppercase text-ink-faint tracking-wide">Reps</div>
            <div className="text-lg font-black text-ink font-mono">{item.reps}</div>
          </div>
          <div className="bg-paper rounded-xl px-2 py-2.5 text-center">
            <div className="text-[10px] font-bold uppercase text-ink-faint tracking-wide">Rest</div>
            <div className="text-base font-black text-ink font-mono">{item.rest}</div>
          </div>
        </div>
        <WeightBadge weight={item.weight} size="lg" />
      </button>
      {detailOpen && <DetailModal ex={item} onCancel={() => setDetailOpen(false)} />}
    </div>
  );
}

function ManageDaysModal({ days, onCancel, onSave }) {
  const [list, setList] = useState(days.map((d) => ({ ...d })));
  const update = (id, field, val) => setList((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: val } : d)));
  const remove = (id) => setList((prev) => prev.filter((d) => d.id !== id));
  const add = () => setList((prev) => [...prev, { id: `day-${Date.now()}`, label: `Day ${prev.length + 1}`, title: "New day", tagline: "", exercises: [] }]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div>
            <h2 className="text-xl font-black text-ink font-display">Days per week</h2>
            <p className="text-xs text-ink-faint font-mono mt-0.5">{list.length} {list.length === 1 ? "day" : "days"} in this plan</p>
          </div>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          {list.map((d, i) => (
            <div key={d.id} className="rounded-2xl border border-line p-4 space-y-2.5 bg-paper">
              <div className="flex items-center gap-2">
                <span className="shrink-0 w-7 h-7 rounded-full bg-ink text-white text-xs font-black font-mono flex items-center justify-center">{i + 1}</span>
                <input value={d.title} onChange={(e) => update(d.id, "title", e.target.value)} placeholder="Day title" className="flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-charge" />
                <button onClick={() => remove(d.id)} disabled={list.length <= 1} className="p-2.5 rounded-xl text-ink-faint hover:text-danger hover:bg-danger-soft disabled:opacity-20 transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
              <input value={d.tagline} onChange={(e) => update(d.id, "tagline", e.target.value)} placeholder="Tagline, e.g. Glutes + calves focus" className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-charge" />
              <p className="text-xs text-ink-faint font-mono">{d.exercises.length} exercises</p>
            </div>
          ))}
          <button onClick={add} className="w-full rounded-2xl border-2 border-dashed border-line py-3.5 text-sm font-bold text-ink-faint hover:border-charge hover:text-charge transition-colors flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> Add a day</button>
        </div>
        <div className="sticky bottom-0 bg-card flex items-center gap-2 px-5 py-4 border-t border-line">
          <button onClick={onCancel} className="flex-1 py-3.5 rounded-2xl text-base font-bold text-ink-soft hover:bg-mist">Cancel</button>
          <button onClick={() => onSave(list.map((d, i) => ({ ...d, label: `Day ${i + 1}` })))} className="flex-1 py-3.5 rounded-2xl text-base font-bold bg-charge text-white hover:bg-charge-strong transition-colors flex items-center justify-center gap-1.5"><Check className="w-4 h-4" /> Save</button>
        </div>
      </div>
    </div>
  );
}

function NewPlanModal({ onCancel, onCreate }) {
  const [name, setName] = useState("");
  const [levelId, setLevelId] = useState("established");
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-xl font-black text-ink font-display">New plan</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Plan name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Winter block" className={inputClass} /></Field>
          <Field label="Starting point">
            <div className="space-y-2">
              {LEVELS.map((l) => (
                <button key={l.id} type="button" onClick={() => setLevelId(l.id)} className={`w-full text-left rounded-2xl border p-4 transition ${levelId === l.id ? "border-charge bg-charge-soft" : "border-line bg-card"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${levelId === l.id ? "border-charge" : "border-line"}`}>{levelId === l.id && <span className="w-2 h-2 rounded-full bg-charge" />}</span>
                    <span className="font-bold text-ink text-base">{l.name}</span>
                    <span className="text-xs text-ink-faint ml-auto font-mono">{l.days.length} days/wk</span>
                  </div>
                  <p className="text-sm text-ink-faint mt-1 pl-6">{l.blurb}</p>
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="sticky bottom-0 bg-card flex items-center gap-2 px-5 py-4 border-t border-line">
          <button onClick={onCancel} className="flex-1 py-3.5 rounded-2xl text-base font-bold text-ink-soft hover:bg-mist">Cancel</button>
          <button disabled={!name.trim()} onClick={() => onCreate(name.trim(), levelId)} className="flex-1 py-3.5 rounded-2xl text-base font-bold bg-charge text-white disabled:opacity-30 hover:bg-charge-strong transition-colors flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> Create</button>
        </div>
      </div>
    </div>
  );
}

function NameModal({ onSave }) {
  const [first, setFirst] = useState("");
  const [family, setFamily] = useState("");
  const canSave = first.trim().length > 0 && family.trim().length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 backdrop-blur-[2px]">
      <div className={sheetClass}>
        <div className="px-5 py-4 border-b border-line">
          <h2 className="text-xl font-black text-ink font-display">Finish your profile</h2>
          <p className="text-sm text-ink-faint mt-1">One-time — helps identify who's using the app and any pinning requests.</p>
        </div>
        <div className="p-5 space-y-4">
          <Field label="First name"><input value={first} onChange={(e) => setFirst(e.target.value)} className={inputClass} /></Field>
          <Field label="Family name (اللقب)"><input value={family} onChange={(e) => setFamily(e.target.value)} className={inputClass} /></Field>
        </div>
        <div className="px-5 pb-5">
          <button disabled={!canSave} onClick={() => onSave(first.trim(), family.trim())} className="w-full py-3.5 rounded-2xl text-base font-bold bg-charge text-white disabled:opacity-30 hover:bg-charge-strong transition-colors">Continue</button>
        </div>
      </div>
    </div>
  );
}

function ProfileModal({ user, onCancel, onSignIn, onUpgrade, onSignOut, status, error }) {
  const anon = user && user.isAnonymous;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-xl font-black text-ink font-display flex items-center gap-2"><Cloud className="w-5 h-5" /> Profile</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {user && !anon ? (
            <div className="space-y-3">
              <div className="rounded-2xl bg-charge-soft border border-charge/20 p-4 text-sm text-charge-strong flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" /> Signed in as <span className="font-bold">{user.displayName}</span>. Plans sync automatically.
              </div>
              <button onClick={onSignOut} className="w-full py-3.5 rounded-2xl text-base font-bold text-danger border border-danger/30 hover:bg-danger-soft">Sign out</button>
            </div>
          ) : (
            <>
              <p className="text-base text-ink-soft">{anon ? "You're trying the app — nothing saves permanently yet. Sign in to keep everything you've built and unlock editing, new plans, and submissions." : "One tap, no password. This is your identity for plans, sync, and submissions."}</p>
              {error && <div className="rounded-2xl bg-danger-soft border border-danger/20 p-3.5 text-sm text-danger flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> Couldn't sign in — try again.</div>}
              <button disabled={status === "syncing"} onClick={anon ? onUpgrade : onSignIn} className="w-full py-3.5 rounded-2xl text-base font-bold bg-charge text-white disabled:opacity-30 hover:bg-charge-strong transition-colors flex items-center justify-center gap-1.5">
                {status === "syncing" ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : "Continue with Google"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SubmitModal({ plan, user, onCancel }) {
  const [state, setState] = useState("idle");
  const submit = async () => {
    setState("sending");
    try { await submitPlanForReview(plan, user.uid, user.displayName); setState("sent"); } catch (err) { setState("error"); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-xl font-black text-ink font-display flex items-center gap-2"><Send className="w-5 h-5" /> Submit for pinning</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {state === "sent" ? (
            <div className="rounded-2xl bg-charge-soft border border-charge/20 p-4 text-sm text-charge-strong flex items-center gap-2"><Check className="w-4 h-4 shrink-0" /> Sent — it'll appear in Community once approved.</div>
          ) : (
            <>
              <p className="text-base text-ink-soft">Sends "{plan.name}" for review. Photos aren't included, just the exercise list.</p>
              {state === "error" && <p className="text-sm text-danger">Something went wrong — try again.</p>}
              <button disabled={state === "sending"} onClick={submit} className="w-full py-3.5 rounded-2xl text-base font-bold bg-charge text-white disabled:opacity-30 hover:bg-charge-strong transition-colors flex items-center justify-center gap-1.5">
                {state === "sending" ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Send className="w-4 h-4" /> Submit</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CommunityPage({ onFork, isOnline }) {
  const [state, setState] = useState("loading");
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!isOnline) { setState("offline"); return; }
    (async () => {
      try {
        const data = await fetchCommunityPlans();
        if (data.length) { setItems(data); setState("ok"); } else setState("empty");
      } catch (err) { setState("empty"); }
    })();
  }, [isOnline]);
  return (
    <div className="space-y-3">
      <h1 className="text-3xl font-black tracking-tight text-ink font-display">Community</h1>
      <p className="text-base text-ink-faint mb-4">Plans other people submitted and got approved.</p>
      {state === "offline" && <p className="text-sm text-ink-faint text-center py-10">You're offline — community plans need an internet connection.</p>}
      {state === "loading" && <div className="flex items-center gap-2 text-ink-faint text-sm py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
      {state === "empty" && <p className="text-sm text-ink-faint text-center py-10">No approved plans yet — check back later.</p>}
      {items.map((p) => (
        <div key={p.id} className="rounded-2xl border border-line bg-card p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-black text-ink truncate">{p.name}</p>
            <p className="text-sm text-ink-faint">by {p.author || "anonymous"} · {p.days?.length || 0} days/wk</p>
          </div>
          <button onClick={() => onFork(p)} className="shrink-0 px-3.5 py-2.5 rounded-xl text-sm font-bold bg-charge text-white hover:bg-charge-strong transition-colors flex items-center gap-1.5"><Copy className="w-4 h-4" /> Copy</button>
        </div>
      ))}
    </div>
  );
}


function AuthStep({ onGoogle, onGuest, onEmailAuth, status, error }) {
  const [mode, setMode] = useState("choice"); // choice | email
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");

  if (mode === "email") {
    return (
      <div className="flex-1 flex flex-col justify-center px-8 max-w-sm mx-auto w-full">
        <h1 className="text-3xl font-black text-ink font-display mb-1">{isSignUp ? "Create account" : "Sign in"}</h1>
        <p className="text-ink-faint mb-6">{isSignUp ? "Email + password, no Google needed." : "Welcome back."}</p>
        <div className="space-y-3 mb-4">
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputClass} />
        </div>
        {error && <p className="text-danger text-sm mb-3">{error}</p>}
        <button disabled={status === "syncing" || !email || !pw} onClick={() => onEmailAuth(email, pw, isSignUp)} className="w-full py-3.5 rounded-2xl text-base font-bold bg-charge text-white disabled:opacity-30 mb-3 hover:bg-charge-strong transition-colors">
          {status === "syncing" ? "…" : isSignUp ? "Create account" : "Sign in"}
        </button>
        <button onClick={() => setIsSignUp((v) => !v)} className="text-sm font-bold text-ink-faint mb-2">{isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}</button>
        <button onClick={() => setMode("choice")} className="text-sm font-bold text-ink-faint">← Back</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-center px-8 max-w-sm mx-auto w-full text-center">
      <div className="w-16 h-16 rounded-2xl bg-charge mx-auto mb-5 flex items-center justify-center shadow-lg shadow-charge/20"><Dumbbell className="w-8 h-8 text-white" /></div>
      <h1 className="text-3xl font-black text-ink font-display mb-1">Training log</h1>
      <p className="text-ink-faint mb-8">Create a profile to save your plans and progress.</p>
      {error && <p className="text-danger text-sm mb-3">{error}</p>}
      <button disabled={status === "syncing"} onClick={onGoogle} className="w-full py-3.5 rounded-2xl text-base font-bold bg-charge text-white mb-2.5 disabled:opacity-30 hover:bg-charge-strong transition-colors">Continue with Google</button>
      <button disabled={status === "syncing"} onClick={() => setMode("email")} className="w-full py-3.5 rounded-2xl text-base font-bold bg-card border border-line text-ink mb-2.5 disabled:opacity-30 hover:bg-mist transition-colors">Continue with email</button>
      <button disabled={status === "syncing"} onClick={onGuest} className="w-full py-3 text-sm font-bold text-ink-faint disabled:opacity-30">Try it first, no account</button>
    </div>
  );
}

function TutorialStep({ onDone }) {
  const slides = [
    { icon: Star, color: "text-w2-strong fill-w2", bg: "bg-w2-soft", title: "Focus muscles", text: "A star marks a focus muscle — that's where extra volume goes on purpose." },
    { icon: Flame, color: "text-w4-strong", bg: "bg-w4-soft", title: "Weight, made simple", text: "Weight means the load where your last rep is the last one you can do with good form. A color strip up top reminds you any time." },
    { icon: RefreshCw, color: "text-w5-strong", bg: "bg-w5-soft", title: "Built-in progression", text: "Around week 6-8 you'll get a nudge to rotate 1-2 exercises per muscle — research-backed, not random switching." },
    { icon: Home, color: "text-charge-strong", bg: "bg-charge-soft", title: "Guided sessions", text: "Hit \"Start workout\" for a full guided session — warm-up, set tracking, rest timers, all handled for you." },
  ];
  const [i, setI] = useState(0);
  const slide = slides[i];
  const Icon = slide.icon;
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex gap-1.5 px-6 pt-6">
        {slides.map((_, idx) => <div key={idx} className={`h-1.5 flex-1 rounded-full ${idx <= i ? "bg-charge" : "bg-mist"}`} />)}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center max-w-sm mx-auto w-full">
        <div className={`w-24 h-24 rounded-3xl ${slide.bg} flex items-center justify-center mb-6`}><Icon className={`w-11 h-11 ${slide.color}`} /></div>
        <h2 className="text-2xl font-black text-ink font-display mb-2">{slide.title}</h2>
        <p className="text-ink-soft text-base">{slide.text}</p>
      </div>
      <div className="px-8 pb-8 max-w-sm mx-auto w-full flex gap-2">
        {i > 0 && <button onClick={() => setI((v) => v - 1)} className="px-6 py-3.5 rounded-2xl text-base font-bold text-ink-soft border border-line">Back</button>}
        <button onClick={() => (i < slides.length - 1 ? setI((v) => v + 1) : onDone())} className="flex-1 py-3.5 rounded-2xl text-base font-bold bg-charge text-white hover:bg-charge-strong transition-colors">{i < slides.length - 1 ? "Next" : "Start using the app"}</button>
      </div>
    </div>
  );
}

function OnboardingFlow({ step, onGoogle, onGuest, onEmailAuth, onTutorialDone, status, error }) {
  return (
    <div className="fixed inset-0 z-50 bg-paper flex flex-col">
      {step === "auth"
        ? <AuthStep onGoogle={onGoogle} onGuest={onGuest} onEmailAuth={onEmailAuth} status={status} error={error} />
        : <TutorialStep onDone={onTutorialDone} />}
    </div>
  );
}

// ---- Tiny built-in sound effects (no audio files needed) ----
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) { const Ctx = window.AudioContext || window.webkitAudioContext; if (Ctx) sharedAudioCtx = new Ctx(); }
  return sharedAudioCtx;
}
function beep(freq = 880, dur = 0.12, delay = 0, type = "sine", vol = 0.16) {
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    osc.connect(gain); gain.connect(ctx.destination);
    const t0 = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  } catch (err) { /* audio unavailable, ignore */ }
}
const SOUND = {
  setDone: () => beep(720, 0.1, 0, "sine"),
  restEnd: () => { beep(660, 0.1, 0); beep(880, 0.14, 0.12); },
  exerciseDone: () => { beep(523, 0.1, 0); beep(659, 0.1, 0.1); beep(784, 0.16, 0.2); },
  workoutDone: () => { beep(523, 0.12, 0); beep(659, 0.12, 0.12); beep(784, 0.12, 0.24); beep(1047, 0.22, 0.36); },
  tick: () => beep(500, 0.03, 0, "square", 0.05),
};

const EXERCISE_LIBRARY = [
  { name: "Back squat", muscle: "Quads / glute max", sets: 3, reps: "6-8", weight: "Heavy", rest: "2.5 min", image: null, youtubeId: null },
  { name: "Weighted step-up", muscle: "Glute max", sets: 4, reps: "8-12/leg", weight: "Medium-Heavy", rest: "2 min", image: null, youtubeId: null },
  { name: "Walking lunge", muscle: "Glute max", sets: 4, reps: "10-12/leg", weight: "Medium", rest: "2 min", image: null, youtubeId: null },
  { name: "Leg press", muscle: "Quads", sets: 3, reps: "10-15", weight: "Medium", rest: "90 sec", image: null, youtubeId: null },
  { name: "Standing calf raise", muscle: "Calves", sets: 4, reps: "12-15", weight: "Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Seated calf raise", muscle: "Calves", sets: 3, reps: "15-20", weight: "Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Calf raise on leg press", muscle: "Calves", sets: 3, reps: "15-20", weight: "Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Hanging leg raise", muscle: "Core", sets: 3, reps: "10-15", weight: "Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Hanging knee raise", muscle: "Core", sets: 3, reps: "8-12", weight: "Light-Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Reverse crunch", muscle: "Core", sets: 3, reps: "12-15", weight: "Light-Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Plank", muscle: "Core", sets: 3, reps: "20-40 sec hold", weight: "Light-Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Suitcase carry", muscle: "Core (anti-lateral-flexion)", sets: 2, reps: "30-40m/side", weight: "Medium-Heavy", rest: "60 sec", image: null, youtubeId: null },
  { name: "Overhead press", muscle: "Delts (front)", sets: 3, reps: "6-8", weight: "Heavy", rest: "2-3 min", image: null, youtubeId: null },
  { name: "Cable lateral raise", muscle: "Delts (side)", sets: 4, reps: "12-15", weight: "Light-Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Lateral raise", muscle: "Delts (side)", sets: 4, reps: "12-15", weight: "Light-Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Face pull", muscle: "Rear delt / traps", sets: 4, reps: "15-20", weight: "Light", rest: "60 sec", image: null, youtubeId: null },
  { name: "Prone Y-raise", muscle: "Lower traps / posture", sets: 3, reps: "12-15", weight: "Light", rest: "60 sec", image: null, youtubeId: null },
  { name: "Cable external rotation", muscle: "Rotator cuff / shoulder posture", sets: 3, reps: "12-15/side", weight: "Light", rest: "60 sec", image: null, youtubeId: null },
  { name: "Dumbbell shrug", muscle: "Traps", sets: 4, reps: "10-15", weight: "Medium-Heavy", rest: "90 sec", image: null, youtubeId: null },
  { name: "Barbell shrug", muscle: "Traps", sets: 3, reps: "8-12", weight: "Heavy", rest: "90 sec", image: null, youtubeId: null },
  { name: "Reverse curl", muscle: "Forearms", sets: 3, reps: "10-15", weight: "Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Farmer's hold", muscle: "Forearms / grip", sets: 3, reps: "30-40 sec", weight: "Heavy", rest: "90 sec", image: null, youtubeId: null },
  { name: "Romanian deadlift", muscle: "Hamstrings / glute max", sets: 3, reps: "6-10", weight: "Heavy", rest: "2.5 min", image: null, youtubeId: null },
  { name: "Deadlift", muscle: "Posterior chain", sets: 3, reps: "5-6", weight: "Heavy", rest: "3 min", image: null, youtubeId: null },
  { name: "Bulgarian split squat", muscle: "Glute max", sets: 3, reps: "8-12/leg", weight: "Medium", rest: "90 sec", image: null, youtubeId: null },
  { name: "Leg curl", muscle: "Hamstrings", sets: 3, reps: "10-12", weight: "Medium", rest: "90 sec", image: null, youtubeId: null },
  { name: "Leg extension", muscle: "Quads", sets: 3, reps: "12-15", weight: "Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Flat bench press", muscle: "Chest", sets: 3, reps: "6-10", weight: "Heavy", rest: "2 min", image: null, youtubeId: null },
  { name: "Incline dumbbell press", muscle: "Chest (upper)", sets: 3, reps: "6-10", weight: "Heavy", rest: "2 min", image: null, youtubeId: null },
  { name: "Dips", muscle: "Chest (lower) / triceps", sets: 3, reps: "10-15", weight: "Medium-Heavy", rest: "60 sec", image: null, youtubeId: null },
  { name: "Pull-up", muscle: "Back", sets: 4, reps: "max reps", weight: "Heavy", rest: "2 min", image: null, youtubeId: null },
  { name: "Lat pulldown", muscle: "Back", sets: 3, reps: "8-12", weight: "Medium-Heavy", rest: "90 sec", image: null, youtubeId: null },
  { name: "Seated cable row", muscle: "Back", sets: 3, reps: "8-12", weight: "Medium", rest: "90 sec", image: null, youtubeId: null },
  { name: "EZ bar curl", muscle: "Biceps", sets: 2, reps: "10-15", weight: "Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Bicep curl", muscle: "Biceps", sets: 2, reps: "10-12", weight: "Light-Medium", rest: "60 sec", image: null, youtubeId: null },
  { name: "Triceps pushdown", muscle: "Triceps", sets: 2, reps: "10-15", weight: "Medium", rest: "60 sec", image: null, youtubeId: null },
];
function findLibraryMatch(name) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  return EXERCISE_LIBRARY.find((e) => e.name.toLowerCase() === n) || null;
}
function youtubeEmbedUrl(id) { return `https://www.youtube-nocookie.com/embed/${id}`; }

const STRETCHES = [
  { name: "Doorway chest stretch", freq: "After every session", why: "Loosens tight chest/front delts pulling shoulders forward", hold: "30 sec/side" },
  { name: "Lat stretch (overhead, side lean)", freq: "After every session", why: "Lats pull shoulders down and in — this counters it", hold: "30 sec/side" },
  { name: "Kneeling hip flexor stretch", freq: "Daily, even on rest days", why: "Tight hip flexors tilt the pelvis and flatten glute activation", hold: "30-40 sec/side" },
  { name: "Couch stretch (rear-foot elevated)", freq: "Daily, even on rest days", why: "Deeper hip flexor + quad stretch, same posture goal", hold: "30-40 sec/side" },
  { name: "Cat-cow", freq: "Daily, even on rest days", why: "Spinal mobility, counters a stiff, rounded upper back", hold: "8-10 slow reps" },
  { name: "Child's pose reach", freq: "After every session", why: "Decompresses the lower back after loaded lifting", hold: "45 sec" },
];

function fmtClock(s) { const m = Math.floor(Math.max(0, s) / 60), r = Math.max(0, s) % 60; return `${m}:${String(r).padStart(2, "0")}`; }

function parseRestSeconds(restStr) {
  if (!restStr) return 60;
  const m = restStr.match(/(\d+(?:\.\d+)?)\s*-?\s*(\d+(?:\.\d+)?)?\s*(min|sec)/i);
  if (!m) return 60;
  const val = m[2] ? (parseFloat(m[1]) + parseFloat(m[2])) / 2 : parseFloat(m[1]);
  return Math.round(m[3].toLowerCase().startsWith("min") ? val * 60 : val);
}

function SessionStyles() {
  return (
    <style>{`
      @keyframes tl-pop { 0% { transform: scale(1); } 40% { transform: scale(1.18); } 100% { transform: scale(1); } }
      @keyframes tl-ring { 0% { opacity: .9; transform: scale(0.6); } 100% { opacity: 0; transform: scale(1.9); } }
      @keyframes tl-confetti { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 100% { transform: translateY(120px) rotate(540deg); opacity: 0; } }
      @keyframes tl-toast { 0% { opacity: 0; transform: translateY(-10px); } 12% { opacity: 1; transform: translateY(0); } 88% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-6px); } }
      .tl-pop { animation: tl-pop 0.32s cubic-bezier(.34,1.56,.64,1); }
      .tl-ring::after { content: ''; position: absolute; inset: 0; border-radius: 9999px; border: 3px solid currentColor; animation: tl-ring 0.6s ease-out; }
      .tl-confetti { animation: tl-confetti 1.1s ease-in forwards; }
      .tl-toast { animation: tl-toast 2.2s ease-in-out forwards; }
      .tl-scroll { scrollbar-width: none; -ms-overflow-style: none; }
      .tl-scroll::-webkit-scrollbar { display: none; }
    `}</style>
  );
}

// ---- Guided workout session ----
// Redesigned around two fixes: (1) it now scales fluidly with clamp()-based
// sizing instead of fixed pixel widths, so the "working set" screen reads
// as a deliberate console on a phone AND a desktop instead of a tiny island
// in a lot of empty space; (2) finishing the last set of an exercise no
// longer stops on its own "exercise done" screen with a button — it
// auto-advances straight into the next exercise's first set, with a small
// toast confirming what just happened instead of an extra tap.
function WorkoutSession({ day, onExit }) {
  const WARMUP_SECONDS = 300;
  const [run, dispatch] = useReducer((s, action) => {
    switch (action.type) {
      case "START_WARMUP_TIMER": return { ...s, phase: "warmup" };
      case "SKIP_WARMUP": return { ...s, phase: "work", exIndex: 0, setsDone: 0 };
      case "WARMUP_DONE": return { ...s, phase: "work", exIndex: 0, setsDone: 0 };
      case "COMPLETE_SET": {
        const setsDone = s.setsDone + 1;
        if (setsDone >= action.totalSets) {
          const isLast = s.exIndex >= action.totalExercises - 1;
          return isLast ? { ...s, setsDone, phase: "stretch" } : { ...s, setsDone: 0, exIndex: s.exIndex + 1, phase: "work" };
        }
        return { ...s, setsDone, phase: "rest" };
      }
      case "FINISH_STRETCH": return { ...s, phase: "done" };
      case "REST_DONE": return { ...s, phase: "work" };
      default: return s;
    }
  }, { phase: "warmupChoice", exIndex: 0, setsDone: 0 });
  const { phase, exIndex, setsDone } = run;

  const [warmupLeft, setWarmupLeft] = useState(WARMUP_SECONDS);
  const [restLeft, setRestLeft] = useState(0);
  const [popKey, setPopKey] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const [muted, setMuted] = useState(false);
  const [startedAt] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState(null);
  const restTotal = useRef(60);
  const toastTimer = useRef(null);

  useEffect(() => { (async () => { try { const r = await window.storage.get("training-log-sound-v1", false); if (r?.value) setMuted(JSON.parse(r.value) === false); } catch (err) { /* ignore */ } })(); }, []);
  const toggleMuted = () => { const next = !muted; setMuted(next); window.storage.set("training-log-sound-v1", JSON.stringify(!next), false).catch(() => {}); };
  const play = (fn) => { if (!muted) fn(); };

  useEffect(() => { const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000); return () => clearInterval(t); }, [startedAt]);

  useEffect(() => {
    if (phase !== "warmup" || warmupLeft <= 0) return;
    const t = setInterval(() => setWarmupLeft((s) => { if (s <= 1 && !muted) SOUND.restEnd(); return s - 1; }), 1000);
    return () => clearInterval(t);
  }, [phase, warmupLeft, muted]);

  useEffect(() => {
    if (phase !== "rest" || restLeft <= 0) return;
    const t = setInterval(() => setRestLeft((s) => { if (s <= 1) play(SOUND.restEnd); return s - 1; }), 1000);
    return () => clearInterval(t);
  }, [phase, restLeft]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const exercises = day.exercises;
  const currentEx = exercises[exIndex];
  const totalExercises = exercises.length;

  const completeWarmup = () => { play(SOUND.exerciseDone); dispatch({ type: "WARMUP_DONE" }); };
  const beginWarmupTimer = () => dispatch({ type: "START_WARMUP_TIMER" });
  const skipWarmup = () => { play(SOUND.exerciseDone); dispatch({ type: "SKIP_WARMUP" }); };

  const completeSet = () => {
    play(SOUND.setDone);
    setPopKey((k) => k + 1);
    const willFinishExercise = setsDone + 1 >= currentEx.sets;
    const isLastExercise = exIndex >= totalExercises - 1;
    if (!willFinishExercise) {
      restTotal.current = parseRestSeconds(currentEx.rest);
      setRestLeft(restTotal.current);
    } else {
      play(SOUND.exerciseDone);
      if (isLastExercise) {
        play(SOUND.workoutDone);
      } else {
        const nextName = exercises[exIndex + 1]?.name;
        setToast({ done: currentEx.name, next: nextName });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 2200);
      }
    }
    dispatch({ type: "COMPLETE_SET", totalSets: currentEx.sets, totalExercises });
  };
  const skipRest = () => dispatch({ type: "REST_DONE" });
  useEffect(() => { if (phase === "rest" && restLeft <= 0) dispatch({ type: "REST_DONE" }); }, [phase, restLeft]);

  const finishStretch = () => { play(SOUND.workoutDone); dispatch({ type: "FINISH_STRETCH" }); };

  const tier = WEIGHT_INFO[currentEx?.weight] || WEIGHT_INFO.Medium;
  const isLoadPhase = phase === "work" || phase === "rest";
  const accent = isLoadPhase
    ? { label: phase === "work" ? "Working set" : "Rest", text: tier.accent, solid: tier.solid, hex: tier.hex }
    : phase === "stretch" || phase === "done"
      ? { label: phase === "stretch" ? "Cool down" : "Complete", text: "text-charge", solid: "bg-charge", hex: "#1e9e5a" }
      : { label: "Warm-up", text: "text-white", solid: "bg-white", hex: "#c7cbd1" };

  return (
    <div className="fixed inset-0 z-50 bg-ink text-white flex flex-col overflow-hidden">
      <SessionStyles />

      <div
        className="pointer-events-none absolute inset-0 opacity-70 transition-[background] duration-500"
        style={{ background: `radial-gradient(circle at 50% 18%, ${accent.hex}26, transparent 55%)` }}
      />

      {toast && (
        <div className="fixed top-4 inset-x-0 flex justify-center z-20 px-4 pointer-events-none">
          <div className="tl-toast bg-charge text-white rounded-full pl-3 pr-4 py-2.5 text-sm font-bold shadow-lg flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center shrink-0"><Check className="w-3 h-3" /></span>
            <span className="truncate max-w-[70vw]">{toast.done} done{toast.next ? ` — next: ${toast.next}` : ""}</span>
          </div>
        </div>
      )}

      <div className="relative flex items-center justify-between px-5 sm:px-8 pt-5 pb-2 max-w-2xl mx-auto w-full">
        <button onClick={() => setConfirmExit(true)} className="p-2 -ml-2 rounded-full text-white/60 hover:text-white hover:bg-white/10"><X className="w-5 h-5" /></button>
        <div className="text-center">
          <p className={`text-xs font-bold uppercase tracking-widest ${accent.text}`}>{accent.label}</p>
          <p className="text-white/40 text-xs font-mono">{fmtClock(elapsed)} elapsed</p>
        </div>
        <button onClick={toggleMuted} className="p-2 -mr-2 rounded-full text-white/60 hover:text-white hover:bg-white/10 w-9 h-9 flex items-center justify-center">{muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</button>
      </div>

      {isLoadPhase && (
        <div className="relative flex gap-1.5 px-5 sm:px-8 mb-2 max-w-2xl mx-auto w-full">
          {exercises.map((_, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full ${i < exIndex ? "bg-charge" : i === exIndex ? accent.solid : "bg-white/15"}`} />
          ))}
        </div>
      )}

      <div className="relative flex-1 overflow-y-auto tl-scroll flex flex-col items-center justify-center px-6 py-6 text-center">
        <div className="w-full max-w-md flex flex-col items-center">

          {phase === "warmupChoice" && (
            <>
              <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4"><Flame className="w-7 h-7 text-white/70" /></div>
              <h2 className="text-xl font-black font-display mb-2">Warmed up already?</h2>
              <p className="text-white/50 mb-6 max-w-xs text-sm">If not, warming up matters — 5 minutes minimum, no skipping once it starts.</p>
              <button onClick={beginWarmupTimer} className="w-full max-w-xs px-8 py-3.5 rounded-2xl text-base font-black bg-white text-ink mb-2.5">I need to warm up</button>
              <button onClick={skipWarmup} className="w-full max-w-xs px-8 py-3.5 rounded-2xl text-base font-black bg-white/10 text-white hover:bg-white/15 transition-colors">I already warmed up</button>
            </>
          )}

          {phase === "warmup" && (
            <>
              <p className="text-white/60 text-sm mb-2">Warm up before Day starts — this step is mandatory.</p>
              <div className="text-[clamp(3rem,11vw,5rem)] font-black font-mono mb-4 tabular-nums">{fmtClock(warmupLeft)}</div>
              <button
                disabled={warmupLeft > 0}
                onClick={completeWarmup}
                className={`px-6 py-3.5 rounded-2xl text-base font-black transition-all relative ${warmupLeft > 0 ? "bg-white/10 text-white/40" : "bg-white text-ink tl-ring"}`}
              >
                {warmupLeft > 0 ? `Warming up… ${fmtClock(warmupLeft)} left` : "✓ Warm-up done — Start Day"}
              </button>
            </>
          )}

          {phase === "work" && currentEx && (
            <>
              <p className="text-white/40 text-xs font-bold font-mono mb-1">Exercise {exIndex + 1} of {totalExercises}</p>
              {currentEx.image
                ? <img src={currentEx.image} alt="" className="w-[clamp(72px,14vw,104px)] h-[clamp(72px,14vw,104px)] rounded-2xl object-cover mb-3" />
                : <div className="w-[clamp(72px,14vw,104px)] h-[clamp(72px,14vw,104px)] rounded-2xl bg-white/10 mb-3 flex items-center justify-center"><Dumbbell className="w-8 h-8 text-white/30" /></div>}
              <h2 className="text-[clamp(1.25rem,4vw,1.75rem)] font-black font-display leading-tight mb-0.5">{currentEx.name}</h2>
              <p className="text-white/50 text-sm mb-1">{currentEx.muscle}</p>
              <p className="text-white/70 text-sm font-mono mb-5 flex items-center gap-2">{currentEx.reps} reps · <WeightBadge weight={currentEx.weight} /></p>

              <div className="flex gap-2 mb-6 flex-wrap justify-center max-w-xs">
                {Array.from({ length: currentEx.sets }).map((_, i) => (
                  <div key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black font-mono transition-all ${i < setsDone ? "bg-charge text-white" : "bg-white/10 text-white/30"} ${i === setsDone - 1 && popKey ? "tl-pop" : ""}`}>
                    {i < setsDone ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                ))}
              </div>

              <button
                key={popKey}
                onClick={completeSet}
                style={{ width: "clamp(180px, 36vw, 260px)", height: "clamp(180px, 36vw, 260px)" }}
                className={`rounded-full ${tier.solid} text-white flex flex-col items-center justify-center gap-1 shadow-2xl active:scale-95 transition-transform tl-ring relative`}
              >
                <span className="text-[clamp(1.1rem,3vw,1.5rem)] font-black font-display">Set {setsDone + 1}</span>
                <span className="text-sm font-bold opacity-75 font-mono">of {currentEx.sets}</span>
                <span className="text-xs font-bold mt-2 uppercase tracking-wide opacity-90">Tap when done</span>
              </button>
            </>
          )}

          {phase === "rest" && currentEx && (
            <>
              <p className="text-white/50 text-sm mb-2">Rest before set {setsDone + 1}</p>
              <div className={`text-[clamp(3rem,11vw,5rem)] font-black font-mono mb-4 tabular-nums ${accent.text}`}>{fmtClock(restLeft)}</div>
              <p className="text-white/40 text-sm mb-6">{currentEx.name}</p>
              <button onClick={skipRest} className="px-6 py-2.5 rounded-xl text-sm font-bold text-white/60 border border-white/20 hover:bg-white/10 transition-colors">Skip rest</button>
            </>
          )}

          {phase === "stretch" && (
            <>
              <h2 className="text-xl font-black font-display mb-1">Cool down</h2>
              <p className="text-white/50 text-sm mb-4">Optional, but worth it for posture.</p>
              <div className="w-full max-w-sm space-y-2 mb-6 text-left">
                {STRETCHES.filter((s) => s.freq === "After every session").map((s) => (
                  <div key={s.name} className="rounded-2xl bg-white/10 px-4 py-3">
                    <p className="font-bold text-sm">{s.name} <span className="text-white/40 font-normal">· {s.hold}</span></p>
                    <p className="text-white/40 text-xs">{s.why}</p>
                  </div>
                ))}
              </div>
              <button onClick={finishStretch} className="px-8 py-3.5 rounded-2xl text-base font-black bg-charge text-white hover:bg-charge-strong transition-colors">Done stretching</button>
            </>
          )}

          {phase === "done" && (
            <>
              <div className="relative mb-4">
                <div className="w-20 h-20 rounded-full bg-charge flex items-center justify-center"><Check className="w-9 h-9 text-white" strokeWidth={3} /></div>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="tl-confetti absolute w-2 h-3 rounded-sm" style={{ left: `${10 + i * 8}%`, top: "10%", background: ["#e7b740", "#d98b2b", "#7a56a8", "#3a5686", "#1e9e5a"][i % 5], animationDelay: `${i * 0.05}s` }} />
                ))}
              </div>
              <h2 className="text-2xl font-black font-display mb-1.5">Day complete!</h2>
              <p className="text-white/50 text-sm mb-1 font-mono">{totalExercises} exercises · {fmtClock(elapsed)}</p>
              <p className="text-white/40 text-sm mb-6">Great session. Go rest up.</p>
              <button onClick={onExit} className="px-8 py-3.5 rounded-2xl text-base font-black bg-charge text-white hover:bg-charge-strong transition-colors">Finish</button>
            </>
          )}
        </div>
      </div>

      {confirmExit && (
        <div className="fixed inset-0 z-10 bg-black/70 flex items-center justify-center p-6" onClick={() => setConfirmExit(false)}>
          <div className="bg-white/10 backdrop-blur rounded-2xl p-5 max-w-xs w-full border border-white/10" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold mb-1">End this workout?</p>
            <p className="text-white/50 text-sm mb-4">Your progress in this session won't be saved.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmExit(false)} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/15 transition-colors">Keep going</button>
              <button onClick={onExit} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-danger hover:bg-danger/85 transition-colors">End</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function LevelBubble({ size = 40 }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size * 2.2} height={size} viewBox="0 0 110 50">
        <rect x="2" y="18" width="106" height="14" rx="7" fill="none" stroke="var(--color-line)" strokeWidth="2" />
        <line x1="55" y1="14" x2="55" y2="36" stroke="var(--color-line)" strokeWidth="1.5" />
        <circle cx="55" cy="25" r="9" fill="var(--color-charge-soft)" stroke="var(--color-charge)" strokeWidth="2">
          <animate attributeName="cx" values="55;38;72;55" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
      <span className="text-xs font-bold text-ink-soft tracking-wide uppercase font-display">Finding balance…</span>
    </div>
  );
}

export default function TrainingLog() {
  const [plans, setPlans] = useState([makePlan("Starter plan", "starter", null), makePlan("Author's plan", "established", "Spirito (app creator)")]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [activeDay, setActiveDay] = useState(null);
  const pageFromUrl = () => {
    const p = window.location.hash.replace("#", "");
    return ["train", "community", "profile"].includes(p) ? p : "train";
  };
  const [page, setPageState] = useState(pageFromUrl); // train | community | profile
  const setPage = (id) => {
    if (id === page) return;
    window.history.pushState({ page: id }, "", `#${id}`);
    setPageState(id);
  };
  useEffect(() => {
    const onPop = () => setPageState(pageFromUrl());
    window.addEventListener("popstate", onPop);
    if (!window.location.hash) window.history.replaceState({ page: "train" }, "", "#train");
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [manageDaysOpen, setManageDaysOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [onboardStep, setOnboardStep] = useState(null); // null=deciding, "auth", "tutorial", "done"
  const [saveError, setSaveError] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [needsName, setNeedsName] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [syncError, setSyncError] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const fileInputRef = useRef(null);
  const pushTimer = useRef(null);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  // When connection comes back, push whatever changed while offline
  useEffect(() => {
    if (isOnline && loaded && firebaseUser) {
      saveUserData(firebaseUser.uid, firebaseUser.displayName, { plans, activePlanId }).catch(() => setSyncError(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  useEffect(() => {
    let localPlans = null, localActiveId = null;
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res?.value) { const parsed = JSON.parse(res.value); if (Array.isArray(parsed?.plans) && parsed.plans.length) { localPlans = parsed.plans; localActiveId = parsed.activePlanId; } }
      } catch (err) { /* first run */ }
      if (localPlans) { setPlans(localPlans); const aid = localActiveId || localPlans[0].id; setActivePlanId(aid); setActiveDay(localPlans.find((p) => p.id === aid)?.days[0]?.id); }
      try { const ob = await window.storage.get(ONBOARD_KEY, false); setOnboardStep(ob?.value ? "done" : "auth"); } catch (err) { setOnboardStep("auth"); }
      setLoaded(true);
    })();

    const unsub = subscribeAuth(async (user) => {
      setFirebaseUser(user);
      if (user && !user.isAnonymous) {
        try {
          const remote = await loadUserData(user.uid);
          if (remote?.data && Array.isArray(remote.data.plans) && remote.data.plans.length) {
            setPlans(remote.data.plans);
            const aid = remote.data.activePlanId || remote.data.plans[0].id;
            setActivePlanId(aid); setActiveDay(remote.data.plans.find((p) => p.id === aid)?.days[0]?.id);
          }
          if (!remote?.firstName) setNeedsName(true);
        } catch (err) { /* fall back to local */ }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => { if (loaded && !activePlanId && plans.length) { setActivePlanId(plans[0].id); setActiveDay(plans[0].days[0].id); } }, [loaded, activePlanId, plans]);

  const persist = useCallback((nextPlans, nextActiveId) => {
    (async () => { try { const res = await window.storage.set(STORAGE_KEY, JSON.stringify({ plans: nextPlans, activePlanId: nextActiveId }), false); setSaveError(!res); } catch (err) { setSaveError(true); } })();
    if (firebaseUser) {
      clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => { saveUserData(firebaseUser.uid, firebaseUser.displayName, { plans: nextPlans, activePlanId: nextActiveId }).catch(() => setSyncError(true)); }, 1200);
    }
  }, [firebaseUser]);

  useEffect(() => { if (loaded && activePlanId) persist(plans, activePlanId); }, [plans, activePlanId, loaded, persist]);

  const plan = plans.find((p) => p.id === activePlanId) || plans[0];
  const day = plan?.days.find((d) => d.id === activeDay) || plan?.days[0];
  useEffect(() => { if (plan && day && !plan.days.find((d) => d.id === activeDay)) setActiveDay(plan.days[0].id); }, [plan, day, activeDay]);

  const isReadOnly = plan?.readOnly === true;
  const canEdit = isRealAccount(firebaseUser);
  const guard = (fn) => (...args) => { if (canEdit) return fn(...args); setSyncOpen(true); };
  const updatePlanDays = (updater) => setPlans((prev) => prev.map((p) => (p.id !== plan.id ? p : { ...p, days: updater(p.days) })));
  const updateExercise = (updated) => updatePlanDays((days) => days.map((d) => (d.id !== activeDay ? d : { ...d, exercises: d.exercises.map((e) => (e.id === updated.id ? updated : e)) })));
  const quickPhoto = (id, dataUrl) => updatePlanDays((days) => days.map((d) => (d.id !== activeDay ? d : { ...d, exercises: d.exercises.map((e) => (e.id === id ? { ...e, image: dataUrl } : e)) })));
  const deleteExercise = (id) => { updatePlanDays((days) => days.map((d) => (d.id !== activeDay ? d : { ...d, exercises: d.exercises.filter((e) => e.id !== id) }))); setConfirmDelete(null); };
  const addExercise = (form) => { const newEx = { ...form, id: `${activeDay}-${Date.now()}` }; updatePlanDays((days) => days.map((d) => (d.id !== activeDay ? d : { ...d, exercises: [...d.exercises, newEx] }))); setModal(null); };
  const saveDays = (newDays) => { setPlans((prev) => prev.map((p) => (p.id !== plan.id ? p : { ...p, days: newDays }))); setManageDaysOpen(false); if (!newDays.find((d) => d.id === activeDay)) setActiveDay(newDays[0].id); };

  const createPlan = (name, levelId) => {
    const p = makePlan(name, levelId, firebaseUser?.displayName || "You");
    setPlans((prev) => [...prev, p]); setActivePlanId(p.id); setActiveDay(p.days[0].id);
    setNewPlanOpen(false); setPage("train");
  };
  const forkPlan = (source) => {
    const p = { ...makePlan(`${source.name} (copy)`, "established", firebaseUser?.displayName || "You"), days: deepClone(source.days) };
    setPlans((prev) => [...prev, p]); setActivePlanId(p.id); setActiveDay(p.days[0].id);
    setPage("train");
  };
  const switchPlan = (id) => { setActivePlanId(id); setActiveDay(plans.find((p) => p.id === id)?.days[0]?.id); setPage("train"); };
  const deletePlan = (id) => {
    const remaining = plans.filter((p) => p.id !== id);
    setPlans(remaining);
    if (id === activePlanId) { setActivePlanId(remaining[0]?.id || null); setActiveDay(remaining[0]?.days[0]?.id || null); }
    setConfirmDeletePlan(null);
  };
  const startNewBlock = () => setPlans((prev) => prev.map((p) => (p.id !== plan.id ? p : { ...p, blockStartDate: new Date().toISOString() })));

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ plans, activePlanId }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "training-log-backup.json";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const importData = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { const parsed = JSON.parse(e.target.result); if (Array.isArray(parsed?.plans) && parsed.plans.length) { setPlans(parsed.plans); const aid = parsed.activePlanId || parsed.plans[0].id; setActivePlanId(aid); setActiveDay(parsed.plans.find((p) => p.id === aid)?.days[0]?.id); } } catch (err) { /* invalid */ }
    };
    reader.readAsText(file);
  };

  const doSignIn = async () => {
    setSyncStatus("syncing"); setSyncError(false);
    try { await signInGoogle(); setSyncStatus("idle"); setSyncOpen(false); }
    catch (err) { setSyncStatus("idle"); setSyncError(true); }
  };
  const doUpgrade = async () => {
    setSyncStatus("syncing"); setSyncError(false);
    try { await upgradeToGoogle(); setSyncStatus("idle"); setSyncOpen(false); }
    catch (err) { setSyncStatus("idle"); setSyncError(true); }
  };
  const doSignOut = async () => { try { await signOutUser(); } catch (err) { /* ignore */ } setSyncOpen(false); };
  const goTutorial = () => setOnboardStep("tutorial");
  const finishOnboard = async () => { setOnboardStep("done"); try { await window.storage.set(ONBOARD_KEY, JSON.stringify(true), false); } catch (err) { /* ignore */ } };
  const [onboardErrorMsg, setOnboardErrorMsg] = useState("");
  const doOnboardGoogle = async () => {
    setSyncStatus("syncing"); setOnboardErrorMsg("");
    try { await signInGoogle(); setSyncStatus("idle"); goTutorial(); } catch (err) { setSyncStatus("idle"); setOnboardErrorMsg("Couldn't sign in — try again."); }
  };
  const doOnboardGuest = async () => {
    setSyncStatus("syncing");
    try { await startAnon(); } catch (err) { /* ignore */ }
    setSyncStatus("idle"); goTutorial();
  };
  const doOnboardEmail = async (email, pw, isSignUp) => {
    setSyncStatus("syncing"); setOnboardErrorMsg("");
    try { isSignUp ? await signUpEmail(email, pw) : await signInEmail(email, pw); setSyncStatus("idle"); goTutorial(); }
    catch (err) { setSyncStatus("idle"); setOnboardErrorMsg(isSignUp ? "Couldn't create that account — check the email/password." : "Couldn't sign in — check your details."); }
  };
  const saveName = async (first, family) => {
    try { await saveProfileInfo(firebaseUser.uid, first, family, firebaseUser.email || null); } catch (err) { /* ignore */ }
    setNeedsName(false);
  };

  if (!loaded || onboardStep === null) return <div className="w-full min-h-screen bg-paper flex items-center justify-center"><LevelBubble /></div>;
  if (onboardStep !== "done") return <OnboardingFlow step={onboardStep} onGoogle={doOnboardGoogle} onGuest={doOnboardGuest} onEmailAuth={doOnboardEmail} onTutorialDone={finishOnboard} status={syncStatus} error={onboardErrorMsg} />;
  if (!plan || !day) return <div className="w-full min-h-screen bg-paper flex items-center justify-center"><LevelBubble /></div>;

  const focusCount = day.exercises.filter((e) => e.focus).length;
  const levelInfo = LEVELS.find((l) => l.id === plan.level);
  const weeksIn = Math.floor((Date.now() - new Date(plan.blockStartDate).getTime()) / (7 * 24 * 3600 * 1000));

  return (
    <div className="w-full min-h-screen bg-paper text-ink overflow-x-hidden pb-24">
      {!isOnline && (
        <div className="bg-ink text-white text-sm font-bold text-center py-2 px-4 flex items-center justify-center gap-2 sticky top-0 z-30">
          <WifiOff className="w-4 h-4" /> Offline — edits save on this device, sync resumes when you're back online
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

        {page === "train" && (
          <>
            <header className="mb-4">
              <p className="text-[11px] font-bold tracking-[0.14em] text-ink-faint uppercase mb-1">{levelInfo?.name || "Custom plan"}{plan.author ? ` · by ${plan.author}` : ""}</p>
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-3xl font-black tracking-tight text-ink truncate font-display">{plan.name}</h1>
                {plans.length > 1 && <button onClick={() => setPage("profile")} className="shrink-0 text-sm font-bold text-ink-faint hover:text-ink">Switch</button>}
              </div>
            </header>

            <WeightLegend />

            {weeksIn >= 6 && !isReadOnly && (
              <div className="mb-4 rounded-2xl bg-w4-soft border border-w4-ring p-4 flex items-start gap-3">
                <RefreshCw className="w-5 h-5 text-w4-strong shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-w4-strong"><span className="font-bold">Week {weeksIn} on this plan.</span> Good point to rotate 1-2 exercises per muscle for joint variety.</p>
                  <button onClick={startNewBlock} className="mt-1.5 text-sm font-bold text-w4-strong hover:opacity-75">Start new block →</button>
                </div>
              </div>
            )}

            <button onClick={() => !isReadOnly && guard(() => setManageDaysOpen(true))()} disabled={isReadOnly} className="w-full flex items-center justify-between mb-3 px-1 py-1 disabled:cursor-default">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-soft"><Calendar className="w-4 h-4" /> {plan.days.length} days / week</span>
              {!isReadOnly && <span className="text-sm font-bold text-ink-faint flex items-center gap-1">Edit <Pencil className="w-3.5 h-3.5" /></span>}
            </button>

            <nav className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {plan.days.map((d) => (
                <button key={d.id} onClick={() => setActiveDay(d.id)} className={`rounded-2xl px-3.5 py-3 text-left transition ${activeDay === d.id ? "bg-ink text-white shadow-lg" : "bg-card text-ink-soft border border-line hover:border-ink-faint"}`}>
                  <div className={`text-[11px] font-bold uppercase tracking-wide font-mono ${activeDay === d.id ? "text-white/50" : "text-ink-faint"}`}>{d.label}</div>
                  <div className="text-base font-black leading-tight truncate">{d.title}</div>
                </button>
              ))}
            </nav>

            <div className="mb-5">
              <p className="text-base text-ink-soft mb-3"><span className="font-bold text-ink">{day.tagline}</span><span className="text-line mx-1.5">·</span>{focusCount} focus, {day.exercises.length - focusCount} maintenance</p>
              {day.exercises.length > 0 && (
                <button onClick={() => setSessionOpen(true)} className="w-full py-4 rounded-2xl text-lg font-black bg-charge text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-charge/20 hover:bg-charge-strong">
                  <Dumbbell className="w-5 h-5" /> Start workout
                </button>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {day.exercises.map((exItem) =>
                confirmDelete === exItem.id ? (
                  <div key={exItem.id} className="rounded-2xl border border-danger/30 bg-danger-soft p-4 flex items-center justify-between gap-3 sm:col-span-2">
                    <p className="text-sm text-danger">Delete <span className="font-bold">{exItem.name}</span>?</p>
                    <div className="flex gap-2 shrink-0"><button onClick={() => setConfirmDelete(null)} className="px-3 py-2 rounded-xl text-sm font-bold text-ink-soft hover:bg-white">Cancel</button><button onClick={() => deleteExercise(exItem.id)} className="px-3 py-2 rounded-xl text-sm font-bold bg-danger text-white">Delete</button></div>
                  </div>
                ) : (
                  <ExerciseCard key={exItem.id} ex={exItem} readOnly={isReadOnly} onOpenEdit={guard(() => setModal({ mode: "edit", exercise: exItem }))} onDelete={guard(() => setConfirmDelete(exItem.id))} onQuickPhoto={guard((dataUrl) => quickPhoto(exItem.id, dataUrl))} />
                )
              )}
              {day.exercises.length === 0 && <div className="sm:col-span-2 rounded-2xl border border-dashed border-line p-8 text-center text-base text-ink-faint">No exercises on this day yet.</div>}
              {!isReadOnly && <button onClick={guard(() => setModal({ mode: "add", exercise: emptyForm }))} className="sm:col-span-2 w-full rounded-2xl border-2 border-dashed border-line py-4 text-base font-bold text-ink-faint hover:border-charge hover:text-charge transition-colors flex items-center justify-center gap-1.5"><Plus className="w-5 h-5" /> Add exercise</button>}
            </div>

            <footer className="mt-8 pt-4 border-t border-line text-xs text-ink-faint">
              {saveError ? "Changes aren't saving right now — edits may be lost on refresh." : firebaseUser ? "Saved on this device and synced." : "Saved on this device."}
            </footer>
          </>
        )}

        {page === "community" && <CommunityPage onFork={forkPlan} isOnline={isOnline} />}

        {page === "profile" && (
          <div className="space-y-6">
            <h1 className="text-3xl font-black tracking-tight text-ink font-display">You</h1>

            <section>
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">My plans</h2>
                <button onClick={guard(() => setNewPlanOpen(true))} className="text-sm font-bold text-charge flex items-center gap-1 hover:text-charge-strong"><Plus className="w-4 h-4" /> New</button>
              </div>
              <div className="space-y-2">
                {plans.map((p) => (
                  confirmDeletePlan === p.id ? (
                    <div key={p.id} className="rounded-2xl border border-danger/30 bg-danger-soft p-4 flex items-center justify-between gap-3">
                      <p className="text-sm text-danger">Delete <span className="font-bold">{p.name}</span>?</p>
                      <div className="flex gap-2 shrink-0"><button onClick={() => setConfirmDeletePlan(null)} className="px-3 py-2 rounded-xl text-sm font-bold text-ink-soft hover:bg-white">Cancel</button><button onClick={() => deletePlan(p.id)} className="px-3 py-2 rounded-xl text-sm font-bold bg-danger text-white">Delete</button></div>
                    </div>
                  ) : (
                    <div key={p.id} className={`rounded-2xl p-4 flex items-center gap-3 ${p.id === activePlanId ? "bg-ink" : "bg-card border border-line"}`}>
                      <button onClick={() => switchPlan(p.id)} className="flex-1 min-w-0 text-left">
                        <p className={`font-black truncate ${p.id === activePlanId ? "text-white" : "text-ink"}`}>{p.name}</p>
                        <p className={`text-xs ${p.id === activePlanId ? "text-white/50" : "text-ink-faint"}`}>{LEVELS.find((l) => l.id === p.level)?.name || "Custom"} · {p.days.length} days/wk{p.author ? ` · by ${p.author}` : ""}</p>
                      </button>
                      {p.id === activePlanId && <span className="shrink-0 w-7 h-7 rounded-full bg-charge flex items-center justify-center"><Check className="w-4 h-4 text-white" /></span>}
                      {plans.length > 1 && (
                        <button onClick={guard(() => setConfirmDeletePlan(p.id))} className={`shrink-0 p-2 rounded-lg ${p.id === activePlanId ? "text-white/40 hover:text-white" : "text-ink-faint hover:text-danger"}`} aria-label="Delete plan"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  )
                ))}
              </div>
              <button onClick={() => { if (!isOnline) return; if (!canEdit) { setSyncOpen(true); return; } setSubmitOpen(true); }} disabled={!isOnline} className="w-full mt-3 py-3 rounded-2xl text-sm font-bold text-ink-faint border-2 border-dashed border-line hover:border-charge hover:text-charge transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40">
                <Send className="w-4 h-4" /> Submit "{plan.name}" for pinning{!isOnline && " (needs internet)"}
              </button>
            </section>

            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint mb-2.5">Profile</h2>
              <button onClick={() => isOnline && setSyncOpen(true)} disabled={!isOnline} className="w-full flex items-center justify-between gap-2 bg-card border border-line rounded-2xl px-4 py-3.5 disabled:opacity-40 hover:border-ink-faint transition-colors">
                <span className="flex items-center gap-2.5"><Cloud className={`w-5 h-5 ${canEdit ? "text-charge" : "text-w2"}`} /><span className="font-bold text-ink text-base">{canEdit ? firebaseUser.displayName : "Trying it out — sign in to save"}</span></span>
                <ChevronRight className="w-4 h-4 text-ink-faint" />
              </button>
            </section>

            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint mb-2.5">Backup</h2>
              <div className="flex gap-2">
                <button onClick={guard(exportData)} className="flex-1 py-3 rounded-2xl text-sm font-bold text-ink-soft bg-card border border-line flex items-center justify-center gap-1.5 hover:border-ink-faint transition-colors"><Download className="w-4 h-4" /> Export</button>
                <button onClick={guard(() => fileInputRef.current?.click())} className="flex-1 py-3 rounded-2xl text-sm font-bold text-ink-soft bg-card border border-line flex items-center justify-center gap-1.5 hover:border-ink-faint transition-colors"><Upload className="w-4 h-4" /> Import</button>
              </div>
              <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importData(f); e.target.value = ""; }} />
            </section>
          </div>
        )}
      </div>

      <nav className="fixed bottom-4 inset-x-4 sm:inset-x-0 sm:max-w-xs sm:mx-auto bg-ink rounded-2xl grid grid-cols-3 z-30 shadow-[0_8px_28px_rgba(21,23,26,0.28)] p-1.5">
        {[
          { id: "train", label: "Train", Icon: Home },
          { id: "community", label: "Community", Icon: Users },
          { id: "profile", label: "You", Icon: User },
        ].map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setPage(id)} className="relative flex flex-col items-center gap-0.5 py-2.5 active:scale-95 transition-transform">
            {page === id && <span className="absolute inset-0 bg-charge rounded-xl" />}
            <Icon className={`relative w-5 h-5 transition-colors ${page === id ? "text-white" : "text-white/40"}`} strokeWidth={2.25} />
            <span className={`relative text-[10px] font-bold transition-colors ${page === id ? "text-white" : "text-white/40"}`}>{label}</span>
          </button>
        ))}
      </nav>
      <div className="h-4" />


      {modal && <ExerciseModal title={modal.mode === "add" ? "Add exercise" : "Edit exercise"} initial={modal.exercise} onCancel={() => setModal(null)} onSave={(form) => { if (modal.mode === "add") addExercise(form); else { updateExercise({ ...form, id: modal.exercise.id }); setModal(null); } }} />}
      {newPlanOpen && <NewPlanModal onCancel={() => setNewPlanOpen(false)} onCreate={createPlan} />}
      {manageDaysOpen && <ManageDaysModal days={plan.days} onCancel={() => setManageDaysOpen(false)} onSave={saveDays} />}
      {syncOpen && <ProfileModal user={firebaseUser} onCancel={() => setSyncOpen(false)} onSignIn={doSignIn} onUpgrade={doUpgrade} onSignOut={doSignOut} status={syncStatus} error={syncError} />}
      {submitOpen && <SubmitModal plan={plan} user={firebaseUser} onCancel={() => setSubmitOpen(false)} />}
      {sessionOpen && day && <WorkoutSession day={day} onExit={() => setSessionOpen(false)} />}
      {needsName && canEdit && <NameModal onSave={saveName} />}
    </div>
  );
}
