import {
  MIN, PARAMS, GROUPS, GROUP, DEFAULT_INTERVALS, MODE_LABEL, LAG, STAGE2_LIMIT, PLAN_CHIPS,
  hasVal, isAlert, recordAlerts, fmtVal, fmtShort, sorted, series, lastValue, lastOfGroup,
  stageOf, dueList, lagStatus, rfLines, stage2Status, currentAlerts, unplanned,
} from './rules.js';
import {
  db, save, patient, newPatient, addRecord, exportAll, exportPatient, importData, requestPersist, freshSettings,
} from './store.js';

// ---------- утилиты ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const when = t => sameDay(t, Date.now()) ? hm(t) : `${pad(new Date(t).getDate())}.${pad(new Date(t).getMonth() + 1)} ${hm(t)}`;
const dur = ms => { const m = Math.round(Math.abs(ms) / MIN); const h = Math.floor(m / 60); return h ? `${h} ч ${pad(m % 60)} мин` : `${m} мин`; };
const durShort = ms => { const m = Math.round(Math.abs(ms) / MIN); const h = Math.floor(m / 60); return h ? `${h}:${pad(m % 60)}` : `${m}`; };
const durUnit = ms => Math.round(Math.abs(ms) / MIN) >= 60 ? 'ч:мин' : 'мин';
const toLocal = t => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = s => s ? new Date(s).getTime() : null;
const num = s => { if (s === '' || s == null) return ''; const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

const view = $('#view'), topEl = $('#top'), sheet = $('#sheet'), backdrop = $('#sheet-backdrop'), toastEl = $('#toast');
const S = () => db.state.settings;
const IV = () => S().intervals[S().mode];
let sheetCtx = null;
const tabs = {}; // pid -> tab

function toast(msg, kind = '') {
  toastEl.textContent = msg;
  toastEl.className = 'show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.className = ''; }, 2600);
}
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

function parityText(p) {
  const base = p.parity === 'multi' ? 'Повторнородящая' : 'Первородящая';
  return p.paraN ? `${base}, роды ${p.paraN}-е` : base;
}

// ---------- маршруты ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  if (h[0] === 'p' && h[1]) return { name: 'patient', id: h[1] };
  if (h[0] === 'print' && h[1]) return { name: 'print', id: h[1] };
  if (h[0] === 'new') return { name: 'new' };
  if (h[0] === 'settings') return { name: 'settings' };
  return { name: 'board' };
}

function setTop(title, { back = null, right = '' } = {}) {
  topEl.innerHTML = `
    ${back ? `<a class="iconbtn" href="${back}" aria-label="Назад">‹</a>` : '<span class="brand" aria-hidden="true"><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 19 L14 13 L18 17 L24 10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span>'}
    <h1>${esc(title)}</h1>
    <div class="top-right">${right}</div>`;
}

function applyTheme() {
  const t = S().theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function render() {
  applyTheme();
  const r = parseHash();
  document.body.dataset.view = r.name;
  if (r.name === 'patient') { const p = patient(r.id); return p ? renderPatient(p) : (location.hash = '#/'); }
  if (r.name === 'print') { const p = patient(r.id); return p ? renderPrint(p) : (location.hash = '#/'); }
  if (r.name === 'new') return renderNew();
  if (r.name === 'settings') return renderSettings();
  return renderBoard();
}

// ---------- сводка по пациентке ----------
function summary(p, now = Date.now()) {
  const stage = stageOf(p);
  const due = dueList(p, IV(), now);
  const next = due[0] || null;
  const overdue = due.filter(d => d.left <= 0);
  const alerts = currentAlerts(p);
  const unpl = unplanned(p);
  const lag = S().mode === 'who' ? lagStatus(p, now) : null;
  const rf = S().mode === 'rf' ? rfLines(p, now) : null;
  const s2 = stage2Status(p, now);
  const dil = lastValue(p, 'dil');
  let level = 'ok';
  if (overdue.length || (lag && lag.overdue) || (s2 && s2.overdue) || (rf && (rf.pastAction || rf.nowPastAction))) level = 'alert';
  else if (alerts.length || unpl.length || (next && next.left < 5 * MIN) || (lag && lag.left < 30 * MIN) || (s2 && s2.warn) || (rf && (rf.pastAlert || rf.nowPastAlert))) level = 'warn';
  if (alerts.length && level === 'ok') level = 'warn';
  const stageStart = stage === 2 ? p.stage2 : p.active;
  const stageText = stage === 3 ? `Родила в ${when(p.birth)}` : `${stage === 2 ? 'II' : 'I'} период, ${dur(now - stageStart)}`;
  return { stage, due, next, overdue, alerts, unpl, lag, rf, s2, dil, level, stageText };
}

function cd(ms, empty = false) {
  if (empty && ms <= 0) return '<b class="cd-n">сейчас</b><small>нет данных</small>';
  if (ms <= 0 && ms > -MIN) return '<b class="cd-n">сейчас</b><small>пора</small>';
  return `<b class="cd-n">${ms <= 0 ? '−' : ''}${durShort(ms)}</b><small>${ms <= 0 ? 'просрочено, ' : ''}${durUnit(ms)}</small>`; }

// ---------- доска ----------
function renderBoard() {
  const now = Date.now();
  const act = db.state.patients.filter(p => !p.closed);
  const done = db.state.patients.filter(p => p.closed).sort((a, b) => (b.birth || b.created) - (a.birth || a.created));
  const rows = act.map(p => ({ p, s: summary(p, now) }))
    .sort((a, b) => ({ alert: 0, warn: 1, ok: 2 }[a.s.level] - { alert: 0, warn: 1, ok: 2 }[b.s.level]) || ((a.s.next?.due ?? 9e15) - (b.s.next?.due ?? 9e15)));
  setTop('Родзал', { right: `<a class="mode-pill" href="#/settings" title="Режим">${MODE_LABEL[S().mode]}</a><a class="iconbtn" href="#/settings" aria-label="Настройки">⚙</a>` });
  view.innerHTML = `
    <div class="board">
      <a class="btn primary wide big" href="#/new">Добавить роженицу</a>
      ${rows.length ? `<div class="prows">${rows.map(({ p, s }) => boardRow(p, s)).join('')}</div>`
        : `<div class="empty"><p>На доске никого нет.</p><p>Добавьте роженицу, как только диагностированы активные роды — приложение само подскажет, что и когда вносить.</p></div>`}
      ${act.length ? `<button class="btn wide" data-act="shift">Сводка для передачи смены</button>` : ''}
      ${done.length ? `<details class="done"><summary>Завершённые (${done.length})</summary>
        ${done.map(p => `<a class="drow" href="#/p/${p.id}"><span>${esc(p.label || 'Без метки')}</span><small>${p.birth ? 'роды ' + when(p.birth) : 'закрыта'}</small></a>`).join('')}
      </details>` : ''}
      ${installHint()}
    </div>`;
}

function boardRow(p, s) {
  const nx = s.next;
  const flags = [];
  if (s.alerts.length) flags.push(`<span class="flag alert">${s.alerts.map(a => `${PARAMS[a.param].short} <span class="ring">${esc(fmtShort(a.param, a.v))}</span>`).join(', ')}</span>`);
  if (s.lag) flags.push(`<span class="flag ${s.lag.overdue ? 'alert' : s.lag.left < 30 * MIN ? 'warn' : ''}">${s.lag.d} см: застой ${s.lag.overdue ? 'возможен — осмотр' : 'в ' + hm(s.lag.deadline)}</span>`);
  if (s.rf && s.rf.active) flags.push(`<span class="flag ${s.rf.pastAction || s.rf.nowPastAction ? 'alert' : s.rf.pastAlert || s.rf.nowPastAlert ? 'warn' : ''}">${s.rf.pastAction ? 'за линией действия' : s.rf.pastAlert ? 'за линией бдительности' : 'линия бдит. ' + hm(s.rf.alertAt)}</span>`);
  if (s.s2) flags.push(`<span class="flag ${s.s2.overdue ? 'alert' : s.s2.warn ? 'warn' : ''}">II период: предел ${hm(p.stage2 + s.s2.limit)}</span>`);
  if (s.unpl.length) flags.push(`<span class="flag warn">нет плана: ${s.unpl.length}</span>`);
  return `
    <a class="prow lvl-${s.level}" href="#/p/${p.id}">
      <div class="prow-main">
        <div class="prow-label">${esc(p.label || 'Без метки')}</div>
        <div class="prow-meta">${esc(parityText(p))}. ${s.stageText}${s.dil ? `. Раскрытие ${fmtShort('dil', s.dil.v)} см в ${hm(s.dil.t)}` : ''}</div>
        ${flags.length ? `<div class="flags">${flags.join('')}</div>` : ''}
      </div>
      ${nx ? `<div class="prow-next ${nx.left <= 0 ? 'is-over' : nx.left < 5 * MIN ? 'is-soon' : ''}">${cd(nx.left, nx.empty)}<span class="cd-what">${esc(nx.g.label)}${s.overdue.length > 1 ? ` и ещё ${s.overdue.length - 1}` : ''}</span></div>` : ''}
    </a>`;
}

// ---------- новая роженица ----------
function renderNew() {
  setTop('Новая роженица', { back: '#/' });
  const now = toLocal(Date.now());
  view.innerHTML = `
    <form class="form" id="newform">
      <label class="field"><span>Метка</span>
        <input name="label" required placeholder="Палата 3, ИБ 1234" autocomplete="off">
        <small>Без ФИО: данные хранятся только на этом устройстве, но устройство могут увидеть другие.</small></label>
      <fieldset class="field"><legend>Паритет</legend>
        <div class="seg">${radio('parity', 'nulli', 'Первородящая', true)}${radio('parity', 'multi', 'Повторнородящая')}</div></fieldset>
      <label class="field"><span>Роды по счёту</span><input name="paraN" inputmode="numeric" placeholder="необязательно"></label>
      <fieldset class="field"><legend>Начало родов</legend>
        <div class="seg">${radio('onset', 'spont', 'Спонтанное', true)}${radio('onset', 'induced', 'Индуцированное')}</div></fieldset>
      <label class="field"><span>Диагноз активной фазы</span><input type="datetime-local" name="active" value="${now}" required></label>
      <label class="field"><span>Излитие вод</span><input type="datetime-local" name="rom"><small>Пусто — пузырь цел.</small></label>
      <label class="field"><span>Факторы риска</span><textarea name="risks" rows="2" placeholder="например: рубец на матке, ГСД"></textarea></label>
      <button class="btn primary wide big" type="submit">Создать и внести осмотр</button>
    </form>`;
  $('#newform').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const p = newPatient({
      label: f.get('label').trim(), parity: f.get('parity'), paraN: f.get('paraN').trim(), onset: f.get('onset'),
      active: fromLocal(f.get('active')) || Date.now(), rom: fromLocal(f.get('rom')), risks: f.get('risks').trim(),
    });
    requestPersist();
    location.hash = `#/p/${p.id}`;
    setTimeout(() => openEntry(p.id, 've'), 50);
  });
}
function radio(name, val, label, checked) {
  return `<label><input type="radio" name="${name}" value="${val}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
}

// ---------- карта роженицы ----------
function renderPatient(p) {
  const tab = tabs[p.id] || 'now';
  setTop(p.label || 'Без метки', { back: '#/', right: `<span class="mode-pill">${MODE_LABEL[S().mode]}</span>` });
  const T = [['now', 'Сейчас'], ['chart', 'График'], ['log', 'Журнал'], ['card', 'Данные']];
  view.innerHTML = `
    <nav class="tabs" role="tablist">${T.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-act="tab" data-tab="${k}" data-pid="${p.id}">${l}</button>`).join('')}</nav>
    <div class="tabbody">${{ now: tabNow, chart: tabChart, log: tabLog, card: tabCard }[tab](p)}</div>`;
}

function tabNow(p) {
  const now = Date.now();
  const s = summary(p, now);
  const stage = s.stage;
  const lines = [];
  lines.push(`<div class="st-main">${s.stageText}</div>`);
  lines.push(`<div class="st-sub">${esc(parityText(p))}${p.onset === 'induced' ? ', индукция' : ''}. ${p.rom ? `Воды излились ${when(p.rom)} (${dur(now - p.rom)} назад)` : 'Плодный пузырь цел'}.</div>`);
  if (s.lag) {
    const L = s.lag;
    lines.push(`<div class="st-line ${L.overdue ? 'alert' : L.left < 30 * MIN ? 'warn' : ''}">
      ${L.confirmed ? `<b>Застой раскрытия:</b> ${L.d} см не меньше ${dur(LAG[L.d] * MIN)} (порог LCG). Оценка и план.`
      : L.overdue ? `<b>${L.d} см с ${hm(L.since)}</b> — порог застоя ${dur(LAG[L.d] * MIN)} прошёл в ${hm(L.deadline)}. Пора осмотреть.`
      : `<b>${L.d} см с ${hm(L.since)}</b>. Если в ${hm(L.deadline)} раскрытие то же — застой (через ${dur(L.left)}).`}</div>`);
  }
  if (s.rf && s.rf.active) {
    const R = s.rf;
    lines.push(`<div class="st-line ${R.pastAction || R.nowPastAction ? 'alert' : R.pastAlert || R.nowPastAlert ? 'warn' : ''}">
      ${R.pastAction ? '<b>Раскрытие правее линии действия.</b>' : R.pastAlert ? '<b>Раскрытие правее линии бдительности.</b>' : ''}
      Текущее раскрытие на линии бдительности в ${hm(R.alertAt)}, на линии действия — в ${hm(R.actionAt)}.</div>`);
  }
  if (s.s2) {
    lines.push(`<div class="st-line ${s.s2.overdue ? 'alert' : s.s2.warn ? 'warn' : ''}">
      ${s.s2.overdue ? `<b>II период дольше ${dur(s.s2.limit)}</b> (${p.parity === 'multi' ? 'повторнородящая' : 'первородящая'}).`
      : `Предел II периода — ${hm(p.stage2 + s.s2.limit)}, осталось ${dur(s.s2.left)}.`}
      ${p.pushing ? ` Потуги с ${hm(p.pushing)}.` : ''}</div>`);
  }

  const alertsBlock = (s.alerts.length || s.unpl.length) ? `
    <section class="alerts">
      ${s.alerts.length ? `<div class="al-list">${s.alerts.map(a => `<span class="al">${PARAMS[a.param].label} <span class="ring">${esc(fmtShort(a.param, a.v))}</span> <small>${hm(a.t)}</small></span>`).join('')}</div>` : ''}
      ${s.unpl.map(r => `<button class="btn warnbtn wide" data-act="plan" data-pid="${p.id}" data-rec="${r.id}">Внести план: ${recordAlerts(r).map(k => PARAMS[k].short).join(', ')} (${hm(r.t)})</button>`).join('')}
    </section>` : '';

  const tasks = stage === 3 ? '' : `
    <section class="tasks">
      ${s.due.map(d => taskRow(p, d)).join('')}
      ${GROUPS.filter(g => g.noTimer || !s.due.find(d => d.g.id === g.id)).map(g => taskRow(p, { g, last: lastOfGroup(p, g.id), left: null })).join('')}
    </section>`;

  const stageBtns = stage === 1
    ? `<button class="btn wide" data-act="stamp" data-pid="${p.id}" data-field="stage2">Полное раскрытие — II период</button>
       ${!p.rom ? `<button class="btn wide" data-act="stamp" data-pid="${p.id}" data-field="rom">Излитие вод</button>` : ''}`
    : stage === 2
      ? `${!p.pushing ? `<button class="btn wide" data-act="stamp" data-pid="${p.id}" data-field="pushing">Начало потуг</button>` : ''}
         <button class="btn primary wide" data-act="stamp" data-pid="${p.id}" data-field="birth">Ребёнок родился</button>`
      : `<a class="btn wide" href="#/print/${p.id}">Распечатать бланк</a>`;

  return `
    <section class="status lvl-${s.level}">${lines.join('')}</section>
    ${alertsBlock}
    ${tasks}
    <section class="actions">
      <button class="btn wide" data-act="note" data-pid="${p.id}">Оценка и план</button>
      ${stageBtns}
    </section>`;
}

function lastSummary(p, g) {
  const r = lastOfGroup(p, g.id);
  if (!r) return '';
  const parts = g.params.filter(k => hasVal(r.v[k])).map(k => {
    const t = `${PARAMS[k].short} ${esc(fmtShort(k, r.v[k]))}`;
    return isAlert(k, r.v[k]) ? `<span class="ring">${t}</span>` : t;
  });
  return `${parts.join(', ')} <span class="muted">в ${when(r.t)}</span>`;
}

function taskRow(p, d) {
  const lvl = d.left == null ? 'idle' : d.left <= 0 ? 'over' : d.left < 5 * MIN ? 'soon' : 'ok';
  const last = lastSummary(p, d.g);
  return `
    <button class="task t-${lvl}" data-act="entry" data-pid="${p.id}" data-g="${d.g.id}">
      <span class="task-txt">
        <span class="task-name">${esc(d.g.label)}</span>
        <span class="task-last">${last || '<span class="muted">нет записей</span>'}</span>
      </span>
      ${d.left == null ? '<span class="task-due plus">+</span>'
        : `<span class="task-due">${cd(d.left, d.empty)}<small>раз в ${d.interval >= 60 ? d.interval / 60 + ' ч' : d.interval + ' мин'}</small></span>`}
    </button>`;
}

// ---------- графики ----------
function tabChart(p) {
  const now = Date.now();
  const fhr = series(p, 'fhr');
  const lastRows = Object.keys(PARAMS).filter(k => PARAMS[k].kind !== 'text').map(k => ({ k, lv: lastValue(p, k) })).filter(x => x.lv);
  return `
    <section class="chartbox">
      <h2>Раскрытие и опускание</h2>
      <p class="legend"><span class="lg-x">✕ раскрытие, см</span> <span class="lg-o">○ опускание, пятые</span>${S().mode === 'rf' ? ' <span class="lg-a">— линия бдительности</span> <span class="lg-b">- - линия действия</span>' : ' <span class="lg-a">| порог застоя</span>'}</p>
      ${svgDil(p, now)}
    </section>
    <section class="chartbox">
      <h2>ЧСС плода</h2>
      ${fhr.length ? svgFhr(p, now) : '<p class="muted">Пока нет записей ЧСС плода.</p>'}
    </section>
    <section class="chartbox">
      <h2>Последние значения</h2>
      ${lastRows.length ? `<table class="lasttbl">${lastRows.map(({ k, lv }) => `<tr><th>${PARAMS[k].label}</th><td>${isAlert(k, lv.v) ? `<span class="ring">${esc(fmtShort(k, lv.v))}</span>` : esc(fmtVal(k, lv.v))}</td><td class="muted">${when(lv.t)}</td></tr>`).join('')}</table>` : '<p class="muted">Нет данных.</p>'}
    </section>`;
}

function chartFrame(p, now) {
  const t0 = Math.min(p.active || p.created, ...p.records.map(r => r.t));
  const tEnd = Math.max(p.birth || now, ...p.records.map(r => r.t));
  const hours = Math.max(6, Math.ceil((tEnd - t0) / 3600000) + 1);
  return { t0, hours };
}

function svgDil(p, now, { wide = false } = {}) {
  const { t0, hours } = chartFrame(p, now);
  const W = wide ? 900 : 360, H = wide ? 300 : 260, L = 30, R = 10, T = 12, B = 30;
  const x = t => L + (t - t0) / (hours * 3600000) * (W - L - R);
  const y = d => T + (10 - d) / 10 * (H - T - B);
  let g = '';
  for (let d = 0; d <= 10; d++) g += `<line class="${d === 5 ? 'gl5' : 'gl'}" x1="${L}" x2="${W - R}" y1="${y(d)}" y2="${y(d)}"/><text class="ax" x="${L - 6}" y="${y(d) + 4}" text-anchor="end">${d}</text>`;
  const step = hours > 16 ? 2 : 1;
  for (let h = 0; h <= hours; h += step) {
    const tx = x(t0 + h * 3600000);
    g += `<line class="gl" x1="${tx}" x2="${tx}" y1="${T}" y2="${H - B}"/><text class="ax" x="${tx}" y="${H - B + 14}" text-anchor="middle">${hm(t0 + h * 3600000)}</text>`;
  }
  if (S().mode === 'who') {
    const lag = lagStatus(p, now);
    if (lag) g += `<line class="lagline" x1="${x(lag.deadline)}" x2="${x(lag.deadline)}" y1="${T}" y2="${H - B}"/><text class="lagtxt" x="${x(lag.deadline) - 4}" y="${y(lag.d) - 6}" text-anchor="end">${lag.d} см до ${hm(lag.deadline)}</text>`;
  } else {
    const rf = rfLines(p, now);
    if (rf) {
      const tA = rf.t0 + (10 - rf.d0) * 3600000;
      g += `<line class="rfa" x1="${x(rf.t0)}" y1="${y(rf.d0)}" x2="${x(tA)}" y2="${y(10)}"/>`;
      g += `<line class="rfb" x1="${x(rf.t0 + 4 * 3600000)}" y1="${y(rf.d0)}" x2="${x(tA + 4 * 3600000)}" y2="${y(10)}"/>`;
    }
  }
  if (p.stage2) g += `<line class="s2line" x1="${x(p.stage2)}" x2="${x(p.stage2)}" y1="${T}" y2="${H - B}"/><text class="s2txt" x="${x(p.stage2) + 4}" y="${T + 12}">II</text>`;
  g += `<line class="nowline" x1="${x(now)}" x2="${x(now)}" y1="${T}" y2="${H - B}"/>`;
  const dil = series(p, 'dil'), desc = series(p, 'desc');
  if (dil.length > 1) g += `<polyline class="dilline" points="${dil.map(s => `${x(s.t)},${y(Number(s.v))}`).join(' ')}"/>`;
  if (desc.length > 1) g += `<polyline class="descline" points="${desc.map(s => `${x(s.t)},${y(Number(s.v))}`).join(' ')}"/>`;
  dil.forEach(s => { const cx = x(s.t), cy = y(Number(s.v)); g += `<path class="xmark" d="M${cx - 6} ${cy - 6}L${cx + 6} ${cy + 6}M${cx + 6} ${cy - 6}L${cx - 6} ${cy + 6}"/>`; });
  desc.forEach(s => { g += `<circle class="omark" cx="${x(s.t)}" cy="${y(Number(s.v))}" r="6"/>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="График раскрытия и опускания">${g}</svg>`;
}

function svgFhr(p, now, { wide = false } = {}) {
  const { t0, hours } = chartFrame(p, now);
  const W = wide ? 900 : 360, H = wide ? 200 : 200, L = 34, R = 10, T = 10, B = 28;
  const lo = 80, hi = 200;
  const x = t => L + (t - t0) / (hours * 3600000) * (W - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  let g = `<rect class="band" x="${L}" y="${y(160)}" width="${W - L - R}" height="${y(110) - y(160)}"/>`;
  for (let v = lo; v <= hi; v += 20) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const step = hours > 16 ? 2 : 1;
  for (let h = 0; h <= hours; h += step) g += `<text class="ax" x="${x(t0 + h * 3600000)}" y="${H - B + 14}" text-anchor="middle">${hm(t0 + h * 3600000)}</text>`;
  const s = series(p, 'fhr');
  if (s.length > 1) g += `<polyline class="fhrline" points="${s.map(q => `${x(q.t)},${y(Math.max(lo, Math.min(hi, q.v)))}`).join(' ')}"/>`;
  s.forEach(q => { const al = isAlert('fhr', q.v); g += `<circle class="${al ? 'fhrpt-al' : 'fhrpt'}" cx="${x(q.t)}" cy="${y(Math.max(lo, Math.min(hi, q.v)))}" r="${al ? 6 : 3}"/>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="График ЧСС плода">${g}</svg>`;
}

// ---------- журнал ----------
function recLine(r) {
  const g = GROUP[r.g];
  const vals = Object.keys(r.v || {}).filter(k => PARAMS[k] && hasVal(r.v[k])).map(k => {
    const t = `${PARAMS[k].short} ${esc(fmtShort(k, r.v[k]))}`;
    return isAlert(k, r.v[k]) ? `<span class="ring">${t}</span>` : t;
  }).join(', ');
  return { title: g ? g.label : 'Оценка и план', vals };
}

function tabLog(p) {
  const rs = sorted(p).reverse();
  if (!rs.length) return '<div class="empty"><p>Записей пока нет.</p></div>';
  return `<ol class="log">${rs.map(r => {
    const { title, vals } = recLine(r);
    const al = recordAlerts(r).length;
    return `<li class="${al && !r.plan ? 'lg-noplan' : ''}">
      <button class="logbtn" data-act="${r.g === 'note' ? 'plan' : 'edit'}" data-pid="${p.id}" data-rec="${r.id}">
        <span class="lg-time">${when(r.t)}</span>
        <span class="lg-body"><b>${esc(title)}</b>${vals ? `<span>${vals}</span>` : ''}
          ${r.plan ? `<span class="lg-plan">План: ${esc(r.plan)}</span>` : al ? '<span class="lg-plan warn">План не внесён</span>' : ''}</span>
      </button></li>`;
  }).join('')}</ol>`;
}

// ---------- данные ----------
function tabCard(p) {
  const seg = (field, opts) => `<div class="seg">${opts.map(([v, l]) => `<label><input type="radio" name="${field}" data-field="${field}" value="${v}" ${p[field] === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  const dt = (field, label, hint = '') => `<label class="field"><span>${label}</span><input type="datetime-local" data-field="${field}" data-type="dt" value="${toLocal(p[field])}">${hint ? `<small>${hint}</small>` : ''}</label>`;
  return `
    <div class="form">
      <label class="field"><span>Метка</span><input data-field="label" value="${esc(p.label)}" placeholder="Палата 3, ИБ 1234"><small>Без ФИО.</small></label>
      <fieldset class="field"><legend>Паритет</legend>${seg('parity', [['nulli', 'Первородящая'], ['multi', 'Повторнородящая']])}</fieldset>
      <label class="field"><span>Роды по счёту</span><input data-field="paraN" inputmode="numeric" value="${esc(p.paraN)}"></label>
      <fieldset class="field"><legend>Начало родов</legend>${seg('onset', [['spont', 'Спонтанное'], ['induced', 'Индуцированное']])}</fieldset>
      ${dt('active', 'Диагноз активной фазы')}
      ${dt('rom', 'Излитие вод', 'Пусто — пузырь цел.')}
      ${dt('stage2', 'Начало II периода')}
      ${dt('pushing', 'Начало потуг')}
      ${dt('birth', 'Рождение ребёнка')}
      <label class="field"><span>Факторы риска</span><textarea data-field="risks" rows="3">${esc(p.risks)}</textarea></label>
      <a class="btn wide" href="#/print/${p.id}">Распечатать бланк ВОЗ</a>
      <button class="btn wide" data-act="share-p" data-pid="${p.id}">Передать файлом</button>
      <button class="btn wide" data-act="toggle-close" data-pid="${p.id}">${p.closed ? 'Вернуть на доску' : 'Убрать с доски'}</button>
      <button class="btn dangerbtn wide" data-act="del-p" data-pid="${p.id}">Удалить роженицу</button>
    </div>`;
}

// ---------- нижний лист ----------
function openSheet() { sheet.hidden = false; backdrop.hidden = false; document.body.classList.add('sheet-open'); requestAnimationFrame(() => sheet.classList.add('in')); }
function closeSheet() {
  sheetCtx = null; sheet.classList.remove('in'); document.body.classList.remove('sheet-open');
  sheet.hidden = true; backdrop.hidden = true; sheet.innerHTML = '';
  render();
}

function openEntry(pid, gid, recId = null) {
  const p = patient(pid); if (!p) return;
  const g = GROUP[gid];
  let vals = {}, t = Date.now(), tMode = 'now';
  if (recId) {
    const r = p.records.find(r => r.id === recId);
    if (!r) return;
    vals = { ...r.v }; t = r.t; tMode = 'set';
  } else {
    for (const k of g.params) if (PARAMS[k].def) vals[k] = PARAMS[k].def;
  }
  sheetCtx = { type: 'entry', pid, gid, recId, vals, t, tMode };
  renderEntry();
  openSheet();
}

function paramField(k, v) {
  const P = PARAMS[k];
  const al = isAlert(k, v);
  let ctl = '';
  if (P.kind === 'num') {
    ctl = `<div class="num">
        <button type="button" class="stepb" data-act="step" data-p="${k}" data-d="-1" aria-label="Меньше">−</button>
        <input class="numin" data-p="${k}" inputmode="decimal" autocomplete="off" value="${hasVal(v) ? String(v).replace('.', ',') : ''}" placeholder="—" aria-label="${esc(P.label)}">
        <button type="button" class="stepb" data-act="step" data-p="${k}" data-d="1" aria-label="Больше">+</button>
      </div>
      ${P.presets ? `<div class="chips">${P.presets.map(x => `<button type="button" class="chip ${isAlert(k, x) ? 'chip-al' : ''}" aria-pressed="${Number(v) === x}" data-act="set" data-p="${k}" data-v="${x}">${String(x).replace('.', ',')}</button>`).join('')}</div>` : ''}`;
  } else if (P.kind === 'enum' || P.kind === 'yn') {
    ctl = `<div class="chips">${P.opts.map(([val, lab]) => `<button type="button" class="chip ${isAlert(k, val) ? 'chip-al' : ''}" aria-pressed="${v === val}" data-act="set" data-p="${k}" data-v="${esc(val)}">${val === lab ? esc(val) : `<b>${esc(val)}</b> ${esc(lab)}`}</button>`).join('')}</div>`;
  } else {
    ctl = `<input class="textin" data-p="${k}" value="${esc(v ?? '')}" placeholder="—">`;
  }
  return `<div class="pf ${al ? 'is-alert' : ''}" data-pf="${k}">
      <div class="pf-head"><span class="pf-label">${esc(P.label)}${P.unit ? `, ${P.unit}` : ''}</span>${P.thr ? `<span class="thr">порог: ${esc(P.thr)}</span>` : ''}</div>
      ${ctl}</div>`;
}

function renderEntry() {
  const c = sheetCtx, p = patient(c.pid), g = GROUP[c.gid];
  const last = !c.recId ? lastOfGroup(p, g.id) : null;
  const offs = [0, 5, 10, 15, 30];
  const tVal = c.tMode === 'now' ? Date.now() : c.t;
  sheet.innerHTML = `
    <div class="sh-head"><h2>${esc(g.label)}</h2><button class="iconbtn" data-act="close-sheet" aria-label="Закрыть">✕</button></div>
    <div class="sh-body">
      <div class="timebar">
        ${offs.map(o => `<button type="button" class="chip" aria-pressed="${c.tMode === (o ? 'off' + o : 'now')}" data-act="toff" data-o="${o}">${o ? '−' + o + ' мин' : 'Сейчас'}</button>`).join('')}
        <input type="datetime-local" class="tin" value="${toLocal(tVal)}" aria-label="Время записи">
      </div>
      ${last ? `<button type="button" class="btn ghost wide repeat" data-act="repeat">Как в прошлый раз: ${lastSummary(p, g)}</button>` : ''}
      ${g.params.map(k => paramField(k, c.vals[k])).join('')}
    </div>
    <div class="sh-foot">
      <div class="alert-note" id="alnote"></div>
      <div class="foot-row">
        ${c.recId ? `<button class="btn dangerbtn" data-act="del-rec">Удалить</button>` : ''}
        <button class="btn primary big grow" data-act="save-entry">Сохранить</button>
      </div>
    </div>`;
  updateEntryNote();
}

function entryAlerts() {
  const c = sheetCtx;
  return Object.keys(c.vals).filter(k => isAlert(k, typeof c.vals[k] === 'string' && PARAMS[k].kind === 'num' ? num(c.vals[k]) : c.vals[k]));
}
function updateEntryNote() {
  const al = entryAlerts();
  const n = $('#alnote');
  if (!n) return;
  n.innerHTML = al.length ? `За порогом: ${al.map(k => `<b>${PARAMS[k].short}</b>`).join(', ')}. После сохранения — оценка и план.` : '';
  $$('[data-pf]', sheet).forEach(el => el.classList.toggle('is-alert', al.includes(el.dataset.pf)));
  const btn = $('[data-act="save-entry"]', sheet);
  if (btn) btn.textContent = al.length ? 'Сохранить и внести план' : 'Сохранить';
}

function saveEntry() {
  const c = sheetCtx, p = patient(c.pid), g = GROUP[c.gid];
  const v = {};
  for (const k of g.params) {
    let x = c.vals[k];
    if (!hasVal(x)) continue;
    const P = PARAMS[k];
    if (P.kind === 'num') {
      x = num(x);
      if (Number.isNaN(x) || x < P.min || x > P.max) { toast(`${P.label}: проверьте значение (${P.min}–${P.max})`, 'err'); $(`[data-pf="${k}"]`, sheet)?.scrollIntoView({ block: 'center' }); return; }
    }
    if (P.kind === 'text') x = String(x).trim();
    if (hasVal(x)) v[k] = x;
  }
  if (!Object.keys(v).length) { toast('Внесите хотя бы одно значение', 'err'); return; }
  const t = c.tMode === 'now' ? Date.now() : c.t;
  if (t > Date.now() + MIN) { toast('Время записи в будущем', 'err'); return; }
  let rec;
  if (c.recId) { rec = p.records.find(r => r.id === c.recId); rec.v = v; rec.t = t; save(); }
  else rec = addRecord(p, { g: g.id, v, t });
  // полное раскрытие — подсказать II период
  buzz(15);
  const al = recordAlerts(rec);
  if (al.length && !rec.plan) { openPlan(p.id, rec.id); toast('Сохранено. Внесите план.'); return; }
  closeSheet();
  toast('Сохранено');
  if (g.id === 've' && Number(v.dil) === 10 && !p.stage2) setTimeout(() => openStamp(p.id, 'stage2', t), 200);
}

// план к записи (или свободная запись «Оценка и план»)
function openPlan(pid, recId = null) {
  const p = patient(pid);
  const r = recId ? p.records.find(r => r.id === recId) : null;
  sheetCtx = { type: 'plan', pid, recId, text: r ? r.plan || '' : '', t: r ? r.t : Date.now() };
  const al = r ? recordAlerts(r) : [];
  sheet.innerHTML = `
    <div class="sh-head"><h2>Оценка и план</h2><button class="iconbtn" data-act="close-sheet" aria-label="Закрыть">✕</button></div>
    <div class="sh-body">
      ${r && r.g !== 'note' ? `<p class="plan-ctx">${when(r.t)}, ${esc(GROUP[r.g].label)}: ${al.map(k => `${PARAMS[k].label} <span class="ring">${esc(fmtShort(k, r.v[k]))}</span>`).join(', ') || recLine(r).vals}</p>` : ''}
      <div class="chips">${PLAN_CHIPS.map(x => `<button type="button" class="chip" data-act="planchip" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <textarea id="plantext" rows="5" placeholder="Что оценено и что решено">${esc(sheetCtx.text)}</textarea>
    </div>
    <div class="sh-foot"><div class="foot-row">
      ${r && r.g === 'note' ? '<button class="btn dangerbtn" data-act="del-rec">Удалить</button>' : al.length ? '<button class="btn" data-act="close-sheet">Позже</button>' : ''}
      <button class="btn primary big grow" data-act="save-plan">Сохранить план</button></div></div>`;
  if (!sheet.classList.contains('in')) openSheet();
}

function savePlan() {
  const c = sheetCtx, p = patient(c.pid);
  const text = $('#plantext').value.trim();
  if (!text) { toast('План пустой', 'err'); return; }
  if (c.recId) { p.records.find(r => r.id === c.recId).plan = text; save(); }
  else addRecord(p, { g: 'note', v: {}, plan: text });
  buzz(15);
  closeSheet();
  toast('План сохранён');
}

// отметки времени: II период, потуги, рождение, излитие вод
const STAMP = {
  stage2: 'Полное раскрытие — начало II периода',
  pushing: 'Начало потуг',
  birth: 'Ребёнок родился',
  rom: 'Излитие вод',
};
function openStamp(pid, field, t = Date.now()) {
  sheetCtx = { type: 'stamp', pid, field };
  sheet.innerHTML = `
    <div class="sh-head"><h2>${STAMP[field]}</h2><button class="iconbtn" data-act="close-sheet" aria-label="Закрыть">✕</button></div>
    <div class="sh-body">
      <label class="field"><span>Время</span><input type="datetime-local" id="stampt" value="${toLocal(t)}"></label>
      ${field === 'birth' ? '<p class="muted">Карта уйдёт в «Завершённые», её можно открыть и распечатать.</p>' : ''}
      ${field === 'stage2' ? '<p class="muted">Таймеры переключатся на II период: ЧСС плода каждые 5 мин, схватки каждые 15 мин.</p>' : ''}
    </div>
    <div class="sh-foot"><div class="foot-row"><button class="btn primary big grow" data-act="save-stamp">Отметить</button></div></div>`;
  if (!sheet.classList.contains('in')) openSheet();
}
function saveStamp() {
  const c = sheetCtx, p = patient(c.pid);
  const t = fromLocal($('#stampt').value) || Date.now();
  p[c.field] = t;
  if (c.field === 'stage2') {
    const d = lastValue(p, 'dil');
    if (!d || Number(d.v) < 10) p.records.push({ id: Math.random().toString(36).slice(2), t, g: 've', v: { dil: 10 }, plan: '' });
  }
  if (c.field === 'birth') p.closed = true;
  save(); buzz(20);
  closeSheet();
  toast('Отмечено');
}

// сводка смены
function shiftText() {
  const now = Date.now();
  const act = db.state.patients.filter(p => !p.closed);
  const lines = [`Сводка на ${new Date(now).toLocaleDateString('ru-RU')} ${hm(now)} (${MODE_LABEL[S().mode]})`];
  for (const p of act) {
    const s = summary(p, now);
    const bits = [`${p.label || 'Без метки'} — ${parityText(p).toLowerCase()}`, s.stageText];
    if (s.dil) bits.push(`раскрытие ${fmtShort('dil', s.dil.v)} см (${hm(s.dil.t)})`);
    const f = lastValue(p, 'fhr'); if (f) bits.push(`ЧСС плода ${f.v} (${hm(f.t)})`);
    if (p.rom) bits.push(`безводный ${dur(now - p.rom)}`);
    if (s.lag) bits.push(s.lag.overdue ? `застой ${s.lag.d} см — нужен осмотр` : `порог застоя ${hm(s.lag.deadline)}`);
    if (s.s2) bits.push(`предел II периода ${hm(p.stage2 + s.s2.limit)}`);
    if (s.alerts.length) bits.push('за порогом: ' + s.alerts.map(a => `${PARAMS[a.param].short} ${fmtShort(a.param, a.v)}`).join(', '));
    if (s.overdue.length) bits.push('просрочено: ' + s.overdue.map(d => d.g.label).join(', '));
    const plans = sorted(p).filter(r => r.plan).slice(-1)[0];
    if (plans) bits.push(`последний план (${hm(plans.t)}): ${plans.plan}`);
    if (p.risks) bits.push(`риски: ${p.risks}`);
    lines.push('— ' + bits.join('; '));
  }
  return lines.join('\n');
}
function openShift() {
  sheetCtx = { type: 'shift' };
  const txt = shiftText();
  sheet.innerHTML = `
    <div class="sh-head"><h2>Сводка смены</h2><button class="iconbtn" data-act="close-sheet" aria-label="Закрыть">✕</button></div>
    <div class="sh-body"><textarea id="shifttext" rows="12" readonly>${esc(txt)}</textarea></div>
    <div class="sh-foot"><div class="foot-row">
      ${navigator.share ? '<button class="btn" data-act="share-shift">Поделиться</button>' : ''}
      <button class="btn primary big grow" data-act="copy-shift">Скопировать</button></div></div>`;
  openSheet();
}

// ---------- печать ----------
const PRINT_ROWS = [
  ['Поддержка', ['comp', 'pain', 'fluid', 'posture']],
  ['Ребёнок', ['fhr', 'decel', 'af', 'pos', 'caput', 'mould']],
  ['Женщина', ['pulse', 'sys', 'dia', 'temp', 'prot', 'acet']],
  ['Течение родов', ['cfreq', 'cdur', 'dil', 'desc']],
  ['Препараты', ['oxyU', 'oxyD', 'med', 'iv']],
];
function renderPrint(p) {
  const now = Date.now();
  setTop('Бланк для печати', { back: `#/p/${p.id}`, right: '<button class="btn primary" data-act="print">Печать</button>' });
  const t0 = p.active || p.created;
  const endI = p.stage2 || p.birth || Math.max(now, ...p.records.map(r => r.t));
  const slot = 30 * MIN, perPage = 24;
  const pages = Math.max(1, Math.ceil((endI - t0) / (slot * perPage)));
  const rs = sorted(p);
  let html = `<div class="print">
    <div class="pr-head">
      <h2>Партограмма ВОЗ (Labour Care Guide)</h2>
      <table class="pr-id"><tr>
        <td><b>Метка:</b> ${esc(p.label)}</td><td><b>Паритет:</b> ${esc(parityText(p))}</td>
        <td><b>Начало родов:</b> ${p.onset === 'induced' ? 'индуцированное' : 'спонтанное'}</td>
        <td><b>Активная фаза:</b> ${when(t0)}</td><td><b>Излитие вод:</b> ${p.rom ? when(p.rom) : 'пузырь цел'}</td></tr>
        <tr><td colspan="5"><b>Факторы риска:</b> ${esc(p.risks || 'нет')}</td></tr></table>
    </div>`;
  for (let pg = 0; pg < pages; pg++) {
    const ps = t0 + pg * slot * perPage;
    const slots = Array.from({ length: perPage }, (_, i) => ps + i * slot);
    html += `<table class="lcg"><thead><tr><th class="sec"></th><th class="rowh">Время</th>${slots.filter((_, i) => i % 2 === 0).map((s, i) => `<th colspan="2">${pg * 12 + i + 1}-й ч<br><small>${hm(s)}</small></th>`).join('')}</tr></thead><tbody>`;
    for (const [secName, keys] of PRINT_ROWS) {
      keys.forEach((k, ki) => {
        html += `<tr>${ki === 0 ? `<th class="sec" rowspan="${keys.length}">${secName}</th>` : ''}<th class="rowh">${PARAMS[k].label}${PARAMS[k].thr ? `<small>${esc(PARAMS[k].thr)}</small>` : ''}</th>`;
        slots.forEach(s => {
          const inSlot = rs.filter(r => r.t >= s && r.t < s + slot && r.v && hasVal(r.v[k]) && (!p.stage2 || r.t < p.stage2));
          const v = inSlot.length ? inSlot[inSlot.length - 1].v[k] : null;
          html += `<td>${v == null ? '' : isAlert(k, v) ? `<span class="ring">${esc(fmtShort(k, v))}</span>` : esc(fmtShort(k, v))}</td>`;
        });
        html += '</tr>';
      });
    }
    html += `</tbody></table>`;
  }
  html += `<div class="pr-chart"><h3>Раскрытие (✕) и опускание (○)</h3>${svgDil(p, now, { wide: true })}</div>`;
  if (p.stage2) {
    const s2 = rs.filter(r => r.t >= p.stage2 && r.g !== 'note');
    html += `<h3>II период: начало ${when(p.stage2)}${p.pushing ? `, потуги с ${hm(p.pushing)}` : ''}${p.birth ? `, рождение ${when(p.birth)}` : ''}</h3>
      <table class="pr-log">${s2.map(r => { const { title, vals } = recLine(r); return `<tr><td>${hm(r.t)}</td><td>${esc(title)}</td><td>${vals}</td></tr>`; }).join('') || '<tr><td>Нет записей</td></tr>'}</table>`;
  }
  const plans = rs.filter(r => r.plan);
  html += `<h3>Оценка и план</h3><table class="pr-log">${plans.map(r => { const { title, vals } = recLine(r); return `<tr><td>${when(r.t)}</td><td>${r.g === 'note' ? '' : esc(title) + ': ' + vals}</td><td>${esc(r.plan)}</td></tr>`; }).join('') || '<tr><td>Нет записей</td></tr>'}</table>
    <p class="pr-foot">Режим: ${MODE_LABEL[S().mode]}. Сформировано ${new Date(now).toLocaleString('ru-RU')}. Подпись врача: ____________________</p></div>`;
  view.innerHTML = html;
}

// ---------- настройки ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (parseHash().name !== 'patient') render(); });
function installHint() {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '';
  if (installEvt) return `<button class="btn ghost wide" data-act="install">Установить на главный экран</button>`;
  if (/iPhone|iPad/.test(navigator.userAgent)) return `<p class="hint">Чтобы работало как приложение: «Поделиться» → «На экран „Домой“».</p>`;
  return '';
}

function renderSettings() {
  setTop('Настройки', { back: '#/' });
  const st = S();
  const ivRows = GROUPS.filter(g => !g.noTimer).map(g => `<tr><th>${g.label}</th>${[1, 2].map(s => `<td><input class="ivin" inputmode="numeric" data-iv="${st.mode}.${s}.${g.id}" value="${st.intervals[st.mode][s][g.id]}" aria-label="${g.label}, ${s === 1 ? 'I' : 'II'} период, минуты"></td>`).join('')}</tr>`).join('');
  const notif = 'Notification' in window ? Notification.permission : 'unsupported';
  view.innerHTML = `
    <div class="form">
      <fieldset class="field"><legend>Режим</legend>
        <div class="seg">${[['who', 'ВОЗ LCG'], ['rf', 'КР РФ']].map(([v, l]) => `<label><input type="radio" name="mode" data-set="mode" value="${v}" ${st.mode === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <small>${st.mode === 'who' ? 'Застой раскрытия по времени на сантиметре (5 см — 6 ч, 6 — 5 ч, 7 — 3 ч, 8 — 2,5 ч, 9 — 2 ч). Пульс, АД, t° раз в 4 ч.' : 'Линии бдительности и действия от первой точки ≥5 см. Пульс, АД, t° ежечасно.'} Пороги ALERT одинаковые.</small>
      </fieldset>
      <fieldset class="field"><legend>Периодичность (${MODE_LABEL[st.mode]}), минуты</legend>
        <table class="ivtbl"><thead><tr><th></th><th>I период</th><th>II период</th></tr></thead><tbody>${ivRows}</tbody></table>
        <small>0 — без таймера.</small>
        <button class="btn" data-act="reset-iv">Вернуть по умолчанию</button>
      </fieldset>
      <fieldset class="field"><legend>Оформление</legend>
        <div class="seg">${[['auto', 'Как в системе'], ['light', 'Светлое'], ['dark', 'Тёмное']].map(([v, l]) => `<label><input type="radio" name="theme" data-set="theme" value="${v}" ${st.theme === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      </fieldset>
      <fieldset class="field"><legend>Сигналы</legend>
        <label class="toggle"><input type="checkbox" data-set="sound" ${st.sound ? 'checked' : ''}><span>Звук и вибрация при просрочке</span></label>
        <button class="btn" data-act="test-beep">Проверить звук</button>
        <label class="toggle"><input type="checkbox" data-set="wake" ${st.wake ? 'checked' : ''}><span>Не гасить экран (планшет на посту)</span></label>
        ${notif === 'default' ? '<button class="btn" data-act="notif">Разрешить уведомления</button>' : notif === 'granted' ? '<small>Уведомления разрешены.</small>' : notif === 'denied' ? '<small>Уведомления запрещены в браузере.</small>' : ''}
        <small>Сигнал гарантирован, пока приложение открыто. В фоне браузер может приостановить таймеры, особенно на iPhone.</small>
      </fieldset>
      <fieldset class="field"><legend>Данные</legend>
        <button class="btn" data-act="backup">Сохранить резервную копию</button>
        <label class="btn filebtn">Восстановить из файла<input type="file" accept=".json,application/json" data-act-file="import" hidden></label>
        <small>Всё хранится только на этом устройстве. Передать роженицу на другое устройство — «Данные» → «Передать файлом», на другом устройстве — «Восстановить из файла».</small>
      </fieldset>
      ${installHint()}
      <section class="about">
        <p>Рабочий инструмент для ведения партограммы; юридическим документом остаётся бланк в истории родов. Пороги — по WHO Labour Care Guide (2020) и руководству ЕРБ ВОЗ 2022. Решения принимает врач.</p>
      </section>
    </div>`;
}

// ---------- сигналы ----------
let audioCtx = null;
function unlockAudio() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {} }
function beep() {
  if (!S().sound) return;
  buzz([200, 100, 200]);
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [0, 0.25, 0.5].forEach(o => {
    const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
    osc.frequency.value = 880; osc.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.0001, t + o); g.gain.exponentialRampToValueAtTime(0.4, t + o + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + o + 0.18);
    osc.start(t + o); osc.stop(t + o + 0.2);
  });
}
const notified = new Set();
let seeded = false;
function checkAlarms() {
  const now = Date.now();
  const fresh = [];
  for (const p of db.state.patients.filter(p => !p.closed)) {
    for (const d of dueList(p, IV(), now)) if (d.left <= 0) {
      const key = `${p.id}:${d.g.id}:${d.due}`;
      if (!notified.has(key)) { notified.add(key); fresh.push(`${p.label || 'Без метки'}: ${d.g.label}`); }
    }
    const lag = S().mode === 'who' ? lagStatus(p, now) : null;
    if (lag && lag.overdue) { const key = `${p.id}:lag:${lag.deadline}`; if (!notified.has(key)) { notified.add(key); fresh.push(`${p.label}: порог застоя ${lag.d} см`); } }
    const s2 = stage2Status(p, now);
    if (s2 && s2.overdue) { const key = `${p.id}:s2`; if (!notified.has(key)) { notified.add(key); fresh.push(`${p.label}: предел II периода`); } }
  }
  if (!seeded) { seeded = true; return; }
  if (!fresh.length) return;
  beep();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then(reg => reg.showNotification('Партограмма: пора внести', { body: fresh.join('\n'), tag: 'due', renotify: true, icon: 'icons/icon-192.png' })).catch(() => {});
  }
}

let wakeLock = null;
async function syncWake() {
  try {
    if (S().wake && 'wakeLock' in navigator && document.visibilityState === 'visible') { if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } }
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}

// ---------- файлы ----------
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function shareFile(name, text) {
  try {
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  download(name, text);
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; };

// ---------- события ----------
document.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act, pid = el.dataset.pid;
  const c = sheetCtx;
  switch (a) {
    case 'tab': tabs[pid] = el.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'entry': openEntry(pid, el.dataset.g); break;
    case 'edit': { const p = patient(pid); const r = p.records.find(r => r.id === el.dataset.rec); if (r) openEntry(pid, r.g, r.id); break; }
    case 'plan': openPlan(pid, el.dataset.rec); break;
    case 'note': openPlan(pid, null); break;
    case 'stamp': openStamp(pid, el.dataset.field); break;
    case 'close-sheet': closeSheet(); break;
    case 'set': {
      const k = el.dataset.p, P = PARAMS[k];
      let v = P.kind === 'num' ? Number(el.dataset.v) : el.dataset.v;
      if (P.kind !== 'num' && c.vals[k] === v) v = ''; // повторный тап снимает выбор
      c.vals[k] = v; rerenderField(k); break;
    }
    case 'step': {
      const k = el.dataset.p, P = PARAMS[k];
      let cur = num(c.vals[k]);
      if (cur === '' || Number.isNaN(cur)) { const lv = lastValue(patient(c.pid), k); cur = lv ? Number(lv.v) : P.presets ? P.presets[Math.floor(P.presets.length / 2)] : P.min; }
      else cur = cur + Number(el.dataset.d) * P.step;
      cur = Math.min(P.max, Math.max(P.min, Math.round(cur * 10) / 10));
      c.vals[k] = cur; rerenderField(k); break;
    }
    case 'toff': { const o = Number(el.dataset.o); c.tMode = o ? 'off' + o : 'now'; c.t = Date.now() - o * MIN; renderEntry(); break; }
    case 'repeat': { const r = lastOfGroup(patient(c.pid), c.gid); if (r) { c.vals = { ...r.v }; renderEntry(); } break; }
    case 'save-entry': saveEntry(); break;
    case 'del-rec': {
      if (!confirm('Удалить запись?')) break;
      const p = patient(c.pid); p.records = p.records.filter(r => r.id !== c.recId); save(); closeSheet(); toast('Запись удалена'); break;
    }
    case 'planchip': { const ta = $('#plantext'); const v = el.dataset.v; ta.value = ta.value.trim() ? ta.value.trim().replace(/[.;]?$/, '; ') + v : v; ta.focus(); break; }
    case 'save-plan': savePlan(); break;
    case 'save-stamp': saveStamp(); break;
    case 'shift': openShift(); break;
    case 'copy-shift': {
      const ta = $('#shifttext');
      try { await navigator.clipboard.writeText(ta.value); toast('Скопировано'); } catch (err) { ta.removeAttribute('readonly'); ta.select(); document.execCommand('copy'); toast('Скопировано'); }
      break;
    }
    case 'share-shift': try { await navigator.share({ text: $('#shifttext').value }); } catch (err) {} break;
    case 'share-p': { const p = patient(pid); await shareFile(`partogramma-${(p.label || 'rozhenitsa').replace(/[^\wа-яё-]+/gi, '_')}-${stamp()}.json`, exportPatient(p)); break; }
    case 'toggle-close': { const p = patient(pid); p.closed = !p.closed; save(); toast(p.closed ? 'Убрана с доски' : 'Возвращена на доску'); render(); break; }
    case 'del-p': {
      const p = patient(pid);
      if (!confirm(`Удалить «${p.label || 'Без метки'}» со всеми записями? Отменить нельзя.`)) break;
      db.state.patients = db.state.patients.filter(x => x.id !== pid); save(); location.hash = '#/'; toast('Удалено'); break;
    }
    case 'print': window.print(); break;
    case 'reset-iv': S().intervals[S().mode] = JSON.parse(JSON.stringify(DEFAULT_INTERVALS[S().mode])); save(); render(); toast('Периодичность сброшена'); break;
    case 'test-beep': { unlockAudio(); const was = S().sound; S().sound = true; setTimeout(() => { beep(); S().sound = was; }, 50); break; }
    case 'notif': try { await Notification.requestPermission(); } catch (err) {} render(); break;
    case 'backup': download(`partogramma-backup-${stamp()}.json`, exportAll()); break;
    case 'install': if (installEvt) { installEvt.prompt(); installEvt = null; render(); } break;
  }
});

function rerenderField(k) {
  const el = $(`[data-pf="${k}"]`, sheet);
  if (el) el.outerHTML = paramField(k, sheetCtx.vals[k]);
  updateEntryNote();
}

document.addEventListener('input', e => {
  const t = e.target;
  if (sheetCtx && sheetCtx.type === 'entry') {
    if (t.matches('.numin, .textin')) {
      sheetCtx.vals[t.dataset.p] = t.value;
      const k = t.dataset.p;
      $$(`[data-pf="${k}"] .chip`, sheet).forEach(ch => ch.setAttribute('aria-pressed', String(Number(ch.dataset.v) === num(t.value))));
      updateEntryNote();
    }
    if (t.matches('.tin')) { sheetCtx.t = fromLocal(t.value) || Date.now(); sheetCtx.tMode = 'set'; $$('.timebar .chip', sheet).forEach(ch => ch.setAttribute('aria-pressed', 'false')); }
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  // поля карты роженицы
  if (t.dataset.field && parseHash().name === 'patient') {
    const p = patient(parseHash().id);
    const f = t.dataset.field;
    let v = t.type === 'radio' ? t.value : t.value;
    if (t.dataset.type === 'dt') v = fromLocal(v);
    if (f === 'label' || f === 'risks' || f === 'paraN') v = String(v).trim();
    p[f] = v;
    if (f === 'birth') p.closed = !!v;
    save(); toast('Сохранено');
    if (f === 'label') setTop(p.label || 'Без метки', { back: '#/', right: `<span class="mode-pill">${MODE_LABEL[S().mode]}</span>` });
  }
  // настройки
  if (t.dataset.set) {
    const k = t.dataset.set;
    S()[k] = t.type === 'checkbox' ? t.checked : t.value;
    save();
    if (k === 'wake') syncWake();
    if (k === 'mode' || k === 'theme') render();
  }
  if (t.dataset.iv) {
    const [m, s, g] = t.dataset.iv.split('.');
    const n = Math.max(0, Math.round(Number(t.value) || 0));
    S().intervals[m][s][g] = n; t.value = n; save(); toast('Сохранено');
  }
  if (t.dataset.actFile === 'import' && t.files[0]) {
    try {
      const text = await t.files[0].text();
      const r = importData(text, { withSettings: confirm('Восстановить и настройки из файла? «Отмена» — только роженицы.') });
      toast(`Добавлено: ${r.added}, обновлено: ${r.updated}`);
      render();
    } catch (err) { toast('Не удалось прочитать файл: ' + err.message, 'err'); }
    t.value = '';
  }
});

backdrop.addEventListener('click', () => { if (sheetCtx && sheetCtx.type === 'entry' && Object.keys(sheetCtx.vals).some(k => hasVal(sheetCtx.vals[k]) && !PARAMS[k].def) && !confirm('Закрыть без сохранения?')) return; closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetCtx) closeSheet(); });

window.addEventListener('hashchange', () => { if (sheetCtx) { sheetCtx = null; sheet.hidden = true; backdrop.hidden = true; sheet.innerHTML = ''; document.body.classList.remove('sheet-open'); } render(); });
document.addEventListener('visibilitychange', () => { syncWake(); if (!document.hidden) tick(); });

function tick() {
  checkAlarms();
  const a = document.activeElement;
  const typing = a && view.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
  const name = parseHash().name;
  if (!sheetCtx && !typing && (name === 'board' || (name === 'patient' && (tabs[parseHash().id] || 'now') === 'now'))) render();
}

// ---------- старт ----------
render();
syncWake();
checkAlarms();
setInterval(tick, 15000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
