import { PARAMS, STAGE1, STAGE2, SPAN, UNIT_MIN, cellsIn, PLAN_CHIPS, hasVal, isAlert, fmt, lagAlerts } from './rules.js';
import { db, save, blank, newBlank, removeBlank, exportBlank, importBlanks } from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const MIN = 60000;
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dmy = t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const toLocal = t => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = s => s ? new Date(s).getTime() : null;

const view = $('#view'), topEl = $('#top'), sheet = $('#sheet'), backdrop = $('#sheet-backdrop'), toastEl = $('#toast');
let pick = null; // открытая клетка: { bid, stage, k, step, idx }

function toast(msg) {
  toastEl.textContent = msg; toastEl.className = 'show';
  clearTimeout(toast.t); toast.t = setTimeout(() => { toastEl.className = ''; }, 2200);
}

const route = () => { const h = location.hash.replace(/^#\/?/, '').split('/'); return h[0] === 'b' && h[1] ? { name: 'blank', id: h[1] } : { name: 'list' }; };

function render() {
  const r = route();
  if (r.name === 'blank') { const b = blank(r.id); if (b) return renderBlank(b); location.hash = '#/'; return; }
  renderList();
}

// ---------- список бланков ----------
function filled(b) { return Object.values(b.cells).filter(hasVal).length; }

function renderList() {
  topEl.innerHTML = `<span class="brand" aria-hidden="true"><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 19 L14 13 L18 17 L24 10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span><h1>Партограмма ВОЗ</h1>`;
  const bs = db.state.blanks;
  view.innerHTML = `
    <div class="list">
      <button class="btn primary big wide" data-act="new">Новый бланк</button>
      ${bs.length ? bs.map(b => `
        <a class="lrow" href="#/b/${b.id}">
          <span><b>${esc(b.label || 'Без метки')}</b><small>начало ${dmy(b.start)} ${hm(b.start)}</small></span>
          <span class="lcount">${filled(b)}<small>клеток</small></span>
        </a>`).join('')
      : '<p class="empty">Бланков пока нет. Нажмите «Новый бланк» — откроется партограмма ВОЗ, заполняйте её тапами по клеткам.</p>'}
      <label class="btn wide">Открыть файл бланка<input type="file" accept=".json,application/json" data-file="import" hidden></label>
      ${installHint()}
      <p class="note">Данные хранятся только на этом устройстве. В метке — палата или номер истории, без ФИО.</p>
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

// ---------- бланк ----------
function unitTime(b, stage, step, idx) {
  return stage === 1 ? b.start + idx * SPAN[step] * UNIT_MIN[1] * MIN : b.s2start + idx * SPAN[step] * UNIT_MIN[2] * MIN;
}
function cellLabel(b, stage, step, idx) {
  const t = unitTime(b, stage, step, idx);
  if (stage === 1) return `${Math.floor(idx * SPAN[step] / 2) + 1}-й час, ${hm(t)}`;
  return `II период, ${hm(t)}`;
}

function cellHTML(k, v, lag) {
  if (!hasVal(v)) return '';
  const P = PARAMS[k];
  const t = P.kind === 'text' ? `<span class="txt">${esc(v)}</span>` : esc(fmt(v));
  return isAlert(k, v) || lag ? `<span class="ring">${t}</span>` : t;
}

function tableHTML(b, stage) {
  const S = stage === 1 ? STAGE1 : STAGE2;
  const units = stage === 1 ? 24 : 36;
  const lag = stage === 1 ? lagAlerts(b.cells) : new Set();
  let h = `<table class="lcg s${stage}"><colgroup><col class="c-sec"><col class="c-lab">${'<col class="c-u">'.repeat(units)}</colgroup><thead>`;
  if (stage === 1) {
    h += `<tr><th class="c0" colspan="2">Часы активной фазы</th>${Array.from({ length: 12 }, (_, i) => `<th colspan="2">${i + 1}</th>`).join('')}</tr>`;
    h += `<tr><th class="c0" colspan="2">Время</th>${Array.from({ length: 12 }, (_, i) => `<th colspan="2" class="tm">${hm(b.start + i * 60 * MIN)}</th>`).join('')}</tr>`;
  } else {
    h += `<tr><th class="c0" colspan="2">Время</th>${Array.from({ length: 12 }, (_, i) => `<th colspan="3" class="tm">${hm(b.s2start + i * 15 * MIN)}</th>`).join('')}</tr>`;
  }
  h += '</thead><tbody>';
  for (const [sec, rows] of S) {
    const n = rows.reduce((a, [k]) => a + (PARAMS[k].kind === 'grid' ? PARAMS[k].grid.length : 1), 0);
    let first = true;
    for (const [k, step] of rows) {
      const P = PARAMS[k];
      const secTh = first ? `<th class="sec" rowspan="${n}"><span>${sec}</span></th>` : '';
      if (P.kind === 'grid') {
        P.grid.forEach((cm, gi) => {
          h += `<tr class="grow ${gi === 0 ? 'gtop' : ''}">${gi === 0 ? secTh : ''}<th class="lab grid-lab">${gi === 0 ? `<span>${P.label}</span>` : ''}<b>${cm}</b></th>`;
          for (let i = 0; i < 12; i++) {
            const v = b.cells[`1:${k}:${i}`];
            const on = hasVal(v) && Number(v) === cm;
            const mark = on ? (k === 'dil' ? (lag.has(i) ? '<span class="ring">✕</span>' : '✕') : '○') : '';
            h += `<td colspan="2" class="gcell ${cm === 5 && k === 'dil' ? 'g5' : ''}"><button class="cell gbtn" data-grid="${k}:${i}:${cm}" aria-label="${P.label}: ${cm}, ${i + 1}-й час">${mark}</button></td>`;
          }
          h += '</tr>';
        });
        first = false;
        continue;
      }
      h += `<tr>${secTh}<th class="lab"><span>${P.label}</span>${P.thr ? `<small>${esc(P.thr)}</small>` : ''}</th>`;
      const cnt = cellsIn(stage, step);
      for (let i = 0; i < cnt; i++) {
        const key = `${stage}:${k}:${i}`;
        const cur = pick && pick.bid === b.id && pick.stage === stage && pick.k === k && pick.idx === i;
        h += `<td colspan="${SPAN[step]}"><button class="cell ${cur ? 'cur' : ''}" data-cell="${stage}:${k}:${step}:${i}">${cellHTML(k, b.cells[key])}</button></td>`;
      }
      h += '</tr>';
      first = false;
    }
  }
  return h + '</tbody></table>';
}

function renderBlank(b) {
  topEl.innerHTML = `<a class="iconbtn" href="#/" aria-label="Все бланки">‹</a><h1>${esc(b.label || 'Без метки')}</h1><button class="btn primary" data-act="print">Печать</button>`;
  const scroll = [...document.querySelectorAll('.wrap')].map(w => w.scrollLeft);
  const y = window.scrollY;
  view.innerHTML = `
    <div class="pr-only pr-title">Партограмма ВОЗ (Labour Care Guide)</div>
    <table class="pr-only pr-id"><tr>
      <td><b>Метка:</b> ${esc(b.label)}</td><td><b>Паритет:</b> ${esc(b.parity)}</td>
      <td><b>Начало родов:</b> ${b.onset === 'spont' ? 'спонтанное' : b.onset === 'ind' ? 'индуцированное' : ''}</td>
      <td><b>Активная фаза:</b> ${dmy(b.start)} ${hm(b.start)}</td>
      <td><b>Излитие вод:</b> ${b.rom ? dmy(b.rom) + ' ' + hm(b.rom) : ''}</td>
      <td><b>Факторы риска:</b> ${esc(b.risks)}</td></tr></table>
    <details class="head no-pr" ${b.label ? '' : 'open'}>
      <summary><b>Данные роженицы</b><span>${esc([b.parity, b.start ? 'с ' + hm(b.start) : ''].filter(Boolean).join(', '))}</span></summary>
      <div class="hgrid">
        <label class="f wide2"><span>Метка (палата, № истории)</span><input data-f="label" value="${esc(b.label)}" placeholder="Палата 3, ИБ 1234"></label>
        <label class="f"><span>Паритет</span><input data-f="parity" value="${esc(b.parity)}" placeholder="Б2 Р1"></label>
        <label class="f"><span>Начало родов</span><select data-f="onset"><option value=""></option>${[['spont', 'Спонтанное'], ['ind', 'Индуцированное']].map(([v, l]) => `<option value="${v}" ${b.onset === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f"><span>Активная фаза (1-й час)</span><input type="datetime-local" data-f="start" value="${toLocal(b.start)}"></label>
        <label class="f"><span>Излитие вод</span><input type="datetime-local" data-f="rom" value="${toLocal(b.rom)}"></label>
        <label class="f wide2"><span>Факторы риска</span><input data-f="risks" value="${esc(b.risks)}"></label>
      </div>
    </details>
    <p class="hint">Тап по клетке — выбор значения, дальше курсор сам идёт по строке. Шейка и опускание — тап прямо в сетку. Значения за порогом обводятся сами.</p>
    <h2 class="stg">I период</h2>
    <div class="wrap">${tableHTML(b, 1)}</div>
    <h2 class="stg s2h">II период</h2>
    ${b.s2start
      ? `<label class="f s2t no-pr"><span>Полное раскрытие</span><input type="datetime-local" data-f="s2start" value="${toLocal(b.s2start)}"></label>
         <p class="pr-only">Полное раскрытие: ${dmy(b.s2start)} ${hm(b.s2start)}</p>
         <div class="wrap">${tableHTML(b, 2)}</div>`
      : `<button class="btn wide no-pr" data-act="s2">Полное раскрытие — открыть II период</button>`}
    <div class="tools no-pr">
      <button class="btn" data-act="share">Передать файлом</button>
      <button class="btn danger" data-act="del">Удалить бланк</button>
    </div>
    <p class="pr-only pr-sign">Врач: ______________________ Подпись: ____________</p>`;
  document.querySelectorAll('.wrap').forEach((w, i) => { if (scroll[i] != null) w.scrollLeft = scroll[i]; });
  if (scroll.length) window.scrollTo(0, y);
}

// при первом открытии — прокрутить к последней заполненной колонке
function scrollToLast(b) {
  const wraps = document.querySelectorAll('.wrap');
  wraps.forEach((w, i) => {
    let maxU = -1;
    for (const [key, v] of Object.entries(b.cells)) {
      if (!hasVal(v)) continue;
      const [st, k, idx] = key.split(':');
      if (Number(st) !== i + 1) continue;
      const S = Number(st) === 1 ? STAGE1 : STAGE2;
      const step = S.flatMap(s => s[1]).find(r => r[0] === k)?.[1] || 'hour';
      maxU = Math.max(maxU, Number(idx) * (PARAMS[k].kind === 'grid' ? 2 : SPAN[step]));
    }
    const tbl = w.querySelector('table'), units = i === 0 ? 24 : 36;
    const sticky = w.querySelector('.lab').offsetWidth + w.querySelector('.c0').offsetWidth - w.querySelector('.lab').offsetWidth;
    const unitW = (tbl.offsetWidth - sticky) / units;
    if (maxU > 4) w.scrollLeft = (maxU - 3) * unitW;
  });
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
  document.querySelectorAll('.cell.cur').forEach(c => c.classList.remove('cur'));
  if (!pick) return;
  const el = document.querySelector(`[data-cell="${pick.stage}:${pick.k}:${pick.step}:${pick.idx}"]`);
  if (el) {
    el.classList.add('cur');
    const w = el.closest('.wrap');
    const r = el.getBoundingClientRect(), wr = w.getBoundingClientRect();
    const stickyW = w.querySelector('.lab').offsetWidth + w.querySelector('.sec, .c0').offsetWidth;
    if (r.left < wr.left + stickyW + 8 || r.right > wr.right - 8) w.scrollLeft += r.left - wr.left - stickyW - 40;
    const sh = sheet.getBoundingClientRect();
    if (r.bottom > sh.top - 8 || r.top < 60) window.scrollBy(0, r.top - Math.max(80, (sh.top - r.height) / 2));
  }
}

function renderPick() {
  const b = blank(pick.bid), P = PARAMS[pick.k];
  const key = `${pick.stage}:${pick.k}:${pick.idx}`;
  const v = b.cells[key];
  const prevKey = `${pick.stage}:${pick.k}:${pick.idx - 1}`;
  const prev = pick.idx > 0 ? b.cells[prevKey] : undefined;
  let body = '';
  if (P.kind === 'num') {
    body = `<div class="chips num">${P.presets.map(x => `<button class="chip ${isAlert(pick.k, x) ? 'al' : ''}" aria-pressed="${Number(v) === x}" data-v="${x}">${fmt(x)}</button>`).join('')}</div>
      <div class="other"><input id="other" inputmode="decimal" placeholder="другое значение" value=""><button class="btn" data-act="other">OK</button></div>`;
  } else if (P.kind === 'enum') {
    body = `<div class="chips">${P.opts.map(([c, l]) => `<button class="chip wide-chip ${isAlert(pick.k, c) ? 'al' : ''}" aria-pressed="${v === c}" data-v="${esc(c)}"><b>${esc(c)}</b>${c !== l ? ` ${esc(l)}` : ''}</button>`).join('')}</div>`;
  } else {
    body = `${pick.k === 'plan' || pick.k === 'assess' ? `<div class="chips small">${PLAN_CHIPS.map(x => `<button class="chip" data-act="addtxt" data-t="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
      <textarea id="txt" rows="3">${esc(v ?? '')}</textarea><button class="btn primary wide" data-act="savetxt">Записать</button>`;
  }
  const cnt = cellsIn(pick.stage, pick.step);
  sheet.innerHTML = `
    <div class="ph">
      <div><h2>${esc(P.label)}</h2><p>${cellLabel(b, pick.stage, pick.step, pick.idx)}${P.thr ? ` · порог: ${esc(P.thr)}` : ''}</p></div>
      <button class="iconbtn" data-act="close" aria-label="Закрыть">✕</button>
    </div>
    <div class="pb">
      ${hasVal(prev) && P.kind !== 'text' ? `<button class="btn ghost wide" data-v="${esc(prev)}">Как в предыдущей: ${esc(fmt(prev))}</button>` : ''}
      ${body}
    </div>
    <div class="pf">
      <button class="btn" data-act="prev" ${pick.idx === 0 ? 'disabled' : ''}>Назад</button>
      <button class="btn" data-act="clear" ${hasVal(v) ? '' : 'disabled'}>Очистить</button>
      <button class="btn" data-act="next" ${pick.idx >= cnt - 1 ? 'disabled' : ''}>Дальше</button>
    </div>`;
}

function setCell(v, advance = true) {
  const b = blank(pick.bid);
  const key = `${pick.stage}:${pick.k}:${pick.idx}`;
  if (hasVal(v)) b.cells[key] = v; else delete b.cells[key];
  save();
  const btn = document.querySelector(`[data-cell="${pick.stage}:${pick.k}:${pick.step}:${pick.idx}"]`);
  if (btn) btn.innerHTML = cellHTML(pick.k, v);
  try { navigator.vibrate && navigator.vibrate(8); } catch (e) {}
  if (advance && pick.idx < cellsIn(pick.stage, pick.step) - 1) { pick.idx++; renderPick(); markCur(); }
  else if (advance) closePick();
  else { renderPick(); }
}

// ---------- события ----------
document.addEventListener('click', async e => {
  const t = e.target;
  // клетка таблицы
  const cell = t.closest('[data-cell]');
  if (cell) { const [st, k, step, idx] = cell.dataset.cell.split(':'); openPick(route().id, st, k, step, idx); return; }
  // сетка раскрытия / опускания
  const g = t.closest('[data-grid]');
  if (g) {
    const b = blank(route().id); const [k, i, cm] = g.dataset.grid.split(':');
    const key = `1:${k}:${i}`;
    if (Number(b.cells[key]) === Number(cm)) delete b.cells[key]; else b.cells[key] = Number(cm);
    save(); renderBlank(b);
    try { navigator.vibrate && navigator.vibrate(8); } catch (e2) {}
    return;
  }
  // значение в листе выбора
  const vb = t.closest('[data-v]');
  if (vb && pick) { const P = PARAMS[pick.k]; setCell(P.kind === 'num' ? Number(vb.dataset.v) : vb.dataset.v); return; }
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
    case 's2': { const d = new Date(); d.setSeconds(0, 0); b.s2start = d.getTime(); save(); renderBlank(b); toast('II период открыт'); break; }
    case 'print': closePick(); window.print(); break;
    case 'share': {
      const name = `partogramma-${(b.label || 'blank').replace(/[^\wа-яё-]+/gi, '_')}.json`;
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
    const b = blank(route().id);
    const f = t.dataset.f;
    b[f] = t.type === 'datetime-local' ? (fromLocal(t.value) || (f === 'start' ? b.start : null)) : t.value.trim();
    save();
    if (f === 'label') topEl.querySelector('h1').textContent = b.label || 'Без метки';
    if (f === 'start' || f === 's2start') renderBlank(b);
  }
  if (t.dataset.file === 'import' && t.files[0]) {
    try { const n = importBlanks(await t.files[0].text()); toast(`Открыто бланков: ${n}`); render(); }
    catch (err) { toast('Не удалось открыть: ' + err.message); }
    t.value = '';
  }
});

backdrop.addEventListener('click', closePick);
window.addEventListener('hashchange', () => { closePick(); render(); window.scrollTo(0, 0); const r = route(); if (r.name === 'blank') setTimeout(() => scrollToLast(blank(r.id)), 0); });

render();
if (route().name === 'blank') setTimeout(() => scrollToLast(blank(route().id)), 0);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
