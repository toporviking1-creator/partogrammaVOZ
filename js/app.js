import { PARAMS, ROWS, ROWS_PLAN, SPAN, UNIT_MIN, cellsIn, PLAN_CHIPS, hasVal, isAlert, fmt, lagAlerts } from './rules.js';
import { db, save, blank, newBlank, removeBlank, exportBlank, importBlanks } from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const MIN = 60000;
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dmy = t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const toLocal = t => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = s => s ? new Date(s).getTime() : null;
const title = b => b.hist ? `№ ${b.hist}` : (b.fio || 'Без метки');

const view = $('#view'), topEl = $('#top'), sheet = $('#sheet'), backdrop = $('#sheet-backdrop'), toastEl = $('#toast');
let pick = null; // { bid, stage, k, step, idx }

function toast(msg) {
  toastEl.textContent = msg; toastEl.className = 'show';
  clearTimeout(toast.t); toast.t = setTimeout(() => { toastEl.className = ''; }, 2200);
}
const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} };
const route = () => { const h = location.hash.replace(/^#\/?/, '').split('/'); return h[0] === 'b' && h[1] ? { name: 'blank', id: h[1] } : { name: 'list' }; };

function render() {
  const r = route();
  if (r.name === 'blank') { const b = blank(r.id); if (b) return renderBlank(b); location.hash = '#/'; return; }
  renderList();
}

// ---------- список ----------
function renderList() {
  topEl.innerHTML = `<span class="brand" aria-hidden="true"><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 19 L14 13 L18 17 L24 10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span><h1>Партограмма ВОЗ</h1>`;
  const bs = db.state.blanks;
  view.innerHTML = `
    <div class="list">
      <button class="btn primary big wide" data-act="new">Новый бланк</button>
      ${bs.length ? bs.map(b => `
        <a class="lrow" href="#/b/${b.id}">
          <span><b>${esc(title(b))}</b><small>${esc(b.fio && b.hist ? b.fio + ', ' : '')}активная фаза с ${dmy(b.start)} ${hm(b.start)}</small></span>
          <span class="lcount">${Object.values(b.cells).filter(hasVal).length}<small>клеток</small></span>
        </a>`).join('')
      : '<p class="empty">Бланков пока нет. «Новый бланк» откроет партограмму отделения — заполняйте её тапами по клеткам.</p>'}
      <label class="btn wide">Открыть файл бланка<input type="file" accept=".json,application/json" data-file="import" hidden></label>
      ${installHint()}
      <p class="note">Данные хранятся только на этом устройстве и никуда не отправляются.</p>
    </div>`;
}

let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (route().name === 'list') render(); });
function installHint() {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '';
  if (installEvt) return '<button class="btn wide" data-act="install">Установить на главный экран</button>';
  if (/iPhone|iPad/.test(navigator.userAgent)) return '<p class="note">Как приложение: «Поделиться» → «На экран „Домой“».</p>';
  return '';
}

// ---------- таблица бланка ----------
function cellLabel(b, stage, step, idx) {
  if (stage === 1) {
    const t = b.start + idx * SPAN[step] * UNIT_MIN[1] * MIN;
    return `${Math.floor(idx * SPAN[step] / 2) + 1}-й час, ${hm(t)}`;
  }
  return `II период, ${hm(b.s2start + idx * SPAN[step] * UNIT_MIN[2] * MIN)}`;
}

function cellHTML(k, v, ring = false) {
  if (!hasVal(v)) return '';
  const t = (PARAMS[k].kind === 'text' || PARAMS[k].kind === 'phrase') ? `<span class="txt">${esc(v)}</span>` : esc(fmt(v));
  return isAlert(k, v) || ring ? `<span class="ring">${t}</span>` : t;
}

const COLS = `<colgroup><col class="c-sec"><col class="c-lab"><col class="c-thr">${'<col class="c-u1">'.repeat(24)}<col class="c-gap">${'<col class="c-u2">'.repeat(12)}</colgroup>`;
const GAP = '<td class="gap"></td>';

function rowCells(b, k, step1, step2) {
  let h = '';
  for (let i = 0; i < cellsIn(1, step1); i++) {
    h += `<td colspan="${SPAN[step1]}"><button class="cell" data-cell="1:${k}:${step1}:${i}">${cellHTML(k, b.cells[`1:${k}:${i}`])}</button></td>`;
  }
  h += GAP;
  if (!step2) return h + '<td colspan="12" class="na"></td>';
  for (let i = 0; i < cellsIn(2, step2); i++) {
    h += `<td colspan="${SPAN[step2]}"><button class="cell c2 ${b.s2start ? '' : 'off'}" data-cell="2:${k}:${step2}:${i}">${cellHTML(k, b.cells[`2:${k}:${i}`])}</button></td>`;
  }
  return h;
}

function gridRows(b, k, secTh) {
  const P = PARAMS[k];
  const lag = k === 'dil' ? lagAlerts(b.cells) : new Set();
  let h = '';
  P.grid.forEach((cm, gi) => {
    h += `<tr class="grow${gi === 0 ? ' gtop' : ''}">${gi === 0 ? secTh : ''}${gi === 0 ? `<th class="lab" rowspan="${P.grid.length}"><span>${P.label}</span></th>` : ''}`;
    h += `<td class="thr gthr"><b>${cm}</b>${P.gridThr && P.gridThr[cm] ? ` <span>${P.gridThr[cm]}</span>` : ''}</td>`;
    for (let i = 0; i < 12; i++) {
      const v = b.cells[`1:${k}:${i}`];
      const on = hasVal(v) && Number(v) === cm;
      const mark = on ? (k === 'dil' ? (lag.has(i) ? '<span class="ring">✕</span>' : '✕') : '○') : '';
      h += `<td colspan="2" class="gc"><button class="cell gbtn" data-grid="1:${k}:${i}:${cm}" aria-label="${cm}, ${i + 1}-й час">${mark}</button></td>`;
    }
    h += GAP;
    if (k === 'dil') {
      if (cm === 10) {
        for (let i = 0; i < 12; i++) h += `<td class="gc"><button class="cell gbtn ${b.s2start ? '' : 'off'}" data-mark="2:push:${i}" aria-label="Начало потуг, ${i + 1}">${b.cells[`2:push:${i}`] ? 'P' : ''}</button></td>`;
      } else if (cm === 9) {
        h += `<td colspan="12" rowspan="5" class="note2">X — раскрытие в I периоде; ✕ обводится, если время ожидания на сантиметре превышено. P — начало потуг во II периоде (строка 10).</td>`;
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const v = b.cells[`2:${k}:${i}`];
        h += `<td colspan="2" class="gc"><button class="cell gbtn ${b.s2start ? '' : 'off'}" data-grid="2:${k}:${i}:${cm}" aria-label="${cm}, II период">${hasVal(v) && Number(v) === cm ? '○' : ''}</button></td>`;
      }
    }
    h += '</tr>';
  });
  return h;
}

function bodyRows(b, defs) {
  let h = '';
  for (const [sec, rows] of defs) {
    const n = rows.reduce((a, [k]) => a + (PARAMS[k].kind === 'grid' ? PARAMS[k].grid.length : 1), 0);
    let first = true;
    for (const [k, s1, s2] of rows) {
      const P = PARAMS[k];
      const secTh = first ? `<th class="sec${sec ? '' : ' nosec'}" rowspan="${n}"><span>${sec}</span></th>` : '';
      first = false;
      if (P.kind === 'grid') { h += gridRows(b, k, secTh); continue; }
      h += `<tr class="r-${k}${P.kind === 'phrase' ? ' r-phrase' : ''}">${secTh}<th class="lab"><span>${P.label}</span></th><td class="thr">${esc(P.thr || '')}</td>${rowCells(b, k, s1, s2)}</tr>`;
    }
  }
  return h;
}

function mainTable(b) {
  const t1 = Array.from({ length: 12 }, (_, i) => `<th colspan="2" class="tm">${hm(b.start + i * 60 * MIN)}</th>`).join('');
  const t2 = Array.from({ length: 3 }, (_, i) => `<th colspan="4" class="tm">${b.s2start ? hm(b.s2start + i * 60 * MIN) : ':'}</th>`).join('');
  const h1 = Array.from({ length: 12 }, (_, i) => `<th colspan="2" class="hr">${i + 1}</th>`).join('');
  const h2 = Array.from({ length: 3 }, (_, i) => `<th colspan="4" class="hr">${i + 1}</th>`).join('');
  return `<table class="lcg">${COLS}<thead>
      <tr><th class="c0" colspan="2">Время</th><th class="thr"></th>${t1}<th class="gap"></th>${t2}</tr>
      <tr><th class="c0" colspan="2">Часы</th><th class="thr"></th>${h1}<th class="gap"></th>${h2}</tr>
      <tr class="phase"><th class="c0" colspan="2"></th><th class="thr crit">Критические показатели</th><th colspan="24">← Активная фаза первого периода →</th><th class="gap"></th><th colspan="12">← Второй период →</th></tr>
    </thead><tbody>${bodyRows(b, ROWS)}</tbody></table>`;
}
function planTable(b) {
  return `<table class="lcg plan">${COLS}<tbody>${bodyRows(b, ROWS_PLAN)}</tbody></table>`;
}

// ---------- роды: эпизиотомия, ребёнок ----------
function seg(name, val, opts) {
  return `<div class="seg">${opts.map(o => `<button type="button" class="segb" aria-pressed="${val === o}" data-bset="${name}" data-v="${o}">${o}</button>`).join('')}</div>`;
}
function birthBlock(b) {
  const B = b.birth;
  const kid = (i, k) => `
    <div class="kid">
      <div class="kid-h">${i === 0 ? 'Ребёнок первый' : 'Ребёнок второй'}</div>
      <div class="kgrid">
        <label class="f"><span>Дата рождения</span><input type="date" data-kid="${i}.date" value="${esc(k.date || '')}"></label>
        <label class="f"><span>Время рождения</span><input type="time" data-kid="${i}.time" value="${esc(k.time || '')}"></label>
        <div class="f"><span>Пол</span>${seg(`${i}.sex`, k.sex, ['М', 'Ж'])}</div>
        <div class="f"><span>Состояние при рождении</span>${seg(`${i}.state`, k.state, ['живой', 'мёртвый'])}</div>
        <div class="f"><span>Первичная реанимация</span>${seg(`${i}.res`, k.res, ['да', 'нет'])}</div>
        <label class="f"><span>Апгар 1 мин</span><select data-kid="${i}.a1"><option></option>${Array.from({ length: 11 }, (_, n) => `<option ${String(k.a1) === String(n) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f"><span>Апгар 5 мин</span><select data-kid="${i}.a5"><option></option>${Array.from({ length: 11 }, (_, n) => `<option ${String(k.a5) === String(n) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
    </div>`;
  const k2 = B.kids[1] || {};
  return `
    <section class="birth no-pr">
      <div class="epi"><span class="epi-l">Эпизиотомия</span>${seg('epi', B.epi, ['да', 'нет'])}
        ${B.epi === 'да' ? `<label class="f grow1"><span>Причина</span><input data-birth="epiWhy" value="${esc(B.epiWhy)}"></label>` : ''}</div>
      ${kid(0, B.kids[0] || {})}
      <details class="kid2" ${Object.values(k2).some(hasVal) ? 'open' : ''}><summary>Второй ребёнок (двойня)</summary>${kid(1, k2)}</details>
    </section>
    <section class="pr-only pr-birth">
      <p><b>Эпизиотомия</b> ${B.epi ? `<u>${esc(B.epi)}</u>` : 'да / нет'} ${B.epi === 'да' ? `<i>Причина:</i> ${esc(B.epiWhy)}` : '<i>Если да, то указать причину:</i>'}</p>
      <table class="kidtbl"><tr><th>Ребенок</th><th>Дата рождения</th><th>Время рождения</th><th>Пол</th><th>Состояние при рождении</th><th>Первичная реанимация</th><th>Апгар 1 мин</th><th>Апгар 5 мин</th></tr>
      ${[0, 1].map(i => { const k = B.kids[i] || {}; return `<tr><td>${i ? 'второй' : 'первый'}</td><td>${k.date ? k.date.split('-').reverse().join('.') : ''}</td><td>${esc(k.time || '')}</td><td>${esc(k.sex || '')}</td><td>${esc(k.state || '')}</td><td>${esc(k.res || '')}</td><td>${esc(k.a1 ?? '')}</td><td>${esc(k.a5 ?? '')}</td></tr>`; }).join('')}</table>
    </section>`;
}

// ---------- оборот: лист наблюдения акушерки после родов ----------
const BACK_ROWS = [
  ['Жалобы', [['Есть', 'r'], ['Нет', 'g']]],
  ['Неврологический ответ (реакция только на….)', [['боль или нет реакции', 'r'], ['громкий голос', 'y'], ['обычный голос', 'g']]],
  ['Температура', [['≥38', 'r'], ['37.5 - 37.9', 'y'], ['36 - 37.4', 'g'], ['35 - 35.9', 'y'], ['<35', 'r']]],
  ['Пульс', [['≥120', 'r'], ['100 - 119', 'y'], ['51 - 99', 'g'], ['40-50', 'y'], ['<40', 'r']]],
  ['Систолическое АД', [['≥160', 'r'], ['140 - 159', 'y'], ['100 - 139', 'g'], ['90 -99', 'y'], ['<90', 'r']]],
  ['Диастолическое АД', [['≥110', 'r'], ['90 - 109', 'y'], ['50 - 89', 'g'], ['<50', 'r']]],
  ['Тонус матки', [['Расслабляется', 'r'], ['Плотная', 'g']]],
  ['Выделения (объем)', [['Обильные, алые', 'r'], ['Нормальный', 'g']]],
];
const BACK_COLS = ['15 мин', '30 мин', '45 мин', '1 час', '1 ч 15', '1 ч 30', '1 ч 45', '2 часа'];

function backSide(b) {
  const k = (b.birth && b.birth.kids && b.birth.kids[0]) || {};
  const bd = k.date ? k.date.split('-').reverse().join('.') : '';
  let birthT = null;
  if (k.date && k.time) birthT = new Date(`${k.date}T${k.time}`).getTime();
  const cur = BACK_COLS.map((_, i) => birthT ? hm(birthT + (i + 1) * 15 * MIN) : '');
  const empty8 = cls => BACK_COLS.map(() => `<td class="${cls}"></td>`).join('');
  let rows = '';
  for (const [name, subs] of BACK_ROWS) {
    subs.forEach(([sub, c], i) => {
      rows += `<tr>${i === 0 ? `<th class="bk-name" rowspan="${subs.length}">${esc(name)}</th>` : ''}<th class="bk-sub">${esc(sub)}</th>${empty8('bk-' + c)}</tr>`;
    });
  }
  return `
  <section class="pr-only pr-back">
    <div class="bk-line"><b>Ф.И.О.</b><u>${esc(b.fio)}</u><b>дата рождения</b><u class="sh"></u><b>палата №</b><u class="xs"></u></div>
    <table class="bk">
      <colgroup><col class="bk-c1"><col class="bk-c2">${BACK_COLS.map(() => '<col>').join('')}</colgroup>
      <tr><th colspan="2" class="bk-dt"><div><b>Дата родов:</b> <u>${esc(bd)}</u></div><div><b>Время родов:</b> <u>${esc(k.time || '')}</u></div></th>
        <th colspan="8" class="bk-note">Только зеленые - рутинное наблюдение. 1 желтый - переоценка через 30 минут, если сохраняется, уведомить доктора.<br>2 желтых или 1 красный или более - немедленный вызов доктора.</th></tr>
      <tr><th colspan="2" class="bk-h">Время с момента родов</th>${BACK_COLS.map(x => `<th class="bk-h">${x}</th>`).join('')}</tr>
      <tr><th colspan="2" class="bk-h">Текущее время</th>${cur.map(x => `<td class="bk-t">${x}</td>`).join('')}</tr>
      ${rows}
      <tr><th colspan="2" class="bk-h">Подпись</th>${empty8('')}</tr>
    </table>
    <h3 class="bl-h">Подсчет кровопотери</h3>
    <p class="bl-p">Марлевые шарики: посчитано до <u class="xs"></u> посчитано после <u class="xs"></u></p>
    <table class="bl">
      <tr><th></th><th>Вес</th><th>Кол-во использованных</th><th>Вес без вычета</th><th>Вес с вычетом</th></tr>
      <tr><td>Марлевые шарики</td><td>5 гр</td><td></td><td></td><td></td></tr>
      <tr><td>Впитывающая пеленка</td><td>50 гр.</td><td></td><td></td><td></td></tr>
      <tr><td>Мерная кружка</td><td>-</td><td>-</td><td>-</td><td></td></tr>
    </table>
    <p class="bl-p bl-sign">Общая кровопотеря <u class="md"></u> Подпись акушерки <u class="md"></u></p>
  </section>`;
}

// ---------- экран бланка ----------
function renderBlank(b) {
  topEl.innerHTML = `<a class="iconbtn" href="#/" aria-label="Все бланки">‹</a><h1>${esc(title(b))}</h1><button class="btn primary" data-act="print">Печать</button>`;
  const scroll = $$('.wrap').map(w => w.scrollLeft);
  const y = window.scrollY;
  const line = (label, val, cls = '') => `<span class="pl ${cls}"><span>${label}</span><u>${esc(val || '')}</u></span>`;
  view.innerHTML = `
    <div class="pr-only pr-head">
      <div class="pr-title">ПАРТОГРАММА ВОЗ</div>
      <div class="pr-line">${line('ФИО', b.fio, 'w3')}${line('№ истории', b.hist)}${line('Паритет', b.parity)}</div>
      <div class="pr-line">${line('Начало родов (дата и время)', b.onsetAt ? dmy(b.onsetAt) + ' ' + hm(b.onsetAt) : '')}${line('Активная фаза родов (дата)', dmy(b.start))}</div>
      <div class="pr-line">${line('Разрыв плодных оболочек (дата и время)', b.rom ? dmy(b.rom) + ' ' + hm(b.rom) : '', 'w3')}</div>
      <div class="pr-line">${line('Значимые факторы', b.risks, 'w3')}</div>
    </div>
    <details class="head no-pr" ${b.fio || b.hist ? '' : 'open'}>
      <summary><b>Данные роженицы</b><span>${esc([b.fio, b.parity].filter(Boolean).join(', '))}</span></summary>
      <div class="hgrid">
        <label class="f"><span>ФИО</span><input data-f="fio" value="${esc(b.fio)}" autocomplete="off"></label>
        <label class="f"><span>№ истории</span><input data-f="hist" value="${esc(b.hist)}" inputmode="numeric" autocomplete="off"></label>
        <label class="f"><span>Паритет</span><input data-f="parity" value="${esc(b.parity)}"></label>
        <label class="f"><span>Начало родов (дата и время)</span><input type="datetime-local" data-f="onsetAt" value="${toLocal(b.onsetAt)}"></label>
        <label class="f"><span>Активная фаза: время 1-го часа</span><input type="datetime-local" data-f="start" value="${toLocal(b.start)}"></label>
        <label class="f"><span>Разрыв плодных оболочек</span><input type="datetime-local" data-f="rom" value="${toLocal(b.rom)}"></label>
        <label class="f wide2"><span>Значимые факторы</span><input data-f="risks" value="${esc(b.risks)}"></label>
      </div>
    </details>
    <p class="hint no-pr">Тап по клетке — выбор значения, курсор сам идёт дальше по строке. ✕ и ○ — тап прямо в сетку. ✕ на 10 см открывает II период.</p>
    <div class="wrap" data-sync>${mainTable(b)}</div>
    ${b.s2start
      ? `<label class="f s2t no-pr"><span>Начало II периода (полное раскрытие)</span><input type="datetime-local" data-f="s2start" value="${toLocal(b.s2start)}"></label>`
      : `<button class="btn wide no-pr s2btn" data-act="s2">Полное раскрытие — открыть II период сейчас</button>`}
    ${birthBlock(b)}
    <div class="wrap" data-sync>${planTable(b)}</div>
    ${backSide(b)}
    <div class="tools no-pr">
      <button class="btn" data-act="share">Передать файлом</button>
      <button class="btn danger" data-act="del">Удалить бланк</button>
    </div>`;
  $$('.wrap').forEach((w, i) => { if (scroll[i] != null) w.scrollLeft = scroll[i]; });
  if (scroll.length) window.scrollTo(0, y);
}

// прокрутка двух частей бланка синхронно
let syncing = false;
document.addEventListener('scroll', e => {
  const w = e.target;
  if (!(w instanceof Element) || !w.matches('[data-sync]') || syncing) return;
  syncing = true;
  $$('[data-sync]').forEach(o => { if (o !== w) o.scrollLeft = w.scrollLeft; });
  requestAnimationFrame(() => { syncing = false; });
}, true);

function scrollToLast(b) {
  const w = $('.wrap'); if (!w) return;
  let maxU = -1;
  for (const [key, v] of Object.entries(b.cells)) {
    if (!hasVal(v)) continue;
    const [st, k, idx] = key.split(':');
    if (st !== '1') { maxU = Math.max(maxU, 26); continue; }
    const row = ROWS.concat(ROWS_PLAN).flatMap(s => s[1]).find(r => r[0] === k);
    const span = PARAMS[k].kind === 'grid' ? 2 : SPAN[row ? row[1] : 'hour'];
    maxU = Math.max(maxU, Number(idx) * span);
  }
  if (maxU > 6) { const u = w.querySelector('col.c-u1'); w.scrollLeft = (maxU - 4) * (u ? u.getBoundingClientRect().width || 34 : 34); }
}

// ---------- II период ----------
function syncS2(b) {
  let h = -1;
  for (let i = 0; i < 12; i++) if (Number(b.cells[`1:dil:${i}`]) === 10) { h = i; break; }
  const has2 = Object.keys(b.cells).some(x => x.startsWith('2:'));
  if (h >= 0) {
    const t = b.start + h * 60 * MIN;
    if (!b.s2start) { b.s2start = t; b.s2auto = true; return 'opened'; }
    if (b.s2auto && b.s2start !== t) { b.s2start = t; return 'moved'; }
    return null;
  }
  if (b.s2auto && b.s2start && !has2) { b.s2start = null; b.s2auto = false; return 'closed'; }
  return null;
}

// ---------- выбор значения ----------
function openPick(bid, stage, k, step, idx) {
  pick = { bid, stage: Number(stage), k, step, idx: Number(idx) };
  renderPick();
  sheet.hidden = false; backdrop.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('in'));
  markCur();
}
function closePick() {
  pick = null; sheet.classList.remove('in'); sheet.hidden = true; backdrop.hidden = true; sheet.innerHTML = '';
  markCur();
}
function markCur() {
  $$('.cell.cur').forEach(c => c.classList.remove('cur'));
  if (!pick) return;
  const el = $(`[data-cell="${pick.stage}:${pick.k}:${pick.step}:${pick.idx}"]`);
  if (!el) return;
  el.classList.add('cur');
  const w = el.closest('.wrap');
  const r = el.getBoundingClientRect(), wr = w.getBoundingClientRect();
  const stickyW = w.querySelector('.lab').getBoundingClientRect().right - wr.left;
  if (r.left < wr.left + stickyW + 4 || r.right > wr.right - 4) w.scrollLeft += r.left - wr.left - stickyW - 40;
  const sh = sheet.getBoundingClientRect();
  if (sh.height && (r.bottom > sh.top - 8 || r.top < 70)) window.scrollBy(0, r.top - Math.max(80, (sh.top - r.height) / 2));
}

function renderPick() {
  const b = blank(pick.bid), P = PARAMS[pick.k];
  const v = b.cells[`${pick.stage}:${pick.k}:${pick.idx}`];
  const prev = pick.idx > 0 ? b.cells[`${pick.stage}:${pick.k}:${pick.idx - 1}`] : undefined;
  let body = '';
  if (P.kind === 'num') {
    body = `<div class="chips num">${P.presets.map(x => `<button class="chip ${isAlert(pick.k, x) ? 'al' : ''}" aria-pressed="${Number(v) === x}" data-v="${x}">${fmt(x)}</button>`).join('')}</div>
      <div class="other"><input id="other" inputmode="decimal" placeholder="другое значение"><button class="btn" data-act="other">OK</button></div>`;
  } else if (P.kind === 'enum') {
    body = `<div class="chips">${P.opts.map(([c, l]) => `<button class="chip wide-chip ${isAlert(pick.k, c) ? 'al' : ''}" aria-pressed="${v === c}" data-v="${esc(c)}"><b>${esc(c)}</b>${c.toLowerCase() !== l.toLowerCase() ? ` ${esc(l)}` : ''}</button>`).join('')}</div>`;
  } else if (P.kind === 'phrase') {
    body = `<div class="chips">${P.phrases.map(x => `<button class="chip wide-chip phrase" aria-pressed="${v === x}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <textarea id="txt" rows="2" placeholder="или свой текст">${P.phrases.includes(v) ? '' : esc(v ?? '')}</textarea><button class="btn wide" data-act="savetxt">Записать свой текст</button>`;
  } else {
    const chips = pick.k === 'plan' ? PLAN_CHIPS : [];
    body = `${chips.length ? `<div class="chips small">${chips.map(x => `<button class="chip" data-act="addtxt" data-t="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
      <textarea id="txt" rows="3">${esc(v ?? '')}</textarea><button class="btn primary wide" data-act="savetxt">Записать</button>`;
  }
  const cnt = cellsIn(pick.stage, pick.step);
  sheet.innerHTML = `
    <div class="ph">
      <div><h2>${esc(P.label)}</h2><p>${cellLabel(b, pick.stage, pick.step, pick.idx)}${P.thr ? `. Порог: ${esc(P.thr)}` : ''}</p></div>
      <button class="iconbtn" data-act="close" aria-label="Закрыть">✕</button>
    </div>
    <div class="pb">
      ${hasVal(prev) ? `<button class="btn ghost wide" data-v="${esc(prev)}">Как в предыдущей: ${esc(fmt(prev).slice(0, 40))}</button>` : ''}
      ${body}
    </div>
    <div class="pf">
      <button class="btn" data-act="prev" ${pick.idx === 0 ? 'disabled' : ''}>Назад</button>
      <button class="btn" data-act="clear" ${hasVal(v) ? '' : 'disabled'}>Очистить</button>
      <button class="btn" data-act="next" ${pick.idx >= cnt - 1 ? 'disabled' : ''}>Дальше</button>
    </div>`;
  if (P.kind === 'text') setTimeout(() => $('#txt')?.focus(), 50);
}

function setCell(v, advance = true) {
  const b = blank(pick.bid);
  const key = `${pick.stage}:${pick.k}:${pick.idx}`;
  if (hasVal(v)) b.cells[key] = v; else delete b.cells[key];
  save(); buzz();
  const btn = $(`[data-cell="${pick.stage}:${pick.k}:${pick.step}:${pick.idx}"]`);
  if (btn) btn.innerHTML = cellHTML(pick.k, v);
  if (advance && pick.idx < cellsIn(pick.stage, pick.step) - 1) { pick.idx++; renderPick(); markCur(); }
  else if (advance) closePick();
  else renderPick();
}

// ---------- события ----------
document.addEventListener('click', async e => {
  const t = e.target;
  const cell = t.closest('[data-cell]');
  if (cell) {
    if (cell.classList.contains('off')) { toast('II период ещё не открыт: поставьте ✕ на 10 см'); return; }
    const [st, k, step, idx] = cell.dataset.cell.split(':'); openPick(route().id, st, k, step, idx); return;
  }
  const g = t.closest('[data-grid]');
  if (g) {
    if (g.classList.contains('off')) { toast('II период ещё не открыт: поставьте ✕ на 10 см'); return; }
    const b = blank(route().id); const [st, k, i, cm] = g.dataset.grid.split(':');
    const key = `${st}:${k}:${i}`;
    if (Number(b.cells[key]) === Number(cm)) delete b.cells[key]; else b.cells[key] = Number(cm);
    const s2 = k === 'dil' ? syncS2(b) : null;
    save(); renderBlank(b); buzz();
    if (s2 === 'opened' || s2 === 'moved') toast(`II период открыт с ${hm(b.s2start)}`);
    else if (s2 === 'closed') toast('II период снят');
    return;
  }
  const m = t.closest('[data-mark]');
  if (m) {
    if (m.classList.contains('off')) { toast('II период ещё не открыт: поставьте ✕ на 10 см'); return; }
    const b = blank(route().id); const key = m.dataset.mark;
    if (b.cells[key]) delete b.cells[key]; else b.cells[key] = 'P';
    save(); renderBlank(b); buzz(); return;
  }
  const sb = t.closest('[data-bset]');
  if (sb) {
    const b = blank(route().id); const [a, f] = sb.dataset.bset.split('.');
    const val = sb.dataset.v;
    if (f) { const k = b.birth.kids[a] = b.birth.kids[a] || {}; k[f] = k[f] === val ? '' : val; }
    else b.birth[a] = b.birth[a] === val ? '' : val;
    save(); renderBlank(b); return;
  }
  const vb = t.closest('[data-v]');
  if (vb && pick) { const P = PARAMS[pick.k]; setCell(P.kind === 'num' ? Number(vb.dataset.v) : vb.dataset.v, P.kind !== 'text'); if (P.kind === 'text') closePick(); return; }
  const a = t.closest('[data-act]');
  if (!a) return;
  const b = route().name === 'blank' ? blank(route().id) : null;
  switch (a.dataset.act) {
    case 'new': { const nb = newBlank(); location.hash = `#/b/${nb.id}`; break; }
    case 'close': closePick(); break;
    case 'prev': if (pick.idx > 0) { pick.idx--; renderPick(); markCur(); } break;
    case 'next': if (pick.idx < cellsIn(pick.stage, pick.step) - 1) { pick.idx++; renderPick(); markCur(); } break;
    case 'clear': setCell('', false); break;
    case 'other': {
      const P = PARAMS[pick.k]; const n = Number(String($('#other').value).replace(',', '.'));
      if (!Number.isFinite(n) || n < P.min || n > P.max) { toast(`Допустимо ${P.min}–${P.max}`); break; }
      setCell(n); break;
    }
    case 'addtxt': { const ta = $('#txt'); ta.value = ta.value.trim() ? ta.value.trim() + '; ' + a.dataset.t : a.dataset.t; break; }
    case 'savetxt': setCell($('#txt').value.trim(), false); closePick(); break;
    case 's2': { const d = new Date(); d.setSeconds(0, 0); b.s2start = d.getTime(); b.s2auto = false; save(); renderBlank(b); toast('II период открыт'); break; }
    case 'print': closePick(); window.print(); break;
    case 'share': {
      const name = `partogramma-${(b.hist || 'blank').replace(/[^\wа-яё-]+/gi, '_')}.json`;
      const text = exportBlank(b);
      try {
        const f = new File([text], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); break; }
      } catch (err) { if (err.name === 'AbortError') break; }
      const l = document.createElement('a'); l.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); l.download = name; l.click();
      break;
    }
    case 'del': if (confirm('Удалить бланк? Отменить нельзя.')) { removeBlank(b.id); location.hash = '#/'; } break;
    case 'install': if (installEvt) { installEvt.prompt(); installEvt = null; render(); } break;
  }
});

document.addEventListener('keydown', e => {
  if (!pick) return;
  if (e.key === 'Escape') closePick();
  if (e.key === 'Enter' && e.target.id === 'other') $('[data-act="other"]').click();
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.f) {
    const b = blank(route().id), f = t.dataset.f;
    b[f] = t.type === 'datetime-local' ? (fromLocal(t.value) || (f === 'start' ? b.start : null)) : t.value.trim();
    if (f === 's2start') b.s2auto = false;
    if (f === 'start') syncS2(b);
    save();
    topEl.querySelector('h1').textContent = title(b);
    if (f === 'start' || f === 's2start') renderBlank(b);
  }
  if (t.dataset.kid) {
    const b = blank(route().id); const [i, f] = t.dataset.kid.split('.');
    (b.birth.kids[i] = b.birth.kids[i] || {})[f] = t.value; save();
  }
  if (t.dataset.birth) { const b = blank(route().id); b.birth[t.dataset.birth] = t.value.trim(); save(); }
  if (t.dataset.file === 'import' && t.files[0]) {
    try { const n = importBlanks(await t.files[0].text()); toast(`Открыто бланков: ${n}`); render(); }
    catch (err) { toast('Не удалось открыть: ' + err.message); }
    t.value = '';
  }
});

// перед печатью — перерисовать, чтобы печатная шапка была свежей
window.addEventListener('beforeprint', () => { if (route().name === 'blank') renderBlank(blank(route().id)); });

backdrop.addEventListener('click', closePick);
window.addEventListener('hashchange', () => { closePick(); render(); window.scrollTo(0, 0); const r = route(); if (r.name === 'blank') setTimeout(() => scrollToLast(blank(r.id)), 0); });

render();
if (route().name === 'blank') setTimeout(() => scrollToLast(blank(route().id)), 0);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
