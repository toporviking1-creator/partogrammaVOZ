// Бланки хранятся только на этом устройстве.
const KEY = 'partogramma-voz-blanks-v3';
const OLD = 'partogramma-voz-blanks-v2';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const emptyBirth = () => ({ epi: '', epiWhy: '', kids: [{}, {}] });

// перенос бланков из предыдущей версии (бланк ВОЗ общего вида)
function migrate(old) {
  const MAP = {
    comp: { Y: 'Да', N: 'Нет' }, pain: { Y: 'Да', N: 'Нет' }, fluid: { Y: 'Да', N: 'Нет' },
    posture: { MO: 'Подв.', SP: 'Спина' }, decel: { N: 'Нет', E: 'Ран', L: 'Поз', V: 'Вар' },
    af: { I: 'Ц', C: 'С', 'M+': 'М+', 'M++': 'М++', 'M+++': 'М+++', B: 'К' },
  };
  const KEEP = ['comp', 'pain', 'fluid', 'posture', 'fhr', 'decel', 'af', 'pos', 'caput', 'mould', 'pulse', 'sys', 'dia', 'temp', 'cfreq', 'cdur', 'dil', 'desc', 'med', 'iv'];
  return (old.blanks || []).map(b => {
    const cells = {};
    for (const [key, v] of Object.entries(b.cells || {})) {
      const [st, k, i] = key.split(':');
      if (st !== '1') continue;
      if (KEEP.includes(k)) cells[key] = MAP[k] && MAP[k][v] ? MAP[k][v] : v;
      if (k === 'oxyD') cells[`1:oxy:${i}`] = v;
      if (k === 'plan') { const n = `1:plan:${Math.floor(i / 2)}`; cells[n] = cells[n] ? cells[n] + '; ' + v : v; }
    }
    return {
      id: b.id, created: b.created, fio: '', hist: b.label || '', parity: b.parity || '', onsetAt: null,
      start: b.start, rom: b.rom || null, risks: b.risks || '', s2start: b.s2start || null, s2auto: !!b.s2auto,
      cells, birth: emptyBirth(),
    };
  });
}

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.blanks)) return s; } catch (e) {}
  try {
    const o = JSON.parse(localStorage.getItem(OLD));
    if (o && Array.isArray(o.blanks) && o.blanks.length) { const s = { blanks: migrate(o) }; localStorage.setItem(KEY, JSON.stringify(s)); return s; }
  } catch (e) {}
  return { blanks: [] };
}
export const db = { state: load() };

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db.state)); return true; } catch (e) { return false; }
}

export const blank = id => db.state.blanks.find(b => b.id === id);

export function newBlank() {
  const now = new Date(); now.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
  const b = { id: uid(), created: Date.now(), fio: '', hist: '', parity: '', onsetAt: null, start: now.getTime(), rom: null, risks: '', s2start: null, s2auto: false, cells: {}, birth: emptyBirth() };
  db.state.blanks.unshift(b);
  save();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  return b;
}

export function removeBlank(id) { db.state.blanks = db.state.blanks.filter(b => b.id !== id); save(); }

export function exportBlank(b) { return JSON.stringify({ app: 'partogramma-voz', v: 3, blanks: [b] }); }

export function importBlanks(text) {
  const d = JSON.parse(text);
  if (!d || !Array.isArray(d.blanks)) throw new Error('это не файл бланка');
  const list = d.v === 3 ? d.blanks : migrate(d);
  let n = 0;
  for (const b of list) {
    if (!b || !b.id || typeof b.cells !== 'object') continue;
    b.birth = b.birth || emptyBirth();
    const i = db.state.blanks.findIndex(x => x.id === b.id);
    if (i >= 0) db.state.blanks[i] = b; else db.state.blanks.unshift(b);
    n++;
  }
  save();
  return n;
}
