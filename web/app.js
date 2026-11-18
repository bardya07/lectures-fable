/* Grod: rendering and interaction. All model logic lives in core.js. */
(function () {
  'use strict';

  const C = window.Core;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const activeControl = () => {
    const active = document.activeElement;
    return active?.closest('dialog:not([open])') ? null : active;
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  // Geometry. SIDE_W and HEAD_H mirror the custom properties in style.css.
  const SIDE_W = 232, HEAD_H = 52, MIN_WEEK_W = 150;
  let WEEK_W = 168;
  const CHIP_H = 22, LANE_H = 28, PAD_Y = 13;
  const CELL = 122, CP_CHIP = 116, CP_ROW = 48, CP_PAD = 18, CP_HEAD = 30, NOW_GAP = 30;

  const ICON = {
    asg: '<svg width="11" height="11" viewBox="0 0 11 11"><rect x="1.25" y="1.25" width="8.5" height="8.5" rx="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    asgDone: '<svg width="11" height="11" viewBox="0 0 11 11"><rect x="1.25" y="1.25" width="8.5" height="8.5" rx="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.4 5.7l1.5 1.4 2.7-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    exam: '<svg width="11" height="11" viewBox="0 0 11 11"><path d="M5.5.9l4.6 4.6-4.6 4.6L.9 5.5z" fill="currentColor"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.4l2.4 2.3 4.6-5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg width="11" height="11" viewBox="0 0 11 11"><path d="M5.5 1.5v8M1.5 5.5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    more: '<svg width="14" height="4" viewBox="0 0 14 4"><circle cx="2" cy="2" r="1.4" fill="currentColor"/><circle cx="7" cy="2" r="1.4" fill="currentColor"/><circle cx="12" cy="2" r="1.4" fill="currentColor"/></svg>',
    pencil: '<svg width="13" height="13" viewBox="0 0 13 13"><path d="M2 11l.6-2.7 6.5-6.5a1.2 1.2 0 0 1 1.7 0l.4.4a1.2 1.2 0 0 1 0 1.7L4.7 10.4zM8.2 2.7l2.1 2.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    arrow: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 7.5l5-5M3.5 2.5h4v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const strip = $('#strip'), scroller = $('#scroller'), grid = $('#grid'), card = $('#card');
  const toastEl = $('#toast'), measureEl = $('#measure'), dlg = $('#item-dlg'), form = $('#item-form');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------------------------------------------------------------- native bridge
  // In the app every call goes to Swift and returns a promise. Opened in a plain browser
  // (for development) the same calls fall back to localStorage and browser dialogs.
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.app;
  const STORAGE_KEY = 'lectures-fable';

  async function call(op, payload) {
    if (window.__testBridge && op in window.__testBridge) return window.__testBridge[op](payload || {});
    if (native) return native.postMessage(Object.assign({ op }, payload));
    return browserFallback(op, payload || {});
  }

  function browserFallback(op, p) {
    switch (op) {
      case 'load': return { data: localStorage.getItem(STORAGE_KEY) };
      case 'save': localStorage.setItem(STORAGE_KEY, p.json); return true;
      case 'backUpBeforeImport': {
        const current = localStorage.getItem(STORAGE_KEY);
        if (current !== null) localStorage.setItem(STORAGE_KEY + '-before-import', current);
        return true;
      }
      case 'open': window.open(p.url, '_blank', 'noopener'); return true;
      case 'confirm': return window.confirm(p.title + (p.message ? '\n\n' + p.message : ''));
      case 'alert': window.alert(p.title + (p.message ? '\n\n' + p.message : '')); return true;
      case 'export': {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([p.json], { type: 'application/json' }));
        a.download = p.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 0);
        return true;
      }
      case 'calendarFetch': throw new Error('Calendar fetch requires the app.');
      case 'calendarImport':
      case 'import': return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = op === 'calendarImport' ? '.ics,text/calendar' : '.json,application/json';
        input.oncancel = () => resolve(null);
        input.onchange = async () => {
          try { resolve(input.files[0] ? { name: input.files[0].name, text: await input.files[0].text() } : null); }
          catch (error) { reject(error); }
        };
        input.click();
      });
      default: return null;
    }
  }

  // ---------------------------------------------------------------- state
  let S = { classes: [], items: [], calendars: [], calendarUnmatched: [], calendarSkipped: [], calendarTombstones: [], settings: { view: 'timeline', theme: 'system' } };
  let today = C.todayISO();
  let nums = new Map();
  let stat = new Map();
  let layout = { view: 'timeline', nowX: 0, R: null };
  let ready = false;
  let rendering = false;
  let followToday = true;
  let plannedScroll = null;
  let lastScrollLeft = 0;
  let selectedId = null;
  const view = { addingClass: false, renaming: null, lastClassId: null, center: true };
  const undoStack = [];
  const redoStack = [];

  const find = id => S.items.find(it => it.id === id);
  const classOf = id => S.classes.find(c => c.id === id);
  const snapshot = (withSettings = false, state = S) => JSON.stringify({ classes: state.classes, items: state.items, calendars: state.calendars,
    calendarUnmatched: state.calendarUnmatched, calendarSkipped: state.calendarSkipped, calendarTombstones: state.calendarTombstones,
    settings: withSettings ? state.settings : undefined });
  function restore(d) {
    S.classes = d.classes;
    S.items = d.items;
    S.calendars = d.calendars || [];
    S.calendarUnmatched = d.calendarUnmatched || [];
    S.calendarSkipped = d.calendarSkipped || [];
    S.calendarTombstones = d.calendarTombstones || [];
    if (d.settings) { S.settings = d.settings; view.center = true; }
  }

  // Every change to classes or items goes through here so it is saved and can be undone.
  function commit(label, change, withSettings = false) {
    const before = snapshot(withSettings);
    const result = change();
    if (snapshot(withSettings) === before) return result;
    undoStack.push({ label, data: before });
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    hideToast();
    persist();
    render();
    return result;
  }

  function step(from, to) {
    const entry = from.pop();
    if (!entry) return false;
    const data = JSON.parse(entry.data);
    to.push({ label: entry.label, data: snapshot(!!data.settings) });
    restore(data);
    view.renaming = null;
    hideToast();
    persist();
    render();
    return true;
  }
  const undo = () => step(undoStack, redoStack);
  const redo = () => step(redoStack, undoStack);

  let savingBlocked = false, saveFailureShown = false;
  function persist() {
    if (!ready || savingBlocked) return;
    call('save', { json: JSON.stringify(C.serialize(S), null, 2) }).then(() => { saveFailureShown = false; }).catch(error => {
      if (!native && !saveFailureShown) {
        saveFailureShown = true;
        call('alert', { title: 'Your changes couldn’t be saved.', message: error.message });
      }
    });
  }

  // ---------------------------------------------------------------- chips
  const widths = new Map();
  function measure(key, html, fallback) {
    let w = widths.get(key);
    if (w === undefined) {
      measureEl.innerHTML = html;
      w = Math.ceil(measureEl.firstElementChild.getBoundingClientRect().width) || fallback;
      widths.set(key, w);
    }
    return w;
  }

  function deadlineInner(it, st) {
    const icon = st === 'done' ? ICON.check : it.type === 'exam' ? ICON.exam : ICON.asg;
    return icon + '<span class="t">' + esc(C.title(it, nums)) + '</span><span class="dd">' + C.fmtDay(it.date) + '</span>';
  }

  function chipWidth(it) {
    if (it.type === 'lecture') {
      const digits = String(nums.get(it.id)).length;
      return measure('lec' + digits, '<span class="chip lec">' + '0'.repeat(digits) + '</span>', 26);
    }
    const text = C.title(it, nums);
    const kind = it.type === 'exam' ? 'exam' : 'asg';
    return measure(kind + '|' + text + '|' + C.fmtDay(it.date), '<span class="chip dl ' + kind + '">' + deadlineInner(it, '') + '</span>', 70 + text.length * 6);
  }

  function chipHTML(it, style, inWeek) {
    const st = C.status(it, today);
    const label = esc(C.title(it, nums) + ', ' + C.fmtMedium(it.date) + (it.done ? ', done' : ''));
    const attrs = ' data-id="' + esc(it.id) + '" style="' + style + '" aria-label="' + label + '" aria-pressed="' + !!it.done + '"';
    if (inWeek) {
      const kind = it.type === 'lecture' ? 'lec' : 'dl ' + (it.type === 'exam' ? 'exam' : 'asg');
      const title = it.type === 'lecture' ? (it.title || 'L' + nums.get(it.id)) : C.title(it, nums);
      return '<button type="button" class="chip week-chip ' + kind + ' s-' + st + (it.link && it.type === 'lecture' ? ' has-link' : '') + '"' + attrs + '>' +
        (it.done ? ICON.check : '') + '<span class="t n">' + esc(title) + '</span><span class="weekday">· ' + C.WEEKDAYS[C.weekday(it.date)] + '</span></button>';
    }
    if (it.type === 'lecture') {
      return '<button type="button" class="chip lec s-' + st + (it.link ? ' has-link' : '') + '"' + attrs + '>' + (it.done ? ICON.check : '') + '<span class="n">' + esc(it.title || 'L' + nums.get(it.id)) + '</span><span class="weekday">· ' + C.WEEKDAYS[C.weekday(it.date)] + '</span></button>';
    }
    return '<button type="button" class="chip dl ' + (it.type === 'exam' ? 'exam' : 'asg') + ' s-' + st + '"' + attrs + '>' + deadlineInner(it, st) + '</button>';
  }

  // ---------------------------------------------------------------- sidebar
  function cornerHTML() {
    let behind = 0, lectures = 0;
    for (const s of stat.values()) { behind += s.behind; lectures += s.lectures; }
    const text = behind ? '<span class="total behind">' + behind + ' behind</span>' : lectures ? '<span class="total">Caught up</span>' : '';
    return '<div class="side">' + text + '</div>';
  }

  function nextHTML(s) {
    const it = s.nextDeadline || s.nextLecture;
    if (!it) return '';
    const n = C.diffDays(it.date, today);
    const name = C.title(it, nums);
    const kind = it.type === 'lecture' ? '' : it.type === 'exam' ? 'exam' : 'asg';
    return '<b class="' + kind + '">' + esc(name) + '</b> ' + (it.type === 'assignment' ? 'due ' : '') + C.relative(n) + ' · ' + C.fmtMedium(it.date);
  }

  function nextText(s) {
    const it = s.nextDeadline || s.nextLecture;
    if (!it) return '';
    const name = C.title(it, nums);
    return name + ' ' + (it.type === 'assignment' ? 'due ' : '') + C.relative(C.diffDays(it.date, today)) + ' · ' + C.fmtMedium(it.date);
  }

  function sideHTML(c) {
    const s = stat.get(c.id);
    const name = view.renaming === c.id
      ? '<input class="inline" id="rename-input" value="' + esc(c.name) + '" maxlength="80" spellcheck="false">'
      : '<span class="name" data-act="rename" title="' + esc(c.name) + '">' + esc(c.name) + '</span>';
    const badge = s.behind
      ? '<button type="button" class="behind-badge" data-act="first-behind" title="' + s.behind + ' behind">' + s.behind + ' behind</button>'
      : s.lectures ? '<span class="caught" aria-label="Caught up">' + ICON.check + '</span>' : '';
    const second = S.settings.view === 'compact'
      ? (s.lectures ? s.done + ' of ' + s.lectures + ' done' : '')
      : nextHTML(s);
    return '<div class="side c' + c.color + '">' +
      '<div class="l1"><button type="button" class="dot" data-act="color" aria-label="Change color"></button>' + name + badge + '</div>' +
      '<div class="l2"><span class="next" title="' + esc(S.settings.view === 'compact' ? (s.lectures ? s.done + ' of ' + s.lectures + ' done' : '') : nextText(s)) + '">' + second + '</span><button type="button" class="more" data-act="class-menu" aria-label="Class options">' + ICON.more + '</button></div>' +
      '</div>';
  }

  function newClassSideHTML() {
    const open = view.addingClass || !S.classes.length;
    return '<div class="side">' + (open
      ? '<input class="inline" id="new-class-input" placeholder="Class name" maxlength="80" spellcheck="false">'
      : '<button type="button" class="new-class" data-act="new-class">' + ICON.plus + '<span>New class</span></button>') + '</div>';
  }

  // ---------------------------------------------------------------- timeline
  function itemsByClass() {
    const map = new Map();
    for (const it of C.sorted(S.items)) {
      if (!map.has(it.classId)) map.set(it.classId, []);
      map.get(it.classId).push(it);
    }
    return map;
  }

  function renderTimeline() {
    const visibleWeeks = Math.round(Math.max(1, scroller.clientWidth - SIDE_W) / WEEK_W);
    const R = C.range(S, today, visibleWeeks);
    const totalW = R.weeks * WEEK_W;
    const nowWeek = C.weekIndex(today, R.start);
    const nowX = (nowWeek + 0.5) * WEEK_W;
    const groups = itemsByClass();
    const todayBand = '<div class="today-week" style="left:' + nowWeek * WEEK_W + 'px"></div>';

    let ruler = todayBand;
    // Assign each week to the month containing its Thursday so month segments
    // begin and end at week boundaries, including weeks that cross months.
    let monthStart = 0;
    for (let i = 0; i <= R.weeks; i++) {
      const monthAt = n => C.addDays(R.start, n * 7 + 3).slice(0, 7);
      if (i < R.weeks && monthAt(i) === monthAt(monthStart)) continue;
      const iso = C.addDays(R.start, monthStart * 7 + 3);
      const month = new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
      const label = month + (monthStart === 0 || iso.slice(5, 7) === '01' ? ' ' + iso.slice(0, 4) : '');
      ruler += '<div class="month" style="left:' + monthStart * WEEK_W + 'px;width:' + (i - monthStart) * WEEK_W + 'px"><span title="' + esc(label) + '">' + label + '</span></div>';
      monthStart = i;
    }
    ruler += '<div class="weeks">';
    for (let i = 0; i < R.weeks; i++) {
      const start = C.addDays(R.start, i * 7), end = C.addDays(start, 6);
      const label = C.fmtShort(start) + '–' + (start.slice(0, 7) === end.slice(0, 7) ? C.dayOfMonth(end) : C.fmtShort(end));
      ruler += '<span class="week-label' + (i === nowWeek ? ' now' : '') + '" title="' + esc(label) + '">' + label + '</span>';
    }
    ruler += '</div>';

    let h = '<div class="tl" style="width:' + (SIDE_W + totalW) + 'px">' +
      '<div class="head">' + cornerHTML() + '<div class="ruler" style="width:' + totalW + 'px">' + ruler + '</div></div>';

    let hinted = false;
    for (const c of S.classes) {
      const items = groups.get(c.id) || [];
      const L = C.layoutWeeks(items, R);
      const height = Math.max(70, PAD_Y * 2 + L.lanes * LANE_H - (LANE_H - CHIP_H) + 24);
      let chips = '';
      for (let i = 0; i < items.length; i++) {
        const p = L.pos.get(items[i].id);
        if (!p) continue;
        chips += chipHTML(items[i], 'left:' + (p.week * WEEK_W + 7) + 'px;top:' + (PAD_Y + p.lane * LANE_H) + 'px;width:' + (WEEK_W - 14) + 'px', true);
      }
      let hint = '';
      if (!items.length && !hinted) {
        hinted = true;
        hint = '<span class="hint" style="left:' + (nowWeek * WEEK_W + 7) + 'px;width:' + (WEEK_W - 14) + 'px">Double-click to add</span>';
      }
      h += '<div class="row" data-class="' + esc(c.id) + '" style="height:' + (height + 1) + 'px">' + sideHTML(c) +
        '<div class="track" data-class="' + esc(c.id) + '" style="width:' + totalW + 'px">' + todayBand + hint + chips + '</div></div>';
    }
    h += '<div class="row fill">' + newClassSideHTML() + '<div class="track" style="width:' + totalW + 'px">' + todayBand + '</div></div></div>';
    grid.innerHTML = h;
    layout = { view: 'timeline', nowX, R, weekWidth: WEEK_W };
  }

  // ---------------------------------------------------------------- compact
  function renderCompact() {
    const K = C.compact(S, today);
    const any = K.maxPast + K.maxFuture > 0;
    const nowX = CP_PAD + K.maxPast * CELL + NOW_GAP / 2;
    const trackW = CP_PAD * 2 + (K.maxPast + K.maxFuture) * CELL + NOW_GAP;
    const top = (CP_ROW - CHIP_H) / 2;
    const inset = (CELL - CP_CHIP) / 2;

    let h = '<div class="cp">' +
      (any ? '<div class="now-line" style="left:' + (SIDE_W + nowX) + 'px"></div>' : '') +
      '<div class="head">' + cornerHTML() + '<div class="cp-track" style="width:' + trackW + 'px">' +
      (any ? '<span class="now-label" style="left:' + nowX + 'px">Today</span>' : '') + '</div></div>';
    for (const c of S.classes) {
      const r = K.rows.get(c.id);
      let chips = '';
      r.past.forEach((it, j) => {
        chips += chipHTML(it, 'left:' + (CP_PAD + (K.maxPast - r.past.length + j) * CELL + inset) + 'px;top:' + top + 'px');
      });
      r.future.forEach((it, j) => {
        chips += chipHTML(it, 'left:' + (CP_PAD + K.maxPast * CELL + NOW_GAP + j * CELL + inset) + 'px;top:' + top + 'px');
      });
      h += '<div class="row" data-class="' + esc(c.id) + '" style="height:' + (CP_ROW + 1) + 'px">' + sideHTML(c) +
        '<div class="cp-track" data-class="' + esc(c.id) + '" style="width:' + trackW + 'px">' + chips + '</div></div>';
    }
    h += '<div class="row fill">' + newClassSideHTML() + '<div class="cp-track"></div></div></div>';
    grid.innerHTML = h;
    layout = { view: 'compact', nowX, R: null };
  }

  // ---------------------------------------------------------------- upcoming strip
  function renderStrip() {
    const list = C.upcoming(S, today, 14);
    strip.hidden = !list.length;
    strip.innerHTML = list.map(it => {
      const c = classOf(it.classId);
      const n = C.diffDays(it.date, today);
      const when = n < 0 ? plural(-n, 'day') + ' late' : C.relative(n);
      const cls = (it.type === 'exam' ? 'exam' : 'asg') + (n < 0 ? ' late' : n <= 3 ? ' soon' : '');
      return '<button type="button" class="up ' + cls + '" data-id="' + esc(it.id) + '">' +
        '<span class="ug">' + (it.type === 'exam' ? ICON.exam : ICON.asg) + '</span>' +
        '<span class="ut">' + esc(C.title(it, nums)) + '</span><span class="uw">' + when + '</span>' +
        '<span class="um c' + c.color + '"><i></i><span class="cn">' + esc(c.name) + '</span><span>· ' + C.fmtMedium(it.date) + '</span></span></button>';
    }).join('');
  }

  // ---------------------------------------------------------------- render
  function render() {
    const previous = layout;
    const previousDay = today;
    const active = activeControl();
    const draft = active?.matches('#new-class-input, #rename-input') ? {
      id: active.id, classId: active.closest('.row')?.dataset.class, start: active.selectionStart, end: active.selectionEnd,
    } : null;
    today = C.todayISO();
    nums = C.lectureNumbers(S);
    stat = C.stats(S, today);
    hideCard();
    hideGhost();
    const x = scroller.scrollLeft, y = scroller.scrollTop;
    rendering = true;
    scroller.classList.toggle('timeline', S.settings.view === 'timeline');
    if (S.settings.view === 'timeline') {
      const width = Math.max(1, scroller.clientWidth - SIDE_W);
      WEEK_W = width / Math.max(1, Math.floor(width / MIN_WEEK_W));
      scroller.style.setProperty('--week-w', WEEK_W + 'px');
    }
    renderStrip();
    if (S.settings.view === 'compact') renderCompact(); else renderTimeline();
    if (selectedId !== null) {
      const selected = chipEl(selectedId);
      if (selected) selected.classList.add('selected');
      else selectedId = null;
    }
    scroller.scrollLeft = x;
    scroller.scrollTop = y;
    lastScrollLeft = scroller.scrollLeft;
    const resized = previous.weekWidth !== layout.weekWidth;
    if (view.center || (followToday && (resized || previousDay !== today || previous.nowX !== layout.nowX))) {
      view.center = false;
      scrollToNow(false);
    } else if (previous.R && layout.R && (resized || previous.R.start !== layout.R.start)) {
      const weeks = C.diffDays(previous.R.start, layout.R.start) / 7;
      moveHorizontally((Math.round(x / previous.weekWidth) + weeks) * WEEK_W, false);
    }
    if (!dlg.open && !calendarsDlg.open) {
      const input = view.renaming ? $('#rename-input') : $('#new-class-input');
      if (input) {
        if (draft && draft.id === input.id && draft.classId === input.closest('.row')?.dataset.class) {
          input.replaceWith(active);
          active.focus({ preventScroll: true });
          active.setSelectionRange(draft.start, draft.end);
        } else {
          input.focus({ preventScroll: true });
          if (view.renaming) input.select();
        }
      } else if (active?.classList.contains('chip')) {
        chipEl(active.dataset.id)?.focus({ preventScroll: true });
      }
    }
    rendering = false;
    syncNative();
  }

  const trackViewport = () => Math.max(120, scroller.clientWidth - SIDE_W);
  function moveHorizontally(left, smooth) {
    left = Math.max(0, Math.min(left, scroller.scrollWidth - scroller.clientWidth));
    plannedScroll = left;
    if (smooth && !reduceMotion.matches) scroller.scrollTo({ left, behavior: 'smooth' });
    else scroller.scrollLeft = left;
    lastScrollLeft = scroller.scrollLeft;
    if (Math.abs(lastScrollLeft - left) < 1) plannedScroll = null;
  }
  function scrollToX(x, fraction, smooth) {
    let left = Math.max(0, x - trackViewport() * fraction);
    if (layout.view === 'timeline') left = Math.round(left / WEEK_W) * WEEK_W;
    followToday = false;
    moveHorizontally(left, smooth);
  }
  function scrollToNow(smooth) {
    followToday = true;
    if (layout.view === 'timeline') {
      const visibleWeeks = Math.round((scroller.clientWidth - SIDE_W) / WEEK_W);
      const left = Math.max(0, C.weekIndex(today, layout.R.start) - Math.max(0, visibleWeeks - 2)) * WEEK_W;
      moveHorizontally(left, smooth);
    } else moveHorizontally(layout.nowX - trackViewport() * 0.66, smooth);
  }

  // Follow today after launch or Today; otherwise preserve the first visible week.
  let observedWidth = scroller.clientWidth;
  new ResizeObserver(() => {
    const width = scroller.clientWidth;
    if (!ready || width === observedWidth) return;
    observedWidth = width;
    if (layout.view !== 'timeline') {
      if (followToday) scrollToNow(false);
      return;
    }
    render();
  }).observe(scroller);

  const chipEl = id => grid.querySelector('.chip[data-id="' + CSS.escape(id) + '"]');

  // Brings a chip into view if it is not already, and optionally flashes it.
  function reveal(id, pulse) {
    const el = chipEl(id);
    if (!el) return false;
    const x = el.offsetLeft + el.offsetWidth / 2;
    if (x < scroller.scrollLeft + 30 || x > scroller.scrollLeft + trackViewport() - 30) scrollToX(x, 0.5, true);
    const headH = layout.view === 'timeline' ? HEAD_H : CP_HEAD;
    const bounds = scroller.getBoundingClientRect(), rect = el.getBoundingClientRect();
    if (rect.top < bounds.top + headH) scroller.scrollTop += rect.top - bounds.top - headH;
    else if (rect.bottom > bounds.top + scroller.clientHeight) scroller.scrollTop += rect.bottom - bounds.top - scroller.clientHeight;
    if (pulse) {
      el.classList.add('pulse');
      setTimeout(() => el.classList.remove('pulse'), 1500);
    }
    return true;
  }

  function setView(v) {
    if (!C.VIEWS.includes(v) || v === S.settings.view) return;
    S.settings.view = v;
    view.center = true;
    persist();
    render();
  }

  // ---------------------------------------------------------------- item actions
  const itemTypeName = it => it.type[0].toUpperCase() + it.type.slice(1);

  function toggle(id) {
    const it = find(id);
    if (it) commit(it.done ? 'Mark as Not Done' : 'Mark as Done', () => { it.done = !it.done; });
  }

  async function openURL(url) {
    try { if (await call('open', { url })) return; }
    catch (_) { /* Report failed opens, including bridge failures. */ }
    await call('alert', { title: 'This link couldn’t be opened.', message: url });
  }

  function openLink(id) {
    const it = find(id);
    if (it && it.link) openURL(C.normalizeLink(it.link));
  }

  function deleteItem(it, label = 'Delete') {
    const name = C.title(it, nums);
    commit(label, () => C.removeItems(S, x => x.id === it.id));
    toast('Deleted ' + name);
  }

  async function itemAction(id, action) {
    const it = find(id);
    if (!it) return;
    switch (action) {
      case 'open': openLink(id); break;
      case 'toggle': toggle(id); break;
      case 'edit': openItem(id); break;
      case 'through': {
        const n = commit('Mark Done', () => C.markThrough(S, id));
        if (n > 1) toast(plural(n, 'lecture') + ' marked done');
        break;
      }
      case 'delete': deleteItem(it); break;
      case 'delete-following': {
        if (it.type !== 'lecture') return;
        const classId = it.classId;
        const list = C.classLectures(S, it.classId);
        const approved = new Set(list.slice(list.findIndex(x => x.id === id)).map(x => x.id));
        const ok = await call('confirm', {
          title: 'Delete ' + plural(approved.size, 'lecture') + '?',
          message: C.title(it, nums) + ' and everything after it in ' + classOf(it.classId).name + '.',
          confirm: 'Delete', destructive: true,
        });
        if (!ok || find(id)?.classId !== classId) return;
        const n = commit('Delete Lectures', () => C.removeFollowing(S, id, approved));
        if (n) toast('Deleted ' + plural(n, 'lecture'));
        break;
      }
    }
  }

  async function itemMenu(id) {
    const it = find(id);
    if (!it) return;
    hideCard();
    const lecture = it.type === 'lecture';
    const pick = await call('menu', {
      items: [
        it.link ? { id: 'open', title: 'Open Link' } : null,
        { id: 'toggle', title: it.done ? 'Mark as Not Done' : 'Mark as Done' },
        lecture ? { id: 'through', title: 'Mark Done Through Here' } : null,
        { separator: true },
        { id: 'edit', title: 'Edit…' },
        { separator: true },
        { id: 'delete', title: 'Delete' },
        lecture ? { id: 'delete-following', title: 'Delete This and Following…' } : null,
      ].filter(Boolean),
    });
    if (pick) itemAction(id, pick);
  }

  // ---------------------------------------------------------------- class actions
  async function classAction(classId, action) {
    const c = classOf(classId);
    if (!c) return;
    switch (action) {
      case 'add': openItem(null, { classId }); break;
      case 'rename': view.renaming = classId; view.addingClass = false; render(); break;
      case 'color': commit('Change Color', () => { c.color = (c.color + 1) % C.COLOR_COUNT; }); break;
      case 'up': commit('Move Class', () => C.moveClass(S, classId, -1)); break;
      case 'down': commit('Move Class', () => C.moveClass(S, classId, 1)); break;
      case 'catch-up': {
        const n = commit('Mark Done', () => C.markPastDone(S, classId, today));
        if (n) toast(plural(n, 'lecture') + ' marked done');
        break;
      }
      case 'first-behind': {
        const first = stat.get(classId).firstBehind;
        if (first) reveal(first.id, true);
        break;
      }
      case 'delete': {
        let approved;
        do {
          approved = new Set(S.items.filter(it => it.classId === classId).map(it => it.id));
          if (!approved.size) break;
          const ok = await call('confirm', {
            title: 'Delete ' + c.name + '?',
            message: 'Its ' + plural(approved.size, 'item') + ' will be deleted too.',
            confirm: 'Delete', destructive: true,
          });
          if (!ok || classOf(classId) !== c) return;
        } while (S.items.some(it => it.classId === classId && !approved.has(it.id)));
        commit('Delete Class', () => C.removeClass(S, classId));
        toast('Deleted ' + c.name);
        break;
      }
    }
  }

  async function classMenu(classId) {
    const s = stat.get(classId);
    const i = S.classes.findIndex(c => c.id === classId);
    if (i < 0) return;
    const pick = await call('menu', {
      items: [
        { id: 'add', title: 'Add Item…' },
        s.behind ? { id: 'catch-up', title: 'Mark ' + plural(s.behind, 'Past Lecture') + ' Done' } : null,
        { separator: true },
        { id: 'rename', title: 'Rename' },
        { id: 'up', title: 'Move Up', disabled: i === 0 },
        { id: 'down', title: 'Move Down', disabled: i === S.classes.length - 1 },
        { separator: true },
        { id: 'delete', title: 'Delete Class…' },
      ].filter(Boolean),
    });
    if (pick) classAction(classId, pick);
  }

  function startNewClass() {
    view.addingClass = true;
    view.renaming = null;
    render();
    scroller.scrollTop = scroller.scrollHeight;
  }

  function finishRename(save) {
    const id = view.renaming;
    if (!id) return;
    const input = $('#rename-input');
    const name = input ? input.value.trim().slice(0, 80) : '';
    const c = classOf(id);
    view.renaming = null;
    if (save && c && name && name !== c.name) commit('Rename Class', () => { c.name = name; });
    else render();
  }

  // ---------------------------------------------------------------- grid events
  // Which class and week a point in a row stands for.
  function slotAt(track, e) {
    const classId = track.dataset.class;
    if (!layout.R) return { classId, type: 'lecture', date: today };
    const r = track.getBoundingClientRect();
    const index = Math.max(0, Math.min(layout.R.weeks - 1, Math.floor((e.clientX - r.left) / WEEK_W)));
    return { classId, index, type: 'lecture', date: C.weekDate(layout.R.start, index, today) };
  }

  let lastToggle = null;
  let quietChip = null; // no hover card for the chip that was just clicked, until the pointer leaves it

  function selectChip(id) {
    const chip = id === null ? null : chipEl(id);
    const nextId = chip ? id : null;
    if (nextId === selectedId) return;
    if (selectedId !== null) chipEl(selectedId)?.classList.remove('selected');
    selectedId = nextId;
    chip?.classList.add('selected');
  }

  function clearSelection() {
    selectChip(null);
    $('.chip:focus', grid)?.blur();
  }

  const HOLD_MS = 350, DRAG_PX = 4;
  let press = null, suppressPressClick = false;
  const dropMarker = document.createElement('div');
  dropMarker.className = 'drop-target';

  function clearDragVisuals(current) {
    dropMarker.remove();
    if (current.preview) {
      current.preview.remove();
      current.chip.classList.remove('drag-source');
    }
  }
  function endPress() {
    clearTimeout(press.timer);
    clearDragVisuals(press);
    press = null;
  }
  function hold(current) {
    current.held = true;
    current.previousSelection = selectedId;
    lastToggle = null;
    if (!current.chip.isConnected || dlg.open || calendarsDlg.open) return;
    selectChip(current.id);
    hideCard();
    quietChip = current.id;
  }
  function pastDragThreshold(current, e) {
    return Math.hypot(e.clientX - current.x, e.clientY - current.y) >= DRAG_PX;
  }
  function markMoved(current) {
    current.moved = true;
    clearTimeout(current.timer);
    // A slow drag can cross the threshold after the hold ring appeared.
    if (current.held && selectedId === current.id) selectChip(current.previousSelection);
    lastToggle = null;
  }
  function dragTarget(e) {
    const viewport = scroller.getBoundingClientRect();
    if (e.clientX < viewport.left || e.clientX >= viewport.right || e.clientY < viewport.top || e.clientY >= viewport.bottom) return null;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const track = el && el.closest('.track[data-class]');
    if (!track || !grid.contains(track)) return null;
    const r = track.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) return null;
    return { track, slot: slotAt(track, e) };
  }
  grid.addEventListener('pointerdown', e => {
    const chip = e.target.closest('.chip');
    if (!chip || e.button !== 0 || press) return;
    press = { id: chip.dataset.id, chip, pointerId: e.pointerId, x: e.clientX, y: e.clientY, start: e.timeStamp };
    const current = press;
    current.timer = setTimeout(() => hold(current), HOLD_MS);
  });
  document.addEventListener('pointermove', e => {
    const current = press;
    if (!current || e.pointerId !== current.pointerId || current.cancelled) return;
    if (!current.moved) {
      if (!pastDragThreshold(current, e)) return;
      markMoved(current);
      if (!current.chip.classList.contains('week-chip') || !current.chip.isConnected) return;
      hideCard();
      hideGhost();
      const r = current.chip.getBoundingClientRect();
      current.offsetX = current.x - r.left;
      current.offsetY = current.y - r.top;
      current.preview = current.chip.cloneNode(true);
      current.preview.classList.remove('selected');
      current.preview.classList.add('drag-preview');
      current.preview.style.width = r.width + 'px';
      document.body.appendChild(current.preview);
      current.chip.classList.add('drag-source');
    }
    if (!current.preview) return;
    e.preventDefault();
    current.preview.style.left = (e.clientX - current.offsetX) + 'px';
    current.preview.style.top = (e.clientY - current.offsetY) + 'px';
    const target = dragTarget(e);
    if (target) {
      dropMarker.style.left = target.slot.index * WEEK_W + 'px';
      target.track.appendChild(dropMarker);
    } else dropMarker.remove();
  });
  document.addEventListener('pointerup', e => {
    const current = press;
    if (!current || e.pointerId !== current.pointerId) return;
    if (!current.cancelled && !current.moved) {
      if (pastDragThreshold(current, e)) markMoved(current);
      else if (!current.held && e.timeStamp - current.start >= HOLD_MS) hold(current);
    }
    const target = current.preview && !current.cancelled && current.chip.isConnected ? dragTarget(e) : null;
    endPress();
    if (!current.held && !current.moved && !current.cancelled) return;
    // WebKit can send a click after pointerup even after a hold or drag.
    suppressPressClick = true;
    setTimeout(() => { suppressPressClick = false; }, 0);
    e.preventDefault();
    if (target) {
      const it = find(current.id);
      if (it) {
        const week = C.addDays(layout.R.start, target.slot.index * 7);
        commit('Move ' + itemTypeName(it), () => C.moveItemToWeek(S, current.id, target.slot.classId, week));
      }
    }
  });
  document.addEventListener('pointercancel', e => {
    if (!press || e.pointerId !== press.pointerId) return;
    if (press.held && !press.moved && selectedId === press.id) selectChip(press.previousSelection);
    endPress();
  });
  window.addEventListener('blur', () => {
    if (press) endPress();
  });
  document.addEventListener('keydown', e => {
    const escape = e.key === 'Escape';
    if (!escape && e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (e.defaultPrevented || e.isComposing || dlg.open || calendarsDlg.open) return;
    const active = activeControl();
    if (active && (active.matches('input, textarea, select') || active.isContentEditable)) return;
    const focused = active?.matches('#grid .chip') ? active : null;
    if (escape) {
      if (selectedId === null && !focused && !press) return;
      e.preventDefault();
      if (press) {
        if (press.preview) e.stopPropagation();
        press.cancelled = true;
        clearTimeout(press.timer);
        clearDragVisuals(press);
      }
      clearSelection();
    } else {
      if (e.altKey || e.ctrlKey || e.shiftKey) return;
      const it = find(selectedId ?? focused?.dataset.id);
      if (!it) return;
      e.preventDefault();
      deleteItem(it, 'Delete ' + itemTypeName(it));
    }
  }, true);
  grid.addEventListener('dragstart', e => { if (e.target.closest('.week-chip')) e.preventDefault(); });
  document.addEventListener('click', e => {
    if (!suppressPressClick || e.detail === 0) return;
    suppressPressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('click', e => {
    if (e.target instanceof Element && !e.target.closest('button, input, select, textarea, a, [contenteditable], [data-act], #card, dialog')) clearSelection();
  });
  grid.addEventListener('focusin', e => {
    if (!press && !rendering && e.target.matches('.chip') && e.target.dataset.id !== selectedId) selectChip(null);
  });

  grid.addEventListener('click', e => {
    const add = e.target.closest('.ghost');
    if (add) {
      const track = add.closest('.track');
      if (track && track.dataset.class) {
        const index = +add.dataset.index;
        openItem(null, { classId: track.dataset.class, date: C.weekDate(layout.R.start, index, today), type: 'lecture' });
      }
      return;
    }
    const chip = e.target.closest('.chip');
    if (chip) {
      const id = chip.dataset.id;
      if (selectedId !== id) selectChip(null);
      hideCard();
      quietChip = id;
      if (e.metaKey) { openLink(id); return; }
      if (e.detail > 1 && lastToggle?.id === id && lastToggle.detail === e.detail - 1) {
        // The first click of a double-click already toggled the item; take that back and edit.
        if (undoStack[undoStack.length - 1] === lastToggle.entry) {
          restore(JSON.parse(undoStack.pop().data));
          if (lastToggle.evicted) undoStack.unshift(lastToggle.evicted);
          redoStack.push(...lastToggle.redo);
          persist();
          render();
        }
        lastToggle = null;
        openItem(id);
        return;
      }
      const redo = redoStack.slice();
      const evicted = undoStack.length === 200 ? undoStack[0] : null;
      toggle(id);
      lastToggle = { id, detail: e.detail, entry: undoStack[undoStack.length - 1], redo, evicted };
      return;
    }

    const act = e.target.closest('[data-act]');
    if (act) {
      const row = act.closest('.row');
      const classId = row && row.dataset.class;
      const name = act.dataset.act;
      if (name === 'new-class') { view.addingClass = true; view.renaming = null; render(); }
      else if (name === 'class-menu') classMenu(classId);
      else if (name === 'rename') { if (e.detail === 2) classAction(classId, 'rename'); }
      else classAction(classId, name);
      return;
    }

    if (e.detail === 2) {
      const track = e.target.closest('.track, .cp-track');
      if (track && track.dataset.class) {
        const s = slotAt(track, e);
        openItem(null, { classId: s.classId, date: s.date, type: s.type });
      }
    }
  });

  grid.addEventListener('contextmenu', async e => {
    if (e.target.closest('input')) return;
    e.preventDefault();
    const chip = e.target.closest('.chip');
    if (chip) { itemMenu(chip.dataset.id); return; }
    const row = e.target.closest('.row');
    const classId = row && row.dataset.class;
    if (!classId) return;
    if (e.target.closest('.side')) { classMenu(classId); return; }
    const track = e.target.closest('.track, .cp-track');
    if (!track) return;
    const s = slotAt(track, e);
    const on = layout.R ? ' on ' + C.fmtMedium(s.date) : '';
    const pick = await call('menu', {
      items: [
        { id: 'lecture', title: 'New Lecture' + on + '…' },
        { id: 'assignment', title: 'New Assignment' + on + '…' },
        { id: 'exam', title: 'New Exam' + on + '…' },
      ],
    });
    if (pick) openItem(null, { classId, date: s.date, type: pick });
  });

  grid.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    if (t.id === 'new-class-input') {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = t.value.trim();
        if (name) {
          t.value = '';
          delete t.dataset.typing;
          view.addingClass = true;
          commit('Add Class', () => C.addClass(S, name));
          scroller.scrollTop = scroller.scrollHeight;
        }
      } else if (e.key === 'Escape') {
        t.value = '';
        t.blur();
      }
    } else if (t.id === 'rename-input') {
      if (e.key === 'Enter') { e.preventDefault(); finishRename(true); }
      else if (e.key === 'Escape') finishRename(false);
    }
  });

  grid.addEventListener('input', e => {
    if (e.target.id === 'new-class-input') { e.target.dataset.typing = 'true'; syncNative(); }
  });

  grid.addEventListener('focusout', e => {
    const t = e.target;
    if (rendering || !t.isConnected) return;
    if (t.id === 'new-class-input') {
      const name = t.value.trim();
      const wasOpen = view.addingClass;
      view.addingClass = false;
      if (name) commit('Add Class', () => C.addClass(S, name));
      else if (wasOpen && S.classes.length) render();
    } else if (t.id === 'rename-input') {
      finishRename(true);
    }
  });

  // The add button follows the hovered week, with its range lit in the ruler.
  const ghost = document.createElement('button');
  ghost.type = 'button';
  ghost.setAttribute('aria-label', 'Add item to week');
  ghost.className = 'ghost';
  ghost.innerHTML = ICON.plus;
  let litDay = null;

  function hideGhost() {
    ghost.remove();
    if (litDay) { litDay.classList.remove('lit'); litDay = null; }
  }

  grid.addEventListener('mousemove', e => {
    const track = e.target.closest('.track');
    if (!track || !track.dataset.class || e.target.closest('.chip') || e.buttons) { hideGhost(); return; }
    const s = slotAt(track, e);
    ghost.dataset.index = s.index;
    ghost.style.left = (s.index + 1) * WEEK_W - 33 + 'px';
    if (ghost.parentNode !== track) track.appendChild(ghost);
    const day = $('.weeks', grid).children[s.index];
    if (day !== litDay) {
      if (litDay) litDay.classList.remove('lit');
      litDay = day;
      if (day) day.classList.add('lit');
    }
  });
  grid.addEventListener('mouseleave', hideGhost);

  // ---------------------------------------------------------------- hover card
  let cardFor = null, cardTimer = 0, cardHideTimer = 0, cardShownAt = -1e9;

  function hideCard() {
    clearTimeout(cardTimer);
    clearTimeout(cardHideTimer);
    if (!card.hidden) cardShownAt = performance.now();
    card.hidden = true;
    cardFor = null;
  }
  function hideCardSoon() {
    clearTimeout(cardHideTimer);
    cardHideTimer = setTimeout(hideCard, 140);
  }

  function showCard(id) {
    const it = find(id);
    const el = chipEl(id);
    if (!it || !el || dlg.open) return;
    const n = C.diffDays(it.date, today);
    const st = C.status(it, today);
    let when = C.fmtMedium(it.date) + ' · ';
    if (st === 'late') when += '<span class="bad">' + plural(-n, 'day') + ' late</span>';
    else if (st === 'behind') when += '<span class="warn">' + C.relative(n) + '</span>';
    else when += C.relative(n) + (st === 'done' ? ' · done' : '');
    card.innerHTML =
      '<div class="ch"><div class="ct"><div class="c1">' + esc(C.title(it, nums)) + '</div><div class="c2">' + when + '</div></div>' +
      '<button type="button" class="edit" data-card="edit" aria-label="Edit">' + ICON.pencil + '</button></div>' +
      (it.link ? '<button type="button" class="open" data-card="open"><span>' + esc(C.linkLabel(it.link)) + '</span>' + ICON.arrow + '</button>' : '');
    card.hidden = false;
    cardFor = id;
    const r = el.getBoundingClientRect();
    const top = r.top - card.offsetHeight - 7;
    const below = top < scroller.getBoundingClientRect().top + (layout.view === 'timeline' ? HEAD_H : CP_HEAD) + 2;
    card.classList.toggle('below', below);
    card.style.top = Math.round(below ? r.bottom + 7 : top) + 'px';
    card.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - card.offsetWidth - 8, r.left + r.width / 2 - card.offsetWidth / 2))) + 'px';
  }

  grid.addEventListener('mouseover', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const id = chip.dataset.id;
    if (quietChip === id) return;
    quietChip = null;
    clearTimeout(cardHideTimer);
    if (cardFor === id) return;
    clearTimeout(cardTimer);
    const warm = cardFor !== null || performance.now() - cardShownAt < 400;
    cardTimer = setTimeout(() => showCard(id), warm ? 70 : 320);
  });
  grid.addEventListener('mouseout', e => {
    const chip = e.target.closest('.chip');
    if (!chip || (e.relatedTarget && chip.contains(e.relatedTarget))) return;
    if (quietChip === chip.dataset.id) quietChip = null;
    clearTimeout(cardTimer);
    hideCardSoon();
  });
  card.addEventListener('mouseenter', () => clearTimeout(cardHideTimer));
  card.addEventListener('mouseleave', hideCardSoon);
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-card]');
    const id = cardFor;
    if (!b || !id) return;
    hideCard();
    if (b.dataset.card === 'open') openLink(id); else openItem(id);
  });

  scroller.addEventListener('scroll', () => {
    hideCard(); hideGhost();
    const left = scroller.scrollLeft;
    if (plannedScroll !== null) {
      if (Math.abs(left - plannedScroll) < 1) plannedScroll = null;
      lastScrollLeft = left;
    } else if (Math.abs(left - lastScrollLeft) > 1) {
      followToday = false;
      lastScrollLeft = left;
    }
  }, { passive: true });
  // Horizontal input may interrupt an in-progress smooth Today scroll.
  scroller.addEventListener('wheel', e => {
    const notched = e.wheelDeltaY && Math.abs(e.wheelDeltaY) >= 120 && e.wheelDeltaY % 120 === 0;
    if (e.deltaX || e.shiftKey || (notched && scroller.scrollHeight <= scroller.clientHeight + 1)) plannedScroll = null;
  }, { passive: true });
  scroller.addEventListener('pointerdown', e => { if (e.target === scroller) plannedScroll = null; }, { passive: true });
  scroller.addEventListener('keydown', e => {
    if (e.target === scroller && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) plannedScroll = null;
  });

  // A plain mouse wheel only scrolls vertically; when there is nothing to scroll that way,
  // let it move through time instead. Trackpads (fine-grained deltas) are left alone.
  scroller.addEventListener('wheel', e => {
    if (e.deltaX || e.shiftKey || e.ctrlKey || !e.deltaY) return;
    const notched = e.wheelDeltaY && Math.abs(e.wheelDeltaY) >= 120 && e.wheelDeltaY % 120 === 0;
    if (!notched || scroller.scrollHeight > scroller.clientHeight + 1) return;
    e.preventDefault();
    scroller.scrollLeft += e.deltaY;
  }, { passive: false });

  // ---------------------------------------------------------------- upcoming strip events
  strip.addEventListener('click', e => {
    const b = e.target.closest('.up');
    if (!b) return;
    const id = b.dataset.id;
    if (e.metaKey) { openLink(id); return; }
    if (S.settings.view !== 'timeline') setView('timeline');
    if (!reveal(id, true)) openItem(id);
  });
  strip.addEventListener('contextmenu', e => {
    e.preventDefault();
    const b = e.target.closest('.up');
    if (b) itemMenu(b.dataset.id);
  });

  // ---------------------------------------------------------------- toast
  let toastTimer = 0;
  function toast(text) {
    $('#toast-text').textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.hidden = true;
  }
  $('#toast-undo').addEventListener('click', () => undo());

  // ---------------------------------------------------------------- item dialog
  const f = form.elements;
  const weekdaysEl = $('#weekdays');
  const repeatDays = new Set();
  let editingId = null;
  const dateDaysEl = $('#date-days');
  let datePickerMin = C.RANGE_MIN, datePickerMax = C.RANGE_MAX;

  function renderDatePicker() {
    const selected = f.date.value;
    const monday = C.mondayOf(selected);
    const lastDay = Math.min(6, C.diffDays('9999-12-31', monday));
    const sunday = C.addDays(monday, lastDay);
    const month = date => C.fmtShort(date).split(' ')[0];
    $('#week-label').textContent = C.fmtShort(monday) + '–' +
      (month(monday) === month(sunday) && monday.slice(0, 4) === sunday.slice(0, 4) ? +sunday.slice(8, 10) : C.fmtShort(sunday));
    $('#week-prev').disabled = monday <= datePickerMin;
    $('#week-next').disabled = C.diffDays(datePickerMax, monday) < 7;
    dateDaysEl.innerHTML = C.WEEKDAYS.map((name, i) => {
      if (i > lastDay) return '<span></span>';
      const date = C.addDays(monday, i);
      return '<label><input type="radio" name="day" value="' + date + '"' +
        (date === selected ? ' checked' : '') + (date < datePickerMin || date > datePickerMax ? ' disabled' : '') +
        '><span>' + name + '<small>' + (+date.slice(8, 10)) + '</small></span></label>';
    }).join('');
  }

  function stepWeek(delta) {
    const selected = f.date.value;
    const offset = Math.max(C.diffDays(datePickerMin, selected), Math.min(delta * 7, C.diffDays(datePickerMax, selected)));
    f.date.value = C.addDays(selected, offset);
    renderDatePicker();
    refreshForm();
  }
  $('#week-prev').addEventListener('click', () => stepWeek(-1));
  $('#week-next').addEventListener('click', () => stepWeek(1));
  dateDaysEl.addEventListener('change', e => {
    if (e.target.name !== 'day') return;
    f.date.value = e.target.value;
    refreshForm();
  });

  weekdaysEl.innerHTML = C.WEEKDAYS.map((name, i) => '<button type="button" data-wd="' + i + '" aria-pressed="false" aria-label="' + name + '">' + name[0] + '</button>').join('');

  function defaultClassId() {
    return classOf(view.lastClassId) ? view.lastClassId : S.classes[0].id;
  }

  function openItem(id, preset) {
    if (dlg.open) return;
    if (!S.classes.length) { startNewClass(); return; }
    const it = id ? find(id) : null;
    if (id && !it) return;
    editingId = it ? it.id : null;
    const v = it || Object.assign({ type: 'lecture', classId: defaultClassId(), date: today, title: '', link: '', done: false }, preset);
    f.classId.innerHTML = S.classes.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('');
    f.classId.value = v.classId;
    f.type.value = v.type;
    // Imported items may be outside the normal add range; retain their week when editing.
    datePickerMin = it && v.date < C.RANGE_MIN ? C.mondayOf(v.date) : C.RANGE_MIN;
    datePickerMax = it && v.date > C.RANGE_MAX ? C.addDays(v.date, Math.min(6 - C.weekday(v.date), C.diffDays('9999-12-31', v.date))) : C.RANGE_MAX;
    f.date.value = v.date < datePickerMin ? datePickerMin : v.date > datePickerMax ? datePickerMax : v.date;
    f.until.min = C.RANGE_MIN;
    f.until.max = C.RANGE_MAX;
    renderDatePicker();
    f.title.value = v.title;
    f.link.value = v.link;
    f.done.checked = v.done;
    f.until.value = '';
    repeatDays.clear();
    $('#item-delete').hidden = !it;
    refreshForm();
    hideCard();
    hideGhost();
    dlg.showModal();
    f.title.focus();
    syncNative();
  }

  const isSeries = () => !editingId && repeatDays.size > 0;

  // The dates a repeat would actually add (lectures never double up on a day).
  function seriesDates() {
    const taken = f.type.value === 'lecture'
      ? new Set(S.items.filter(it => it.classId === f.classId.value && it.type === 'lecture').map(it => it.date)) : null;
    return C.recurrence(f.date.value, f.until.value, Array.from(repeatDays), taken);
  }

  function refreshForm() {
    const type = f.type.value;
    const series = isSeries();
    $('#repeat').hidden = !!editingId;
    if (series && !f.until.value && C.isISO(f.date.value)) {
      const suggested = C.addDays(f.date.value, 13 * 7 - 1);
      f.until.value = suggested > datePickerMax ? datePickerMax : suggested;
    }
    for (const b of weekdaysEl.children) b.setAttribute('aria-pressed', repeatDays.has(+b.dataset.wd));
    f.until.disabled = !series;

    if (type === 'lecture') {
      const n = editingId && find(editingId).type === 'lecture' && find(editingId).classId === f.classId.value && find(editingId).date === f.date.value
        ? nums.get(editingId)
        : 1 + S.items.filter(it => it.id !== editingId && it.classId === f.classId.value && it.type === 'lecture' && it.date <= f.date.value).length;
      f.title.placeholder = 'Lecture ' + n;
    } else f.title.placeholder = type === 'exam' ? 'Exam' : series ? 'Assignment 1, 2, 3…' : 'Assignment';

    $('#done-label').textContent = series ? 'Mark past ones done' : 'Done';
    $('#link-open').hidden = !f.link.value.trim();
    const save = $('#item-save');
    const count = series ? seriesDates().length : 1;
    save.textContent = editingId ? 'Save' : series ? 'Add ' + count : 'Add';
    save.disabled = count === 0;
  }

  form.addEventListener('input', refreshForm);
  form.addEventListener('change', refreshForm);
  weekdaysEl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const wd = +b.dataset.wd;
    if (repeatDays.has(wd)) repeatDays.delete(wd); else repeatDays.add(wd);
    refreshForm();
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!C.isISO(f.date.value) || f.date.value < datePickerMin || f.date.value > datePickerMax || !classOf(f.classId.value)) { const day = dateDaysEl.querySelector('input:checked'); if (day) day.focus(); return; }
    const base = {
      classId: f.classId.value,
      type: f.type.value,
      title: f.title.value.trim(),
      date: f.date.value,
      done: f.done.checked,
      link: C.normalizeLink(f.link.value),
    };
    view.lastClassId = base.classId;
    let show = null;
    let message = '';
    if (editingId) {
      const id = editingId;
      commit('Edit', () => { const it = find(id); if (it) window.Calendar.editItem(it, base); });
      show = id;
    } else if (isSeries()) {
      const dates = seriesDates();
      if (!dates.length) return;
      const added = commit('Add', () => C.addSeries(S, base, dates, { today }));
      show = added[0].id;
      message = 'Added ' + plural(added.length, base.type);
    } else {
      const it = Object.assign({ id: C.uid() }, base);
      commit('Add', () => { S.items.push(it); });
      show = it.id;
    }
    const added = !editingId;
    dlg.close();
    if (message) toast(message);
    if (show) reveal(show, added && !message);
  });

  $('#item-cancel').addEventListener('click', () => dlg.close());
  $('#item-delete').addEventListener('click', () => {
    const id = editingId;
    dlg.close();
    itemAction(id, 'delete');
  });
  $('#link-open').addEventListener('click', () => {
    const url = C.normalizeLink(f.link.value);
    if (url) openURL(url);
  });
  dlg.addEventListener('mousedown', e => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  });
  dlg.addEventListener('close', () => { if (!dlg.open) editingId = null; syncNative(); });

  // ---------------------------------------------------------------- calendars
  const calendarsDlg = $('#calendars-dlg'), calendarForm = $('#calendar-form');
  const calendarList = $('#calendar-list'), calendarUnmatched = $('#calendar-unmatched');
  const calendarError = $('#calendar-error'), calendarSkipped = $('#calendar-skipped');
  const calendarNotices = $('#calendar-notices'), calendarURL = calendarForm.elements.url;
  let calendarFormBusy = false;
  let calendarClassOptions = '';

  function calendarOptions(auto) {
    return (auto ? '<option value="">Auto</option>' : '') + S.classes.map(c =>
      '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('');
  }

  function refreshCalendars() {
    if (!calendarsDlg.open || !window.CalendarUIHooks) return;
    const data = window.CalendarUIHooks.list();
    const picker = calendarForm.elements.classId;
    const options = calendarOptions(true);
    if (calendarClassOptions !== options) {
      const selected = picker.value;
      calendarClassOptions = options;
      picker.innerHTML = options;
      picker.value = classOf(selected) ? selected : '';
    }
    calendarList.innerHTML = data.feeds.map(feed => {
      const cls = classOf(feed.classId);
      const when = feed.syncing ? 'Syncing…' : feed.lastSynced && !isNaN(Date.parse(feed.lastSynced))
        ? new Date(feed.lastSynced).toLocaleString() : 'Never synced';
      return '<div class="calendar-row"><div class="calendar-info"><div class="calendar-url" title="' + esc(feed.url) + '">' + esc(feed.url) + '</div><div class="calendar-meta">' + esc(cls ? cls.name : 'Auto') + ' · ' + esc(when) + (feed.error ? ' · ' + esc(feed.error) : '') + '</div></div>' +
        '<button type="button" data-calendar-action="sync" data-id="' + esc(feed.id) + '"' + (feed.syncing ? ' disabled' : '') + '>Sync</button><button type="button" data-calendar-action="remove" data-id="' + esc(feed.id) + '">Remove</button></div>';
    }).join('');
    const previousAssignment = $('#calendar-assign-class')?.value;
    const count = data.unmatched;
    calendarUnmatched.hidden = !count;
    calendarUnmatched.innerHTML = count ? '<div>' + plural(count, 'unmatched event') + '</div>' +
      '<label class="field"><span>Assign to</span><span class="with-btn"><select id="calendar-assign-class">' + calendarOptions(false) + '</select><button type="button" data-calendar-action="assign"' + (S.classes.length ? '' : ' disabled') + '>Assign</button></span></label>' : '';
    if (count && classOf(previousAssignment)) $('#calendar-assign-class').value = previousAssignment;
    calendarSkipped.hidden = !data.skipped.length;
    calendarSkipped.querySelector('summary').textContent = data.skipped.length + ' skipped';
    calendarNotices.innerHTML = calendarSkipped.open ? data.skipped.map((event, index) =>
      '<div class="calendar-row"><div class="calendar-info"><div>' + esc(event.title || 'Untitled event') + '</div>' +
      '<div class="calendar-meta">' + esc(C.fmtMedium(event.date)) + '</div></div>' +
      '<button type="button" data-notice-index="' + index + '">Import</button></div>').join('') : '';
    calendarForm.querySelectorAll('input, select, button:not(#calendar-close)').forEach(el => { el.disabled = calendarFormBusy; });
  }

  function clearCalendarError() {
    calendarError.textContent = '';
    calendarError.hidden = true;
  }

  async function calendarFormAction(action) {
    if (calendarFormBusy) return;
    calendarFormBusy = true;
    clearCalendarError();
    refreshCalendars();
    try {
      const notice = await action(window.CalendarUIHooks);
      if (notice) {
        calendarError.textContent = notice;
        calendarError.hidden = false;
      }
    }
    catch (error) {
      calendarError.textContent = error && error.message ? error.message : 'Calendar failed.';
      calendarError.hidden = false;
    }
    finally { calendarFormBusy = false; refreshCalendars(); }
  }

  function openCalendars() {
    if (!window.CalendarUIHooks || calendarsDlg.open) return;
    clearCalendarError();
    calendarSkipped.open = false;
    calendarsDlg.showModal();
    refreshCalendars();
    calendarURL.focus();
    syncNative();
  }
  calendarForm.addEventListener('input', clearCalendarError);
  calendarURL.addEventListener('paste', e => {
    const value = e.clipboardData?.getData('text/plain');
    const replacing = !calendarURL.value || (calendarURL.selectionStart === 0 && calendarURL.selectionEnd === calendarURL.value.length);
    if (value && value !== value.trim() && replacing) {
      e.preventDefault();
      calendarURL.value = value.trim();
      clearCalendarError();
    }
  });
  calendarForm.addEventListener('submit', e => {
    e.preventDefault();
    const classId = calendarForm.elements.classId.value;
    calendarFormAction(async hooks => {
      await hooks.add(calendarURL.value, classId);
      calendarURL.value = '';
      calendarForm.elements.classId.value = '';
    });
  });
  calendarList.addEventListener('click', e => {
    const button = e.target.closest('[data-calendar-action]');
    if (button && !button.disabled) {
      clearCalendarError();
      window.CalendarUIHooks[button.dataset.calendarAction](button.dataset.id);
    }
  });
  calendarUnmatched.addEventListener('click', e => {
    const button = e.target.closest('[data-calendar-action="assign"]');
    if (button && !button.disabled) window.CalendarUIHooks.assign($('#calendar-assign-class').value);
  });
  calendarSkipped.addEventListener('toggle', refreshCalendars);
  calendarNotices.addEventListener('click', e => {
    const button = e.target.closest('[data-notice-index]');
    if (button) {
      const note = S.calendarSkipped[+button.dataset.noticeIndex];
      if (note) window.CalendarUIHooks.importNotice(note);
    }
  });
  $('#calendar-import').addEventListener('click', () => {
    const classId = calendarForm.elements.classId.value;
    calendarFormAction(hooks => hooks.importFile(classId));
  });
  $('#calendar-close').addEventListener('click', () => calendarsDlg.close());
  calendarsDlg.addEventListener('close', syncNative);

  // ---------------------------------------------------------------- import / export
  const summary = d => (d.classes.length === 1 ? '1 class' : d.classes.length + ' classes') + ', ' + plural(d.items.length, 'item');

  async function exportData() {
    await call('export', { json: JSON.stringify(C.serialize(S), null, 2), filename: 'Grod ' + today + '.json' });
  }

  async function importData() {
    const file = await call('import');
    if (!file || typeof file.text !== 'string') return;
    let data = null;
    try { data = C.normalize(JSON.parse(file.text), S.settings); } catch (_) { data = null; }
    if (!data) {
      await call('alert', { title: '“' + file.name + '” can’t be imported.', message: 'It isn’t a Grod backup.' });
      return;
    }
    let before;
    do {
      before = snapshot(true);
      if (snapshot(true, data) === before) return;
      if (S.classes.length || S.items.length || S.calendars.length || S.calendarUnmatched.length || S.calendarSkipped.length || data.dropped) {
        const ok = await call('confirm', {
          title: 'Replace everything with “' + file.name + '”?',
          message: 'It contains ' + summary(data) + '. ' +
            (data.dropped ? data.dropped + (data.dropped === 1 ? ' invalid entry' : ' invalid entries') + ' will be skipped. ' : '') +
            'Undo brings your current data back.',
          confirm: 'Replace',
        });
        if (!ok) return;
      }
      if (snapshot(true) === before) await call('backUpBeforeImport');
    } while (snapshot(true) !== before);
    view.center = true;
    view.renaming = null;
    commit('Import', () => restore(data), true);
    toast('Imported ' + summary(data));
  }

  // ---------------------------------------------------------------- commands from the menu bar and toolbar
  const textFocused = () => {
    const a = activeControl();
    // The untouched new-class field receives automatic focus after deleting the last class.
    if (a?.id === 'new-class-input' && !a.value && !a.dataset.typing) return false;
    return !!a && a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(a.type);
  };

  let lastSync = '';
  function syncNative() {
    const top = stack => (stack.length ? stack[stack.length - 1].label : '');
    const msg = {
      view: S.settings.view,
      theme: S.settings.theme,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoLabel: top(undoStack),
      redoLabel: top(redoStack),
      text: textFocused(),
      modal: dlg.open || calendarsDlg.open,
    };
    const key = JSON.stringify(msg);
    if (key === lastSync) return;
    lastSync = key;
    call('ui', msg).catch(() => {});
  }
  document.addEventListener('focusin', syncNative);
  document.addEventListener('focusout', () => setTimeout(syncNative, 0));

  window.App = {
    command(name, arg) {
      if (!ready) return false;
      switch (name) {
        case 'undo': return textFocused() ? document.execCommand('undo') : !dlg.open && !calendarsDlg.open && undo();
        case 'redo': return textFocused() ? document.execCommand('redo') : !dlg.open && !calendarsDlg.open && redo();
        case 'theme':
          if (C.THEMES.includes(arg)) { S.settings.theme = arg; persist(); syncNative(); }
          return true;
      }
      if (dlg.open || calendarsDlg.open) return false;
      switch (name) {
        case 'new-item': openItem(null); break;
        case 'new-class': startNewClass(); break;
        case 'view': setView(arg); break;
        case 'today': scrollToNow(true); break;
        case 'import': importData().catch(error => call('alert', { title: 'Import failed.', message: error.message })); break;
        case 'export': exportData().catch(error => call('alert', { title: 'Export failed.', message: error.message })); break;
        case 'calendars': openCalendars(); break;
        default: return false;
      }
      return true;
    },
    // For the automated checks in tests/.
    inspect: () => ({ state: S, undo: undoStack.length, redo: redoStack.length, layout }),
    itemAction, classAction, openItem, reveal, refreshCalendars,
  };

  // ---------------------------------------------------------------- page-level behaviour
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input')) e.preventDefault(); });
  document.addEventListener('dragstart', e => e.preventDefault());
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => e.preventDefault());

  if (!native) {
    document.addEventListener('keydown', e => {
      if (!e.metaKey && !e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !textFocused()) { e.preventDefault(); window.App.command(e.shiftKey ? 'redo' : 'undo'); }
      else if (k === '1' || k === '2') { e.preventDefault(); window.App.command('view', k === '1' ? 'timeline' : 'compact'); }
    });
  }

  // "Today" moves on its own if the app stays open past midnight.
  function checkDate() {
    if (ready && C.todayISO() !== today) render();
  }
  setInterval(checkDate, 30000);
  window.addEventListener('focus', checkDate);
  document.addEventListener('visibilitychange', checkDate);

  // ---------------------------------------------------------------- start
  (async function start() {
    let notice = '';
    try {
      const boot = await call('load');
      if (!boot || !(boot.data === null || typeof boot.data === 'string')) throw new Error('Invalid load response.');
      if (typeof boot.data === 'string') {
        const d = C.normalize(JSON.parse(boot.data));
        if (!d) throw new Error('Unrecognized data file.');
        restore(d);
        if (d.dropped) {
          await call('backUpBeforeImport');
          notice = d.dropped + (d.dropped === 1 ? ' invalid entry was' : ' invalid entries were') +
            ' skipped. A backup contains the complete original data.';
        }
      }
    } catch (error) {
      savingBlocked = true;
      notice = 'Saving is disabled for this session to protect your stored data. ' + error.message;
    }
    ready = true;
    render();
    window.Calendar.start({ state: () => S, call, snapshot, persist, async finishEditing() {
      while (dlg.open) await new Promise(resolve => dlg.addEventListener('close', resolve, { once: true }));
    }, changed(before, label) {
      if (snapshot() === before) return;
      undoStack.push({ label, data: before });
      if (undoStack.length > 200) undoStack.shift();
      redoStack.length = 0;
      hideToast();
      persist();
      render();
    } });
    call('ready').catch(() => {});
    if (notice) call('alert', { title: 'Grod data file', message: notice });
  })();
})();
