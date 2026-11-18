// Logic checks for web/core.js. Run with: node tests/core.test.js
const assert = require('assert');
const C = require('../web/core.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + (e.message || e).split('\n').join('\n      ')); process.exitCode = 1; }
}
const eq = assert.deepStrictEqual;

const TODAY = '2026-11-14'; // a Saturday
const lec = (id, classId, date, extra) => Object.assign({ id, classId, type: 'lecture', title: '', date, done: false, link: '' }, extra);
const item = (id, classId, type, date, extra) => Object.assign({ id, classId, type, title: '', date, done: false, link: '' }, extra);
const state = (classes, items) => ({ classes: classes.map((id, i) => ({ id, name: id.toUpperCase(), color: i })), items, settings: { view: 'timeline', theme: 'system' } });

test('dates: arithmetic crosses months, years and DST changes', () => {
  eq(C.addDays('2026-10-31', 1), '2026-11-01');
  eq(C.addDays('2026-12-31', 1), '2027-01-01');
  eq(C.addDays('2026-11-01', 1), '2026-11-02'); // clocks go back that night
  eq(C.addDays('2027-03-14', -1), '2027-03-13'); // clocks go forward
  eq(C.diffDays('2027-03-15', '2026-11-01'), 134);
  eq(C.addDays('2028-02-28', 1), '2028-02-29');
});

test('dates: weekday, monday, validation, labels', () => {
  eq(C.weekday('2026-11-14'), 5);
  eq(C.weekday('2026-11-16'), 0);
  eq(C.mondayOf('2026-11-14'), '2026-11-09');
  eq(C.mondayOf('2026-09-01'), '2026-08-31');
  eq(C.isISO('2026-02-29'), false);
  eq(C.isISO('2026-2-9'), false);
  eq(C.isISO('2028-02-29'), true);
  eq(C.isISO(20261114), false);
  eq(C.fmtDay('2026-11-19'), 'Thu 19');
  eq(C.fmtShort('2026-11-09'), 'Nov 9');
  eq(C.fmtMedium('2026-11-19'), 'Thu, Nov 19');
  eq([0, 1, -1, 5, -3].map(C.relative), ['today', 'tomorrow', 'yesterday', 'in 5 days', '3 days ago']);
});

test('today uses the local calendar day', () => {
  const real = C.now;
  C.now = () => new Date(2026, 10, 14, 23, 59);
  eq(C.todayISO(), '2026-11-14');
  C.now = () => new Date(2027, 0, 1, 0, 0);
  eq(C.todayISO(), '2027-01-01');
  C.now = real;
});

test('lecture numbers follow date order per class, whatever order they were added in', () => {
  const s = state(['a', 'b'], [lec('x3', 'a', '2026-09-14'), lec('x1', 'a', '2026-09-09'), lec('y1', 'b', '2026-09-10'), lec('x2', 'a', '2026-09-11'),
    item('q', 'a', 'exam', '2026-09-10')]);
  const n = C.lectureNumbers(s);
  eq([n.get('x1'), n.get('x2'), n.get('x3'), n.get('y1'), n.get('q')], [1, 2, 3, 1, undefined]);
});

test('move to week preserves weekday across month and year boundaries and can change class', () => {
  const s = state(['a', 'b'], [lec('l1', 'a', '2026-12-30'), lec('l2', 'b', '2027-01-01'), item('e', 'a', 'exam', '2026-11-29')]);
  eq(C.moveItemToWeek(s, 'l1', 'b', '2027-01-04'), 1);
  eq([s.items[0].date, s.items[0].classId], ['2027-01-06', 'b']);
  eq(C.lectureNumbers(s).get('l1'), 2);
  eq(C.moveItemToWeek(s, 'e', 'a', '2026-12-07'), 1);
  eq(s.items[2].date, '2026-12-13');
  eq(C.moveItemToWeek(s, 'e', 'a', '2026-12-07'), 0);
  eq(C.moveItemToWeek(s, 'e', 'missing', '2026-12-14'), 0);
  eq([s.items[2].date, s.items[2].classId], ['2026-12-13', 'a']);
});

test('status: behind only for past unfinished lectures; late for assignments; exams just pass', () => {
  eq(C.status(lec('a', 'c', '2026-11-13'), TODAY), 'behind');
  eq(C.status(lec('a', 'c', '2026-11-14'), TODAY), 'today');
  eq(C.status(lec('a', 'c', '2026-11-15'), TODAY), 'future');
  eq(C.status(lec('a', 'c', '2026-11-13', { done: true }), TODAY), 'done');
  eq(C.status(item('a', 'c', 'assignment', '2026-11-13'), TODAY), 'late');
  eq(C.status(item('a', 'c', 'exam', '2026-11-13'), TODAY), 'past');
});

test('stats: behind count, first behind, next deadline and next lecture', () => {
  const s = state(['a', 'b'], [
    lec('l1', 'a', '2026-11-02', { done: true }), lec('l2', 'a', '2026-11-04'), lec('l3', 'a', '2026-11-06', { done: true }),
    lec('l4', 'a', '2026-11-13'), lec('l5', 'a', '2026-11-14'), lec('l6', 'a', '2026-11-16'),
    item('e1', 'a', 'exam', '2026-11-19', { title: 'Midterm' }), item('h1', 'a', 'assignment', '2026-11-10', { title: 'PS1' }),
    item('h2', 'a', 'assignment', '2026-11-17', { title: 'PS2' }), item('h0', 'a', 'assignment', '2026-11-03', { done: true }),
    lec('m1', 'b', '2026-11-20'),
  ]);
  const st = C.stats(s, TODAY);
  const a = st.get('a');
  eq([a.lectures, a.done, a.behind, a.late], [6, 2, 2, 1]);
  eq(a.firstBehind.id, 'l2');
  eq(a.nextDeadline.id, 'h2');
  eq(a.nextLecture.id, 'l5');
  const b = st.get('b');
  eq([b.lectures, b.behind, b.nextDeadline, b.nextLecture.id], [1, 0, null, 'm1']);
});

test('upcoming: overdue assignments first, finished and past exams left out', () => {
  const s = state(['a'], [
    item('e0', 'a', 'exam', '2026-11-01'), item('h1', 'a', 'assignment', '2026-11-10'), item('h2', 'a', 'assignment', '2026-11-12', { done: true }),
    item('e1', 'a', 'exam', '2026-11-19'), item('h3', 'a', 'assignment', '2026-11-14'), lec('l', 'a', '2026-11-15'),
  ]);
  eq(C.upcoming(s, TODAY).map(i => i.id), ['h1', 'h3', 'e1']);
  eq(C.upcoming(s, TODAY, 2).map(i => i.id), ['h1', 'h3']);
});

test('range: starts the week of 1 Sep 2026, whole weeks, grows for outliers', () => {
  const r = C.range(state(['a'], []), TODAY);
  eq([r.start, r.end, r.days % 7], ['2026-08-31', '2027-05-02', 0]);
  const early = C.range(state(['a'], [lec('x', 'a', '2026-08-12')]), TODAY);
  eq(early.start, '2026-08-10');
  const late = C.range(state(['a'], [lec('x', 'a', '2027-06-10')]), TODAY);
  eq(late.end, '2027-06-20'); // the item's week plus a spare one
  const future = C.range(state(['a'], []), '2027-09-20');
  eq(future.end >= '2027-10-18', true);
  const wideFuture = C.range(state(['a'], []), '2027-09-20', 12);
  eq([C.weekIndex('2027-09-20', wideFuture.start) >= 1, C.weekIndex(wideFuture.end, wideFuture.start) - C.weekIndex('2027-09-20', wideFuture.start) >= 10], [true, true]);
  const earlyToday = C.range(state(['a'], []), '2026-01-01', 12);
  eq(C.weekIndex('2026-01-01', earlyToday.start), 1);
  const typo = C.range(state(['a'], [lec('x', 'a', '2206-01-01')]), TODAY);
  eq(typo.end <= '2036-01-06', true);
});

test('months: labels, year on the first and on January, sliver at the start is unnamed', () => {
  const m = C.months(C.range(state(['a'], []), TODAY));
  eq(m.slice(0, 3).map(x => [x.label, x.offset, x.days]), [['', 0, 1], ['September 2026', 1, 30], ['October', 31, 31]]);
  eq(m.find(x => x.iso === '2027-01-01').label, 'January 2027');
  eq(m.reduce((n, x) => n + x.days, 0), C.range(state(['a'], []), TODAY).days);
});

test('recurrence: Mon/Wed/Fri until a date, inclusive', () => {
  const d = C.recurrence('2026-09-09', '2026-09-23', [0, 2, 4]);
  eq(d, ['2026-09-09', '2026-09-11', '2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21', '2026-09-23']);
  eq(C.recurrence('2026-09-09', '2026-09-08', [0]), []);
  eq(C.recurrence('2026-09-09', '2026-12-04', [1, 3]).length, 25);
  eq(C.recurrence('2026-09-09', '2035-12-31', [0, 1, 2, 3, 4, 5, 6]).length, 400);
});

test('addSeries: skips dates with a lecture, keeps fields and can mark past occurrences done', () => {
  const s = state(['a'], [lec('x', 'a', '2026-11-11')]);
  const added = C.addSeries(s, { classId: 'a', type: 'lecture', title: 'Plant biology', link: 'https://x.y', done: true },
    ['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16'], { today: TODAY });
  eq(added.map(i => [i.date, i.done, i.title, i.link]), [
    ['2026-11-09', true, 'Plant biology', 'https://x.y'], ['2026-11-13', true, 'Plant biology', 'https://x.y'],
    ['2026-11-16', false, 'Plant biology', 'https://x.y'],
  ]);
  eq(s.items.length, 4);
  eq(new Set(s.items.map(i => i.id)).size, 4);
});

test('repeat preview counts new dates beyond the first 400 occupied slots', () => {
  const occupied = new Set(C.recurrence('2026-01-01', '2027-02-06', [0, 1, 2, 3, 4, 5, 6]));
  eq(occupied.size, 400);
  eq(C.recurrence('2026-01-01', '2027-02-06', [0, 1, 2, 3, 4, 5, 6], occupied),
    ['2027-02-05', '2027-02-06']);
});

test('addSeries: assignment, exam and untitled lecture labels follow the selected type', () => {
  const s = state(['a'], []);
  const dates = ['2026-11-20', '2026-11-27'];
  for (const [type, title, expected] of [
    ['assignment', 'PS', ['PS 1', 'PS 2']],
    ['assignment', '', ['Assignment', 'Assignment']],
    ['exam', 'Skills check', ['Skills check', 'Skills check']],
    ['lecture', '', ['Lecture 1', 'Lecture 2']],
  ]) {
    const added = C.addSeries(s, { classId: 'a', type, title, link: '' }, dates, { today: TODAY });
    const nums = C.lectureNumbers(s);
    eq(added.map(i => [i.classId, i.type, i.date, C.title(i, nums)]), dates.map((date, index) => ['a', type, date, expected[index]]));
  }
});

test('markThrough, markPastDone, removeFollowing only touch that class\'s lectures', () => {
  const mk = () => state(['a', 'b'], [lec('a1', 'a', '2026-11-02'), lec('a2', 'a', '2026-11-04'), lec('a3', 'a', '2026-11-06'), lec('a4', 'a', '2026-11-20'),
    lec('b1', 'b', '2026-11-03'), item('h', 'a', 'assignment', '2026-11-03')]);
  let s = mk();
  eq(C.markThrough(s, 'a2'), 2);
  eq(s.items.filter(i => i.done).map(i => i.id), ['a1', 'a2']);
  s = mk();
  eq(C.markPastDone(s, 'a', TODAY), 3);
  eq(s.items.filter(i => i.done).map(i => i.id), ['a1', 'a2', 'a3']);
  s = mk();
  eq(C.removeFollowing(s, 'a3'), 2);
  eq(s.items.map(i => i.id), ['a1', 'a2', 'b1', 'h']);
  eq(C.removeFollowing(s, 'h'), 0);
  eq(C.markThrough(s, 'h'), 0);
  eq(s.items.map(i => i.done), [false, false, false, false]);
});

test('classes: add assigns unused colours, move and remove', () => {
  const s = state([], []);
  const a = C.addClass(s, '  BIOL 200 ');
  const b = C.addClass(s, 'CPSC 110');
  eq([a.name, a.color, b.color], ['BIOL 200', 0, 1]);
  eq(C.addClass(s, '   '), null);
  s.items.push(lec('x', a.id, '2026-11-02'));
  eq(C.moveClass(s, b.id, -1), 1);
  eq(s.classes.map(c => c.name), ['CPSC 110', 'BIOL 200']);
  eq(C.moveClass(s, b.id, -1), 0);
  eq(C.removeClass(s, a.id), 1);
  eq([s.classes.length, s.items.length], [1, 0]);
});

test('weeks: dates map to Monday–Sunday columns across month and year boundaries', () => {
  const start = '2026-08-31';
  eq(['2026-08-30', start, '2026-09-06', '2026-09-07', '2027-01-03', '2027-01-04']
    .map(d => C.weekIndex(d, start)), [-1, 0, 0, 1, 17, 18]);
  eq(C.weekDate(start, 10, TODAY), TODAY);
  eq(C.weekDate(start, 9, TODAY), '2026-11-02');
  eq(C.weekDate(start, 11, TODAY), '2026-11-16');
});

test('layoutWeeks: all types stack in date order, with row height set by the busiest week', () => {
  const range = { start: '2026-11-09', weeks: 2 };
  const L = C.layoutWeeks([
    { id: 'sunday', type: 'exam', date: '2026-11-15' },
    { id: 'next', type: 'lecture', date: '2026-11-16' },
    { id: 'monday', type: 'lecture', date: '2026-11-09' },
    { id: 'same-day', type: 'assignment', date: '2026-11-09' },
    { id: 'before', date: '2026-11-08' }, { id: 'after', date: '2026-11-23' },
  ], range);
  eq(['monday', 'same-day', 'sunday', 'next'].map(id => L.pos.get(id)), [
    { week: 0, lane: 0 }, { week: 0, lane: 1 }, { week: 0, lane: 2 }, { week: 1, lane: 0 },
  ]);
  eq([L.pos.has('before'), L.pos.has('after'), L.lanes], [false, false, 3]);
  eq(C.layoutWeeks([], range).lanes, 1);
  const crowded = C.layoutWeeks(Array.from({ length: 10 }, (_, i) => ({ id: String(i), date: '2026-11-09' })), range);
  eq(crowded.lanes, 10);
  eq(Array.from(crowded.pos.values(), p => p.lane), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('compact: lectures in order, split at today, with the widest past and future counts', () => {
  const s = state(['a', 'b'], [lec('a2', 'a', '2026-11-13'), lec('a1', 'a', '2026-11-02'), lec('a3', 'a', '2026-11-14'), lec('b1', 'b', '2026-11-20'),
    lec('b2', 'b', '2026-11-22'), item('e', 'a', 'exam', '2026-11-05')]);
  const k = C.compact(s, TODAY);
  eq(k.rows.get('a').past.map(i => i.id), ['a1', 'a2']);
  eq(k.rows.get('a').future.map(i => i.id), ['a3']);
  eq([k.maxPast, k.maxFuture], [2, 2]);
});

test('normalize: reads the original Lectures data file and its exports', () => {
  const old = { state: { classes: [{ id: 'c1', name: 'MBB326' }, { id: 'c2', name: 'MBB321' }], items: [
    { id: 'i1', classId: 'c1', type: 'lecture', title: '', date: '2026-09-09', done: true, link: '' },
    { id: 'i2', classId: 'c2', type: 'exam', title: 'Midterm', date: '2026-10-20', done: false, link: 'https://a.b' }] }, view: 'compact' };
  const d = C.normalize(old);
  eq(d.classes, [{ id: 'c1', name: 'MBB326', color: 0 }, { id: 'c2', name: 'MBB321', color: 1 }]);
  eq(d.items.length, 2);
  eq(d.settings, { view: 'compact', theme: 'system' });
  eq(C.normalize({ classes: old.state.classes, items: old.state.items }).items[1].title, 'Midterm');
  eq(C.normalize(Object.assign({}, old, { view: 'date' })).settings.view, 'timeline');
  eq(C.normalize(old, { view: 'timeline', theme: 'dark' }).settings, { view: 'compact', theme: 'dark' });
});

test('normalize: drops what it cannot use and never throws on junk', () => {
  const d = C.normalize({ classes: [{ id: 'c', name: 'A' }, { id: 'c', name: 'dup' }, { name: '' }, null, { name: 'No id' }], items: [
    { id: 'ok', classId: 'c', type: 'lecture', date: '2026-09-09' }, { id: 'ok', classId: 'c', type: 'lecture', date: '2026-09-10', done: 'yes', title: 5 },
    { id: 'x', classId: 'gone', type: 'lecture', date: '2026-09-09' }, { id: 'y', classId: 'c', type: 'quiz', date: '2026-09-09' },
    { id: 'z', classId: 'c', type: 'exam', date: '09/09/2026' }, 'nope', null] });
  eq(d.classes.map(c => c.name), ['A', 'No id']);
  eq(d.items.length, 2);
  eq(d.items[1].done, false);
  eq(d.items[1].title, '');
  eq(d.items[0].id !== d.items[1].id, true);
  eq(d.dropped, 8);
  for (const junk of [null, 5, 'x', [], {}, { classes: [] }, { classes: {}, items: [] }, { state: 3 }]) eq(C.normalize(junk), null);
});

test('serialize → normalize round-trips', () => {
  const s = state(['a'], [lec('l', 'a', '2026-09-09', { link: 'https://x.y/z', done: true }), item('e', 'a', 'exam', '2026-10-01', { title: 'Midterm' })]);
  s.settings = { view: 'compact', theme: 'light' };
  const d = C.normalize(JSON.parse(JSON.stringify(C.serialize(s))));
  eq({ classes: d.classes, items: d.items, settings: d.settings }, s);
});

test('malformed optional data cannot hide an otherwise valid backup', () => {
  const d = C.normalize({ state: {}, classes: [{ id: 'c', name: 'C' }, { name: { toString: 2 } }],
    items: [lec('l', 'c', TODAY)], calendarUnmatched: [
      { feedId: '', uid: 'file', occurrence: '', date: TODAY, title: { description: 42 } },
    ] });
  eq([d.classes.length, d.items[0].id, d.dropped, d.calendarUnmatched[0].title], [1, 'l', 1, '']);
});

test('long item links survive sync, export and reload without truncating the destination', () => {
  const Calendar = require('../web/calendar.js');
  const url = 'https://example.test/file?token=' + 'a'.repeat(2100);
  const s = state(['a'], []);
  s.calendars = [{ id: 'f', classId: 'a', url: 'https://example.test/feed' }];
  Calendar.reconcile(s, s.calendars[0], C.parseICS('BEGIN:VEVENT\nUID:u\nDTSTART:20261116\nURL:' + url + '\nEND:VEVENT'));
  const item = C.normalize(C.serialize(s)).items[0];
  eq([item.link, item.calendar.original.link], [url, url]);
  s.calendars[0].url = url;
  eq(C.normalize(s).calendars[0].url, url);
  assert.throws(() => Calendar.calendarURL(url), /too long/);
});

test('links: bare domains get https, paths and other schemes are left alone', () => {
  eq(C.normalizeLink(' canvas.ubc.ca/courses/1 '), 'https://canvas.ubc.ca/courses/1');
  eq(C.normalizeLink('https://a.b/c d'), 'https://a.b/c d');
  eq(C.normalizeLink('zoommtg://zoom.us/join?confno=1'), 'zoommtg://zoom.us/join?confno=1');
  eq(C.normalizeLink('~/Notes/L1.pdf'), '~/Notes/L1.pdf');
  eq(C.normalizeLink('week 3 notes'), 'week 3 notes');
  eq(C.normalizeLink(''), '');
  eq(C.linkLabel('https://www.youtube.com/watch?v=1'), 'youtube.com');
  eq(C.linkLabel('/Users/me/Notes/L1.pdf'), 'L1.pdf');
  eq(C.linkLabel('file:///Users/me/L2.pdf'), 'L2.pdf');
});

test('titles', () => {
  const s = state(['a'], [lec('l1', 'a', '2026-09-09'), lec('l2', 'a', '2026-09-11', { title: 'Membranes' }), item('e', 'a', 'exam', '2026-10-01'), item('h', 'a', 'assignment', '2026-10-02', { title: 'PS 3' })]);
  const n = C.lectureNumbers(s);
  eq(s.items.map(i => C.title(i, n)), ['Lecture 1', 'Membranes', 'Exam', 'PS 3']);
});

test('calendar: unfolds lines and decodes text escapes', () => {
  const events = C.parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-1\r\nDTSTART;VALUE=DATE:20261114\r\nSUMMARY:First\\, second\\; third\\nLong\r\n  title\r\nDESCRIPTION:See https://example.test/a\\,b\r\nEND:VEVENT\r\nEND:VCALENDAR');
  eq(events, [{ uid: 'event-1', title: 'First, second; third\nLong title', date: '2026-11-14', link: 'https://example.test/a,b', occurrence: '', type: 'assignment' }]);
});

test('calendar: dates, floating time, UTC and TZID use local dates', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const events = C.parseICS('BEGIN:VEVENT\nUID:date\nDTSTART;VALUE=DATE:20261114\nEND:VEVENT\n' +
      'BEGIN:VEVENT\nUID:floating\nDTSTART:20261114T003000\nEND:VEVENT\n' +
      'BEGIN:VEVENT\nUID:utc\nDTSTART:20261114T003000Z\nEND:VEVENT\n' +
      'BEGIN:VEVENT\nUID:zone\nDTSTART;TZID=Asia/Tokyo:20261114T003000\nURL:https://example.test/item\nEND:VEVENT');
    eq(events.map(e => [e.uid, e.date]), [['date', '2026-11-14'], ['floating', '2026-11-14'], ['utc', '2026-11-13'], ['zone', '2026-11-13']]);
    eq(events[3].link, 'https://example.test/item');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('calendar: weekly BYDAY, COUNT, EXDATE and UNTIL', () => {
  const events = C.parseICS('BEGIN:VEVENT\nUID:count\nDTSTART;VALUE=DATE:20261102\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5\nEXDATE;VALUE=DATE:20261104,20261109\nEND:VEVENT\n' +
    'BEGIN:VEVENT\nUID:until\nDTSTART;VALUE=DATE:20261102\nRRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116\nEND:VEVENT\n' +
    'BEGIN:VEVENT\nUID:unsupported\nDTSTART;VALUE=DATE:20261102\nRRULE:FREQ=MONTHLY;COUNT=3\nEND:VEVENT');
  eq(events.filter(e => e.uid === 'count').map(e => [e.date, e.occurrence]), [['2026-11-02', '2026-11-02'], ['2026-11-11', '2026-11-11'], ['2026-11-16', '2026-11-16']]);
  eq(events.filter(e => e.uid === 'until').map(e => e.date), ['2026-11-02', '2026-11-09', '2026-11-16']);
  eq(events.some(e => e.uid === 'unsupported'), false);
});

test('calendar: summary type and class matching', () => {
  eq(['Final exam', 'Midterm', 'Quiz 1', 'Homework', 'HW 3', 'Lab report', 'Problem set', 'Submission due', 'Lecture'].map(C.calendarType),
    ['exam', 'exam', 'exam', 'assignment', 'assignment', 'assignment', 'assignment', 'assignment', 'lecture']);
  const classes = [{ id: 'a', name: 'MBB 438 Biochemistry' }, { id: 'b', name: 'Calculus' }];
  eq(C.matchCalendarClass('Quiz [MBB438]', classes), 'a');
  eq(C.matchCalendarClass('MBB 438: Lecture', classes), 'a');
  eq(C.matchCalendarClass('Calculus — Week 1', classes), 'b');
  eq(C.matchCalendarClass('Something else', classes), null);
  eq(C.matchCalendarClass('MBB 4380', classes), null);
});

test('calendar: feeds, event metadata and unmatched entries survive export/import', () => {
  const s = state(['a'], [lec('l', 'a', '2026-11-14')]);
  s.calendars = [{ id: 'f', url: 'webcal://example.test/a', classId: '', lastSynced: '2026-11-14T00:00:00Z' }];
  s.items[0].calendar = { feedId: 'f', uid: 'u', occurrence: '', original: { classId: 'a', type: 'lecture', title: '', date: '2026-11-14', link: '' } };
  s.calendarUnmatched = [{ feedId: 'f', uid: 'v', occurrence: '', title: 'Quiz', type: 'exam', date: '2026-11-15', link: '' },
    { feedId: '', uid: 'one', occurrence: '', title: 'Homework', type: 'assignment', date: '2026-11-16', link: '' }];
  const d = C.normalize(JSON.parse(JSON.stringify(C.serialize(s))));
  eq(d.calendars, s.calendars);
  eq(d.items[0].calendar, s.items[0].calendar);
  eq(d.calendarUnmatched, s.calendarUnmatched);
});

test('calendar: reconcile updates, deduplicates and preserves edits and done', () => {
  const Calendar = require('../web/calendar.js');
  const state = { classes: [{ id: 'c', name: 'MBB 438', color: 0 }], items: [], calendarUnmatched: [] };
  const feed = { id: 'feed', classId: 'c' };
  const event = (uid, title, date, link = '') => ({ uid, title, date, link, occurrence: '' });
  Calendar.reconcile(state, feed, [event('a', 'Lecture', '2026-11-01'), event('b', 'Quiz', '2026-11-02')]);
  const first = state.items.find(i => i.calendar.uid === 'a');
  first.done = true;
  first.title = 'My notes';
  Calendar.reconcile(state, feed, [event('a', 'New title', '2026-11-03', 'https://example.com'), event('a', 'Duplicate', '2026-11-03')]);
  assert.strictEqual(state.items.length, 1);
  assert.strictEqual(first.title, 'My notes');
  assert.strictEqual(first.date, '2026-11-03');
  assert.strictEqual(first.link, 'https://example.com');
  assert.strictEqual(first.done, true);
  Calendar.reconcile(state, feed, [event('a', 'My notes', '2026-11-03')]);
  Calendar.reconcile(state, feed, [event('a', 'Another title', '2026-11-04')]);
  assert.strictEqual(first.title, 'My notes');
  Calendar.reconcile(state, feed, []);
  assert.strictEqual(state.items.length, 1);
  assert.strictEqual(state.items[0].calendar, undefined);
});

console.log(process.exitCode ? 'core: FAILED' : 'core: ' + passed + ' checks passed');
