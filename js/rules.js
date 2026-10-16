// Клиническая логика: параметры, пороги (ALERT) WHO Labour Care Guide,
// периодичность наблюдений, застой раскрытия, длительность II периода,
// линии бдительности/действия для режима КР РФ.
// Чистые функции — без DOM и хранилища.

export const MIN = 60000;

const PLUS = [['0', '0'], ['+', '+'], ['++', '++'], ['+++', '+++']];
const URINE = [['0', '—'], ['±', '±'], ['+', '+'], ['++', '++'], ['+++', '+++']];
const YN = [['Y', 'Да'], ['N', 'Нет']];

// kind: num | enum | yn | text
export const PARAMS = {
  fhr:   { label: 'ЧСС плода', short: 'ЧСС', unit: 'уд/мин', kind: 'num', min: 50, max: 230, step: 1,
           presets: [110, 120, 130, 140, 150, 160], alert: v => v < 110 || v >= 160, thr: '<110 или ≥160' },
  decel: { label: 'Децелерации', short: 'Дец.', kind: 'enum',
           opts: [['N', 'Нет'], ['E', 'Ранние'], ['L', 'Поздние'], ['V', 'Вариаб.']], def: 'N',
           alert: v => v === 'L', thr: 'L — поздние' },
  cfreq: { label: 'Схваток за 10 мин', short: 'Сх/10', unit: '', kind: 'num', min: 0, max: 10, step: 1,
           presets: [1, 2, 3, 4, 5, 6], alert: v => v <= 2 || v > 5, thr: '≤2 или >5' },
  cdur:  { label: 'Длительность схватки', short: 'Длит.', unit: 'с', kind: 'num', min: 0, max: 180, step: 5,
           presets: [20, 30, 40, 45, 50, 60, 70], alert: v => v < 20 || v > 60, thr: '<20 или >60 с' },
  pulse: { label: 'Пульс', short: 'Пульс', unit: 'уд/мин', kind: 'num', min: 30, max: 200, step: 1,
           presets: [70, 80, 90, 100, 110, 120], alert: v => v < 60 || v >= 120, thr: '<60 или ≥120' },
  sys:   { label: 'САД', short: 'САД', unit: 'мм', kind: 'num', min: 50, max: 260, step: 5,
           presets: [100, 110, 120, 130, 140, 150], alert: v => v < 80 || v >= 140, thr: '<80 или ≥140' },
  dia:   { label: 'ДАД', short: 'ДАД', unit: 'мм', kind: 'num', min: 20, max: 170, step: 5,
           presets: [60, 70, 80, 90, 100], alert: v => v >= 90, thr: '≥90' },
  temp:  { label: 'Температура', short: 't°', unit: '°C', kind: 'num', min: 33, max: 42, step: 0.1,
           presets: [36.4, 36.6, 36.8, 37.0, 37.2, 37.5, 38.0], alert: v => v < 35 || v >= 37.5, thr: '<35,0 или ≥37,5' },
  prot:  { label: 'Белок в моче', short: 'Белок', kind: 'enum', opts: URINE, alert: v => v === '++' || v === '+++', thr: '≥ ++' },
  acet:  { label: 'Ацетон в моче', short: 'Ацетон', kind: 'enum', opts: URINE, alert: v => v === '++' || v === '+++', thr: '≥ ++' },
  dil:   { label: 'Раскрытие', short: 'Раскр.', unit: 'см', kind: 'num', min: 0, max: 10, step: 1,
           presets: [3, 4, 5, 6, 7, 8, 9, 10], thr: 'застой — по времени на сантиметре' },
  desc:  { label: 'Опускание (пятые над входом)', short: 'Опуск.', unit: '/5', kind: 'num', min: 0, max: 5, step: 1,
           presets: [5, 4, 3, 2, 1, 0] },
  pos:   { label: 'Вид / позиция', short: 'Вид', kind: 'enum',
           opts: [['A', 'Передний'], ['P', 'Задний'], ['T', 'Поперечн.']], alert: v => v === 'P' || v === 'T', thr: 'P, T' },
  caput: { label: 'Родовая опухоль', short: 'Опух.', kind: 'enum', opts: PLUS, alert: v => v === '+++', thr: '+++' },
  mould: { label: 'Конфигурация', short: 'Конф.', kind: 'enum', opts: PLUS, alert: v => v === '+++', thr: '+++' },
  af:    { label: 'Околоплодные воды', short: 'Воды', kind: 'enum',
           opts: [['I', 'Пузырь цел'], ['C', 'Светлые'], ['M+', 'М+'], ['M++', 'М++'], ['M+++', 'М+++'], ['B', 'Кровь']],
           alert: v => v === 'M+++' || v === 'B', thr: 'M+++, B' },
  comp:  { label: 'Партнёр рядом', short: 'Партн.', kind: 'yn', opts: YN, def: 'Y', alert: v => v === 'N', thr: 'N' },
  pain:  { label: 'Обезболивание', short: 'Обезб.', kind: 'yn', opts: YN, def: 'Y', alert: v => v === 'N', thr: 'N' },
  fluid: { label: 'Пьёт / ест', short: 'Питьё', kind: 'yn', opts: YN, def: 'Y', alert: v => v === 'N', thr: 'N' },
  posture: { label: 'Положение', short: 'Полож.', kind: 'enum', opts: [['MO', 'Подвижна'], ['SP', 'На спине']], def: 'MO',
           alert: v => v === 'SP', thr: 'SP — на спине' },
  oxyU:  { label: 'Окситоцин, ЕД/л', short: 'Окс ЕД/л', kind: 'num', min: 0, max: 40, step: 0.5, presets: [2.5, 5, 10] },
  oxyD:  { label: 'Окситоцин, кап/мин', short: 'кап/мин', kind: 'num', min: 0, max: 80, step: 1, presets: [4, 8, 12, 16, 20, 24, 30] },
  med:   { label: 'Препараты', short: 'Преп.', kind: 'text' },
  iv:    { label: 'Инфузия', short: 'Инф.', kind: 'text' },
};

export const GROUPS = [
  { id: 'fetal', label: 'Плод: ЧСС', params: ['fhr', 'decel'] },
  { id: 'contr', label: 'Схватки', params: ['cfreq', 'cdur'] },
  { id: 've',    label: 'Влагалищное исследование', params: ['dil', 'desc', 'pos', 'caput', 'mould', 'af'] },
  { id: 'pulse', label: 'Пульс', params: ['pulse'] },
  { id: 'bp',    label: 'АД', params: ['sys', 'dia'] },
  { id: 'temp',  label: 'Температура', params: ['temp'] },
  { id: 'urine', label: 'Моча', params: ['prot', 'acet'] },
  { id: 'care',  label: 'Поддержка', params: ['comp', 'pain', 'fluid', 'posture'] },
  { id: 'meds',  label: 'Окситоцин / препараты', params: ['oxyU', 'oxyD', 'med', 'iv'], noTimer: true },
];
export const GROUP = Object.fromEntries(GROUPS.map(g => [g.id, g]));

// Минуты. 0 = без таймера. Источник для «who»: WHO LCG (Action Plan / User's manual):
// I период — ЧСС плода и схватки каждые 30 мин; пульс, АД, t°, моча, ВИ — каждые 4 ч; поддержка — ежечасно.
// II период — ЧСС плода каждые 5 мин, схватки не реже чем каждые 15 мин.
// «rf» — бумажная партограмма по КР РФ «Нормальные роды»: пульс/АД/t° ежечасно, схватки во II периоде — 15 мин.
// Все значения редактируются в Настройках.
export const DEFAULT_INTERVALS = {
  who: {
    1: { fetal: 30, contr: 30, ve: 240, pulse: 240, bp: 240, temp: 240, urine: 240, care: 60 },
    2: { fetal: 5, contr: 15, ve: 0, pulse: 240, bp: 240, temp: 240, urine: 240, care: 60 },
  },
  rf: {
    1: { fetal: 30, contr: 30, ve: 240, pulse: 60, bp: 60, temp: 60, urine: 240, care: 60 },
    2: { fetal: 5, contr: 15, ve: 0, pulse: 60, bp: 60, temp: 60, urine: 240, care: 60 },
  },
};

export const MODE_LABEL = { who: 'ВОЗ LCG', rf: 'КР РФ' };

// Застой раскрытия по LCG: время на одном и том же сантиметре, мин.
export const LAG = { 5: 360, 6: 300, 7: 180, 8: 150, 9: 120 };
// Длительность II периода (LCG): ≥3 ч у первородящих, ≥2 ч у повторнородящих.
export const STAGE2_LIMIT = { nulli: 180, multi: 120 };

export const PLAN_CHIPS = [
  'Сообщено старшему врачу', 'Смена положения', 'КТГ', 'Инфузия', 'Повтор через 15 мин',
  'Окситоцин снижен', 'Окситоцин остановлен', 'Амниотомия', 'Обезболивание',
  'Вызов анестезиолога', 'Вызов неонатолога', 'Решение об оперативном родоразрешении',
];

// ---------- значения ----------
export function hasVal(v) { return v !== undefined && v !== null && v !== ''; }

export function isAlert(param, v) {
  const P = PARAMS[param];
  return !!(P && P.alert && hasVal(v) && P.alert(v));
}

export function recordAlerts(rec) {
  return Object.keys(rec.v || {}).filter(k => isAlert(k, rec.v[k]));
}

export function fmtVal(param, v) {
  const P = PARAMS[param];
  if (!hasVal(v)) return '';
  if (P.kind === 'num') return String(v).replace('.', ',') + (P.unit ? ' ' + P.unit : '');
  if (P.kind === 'enum' || P.kind === 'yn') {
    const o = P.opts.find(o => o[0] === v);
    if (!o) return String(v);
    return o[1] === o[0] ? o[0] : `${o[0]} (${o[1].toLowerCase()})`;
  }
  return String(v);
}

export function fmtShort(param, v) {
  const P = PARAMS[param];
  if (!hasVal(v)) return '';
  if (P.kind === 'num') return String(v).replace('.', ',');
  return String(v);
}

// ---------- выборки по пациентке ----------
export function sorted(p) { return [...p.records].sort((a, b) => a.t - b.t); }

export function series(p, param) {
  return sorted(p).filter(r => r.v && hasVal(r.v[param])).map(r => ({ t: r.t, v: r.v[param], rec: r }));
}

export function lastValue(p, param) {
  const s = series(p, param);
  return s.length ? s[s.length - 1] : null;
}

export function lastOfGroup(p, gid) {
  const rs = sorted(p).filter(r => r.g === gid);
  return rs.length ? rs[rs.length - 1] : null;
}

export function stageOf(p) { return p.birth ? 3 : p.stage2 ? 2 : 1; }

// Задачи по таймерам, отсортированные по сроку.
export function dueList(p, intervalsForMode, now) {
  const stage = stageOf(p);
  if (stage === 3) return [];
  const iv = intervalsForMode[stage];
  const base = stage === 2 ? p.stage2 : (p.active || p.created);
  return GROUPS.filter(g => !g.noTimer && iv[g.id] > 0).map(g => {
    const last = lastOfGroup(p, g.id);
    let from = base;
    if (last) from = Math.max(last.t, stage === 2 ? p.stage2 : 0);
    const due = last || stage === 2 ? from + iv[g.id] * MIN : base; // нет данных — внести сразу
    return { g, last, due, left: due - now, interval: iv[g.id], empty: !last };
  }).sort((a, b) => a.due - b.due);
}

// Застой раскрытия по LCG.
export function lagStatus(p, now) {
  if (stageOf(p) !== 1) return null;
  const s = series(p, 'dil');
  if (!s.length) return null;
  const last = s[s.length - 1];
  const d = Math.floor(Number(last.v));
  if (!(d in LAG)) return null;
  let since = last.t;
  for (let i = s.length - 1; i >= 0; i--) {
    if (Math.floor(Number(s[i].v)) === d) since = s[i].t; else break;
  }
  const thr = LAG[d] * MIN;
  const deadline = since + thr;
  // подтверждённый застой: осмотр после дедлайна всё ещё на том же сантиметре
  const confirmed = last.t >= deadline;
  return { d, since, deadline, left: deadline - now, confirmed, overdue: now >= deadline };
}

// Линии бдительности/действия (режим КР РФ): от первой точки ≥5 см, 1 см/ч, действие +4 ч.
export function rfLines(p, now) {
  const s = series(p, 'dil').filter(x => Number(x.v) >= 5);
  if (!s.length) return null;
  const t0 = s[0].t, d0 = Number(s[0].v);
  const last = s[s.length - 1];
  const dl = Number(last.v);
  const alertAt = t0 + (dl - d0) * 60 * MIN;   // когда текущее раскрытие окажется на линии бдительности
  const actionAt = alertAt + 4 * 60 * MIN;
  const expAlert = d0 + (last.t - t0) / (60 * MIN);
  const st = stageOf(p) === 1 && dl < 10;
  return {
    t0, d0, alertAt, actionAt, active: st,
    pastAlert: st && dl < expAlert - 1e-9,
    pastAction: st && dl < expAlert - 4 - 1e-9,
    nowPastAlert: st && now > alertAt + 60 * MIN && dl < 10,
    nowPastAction: st && now > actionAt + 60 * MIN && dl < 10,
  };
}

export function stage2Status(p, now) {
  if (stageOf(p) !== 2) return null;
  const lim = STAGE2_LIMIT[p.parity === 'multi' ? 'multi' : 'nulli'] * MIN;
  const el = now - p.stage2;
  return { elapsed: el, limit: lim, left: lim - el, overdue: el >= lim, warn: el >= lim - 30 * MIN };
}

// Текущие выходы за пороги: последнее значение каждого параметра.
export function currentAlerts(p) {
  const out = [];
  for (const k of Object.keys(PARAMS)) {
    if (!PARAMS[k].alert) continue;
    const lv = lastValue(p, k);
    if (lv && isAlert(k, lv.v)) out.push({ param: k, v: lv.v, t: lv.t, rec: lv.rec });
  }
  return out;
}

export function unplanned(p) {
  return sorted(p).filter(r => recordAlerts(r).length && !(r.plan && r.plan.trim()));
}
