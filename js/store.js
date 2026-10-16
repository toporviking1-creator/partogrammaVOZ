// Бланки хранятся только на этом устройстве.
const KEY = 'partogramma-voz-blanks-v2';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.blanks)) return s; } catch (e) {}
  return { blanks: [] };
}
export const db = { state: load() };

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db.state)); return true; } catch (e) { return false; }
}

export const blank = id => db.state.blanks.find(b => b.id === id);

export function newBlank() {
  const now = new Date(); now.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
  const b = { id: uid(), created: Date.now(), label: '', parity: '', onset: '', start: now.getTime(), rom: '', risks: '', s2start: null, cells: {} };
  db.state.blanks.unshift(b);
  save();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  return b;
}

export function removeBlank(id) { db.state.blanks = db.state.blanks.filter(b => b.id !== id); save(); }

export function exportBlank(b) { return JSON.stringify({ app: 'partogramma-voz', v: 2, blanks: [b] }); }

export function importBlanks(text) {
  const d = JSON.parse(text);
  if (!d || !Array.isArray(d.blanks)) throw new Error('это не файл бланка');
  let n = 0;
  for (const b of d.blanks) {
    if (!b || !b.id || typeof b.cells !== 'object') continue;
    const i = db.state.blanks.findIndex(x => x.id === b.id);
    if (i >= 0) db.state.blanks[i] = b; else db.state.blanks.unshift(b);
    n++;
  }
  save();
  return n;
}
