/* Lectures Fable: model and layout logic. No DOM, so it also runs under node for tests. */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;
  const TYPES = ['lecture', 'assignment', 'exam'];
  const VIEWS = ['timeline', 'compact'];
  const THEMES = ['system', 'dark', 'light'];
  // The timeline always covers this academic year and grows to fit anything outside it.
  const RANGE_START = '2026-09-01';
  const RANGE_END = '2027-04-30';
  // Dates outside these bounds never widen the timeline (protects against typos like year 2206).
  const RANGE_MIN = '2020-01-01';
  const RANGE_MAX = '2035-12-31';
  const COLOR_COUNT = 8;
  const MAX_SERIES = 400;

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const Core = { now: () => new Date() };

  // ---------------------------------------------------------------- dates
  // Dates are 'YYYY-MM-DD' strings. Arithmetic goes through UTC day numbers so
  // daylight-saving changes can never shift a day.
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const dayNum = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS);
  const toISO = n => new Date(n * DAY_MS).toISOString().slice(0, 10);
  const isISO = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(dayNum(s)) === s;
  const addDays = (s, n) => toISO(dayNum(s) + n);
  const diffDays = (a, b) => dayNum(a) - dayNum(b);
  const weekday = s => (new Date(dayNum(s) * DAY_MS).getUTCDay() + 6) % 7; // 0 = Monday
  const mondayOf = s => addDays(s, -weekday(s));
  function todayISO() {
    const d = Core.now();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  const dayOfMonth = s => +s.slice(8, 10);
  const monthName = s => MONTHS[+s.slice(5, 7) - 1];
  const fmtDay = s => WEEKDAYS[weekday(s)] + ' ' + dayOfMonth(s);                       // Thu 19
  const fmtShort = s => monthName(s).slice(0, 3) + ' ' + dayOfMonth(s);                 // Nov 19
  const fmtMedium = s => WEEKDAYS[weekday(s)] + ', ' + fmtShort(s);                     // Thu, Nov 19
  function relative(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? 'in ' + n + ' days' : -n + ' days ago';
  }

  // ---------------------------------------------------------------- ids, ordering
  function uid() {
    const a = new Uint8Array(10);
    const c = root.crypto;
    if (c && c.getRandomValues) c.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, b => (b % 36).toString(36)).join('');
  }

  const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
  // Chronological; ties keep a natural title order, then the order they were added in.
  function sorted(items) {
    return items.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : natural(a.title || '', b.title || '')));
  }

  // ---------------------------------------------------------------- reading files
  // Accepts this app's file, the original Lectures export ({classes, items}) and the
  // original Lectures data file ({state: {classes, items}, view}). Returns null if unusable.
  function normalize(raw) {
    let src = raw;
    if (src && typeof src === 'object' && src.state && typeof src.state === 'object') {
      src = Object.assign({}, src.state, { settings: { view: src.view } });
    }
    if (!src || typeof src !== 'object' || !Array.isArray(src.classes) || !Array.isArray(src.items)) return null;

    let dropped = 0;
    const classes = [];
    const classIds = new Set();
    const usedColors = new Set();
    for (const c of src.classes) {
      const name = c && typeof c === 'object' ? String(c.name == null ? '' : c.name).trim().slice(0, 80) : '';
      if (!name || (typeof c.id === 'string' && classIds.has(c.id))) { dropped++; continue; }
      const id = typeof c.id === 'string' && c.id ? c.id : uid();
      classIds.add(id);
      const color = Number.isInteger(c.color) && c.color >= 0 && c.color < COLOR_COUNT ? c.color : null;
      if (color !== null) usedColors.add(color);
      classes.push({ id, name, color });
    }
    for (const c of classes) {
      if (c.color === null) { c.color = nextColor(usedColors); usedColors.add(c.color); }
    }

    const items = [];
    const itemIds = new Set();
    for (const it of src.items) {
      if (!it || typeof it !== 'object' || !classIds.has(it.classId) || !TYPES.includes(it.type) || !isISO(it.date)) { dropped++; continue; }
      let id = typeof it.id === 'string' && it.id ? it.id : uid();
      while (itemIds.has(id)) id = uid();
      itemIds.add(id);
      const item = {
        id,
        classId: it.classId,
        type: it.type,
        title: typeof it.title === 'string' ? it.title.trim().slice(0, 200) : '',
        date: it.date,
        done: it.done === true,
        link: typeof it.link === 'string' ? it.link.trim().slice(0, 2000) : '',
      };
      const cal = it.calendar, original = cal && cal.original;
      if (cal && typeof cal.feedId === 'string' && cal.feedId && typeof cal.uid === 'string' && cal.uid &&
          typeof cal.occurrence === 'string' && original && typeof original.classId === 'string' &&
          TYPES.includes(original.type) && typeof original.title === 'string' && isISO(original.date) && typeof original.link === 'string') {
        item.calendar = { feedId: cal.feedId, uid: cal.uid, occurrence: cal.occurrence,
          original: { classId: original.classId, type: original.type, title: original.title.slice(0, 200), date: original.date, link: original.link.slice(0, 2000) } };
        if (Array.isArray(cal.edited)) item.calendar.edited = cal.edited.filter(f => ['classId', 'type', 'title', 'date', 'link'].includes(f));
      }
      items.push(item);
    }

    const s = src.settings && typeof src.settings === 'object' ? src.settings : {};
    const settings = {
      view: VIEWS.includes(s.view) ? s.view : 'timeline',
      theme: THEMES.includes(s.theme) ? s.theme : 'system',
    };
    const calendars = [];
    const calendarIds = new Set();
    for (const cal of Array.isArray(src.calendars) ? src.calendars : []) {
      if (!cal || typeof cal.id !== 'string' || !cal.id || calendarIds.has(cal.id) ||
          typeof cal.url !== 'string' || !/^(https|webcal):\/\//i.test(cal.url)) continue;
      calendarIds.add(cal.id);
      calendars.push({ id: cal.id, url: cal.url.slice(0, 2000), classId: classIds.has(cal.classId) ? cal.classId : '',
        lastSynced: typeof cal.lastSynced === 'string' ? cal.lastSynced : '' });
    }
    const calendarUnmatched = [];
    for (const event of Array.isArray(src.calendarUnmatched) ? src.calendarUnmatched : []) {
      if (!event || !(event.feedId === '' || calendarIds.has(event.feedId)) || typeof event.uid !== 'string' || !event.uid ||
          typeof event.occurrence !== 'string' || !isISO(event.date)) continue;
      calendarUnmatched.push({ feedId: event.feedId, uid: event.uid, occurrence: event.occurrence,
        title: typeof event.title === 'string' ? event.title.slice(0, 200) : '', type: TYPES.includes(event.type) ? event.type : calendarType(event.title), date: event.date,
        link: typeof event.link === 'string' ? event.link.slice(0, 2000) : '' });
    }
    return { classes, items, settings, calendars, calendarUnmatched, dropped };
  }

  function nextColor(used) {
    for (let i = 0; i < COLOR_COUNT; i++) if (!used.has(i)) return i;
    return used.size % COLOR_COUNT;
  }

  function serialize(state) {
    return { app: 'lectures-fable', version: 1, classes: state.classes, items: state.items, settings: state.settings, calendars: state.calendars || [], calendarUnmatched: state.calendarUnmatched || [] };
  }

  // ---------------------------------------------------------------- derived facts
  function lectureNumbers(state) {
    const counts = new Map();
    const nums = new Map();
    for (const it of sorted(state.items)) {
      if (it.type !== 'lecture') continue;
      const n = (counts.get(it.classId) || 0) + 1;
      counts.set(it.classId, n);
      nums.set(it.id, n);
    }
    return nums;
  }

  // done | behind | late | past | today | future
  function status(item, today) {
    if (item.done) return 'done';
    if (item.date > today) return 'future';
    if (item.date === today) return 'today';
    return item.type === 'lecture' ? 'behind' : item.type === 'assignment' ? 'late' : 'past';
  }

  function title(item, nums) {
    if (item.type === 'lecture') {
      const n = 'Lecture ' + (nums.get(item.id) || '');
      return item.title ? n + ' · ' + item.title : n;
    }
    return item.title || (item.type === 'exam' ? 'Exam' : 'Assignment');
  }

  function stats(state, today) {
    const out = new Map();
    for (const c of state.classes) {
      out.set(c.id, { lectures: 0, done: 0, behind: 0, late: 0, firstBehind: null, nextDeadline: null, nextLecture: null });
    }
    for (const it of sorted(state.items)) {
      const s = out.get(it.classId);
      if (!s) continue;
      if (it.type === 'lecture') {
        s.lectures++;
        if (it.done) s.done++;
        else if (it.date < today) { s.behind++; if (!s.firstBehind) s.firstBehind = it; }
        else if (!s.nextLecture) s.nextLecture = it;
      } else if (!it.done) {
        if (it.date >= today) { if (!s.nextDeadline) s.nextDeadline = it; }
        else if (it.type === 'assignment') s.late++;
      }
    }
    return out;
  }

  // Unfinished assignments (including overdue ones) and exams that have not happened yet.
  function upcoming(state, today, limit) {
    const list = sorted(state.items).filter(it => it.type !== 'lecture' && !it.done && (it.date >= today || it.type === 'assignment'));
    return limit ? list.slice(0, limit) : list;
  }

  function range(state, today, visibleWeeks) {
    const clamp = d => (d < RANGE_MIN ? RANGE_MIN : d > RANGE_MAX ? RANGE_MAX : d);
    let lo = RANGE_START;
    let hi = RANGE_END;
    for (const it of state.items) {
      const d = clamp(it.date);
      if (d < lo) lo = d;
      if (d > RANGE_END) { const e = clamp(addDays(d, 7)); if (e > hi) hi = e; } // one spare week after the last item
    }
    // Keep a full week before today and room to scroll beyond it, including in
    // unusually wide viewports. Today is not subject to item date bounds.
    const currentMonday = mondayOf(today);
    const previousMonday = addDays(currentMonday, -7);
    const lastVisibleSunday = addDays(currentMonday, Math.max(4, (visibleWeeks || 0) - 2) * 7 + 6);
    if (previousMonday < lo) lo = previousMonday;
    if (lastVisibleSunday > hi) hi = lastVisibleSunday;
    const start = mondayOf(lo);
    const end = addDays(mondayOf(hi), 6);
    const days = diffDays(end, start) + 1;
    return { start, end, days, weeks: days / 7 };
  }

  // Month segments across a range, for the header: [{iso (first day shown), offset, days, label}]
  function months(r) {
    const out = [];
    let d = r.start;
    let i = 0;
    while (i < r.days) {
      const y = +d.slice(0, 4);
      const m = +d.slice(5, 7);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const len = Math.min(last - dayOfMonth(d) + 1, r.days - i);
      out.push({ iso: d, offset: i, days: len, label: MONTHS[m - 1] + (out.length === 0 || m === 1 ? ' ' + y : '') });
      i += len;
      d = addDays(d, len);
    }
    // A sliver of a month at the very start has no room for a name; hand its year to the next one.
    if (out.length > 1 && out[0].days < 4) {
      out[0].label = '';
      const n = out[1];
      if (!/\d$/.test(n.label)) n.label += ' ' + n.iso.slice(0, 4);
    }
    return out;
  }

  function recurrence(start, until, weekdays) {
    const out = [];
    if (!isISO(start) || !isISO(until) || !weekdays || !weekdays.length) return out;
    const set = new Set(weekdays);
    const a = dayNum(start);
    const b = dayNum(until);
    for (let n = a; n <= b && out.length < MAX_SERIES; n++) {
      const iso = toISO(n);
      if (set.has(weekday(iso))) out.push(iso);
    }
    return out;
  }

  // ---------------------------------------------------------------- calendar feeds
  const icsText = s => String(s || '').replace(/\\([nN,;\\])/g, (_, c) => /[nN]/.test(c) ? '\n' : c);
  const localISO = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

  // Parse the wall time first. TZID conversion is done for each occurrence so DST
  // transitions do not move a weekly event by an hour.
  function icsDate(value, params) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(value || '');
    if (!m) return null;
    const day = m[1] + '-' + m[2] + '-' + m[3];
    if (!isISO(day) || (m[4] && (+m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59))) return null;
    return { day, time: m[4] ? [ +m[4], +m[5], +(m[6] || 0) ] : null,
      zone: m[7] ? 'UTC' : ((params && params.TZID) || '').replace(/^"|"$/g, '') };
  }
  function icsInstant(spec, day) {
    if (!spec.time) return null;
    const [h, m, s] = spec.time;
    const y = +day.slice(0, 4), mo = +day.slice(5, 7) - 1, d = +day.slice(8, 10);
    const wall = Date.UTC(y, mo, d, h, m, s);
    if (spec.zone === 'UTC') return wall;
    if (!spec.zone) return new Date(y, mo, d, h, m, s).getTime();
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: spec.zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      let instant = wall;
      for (let i = 0; i < 3; i++) {
        const parts = Object.fromEntries(fmt.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
        const observed = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
        const shift = wall - observed;
        instant += shift;
        if (!shift) break;
      }
      return instant;
    } catch (_) { return new Date(y, mo, d, h, m, s).getTime(); }
  }
  function icsLocalDate(spec, day) {
    return spec.time ? localISO(new Date(icsInstant(spec, day))) : day;
  }
  function calendarType(summary) {
    const s = String(summary || '');
    if (/\b(exam|midterm|final|quiz)\b/i.test(s)) return 'exam';
    if (/\b(assignment|due|homework|hw|lab\s+report|problem\s+set|submission)\b/i.test(s)) return 'assignment';
    return 'lecture';
  }
  function matchCalendarClass(summary, classes) {
    const canonical = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const text = ' ' + canonical(summary) + ' ';
    const compact = text.replace(/\b([a-z]{2,8})\s+(\d{2,4}[a-z]?)\b/g, '$1$2');
    for (const c of classes || []) {
      const name = canonical(c.name);
      if (name && text.includes(' ' + name + ' ')) return c.id;
      const codes = name.match(/\b[a-z]{2,8}\s*\d{2,4}[a-z]?\b/g) || [];
      if (codes.some(code => compact.includes(' ' + code.replace(/\s/g, '') + ' '))) return c.id;
    }
    return null;
  }
  function parseICS(text) {
    const lines = String(text || '').replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, '').split(/\r\n|\n|\r/);
    const events = [];
    let props = null, componentDepth = 0;
    const addEvent = p => {
      const first = name => (p[name] || [])[0];
      const start = first('DTSTART');
      const uidProp = first('UID');
      const spec = start && icsDate(start.value, start.params);
      const uidValue = uidProp && icsText(uidProp.value).trim();
      if (!spec || !uidValue) return;
      const summary = first('SUMMARY');
      const title = icsText(summary && summary.value).trim().slice(0, 200);
      const url = first('URL'), description = first('DESCRIPTION');
      const descriptionText = icsText(description && description.value);
      const match = descriptionText.match(/https?:\/\/[^\s<>"']+/i);
      const link = icsText(url && url.value).trim() || (match ? match[0].replace(/[.,;]+$/, '') : '');
      const rrule = first('RRULE');
      const emit = (day, recurring) => events.push({ uid: uidValue, title, date: icsLocalDate(spec, day), link: link.slice(0, 2000), occurrence: recurring ? day : '' });
      if (!rrule) { emit(spec.day, false); return; }
      const rule = {};
      for (const part of rrule.value.split(';')) {
        const at = part.indexOf('=');
        if (at > 0) rule[part.slice(0, at).toUpperCase()] = part.slice(at + 1).toUpperCase();
      }
      // Do not expand unsupported rule parts into misleading dates.
      if (rule.FREQ !== 'WEEKLY' || Object.keys(rule).some(k => !['FREQ', 'BYDAY', 'UNTIL', 'COUNT', 'INTERVAL', 'WKST'].includes(k))) return;
      const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
      const byday = rule.BYDAY ? rule.BYDAY.split(',').map(x => days.indexOf(x)) : [weekday(spec.day)];
      if (byday.some(x => x < 0) || (rule.WKST && !days.includes(rule.WKST))) return;
      const interval = rule.INTERVAL ? +rule.INTERVAL : 1;
      const count = rule.COUNT ? +rule.COUNT : Infinity;
      if (!Number.isInteger(interval) || interval < 1 || !(count > 0) || (count !== Infinity && !Number.isInteger(count))) return;
      const until = rule.UNTIL ? icsDate(rule.UNTIL, {}) : null;
      if (rule.UNTIL && !until) return;
      const excluded = [];
      for (const ex of p.EXDATE || []) for (const value of ex.value.split(',')) {
        const parsed = icsDate(value, ex.params);
        if (parsed) excluded.push(parsed);
      }
      const weekStart = rule.WKST ? days.indexOf(rule.WKST) : 0;
      const startWeek = dayNum(spec.day) - ((weekday(spec.day) - weekStart + 7) % 7);
      let seen = 0, produced = 0;
      // Bound unending feeds, while allowing sparse intervals and exclusions.
      for (let n = dayNum(spec.day), steps = 0; steps < 366 * 200 && seen < count && produced < MAX_SERIES; n++, steps++) {
        const day = toISO(n);
        const weeks = Math.floor((n - startWeek) / 7);
        if (until && (until.time ? icsInstant(spec, day) > icsInstant(until, until.day) : day > until.day)) break;
        if (weeks % interval || !byday.includes(weekday(day))) continue;
        seen++;
        const instant = icsInstant(spec, day);
        if (excluded.some(ex => ex.time && spec.time ? icsInstant(ex, ex.day) === instant : ex.day === day)) continue;
        emit(day, true);
        produced++;
      }
    };
    for (const line of lines) {
      if (/^BEGIN:VEVENT$/i.test(line)) { props = {}; componentDepth = 0; continue; }
      if (!props) continue;
      if (/^BEGIN:/i.test(line)) { componentDepth++; continue; }
      if (/^END:VEVENT$/i.test(line) && componentDepth === 0) { addEvent(props); props = null; continue; }
      if (/^END:/i.test(line)) { componentDepth = Math.max(0, componentDepth - 1); continue; }
      if (componentDepth) continue;
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const [rawName, ...parameters] = line.slice(0, colon).split(';');
      const name = rawName.toUpperCase(), params = {};
      for (const param of parameters) { const at = param.indexOf('='); if (at > 0) params[param.slice(0, at).toUpperCase()] = param.slice(at + 1); }
      (props[name] || (props[name] = [])).push({ value: line.slice(colon + 1), params });
    }
    return events;
  }

  // ---------------------------------------------------------------- layout
  // The timeline range starts on a Monday. Keep negative indexes negative so
  // callers can reject dates before the displayed range.
  const weekIndex = (date, start) => Math.floor(diffDays(date, start) / 7);
  function weekDate(start, index, today) {
    const monday = addDays(start, index * 7);
    return weekIndex(today, start) === index ? today : monday;
  }

  // Stack all item types together in date order within each week.
  function layoutWeeks(items, r) {
    const counts = new Map();
    const pos = new Map();
    let lanes = 1;
    for (const it of items.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const week = weekIndex(it.date, r.start);
      if (week < 0 || week >= r.weeks) continue;
      const lane = counts.get(week) || 0;
      pos.set(it.id, { week, lane });
      counts.set(week, lane + 1);
      lanes = Math.max(lanes, lane + 1);
    }
    return { pos, lanes };
  }

  // Places one class's chips on the day axis. Each chip is centred on its day; chips that
  // would touch go to the next lane. Lectures and deadlines get separate lane groups.
  // items: [{id, type, date, w}] in chronological order.
  function layoutRow(items, opt) {
    const lanes = { lecture: [], deadline: [] };
    const pos = new Map();
    const width = opt.days * opt.dayW;
    for (const it of items) {
      const idx = diffDays(it.date, opt.start);
      if (idx < 0 || idx >= opt.days) continue;
      const group = it.type === 'lecture' ? 'lecture' : 'deadline';
      let x = Math.round(idx * opt.dayW + opt.dayW / 2 - it.w / 2);
      x = Math.max(2, Math.min(x, width - it.w - 2));
      const ends = lanes[group];
      let lane = 0;
      while (lane < ends.length && ends[lane] + opt.gap > x) lane++;
      ends[lane] = x + it.w;
      pos.set(it.id, { x, lane, group });
    }
    return { pos, lectureLanes: Math.max(1, lanes.lecture.length), deadlineLanes: Math.max(1, lanes.deadline.length) };
  }

  // Compact view: every class's lectures in order, split at today so rows line up on "now".
  function compact(state, today) {
    const rows = new Map();
    for (const c of state.classes) rows.set(c.id, { past: [], future: [] });
    for (const it of sorted(state.items)) {
      const r = it.type === 'lecture' && rows.get(it.classId);
      if (r) (it.date < today ? r.past : r.future).push(it);
    }
    let maxPast = 0;
    let maxFuture = 0;
    for (const r of rows.values()) {
      maxPast = Math.max(maxPast, r.past.length);
      maxFuture = Math.max(maxFuture, r.future.length);
    }
    return { rows, maxPast, maxFuture };
  }

  // ---------------------------------------------------------------- edits (mutate state, return a count)
  function classLectures(state, classId) {
    return sorted(state.items).filter(it => it.classId === classId && it.type === 'lecture');
  }

  function addClass(state, name) {
    name = String(name || '').trim().slice(0, 80);
    if (!name) return null;
    const c = { id: uid(), name, color: nextColor(new Set(state.classes.map(x => x.color))) };
    state.classes.push(c);
    return c;
  }

  function removeClass(state, classId) {
    const before = state.classes.length;
    state.classes = state.classes.filter(c => c.id !== classId);
    state.items = state.items.filter(it => it.classId !== classId);
    return before - state.classes.length;
  }

  function moveClass(state, classId, delta) {
    const i = state.classes.findIndex(c => c.id === classId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.classes.length) return 0;
    const [c] = state.classes.splice(i, 1);
    state.classes.splice(j, 0, c);
    return 1;
  }

  // Move to the same weekday in the target week, optionally changing class.
  function moveItemToWeek(state, id, classId, week) {
    const it = state.items.find(x => x.id === id);
    if (!it || !state.classes.some(c => c.id === classId) || !isISO(week)) return 0;
    const date = addDays(mondayOf(week), weekday(it.date));
    if (it.classId === classId && it.date === date) return 0;
    it.classId = classId;
    it.date = date;
    return 1;
  }

  // base: {classId, type, title, link}. Lectures never double up on a day; assignments get numbered.
  function addSeries(state, base, dates, opt) {
    const taken = new Set(state.items.filter(it => it.classId === base.classId && it.type === 'lecture').map(it => it.date));
    const added = [];
    let k = 0;
    for (const date of dates) {
      if (base.type === 'lecture' && taken.has(date)) continue;
      k++;
      const item = {
        id: uid(),
        classId: base.classId,
        type: base.type,
        title: base.type === 'lecture' ? '' : (base.title || 'Assignment') + ' ' + k,
        date,
        done: !!(opt && opt.donePast && date < opt.today),
        link: base.link || '',
      };
      state.items.push(item);
      added.push(item);
    }
    return added;
  }

  function markThrough(state, id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return 0;
    let n = 0;
    for (const lec of classLectures(state, it.classId)) {
      if (!lec.done) { lec.done = true; n++; }
      if (lec.id === id) break;
    }
    return n;
  }

  function markPastDone(state, classId, today) {
    let n = 0;
    for (const it of state.items) {
      if (it.classId === classId && it.type === 'lecture' && !it.done && it.date < today) { it.done = true; n++; }
    }
    return n;
  }

  function removeFollowing(state, id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return 0;
    const list = classLectures(state, it.classId);
    const gone = new Set(list.slice(list.findIndex(x => x.id === id)).map(x => x.id));
    state.items = state.items.filter(x => !gone.has(x.id));
    return gone.size;
  }

  // ---------------------------------------------------------------- links
  function normalizeLink(s) {
    s = String(s || '').trim();
    if (!s) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s[0] === '/' || s[0] === '~') return s;
    return /^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/.test(s) ? 'https://' + s : s;
  }

  function linkLabel(s) {
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(s);
    if (m && !/^file:/i.test(s)) return m[1].replace(/^[^@]*@/, '').replace(/^www\./, '');
    const tail = s.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
    return tail || s;
  }

  Object.assign(Core, {
    TYPES, VIEWS, THEMES, RANGE_START, RANGE_END, RANGE_MIN, RANGE_MAX, COLOR_COUNT, WEEKDAYS,
    isISO, addDays, diffDays, weekday, mondayOf, todayISO, dayOfMonth, fmtDay, fmtShort, fmtMedium, relative,
    uid, sorted, normalize, serialize, lectureNumbers, status, title, stats, upcoming, range, months, recurrence,
    weekIndex, weekDate, layoutWeeks, layoutRow, compact, classLectures, addClass, removeClass, moveClass, moveItemToWeek, addSeries, markThrough, markPastDone,
    removeFollowing, normalizeLink, linkLabel, parseICS, calendarType, matchCalendarClass,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
