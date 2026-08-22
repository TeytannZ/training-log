import React, { useState, useEffect, useRef, useCallback, useReducer } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInAnonymously, linkWithPopup, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot, runTransaction } from "firebase/firestore";
import {
  Plus, Pencil, Trash2, Camera, X, Check, Star, Dumbbell,
  Loader2, ChevronDown, Search, Download, Upload, ChevronRight,
  Cloud, RefreshCw, AlertTriangle, Sparkles, Users, Send, Copy, Calendar,
  Home, User, WifiOff, Clock, Flame, Volume2, VolumeX, Menu, Share,
} from "lucide-react";

// The original app used `window.storage`, an API that only exists inside
// Claude's own preview sandbox — it's undefined on a real deployed site,
// so every get/set silently failed there and the onboarding flag never
// actually saved, forcing the sign-in screen to reappear on every visit
// even though Firebase itself had already remembered the session. This
// fills in the same get/set/delete/list shape using real localStorage
// whenever the sandbox version isn't present.
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      try { const v = localStorage.getItem(key); return v === null ? null : { key, value: v, shared: false }; }
      catch (err) { return null; }
    },
    async set(key, value) {
      try { localStorage.setItem(key, value); return { key, value, shared: false }; }
      catch (err) { return null; }
    },
    async delete(key) {
      try { localStorage.removeItem(key); return { key, deleted: true, shared: false }; }
      catch (err) { return null; }
    },
    async list(prefix) {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!prefix || k.startsWith(prefix)) keys.push(k); }
        return { keys, shared: false };
      } catch (err) { return null; }
    },
  };
}

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

// ---- Weight tiers, recolored to the standardized color code used on
// competition bumper plates (white -> green -> yellow -> blue -> red as
// load increases). Every lifter already reads plate color as "how heavy"
// on sight, so the app reuses that real system instead of an invented
// one. See index.css for the actual hex values behind each class. ----
const WEIGHT_INFO = {
  Light: { bg: "bg-w1-soft", text: "text-w1-strong", ring: "ring-w1-ring", dot: "bg-w1", solid: "bg-w1-strong", accent: "text-w1", hex: "#ded7c5", plate: "White", desc: "خفيف — سهل" },
  "Light-Medium": { bg: "bg-w2-soft", text: "text-w2-strong", ring: "ring-w2-ring", dot: "bg-w2", solid: "bg-w2-strong", accent: "text-w2", hex: "#57c07a", plate: "Green", desc: "بين الخفيف والمتوسط" },
  Medium: { bg: "bg-w3-soft", text: "text-w3-strong", ring: "ring-w3-ring", dot: "bg-w3", solid: "bg-w3-strong", accent: "text-w3", hex: "#e8c247", plate: "Yellow", desc: "متوسط — مجهود واضح" },
  "Medium-Heavy": { bg: "bg-w4-soft", text: "text-w4-strong", ring: "ring-w4-ring", dot: "bg-w4", solid: "bg-w4-strong", accent: "text-w4", hex: "#6fa8dd", plate: "Blue", desc: "بين المتوسط والثقيل" },
  Heavy: { bg: "bg-w5-soft", text: "text-w5-strong", ring: "ring-w5-ring", dot: "bg-w5", solid: "bg-w5-strong", accent: "text-w5", hex: "#ef6a5f", plate: "Red", desc: "ثقيل — قرب أقصى مجهود" },
};
const WEIGHT_OPTIONS = ["Light", "Light-Medium", "Medium", "Medium-Heavy", "Heavy"];
const STORAGE_KEY = "training-log-plans-v4";
const ONBOARD_KEY = "training-log-onboarded";
const emptyForm = { name: "", muscle: "", focus: false, sets: 3, reps: "", weight: "Medium", rest: "60 sec", restBetweenExercises: "", image: null };
// Self-hosted APK — place the file built by pwabuilder.com at this exact
// path in your repo's public/ folder. Relative path so it resolves under
// the /training-log/ base automatically. Keeps the whole install flow on
// your own site — no GitHub, no third-party site, for anyone downloading.
const APK_DOWNLOAD_URL = "./downloads/training-log.apk";

function ex(id, name, muscle, focus, sets, reps, weight, rest, alt = [], restBetweenExercises = null) {
  return { id, name, muscle, focus, sets, reps, weight, rest, image: null, alt, restBetweenExercises };
}
function mkDay(id, label, title, tagline, exercises) { return { id, label, title, tagline, exercises }; }

// Straight 4-day Upper/Lower x2 split: each muscle gets hit twice a week
// instead of once, which is the stronger driver for lagging muscles than
// a single-hit body-part split. Mon/Tue train, Wed rest, Thu/Fri train,
// Sat/Sun rest. Every line lists one primary lift; `alt` is a same-slot
// substitute if equipment's busy or a lift doesn't feel right that day —
// pick one, not both. Progression: compounds RPE 7-9, isolation RPE 8-9
// (1-2 reps in reserve) — add weight once you hit the top of the rep
// range for all sets, two sessions running.
const ESTABLISHED_DAYS = [
  mkDay("day1", "اليوم 1", "علوي أ", "الظهر، الصدر، الكتف الخلفي/الترابيس، البايسبس", [
    ex("d1e1", "Weighted pull-up", "Back", false, 4, "6-10", "Heavy", "2.5 min", ["Lat pulldown, wide grip"]),
    ex("d1e2", "Chest-supported row", "Back", false, 3, "8-12", "Medium-Heavy", "2 min", ["Seated cable row"]),
    ex("d1e3", "Incline dumbbell press", "Chest", false, 3, "8-12", "Medium-Heavy", "2 min", ["Incline barbell press"]),
    ex("d1e4", "Face pull", "Rear delt / traps", true, 3, "12-15", "Light", "60 sec", ["Reverse pec-deck fly"]),
    ex("d1e5", "Barbell shrug", "Traps", true, 3, "10-15", "Medium-Heavy", "90 sec", ["Dumbbell shrug", "Cable shrug"]),
    ex("d1e6", "Cable curl — short head (elbows forward)", "Biceps", false, 2, "10-12", "Medium", "60 sec"),
    ex("d1e7", "Cable curl — long head (elbows back)", "Biceps", false, 2, "10-12", "Medium", "60 sec"),
  ]),
  mkDay("day2", "اليوم 2", "سفلي أ", "الفخذ الأمامي، الهامسترينغ، المؤخرة، السمانة، الجذع · تدرّج في القرفصاء إذا اشتد ألم الساق — بدّل إلى مكبس الأرجل", [
    ex("d2e1", "Back squat", "Quads", false, 4, "5-8", "Heavy", "2.5-3 min", ["Hack squat"]),
    ex("d2e2", "Romanian deadlift", "Hamstrings", true, 3, "8-10", "Heavy", "2.5 min", ["Lying leg curl"]),
    ex("d2e3", "Hip thrust", "Glutes", true, 3, "10-12", "Medium-Heavy", "90 sec", ["Cable pull-through"]),
    ex("d2e4", "Leg extension", "Quads", false, 3, "12-15", "Medium", "60 sec"),
    ex("d2e5", "Standing calf raise", "Calves", true, 4, "10-15", "Medium", "60 sec", ["Seated calf raise"]),
    ex("d2e6", "Hanging leg raise", "Core", true, 3, "12-15", "Light-Medium", "60 sec", ["Cable crunch"]),
  ]),
  mkDay("day3", "اليوم 3", "علوي ب", "الصدر، الظهر، الكتفين، الترايسبس", [
    ex("d3e1", "Flat barbell bench press", "Chest", false, 4, "6-10", "Heavy", "2.5 min", ["Flat dumbbell press"]),
    ex("d3e2", "Weighted dips", "Chest / triceps", false, 3, "AMRAP", "Medium-Heavy", "2 min", ["Close-grip bench press"]),
    ex("d3e3", "Lat pulldown, underhand grip", "Back", false, 3, "8-12", "Medium-Heavy", "2 min", ["Chin-ups"]),
    ex("d3e4", "Cable lateral raise (leaning away)", "Delts", true, 3, "12-15", "Light-Medium", "60 sec", ["Dumbbell lateral raise"]),
    ex("d3e5", "Rear-delt cable fly (45°)", "Rear delt", true, 3, "12-15", "Light", "60 sec", ["Machine reverse fly"]),
    ex("d3e6", "Overhead one-arm cable extension", "Triceps", false, 2, "10-12", "Medium", "60 sec"),
    ex("d3e7", "One-arm cable pushdown", "Triceps", false, 2, "10-12", "Medium", "60 sec"),
  ]),
  mkDay("day4", "اليوم 4", "سفلي ب", "الهامسترينغ، المؤخرة، السمانة، الجذع · نفس التحذير — تدرّج في الرفعة الميتة، بدّل إلى مكبس الأرجل عند الحاجة", [
    ex("d4e1", "Deadlift (conventional or RDL)", "Hamstrings / glutes", true, 4, "5-8", "Heavy", "3 min", ["Trap bar deadlift"]),
    ex("d4e2", "Bulgarian split squat", "Glutes", true, 3, "10-12/leg", "Medium-Heavy", "90 sec", ["Walking lunge", "Leg press"]),
    ex("d4e3", "Lying leg curl", "Hamstrings", true, 3, "10-12", "Medium", "90 sec"),
    ex("d4e4", "Hip abduction machine", "Glute medius", true, 3, "12-15", "Light-Medium", "60 sec", ["Banded lateral walk"]),
    ex("d4e5", "Seated calf raise", "Calves", true, 4, "12-15", "Medium", "60 sec", ["Standing calf raise"]),
    ex("d4e6", "Weighted plank / Pallof press", "Core (anti-rotation)", true, 3, "30-45 sec", "Light-Medium", "60 sec", ["Side plank"]),
  ]),
];

const STEP_DOWN = { Heavy: "Medium-Heavy", "Medium-Heavy": "Medium", Medium: "Light-Medium", "Light-Medium": "Light", Light: "Light" };
const RETURNING_DAYS = ESTABLISHED_DAYS.map((d) => ({ ...d, tagline: `${d.tagline} · تدرّج، الأسابيع 1-3`, exercises: d.exercises.map((e) => ({ ...e, weight: STEP_DOWN[e.weight] || e.weight, sets: Math.max(2, e.sets - 1) })) }));

const STARTER_DAYS = [
  mkDay("sday1", "اليوم 1", "الجسم الكامل أ", "أساس الجسم الكامل", [
    ex("s1e1", "Back squat", "Quads / glutes", false, 3, "8-10", "Medium", "2 min"),
    ex("s1e2", "Flat bench press", "Chest", false, 3, "8-10", "Medium", "2 min"),
    ex("s1e3", "Seated cable row", "Back", false, 3, "10-12", "Medium", "90 sec"),
    ex("s1e4", "Plank", "Core", false, 3, "20-40 sec hold", "Light-Medium", "60 sec"),
    ex("s1e5", "Standing calf raise", "Calves", false, 2, "12-15", "Light-Medium", "60 sec"),
  ]),
  mkDay("sday2", "اليوم 2", "الجسم الكامل ب", "أساس الجسم الكامل", [
    ex("s2e1", "Romanian deadlift", "Hamstrings / glutes", false, 3, "8-10", "Medium", "2 min"),
    ex("s2e2", "Overhead press", "Delts", false, 3, "8-10", "Light-Medium", "2 min"),
    ex("s2e3", "Lat pulldown", "Back", false, 3, "10-12", "Medium", "90 sec"),
    ex("s2e4", "Hanging knee raise", "Core", false, 3, "8-12", "Light-Medium", "60 sec"),
    ex("s2e5", "Dumbbell shrug", "Traps", false, 2, "10-12", "Light-Medium", "60 sec"),
  ]),
  mkDay("sday3", "اليوم 3", "الجسم الكامل ج", "أساس الجسم الكامل", [
    ex("s3e1", "Leg press", "Quads", false, 3, "10-12", "Medium", "90 sec"),
    ex("s3e2", "Incline dumbbell press", "Chest", false, 3, "10-12", "Light-Medium", "90 sec"),
    ex("s3e3", "Seated cable row (wide grip)", "Back", false, 3, "10-12", "Medium", "90 sec"),
    ex("s3e4", "Bicep curl", "Biceps", false, 2, "10-12", "Light-Medium", "60 sec"),
    ex("s3e5", "Triceps pushdown", "Triceps", false, 2, "10-12", "Light-Medium", "60 sec"),
  ]),
];

const GENERAL_DAYS = [
  mkDay("gday1", "اليوم 1", "سفلي أ", "متوازن — بدون تركيز جمالي", [
    ex("g1e1", "Back squat", "Quads / glutes", false, 3, "6-8", "Heavy", "2.5 min"),
    ex("g1e2", "Leg curl", "Hamstrings", false, 3, "10-12", "Medium", "90 sec"),
    ex("g1e3", "Leg press", "Quads", false, 3, "10-15", "Medium", "90 sec"),
    ex("g1e4", "Standing calf raise", "Calves", false, 3, "12-15", "Medium", "60 sec"),
    ex("g1e5", "Cable crunch", "Core", false, 3, "12-15", "Medium", "60 sec"),
  ]),
  mkDay("gday2", "اليوم 2", "علوي أ", "متوازن — بدون تركيز جمالي", [
    ex("g2e1", "Flat bench press", "Chest", false, 3, "6-8", "Heavy", "2.5 min"),
    ex("g2e2", "Seated cable row", "Back", false, 3, "8-12", "Medium-Heavy", "90 sec"),
    ex("g2e3", "Overhead press", "Delts", false, 3, "8-10", "Medium", "90 sec"),
    ex("g2e4", "Lat pulldown", "Back", false, 3, "10-12", "Medium", "90 sec"),
    ex("g2e5", "EZ bar curl", "Biceps", false, 2, "10-12", "Medium", "60 sec"),
  ]),
  mkDay("gday3", "اليوم 3", "سفلي ب", "متوازن — بدون تركيز جمالي", [
    ex("g3e1", "Deadlift", "Posterior chain", false, 3, "5-6", "Heavy", "3 min"),
    ex("g3e2", "Walking lunge", "Quads / glutes", false, 3, "10-12/leg", "Medium", "90 sec"),
    ex("g3e3", "Leg extension", "Quads", false, 3, "12-15", "Medium", "60 sec"),
    ex("g3e4", "Seated calf raise", "Calves", false, 3, "15-20", "Medium", "60 sec"),
    ex("g3e5", "Hanging leg raise", "Core", false, 3, "10-15", "Medium", "60 sec"),
  ]),
  mkDay("gday4", "اليوم 4", "علوي ب", "متوازن — بدون تركيز جمالي", [
    ex("g4e1", "Incline dumbbell press", "Chest", false, 3, "8-10", "Medium-Heavy", "2 min"),
    ex("g4e2", "Pull-up (assisted if needed)", "Back", false, 3, "6-10", "Medium-Heavy", "2 min"),
    ex("g4e3", "Lateral raise", "Delts", false, 3, "12-15", "Light-Medium", "60 sec"),
    ex("g4e4", "Face pull", "Rear delt", false, 3, "15-20", "Light", "60 sec"),
    ex("g4e5", "Triceps pushdown", "Triceps", false, 2, "10-12", "Medium", "60 sec"),
  ]),
];

const LEVELS = [
  { id: "starter", name: "مبتدئ", days: STARTER_DAYS, blurb: "3 أيام أسبوعياً، جسم كامل. لا حاجة لخبرة سابقة." },
  { id: "general", name: "عام", days: GENERAL_DAYS, blurb: "4 أيام أسبوعياً، متوازن على كل العضلات، بدون تركيز معيّن." },
  { id: "returning", name: "العودة بعد انقطاع", days: RETURNING_DAYS, blurb: "4 أيام أسبوعياً بأوزان أخف لمدة 2-4 أسابيع من التدرج." },
  { id: "established", name: "خطة المطوّر", days: ESTABLISHED_DAYS, blurb: "4 أيام أسبوعياً — تركيز على المؤخرة والهامسترينغ والسمانة والكتفين والجذع." },
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
function isStandalonePwa() { return typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true); }
function signInGoogle() {
  // Popups can misbehave inside an installed/standalone PWA window (no
  // sensible place for the popup to open) — fall back to a full-page
  // redirect there instead of surfacing a confusing failure.
  if (isStandalonePwa()) return signInWithRedirect(auth, new GoogleAuthProvider());
  return signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => {
    if (err?.code === "auth/popup-blocked" || err?.code === "auth/operation-not-supported-in-this-environment") {
      return signInWithRedirect(auth, new GoogleAuthProvider());
    }
    throw err;
  });
}
function signUpEmail(email, pw) { return createUserWithEmailAndPassword(auth, email, pw); }
function signInEmail(email, pw) { return signInWithEmailAndPassword(auth, email, pw); }
function signOutUser() { return signOut(auth); }
function subscribeAuth(cb) { return onAuthStateChanged(auth, cb); }
function isRealAccount(user) { return !!user && !user.isAnonymous; }

// Turns a Firebase auth error into something a user (and Spirito, debugging)
// can actually read, instead of a hardcoded generic string.
function authErrorMessage(err, fallback) {
  const code = err?.code || "";
  if (code === "auth/popup-blocked") return "متصفحك منع نافذة تسجيل الدخول — اسمح بالنوافذ المنبثقة لهذا الموقع وحاول مرة أخرى.";
  if (code === "auth/popup-closed-by-user") return "أُغلقت نافذة تسجيل الدخول قبل الانتهاء — حاول مرة أخرى.";
  if (code === "auth/unauthorized-domain") return "هذا النطاق غير مُصرّح له بتسجيل الدخول بعد.";
  if (code === "auth/network-request-failed") return "خطأ في الشبكة — تحقق من اتصالك وحاول مرة أخرى.";
  if (code === "auth/email-already-in-use") return "هذا البريد الإلكتروني لديه حساب بالفعل — حاول تسجيل الدخول بدلاً من ذلك.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "البريد الإلكتروني أو كلمة المرور غير متطابقين — حاول مرة أخرى.";
  if (code === "auth/weak-password") return "كلمة المرور يجب أن تكون 6 أحرف على الأقل.";
  if (code === "auth/invalid-email") return "هذا لا يبدو بريداً إلكترونياً صحيحاً.";
  return code ? `${fallback} (${code})` : fallback;
}

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
async function saveThemePreference(uid, theme) {
  try { await setDoc(doc(dbase, "users", uid), { theme }, { merge: true }); } catch (err) { /* best-effort */ }
}

// ---- Themes ----
// Each theme is a full CSS variable set (colors, fonts, radius) scoped
// to [data-theme="id"] in index.css — see the THEMES block there. This
// list only drives the picker UI and validates a stored/loaded value.
const THEMES = [
  { id: "equipment", name: "غرفة المعدات", desc: "داكن، نحاسي، الافتراضي" },
  { id: "studio", name: "استوديو", desc: "فاتح، هادئ، أنيق" },
  { id: "arcade", name: "أركيد", desc: "تباين عالٍ، أخضر نيون" },
];
const THEME_KEY = "training-log-theme";
function applyTheme(id) {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = id;
}

// ---- Admins ----
// There's no backend here (no Cloud Functions), so admin status can't be a
// field a user sets on their own document — a user could just edit that
// field on themselves. Instead admin-ness is a hardcoded allow-list of
// UIDs, kept in TWO places that must match: this array (so the app knows
// to show admin UI) and firestore.rules (so Firestore actually enforces
// it server-side). The array here is convenience only — it grants no real
// permission by itself, since every write it enables is re-checked by the
// rules regardless of what this file says.
const ADMIN_UIDS = [
  "TIQ1Ja4qDTRSdr9IPcjiO2A0DFf1", // Spirito
];
function isAdmin(user) { return !!user && ADMIN_UIDS.includes(user.uid); }

// ---- Shared plans (community + share-by-code) ----
// One collection, two ways a plan can leave "private":
//  - visibility "public": submitted for review, only listed in Community
//    once an admin flips approved -> true.
//  - visibility "shared": instantly live, but only reachable by a 6-char
//    code — the code IS the Firestore document ID, so finding one means
//    doing a direct getDoc-by-id (allowed by the rules), not a collection
//    query (which the rules deliberately do not allow for "shared" docs,
//    so they can't be discovered by browsing).
// Plans that never touch this collection at all (the normal case) are
// exactly as private as they've always been.
function cleanPlanForSharing(plan) {
  return { ...plan, days: plan.days.map((d) => ({ ...d, exercises: d.exercises.map(({ image, ...rest }) => rest) })) };
}
function makeShareCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — easier to read out loud
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
async function fetchCommunityPlans() {
  const q = query(collection(dbase, "sharedPlans"), where("visibility", "==", "public"), where("approved", "==", true));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function submitPlanForReview(plan, uid, name, description) {
  const clean = cleanPlanForSharing(plan);
  const ref = await addDoc(collection(dbase, "sharedPlans"), { ...clean, ownerId: uid, author: name, description: description || "", visibility: "public", approved: false, recommended: false, announced: false, submittedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}
// Pushes the owner's current local edits onto an already-submitted public
// doc, instead of creating a duplicate. `announce` controls whether it
// shows an "Updated" badge in Community — sometimes a fix is worth
// flagging, sometimes it's not worth bothering people over.
async function updateSharedPlanContent(shareId, plan, description, announce) {
  const clean = cleanPlanForSharing(plan);
  await setDoc(doc(dbase, "sharedPlans", shareId), { ...clean, description: description || "", updatedAt: serverTimestamp(), announced: !!announce }, { merge: true });
}
async function shareplanByCode(plan, uid, name, description) {
  const clean = cleanPlanForSharing(plan);
  const code = makeShareCode();
  await setDoc(doc(dbase, "sharedPlans", code), { ...clean, ownerId: uid, author: name, description: description || "", visibility: "shared", approved: true, submittedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return code;
}
async function stopSharingPlan(shareId) {
  await deleteDoc(doc(dbase, "sharedPlans", shareId));
}
async function fetchPlanByCode(code) {
  const snap = await getDoc(doc(dbase, "sharedPlans", code.trim().toUpperCase()));
  if (!snap.exists() || snap.data().visibility !== "shared") return null;
  return { id: snap.id, ...snap.data() };
}
async function fetchPendingSubmissions() {
  const q = query(collection(dbase, "sharedPlans"), where("visibility", "==", "public"), where("approved", "==", false));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function fetchLiveCommunityPlansForAdmin() {
  const q = query(collection(dbase, "sharedPlans"), where("visibility", "==", "public"), where("approved", "==", true));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
// Admin can pin/unpin/recommend/delete ANY public submission, at any
// time — not just the ones still waiting on first review. "Unpin" keeps
// the doc (so it can be re-approved later) but pulls it out of Community
// immediately; "delete" removes it outright.
async function adminSetApproved(planId, approved) {
  await setDoc(doc(dbase, "sharedPlans", planId), { approved }, { merge: true });
}
async function adminSetRecommended(planId, recommended) {
  await setDoc(doc(dbase, "sharedPlans", planId), { recommended }, { merge: true });
}
async function adminClearAnnounced(planId) {
  await setDoc(doc(dbase, "sharedPlans", planId), { announced: false }, { merge: true });
}
async function adminDeleteSharedPlan(planId) {
  await deleteDoc(doc(dbase, "sharedPlans", planId));
}

// ---- Chat (contact / feedback — a real back-and-forth thread with
// the admin, not a one-shot form) ----
// One thread per user: threads/{uid} holds lightweight metadata (last
// message preview, unread flags for the nav badge), threads/{uid}/messages
// holds every message either side has sent, oldest first. Messages are
// never edited or deleted once sent — this is a chat log, not a form.
async function sendThreadMessage(uid, from, name, body, image, link) {
  await addDoc(collection(dbase, "threads", uid, "messages"), {
    from, body: body || "", image: image || null, link: link || null, createdAt: serverTimestamp(),
  });
  const preview = body?.trim() ? body.trim().slice(0, 120) : (image ? "📷 صورة" : "🔗 رابط");
  await setDoc(doc(dbase, "threads", uid), {
    uid, lastMessage: preview, lastFrom: from, updatedAt: serverTimestamp(),
    ...(from === "user" ? { name: name || null, unreadForAdmin: true } : { unreadForUser: true }),
  }, { merge: true });
}
// Realtime — new messages (either side) appear the moment they land.
function subscribeThreadMessages(uid, cb) {
  return onSnapshot(collection(dbase, "threads", uid, "messages"), (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    cb(items);
  });
}
function subscribeThread(uid, cb) {
  return onSnapshot(doc(dbase, "threads", uid), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}
// Admin inbox — every thread, most-recently-active first.
function subscribeAllThreads(cb) {
  return onSnapshot(collection(dbase, "threads"), (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
    cb(items);
  });
}
async function markThreadSeen(uid, role) {
  try { await setDoc(doc(dbase, "threads", uid), role === "admin" ? { unreadForAdmin: false } : { unreadForUser: false }, { merge: true }); } catch (err) { /* best-effort */ }
}

// ---- Soft rate limiting (message/submission spam) ----
// This is enforced client-side via a per-user counter document, checked
// with a transaction so two rapid taps can't both slip through. It's
// good enough to stop accidental or casual spam; it is NOT airtight
// against someone deliberately calling Firestore directly instead of
// using the app — real hardening against that needs a paid Cloud
// Function, which is out of scope for a free-tier app like this one.
async function checkAndBumpRateLimit(uid, kind, max, windowMs) {
  const ref = doc(dbase, "rateLimits", uid, "kinds", kind);
  try {
    return await runTransaction(dbase, async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      let data = snap.exists() ? snap.data() : { windowStart: now, count: 0 };
      if (now - data.windowStart > windowMs) data = { windowStart: now, count: 0 };
      if (data.count >= max) return false;
      tx.set(ref, { windowStart: data.windowStart, count: data.count + 1 });
      return true;
    });
  } catch (err) { return true; } // fail open — never block a legit user over our own limiter breaking
}

// ---- Shared UI ----

function Field({ label, children }) { return <div><label className="block text-sm font-bold text-ink-soft mb-1.5">{label}</label>{children}</div>; }
const inputClass = "w-full rounded-xl border border-line px-4 py-3 text-base bg-mist text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-charge focus:border-charge transition-shadow";
const sheetClass = "bg-card w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto border border-line shadow-2xl";

// A tiny plate silhouette — a ring with a bore hole — instead of a plain
// dot, so the weight tier reads as an actual gym plate, not decoration.
// shape "round" (default) reads as a plate in badges/session; "square"
// is used in the legend, where a rounded swatch scans faster in a list.
const WEIGHT_LABEL_AR = { Light: "خفيف", "Light-Medium": "خفيف-متوسط", Medium: "متوسط", "Medium-Heavy": "متوسط-ثقيل", Heavy: "ثقيل" };
function wLabel(w) { return WEIGHT_LABEL_AR[w] || w; }

const EXNAME_AR = {"Weighted pull-up": "عقلة بوزن إضافي", "Chest-supported row": "تجديف بإسناد الصدر", "Incline dumbbell press": "ضغط دمبل مائل", "Face pull": "سحب للوجه", "Barbell shrug": "هز الكتفين بالبار", "Cable curl — short head (elbows forward)": "بايسبس الكيبل (الرأس القصير)", "Cable curl — long head (elbows back)": "بايسبس الكيبل (الرأس الطويل)", "Back squat": "القرفصاء الخلفية", "Romanian deadlift": "الرفعة الرومانية", "Hip thrust": "دفع الحوض", "Leg extension": "فرد الساق", "Standing calf raise": "رفع الكعبين واقفًا", "Hanging leg raise": "رفع الأرجل على العقلة", "Flat barbell bench press": "ضغط البنش المستوي", "Weighted dips": "المتوازي بوزن إضافي", "Lat pulldown, underhand grip": "السحب الأمامي بقبضة معكوسة", "Cable lateral raise (leaning away)": "رفع جانبي بالكيبل (مائلًا بعيدًا)", "Rear-delt cable fly (45°)": "فراشة الكيبل للكتف الخلفي", "Overhead one-arm cable extension": "فرد الترايسبس بالكيبل فوق الرأس", "One-arm cable pushdown": "دفع الترايسبس بالكيبل بيد واحدة", "Deadlift (conventional or RDL)": "الرفعة الميتة (تقليدية أو رومانية)", "Bulgarian split squat": "القرفصاء البلغارية", "Lying leg curl": "ثني الساق مستلقيًا", "Hip abduction machine": "جهاز إبعاد الفخذ", "Seated calf raise": "رفع الكعبين جالسًا", "Weighted plank / Pallof press": "بلانك بوزن إضافي / دفع بالوف", "Flat bench press": "ضغط البنش المستوي", "Seated cable row": "تجديف الكيبل جالسًا", "Plank": "بلانك", "Overhead press": "ضغط الكتف فوق الرأس", "Lat pulldown": "السحب الأمامي", "Hanging knee raise": "رفع الركبتين على العقلة", "Dumbbell shrug": "هز الكتفين بالدمبل", "Leg press": "مكبس الأرجل", "Seated cable row (wide grip)": "تجديف الكيبل جالسًا (قبضة عريضة)", "Bicep curl": "بايسبس كيرل", "Triceps pushdown": "دفع الترايسبس", "Leg curl": "ثني الساق", "Cable crunch": "كرانش الكيبل", "EZ bar curl": "بايسبس بار EZ", "Deadlift": "الرفعة الميتة", "Walking lunge": "طعنة المشي", "Pull-up (assisted if needed)": "عقلة (بمساعدة إن لزم)", "Lateral raise": "رفع جانبي", "Weighted step-up": "صعود الدرج بوزن إضافي", "Calf raise on leg press": "رفع الكعبين على مكبس الأرجل", "Reverse crunch": "كرانش عكسي", "Suitcase carry": "حمل الحقيبة", "Cable lateral raise": "رفع جانبي بالكيبل", "Prone Y-raise": "رفع Y مستلقيًا", "Cable external rotation": "الدوران الخارجي بالكيبل", "Reverse curl": "كيرل معكوس", "Farmer's hold": "حمل المزارع", "Dips": "المتوازي", "Pull-up": "عقلة", "Lat pulldown, wide grip": "السحب الأمامي بقبضة عريضة", "Incline barbell press": "ضغط البار المائل", "Reverse pec-deck fly": "الفراشة العكسية", "Cable shrug": "هز الكتفين بالكيبل", "Hack squat": "الهاك سكوات", "Cable pull-through": "سحب الكيبل من بين الساقين", "Flat dumbbell press": "ضغط الدمبل المستوي", "Close-grip bench press": "ضغط البنش بقبضة ضيقة", "Chin-ups": "عقلة بقبضة معكوسة", "Dumbbell lateral raise": "رفع جانبي بالدمبل", "Machine reverse fly": "الفراشة العكسية بالجهاز", "Trap bar deadlift": "الرفعة الميتة ببار مثلث", "Banded lateral walk": "المشي الجانبي بشريط المقاومة", "Side plank": "بلانك جانبي"};
const MUSCLE_AR = {"Back": "الظهر", "Chest": "الصدر", "Rear delt / traps": "الكتف الخلفي والترابيس", "Traps": "الترابيس", "Biceps": "البايسبس", "Quads": "الفخذ الأمامي", "Hamstrings": "الفخذ الخلفي", "Glutes": "الأرداف", "Calves": "السمانة", "Core": "البطن", "Chest / triceps": "الصدر والترايسبس", "Delts": "الكتفين", "Rear delt": "الكتف الخلفي", "Triceps": "الترايسبس", "Hamstrings / glutes": "الفخذ الخلفي والأرداف", "Glute medius": "جانب الأرداف", "Core (anti-rotation)": "البطن (ثبات ضد الالتواء)", "Quads / glutes": "الفخذ الأمامي والأرداف", "Posterior chain": "الظهر والأرداف", "Quads / glute max": "الفخذ الأمامي والأرداف", "Glute max": "الأرداف", "Core (anti-lateral-flexion)": "البطن (ثبات جانبي)", "Delts (front)": "الكتف الأمامي", "Delts (side)": "الكتف الجانبي", "Lower traps / posture": "الترابيس السفلية والقوام", "Rotator cuff / shoulder posture": "استقرار الكتف", "Forearms": "الساعدين", "Forearms / grip": "الساعدين وقوة القبضة", "Hamstrings / glute max": "الفخذ الخلفي والأرداف", "Chest (upper)": "الصدر العلوي", "Chest (lower) / triceps": "الصدر السفلي والترايسبس"};
// Shows "Arabic (English original)" so exercises stay searchable on
// YouTube/Google in the term most fitness content actually uses, per
// Spirito's choice to keep both rather than Arabic-only.
function exLabel(name) { const ar = EXNAME_AR[name]; return ar ? `${ar} (${name})` : name; }
function muscleLabel(m) { const ar = MUSCLE_AR[m]; return ar ? `${ar} (${m})` : m; }

function PlateIcon({ weight, size = 16, shape = "round" }) {
  const s = WEIGHT_INFO[weight] || WEIGHT_INFO.Medium;
  if (shape === "square") {
    const hole = Math.max(3, Math.round(size * 0.3));
    return (
      <span className="inline-flex items-center justify-center rounded-lg shrink-0" style={{ width: size, height: size, background: s.hex, boxShadow: `inset 0 0 0 ${Math.max(1, Math.round(size * 0.07))}px rgba(16,15,13,0.35)` }}>
        <span className="block rounded-sm bg-paper" style={{ width: hole, height: hole }} />
      </span>
    );
  }
  const hole = Math.max(3, Math.round(size * 0.34));
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ width: size, height: size, background: s.hex, boxShadow: `inset 0 0 0 ${Math.max(1, Math.round(size * 0.08))}px rgba(16,15,13,0.35)` }}
    >
      <span className="block rounded-full bg-paper mx-auto" style={{ width: hole, height: hole, marginTop: (size - hole) / 2 }} />
    </span>
  );
}

function PlateBadge({ weight, size = "sm" }) {
  const s = WEIGHT_INFO[weight] || WEIGHT_INFO.Medium;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold ring-1 font-mono ${s.bg} ${s.text} ${s.ring} ${size === "lg" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs"}`}>
      <PlateIcon weight={weight} size={size === "lg" ? 14 : 11} />{wLabel(weight)}
    </span>
  );
}

// The signature element: weight tiers colored exactly like standardized
// competition bumper plates. A vertical list, not a squeezed row — every
// tier keeps its full name AND its rep range legible on a phone screen,
// nothing gets hidden past a breakpoint.
function PlateLegend() {
  return (
    <div className="mb-5 rounded-2xl border border-line bg-card px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-3">
        <Dumbbell className="w-3.5 h-3.5 text-ink-faint" />
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">دليل الأوزان — الحمل من النظرة الأولى</p>
      </div>
      <div className="space-y-1.5">
        {WEIGHT_OPTIONS.map((w) => (
          <div key={w} className="flex flex-row-reverse items-center gap-3 rounded-xl bg-mist px-3 py-2">
            <PlateIcon weight={w} size={26} shape="square" />
            <span className="font-bold text-ink text-sm flex-1 text-right">{wLabel(w)}</span>
            <span className="text-xs text-ink-faint font-mono text-left">{WEIGHT_INFO[w].desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhotoChooser({ libraryImage, onPickUpload, onUseLibrary, onCancel }) {
  const inputRef = useRef(null);
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="p-5 space-y-2.5">
          <h3 className="font-display font-black text-lg text-ink mb-2">إضافة صورة</h3>
          {libraryImage && (
            <button onClick={() => onUseLibrary(libraryImage)} className="w-full flex items-center gap-3 p-3 rounded-2xl border border-line text-left hover:border-charge/50 hover:bg-charge-soft transition-colors">
              <img src={libraryImage} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
              <span><span className="font-bold text-ink block text-sm">استخدام صورة الأرشيف</span><span className="text-xs text-ink-faint">مطابقة لهذا التمرين مسبقاً</span></span>
            </button>
          )}
          <button onClick={() => inputRef.current?.click()} className="w-full flex items-center gap-3 p-3 rounded-2xl border border-line text-left hover:border-charge/50 hover:bg-charge-soft transition-colors">
            <span className="w-14 h-14 rounded-xl bg-mist flex items-center justify-center shrink-0"><Camera className="w-6 h-6 text-ink-faint" /></span>
            <span><span className="font-bold text-ink block text-sm">رفع صورتك الخاصة</span><span className="text-xs text-ink-faint">من جهازك</span></span>
          </button>
          <button onClick={onCancel} className="w-full py-3 text-sm font-bold text-ink-faint mt-1">إلغاء</button>
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { onPickUpload(await resizeImage(f)); } catch (err) { /* ignore */ } e.target.value = ""; }} />
      </div>
    </div>
  );
}

// variant "hero" = full-width square, used in modals. variant "thumb" =
// small fixed-size square, used in the compact exercise-list card.
function BigPhoto({ image, onPick, readOnly, libraryImage, variant = "hero" }) {
  const inputRef = useRef(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const handleTap = () => { if (libraryImage) setChooserOpen(true); else inputRef.current?.click(); };
  const sizeClass = variant === "thumb" ? "w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-2xl" : "w-full aspect-square rounded-t-2xl";
  return (
    <>
      <button type="button" disabled={readOnly} onClick={handleTap}
        className={`relative overflow-hidden bg-mist flex items-center justify-center group ${sizeClass}`}>
        {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : (
          <div className={`flex flex-col items-center text-ink-faint ${variant === "thumb" ? "gap-0.5" : "gap-1.5"}`}>
            <Camera className={variant === "thumb" ? "w-5 h-5" : "w-8 h-8"} />
            {variant !== "thumb" && <span className="text-sm font-semibold">{readOnly ? "لا توجد صورة" : "إضافة صورة"}</span>}
          </div>
        )}
        {!readOnly && (
          <span className="absolute inset-0 bg-ink/0 group-hover:bg-ink/40 active:bg-ink/40 transition-colors flex items-center justify-center">
            <Pencil className={`text-white opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity ${variant === "thumb" ? "w-4 h-4" : "w-6 h-6"}`} />
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-card flex items-center justify-between px-5 py-4 border-b border-line z-10">
          <h2 className="text-xl font-black text-ink font-display">{title}</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <BigPhoto image={form.image} onPick={(img) => setForm((f) => ({ ...f, image: img }))} libraryImage={match?.image} />
        {(form.videoId || match?.youtubeId) && (
          <div className="px-5 pt-3">
            <div className="aspect-video rounded-2xl overflow-hidden bg-mist">
              <iframe className="w-full h-full" src={youtubeEmbedUrl(form.videoId || match.youtubeId)} title="Exercise video" allowFullScreen />
            </div>
          </div>
        )}
        <div className="px-5 pt-3">
          <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-bold text-charge hover:text-charge-strong">
            <Search className="w-4 h-4" /> بحث عن صور لـ"{form.name || "هذا التمرين"}" <ChevronRight className="w-4 h-4" />
          </a>
        </div>
        <div className="p-5 pt-4 space-y-4">
          <Field label="اسم التمرين">
            <input value={form.name} onChange={set("name")} placeholder="ابدأ الكتابة — التمارين المعروفة تكتمل تلقائياً" list="exercise-library-names" className={inputClass} />
            <datalist id="exercise-library-names">{RUNTIME_LIBRARY.map((e) => <option key={e.name} value={e.name} />)}</datalist>
            {match && (
              <button type="button" onClick={applyLibrary} className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-charge-strong bg-charge-soft px-3 py-1.5 rounded-full"><Check className="w-3.5 h-3.5" /> استخدام العضلة/المجموعات/التكرارات القياسية لـ"{match.name}"</button>
            )}
          </Field>
          {!match && form.name.trim() && (
            <p className="text-xs text-ink-faint -mt-2">غير موجود في القائمة القياسية — هذا تمرين مخصص، يظهر فقط في خطتك.</p>
          )}
          {!match?.youtubeId && (
            <Field label="فيديو (اختياري)">
              <input value={videoUrl} onChange={(e) => { setVideoUrl(e.target.value); setForm((f) => ({ ...f, videoId: parseYoutubeId(e.target.value) })); }} placeholder="ألصق رابط يوتيوب" className={inputClass} />
              {videoUrl && !parseYoutubeId(videoUrl) && <p className="text-xs text-danger mt-1">هذا لا يبدو رابط يوتيوب صحيح</p>}
            </Field>
          )}
          <Field label="العضلة"><input value={form.muscle} onChange={set("muscle")} placeholder="مثال: المؤخرة الكبرى" className={inputClass} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="المجموعات"><input type="number" min="1" inputMode="numeric" value={form.sets} onChange={(e) => setForm((f) => ({ ...f, sets: e.target.value.replace(/[^0-9]/g, "") }))} className={inputClass} /></Field>
            <Field label="التكرارات"><input value={form.reps} onChange={set("reps")} placeholder="8-12" className={inputClass} /></Field>
            <Field label="الراحة"><input value={form.rest} onChange={set("rest")} placeholder="90 ثانية" className={inputClass} /></Field>
          </div>
          <Field label="الراحة قبل التمرين التالي (اختياري)">
            <input value={form.restBetweenExercises || ""} onChange={(e) => setForm((f) => ({ ...f, restBetweenExercises: e.target.value }))} placeholder={`تلقائياً: نفس مدة الراحة أعلاه (${form.rest || "90 ثانية"})`} className={inputClass} />
          </Field>
          <Field label="الوزن">
            <div className="flex flex-wrap gap-2">
              {WEIGHT_OPTIONS.map((w) => (
                <button key={w} type="button" onClick={() => setForm((f) => ({ ...f, weight: w }))} className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-full text-sm font-bold ring-1 transition ${form.weight === w ? `${WEIGHT_INFO[w].bg} ${WEIGHT_INFO[w].text} ${WEIGHT_INFO[w].ring}` : "bg-mist text-ink-faint ring-line"}`}>
                  <PlateIcon weight={w} size={12} />{wLabel(w)}
                </button>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2.5 text-base text-ink-soft cursor-pointer w-fit py-1">
            <input type="checkbox" checked={form.focus} onChange={(e) => setForm((f) => ({ ...f, focus: e.target.checked }))} className="w-5 h-5 rounded border-line accent-charge" />
            وضع علامة كعضلة تركيز
          </label>
        </div>
        <div className="sticky bottom-0 bg-card flex items-center gap-2 px-5 py-4 border-t border-line">
          <button onClick={onCancel} className="flex-1 py-3.5 rounded-xl text-base font-bold text-ink-soft hover:bg-mist">إلغاء</button>
          <button disabled={!canSave} onClick={() => canSave && onSave({ ...form, sets: Number(form.sets) || 1 })} className="flex-1 py-3.5 rounded-xl text-base font-bold bg-charge text-paper disabled:opacity-30 flex items-center justify-center gap-1.5 hover:bg-charge-strong transition-colors"><Check className="w-4 h-4" /> حفظ</button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({ ex: item, onCancel }) {
  const match = findLibraryMatch(item.name);
  const videoId = item.videoId || match?.youtubeId;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-card flex items-center justify-between px-5 py-4 border-b border-line z-10">
          <h2 className="text-xl font-black text-ink font-display">{exLabel(item.name)}</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        {item.image ? <img src={item.image} alt="" className="w-full aspect-square object-cover" /> : (
          <div className="w-full aspect-[16/9] bg-mist flex items-center justify-center"><Dumbbell className="w-10 h-10 text-ink-faint" /></div>
        )}
        {videoId ? (
          <div className="px-5 pt-4">
            <div className="aspect-video rounded-2xl overflow-hidden bg-mist">
              <iframe className="w-full h-full" src={youtubeEmbedUrl(videoId)} title="فيديو التمرين" allowFullScreen />
            </div>
          </div>
        ) : (
          <p className="px-5 pt-4 text-sm text-ink-faint">لا يوجد فيديو مضاف لهذا التمرين بعد.</p>
        )}
        <div className="p-5 space-y-3">
          <p className="text-ink-soft">{muscleLabel(item.muscle)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-mono font-bold text-ink bg-mist rounded-full px-3 py-1.5"><Dumbbell className="w-3.5 h-3.5" /> {item.sets} مجموعات · {item.reps}</span>
            <PlateBadge weight={item.weight} size="lg" />
            <span className="inline-flex items-center gap-1 text-sm font-mono text-ink-faint"><Clock className="w-3.5 h-3.5" /> {item.rest}</span>
          </div>
          {item.alt?.length > 0 && (
            <div className="rounded-2xl bg-mist p-3.5">
              <p className="text-xs font-bold text-ink-faint uppercase tracking-wide mb-1.5">أو بدلاً منه</p>
              <p className="text-sm text-ink-soft">{item.alt.map((a) => exLabel(a)).join(" · ")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Compact, horizontal card: thumbnail on the left, everything you need to
// scan (name, muscle, plate color, sets/reps/rest) on the right — built
// so a whole day's exercises are readable without a wall of full-width
// photos to scroll past.
function ExerciseCard({ ex: item, onOpenEdit, onDelete, onQuickPhoto, readOnly }) {
  const [detailOpen, setDetailOpen] = useState(false);
  return (
    <div className={`rounded-2xl bg-card border overflow-hidden transition-colors ${item.focus ? "border-charge/40" : "border-line"}`}>
      <div className="flex gap-3 p-3">
        <div className="relative">
          <BigPhoto image={item.image} onPick={onQuickPhoto} readOnly={readOnly} variant="thumb" />
          {item.focus && (
            <span className="absolute -top-1.5 -left-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-charge text-paper shadow" title="عضلة تركيز">
              <Star className="w-3 h-3 fill-ink" />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-start justify-between gap-1.5">
            <button type="button" onClick={() => setDetailOpen(true)} className="text-left min-w-0 flex-1">
              <h3 className="font-black text-ink text-[15px] leading-snug line-clamp-2">{exLabel(item.name)}</h3>
              <p className="text-xs font-bold text-ink-faint truncate mt-0.5">{muscleLabel(item.muscle)}</p>
            </button>
            {!readOnly && (
              <div className="flex gap-0.5 shrink-0 -mr-1.5 -mt-1">
                <button onClick={onOpenEdit} className="p-2 rounded-full bg-mist text-ink-soft hover:text-ink hover:bg-line/60" aria-label="تعديل"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={onDelete} className="p-2 rounded-full bg-mist text-ink-soft hover:text-danger hover:bg-danger-soft" aria-label="حذف"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>
          <div className="mt-auto pt-2 flex flex-wrap items-center gap-1.5">
            <PlateBadge weight={item.weight} />
            <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-ink-soft bg-mist rounded-full px-2.5 py-1">{item.sets} × {item.reps}</span>
            <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-ink-faint"><Clock className="w-3 h-3" /> {item.rest}</span>
          </div>
        </div>
      </div>
      {detailOpen && <DetailModal ex={item} onCancel={() => setDetailOpen(false)} />}
    </div>
  );
}

function ManageDaysModal({ days, onCancel, onSave }) {
  const [list, setList] = useState(days.map((d) => ({ ...d })));
  const update = (id, field, val) => setList((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: val } : d)));
  const remove = (id) => setList((prev) => prev.filter((d) => d.id !== id));
  const add = () => setList((prev) => [...prev, { id: `day-${Date.now()}`, label: `اليوم ${prev.length + 1}`, title: "يوم جديد", tagline: "", exercises: [] }]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div>
            <h2 className="text-xl font-black text-ink font-display">أيام الأسبوع</h2>
            <p className="text-xs text-ink-faint font-mono mt-0.5">{list.length} يوم في هذه الخطة</p>
          </div>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          {list.map((d, i) => (
            <div key={d.id} className="rounded-2xl border border-line p-4 space-y-2.5 bg-mist">
              <div className="flex items-center gap-2">
                <span className="shrink-0 w-7 h-7 rounded-full bg-charge text-paper text-xs font-black font-mono flex items-center justify-center">{i + 1}</span>
                <input value={d.title} onChange={(e) => update(d.id, "title", e.target.value)} placeholder="عنوان اليوم" className="flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-charge" />
                <button onClick={() => remove(d.id)} disabled={list.length <= 1} className="p-2.5 rounded-xl text-ink-faint hover:text-danger hover:bg-danger-soft disabled:opacity-20 transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
              <input value={d.tagline} onChange={(e) => update(d.id, "tagline", e.target.value)} placeholder="وصف مختصر، مثال: تركيز على المؤخرة والسمانة" className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-charge" />
              <p className="text-xs text-ink-faint font-mono">{d.exercises.length} تمارين</p>
            </div>
          ))}
          <button onClick={add} className="w-full rounded-2xl border-2 border-dashed border-line py-3.5 text-sm font-bold text-ink-faint hover:border-charge hover:text-charge transition-colors flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> إضافة يوم</button>
        </div>
        <div className="sticky bottom-0 bg-card flex items-center gap-2 px-5 py-4 border-t border-line">
          <button onClick={onCancel} className="flex-1 py-3.5 rounded-xl text-base font-bold text-ink-soft hover:bg-mist">إلغاء</button>
          <button onClick={() => onSave(list.map((d, i) => ({ ...d, label: `اليوم ${i + 1}` })))} className="flex-1 py-3.5 rounded-xl text-base font-bold bg-charge text-paper hover:bg-charge-strong transition-colors flex items-center justify-center gap-1.5"><Check className="w-4 h-4" /> حفظ</button>
        </div>
      </div>
    </div>
  );
}

function NewPlanModal({ onCancel, onCreate }) {
  const [name, setName] = useState("");
  const [levelId, setLevelId] = useState("established");
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-xl font-black text-ink font-display">خطة جديدة</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="اسم الخطة"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: خطة الشتاء" className={inputClass} /></Field>
          <Field label="نقطة البداية">
            <div className="space-y-2">
              {LEVELS.map((l) => (
                <button key={l.id} type="button" onClick={() => setLevelId(l.id)} className={`w-full text-left rounded-2xl border p-4 transition ${levelId === l.id ? "border-charge bg-charge-soft" : "border-line bg-mist"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${levelId === l.id ? "border-charge" : "border-line"}`}>{levelId === l.id && <span className="w-2 h-2 rounded-full bg-charge" />}</span>
                    <span className="font-bold text-ink text-base">{l.name}</span>
                    <span className="text-xs text-ink-faint ml-auto font-mono">{l.days.length} أيام/أسبوع</span>
                  </div>
                  <p className="text-sm text-ink-faint mt-1 pl-6">{l.blurb}</p>
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="sticky bottom-0 bg-card flex items-center gap-2 px-5 py-4 border-t border-line">
          <button onClick={onCancel} className="flex-1 py-3.5 rounded-xl text-base font-bold text-ink-soft hover:bg-mist">إلغاء</button>
          <button disabled={!name.trim()} onClick={() => onCreate(name.trim(), levelId)} className="flex-1 py-3.5 rounded-xl text-base font-bold bg-charge text-paper disabled:opacity-30 hover:bg-charge-strong transition-colors flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> إنشاء</button>
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px]">
      <div className={sheetClass}>
        <div className="px-5 py-4 border-b border-line">
          <h2 className="text-xl font-black text-ink font-display">أكمل ملفك الشخصي</h2>
          <p className="text-sm text-ink-faint mt-1">مرة واحدة فقط — يساعد في معرفة من يستخدم التطبيق وطلبات التثبيت.</p>
        </div>
        <div className="p-5 space-y-4">
          <Field label="الاسم الأول"><input value={first} onChange={(e) => setFirst(e.target.value)} className={inputClass} /></Field>
          <Field label="اللقب"><input value={family} onChange={(e) => setFamily(e.target.value)} className={inputClass} /></Field>
        </div>
        <div className="px-5 pb-5">
          <button disabled={!canSave} onClick={() => onSave(first.trim(), family.trim())} className="w-full py-3.5 rounded-xl text-base font-bold bg-charge text-paper disabled:opacity-30 hover:bg-charge-strong transition-colors">متابعة</button>
        </div>
      </div>
    </div>
  );
}

// Generic full-screen sheet — used for admin tools and the admin inbox,
// so both stay out of the main "You" page and it doesn't turn into an
// endless scroll of unrelated sections.
function FullScreenSheet({ title, onBack, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-paper flex flex-col">
      <div className="shrink-0 sticky top-0 bg-paper/95 backdrop-blur border-b border-line flex items-center gap-2 px-4" style={{ height: "3.5rem", paddingTop: "env(safe-area-inset-top)" }}>
        <button onClick={onBack} className="p-2 -mr-1 rounded-full text-ink-faint hover:bg-mist shrink-0" aria-label="رجوع"><ChevronRight className="w-5 h-5" /></button>
        <h1 className="font-black text-ink font-display truncate">{title}</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-2xl w-full mx-auto" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {children}
      </div>
    </div>
  );
}

function ProfileModal({ user, authorName, onCancel, onSignIn, onUpgrade, onSignOut, status, error }) {
  const anon = user && user.isAnonymous;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-xl font-black text-ink font-display flex items-center gap-2"><Cloud className="w-5 h-5" /> الملف الشخصي</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {user && !anon ? (
            <div className="space-y-3">
              <div className="rounded-2xl bg-charge-soft border border-charge/20 p-4 text-sm text-charge flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" /> تم تسجيل الدخول باسم <span className="font-bold">{authorName}</span>. تتم مزامنة الخطط تلقائياً.
              </div>
              <button onClick={onSignOut} className="w-full py-3.5 rounded-xl text-base font-bold text-danger border border-danger/30 hover:bg-danger-soft">تسجيل الخروج</button>
            </div>
          ) : (
            <>
              <p className="text-base text-ink-soft">{anon ? "أنت تجرّب التطبيق — لا شيء يُحفظ بشكل دائم بعد. سجّل الدخول للاحتفاظ بكل ما أنشأته وفتح التعديل والخطط الجديدة والإرسال." : "نقرة واحدة، بدون كلمة مرور. هذه هويتك للخطط والمزامنة والإرسال."}</p>
              {error && <div className="rounded-2xl bg-danger-soft border border-danger/20 p-3.5 text-sm text-danger flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {typeof error === "string" ? error : "تعذّر تسجيل الدخول — حاول مرة أخرى."}</div>}
              <button disabled={status === "syncing"} onClick={anon ? onUpgrade : onSignIn} className="w-full py-3.5 rounded-xl text-base font-bold bg-charge text-paper disabled:opacity-30 hover:bg-charge-strong transition-colors flex items-center justify-center gap-1.5">
                {status === "syncing" ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ تسجيل الدخول…</> : "المتابعة عبر جوجل"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ShareModal({ plan, user, authorName, onCancel, onPatchPlan }) {
  const [description, setDescription] = useState(plan.description || "");
  const [pubState, setPubState] = useState("idle");
  const [codeState, setCodeState] = useState("idle");
  const [copied, setCopied] = useState(false);
  const [announce, setAnnounce] = useState(false);

  const isLive = !!plan.publicShareId;

  const submitPublic = async () => {
    setPubState("sending");
    try {
      const ok = await checkAndBumpRateLimit(user.uid, "submissions", 3, 60 * 60 * 1000);
      if (!ok) { setPubState("limited"); return; }
      const id = await submitPlanForReview(plan, user.uid, authorName, description); onPatchPlan({ publicShareId: id, publicApproved: false }); setPubState("sent");
    }
    catch (err) { setPubState("error"); }
  };
  const pushUpdate = async () => {
    setPubState("sending");
    try { await updateSharedPlanContent(plan.publicShareId, plan, description, announce); setPubState("sent"); }
    catch (err) { setPubState("error"); }
  };

  const generateCode = async () => {
    setCodeState("sending");
    try { const code = await shareplanByCode(plan, user.uid, authorName, description); onPatchPlan({ shareCode: code }); setCodeState("idle"); }
    catch (err) { setCodeState("error"); }
  };
  const revokeCode = async () => {
    if (!plan.shareCode) return;
    setCodeState("sending");
    try { await stopSharingPlan(plan.shareCode); onPatchPlan({ shareCode: null }); setCodeState("idle"); }
    catch (err) { setCodeState("error"); }
  };
  const copyCode = () => { navigator.clipboard?.writeText(plan.shareCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  const saveDescription = () => onPatchPlan({ description });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-xl font-black text-ink font-display flex items-center gap-2"><Send className="w-5 h-5" /> مشاركة "{plan.name}"</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">

          <div>
            <p className="font-bold text-ink text-sm mb-1">وصف الخطة (اختياري)</p>
            <p className="text-xs text-ink-faint mb-2">هدف الخطة، لمن تناسب، أي شيء يساعد الناس على الفهم دون تصفح كل تمرين.</p>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} onBlur={saveDescription} rows={3} placeholder="مثال: تركيز على المؤخرة والهامسترينغ، 4 أيام أسبوعياً، مناسبة لمن لديه خبرة سابقة." className={inputClass + " resize-none"} />
          </div>

          <div className="rounded-2xl border border-line p-4">
            <p className="font-bold text-ink text-sm mb-1">المشاركة مع أشخاص محددين</p>
            <p className="text-xs text-ink-faint mb-3">يولّد رمزاً. فقط من تعطيه الرمز يمكنه إضافة هذه الخطة — غير مُدرجة في أي مكان.</p>
            {plan.shareCode ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span dir="ltr" className="flex-1 font-mono font-black text-2xl tracking-[0.2em] text-charge bg-charge-soft rounded-xl px-4 py-2.5 text-center">{plan.shareCode}</span>
                  <button onClick={copyCode} className="p-3 rounded-xl bg-mist text-ink-soft hover:text-ink shrink-0"><Copy className="w-4 h-4" /></button>
                </div>
                {copied && <p className="text-xs text-charge mb-2">تم النسخ.</p>}
                <button disabled={codeState === "sending"} onClick={revokeCode} className="text-sm font-bold text-danger disabled:opacity-40">إيقاف المشاركة</button>
              </>
            ) : (
              <button disabled={codeState === "sending"} onClick={generateCode} className="w-full py-3 rounded-xl text-sm font-bold bg-mist text-ink hover:bg-line/60 disabled:opacity-40 transition-colors">
                {codeState === "sending" ? "جارٍ التوليد…" : "توليد رمز"}
              </button>
            )}
            {codeState === "error" && <p className="text-xs text-danger mt-2">حدث خطأ ما — حاول مرة أخرى.</p>}
          </div>

          <div className="rounded-2xl border border-line p-4">
            <p className="font-bold text-ink text-sm mb-1">الإرسال إلى المجتمع</p>
            {!isLive && <p className="text-xs text-ink-faint mb-3">يرسل "{plan.name}" للمراجعة. تظهر للجميع بعد الموافقة. الصور غير مضمّنة، فقط قائمة التمارين.</p>}
            {isLive ? (
              <>
                <div className="rounded-xl bg-charge-soft border border-charge/20 p-3 text-sm text-charge flex items-center gap-2 mb-3"><Check className="w-4 h-4 shrink-0" /> منشورة بالفعل — أي تعديل الآن يُحدّث نفس النسخة.</div>
                <label className="flex items-center gap-2.5 text-sm text-ink-soft cursor-pointer w-fit py-1 mb-2">
                  <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} className="w-4 h-4 rounded border-line accent-charge" />
                  إظهار شارة "تم التحديث" للمستخدمين
                </label>
                {pubState === "error" && <p className="text-xs text-danger mb-2">حدث خطأ ما — حاول مرة أخرى.</p>}
                {pubState === "sent" && <p className="text-xs text-charge mb-2">تم التحديث.</p>}
                <button disabled={pubState === "sending"} onClick={pushUpdate} className="w-full py-3 rounded-xl text-sm font-bold bg-mist text-ink hover:bg-line/60 disabled:opacity-40 transition-colors">
                  {pubState === "sending" ? "جارٍ التحديث…" : "دفع التعديلات"}
                </button>
              </>
            ) : (
              <>
                {pubState === "sent" ? (
                  <div className="rounded-xl bg-charge-soft border border-charge/20 p-3 text-sm text-charge flex items-center gap-2"><Check className="w-4 h-4 shrink-0" /> تم الإرسال — ستظهر في المجتمع بعد الموافقة.</div>
                ) : (
                  <>
                    {pubState === "error" && <p className="text-xs text-danger mb-2">حدث خطأ ما — حاول مرة أخرى.</p>}
                    {pubState === "limited" && <p className="text-xs text-danger mb-2">عدد كبير من الإرسالات خلال ساعة — حاول لاحقًا.</p>}
                    <button disabled={pubState === "sending"} onClick={submitPublic} className="w-full py-3 rounded-xl text-sm font-bold bg-mist text-ink hover:bg-line/60 disabled:opacity-40 transition-colors">
                      {pubState === "sending" ? "جارٍ الإرسال…" : "إرسال للمراجعة"}
                    </button>
                  </>
                )}
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// A lightweight, always-one-tap-away plan switcher — reachable straight
// from the Train page instead of needing a trip to the You tab.
function PlanSwitcherSheet({ plans, activePlanId, levels, onSwitch, onManage, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-xl font-black text-ink font-display">تبديل الخطة</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-2">
          {plans.map((p) => (
            <button key={p.id} onClick={() => onSwitch(p.id)} className={`w-full text-left rounded-2xl p-4 flex items-center gap-3 transition ${p.id === activePlanId ? "bg-charge" : "bg-mist hover:bg-line/40"}`}>
              <div className="flex-1 min-w-0">
                <p className={`font-black truncate ${p.id === activePlanId ? "text-paper" : "text-ink"}`}>{p.name}</p>
                <p className={`text-xs ${p.id === activePlanId ? "text-paper/65" : "text-ink-faint"}`}>{levels.find((l) => l.id === p.level)?.name || "مخصصة"} · {p.days.length} أيام/أسبوع</p>
              </div>
              {p.id === activePlanId && <span className="shrink-0 w-6 h-6 rounded-full bg-paper flex items-center justify-center"><Check className="w-3.5 h-3.5 text-charge" /></span>}
            </button>
          ))}
        </div>
        <div className="px-5 pb-5">
          <button onClick={onManage} className="w-full py-3 rounded-xl text-sm font-bold text-ink-faint hover:text-ink hover:bg-mist transition-colors">إدارة كل الخطط ←</button>
        </div>
      </div>
    </div>
  );
}

function JoinSharedPlanCard({ onJoin }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState("idle");
  const submit = async () => {
    if (!code.trim()) return;
    setState("loading");
    try {
      const found = await fetchPlanByCode(code);
      if (!found) { setState("notfound"); return; }
      onJoin(found);
      setCode(""); setState("idle");
    } catch (err) { setState("error"); }
  };
  return (
    <div className="rounded-2xl border border-dashed border-line p-4">
      <p className="font-bold text-ink text-sm mb-1">إضافة خطة شاركها معك أحد</p>
      <p className="text-xs text-ink-faint mb-2">إن شارك معك صديق إحدى خططه، سيكون قد أرسل لك رمزاً من 6 خانات (من شاشة المشاركة عنده). ألصقه هنا للحصول على نسختك الخاصة — لن تتزامن مع خطته، إنها فقط نقطة بداية.</p>
      <div className="flex gap-2 mt-2">
        <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setState("idle"); }} placeholder="مثال: 7QK4RM" maxLength={6} className="flex-1 rounded-xl border border-line px-3 py-2.5 text-sm font-mono font-bold tracking-widest bg-mist text-ink placeholder:text-ink-faint placeholder:tracking-normal placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-charge" />
        <button disabled={state === "loading" || !code.trim()} onClick={submit} className="px-4 py-2.5 rounded-xl text-sm font-bold bg-charge text-paper disabled:opacity-30 hover:bg-charge-strong transition-colors">إضافة</button>
      </div>
      {state === "notfound" && <p className="text-xs text-danger mt-2">لم يتم العثور على خطة بهذا الرمز.</p>}
      {state === "error" && <p className="text-xs text-danger mt-2">حدث خطأ ما — حاول مرة أخرى.</p>}
    </div>
  );
}

// Admin-only moderation queue for plans submitted to Community. The real
// gate is Firestore Security Rules (see firestore.rules) — this UI simply
// doesn't render for anyone not in ADMIN_UIDS, and every action it takes
// still goes through rules on the way to the server.
// Admin-only content management for the exercise library — an image and
// video attached here applies automatically the moment anyone (admin or
// not) picks that exercise name, so most users never need to search for
// or upload their own photo unless it's a genuinely new exercise.
function LibraryEntryModal({ entry, onCancel, onSaved }) {
  const isNew = !entry.id;
  const [form, setForm] = useState({
    name: entry.name || "", nameAr: entry.nameAr || "", muscle: entry.muscle || "", muscleAr: entry.muscleAr || "",
    sets: entry.sets || 3, reps: entry.reps || "", weight: entry.weight || "Medium", rest: entry.rest || "60 sec",
    image: entry.image || null, youtubeId: entry.youtubeId || "",
  });
  const [videoUrl, setVideoUrl] = useState(entry.youtubeId ? `https://youtu.be/${entry.youtubeId}` : "");
  const [saving, setSaving] = useState(false);
  const canSave = form.name.trim() && form.muscle.trim();
  const save = async () => {
    setSaving(true);
    const slug = entry.id || slugify(form.name);
    try { await adminSaveLibraryEntry(slug, { ...form, sets: Number(form.sets) || 1 }); onSaved(); }
    catch (err) { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={onCancel}>
      <div className={sheetClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-xl font-black text-ink font-display">{isNew ? "إضافة تمرين للمكتبة" : "تعديل التمرين"}</h2>
          <button onClick={onCancel} className="p-2 -mr-2 rounded-full text-ink-faint hover:bg-mist"><X className="w-5 h-5" /></button>
        </div>
        <BigPhoto image={form.image} onPick={(img) => setForm((f) => ({ ...f, image: img }))} />
        <div className="p-5 space-y-4">
          <Field label="الاسم بالإنجليزية">
            <input value={form.name} disabled={!isNew} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass + (isNew ? "" : " opacity-60")} />
            {!isNew && <p className="text-xs text-ink-faint mt-1">لا يمكن تغييره — يُستخدم للمطابقة مع خطط موجودة.</p>}
          </Field>
          <Field label="الاسم بالعربية"><input value={form.nameAr} onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} className={inputClass} /></Field>
          <Field label="العضلة بالإنجليزية"><input value={form.muscle} onChange={(e) => setForm((f) => ({ ...f, muscle: e.target.value }))} className={inputClass} /></Field>
          <Field label="العضلة بالعربية"><input value={form.muscleAr} onChange={(e) => setForm((f) => ({ ...f, muscleAr: e.target.value }))} className={inputClass} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="مجموعات"><input type="number" min="1" value={form.sets} onChange={(e) => setForm((f) => ({ ...f, sets: e.target.value }))} className={inputClass} /></Field>
            <Field label="تكرارات"><input value={form.reps} onChange={(e) => setForm((f) => ({ ...f, reps: e.target.value }))} className={inputClass} /></Field>
            <Field label="راحة"><input value={form.rest} onChange={(e) => setForm((f) => ({ ...f, rest: e.target.value }))} className={inputClass} /></Field>
          </div>
          <Field label="الوزن الافتراضي">
            <div className="flex flex-wrap gap-2">
              {WEIGHT_OPTIONS.map((w) => (
                <button key={w} type="button" onClick={() => setForm((f) => ({ ...f, weight: w }))} className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-full text-sm font-bold ring-1 transition ${form.weight === w ? `${WEIGHT_INFO[w].bg} ${WEIGHT_INFO[w].text} ${WEIGHT_INFO[w].ring}` : "bg-mist text-ink-faint ring-line"}`}>
                  <PlateIcon weight={w} size={12} />{wLabel(w)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="رابط فيديو (اختياري)">
            <input value={videoUrl} onChange={(e) => { setVideoUrl(e.target.value); setForm((f) => ({ ...f, youtubeId: parseYoutubeId(e.target.value) || "" })); }} placeholder="رابط يوتيوب" className={inputClass} />
          </Field>
        </div>
        <div className="sticky bottom-0 bg-card flex items-center gap-2 px-5 py-4 border-t border-line">
          <button onClick={onCancel} className="flex-1 py-3.5 rounded-xl text-base font-bold text-ink-soft hover:bg-mist">إلغاء</button>
          <button disabled={!canSave || saving} onClick={save} className="flex-1 py-3.5 rounded-xl text-base font-bold bg-charge text-paper disabled:opacity-30 hover:bg-charge-strong transition-colors flex items-center justify-center gap-1.5"><Check className="w-4 h-4" /> حفظ</button>
        </div>
      </div>
    </div>
  );
}

function ExerciseLibraryAdmin() {
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null); // null | {} (new) | entry (edit)
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState(null);
  const load = async () => { setItems(null); try { setItems(await fetchExerciseLibrary()); } catch (err) { setItems([]); } };
  useEffect(() => { load(); }, []);
  const remove = async (id) => { setBusyId(id); try { await adminDeleteLibraryEntry(id); } catch (err) { /* ignore */ } await load(); setBusyId(null); };
  const filtered = (items || []).filter((e) => !q.trim() || e.name.toLowerCase().includes(q.toLowerCase()) || (e.nameAr || "").includes(q));

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-ink-faint uppercase tracking-wide">مكتبة التمارين (صور وفيديوهات)</p>
        <button onClick={() => setEditing({})} className="text-sm font-bold text-charge flex items-center gap-1 hover:text-charge-strong"><Plus className="w-4 h-4" /> إضافة</button>
      </div>
      {items && items.length > 0 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث…" className={inputClass + " mb-3 text-sm py-2"} />}
      {items === null && <p className="text-sm text-ink-faint flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل…</p>}
      {items?.length === 0 && <p className="text-sm text-ink-faint">لا توجد عناصر بعد — أضف أول تمرين.</p>}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filtered.map((e) => (
          <div key={e.id} className="rounded-xl bg-mist p-2.5 flex items-center gap-2.5">
            {e.image ? <img src={e.image} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" /> : <div className="w-11 h-11 rounded-lg bg-card flex items-center justify-center shrink-0"><Dumbbell className="w-4 h-4 text-ink-faint" /></div>}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-ink truncate">{e.nameAr ? `${e.nameAr} (${e.name})` : e.name}</p>
              <p className="text-xs text-ink-faint truncate">{e.muscleAr || e.muscle}</p>
            </div>
            <button onClick={() => setEditing(e)} className="p-2 rounded-lg text-ink-faint hover:text-ink hover:bg-card shrink-0" aria-label="تعديل"><Pencil className="w-3.5 h-3.5" /></button>
            <button disabled={busyId === e.id} onClick={() => remove(e.id)} className="p-2 rounded-lg text-ink-faint hover:text-danger hover:bg-card shrink-0 disabled:opacity-40" aria-label="حذف"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      {editing && <LibraryEntryModal entry={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function AdminPanel({ user, onOpenInbox }) {
  const [pending, setPending] = useState(null);
  const [live, setLive] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadPending = async () => { setPending(null); try { setPending(await fetchPendingSubmissions()); } catch (err) { setPending([]); } };
  const loadLive = async () => { setLive(null); try { setLive(await fetchLiveCommunityPlansForAdmin()); } catch (err) { setLive([]); } };
  useEffect(() => { loadPending(); loadLive(); }, []);

  const approve = async (id) => { setBusyId(id); try { await adminSetApproved(id, true); } catch (err) { /* ignore */ } await Promise.all([loadPending(), loadLive()]); setBusyId(null); };
  const reject = async (id) => { setBusyId(id); try { await adminDeleteSharedPlan(id); } catch (err) { /* ignore */ } await loadPending(); setBusyId(null); };
  const unpin = async (id) => { setBusyId(id); try { await adminSetApproved(id, false); } catch (err) { /* ignore */ } await Promise.all([loadPending(), loadLive()]); setBusyId(null); };
  const remove = async (id) => { setBusyId(id); try { await adminDeleteSharedPlan(id); } catch (err) { /* ignore */ } await loadLive(); setBusyId(null); };
  const toggleRecommend = async (p) => { setBusyId(p.id); try { await adminSetRecommended(p.id, !p.recommended); } catch (err) { /* ignore */ } await loadLive(); setBusyId(null); };
  const clearAnnounced = async (id) => { setBusyId(id); try { await adminClearAnnounced(id); } catch (err) { /* ignore */ } await loadLive(); setBusyId(null); };
  const copyUid = () => { navigator.clipboard?.writeText(user.uid).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">أدوات المسؤول</h2>
      <button onClick={copyUid} className="w-full flex items-center justify-between gap-2 bg-card border border-line rounded-2xl px-4 py-3.5 hover:border-ink-faint transition-colors">
        <span className="text-left"><span className="font-bold text-ink text-sm block">معرّف المستخدم الخاص بك</span><span className="text-xs text-ink-faint font-mono" dir="ltr">{user.uid}</span></span>
        <span className="shrink-0 text-xs font-bold text-charge">{copied ? "تم النسخ" : "نسخ"}</span>
      </button>

      <ExerciseLibraryAdmin />

      <div className="rounded-2xl border border-line bg-card p-4">
        <p className="text-xs font-bold text-ink-faint uppercase tracking-wide mb-3">إرسالات قيد المراجعة</p>
        {pending === null && <p className="text-sm text-ink-faint flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل…</p>}
        {pending?.length === 0 && <p className="text-sm text-ink-faint">لا شيء بانتظار المراجعة.</p>}
        <div className="space-y-2">
          {pending?.map((p) => (
            <div key={p.id} className="rounded-xl bg-mist p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0"><p className="font-bold text-sm text-ink truncate">{p.name}</p><p className="text-xs text-ink-faint">بواسطة {p.author || "مجهول"} · {p.days?.length || 0} أيام/أسبوع</p></div>
                <div className="flex gap-1.5 shrink-0">
                  <button disabled={busyId === p.id} onClick={() => approve(p.id)} className="p-2 rounded-lg bg-charge-soft text-charge disabled:opacity-40" aria-label="موافقة"><Check className="w-4 h-4" /></button>
                  <button disabled={busyId === p.id} onClick={() => reject(p.id)} className="p-2 rounded-lg bg-danger-soft text-danger disabled:opacity-40" aria-label="رفض"><X className="w-4 h-4" /></button>
                </div>
              </div>
              {p.description && <p className="text-xs text-ink-faint mt-2 pt-2 border-t border-line">{p.description}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-card p-4">
        <p className="text-xs font-bold text-ink-faint uppercase tracking-wide mb-3">منشورة في المجتمع الآن</p>
        {live === null && <p className="text-sm text-ink-faint flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل…</p>}
        {live?.length === 0 && <p className="text-sm text-ink-faint">لا توجد خطط منشورة حالياً.</p>}
        <div className="space-y-2">
          {live?.map((p) => (
            <div key={p.id} className="rounded-xl bg-mist p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-center gap-1.5">
                  {p.recommended && <Star className="w-3.5 h-3.5 text-charge fill-charge shrink-0" />}
                  <div className="min-w-0"><p className="font-bold text-sm text-ink truncate">{p.name}</p><p className="text-xs text-ink-faint">بواسطة {p.author || "مجهول"}{p.announced ? " · مُحدّثة" : ""}</p></div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button disabled={busyId === p.id} onClick={() => toggleRecommend(p)} className={`p-2 rounded-lg disabled:opacity-40 ${p.recommended ? "bg-charge text-paper" : "bg-mist text-ink-faint border border-line"}`} aria-label="التوصية"><Star className="w-4 h-4" /></button>
                  <button disabled={busyId === p.id} onClick={() => unpin(p.id)} className="p-2 rounded-lg bg-danger-soft text-danger disabled:opacity-40" aria-label="إلغاء التثبيت">إلغاء</button>
                  <button disabled={busyId === p.id} onClick={() => remove(p.id)} className="p-2 rounded-lg bg-danger-soft text-danger disabled:opacity-40" aria-label="حذف"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              {p.announced && <button disabled={busyId === p.id} onClick={() => clearAnnounced(p.id)} className="text-xs font-bold text-ink-faint mt-2">إخفاء شارة "مُحدّثة"</button>}
            </div>
          ))}
        </div>
      </div>

      <button onClick={onOpenInbox} className="w-full flex items-center justify-between gap-2 bg-card border border-line rounded-2xl px-4 py-3.5 hover:border-ink-faint transition-colors">
        <span className="font-bold text-ink text-sm">صندوق الرسائل</span>
        <ChevronRight className="w-4 h-4 text-ink-faint rotate-180" />
      </button>
    </section>
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
        data.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
        if (data.length) { setItems(data); setState("ok"); } else setState("empty");
      } catch (err) { setState("empty"); }
    })();
  }, [isOnline]);
  return (
    <div className="space-y-3">
      <h1 className="text-3xl font-black tracking-tight text-ink font-display">المجتمع</h1>
      <p className="text-base text-ink-faint mb-4">خطط أرسلها آخرون وتمت الموافقة عليها.</p>
      {state === "offline" && <p className="text-sm text-ink-faint text-center py-10">أنت غير متصل — خطط المجتمع تحتاج اتصالاً بالإنترنت.</p>}
      {state === "loading" && <div className="flex items-center gap-2 text-ink-faint text-sm py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل…</div>}
      {state === "empty" && <p className="text-sm text-ink-faint text-center py-10">لا توجد خطط موافق عليها بعد — تحقق لاحقاً.</p>}
      {items.map((p) => (
        <div key={p.id} className={`rounded-2xl border bg-card p-4 ${p.recommended ? "border-charge/50" : "border-line"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {p.recommended && <Star className="w-3.5 h-3.5 text-charge fill-charge shrink-0" />}
                <p className="font-black text-ink truncate">{p.name}</p>
                {p.announced && <span className="shrink-0 text-[10px] font-bold text-w4-strong bg-w4-soft rounded-full px-2 py-0.5">مُحدّثة</span>}
              </div>
              <p className="text-sm text-ink-faint">بواسطة {p.author || "مجهول"} · {p.days?.length || 0} أيام/أسبوع</p>
            </div>
            <button onClick={() => onFork(p)} className="shrink-0 px-3.5 py-2.5 rounded-xl text-sm font-bold bg-charge text-paper hover:bg-charge-strong transition-colors flex items-center gap-1.5"><Copy className="w-4 h-4" /> نسخ</button>
          </div>
          {p.description && <p className="text-sm text-ink-soft mt-2.5 pt-2.5 border-t border-line">{p.description}</p>}
        </div>
      ))}
    </div>
  );
}

// ---- Chat — a real WhatsApp/Telegram-style thread, shared between
// the user-facing "Chat" tab and the admin inbox. `viewerRole` is
// "user" or "admin"; `threadUid` is whose thread this is (always the
// user's uid, even when the admin is the one viewing it). ----
function ChatBubble({ msg, mine }) {
  return (
    <div dir="ltr" className="flex" style={{ justifyContent: mine ? "flex-end" : "flex-start" }}>
      <div
        dir="rtl"
        className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          mine ? "bg-charge text-paper rounded-br-md" : "bg-card border border-line text-ink rounded-bl-md"
        }`}
      >
        {msg.image && <img src={msg.image} alt="" className="w-40 h-40 rounded-xl object-cover mb-1.5" />}
        {msg.body && <p className="whitespace-pre-wrap break-words">{msg.body}</p>}
        {msg.link && (
          <a href={msg.link} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 text-xs font-bold mt-1 ${mine ? "text-paper/90 underline" : "text-charge"}`}>
            <Send className="w-3 h-3" /> رابط مرفق
          </a>
        )}
      </div>
    </div>
  );
}

function ChatThread({ threadUid, viewerRole, peerName, rateLimitUid }) {
  const [messages, setMessages] = useState(null);
  const [body, setBody] = useState("");
  const [image, setImage] = useState(null);
  const [link, setLink] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [state, setState] = useState("idle");
  const fileRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    setMessages(null);
    const unsub = subscribeThreadMessages(threadUid, setMessages);
    markThreadSeen(threadUid, viewerRole);
    return () => unsub();
  }, [threadUid, viewerRole]);

  useEffect(() => {
    if (messages?.length) markThreadSeen(threadUid, viewerRole);
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, threadUid, viewerRole]);

  const send = async () => {
    if (!body.trim() && !image) return;
    setState("sending");
    try {
      if (viewerRole === "user") {
        const ok = await checkAndBumpRateLimit(rateLimitUid, "messages", 20, 15 * 60 * 1000);
        if (!ok) { setState("limited"); return; }
      }
      await sendThreadMessage(threadUid, viewerRole, peerName, body.trim(), image, link.trim() || null);
      setBody(""); setImage(null); setLink(""); setLinkOpen(false); setState("idle");
    } catch (err) { setState("error"); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-1 py-3 space-y-2.5">
        {messages === null && <p className="text-sm text-ink-faint flex items-center gap-2 justify-center py-10"><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل…</p>}
        {messages?.length === 0 && (
          <p className="text-sm text-ink-faint text-center py-10 px-6">
            {viewerRole === "user" ? "مشكلة في خطة، اقتراح، أي شيء — ابدأ المحادثة." : "لا رسائل بعد في هذه المحادثة."}
          </p>
        )}
        {messages?.map((m) => <ChatBubble key={m.id} msg={m} mine={m.from === viewerRole} />)}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-line pt-2.5">
        {image && (
          <div className="relative w-16 h-16 mb-2">
            <img src={image} alt="" className="w-16 h-16 rounded-xl object-cover" />
            <button onClick={() => setImage(null)} className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center"><X className="w-3 h-3" /></button>
          </div>
        )}
        {linkOpen && (
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="رابط فيديو أو ملف" className={inputClass + " mb-2 text-sm py-2"} autoFocus />
        )}
        <div className="flex items-end gap-2">
          <button onClick={() => fileRef.current?.click()} className="p-2.5 rounded-full bg-mist text-ink-soft hover:text-ink shrink-0" aria-label="إرفاق صورة"><Camera className="w-4 h-4" /></button>
          <button onClick={() => setLinkOpen((v) => !v)} className={`p-2.5 rounded-full shrink-0 ${linkOpen ? "bg-charge-soft text-charge" : "bg-mist text-ink-soft hover:text-ink"}`} aria-label="إرفاق رابط"><Share className="w-4 h-4" /></button>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={1}
            placeholder="اكتب رسالة…"
            className={inputClass + " resize-none py-2.5 flex-1"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button disabled={state === "sending" || (!body.trim() && !image)} onClick={send} className="p-3 rounded-full bg-charge text-paper disabled:opacity-30 hover:bg-charge-strong transition-colors shrink-0" aria-label="إرسال">
            {state === "sending" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setImage(await resizeImage(f, 600)); } catch (err) { /* ignore */ } e.target.value = ""; }} />
        {state === "error" && <p className="text-xs text-danger mt-1.5">حدث خطأ ما — حاول مرة أخرى.</p>}
        {state === "limited" && <p className="text-xs text-danger mt-1.5">رسائل كثيرة خلال وقت قصير — حاول مرة أخرى بعد قليل.</p>}
      </div>
    </div>
  );
}

// The user-facing "Chat" tab — just their own thread with the admin.
function ChatPage({ user, authorName }) {
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 3.5rem - 4.75rem - env(safe-area-inset-bottom))" }}>
      <div className="shrink-0 flex items-center gap-2.5 pb-3 border-b border-line">
        <div className="w-9 h-9 rounded-full bg-charge-soft text-charge flex items-center justify-center font-black shrink-0">؟</div>
        <div className="min-w-0">
          <p className="font-black text-ink text-sm">الدعم</p>
          <p className="text-xs text-ink-faint">عادة ما يرد خلال يوم</p>
        </div>
      </div>
      <ChatThread threadUid={user.uid} viewerRole="user" peerName={authorName} rateLimitUid={user.uid} />
    </div>
  );
}

// Admin inbox — list of every thread, tap in to reply. Rendered inside
// a full-screen sheet from the profile page's admin tools.
function AdminInbox() {
  const [threads, setThreads] = useState(null);
  const [openUid, setOpenUid] = useState(null);
  useEffect(() => { const unsub = subscribeAllThreads(setThreads); return () => unsub(); }, []);

  if (openUid) {
    const t = threads?.find((x) => x.id === openUid);
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-2 pb-3 border-b border-line">
          <button onClick={() => setOpenUid(null)} className="p-2 -mr-1 rounded-full text-ink-faint hover:bg-mist shrink-0" aria-label="رجوع"><ChevronRight className="w-4 h-4" /></button>
          <p className="font-black text-ink text-sm truncate">{t?.name || "مستخدم"}</p>
        </div>
        <ChatThread threadUid={openUid} viewerRole="admin" peerName={null} />
      </div>
    );
  }

  return (
    <div className="space-y-1.5 overflow-y-auto h-full">
      {threads === null && <p className="text-sm text-ink-faint flex items-center gap-2 justify-center py-10"><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل…</p>}
      {threads?.length === 0 && <p className="text-sm text-ink-faint text-center py-10">لا توجد محادثات بعد.</p>}
      {threads?.map((t) => (
        <button key={t.id} onClick={() => setOpenUid(t.id)} className="w-full flex items-center gap-3 rounded-2xl bg-card border border-line p-3.5 text-right hover:border-ink-faint transition-colors">
          <div className="w-9 h-9 rounded-full bg-mist text-ink-faint flex items-center justify-center font-black shrink-0">{(t.name || "؟")[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm text-ink truncate">{t.name || "مستخدم"}</p>
            <p className={`text-xs truncate ${t.unreadForAdmin ? "text-ink font-bold" : "text-ink-faint"}`}>{t.lastFrom === "admin" ? "أنت: " : ""}{t.lastMessage || ""}</p>
          </div>
          {t.unreadForAdmin && <span className="shrink-0 w-2.5 h-2.5 rounded-full bg-charge" />}
        </button>
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
        <h1 className="text-3xl font-black text-ink font-display mb-1">{isSignUp ? "إنشاء حساب" : "تسجيل الدخول"}</h1>
        <p className="text-ink-faint mb-6">{isSignUp ? "بريد إلكتروني وكلمة مرور، بدون حاجة لجوجل." : "أهلاً بعودتك."}</p>
        <div className="space-y-3 mb-4">
          <input type="email" placeholder="البريد الإلكتروني" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          <input type="password" placeholder="كلمة المرور" value={pw} onChange={(e) => setPw(e.target.value)} className={inputClass} />
        </div>
        {error && <p className="text-danger text-sm mb-3">{error}</p>}
        <button disabled={status === "syncing" || !email || !pw} onClick={() => onEmailAuth(email, pw, isSignUp)} className="w-full py-3.5 rounded-xl text-base font-bold bg-charge text-paper disabled:opacity-30 mb-3 hover:bg-charge-strong transition-colors">
          {status === "syncing" ? "…" : isSignUp ? "إنشاء حساب" : "تسجيل الدخول"}
        </button>
        <button onClick={() => setIsSignUp((v) => !v)} className="text-sm font-bold text-ink-faint mb-2">{isSignUp ? "لديك حساب؟ سجّل الدخول" : "جديد هنا؟ أنشئ حساباً"}</button>
        <button onClick={() => setMode("choice")} className="text-sm font-bold text-ink-faint">→ رجوع</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-center px-8 max-w-sm mx-auto w-full text-center">
      <BrandMark className="mx-auto mb-5" />
      <h1 className="text-3xl font-black text-ink font-display mb-1">سجل التمرين</h1>
      <p className="text-ink-faint mb-8">أنشئ ملفاً شخصياً لحفظ خططك وتقدّمك.</p>
      {error && <p className="text-danger text-sm mb-3">{error}</p>}
      <button disabled={status === "syncing"} onClick={onGoogle} className="w-full py-3.5 rounded-xl text-base font-bold bg-charge text-paper mb-2.5 disabled:opacity-30 hover:bg-charge-strong transition-colors">المتابعة عبر جوجل</button>
      <button disabled={status === "syncing"} onClick={() => setMode("email")} className="w-full py-3.5 rounded-xl text-base font-bold bg-card border border-line text-ink mb-2.5 disabled:opacity-30 hover:bg-mist transition-colors">المتابعة بالبريد الإلكتروني</button>
      <button disabled={status === "syncing"} onClick={onGuest} className="w-full py-3 text-sm font-bold text-ink-faint disabled:opacity-30">جرّبه أولاً، بدون حساب</button>
    </div>
  );
}

function TutorialStep({ onDone }) {
  const slides = [
    { icon: Star, color: "text-charge fill-charge", bg: "bg-charge-soft", title: "عضلات التركيز", text: "النجمة تُشير إلى عضلة تركيز — هناك يذهب الحجم الإضافي عن قصد." },
    { icon: Dumbbell, color: "text-w4-strong", bg: "bg-w4-soft", title: "ألوان الأوزان، ببساطة", text: "الوزن يعني الحمل الذي يكون فيه تكرارك الأخير هو آخر تكرار تقدر تؤديه بأداء صحيح. ألوان الأوزان في الأعلى تذكّرك دائماً." },
    { icon: RefreshCw, color: "text-w5-strong", bg: "bg-w5-soft", title: "تقدّم مدمج", text: "حوالي الأسبوع 6-8 ستحصل على تذكير لتبديل 1-2 تمرين لكل عضلة — مبني على أبحاث، وليس تبديلاً عشوائياً." },
    { icon: Home, color: "text-w2-strong", bg: "bg-w2-soft", title: "جلسات موجّهة", text: "اضغط \"بدء التمرين\" لجلسة موجّهة كاملة — إحماء، تتبّع المجموعات، مؤقتات الراحة، كل شيء يُدار من أجلك." },
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
        {i > 0 && <button onClick={() => setI((v) => v - 1)} className="px-6 py-3.5 rounded-xl text-base font-bold text-ink-soft border border-line">رجوع</button>}
        <button onClick={() => (i < slides.length - 1 ? setI((v) => v + 1) : onDone())} className="flex-1 py-3.5 rounded-xl text-base font-bold bg-charge text-paper hover:bg-charge-strong transition-colors">{i < slides.length - 1 ? "التالي" : "ابدأ استخدام التطبيق"}</button>
      </div>
    </div>
  );
}

function ChoosePlanStep({ onChoose }) {
  const [levelId, setLevelId] = useState("established");
  return (
    <div className="flex-1 flex flex-col px-6 py-8 max-w-sm mx-auto w-full">
      <h1 className="text-2xl font-black text-ink font-display mb-1.5">اختر خطة بداية</h1>
      <p className="text-ink-faint text-sm mb-6">يمكنك التبديل لخطة أخرى، إضافة المزيد، أو تعديل أي شيء لاحقاً — هذا فقط للبدء.</p>
      <div className="space-y-2.5 flex-1 overflow-y-auto">
        {LEVELS.map((l) => (
          <button key={l.id} type="button" onClick={() => setLevelId(l.id)} className={`w-full text-left rounded-2xl border p-4 transition ${levelId === l.id ? "border-charge bg-charge-soft" : "border-line bg-card"}`}>
            <div className="flex items-center gap-2">
              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${levelId === l.id ? "border-charge" : "border-line"}`}>{levelId === l.id && <span className="w-2 h-2 rounded-full bg-charge" />}</span>
              <span className="font-bold text-ink text-base">{l.name}</span>
              <span className="text-xs text-ink-faint ml-auto font-mono">{l.days.length} أيام/أسبوع</span>
            </div>
            <p className="text-sm text-ink-faint mt-1 pl-6">{l.blurb}</p>
          </button>
        ))}
      </div>
      <button onClick={() => onChoose(levelId)} className="w-full py-3.5 rounded-xl text-base font-bold bg-charge text-paper hover:bg-charge-strong transition-colors mt-6">البدء بهذه الخطة</button>
    </div>
  );
}

function OnboardingFlow({ step, onGoogle, onGuest, onEmailAuth, onTutorialDone, onChoosePlan, status, error }) {
  return (
    <div className="fixed inset-0 z-50 bg-paper flex flex-col">
      {step === "auth"
        ? <AuthStep onGoogle={onGoogle} onGuest={onGuest} onEmailAuth={onEmailAuth} status={status} error={error} />
        : step === "choosePlan"
          ? <ChoosePlanStep onChoose={onChoosePlan} />
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
// The hardcoded list above is the offline-safe seed. Once the app loads,
// this gets merged with whatever the admin has added/fixed in Firestore
// (see AdminPanel's exercise-library section) — remote entries win on a
// name collision, so an admin edit always takes priority over the seed.
let RUNTIME_LIBRARY = [...EXERCISE_LIBRARY];
function mergeRemoteLibrary(remoteItems) {
  const byName = new Map(RUNTIME_LIBRARY.map((e) => [e.name.toLowerCase(), e]));
  remoteItems.forEach((r) => {
    byName.set(r.name.toLowerCase(), { name: r.name, muscle: r.muscle, sets: r.sets, reps: r.reps, weight: r.weight, rest: r.rest, image: r.image || null, youtubeId: r.youtubeId || null });
    // an admin-supplied Arabic name/muscle becomes the new translation —
    // this is the self-serve fix path for any awkward wording, no code
    // change needed
    if (r.nameAr) EXNAME_AR[r.name] = r.nameAr;
    if (r.muscleAr) MUSCLE_AR[r.muscle] = r.muscleAr;
  });
  RUNTIME_LIBRARY = Array.from(byName.values());
}
function slugify(name) { return (name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `x${Date.now()}`; }
async function fetchExerciseLibrary() {
  const snap = await getDocs(collection(dbase, "exerciseLibrary"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function adminSaveLibraryEntry(slug, data) {
  await setDoc(doc(dbase, "exerciseLibrary", slug), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}
async function adminDeleteLibraryEntry(slug) {
  await deleteDoc(doc(dbase, "exerciseLibrary", slug));
}
function findLibraryMatch(name) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  return RUNTIME_LIBRARY.find((e) => e.name.toLowerCase() === n) || null;
}
function youtubeEmbedUrl(id) { return `https://www.youtube-nocookie.com/embed/${id}`; }

const STRETCHES = [
  { name: "تمديد الصدر عند الباب", freq: "بعد كل جلسة", why: "يرخي الصدر والكتف الأمامي المشدودين اللذين يسحبان الكتفين للأمام", hold: "30 ثانية/جانب" },
  { name: "تمديد اللاتس (فوق الرأس، ميل جانبي)", freq: "بعد كل جلسة", why: "اللاتس يسحب الكتفين للأسفل وللداخل — هذا يعاكس ذلك", hold: "30 ثانية/جانب" },
  { name: "تمديد عضلات الورك بالركوع", freq: "يومياً، حتى في أيام الراحة", why: "عضلات الورك المشدودة تُميل الحوض وتقلل تفعيل المؤخرة", hold: "30-40 ثانية/جانب" },
  { name: "تمديد الأريكة (رفع القدم الخلفية)", freq: "يومياً، حتى في أيام الراحة", why: "تمديد أعمق لعضلات الورك والفخذ، نفس هدف القوام", hold: "30-40 ثانية/جانب" },
  { name: "القط-البقرة", freq: "يومياً، حتى في أيام الراحة", why: "مرونة العمود الفقري، يعاكس تصلّب وانحناء أعلى الظهر", hold: "8-10 تكرارات بطيئة" },
  { name: "وضعية الطفل الممدودة", freq: "بعد كل جلسة", why: "يخفف الضغط عن أسفل الظهر بعد الرفع بالأوزان", hold: "45 ثانية" },
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
      @keyframes tl-fade-in { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
      .tl-fade-in { animation: tl-fade-in 0.35s ease-out; }
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
// Full-screen focus mode. Uses the same dark surface as the rest of the
// app (it no longer needs a special "always dark" trick now that the
// whole app is dark) plus a plate-ring on the big tap button and
// confetti in the actual plate colors when a day is finished.
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
          if (isLast) return { ...s, setsDone, phase: "stretch" };
          // advance to the next exercise now; the "rest" screen shown
          // right after already reflects it (setsDone===0 there tells
          // the UI this is a between-exercise rest, not a between-set one)
          return { ...s, setsDone: 0, exIndex: s.exIndex + 1, phase: "rest" };
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
        // rest before the next exercise's first set — a creator can set a
        // distinct restBetweenExercises per exercise; otherwise this just
        // reuses the same rest value as between sets, which is a
        // reasonable default rather than forcing every plan to define it
        restTotal.current = parseRestSeconds(currentEx.restBetweenExercises || currentEx.rest);
        setRestLeft(restTotal.current);
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
    ? { label: phase === "work" ? "مجموعة العمل" : "راحة", text: tier.accent, solid: tier.solid, hex: tier.hex }
    : phase === "stretch" || phase === "done"
      ? { label: phase === "stretch" ? "تهدئة" : "اكتمل", text: "text-charge", solid: "bg-charge", hex: "#d9a441" }
      : { label: "إحماء", text: "text-ink", solid: "bg-ink", hex: "#8a8578" };

  return (
    <div className="fixed inset-0 z-50 bg-paper text-ink flex flex-col overflow-hidden">
      <SessionStyles />

      <div
        className="pointer-events-none absolute inset-0 opacity-70 transition-[background] duration-500"
        style={{ background: `radial-gradient(circle at 50% 18%, ${accent.hex}26, transparent 55%)` }}
      />

      {toast && (
        <div className="fixed top-4 inset-x-0 flex justify-center z-20 px-4 pointer-events-none">
          <div className="tl-toast bg-charge text-paper rounded-full pl-3 pr-4 py-2.5 text-sm font-bold shadow-lg flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-ink/20 flex items-center justify-center shrink-0"><Check className="w-3 h-3" /></span>
            <span className="truncate max-w-[70vw]">اكتمل {exLabel(toast.done)}{toast.next ? ` — التالي: ${exLabel(toast.next)}` : ""}</span>
          </div>
        </div>
      )}

      <div className="relative flex items-center justify-between px-5 sm:px-8 pt-5 pb-2 max-w-2xl mx-auto w-full">
        <button onClick={() => setConfirmExit(true)} className="p-2 -ml-2 rounded-full text-ink/60 hover:text-ink hover:bg-ink/10"><X className="w-5 h-5" /></button>
        <div className="text-center">
          <p className={`text-xs font-bold uppercase tracking-widest ${accent.text}`}>{accent.label}</p>
          <p className="text-ink/40 text-xs font-mono">{fmtClock(elapsed)} منقضية</p>
        </div>
        <button onClick={toggleMuted} className="p-2 -mr-2 rounded-full text-ink/60 hover:text-ink hover:bg-ink/10 w-9 h-9 flex items-center justify-center">{muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</button>
      </div>

      {isLoadPhase && (
        <div className="relative flex gap-1.5 px-5 sm:px-8 mb-2 max-w-2xl mx-auto w-full">
          {exercises.map((_, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full ${i < exIndex ? "bg-charge" : i === exIndex ? accent.solid : "bg-ink/15"}`} />
          ))}
        </div>
      )}

      <div className="relative flex-1 overflow-y-auto tl-scroll flex flex-col items-center justify-center px-6 py-6 text-center">
        <div className="w-full max-w-md flex flex-col items-center">

          {phase === "warmupChoice" && (
            <>
              <div className="w-16 h-16 rounded-full bg-ink/10 flex items-center justify-center mb-4"><Flame className="w-7 h-7 text-ink/70" /></div>
              <h2 className="text-xl font-black font-display mb-2">سخّنت بالفعل؟</h2>
              <p className="text-ink/50 mb-6 max-w-xs text-sm">إن لم تكن قد فعلت، الإحماء مهم — 5 دقائق كحد أدنى، لا تخطي بعد البدء.</p>
              <button onClick={beginWarmupTimer} className="w-full max-w-xs px-8 py-3.5 rounded-2xl text-base font-black bg-ink text-paper mb-2.5">أحتاج للإحماء</button>
              <button onClick={skipWarmup} className="w-full max-w-xs px-8 py-3.5 rounded-2xl text-base font-black bg-ink/10 text-ink hover:bg-ink/15 transition-colors">سخّنت بالفعل</button>
            </>
          )}

          {phase === "warmup" && (
            <>
              <p className="text-ink/60 text-sm mb-2">الإحماء قبل بدء اليوم — هذه الخطوة إلزامية.</p>
              <div className="text-[clamp(3rem,11vw,5rem)] font-black font-mono mb-4 tabular-nums">{fmtClock(warmupLeft)}</div>
              <button
                disabled={warmupLeft > 0}
                onClick={completeWarmup}
                className={`px-6 py-3.5 rounded-2xl text-base font-black transition-all relative ${warmupLeft > 0 ? "bg-ink/10 text-ink/40" : "bg-ink text-paper tl-ring"}`}
              >
                {warmupLeft > 0 ? `جارٍ الإحماء… ${fmtClock(warmupLeft)} متبقية` : "✓ انتهى الإحماء — ابدأ اليوم"}
              </button>
            </>
          )}

          {phase === "work" && currentEx && (
            <div key={`work-${exIndex}`} className="tl-fade-in w-full flex flex-col items-center">
              <p className="text-ink/40 text-xs font-bold font-mono mb-2">التمرين {exIndex + 1} من {totalExercises}</p>
              {currentEx.image
                ? <img src={currentEx.image} alt="" className="w-[clamp(140px,32vw,220px)] h-[clamp(140px,32vw,220px)] rounded-3xl object-cover mb-4 shadow-lg" />
                : <div className="w-[clamp(140px,32vw,220px)] h-[clamp(140px,32vw,220px)] rounded-3xl bg-ink/10 mb-4 flex items-center justify-center"><Dumbbell className="w-14 h-14 text-ink/30" /></div>}
              <h2 className="text-[clamp(1.5rem,5.5vw,2.25rem)] font-black font-display leading-tight mb-1 text-center">{exLabel(currentEx.name)}</h2>
              <p className="text-ink/50 text-base mb-2">{muscleLabel(currentEx.muscle)}</p>
              <p className="text-ink/70 text-base font-mono mb-6 flex items-center gap-2">{currentEx.reps} تكرار · <PlateBadge weight={currentEx.weight} size="lg" /></p>

              <div className="flex gap-2 mb-6 flex-wrap justify-center max-w-xs">
                {Array.from({ length: currentEx.sets }).map((_, i) => (
                  <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black font-mono transition-all ${i < setsDone ? "bg-charge text-paper" : "bg-ink/10 text-ink/30"} ${i === setsDone - 1 && popKey ? "tl-pop" : ""}`}>
                    {i < setsDone ? <Check className="w-4 h-4" /> : i + 1}
                  </div>
                ))}
              </div>

              <button
                key={popKey}
                onClick={completeSet}
                style={{ width: "clamp(180px, 36vw, 260px)", height: "clamp(180px, 36vw, 260px)", boxShadow: "inset 0 0 0 10px rgba(16,15,13,0.18), inset 0 0 0 12px rgba(242,238,228,0.10), 0 18px 40px rgba(0,0,0,0.45)" }}
                className={`rounded-full ${tier.solid} text-white flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform tl-ring relative`}
              >
                <span className="text-[clamp(1.1rem,3vw,1.5rem)] font-black font-display">مجموعة {setsDone + 1}</span>
                <span className="text-sm font-bold opacity-75 font-mono">من {currentEx.sets}</span>
                <span className="text-xs font-bold mt-2 uppercase tracking-wide opacity-90">اضغط عند الانتهاء</span>
              </button>
            </div>          )}

          {phase === "rest" && currentEx && (
            <div key={`rest-${exIndex}-${setsDone}`} className="tl-fade-in w-full flex flex-col items-center">
              {setsDone === 0 ? (
                <>
                  <p className="text-ink/50 text-sm mb-2">راحة قبل التمرين التالي</p>
                  <div className={`text-[clamp(3rem,11vw,5rem)] font-black font-mono mb-4 tabular-nums ${accent.text}`}>{fmtClock(restLeft)}</div>
                  <p className="text-ink font-bold text-base mb-1">{exLabel(currentEx.name)}</p>
                  <p className="text-ink/40 text-sm mb-6">{muscleLabel(currentEx.muscle)}</p>
                </>
              ) : (
                <>
                  <p className="text-ink/50 text-sm mb-2">راحة قبل المجموعة {setsDone + 1}</p>
                  <div className={`text-[clamp(3rem,11vw,5rem)] font-black font-mono mb-4 tabular-nums ${accent.text}`}>{fmtClock(restLeft)}</div>
                  <p className="text-ink/40 text-sm mb-6">{exLabel(currentEx.name)}</p>
                </>
              )}
              <button onClick={skipRest} className="px-6 py-2.5 rounded-xl text-sm font-bold text-ink/60 border border-ink/20 hover:bg-ink/10 transition-colors">تخطي الراحة</button>
            </div>
          )}

          {phase === "stretch" && (
            <>
              <h2 className="text-xl font-black font-display mb-1">تهدئة</h2>
              <p className="text-ink/50 text-sm mb-4">اختياري، لكنه يستحق العناء لأجل القوام.</p>
              <div className="w-full max-w-sm space-y-2 mb-6 text-left">
                {STRETCHES.filter((s) => s.freq === "بعد كل جلسة").map((s) => (
                  <div key={s.name} className="rounded-2xl bg-ink/10 px-4 py-3">
                    <p className="font-bold text-sm">{s.name} <span className="text-ink/40 font-normal">· {s.hold}</span></p>
                    <p className="text-ink/40 text-xs">{s.why}</p>
                  </div>
                ))}
              </div>
              <button onClick={finishStretch} className="px-8 py-3.5 rounded-2xl text-base font-black bg-charge text-paper hover:bg-charge-strong transition-colors">انتهيت من التمديد</button>
            </>
          )}

          {phase === "done" && (
            <>
              <div className="relative mb-4">
                <div className="w-20 h-20 rounded-full bg-charge flex items-center justify-center"><Check className="w-9 h-9 text-paper" strokeWidth={3} /></div>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="tl-confetti absolute w-2 h-3 rounded-sm" style={{ left: `${10 + i * 8}%`, top: "10%", background: ["#ded7c5", "#57c07a", "#e8c247", "#6fa8dd", "#ef6a5f"][i % 5], animationDelay: `${i * 0.05}s` }} />
                ))}
              </div>
              <h2 className="text-2xl font-black font-display mb-1.5">اكتمل اليوم!</h2>
              <p className="text-ink/50 text-sm mb-1 font-mono">{totalExercises} تمارين · {fmtClock(elapsed)}</p>
              <p className="text-ink/40 text-sm mb-6">جلسة رائعة. اذهب لترتاح.</p>
              <button onClick={onExit} className="px-8 py-3.5 rounded-2xl text-base font-black bg-charge text-paper hover:bg-charge-strong transition-colors">إنهاء</button>
            </>
          )}
        </div>
      </div>

      {confirmExit && (
        <div className="fixed inset-0 z-10 bg-black/70 flex items-center justify-center p-6" onClick={() => setConfirmExit(false)}>
          <div className="bg-card backdrop-blur rounded-2xl p-5 max-w-xs w-full border border-line" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold mb-1">إنهاء هذا التمرين؟</p>
            <p className="text-ink-faint text-sm mb-4">تقدّمك في هذه الجلسة لن يُحفظ.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmExit(false)} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-mist hover:bg-mist/70 transition-colors">متابعة التمرين</button>
              <button onClick={onExit} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-danger text-white hover:bg-danger/85 transition-colors">إنهاء</button>
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
      <span className="text-xs font-bold text-ink-soft tracking-wide uppercase font-display">جارٍ إيجاد التوازن…</span>
    </div>
  );
}

function BrandMark({ className = "", size = "lg" }) {
  const dim = size === "sm" ? "w-8 h-8 rounded-lg" : "w-16 h-16 rounded-2xl";
  const icon = size === "sm" ? "w-4 h-4" : "w-8 h-8";
  return (
    <div className={`${dim} bg-charge flex items-center justify-center shadow-lg shadow-charge/20 shrink-0 ${className}`}>
      <Dumbbell className={`${icon} text-paper`} strokeWidth={2.25} />
    </div>
  );
}

// ---- PWA install support ----
// Captures the native "beforeinstallprompt" event (Android/desktop Chrome
// & Edge) so we can trigger it from our own "Install app" button, and
// separately detects iOS Safari, which never fires that event and needs
// the manual "Share -> Add to Home Screen" instructions instead.
function usePwaInstall() {
  const deferredRef = useRef(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); deferredRef.current = e; setCanInstall(true); };
    const onInstalled = () => { setInstalled(true); setCanInstall(false); deferredRef.current = null; };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  const promptInstall = async () => {
    const evt = deferredRef.current;
    if (!evt) return;
    evt.prompt();
    try { await evt.userChoice; } catch (err) { /* ignore */ }
    deferredRef.current = null;
    setCanInstall(false);
  };

  const isStandalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  return { canInstall, installed, promptInstall, isStandalone, isIos };
}

export default function TrainingLog() {
  const [plans, setPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [activeDay, setActiveDay] = useState(null);
  const pageFromUrl = () => {
    const p = window.location.hash.replace("#", "");
    return ["train", "community", "chat", "profile"].includes(p) ? p : "train";
  };
  const [page, setPageState] = useState(pageFromUrl); // train | community | chat | profile
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
  const [shareOpen, setShareOpen] = useState(null); // plan being shared, or null
  const [planSwitcherOpen, setPlanSwitcherOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [onboardStep, setOnboardStep] = useState(null); // null=deciding, "auth", "tutorial", "done"
  const [saveError, setSaveError] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profileName, setProfileName] = useState(null); // the mandatory first+family name, NOT the Google account name — used everywhere a person's name is shown/attributed, since email/password accounts often have no display name at all
  const [needsName, setNeedsName] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [remoteChecked, setRemoteChecked] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [syncError, setSyncError] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [theme, setTheme] = useState("equipment");
  const [adminToolsOpen, setAdminToolsOpen] = useState(false);
  const [adminInboxOpen, setAdminInboxOpen] = useState(false);
  const fileInputRef = useRef(null);
  const pushTimer = useRef(null);
  const pwa = usePwaInstall();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => { /* fine — app still works without offline caching */ });
    }
  }, []);

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
      saveUserData(firebaseUser.uid, authorName, { plans, activePlanId }).catch(() => setSyncError(true));
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
      try { const ob = await window.storage.get(ONBOARD_KEY, false); setOnboardStep(ob?.value ? "done" : "language"); } catch (err) { setOnboardStep("language"); }
      try { mergeRemoteLibrary(await fetchExerciseLibrary()); } catch (err) { /* offline or none yet — the hardcoded seed still works fine */ }
      try { const t = await window.storage.get(THEME_KEY, false); if (t?.value && THEMES.some((th) => th.id === t.value)) { setTheme(t.value); applyTheme(t.value); } } catch (err) { /* default theme */ }
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
          if (remote?.firstName) setProfileName(`${remote.firstName} ${remote.familyName || ""}`.trim());
          if (!remote?.firstName) setNeedsName(true);
          if (remote?.theme && THEMES.some((th) => th.id === remote.theme)) { setTheme(remote.theme); applyTheme(remote.theme); }
        } catch (err) { /* fall back to local */ }
      }
      setRemoteChecked(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => { if (loaded && !activePlanId && plans.length) { setActivePlanId(plans[0].id); setActiveDay(plans[0].days[0].id); } }, [loaded, activePlanId, plans]);
  // Safety net: never get stuck on a loading screen if onboarding was
  // marked done (from an earlier session) but somehow no plan exists.
  // Waits for the remote-account check to settle first, so a returning
  // signed-in user doesn't get bounced to "choose a plan" during the
  // brief moment before their synced plans have loaded in.
  useEffect(() => { if (loaded && remoteChecked && onboardStep === "done" && plans.length === 0) setOnboardStep("choosePlan"); }, [loaded, remoteChecked, onboardStep, plans]);

  const persist = useCallback((nextPlans, nextActiveId) => {
    (async () => { try { const res = await window.storage.set(STORAGE_KEY, JSON.stringify({ plans: nextPlans, activePlanId: nextActiveId }), false); setSaveError(!res); } catch (err) { setSaveError(true); } })();
    if (firebaseUser) {
      clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => { saveUserData(firebaseUser.uid, authorName, { plans: nextPlans, activePlanId: nextActiveId }).catch(() => setSyncError(true)); }, 1200);
    }
  }, [firebaseUser]);

  useEffect(() => { if (loaded && activePlanId) persist(plans, activePlanId); }, [plans, activePlanId, loaded, persist]);

  const plan = plans.find((p) => p.id === activePlanId) || plans[0];
  const day = plan?.days.find((d) => d.id === activeDay) || plan?.days[0];
  useEffect(() => { if (plan && day && !plan.days.find((d) => d.id === activeDay)) setActiveDay(plan.days[0].id); }, [plan, day, activeDay]);

  const isReadOnly = plan?.readOnly === true;
  const canEdit = isRealAccount(firebaseUser);
  const isAdminUser = isAdmin(firebaseUser);
  const guard = (fn) => (...args) => { if (canEdit) return fn(...args); setSyncOpen(true); };
  const updatePlanDays = (updater) => setPlans((prev) => prev.map((p) => (p.id !== plan.id ? p : { ...p, days: updater(p.days) })));
  const updateExercise = (updated) => updatePlanDays((days) => days.map((d) => (d.id !== activeDay ? d : { ...d, exercises: d.exercises.map((e) => (e.id === updated.id ? updated : e)) })));
  const quickPhoto = (id, dataUrl) => updatePlanDays((days) => days.map((d) => (d.id !== activeDay ? d : { ...d, exercises: d.exercises.map((e) => (e.id === id ? { ...e, image: dataUrl } : e)) })));
  const deleteExercise = (id) => { updatePlanDays((days) => days.map((d) => (d.id !== activeDay ? d : { ...d, exercises: d.exercises.filter((e) => e.id !== id) }))); setConfirmDelete(null); };
  const addExercise = (form) => { const newEx = { ...form, id: `${activeDay}-${Date.now()}` }; updatePlanDays((days) => days.map((d) => (d.id !== activeDay ? d : { ...d, exercises: [...d.exercises, newEx] }))); setModal(null); };
  const saveDays = (newDays) => { setPlans((prev) => prev.map((p) => (p.id !== plan.id ? p : { ...p, days: newDays }))); setManageDaysOpen(false); if (!newDays.find((d) => d.id === activeDay)) setActiveDay(newDays[0].id); };

  const createPlan = (name, levelId) => {
    const p = makePlan(name, levelId, authorName || "أنت");
    setPlans((prev) => [...prev, p]); setActivePlanId(p.id); setActiveDay(p.days[0].id);
    setNewPlanOpen(false); setPage("train");
  };
  const forkPlan = (source) => {
    const p = { ...makePlan(`${source.name} (copy)`, "established", authorName || "أنت"), days: deepClone(source.days) };
    setPlans((prev) => [...prev, p]); setActivePlanId(p.id); setActiveDay(p.days[0].id);
    setPage("train");
  };
  const switchPlan = (id) => { setActivePlanId(id); setActiveDay(plans.find((p) => p.id === id)?.days[0]?.id); setPage("train"); };
  const patchPlan = (id, patch) => setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
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
    catch (err) { setSyncStatus("idle"); setSyncError(authErrorMessage(err, "تعذّر تسجيل الدخول — حاول مرة أخرى.")); }
  };
  const doUpgrade = async () => {
    setSyncStatus("syncing"); setSyncError(false);
    try { await upgradeToGoogle(); setSyncStatus("idle"); setSyncOpen(false); }
    catch (err) { setSyncStatus("idle"); setSyncError(authErrorMessage(err, "تعذّر تسجيل الدخول — حاول مرة أخرى.")); }
  };
  const doSignOut = async () => { try { await signOutUser(); } catch (err) { /* ignore */ } setSyncOpen(false); };
  const goTutorial = () => setOnboardStep("tutorial");
  const finishOnboard = async () => { setOnboardStep("done"); try { await window.storage.set(ONBOARD_KEY, JSON.stringify(true), false); } catch (err) { /* ignore */ } };
  const afterTutorial = () => { if (plans.length === 0) setOnboardStep("choosePlan"); else finishOnboard(); };
  const chooseFirstPlan = (levelId) => {
    const level = LEVELS.find((l) => l.id === levelId) || LEVELS[0];
    const p = makePlan(level.name, levelId, level.id === "established" ? "Spirito (app creator)" : null);
    setPlans([p]); setActivePlanId(p.id); setActiveDay(p.days[0].id);
    finishOnboard();
  };
  const [onboardErrorMsg, setOnboardErrorMsg] = useState("");
  const doOnboardGoogle = async () => {
    setSyncStatus("syncing"); setOnboardErrorMsg("");
    try { await signInGoogle(); setSyncStatus("idle"); goTutorial(); } catch (err) { setSyncStatus("idle"); setOnboardErrorMsg(authErrorMessage(err, "تعذّر تسجيل الدخول — حاول مرة أخرى.")); }
  };
  const doOnboardGuest = async () => {
    setSyncStatus("syncing");
    try { await startAnon(); } catch (err) { /* ignore */ }
    setSyncStatus("idle"); goTutorial();
  };
  const doOnboardEmail = async (email, pw, isSignUp) => {
    setSyncStatus("syncing"); setOnboardErrorMsg("");
    try { isSignUp ? await signUpEmail(email, pw) : await signInEmail(email, pw); setSyncStatus("idle"); goTutorial(); }
    catch (err) { setSyncStatus("idle"); setOnboardErrorMsg(authErrorMessage(err, isSignUp ? "تعذّر إنشاء هذا الحساب." : "تعذّر تسجيل الدخول — تحقق من بياناتك.")); }
  };
  const saveName = async (first, family) => {
    try { await saveProfileInfo(firebaseUser.uid, first, family, firebaseUser.email || null); } catch (err) { /* ignore */ }
    setProfileName(`${first} ${family}`.trim());
    setNeedsName(false);
  };
  const authorName = profileName || firebaseUser?.displayName || "";

  const changeTheme = (id) => {
    setTheme(id);
    applyTheme(id);
    window.storage.set(THEME_KEY, id, false).catch(() => {});
    if (canEdit) saveThemePreference(firebaseUser.uid, id);
  };

  // Unread-message badge for the Chat nav tab — realtime, live-updates
  // without needing to open the tab first.
  useEffect(() => {
    if (!firebaseUser || firebaseUser.isAnonymous) { setUnreadCount(0); return; }
    if (isAdmin(firebaseUser)) {
      const unsub = subscribeAllThreads((items) => setUnreadCount(items.filter((t) => t.unreadForAdmin).length));
      return () => unsub();
    }
    const unsub = subscribeThread(firebaseUser.uid, (t) => setUnreadCount(t?.unreadForUser ? 1 : 0));
    return () => unsub();
  }, [firebaseUser]);

  if (!loaded || onboardStep === null) return <div className="w-full min-h-screen bg-paper flex items-center justify-center"><LevelBubble /></div>;
  if (onboardStep !== "done") return <OnboardingFlow step={onboardStep} onGoogle={doOnboardGoogle} onGuest={doOnboardGuest} onEmailAuth={doOnboardEmail} onTutorialDone={afterTutorial} onChoosePlan={chooseFirstPlan} status={syncStatus} error={onboardErrorMsg} />;
  if (!plan || !day) return <div className="w-full min-h-screen bg-paper flex items-center justify-center"><LevelBubble /></div>;

  const focusCount = day.exercises.filter((e) => e.focus).length;
  const levelInfo = LEVELS.find((l) => l.id === plan.level);
  const weeksIn = Math.floor((Date.now() - new Date(plan.blockStartDate).getTime()) / (7 * 24 * 3600 * 1000));
  const PAGE_TITLE = { train: "التمرين", community: "المجتمع", chat: "الرسائل", profile: "أنت" };

  return (
    <div className="w-full min-h-screen bg-paper text-ink overflow-x-hidden pb-24">
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-line">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <BrandMark size="sm" />
            <span className="font-display font-black text-ink text-sm truncate">{PAGE_TITLE[page]}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!pwa.isStandalone && (
              <a href={APK_DOWNLOAD_URL} download className="inline-flex items-center gap-1.5 text-xs font-bold text-paper bg-charge rounded-full pl-2.5 pr-3 py-1.5 hover:bg-charge-strong transition-colors">
                <Download className="w-3.5 h-3.5" /> تحميل التطبيق
              </a>
            )}
            {!isOnline && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-faint bg-mist rounded-full pl-2 pr-2.5 py-1">
                <WifiOff className="w-3.5 h-3.5" /> غير متصل
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

        {page === "train" && (
          <>
            <div className="mb-4">
              <p className="text-[11px] font-bold tracking-[0.14em] text-ink-faint uppercase mb-1">{levelInfo?.name || "خطة مخصصة"}{plan.author ? ` · بواسطة ${plan.author}` : ""}</p>
              {plans.length > 1 ? (
                <button onClick={() => setPlanSwitcherOpen(true)} className="w-full flex items-center justify-between gap-3 -ml-1 pl-1 pr-2.5 py-1 rounded-xl hover:bg-mist transition-colors">
                  <h1 className="text-3xl font-black tracking-tight text-ink truncate font-display">{plan.name}</h1>
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-charge bg-charge-soft rounded-full pl-2 pr-2.5 py-1.5"><RefreshCw className="w-3 h-3" /> تبديل <ChevronDown className="w-3.5 h-3.5" /></span>
                </button>
              ) : (
                <h1 className="text-3xl font-black tracking-tight text-ink truncate font-display">{plan.name}</h1>
              )}
            </div>

            <PlateLegend />

            {weeksIn >= 6 && !isReadOnly && (
              <div className="mb-4 rounded-2xl bg-w4-soft border border-w4-ring p-4 flex items-start gap-3">
                <RefreshCw className="w-5 h-5 text-w4-strong shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-w4-strong"><span className="font-bold">الأسبوع {weeksIn} في هذه الخطة.</span> نقطة جيدة لتبديل 1-2 تمرين لكل عضلة لتنويع المفاصل.</p>
                  <button onClick={startNewBlock} className="mt-1.5 text-sm font-bold text-w4-strong hover:opacity-75">بدء مرحلة جديدة ←</button>
                </div>
              </div>
            )}

            <button onClick={() => !isReadOnly && guard(() => setManageDaysOpen(true))()} disabled={isReadOnly} className="w-full flex flex-row-reverse items-center justify-between mb-3 px-1 py-1 disabled:cursor-default">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-soft">{plan.days.length} أيام / أسبوع <Calendar className="w-4 h-4" /></span>
              {!isReadOnly && <span className="text-sm font-bold text-ink-faint flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> تعديل</span>}
            </button>

            <nav className="grid gap-2 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(6.5rem, 1fr))" }}>
              {plan.days.map((d) => (
                <button key={d.id} onClick={() => setActiveDay(d.id)} className={`rounded-2xl px-3.5 py-3 text-left transition ${activeDay === d.id ? "bg-charge text-paper" : "bg-card text-ink-soft border border-line hover:border-ink-faint"}`}>
                  <div className={`text-[11px] font-bold uppercase tracking-wide font-mono ${activeDay === d.id ? "text-paper/60" : "text-ink-faint"}`}>{d.label}</div>
                  <div className="text-base font-black leading-tight truncate">{d.title}</div>
                </button>
              ))}
            </nav>

            <div className="mb-5">
              <p className="text-base text-ink-soft mb-3"><span className="font-bold text-ink">{day.tagline}</span><span className="text-line mx-1.5">·</span>{focusCount} أساسية، {day.exercises.length - focusCount} ثانوية</p>
              {day.exercises.length > 0 && (
                <button onClick={() => setSessionOpen(true)} className="w-full py-4 rounded-2xl text-lg font-black bg-charge text-paper flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-charge/20 hover:bg-charge-strong">
                  <Dumbbell className="w-5 h-5" /> بدء التمرين
                </button>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {day.exercises.map((exItem) =>
                confirmDelete === exItem.id ? (
                  <div key={exItem.id} className="rounded-2xl border border-danger/30 bg-danger-soft p-4 flex items-center justify-between gap-3 sm:col-span-2">
                    <p className="text-sm text-danger">حذف <span className="font-bold">{exItem.name}</span>؟</p>
                    <div className="flex gap-2 shrink-0"><button onClick={() => setConfirmDelete(null)} className="px-3 py-2 rounded-xl text-sm font-bold text-ink-soft hover:bg-mist">إلغاء</button><button onClick={() => deleteExercise(exItem.id)} className="px-3 py-2 rounded-xl text-sm font-bold bg-danger text-white">حذف</button></div>
                  </div>
                ) : (
                  <ExerciseCard key={exItem.id} ex={exItem} readOnly={isReadOnly} onOpenEdit={guard(() => setModal({ mode: "edit", exercise: exItem }))} onDelete={guard(() => setConfirmDelete(exItem.id))} onQuickPhoto={guard((dataUrl) => quickPhoto(exItem.id, dataUrl))} />
                )
              )}
              {day.exercises.length === 0 && <div className="sm:col-span-2 rounded-2xl border border-dashed border-line p-8 text-center text-base text-ink-faint">لا توجد تمارين في هذا اليوم بعد.</div>}
              {!isReadOnly && <button onClick={guard(() => setModal({ mode: "add", exercise: emptyForm }))} className="sm:col-span-2 w-full rounded-2xl border-2 border-dashed border-line py-4 text-base font-bold text-ink-faint hover:border-charge hover:text-charge transition-colors flex items-center justify-center gap-1.5"><Plus className="w-5 h-5" /> إضافة تمرين</button>}
            </div>

            <footer className="mt-8 pt-4 border-t border-line text-xs text-ink-faint">
              {saveError ? "التغييرات لا تُحفظ الآن — قد تُفقد التعديلات عند التحديث." : firebaseUser ? "محفوظة على هذا الجهاز ومتزامنة." : "محفوظة على هذا الجهاز."}
            </footer>
          </>
        )}

        {page === "community" && <CommunityPage onFork={forkPlan} isOnline={isOnline} />}

        {page === "chat" && (canEdit ? <ChatPage user={firebaseUser} authorName={authorName} /> : (
          <div className="text-center py-16">
            <p className="text-sm text-ink-faint mb-3">سجّل الدخول للتواصل والحفظ.</p>
            <button onClick={() => setSyncOpen(true)} className="px-5 py-2.5 rounded-xl text-sm font-bold bg-charge text-paper hover:bg-charge-strong transition-colors">تسجيل الدخول</button>
          </div>
        ))}

        {page === "profile" && (
          <div className="space-y-6">
            <h1 className="text-3xl font-black tracking-tight text-ink font-display text-right">أنت</h1>

            <section>
              <button onClick={() => isOnline && setSyncOpen(true)} disabled={!isOnline} className="w-full flex items-center gap-3.5 bg-card border border-line rounded-2xl px-4 py-4 disabled:opacity-40 hover:border-ink-faint transition-colors">
                <span className={`w-12 h-12 rounded-full flex items-center justify-center font-black text-lg shrink-0 ${canEdit ? "bg-charge-soft text-charge" : "bg-w2-soft text-w2-strong"}`}>
                  {canEdit ? (authorName || "؟")[0] : "؟"}
                </span>
                <span className="flex-1 min-w-0 text-right">
                  <span className="font-bold text-ink text-base block truncate">{canEdit ? authorName : "تجربة فقط"}</span>
                  <span className="text-xs text-ink-faint flex items-center gap-1 justify-end">
                    <Cloud className={`w-3.5 h-3.5 ${canEdit ? "text-charge" : "text-w2"}`} />
                    {canEdit ? "متزامن" : "سجّل الدخول للحفظ"}
                  </span>
                </span>
                <ChevronRight className="w-4 h-4 text-ink-faint rotate-180 shrink-0" />
              </button>
            </section>

            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint mb-2.5">المظهر</h2>
              <div className="grid grid-cols-3 gap-2">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => changeTheme(t.id)}
                    className={`rounded-2xl p-3 text-center border transition-colors ${theme === t.id ? "border-charge bg-charge-soft" : "border-line bg-card hover:border-ink-faint"}`}
                  >
                    <span className={`block w-full h-8 rounded-lg mb-2 ${t.id === "equipment" ? "bg-[#100f0d] border border-[#d9a441]" : t.id === "studio" ? "bg-[#faf7f0] border border-[#9c5a1f]" : "bg-[#060a06] border border-[#5ee85e]"}`} />
                    <span className={`text-xs font-bold block ${theme === t.id ? "text-charge" : "text-ink"}`}>{t.name}</span>
                    <span className="text-[10px] text-ink-faint block mt-0.5">{t.desc}</span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="flex flex-row-reverse items-center justify-between mb-2.5">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">خططي</h2>
                <button onClick={guard(() => setNewPlanOpen(true))} className="text-sm font-bold text-charge flex items-center gap-1 hover:text-charge-strong"><Plus className="w-4 h-4" /> جديدة</button>
              </div>
              <div className="space-y-2">
                {plans.map((p) => (
                  confirmDeletePlan === p.id ? (
                    <div key={p.id} className="rounded-2xl border border-danger/30 bg-danger-soft p-4 flex items-center justify-between gap-3">
                      <p className="text-sm text-danger">حذف <span className="font-bold">{p.name}</span>؟</p>
                      <div className="flex gap-2 shrink-0"><button onClick={() => setConfirmDeletePlan(null)} className="px-3 py-2 rounded-xl text-sm font-bold text-ink-soft hover:bg-mist">إلغاء</button><button onClick={() => deletePlan(p.id)} className="px-3 py-2 rounded-xl text-sm font-bold bg-danger text-white">حذف</button></div>
                    </div>
                  ) : (
                    <div key={p.id} className={`rounded-2xl overflow-hidden ${p.id === activePlanId ? "bg-charge" : "bg-card border border-line"}`}>
                      <div className="p-4 flex items-center gap-3">
                        <button onClick={() => switchPlan(p.id)} className="flex-1 min-w-0 text-left">
                          <p className={`font-black truncate ${p.id === activePlanId ? "text-paper" : "text-ink"}`}>{p.name}</p>
                          <p className={`text-xs ${p.id === activePlanId ? "text-paper/65" : "text-ink-faint"}`}>{LEVELS.find((l) => l.id === p.level)?.name || "مخصصة"} · {p.days.length} أيام/أسبوع{p.author ? ` · بواسطة ${p.author}` : ""}{p.shareCode ? " · مُشاركة برمز" : ""}{p.publicShareId ? " · مُرسلة للمجتمع" : ""}</p>
                        </button>
                        {p.id === activePlanId && <span className="shrink-0 w-7 h-7 rounded-full bg-paper flex items-center justify-center"><Check className="w-4 h-4 text-charge" /></span>}
                        {plans.length > 1 && (
                          <button onClick={guard(() => setConfirmDeletePlan(p.id))} className={`shrink-0 p-2 rounded-lg ${p.id === activePlanId ? "text-paper/60 hover:text-paper" : "text-ink-faint hover:text-danger"}`} aria-label="حذف الخطة"><Trash2 className="w-4 h-4" /></button>
                        )}
                      </div>
                      <button
                        onClick={() => { if (!isOnline) return; if (!canEdit) { setSyncOpen(true); return; } setShareOpen(p); }}
                        disabled={!isOnline}
                        className={`w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold border-t disabled:opacity-40 transition-colors ${p.id === activePlanId ? "border-paper/20 text-paper hover:bg-paper/10" : "border-line text-charge hover:bg-charge-soft"}`}
                      >
                        <Send className="w-4 h-4" /> مشاركة هذه الخطة
                      </button>
                    </div>
                  )
                ))}
              </div>
              <div className="mt-3">
                <JoinSharedPlanCard onJoin={forkPlan} />
              </div>
            </section>

            {isAdminUser && (
              <section>
                <button onClick={() => setAdminToolsOpen(true)} className="w-full flex items-center justify-between gap-2 bg-card border border-line rounded-2xl px-4 py-3.5 hover:border-ink-faint transition-colors">
                  <span className="font-bold text-ink text-base">أدوات المسؤول</span>
                  <ChevronRight className="w-4 h-4 text-ink-faint rotate-180" />
                </button>
              </section>
            )}

            {!pwa.isStandalone && (
              <section>
                <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint mb-2.5">الحصول على التطبيق</h2>
                <div className="space-y-2">
                  <a href={APK_DOWNLOAD_URL} download className="w-full flex items-center justify-between gap-2 bg-card border border-line rounded-2xl px-4 py-3.5 hover:border-charge transition-colors">
                    <span className="flex items-center gap-2.5"><Download className="w-5 h-5 text-charge" /><span className="font-bold text-ink text-base">تحميل لأندرويد (APK)</span></span>
                    <ChevronRight className="w-4 h-4 text-ink-faint rotate-180" />
                  </a>
                  {pwa.isIos && (
                    <div className="rounded-2xl border border-line bg-card px-4 py-3.5 text-sm text-ink-soft flex items-start gap-2.5">
                      <Share className="w-4 h-4 shrink-0 mt-0.5 text-ink-faint" />
                      <span>اضغط أيقونة <span className="font-bold text-ink">المشاركة</span> في سفاري، ثم <span className="font-bold text-ink">إضافة إلى الشاشة الرئيسية</span>.</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint mb-2.5">نسخة احتياطية</h2>
              <div className="flex gap-2">
                <button onClick={guard(exportData)} className="flex-1 py-3 rounded-2xl text-sm font-bold text-ink-soft bg-card border border-line flex items-center justify-center gap-1.5 hover:border-ink-faint transition-colors"><Download className="w-4 h-4" /> تصدير</button>
                <button onClick={guard(() => fileInputRef.current?.click())} className="flex-1 py-3 rounded-2xl text-sm font-bold text-ink-soft bg-card border border-line flex items-center justify-center gap-1.5 hover:border-ink-faint transition-colors"><Upload className="w-4 h-4" /> استيراد</button>
              </div>
              <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importData(f); e.target.value = ""; }} />
            </section>
          </div>
        )}
      </div>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-card border-t border-line" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-4 max-w-2xl mx-auto">
          {[
            { id: "train", label: "التمرين", Icon: Home },
            { id: "community", label: "المجتمع", Icon: Users },
            { id: "chat", label: "الرسائل", Icon: Send },
            { id: "profile", label: "أنت", Icon: User },
          ].map(({ id, label, Icon }) => (
            <button key={id} onClick={() => (id === "chat" && !canEdit ? setSyncOpen(true) : setPage(id))} className="relative flex flex-col items-center gap-1 py-2.5 active:opacity-70 transition-opacity">
              {page === id && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-charge" />}
              <span className="relative">
                <Icon className={`w-5 h-5 transition-colors ${page === id ? "text-charge" : "text-ink-faint"}`} strokeWidth={2.25} />
                {id === "chat" && unreadCount > 0 && <span className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-danger border-2 border-card" />}
              </span>
              <span className={`text-[10px] font-bold transition-colors ${page === id ? "text-charge" : "text-ink-faint"}`}>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {modal && <ExerciseModal title={modal.mode === "add" ? "إضافة تمرين" : "تعديل تمرين"} initial={modal.exercise} onCancel={() => setModal(null)} onSave={(form) => { if (modal.mode === "add") addExercise(form); else { updateExercise({ ...form, id: modal.exercise.id }); setModal(null); } }} />}
      {newPlanOpen && <NewPlanModal onCancel={() => setNewPlanOpen(false)} onCreate={createPlan} />}
      {manageDaysOpen && <ManageDaysModal days={plan.days} onCancel={() => setManageDaysOpen(false)} onSave={saveDays} />}
      {syncOpen && <ProfileModal user={firebaseUser} authorName={authorName} onCancel={() => setSyncOpen(false)} onSignIn={doSignIn} onUpgrade={doUpgrade} onSignOut={doSignOut} status={syncStatus} error={syncError} />}
      {shareOpen && <ShareModal plan={shareOpen} user={firebaseUser} authorName={authorName} onCancel={() => setShareOpen(null)} onPatchPlan={(patch) => patchPlan(shareOpen.id, patch)} />}
      {planSwitcherOpen && <PlanSwitcherSheet plans={plans} activePlanId={activePlanId} levels={LEVELS} onSwitch={(id) => { switchPlan(id); setPlanSwitcherOpen(false); }} onManage={() => { setPlanSwitcherOpen(false); setPage("profile"); }} onCancel={() => setPlanSwitcherOpen(false)} />}
      {sessionOpen && day && <WorkoutSession day={day} onExit={() => setSessionOpen(false)} />}
      {needsName && canEdit && <NameModal onSave={saveName} />}
      {adminToolsOpen && (
        <FullScreenSheet title="أدوات المسؤول" onBack={() => setAdminToolsOpen(false)}>
          <AdminPanel user={firebaseUser} onOpenInbox={() => setAdminInboxOpen(true)} />
        </FullScreenSheet>
      )}
      {adminInboxOpen && (
        <FullScreenSheet title="صندوق الرسائل" onBack={() => setAdminInboxOpen(false)}>
          <div style={{ height: "calc(100vh - 3.5rem - env(safe-area-inset-top) - 2rem)" }}>
            <AdminInbox />
          </div>
        </FullScreenSheet>
      )}
    </div>
  );
}
