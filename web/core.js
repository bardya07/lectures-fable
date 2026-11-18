/* Grod: model and layout logic. No DOM, so it also runs under node for tests. */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;
  const TYPES = ['lecture', 'assignment', 'exam'];
  const CALENDAR_FIELDS = ['classId', 'type', 'title', 'date', 'link'];
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
  function utcMillis(year, month, day, h = 0, m = 0, s = 0) {
    const date = new Date(0);
    date.setUTCFullYear(year, month, day);
    return date.setUTCHours(h, m, s, 0);
  }
  const dayNum = s => Math.round(utcMillis(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS);
  const toISO = n => new Date(n * DAY_MS).toISOString().slice(0, 10);
  const isISO = s => typeof s === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(s) && toISO(dayNum(s)) === s;
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
  const itemTitle = title => title.trim().slice(0, 200).trimEnd();
  // Accepts this app's file, the original Lectures export ({classes, items}) and the
  // original Lectures data file ({state: {classes, items}, view}). Returns null if unusable.
  function normalize(raw, defaults = {}) {
    let src = raw;
    if (src && Array.isArray(src.state?.classes) && Array.isArray(src.state.items)) {
      src = Object.assign({}, src.state, { settings: { view: src.view } });
    }
    if (!src || typeof src !== 'object' || !Array.isArray(src.classes) || !Array.isArray(src.items)) return null;

    let dropped = 0;
    function optionalEntries(entries) {
      if (Array.isArray(entries)) return entries;
      if (entries != null) dropped++;
      return [];
    }
    const classes = [];
    const classIds = new Set();
    const usedColors = new Set();
    for (const c of src.classes) {
      const name = c && ['string', 'number', 'boolean'].includes(typeof c.name) ? String(c.name).trim().slice(0, 80) : '';
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
        title: typeof it.title === 'string' ? itemTitle(it.title) : '',
        date: it.date,
        done: it.done === true,
        link: typeof it.link === 'string' ? it.link.trim() : '',
      };
      const cal = it.calendar, original = cal && cal.original;
      if (cal && typeof cal.feedId === 'string' && cal.feedId && typeof cal.uid === 'string' && cal.uid &&
          typeof cal.occurrence === 'string' && original && typeof original.classId === 'string' &&
          TYPES.includes(original.type) && typeof original.title === 'string' && isISO(original.date) && typeof original.link === 'string') {
        item.calendar = { feedId: cal.feedId, uid: cal.uid, occurrence: cal.occurrence,
          original: { classId: original.classId, type: original.type, title: itemTitle(original.title), date: original.date, link: original.link.trim() } };
        if (Array.isArray(cal.edited)) item.calendar.edited = cal.edited.filter(f => CALENDAR_FIELDS.includes(f));
        if (cal.includeNotice === true) item.calendar.includeNotice = true;
      } else {
        if (cal != null) dropped++;
        const origin = it.calendarOrigin;
        if (typeof origin?.feedId === 'string' && origin.feedId && typeof origin.uid === 'string' && origin.uid &&
            typeof origin.occurrence === 'string') {
          item.calendarOrigin = { feedId: origin.feedId, uid: origin.uid, occurrence: origin.occurrence };
        } else if (origin != null) dropped++;
      }
      items.push(item);
    }

    const s = src.settings && typeof src.settings === 'object' ? src.settings : {};
    const settings = {
      view: VIEWS.includes(s.view) ? s.view : defaults.view || 'timeline',
      theme: THEMES.includes(s.theme) ? s.theme : defaults.theme || 'system',
    };
    const calendars = [];
    const calendarIds = new Set();
    for (const cal of optionalEntries(src.calendars)) {
      if (!cal || typeof cal.id !== 'string' || !cal.id || calendarIds.has(cal.id) ||
          typeof cal.url !== 'string' || !/^(https|webcal):\/\//i.test(cal.url)) { dropped++; continue; }
      calendarIds.add(cal.id);
      calendars.push({ id: cal.id, url: cal.url, classId: classIds.has(cal.classId) ? cal.classId : '',
        lastSynced: typeof cal.lastSynced === 'string' ? cal.lastSynced : '' });
    }
    function calendarEntries(entries, skipped) {
      const result = [];
      for (const event of optionalEntries(entries)) {
        if (!event || !(event.feedId === '' || calendarIds.has(event.feedId)) || typeof event.uid !== 'string' || !event.uid ||
            typeof event.occurrence !== 'string' || !isISO(event.date)) { dropped++; continue; }
        const title = typeof event.title === 'string' ? itemTitle(event.title) : '';
        const inferred = TYPES.includes(event.type) ? event.type : calendarType(title);
        const entry = { feedId: event.feedId, uid: event.uid, occurrence: event.occurrence,
          title,
          type: inferred === 'skip' ? 'lecture' : inferred, date: event.date,
          link: typeof event.link === 'string' ? event.link : '' };
        if (event.includeNotice === true) entry.includeNotice = true;
        if (skipped) entry.classId = classIds.has(event.classId) ? event.classId : '';
        result.push(entry);
      }
      return result;
    }
    const calendarTombstones = [];
    const deleted = new Set();
    for (const entry of optionalEntries(src.calendarTombstones)) {
      if (!entry || !calendarIds.has(entry.feedId) || typeof entry.uid !== 'string' || !entry.uid ||
          typeof entry.occurrence !== 'string') { dropped++; continue; }
      if (deleted.has(calendarKey(entry))) continue;
      deleted.add(calendarKey(entry));
      calendarTombstones.push({ feedId: entry.feedId, uid: entry.uid, occurrence: entry.occurrence });
    }
    for (const item of items) {
      for (const field of ['calendar', 'calendarOrigin']) {
        if (item[field] && !calendarIds.has(item[field].feedId)) { delete item[field]; dropped++; }
      }
    }
    const calendarUnmatched = calendarEntries(src.calendarUnmatched, false).filter(e => !deleted.has(calendarKey(e)));
    const calendarSkipped = calendarEntries(src.calendarSkipped, true).filter(e => !deleted.has(calendarKey(e)));
    return { classes, settings, calendars, calendarTombstones,
      items: items.filter(item => {
        const source = item.calendar || item.calendarOrigin;
        return !source || !deleted.has(calendarKey(source));
      }),
      calendarUnmatched, calendarSkipped, dropped };
  }

  function nextColor(used) {
    for (let i = 0; i < COLOR_COUNT; i++) if (!used.has(i)) return i;
    return used.size % COLOR_COUNT;
  }

  function serialize(state) {
    return { app: 'lectures-fable', version: 1, classes: state.classes, items: state.items, settings: state.settings,
      calendars: state.calendars || [], calendarUnmatched: state.calendarUnmatched || [], calendarSkipped: state.calendarSkipped || [],
      calendarTombstones: state.calendarTombstones || [] };
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
    if (item.type === 'lecture') return item.title || 'Lecture ' + (nums.get(item.id) || '');
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
      const last = new Date(utcMillis(y, m, 0)).getUTCDate();
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

  function recurrence(start, until, weekdays, taken) {
    const out = [];
    if (!isISO(start) || !isISO(until) || !weekdays || !weekdays.length) return out;
    const set = new Set(weekdays);
    const a = dayNum(start);
    const b = dayNum(until);
    for (let n = a; n <= b && out.length < MAX_SERIES; n++) {
      const iso = toISO(n);
      if (set.has(weekday(iso)) && !taken?.has(iso)) out.push(iso);
    }
    return out;
  }

  // ---------------------------------------------------------------- calendar feeds
  const icsText = s => String(s || '').replace(/\\([nN,;\\])/g, (_, c) => /[nN]/.test(c) ? '\n' : c);
  const localISO = d => String(d.getFullYear()).padStart(4, '0') + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

  // Parse the wall time first. TZID conversion is done for each occurrence so DST
  // transitions do not move a weekly event by an hour.
  function icsDate(value, params, strict) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(value || '');
    if (!m) return null;
    const day = m[1] + '-' + m[2] + '-' + m[3];
    if (!isISO(day) || (m[4] && (+m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59))) return null;
    const spec = { day, time: m[4] ? [ +m[4], +m[5], +(m[6] || 0) ] : null,
      zone: m[7] ? 'UTC' : ((params && params.TZID) || '').replace(/^"|"$/g, '') };
    if (spec.time && spec.zone && spec.zone !== 'UTC') {
      try {
        spec.formatter = new Intl.DateTimeFormat('en-US', { timeZone: spec.zone, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      } catch (_) {
        if (strict) throw new Error('Unsupported calendar time zone.');
      }
    }
    return spec;
  }
  function icsInstant(spec, day, skipGap = false) {
    if (!spec.time) return null;
    const [h, m, s] = spec.time;
    const y = +day.slice(0, 4), mo = +day.slice(5, 7) - 1, d = +day.slice(8, 10);
    const wall = utcMillis(y, mo, d, h, m, s);
    if (spec.zone === 'UTC') return wall;
    if (!spec.formatter) {
      const local = new Date(y < 100 ? y + 400 : y, mo, d, h, m, s);
      if (y < 100) local.setFullYear(y, mo, d);
      if (skipGap && (local.getDate() !== d || local.getHours() !== h || local.getMinutes() !== m)) return null;
      return local.getTime();
    }
    const offsetAt = instant => {
      const p = Object.fromEntries(spec.formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
      return utcMillis(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instant;
    };
    // A repeated wall time denotes the first occurrence. A standalone time in a gap
    // uses the pre-transition offset, while recurrence expansion omits nonexistent times.
    const before = offsetAt(wall - DAY_MS);
    const first = wall - before;
    const actual = offsetAt(first);
    if (actual === before) return first;
    const second = wall - actual;
    return offsetAt(second) === actual ? second : skipGap ? null : first;
  }
  function icsLocalDate(spec, day) {
    return spec.time ? localISO(new Date(icsInstant(spec, day))) : day;
  }
  const calendarWords = {
    exam: /\b(?:exams?|midterms?|finals?|quiz(?:zes)?|tests?|assessments?)\b/i,
    assignment: /\b(?:assignments?|due|homeworks?|hw\d*|problem\s+sets?|ps\d*|lab\s+reports?|essays?|papers?|reports?|projects?|submissions?|worksheets?|podcasts?|presentations?|reflections?)\b/i,
    lecture: /\b(?:lectures?|lec\d*|class(?:es)?|seminars?|tutorials?)\b/i,
  };
  const strongExam = /\b(?:exams?|midterms?|quiz(?:zes)?|tests?|assessments?)\b/i;
  const calendarNotice = /\b(?:cancel(?:l)?ed|cancellations?|no\s+(?:class(?:es)?|lectures?|tutorials?|labs?)|cut[\s-]?off|campus closed)\b/i;
  const calendarHoliday = /(?:^|[-–—]\s*)(?:(?:public|statutory|university)\s+)?(?:holiday|remembrance day|thanksgiving(?: day)?|reading (?:day|break|week)|spring break|winter break|(?:labou?r|family|victoria|canada|independence|memorial|christmas|boxing|new year['’]s) day|good friday)\s*$/i;

  function calendarType(event) {
    if (!event || typeof event === 'string') event = { title: event || '' };
    const { allDay, recurring, duration, date, uid = '', status = '', description = '', categories = '', link = '' } = event;
    const summary = String(event.title || '').replace(/\[[^\]]*\]/g, '');
    const urlInText = /https?:\/\/[^\s<>"']+/gi;
    const urls = [link, ...(description.match(urlInText) || [])];
    const descriptionText = description.replace(urlInText, '').replace(/<[^>]*>/g, ' ');
    const scores = { lecture: 0, assignment: 0, exam: 0, skip: 0 };
    const club = /\bhomework\s+club\b/i;
    if (calendarNotice.test(summary) || calendarHoliday.test(summary.trim()) || /^cancelled$/i.test(status) || /\bholidays?\b/i.test(categories)) scores.skip += 150;
    if (/\breview\s+sessions?\b/i.test(summary) || club.test(summary)) scores.lecture += 100;
    let title = summary.replace(club, '');
    if (calendarWords.assignment.test(title)) title = title.replace(/\bfinals?\b/gi, '');
    const sources = [[title, 14], [categories, 6], [descriptionText.replace(club, ''), 3]];
    for (const [value, weight] of sources) {
      for (const type of TYPES) {
        if (calendarWords[type].test(value)) scores[type] += type === 'lecture' ? Math.ceil(weight / 2) : weight;
      }
      if (!allDay && /\blabs?\b/i.test(value) && !/\blab\s+reports?\b/i.test(value)) scores.lecture += Math.ceil(weight / 2);
    }
    if (strongExam.test(title)) scores.exam += 32;
    else if (calendarWords.exam.test(title)) scores.exam += 10;
    if (urls.some(url => /\/quizzes(?:\/|[?#]|$)/i.test(url)) || /^event-quiz-/i.test(uid)) scores.exam += 10;
    if (urls.some(url => /\/assignments(?:\/|[?#]|$)/i.test(url))) scores.assignment += 6;
    if (/^event-assignment-/i.test(uid)) scores.assignment += 7;
    if (/^event-calendar-event-/i.test(uid)) scores.lecture += 1;
    if (allDay) scores.assignment += 2;
    if (!allDay && duration === 0 && /\b(?:due|deadline|submission)\b/i.test(summary + ' ' + descriptionText)) scores.assignment += 4;
    if (!allDay && recurring) scores.lecture += 5;
    // Common end-of-term months. Duration is a tiebreaker for untitled or ambiguous events.
    if (!allDay && !recurring && duration >= 120 && duration <= 300
        && date && /-(?:04|08|12)-(?:0[5-9]|1[0-9]|2[0-4])$/.test(date)) scores.exam += 4;
    const highest = Math.max(...Object.values(scores));
    const winners = Object.keys(scores).filter(type => scores[type] === highest);
    return winners.length === 1 ? winners[0] : 'lecture';
  }

  function matchCalendarClass(summary, classes) {
    const canonical = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
    const codes = s => (canonical(s).match(/\b[a-z]{2,8}\s*\d{2,4}[a-z]?\b/g) || []).map(code => code.replace(/\s/g, ''));
    const candidates = (classes || []).map(c => ({ id: c.id, name: canonical(c.name), codes: codes(c.name) }));
    const title = String(summary || '').replace(/\[[^\]]*\]/g, bracket =>
      bracket.replace(/\b([a-z]+\s*\d{2,4}[a-z]?)\s+[a-z]\d{2,4}\b/gi, '$1'));
    const matchCode = list => {
      for (const code of list) {
        const match = candidates.find(c => c.codes.includes(code));
        if (match) return match.id;
      }
      return null;
    };
    const bracketCode = matchCode(Array.from(title.matchAll(/\[([^\]]*)\]/g)).flatMap(match => codes(match[1])));
    if (bracketCode) return bracketCode;
    const text = ' ' + canonical(title) + ' ';
    let named;
    for (const candidate of candidates) {
      if (candidate.name && (!named || candidate.name.length > named.name.length) && text.includes(' ' + candidate.name + ' ')) named = candidate;
    }
    return named ? named.id : matchCode(codes(title));
  }

  function icsDuration(start, end, duration) {
    if (!start.time) return null;
    if (end && end.time) return (icsInstant(end, end.day) - icsInstant(start, start.day)) / 60000;
    if (duration) {
      const parts = /^\+?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/i.exec(duration);
      if (parts) return +(parts[1] || 0) * 10080 + +(parts[2] || 0) * 1440 + +(parts[3] || 0) * 60
        + +(parts[4] || 0) + +(parts[5] || 0) / 60;
    }
    return 0;
  }

  function parseICS(text, strict, unsupported) {
    const lines = String(text || '').trim().replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, '').split(/\r\n|\n|\r/);
    if (strict && (!/^BEGIN:VCALENDAR$/i.test(lines[0]) || !/^END:VCALENDAR$/i.test(lines[lines.length - 1]))) {
      throw new Error('Invalid calendar file.');
    }
    const events = [];
    const overrides = new Map();
    const occurrences = new Map();
    const excludedOccurrences = new Map();
    const occurrenceKey = (uid, spec, day) => JSON.stringify([uid, spec.time ? icsInstant(spec, day) : day]);
    let props = null, componentDepth = 0;
    const components = [];
    const revisions = new Map();
    const collectEvent = p => {
      const uid = icsText(p.UID?.[0]?.value).trim();
      const recurrence = p['RECURRENCE-ID']?.[0];
      const original = recurrence && icsDate(recurrence.value, recurrence.params, strict);
      if (!uid || (recurrence && !original)) {
        if (strict) throw new Error('Invalid calendar event.');
        return;
      }
      const identity = original ? occurrenceKey(uid, original, original.day) : JSON.stringify([uid]);
      const sequence = p.SEQUENCE?.[0]?.value ?? '0';
      if (strict && (!/^\d+$/.test(sequence) || !Number.isSafeInteger(+sequence))) throw new Error('Invalid calendar event sequence.');
      const rawStamp = p.DTSTAMP?.[0]?.value?.toUpperCase();
      const stamp = /^\d{8}T\d{6}Z$/.test(rawStamp) && icsDate(rawStamp, {}) ? rawStamp : '';
      const prior = revisions.get(identity);
      if (!prior || +sequence > prior.sequence || (+sequence === prior.sequence && stamp > prior.stamp)) {
        revisions.set(identity, { props: p, uid, original, sequence: +sequence, stamp });
      }
    };
    const addEvent = ({ props: p, uid: uidValue, original }) => {
      const first = name => (p[name] || [])[0];
      const value = name => (first(name) || {}).value;
      const start = first('DTSTART');
      const recurrenceId = first('RECURRENCE-ID');
      const spec = start ? icsDate(start.value, start.params, strict) : original;
      if (!spec) {
        if (strict) throw new Error('Invalid calendar event.');
        return;
      }
      const title = icsText(value('SUMMARY')).trim();
      const descriptionText = icsText(value('DESCRIPTION'));
      const match = descriptionText.match(/https?:\/\/[^\s<>"']+/i);
      const link = icsText(value('URL')).trim() || (match ? match[0].replace(/[.,;]+$/, '') : '');
      const categories = (p.CATEGORIES || []).map(category => icsText(category.value)).join(', ');
      const end = first('DTEND');
      const endDate = end && icsDate(end.value, end.params, strict);
      if (strict && end && !endDate) throw new Error('Invalid calendar end date.');
      const duration = icsDuration(spec, endDate, value('DURATION'));
      const rrule = first('RRULE');
      const unsupportedRecurrence = () => {
        if (unsupported) unsupported.add(uidValue);
        else if (strict) throw new Error('Unsupported calendar recurrence.');
      };
      if (p.RDATE || p.EXRULE || p.RRULE?.length > 1 || recurrenceId?.params.RANGE) {
        unsupportedRecurrence();
        return;
      }
      const emit = (day, recurring) => {
        const date = icsLocalDate(spec, day);
        if (!isISO(date)) {
          if (strict) throw new Error('Calendar date is outside the supported range.');
          return;
        }
        const type = calendarType({ uid: uidValue, title, date, link, description: descriptionText, categories,
          allDay: !spec.time, recurring: recurring || !!original, duration, status: value('STATUS') });
        const event = { uid: uidValue, title: itemTitle(title), date, link,
          occurrence: original ? original.day : recurring ? day : '', type };
        if (original) {
          overrides.set(occurrenceKey(uidValue, original, original.day), event);
        } else {
          if (recurring) occurrences.set(event, occurrenceKey(uidValue, spec, day));
          events.push(event);
        }
      };
      const excludedDays = new Set(), excludedTimes = new Set();
      for (const ex of p.EXDATE || []) for (const value of ex.value.split(',')) {
        const parsed = icsDate(value, ex.params, strict);
        if (!parsed) {
          if (strict) throw new Error('Invalid calendar exclusion date.');
          continue;
        }
        if (spec.time && parsed.time) excludedTimes.add(icsInstant(parsed, parsed.day));
        else excludedDays.add(parsed.day);
      }
      if (!rrule) {
        if (!excludedDays.has(spec.day) && !excludedTimes.has(icsInstant(spec, spec.day))) emit(spec.day, false);
        return;
      }
      const rule = {};
      for (const part of rrule.value.split(';')) {
        const at = part.indexOf('=');
        const name = part.slice(0, at).toUpperCase();
        if (at <= 0 || at === part.length - 1 || Object.hasOwn(rule, name)) {
          if (strict) throw new Error('Invalid weekly calendar rule.');
          return;
        }
        rule[name] = part.slice(at + 1).toUpperCase();
      }
      // Do not expand unsupported rule parts into misleading dates.
      if (rule.FREQ !== 'WEEKLY' || Object.keys(rule).some(k => !['FREQ', 'BYDAY', 'UNTIL', 'COUNT', 'INTERVAL', 'WKST'].includes(k))) {
        unsupportedRecurrence();
        return;
      }
      const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
      const byday = rule.BYDAY ? rule.BYDAY.split(',').map(x => days.indexOf(x)) : [weekday(spec.day)];
      const interval = rule.INTERVAL === undefined ? 1 : Number(rule.INTERVAL);
      const count = rule.COUNT === undefined ? Infinity : Number(rule.COUNT);
      const until = rule.UNTIL ? icsDate(rule.UNTIL, {}) : null;
      if (byday.some(x => x < 0) || (rule.WKST && !days.includes(rule.WKST)) ||
          [rule.INTERVAL, rule.COUNT].some(v => v !== undefined && (!/^\d+$/.test(v) || !Number.isSafeInteger(+v) || +v < 1)) ||
          (rule.UNTIL !== undefined && !until)) {
        if (strict) throw new Error('Invalid weekly calendar rule.');
        return;
      }
      const untilInstant = until?.time ? icsInstant(until, until.day) : null;
      const lastDay = Math.min(dayNum('9999-12-31'), until ? dayNum(until.day) + (until.time ? 1 : 0) : Infinity);
      const weekStart = rule.WKST ? days.indexOf(rule.WKST) : 0;
      const startWeek = dayNum(spec.day) - ((weekday(spec.day) - weekStart + 7) % 7);
      let seen = 0, produced = 0;
      // Bound unending feeds, while allowing sparse intervals and exclusions.
      for (let n = dayNum(spec.day), steps = 0; n <= lastDay && steps < 366 * 200 && seen < count && produced < MAX_SERIES; n++, steps++) {
        const day = toISO(n);
        const weeks = Math.floor((n - startWeek) / 7);
        if (weeks % interval || !byday.includes(weekday(day))) continue;
        const instant = icsInstant(spec, day, day !== spec.day);
        if (spec.time && instant === null) continue;
        if (untilInstant !== null && (spec.time ? instant > untilInstant : day > until.day)) break;
        seen++;
        if (excludedDays.has(day) || excludedTimes.has(instant)) {
          excludedOccurrences.set(occurrenceKey(uidValue, spec, day), day);
          continue;
        }
        emit(day, true);
        produced++;
      }
    };
    for (const line of lines) {
      if (!line.trim()) continue;
      // Quoted parameter values may contain both colons and semicolons.
      const header = /^(?:[^":]|"[^"]*")*:/.exec(line);
      if (strict) {
        if (!header || !/^[a-z0-9._-]+[;:]/i.test(header[0])) throw new Error('Invalid calendar file.');
        const component = /^(BEGIN|END):(.+)$/i.exec(line);
        if (component) {
          const name = component[2].toUpperCase();
          if (component[1].toUpperCase() === 'BEGIN') {
            if ((name === 'VCALENDAR' && components.length) || (name === 'VEVENT' && components.length !== 1)) throw new Error('Invalid calendar file.');
            components.push(name);
          } else if (components.pop() !== name) throw new Error('Invalid calendar file.');
        }
        if (components.length === 0 && !/^END:VCALENDAR$/i.test(line)) throw new Error('Invalid calendar file.');
      }
      if (/^BEGIN:VEVENT$/i.test(line)) { props = {}; componentDepth = 0; continue; }
      if (!props) continue;
      if (/^BEGIN:/i.test(line)) { componentDepth++; continue; }
      if (/^END:VEVENT$/i.test(line) && componentDepth === 0) { collectEvent(props); props = null; continue; }
      if (/^END:/i.test(line)) { componentDepth = Math.max(0, componentDepth - 1); continue; }
      if (componentDepth) continue;
      if (!header) continue;
      const colon = header[0].length - 1;
      const [rawName, ...parameters] = line.slice(0, colon).match(/(?:[^;"]|"[^"]*")+/g) || [''];
      const name = rawName.toUpperCase(), params = {};
      for (const param of parameters) { const at = param.indexOf('='); if (at > 0) params[param.slice(0, at).toUpperCase()] = param.slice(at + 1); }
      (props[name] || (props[name] = [])).push({ value: line.slice(colon + 1), params });
    }
    if (strict && components.length) throw new Error('Invalid calendar file.');
    for (const event of revisions.values()) addEvent(event);
    if (!overrides.size) return events;
    // Recurrence exceptions replace the generated instance regardless of their order in the file.
    const result = events.map(event => {
      const key = occurrences.get(event);
      const override = overrides.get(key);
      if (!override) return event;
      overrides.delete(key);
      override.occurrence = event.occurrence;
      return override;
    });
    for (const [key, event] of overrides) {
      if (excludedOccurrences.has(key)) event.occurrence = excludedOccurrences.get(key);
      result.push(event);
    }
    return result;
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

  const calendarKey = entry => JSON.stringify([entry.feedId, entry.uid, entry.occurrence]);

  // Only explicit user deletions suppress a feed occurrence. Upstream removals can return.
  function removeItems(state, matches) {
    const deleted = new Set((state.calendarTombstones || []).map(calendarKey));
    const newlyDeleted = new Set();
    const before = state.items.length;
    state.items = state.items.filter(item => {
      if (!matches(item)) return true;
      const cal = item.calendar || item.calendarOrigin;
      const key = cal && calendarKey(cal);
      if (key && !deleted.has(key)) {
        (state.calendarTombstones ||= []).push({ feedId: cal.feedId, uid: cal.uid, occurrence: cal.occurrence });
        deleted.add(key);
        newlyDeleted.add(key);
      }
      return false;
    });
    if (newlyDeleted.size) {
      // A backup can contain multiple rows for one occurrence. Only the matched rows were deleted.
      for (const item of state.items) {
        const source = item.calendar || item.calendarOrigin;
        if (source && newlyDeleted.has(calendarKey(source))) {
          delete item.calendar;
          delete item.calendarOrigin;
        }
      }
      if (state.calendarUnmatched) state.calendarUnmatched = state.calendarUnmatched.filter(e => !newlyDeleted.has(calendarKey(e)));
      if (state.calendarSkipped) state.calendarSkipped = state.calendarSkipped.filter(e => !newlyDeleted.has(calendarKey(e)));
    }
    return before - state.items.length;
  }

  function removeClass(state, classId) {
    const before = state.classes.length;
    state.classes = state.classes.filter(c => c.id !== classId);
    removeItems(state, it => it.classId === classId);
    for (const feed of state.calendars || []) if (feed.classId === classId) feed.classId = '';
    for (const note of state.calendarSkipped || []) if (note.classId === classId) note.classId = '';
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

  function editItem(item, values) {
    if (item.calendar) {
      const edited = new Set(item.calendar.edited || []);
      for (const field of CALENDAR_FIELDS) {
        if (Object.hasOwn(values, field) && item[field] !== values[field]) edited.add(field);
      }
      if (edited.size) item.calendar.edited = Array.from(edited);
    }
    Object.assign(item, values);
  }

  // Move to the same weekday in the target week, optionally changing class.
  function moveItemToWeek(state, id, classId, week) {
    const it = state.items.find(x => x.id === id);
    if (!it || !state.classes.some(c => c.id === classId) || !isISO(week)) return 0;
    const date = addDays(mondayOf(week), weekday(it.date));
    if (it.classId === classId && it.date === date) return 0;
    editItem(it, { classId, date });
    return 1;
  }

  // Lectures never double up on a day. Named assignment series use the existing numbered titles.
  function addSeries(state, base, dates, opt) {
    const taken = new Set(state.items.filter(it => it.classId === base.classId && it.type === 'lecture').map(it => it.date));
    const added = [];
    for (const date of dates) {
      if (base.type === 'lecture' && taken.has(date)) continue;
      const suffix = ' ' + (added.length + 1);
      const item = Object.assign({}, base, {
        id: uid(),
        title: base.type === 'assignment' && base.title ? base.title.slice(0, 200 - suffix.length) + suffix : base.title,
        date,
        done: !!(base.done && opt && date < opt.today),
      });
      taken.add(date);
      state.items.push(item);
      added.push(item);
    }
    return added;
  }

  function markThrough(state, id) {
    const it = state.items.find(x => x.id === id);
    if (!it || it.type !== 'lecture') return 0;
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

  function removeFollowing(state, id, approved) {
    const it = state.items.find(x => x.id === id);
    if (!it || it.type !== 'lecture') return 0;
    const list = classLectures(state, it.classId);
    const gone = new Set(list.slice(list.findIndex(x => x.id === id)).map(x => x.id));
    return removeItems(state, x => gone.has(x.id) && (!approved || approved.has(x.id)));
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
    TYPES, CALENDAR_FIELDS, VIEWS, THEMES, RANGE_START, RANGE_END, RANGE_MIN, RANGE_MAX, COLOR_COUNT, WEEKDAYS,
    isISO, addDays, diffDays, weekday, mondayOf, todayISO, dayOfMonth, fmtDay, fmtShort, fmtMedium, relative,
    uid, sorted, normalize, serialize, lectureNumbers, status, title, stats, upcoming, range, months, recurrence,
    weekIndex, weekDate, layoutWeeks, layoutRow, compact, classLectures, addClass, removeClass, moveClass, moveItemToWeek, addSeries, markThrough, markPastDone,
    editItem, removeItems, removeFollowing, normalizeLink, linkLabel, parseICS, calendarType, matchCalendarClass,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
