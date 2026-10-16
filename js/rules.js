// Структура бланка WHO Labour Care Guide и пороги ALERT.

const PLUS = [['0', '0'], ['+', '+'], ['++', '++'], ['+++', '+++']];
const URINE = [['0', '0'], ['±', '±'], ['+', '+'], ['++', '++'], ['+++', '+++']];
const YN = [['Y', 'Да'], ['N', 'Нет']];
const range = (a, b, s) => { const r = []; for (let x = a; x <= b + 1e-9; x += s) r.push(Math.round(x * 10) / 10); return r; };

// kind: num | enum | text | grid
export const PARAMS = {
  comp:  { label: 'Партнёр', kind: 'enum', opts: YN, alert: v => v === 'N', thr: 'N' },
  pain:  { label: 'Обезболивание', kind: 'enum', opts: YN, alert: v => v === 'N', thr: 'N' },
  fluid: { label: 'Питьё', kind: 'enum', opts: YN, alert: v => v === 'N', thr: 'N' },
  posture: { label: 'Положение', kind: 'enum', opts: [['MO', 'Подвижна'], ['SP', 'На спине']], alert: v => v === 'SP', thr: 'SP' },
  fhr:   { label: 'Базальная ЧСС', kind: 'num', min: 50, max: 230, presets: range(100, 180, 5), alert: v => v < 110 || v >= 160, thr: '<110, ≥160' },
  decel: { label: 'Децелерации', kind: 'enum', opts: [['N', 'Нет'], ['E', 'Ранние'], ['L', 'Поздние'], ['V', 'Вариабельные']], alert: v => v === 'L', thr: 'L' },
  af:    { label: 'Околоплодные воды', kind: 'enum', opts: [['I', 'Пузырь цел'], ['C', 'Светлые'], ['M+', 'Меконий +'], ['M++', 'Меконий ++'], ['M+++', 'Меконий +++'], ['B', 'С кровью']], alert: v => v === 'M+++' || v === 'B', thr: 'M+++, B' },
  pos:   { label: 'Позиция плода', kind: 'enum', opts: [['A', 'Передний вид'], ['P', 'Задний вид'], ['T', 'Поперечное']], alert: v => v === 'P' || v === 'T', thr: 'P, T' },
  caput: { label: 'Родовая опухоль', kind: 'enum', opts: PLUS, alert: v => v === '+++', thr: '+++' },
  mould: { label: 'Конфигурация', kind: 'enum', opts: PLUS, alert: v => v === '+++', thr: '+++' },
  pulse: { label: 'Пульс', kind: 'num', min: 30, max: 200, presets: range(60, 130, 5), alert: v => v < 60 || v >= 120, thr: '<60, ≥120' },
  sys:   { label: 'САД', kind: 'num', min: 50, max: 260, presets: range(80, 170, 5), alert: v => v < 80 || v >= 140, thr: '<80, ≥140' },
  dia:   { label: 'ДАД', kind: 'num', min: 20, max: 170, presets: range(50, 110, 5), alert: v => v >= 90, thr: '≥90' },
  temp:  { label: 'Температура, °C', kind: 'num', min: 33, max: 42, presets: range(35.8, 38.6, 0.1), alert: v => v < 35 || v >= 37.5, thr: '<35,0, ≥37,5' },
  prot:  { label: 'Моча: белок', kind: 'enum', opts: URINE, alert: v => v === '++' || v === '+++', thr: 'P++' },
  acet:  { label: 'Моча: ацетон', kind: 'enum', opts: URINE, alert: v => v === '++' || v === '+++', thr: 'A++' },
  cfreq: { label: 'Схватки за 10 мин', kind: 'num', min: 0, max: 10, presets: range(0, 7, 1), alert: v => v <= 2 || v > 5, thr: '≤2, >5' },
  cdur:  { label: 'Длительность схваток, с', kind: 'num', min: 0, max: 180, presets: range(15, 90, 5), alert: v => v < 20 || v > 60, thr: '<20, >60' },
  dil:   { label: 'Шейка матки, см (✕)', kind: 'grid', grid: [10, 9, 8, 7, 6, 5], thr: 'застой' },
  desc:  { label: 'Опускание, пятые (○)', kind: 'grid', grid: [5, 4, 3, 2, 1, 0] },
  oxyU:  { label: 'Окситоцин, ЕД/л', kind: 'num', min: 0, max: 40, presets: [2.5, 5, 10, 20] },
  oxyD:  { label: 'Окситоцин, кап/мин', kind: 'num', min: 0, max: 80, presets: range(4, 40, 4) },
  med:   { label: 'Препараты', kind: 'text' },
  iv:    { label: 'Инфузия', kind: 'text' },
  assess: { label: 'Оценка', kind: 'text' },
  plan:  { label: 'План', kind: 'text' },
};

// Шаг строки: I период — 'half' (каждые 30 мин) или 'hour'; II период — 'q' (15 мин) или 'five' (5 мин).
export const STAGE1 = [
  ['Уход', [['comp', 'hour'], ['pain', 'hour'], ['fluid', 'hour'], ['posture', 'hour']]],
  ['Ребёнок', [['fhr', 'half'], ['decel', 'half'], ['af', 'hour'], ['pos', 'hour'], ['caput', 'hour'], ['mould', 'hour']]],
  ['Женщина', [['pulse', 'hour'], ['sys', 'hour'], ['dia', 'hour'], ['temp', 'hour'], ['prot', 'hour'], ['acet', 'hour']]],
  ['Течение родов', [['cfreq', 'half'], ['cdur', 'half'], ['dil', 'hour'], ['desc', 'hour']]],
  ['Препараты', [['oxyU', 'hour'], ['oxyD', 'hour'], ['med', 'hour'], ['iv', 'hour']]],
  ['Решение', [['assess', 'hour'], ['plan', 'hour']]],
];
export const STAGE2 = [
  ['Ребёнок', [['fhr', 'five'], ['decel', 'five']]],
  ['Течение родов', [['cfreq', 'q'], ['cdur', 'q']]],
  ['Женщина', [['pulse', 'q'], ['sys', 'q'], ['dia', 'q']]],
  ['Решение', [['assess', 'q'], ['plan', 'q']]],
];

// Сетка: I период — 12 ч × 2 полчаса = 24 единицы; II период — 3 ч × 12 пятиминуток = 36 единиц.
export const UNITS = { 1: 24, 2: 36 };
export const SPAN = { half: 1, hour: 2, five: 1, q: 3 };
export const UNIT_MIN = { 1: 30, 2: 5 };
export const cellsIn = (stage, step) => UNITS[stage] / SPAN[step];

// Застой раскрытия LCG, часы на одном сантиметре.
export const LAG_H = { 5: 6, 6: 5, 7: 3, 8: 2.5, 9: 2 };

export const PLAN_CHIPS = ['Сообщено старшему врачу', 'Смена положения', 'КТГ', 'Инфузия', 'Амниотомия', 'Обезболивание', 'Окситоцин', 'Наблюдение', 'Повторная оценка через 1 ч'];

export const hasVal = v => v !== undefined && v !== null && v !== '';

export function isAlert(k, v) {
  const P = PARAMS[k];
  return !!(P && P.alert && hasVal(v) && P.alert(v));
}

export function fmt(v) { return hasVal(v) ? String(v).replace('.', ',') : ''; }

// Часы, в которые X стоит на том же сантиметре дольше порога.
export function lagAlerts(cells) {
  const out = new Set();
  let first = null, cur = null;
  for (let h = 0; h < 12; h++) {
    const d = cells[`1:dil:${h}`];
    if (!hasVal(d)) continue;
    if (d !== cur) { cur = d; first = h; }
    else if (LAG_H[d] && h - first >= LAG_H[d]) out.add(h);
  }
  return out;
}
