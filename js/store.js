// Локальное хранилище: всё остаётся на устройстве (localStorage).
import { DEFAULT_INTERVALS } from './rules.js';

const KEY = 'partogramma-voz-v1';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const clone = o => JSON.parse(JSON.stringify(o));

export function freshSettings() {
  return { mode: 'who', theme: 'auto', sound: true, wake: false, intervals: clone(DEFAULT_INTERVALS) };
}

function fresh() { return { v: 1, settings: freshSettings(), patients: [] }; }

function normalize(s) {
  const f = fresh();
  if (!s || typeof s !== 'object' || !Array.isArray(s.patients)) return f;
  s.settings = { ...f.settings, ...(s.settings || {}) };
  for (const m of ['who', 'rf']) {
    s.settings.intervals[m] = s.settings.intervals[m] || clone(DEFAULT_INTERVALS[m]);
    for (const st of [1, 2]) s.settings.intervals[m][st] = { ...DEFAULT_INTERVALS[m][st], ...(s.settings.intervals[m][st] || {}) };
  }
  s.patients.forEach(p => { p.records = Array.isArray(p.records) ? p.records : []; });
  return s;
}

function load() {
  try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return fresh(); }
}

export const db = { state: load() };

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db.state)); return true; } catch (e) { return false; }
}

export function patient(id) { return db.state.patients.find(p => p.id === id); }

export function newPatient(data) {
  const now = Date.now();
  const p = {
    id: uid(), created: now, label: '', parity: 'nulli', paraN: '', onset: 'spont',
    active: now, rom: null, risks: '', stage2: null, pushing: null, birth: null, closed: false,
    records: [], ...data,
  };
  db.state.patients.push(p);
  save();
  return p;
}

export function addRecord(p, rec) {
  const r = { id: uid(), t: Date.now(), plan: '', ...rec };
  p.records.push(r);
  save();
  return r;
}

export function exportAll() { return JSON.stringify({ app: 'partogramma-voz', exported: Date.now(), ...db.state }, null, 1); }

export function exportPatient(p) {
  return JSON.stringify({ app: 'partogramma-voz', exported: Date.now(), patients: [p] }, null, 1);
}

// Импорт: пациентки добавляются / обновляются по id, настройки не трогаем (кроме полного бэкапа).
export function importData(text, { withSettings = false } = {}) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.patients)) throw new Error('Не похоже на файл партограммы');
  let added = 0, updated = 0;
  for (const p of data.patients) {
    if (!p || !p.id) continue;
    p.records = Array.isArray(p.records) ? p.records : [];
    const i = db.state.patients.findIndex(x => x.id === p.id);
    if (i >= 0) { db.state.patients[i] = p; updated++; } else { db.state.patients.push(p); added++; }
  }
  if (withSettings && data.settings) db.state.settings = normalize({ settings: data.settings, patients: [] }).settings;
  save();
  return { added, updated };
}

export async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return false;
}
