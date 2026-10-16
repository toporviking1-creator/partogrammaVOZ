// Строки бланка «Партограмма ВОЗ» отделения и пороги (колонка «Критические показатели»).

const PLUS = [['0', '0'], ['+', '+'], ['++', '++'], ['+++', '+++']];
const YN = [['Да', 'Да'], ['Нет', 'Нет']];
const range = (a, b, s) => { const r = []; for (let x = a; x <= b + 1e-9; x += s) r.push(Math.round(x * 10) / 10); return r; };

// kind: num | enum | text | grid | mark
export const PARAMS = {
  comp:    { label: 'Сопровождающее лицо', kind: 'enum', opts: YN, alert: v => v === 'Нет', thr: 'Нет' },
  pain:    { label: 'Обезболивание', kind: 'enum', opts: YN, alert: v => v === 'Нет', thr: 'Нет' },
  fluid:   { label: 'Пероральное введение жидкости', kind: 'enum', opts: YN, alert: v => v === 'Нет', thr: 'Нет' },
  posture: { label: 'Положение', kind: 'enum', opts: [['Спина', 'на спине'], ['Подв.', 'подвижна']], alert: v => v === 'Спина', thr: 'Спина' },
  fhr:     { label: 'Базальная ЧСС плода', kind: 'num', min: 50, max: 230, presets: range(100, 180, 5), alert: v => v < 110 || v >= 160, thr: '<110, ≥160' },
  decel:   { label: 'Децелерация ЧСС', kind: 'enum', opts: [['Нет', 'нет'], ['Ран', 'ранние'], ['Поз', 'поздние'], ['Вар', 'вариабельные']], alert: v => v === 'Поз', thr: 'Поз' },
  af:      { label: 'Амниотическая жидкость', kind: 'enum', opts: [['Ц', 'пузырь цел'], ['С', 'светлые'], ['М+', 'меконий +'], ['М++', 'меконий ++'], ['М+++', 'меконий +++'], ['К', 'кровь']], alert: v => v === 'М+++' || v === 'К', thr: 'М+++, К' },
  pos:     { label: 'Внутриутробное расположение плода', kind: 'enum', opts: [['A', 'передний вид'], ['P', 'задний вид'], ['T', 'поперечное']], alert: v => v === 'P' || v === 'T', thr: 'P, T' },
  caput:   { label: 'Родовая опухоль', kind: 'enum', opts: PLUS, alert: v => v === '+++', thr: '+++' },
  mould:   { label: 'Конфигурация головки', kind: 'enum', opts: PLUS, alert: v => v === '+++', thr: '+++' },
  pulse:   { label: 'Пульс', kind: 'num', min: 30, max: 200, presets: range(60, 130, 5), alert: v => v < 60 || v >= 120, thr: '<60, ≥120' },
  sys:     { label: 'Систолическое АД', kind: 'num', min: 50, max: 260, presets: range(80, 170, 5), alert: v => v < 80 || v >= 140, thr: '<80, ≥140' },
  dia:     { label: 'Диастолическое АД', kind: 'num', min: 20, max: 170, presets: range(50, 110, 5), alert: v => v >= 90, thr: '≥90' },
  temp:    { label: 'Температура °С', kind: 'num', min: 33, max: 42, presets: range(35.8, 38.6, 0.1), alert: v => v < 35 || v >= 37.5, thr: '<35,0, ≥37,5' },
  urine:   { label: 'Моча, мл', kind: 'num', min: 0, max: 2000, presets: [50, 100, 150, 200, 250, 300, 350, 400, 500, 600], thr: 'К, Ан' },
  cfreq:   { label: 'Частота схваток в течение 10 мин', kind: 'num', min: 0, max: 10, presets: range(0, 7, 1), alert: v => v <= 2 || v > 5, thr: '≤2, >5' },
  cdur:    { label: 'Продолжительность схваток', kind: 'num', min: 0, max: 180, presets: range(15, 90, 5), alert: v => v < 20 || v > 60, thr: '<20, >60' },
  dil:     { label: 'Раскрытие шейки матки [График X]', kind: 'grid', grid: [10, 9, 8, 7, 6, 5], gridThr: { 9: '≥2ч', 8: '≥2.5ч', 7: '≥3ч', 6: '≥5ч', 5: '≥6ч' } },
  desc:    { label: 'Продвижение плода [График O]', kind: 'grid', grid: [5, 4, 3, 2, 1, 0] },
  push:    { label: 'Начало потуг', kind: 'mark' },
  oxy:     { label: 'Окситоцин (мл/ч)', kind: 'num', min: 0, max: 200, presets: [3, 6, 9, 12, 15, 18, 21, 24, 30, 36] },
  med:     { label: 'Препараты', kind: 'text' },
  iv:      { label: 'Внутривенные инфузии', kind: 'text' },
  plan:    { label: 'План', kind: 'text' },
  init:    { label: 'Инициалы', kind: 'text' },
};

// Сетка: I период — 12 ч по 30 мин (24 единицы); II период — 3 ч по 15 мин (12 единиц).
export const UNITS = { 1: 24, 2: 12 };
export const UNIT_MIN = { 1: 30, 2: 15 };
// Ширина клетки в единицах. I: half=30 мин, hour=1 ч, two=2 ч. II: q=15 мин, h30=30 мин, h60=1 ч.
export const SPAN = { half: 1, hour: 2, two: 4, q: 1, h30: 2, h60: 4 };
export const cellsIn = (stage, step) => UNITS[stage] / SPAN[step];

// [секция, [[ключ, шаг I периода, шаг II периода]]] — как на бланке.
export const ROWS = [
  ['Поддерживающий уход', [['comp', 'hour', 'h60'], ['pain', 'hour', 'h60'], ['fluid', 'hour', 'h60'], ['posture', 'hour', 'h60']]],
  ['Плод', [['fhr', 'half', 'q'], ['decel', 'half', 'q'], ['af', 'hour', 'h60'], ['pos', 'hour', 'h60'], ['caput', 'hour', 'h60'], ['mould', 'hour', 'h60']]],
  ['Роженица', [['pulse', 'hour', 'h30'], ['sys', 'hour', 'h30'], ['dia', 'hour', 'h30'], ['temp', 'hour', 'h30'], ['urine', 'hour', 'h30']]],
  ['Ход родов', [['cfreq', 'half', 'q'], ['cdur', 'half', 'q'], ['dil', 'hour', null], ['desc', 'hour', 'h30']]],
  ['Медикаменты', [['oxy', 'hour', 'h60'], ['med', 'hour', 'h60'], ['iv', 'hour', 'h60']]],
];
export const ROWS_PLAN = [
  ['Совместное принятие решений', [['plan', 'two', 'h60']]],
  ['', [['init', 'hour', 'h60']]],
];

// Застой раскрытия, часы на одном сантиметре (колонка бланка).
export const LAG_H = { 5: 6, 6: 5, 7: 3, 8: 2.5, 9: 2 };

export const PLAN_CHIPS = ['Наблюдение', 'Сообщено старшему врачу', 'Смена положения', 'КТГ', 'Инфузия', 'Амниотомия', 'Обезболивание', 'Окситоцин', 'Повторный осмотр через 1 ч'];

export const hasVal = v => v !== undefined && v !== null && v !== '';

export function isAlert(k, v) {
  const P = PARAMS[k];
  return !!(P && P.alert && hasVal(v) && P.alert(v));
}

export function fmt(v) { return hasVal(v) ? String(v).replace('.', ',') : ''; }

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
