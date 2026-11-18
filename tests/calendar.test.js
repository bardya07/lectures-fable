const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../web/core.js');
const Calendar = require('../web/calendar.js');

const canvas = fs.readFileSync(path.join(__dirname, 'fixtures', 'canvas.ics'), 'utf8');
const importFixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'import.ics'), 'utf8');
const calendar = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
const vevent = (summary, properties, uid = 'fixture@calendar.example.test') => [
  'BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + summary, ...properties, 'END:VEVENT',
].join('\r\n');
const timed = ['DTSTART:20261116T180000Z', 'DTEND:20261116T190000Z'];
const allDay = ['DTSTART;VALUE=DATE:20261116'];
const zero = ['DTSTART:20261116T230000Z', 'DTEND:20261116T230000Z'];
const weekly = [...timed, 'RRULE:FREQ=WEEKLY;COUNT=2'];
const cases = [
  ['Quiz #4', zero, 'exam', 'event-assignment-987001'],
  ['Quiz 6 due', [...allDay, 'CATEGORIES:Assignments', 'DESCRIPTION:Assignment due',
    'URL:https://canvas.example.test/courses/42/assignments/12'], 'exam', 'event-assignment-987101'],
  ['Quiz 3', zero, 'exam', 'event-assignment-987002'],
  ['Midterm 2 in Class', timed, 'exam', 'event-calendar-event-987003'],
  ['Midterm 3', timed, 'exam'],
  ['Final Exam', timed, 'exam'],
  ['FINAL', timed, 'exam'],
  ['Unit Test 2', timed, 'exam'],
  ['Oral Assessment', timed, 'exam'],
  ['Module 7', [...timed, 'URL:https://canvas.example.test/courses/42/quizzes/66'], 'exam'],
  ['Room 12', [...timed, 'CATEGORIES:Teaching,Exams'], 'exam'],
  ['Week 7', [...timed, 'DESCRIPTION:Written exam in the main hall.'], 'exam'],
  ['Homework 2', allDay, 'assignment', 'event-assignment-987004'],
  ['Podcast 3', zero, 'assignment'],
  ['In-class worksheet 4', zero, 'assignment'],
  ['Cell Signaling Presentations (6 students)', zero, 'assignment'],
  ['HW12', zero, 'assignment'],
  ['PS3', zero, 'assignment'],
  ['Problem Set 2', allDay, 'assignment'],
  ['Lab Report', timed, 'assignment'],
  ['Essay and peer reflection', zero, 'assignment'],
  ['Paper', allDay, 'assignment'],
  ['Field report', timed, 'assignment'],
  ['Group project', allDay, 'assignment'],
  ['Final project', allDay, 'assignment'],
  ['Final paper', timed, 'assignment'],
  ['Submission', zero, 'assignment'],
  ['Production copy', [...timed, 'CATEGORIES:Coursework,Assignments'], 'assignment'],
  ['Module 4', [...timed, 'URL:https://canvas.example.test/courses/42/assignments/68'], 'assignment'],
  ['Read chapter 5', timed, 'assignment', 'event-assignment-987005'],
  ['Check-in', [...zero, 'DESCRIPTION:Slides due by the end of the day.'], 'assignment'],
  ['Chapter 7', allDay, 'assignment'],
  ['Cell signaling', timed, 'lecture', 'event-calendar-event-987006'],
  ['Lec12', timed, 'lecture'],
  ['Seminar', timed, 'lecture'],
  ['Tutorial 10', timed, 'lecture'],
  ['Lab 2', timed, 'lecture'],
  ['Applied mechanics', weekly, 'lecture'],
  ['Examples of hypothesis testing', timed, 'lecture'],
  ['Contest planning', timed, 'lecture'],
  ['Homework Club', [...weekly, 'DESCRIPTION:Homework Club meets in Room 12.'], 'lecture'],
  ['Homework Club', allDay, 'lecture'],
  ['Midterm 2 Review Session', [...timed, 'CATEGORIES:Exams'], 'lecture'],
  ['Midterm 2 Cutoff for Material', timed, 'skip'],
  ['Tutorial D409 Cancelled', timed, 'skip'],
  ['Tutorials Cancelled Today', timed, 'skip'],
  ['Remembrance Day no classes or tutorials', timed, 'skip'],
  ['No class today', timed, 'skip'],
  ['Regional closure', [...allDay, 'CATEGORIES:Holidays'], 'skip'],
  ['Labour Day', allDay, 'skip'],
  ['Session 3', [...timed, 'STATUS:CANCELLED'], 'skip'],
  ['Block A', ['DTSTART;TZID=America/Vancouver:20261215T130000', 'DURATION:PT2H30M'], 'exam'],
  ['Block A', ['DTSTART:20261015T130000Z', 'DTEND:20261015T153000Z'], 'lecture'],
  ['Block A', ['DTSTART:20261215T130000Z', 'DTEND:20261215T153000Z', 'RRULE:FREQ=WEEKLY;COUNT=2'], 'lecture'],
  ['Module 1', [...timed, 'CATEGORIES:Assignments,Exams'], 'lecture'],
  ['Seminar: holiday customs', timed, 'lecture'],
];

async function testDeletedOccurrences() {
  const text = calendar(vevent('Weekly lecture', weekly));
  let state = C.normalize({ classes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], items: [] });
  let fetch = () => ({ text });
  const controller = Calendar.createController({
    state: () => state, snapshot: () => JSON.stringify(state), changed() {}, call: () => fetch(),
  });
  const url = 'https://example.test/weekly';
  await controller.add(url, 'a');
  await controller.add(url + '-other', 'b');
  const [feed, other] = state.calendars;
  const first = state.items[0];
  let reply;
  fetch = () => new Promise(resolve => { reply = resolve; });
  const pending = controller.sync(feed.id);
  C.removeItems(state, item => item.id === first.id);
  reply({ text });
  await pending;
  assert.deepEqual(state.items.map(i => i.calendar.feedId), [feed.id, other.id, other.id]);
  const { feedId, uid, occurrence } = first.calendar;
  const tombstone = { feedId, uid, occurrence };
  state = C.normalize(JSON.parse(JSON.stringify(C.serialize(state))));
  assert.deepEqual(state.calendarTombstones, [tombstone]);
  const [survivor] = state.items;
  C.removeFollowing(state, survivor.id);
  fetch = () => ({ text: text.replace('Weekly lecture', 'Lecture cancelled') });
  await controller.sync(feed.id);
  assert.equal(state.calendarSkipped.length, 0);
  C.removeClass(state, 'b');
  assert.equal(state.calendarTombstones.length, 4);
  fetch = () => ({ text });
  await controller.sync(other.id);
  assert.equal(state.calendarUnmatched.length, 0);
  assert.equal(state.items.length, 0);
  controller.remove(feed.id);
  assert.deepEqual(state.calendarTombstones.map(t => t.feedId), [other.id, other.id]);
  await controller.add(url, 'a');
  assert.equal(state.items.length, 2);
  assert.notEqual(state.items[0].calendar.feedId, feed.id);
}

async function testDeletedClass() {
  let state = C.normalize({ classes: [{ id: 'a', name: 'AST 441' }, { id: 'b', name: 'PHY 567' }], items: [] });
  let source = calendar(vevent('Lecture without a class code', timed, 'assigned'),
    vevent('No class today', allDay, 'assigned-notice'));
  const controller = Calendar.createController({ state: () => state, snapshot: () => JSON.stringify(state),
    changed() {}, call: () => ({ text: source }) });
  await controller.add('https://calendar.example.test/assigned', 'a');
  const assignedSource = source;
  source = canvas;
  await controller.add('https://calendar.example.test/auto', '');
  const [assigned, auto] = state.calendars;
  C.editItem(state.items.find(i => i.calendar.uid === 'assigned'), { classId: 'b', title: 'My lecture notes', done: true });
  const before = JSON.stringify(C.serialize(state));
  C.removeClass(state, 'a');
  state = C.normalize(JSON.parse(JSON.stringify(C.serialize(state))));
  assert.deepEqual(state.calendarTombstones.map(t => t.uid).sort(),
    ['assigned', 'assigned-notice', 'event-assignment-6000101', 'event-calendar-event-6000103']);
  assert.equal(state.calendars[0].classId, '');
  assert.equal(state.calendarSkipped.some(e => e.feedId === assigned.id), false);
  await controller.sync(auto.id);
  source = assignedSource.replace('No class today', 'Lecture once more');
  await controller.sync(assigned.id);
  assert.deepEqual(state.calendarUnmatched.map(e => e.uid), ['event-assignment-6000107']);
  assert.ok(state.items.some(i => i.title === 'My lecture notes' && i.done && !i.calendar));
  assert.ok(state.items.every(i => !i.calendar || !state.calendarTombstones.some(t => t.uid === i.calendar.uid)));

  state = C.normalize(JSON.parse(before));
  source = assignedSource;
  await controller.sync(assigned.id);
  assert.equal(state.calendars[0].classId, 'a');
  assert.equal(state.calendarTombstones.length, 0);
  assert.ok(state.calendarSkipped.some(e => e.uid === 'assigned-notice' && e.classId === 'a'));
  assert.ok(state.items.some(i => i.calendar?.uid === 'assigned' && i.classId === 'b' && i.done));
}

async function testFileImportDeduplication() {
  let state = C.normalize({ classes: [{ id: 'a', name: 'AST 441' }, { id: 'b', name: 'PHY 567' }], items: [
    { id: 'old-import', classId: 'a', type: 'lecture', title: 'Lab', date: '2026-11-20', done: true },
  ] });
  let source = importFixture;
  const controller = Calendar.createController({ state: () => state, snapshot: () => JSON.stringify(state),
    changed() {}, call: () => ({ text: source }) });
  const first = await controller.importFile('a');
  assert.deepEqual([first.added, first.alreadyPresent, first.unmatched, first.skipped], [7, 1, 0, 1]);
  assert.match(first.warning, /unsupported recurrence/);
  const legacy = state.items.find(i => i.id === 'old-import');
  assert.ok(legacy.done && legacy.calendarImport.uid === 'import-lab@example.test');
  const moved = state.items.find(i => i.title === 'Rescheduled lecture');
  const noUID = state.items.find(i => i.title === 'Drop-in lecture');
  C.editItem(moved, { title: 'My recurring lecture notes', date: '2026-11-26', done: true, link: 'https://example.test/notes' });
  C.editItem(noUID, { title: 'My drop-in notes', date: '2026-11-25', done: true, classId: 'b' });
  state = C.normalize(JSON.parse(JSON.stringify(C.serialize(state))));
  const saved = JSON.stringify(C.serialize(state));
  const again = await controller.importFile('a');
  assert.deepEqual([again.added, again.alreadyPresent, again.unmatched, again.skipped], [0, 9, 0, 0]);
  assert.equal(JSON.stringify(C.serialize(state)), saved);
  assert.deepEqual(C.outsideRange(state.items, C.range(state, '2026-11-18')).map(i => i.date), ['2019-12-15', '2036-01-15']);

  source = calendar(
    vevent('Another date for the same occurrence', ['RECURRENCE-ID;TZID=Etc/GMT+8:20261123T100000', 'DTSTART:20261127T180000Z'], 'import-series@example.test'),
    vevent('Lab with a revised title', ['DTSTART;TZID=Etc/GMT+8:20261120T100000'], 'import-lab@example.test'),
    vevent('Lab', ['DTSTART:20261120T220000Z'], 'import-lab@example.test'),
    vevent('Lab', ['DTSTART:20261120T180000Z'], 'import-other-lab@example.test'));
  const overlap = await controller.importFile('a');
  assert.deepEqual([overlap.added, overlap.alreadyPresent], [2, 2]);
  assert.deepEqual(state.items.slice(0, 8), JSON.parse(saved).items);

  source = calendar(vevent('Drop-in lecture', ['DTSTART:20261119T180000Z'], '').replace('UID:\r\n', ''));
  assert.equal((await controller.importFile('b')).added, 1);
  assert.equal((await controller.importFile('b')).alreadyPresent, 1);
  source = source.replace('Drop-in lecture', 'Unmatched drop-in lecture');
  assert.equal((await controller.importFile('')).unmatched, 1);
  state = C.normalize(JSON.parse(JSON.stringify(C.serialize(state))));
  assert.equal((await controller.importFile('')).alreadyPresent, 1);
  controller.assign('a');
  assert.equal((await controller.importFile('a')).alreadyPresent, 1);
  controller.importNotice(state.calendarSkipped[0]);
  source = importFixture;
  assert.equal((await controller.importFile('a')).alreadyPresent, 9);
  assert.equal(state.calendarSkipped.length, 0);
}

function testRecurrence() {
  const alt = ['DTSTART;TZID="Europe/Berlin";X-NOTE="point;a:b":20261018T023000', 'RRULE:FREQ=WEEKLY;COUNT=3'];
  const fold = vevent('Moved', ['RECURRENCE-ID:20261025T003000Z', 'DTSTART:20261026T120000Z']);
  const expanded = C.parseICS(calendar(vevent('Class', alt), fold), true);
  assert.deepEqual(expanded.map(e => [e.title, e.occurrence]), [
    ['Class', '2026-10-18'], ['Moved', '2026-10-25'], ['Class', '2026-11-01'],
  ]);
  const gap = C.parseICS(calendar(vevent('Weekly', [
    'DTSTART;TZID=Europe/Berlin:20260322T023000', 'RRULE:FREQ=WEEKLY;COUNT=3',
  ])), true);
  assert.deepEqual(gap.map(e => e.occurrence), ['2026-03-22', '2026-04-05', '2026-04-12']);
  const replace = C.parseICS(calendar(
    vevent('Class', ['DTSTART;TZID=America/Vancouver:20261116T230000', 'RRULE:FREQ=WEEKLY;COUNT=2', 'EXDATE:20261117T070000Z']),
    vevent('Changed', ['RECURRENCE-ID:20261117T070000Z', 'DTSTART:20261118T070000Z'])), true);
  assert.equal(replace.find(e => e.title === 'Changed').occurrence, '2026-11-16');
  assert.equal(C.parseICS(calendar(vevent('Class', [...allDay, 'EXDATE;VALUE=DATE:20261116'])), true).length, 0);
  assert.deepEqual(C.parseICS(calendar(vevent('Lecture', [
    'DTSTART;VALUE=DATE:99991224', 'RRULE:FREQ=WEEKLY',
  ])), true).map(e => e.date), ['9999-12-24', '9999-12-31']);
}

async function testIncompleteFeedKeepsItems() {
  const state = C.normalize({ classes: [{ id: 'a', name: 'A' }], items: [] });
  let text = calendar(vevent('Lecture', weekly));
  const ctl = Calendar.createController({ state: () => state, snapshot: () => JSON.stringify(state),
    call: () => ({ text }), changed() {} });
  await ctl.add('https://example.test/protected', 'a');
  const [feed] = state.calendars;
  const before = JSON.stringify(state);
  for (const [properties, error] of [
    [[...timed, 'RRULE:FREQ=MONTHLY;COUNT=2'], 'Some calendar events use unsupported recurrence rules.'],
    [[...weekly, 'RDATE:20261202T180000Z'], 'Some calendar events use unsupported recurrence rules.'],
    [[...weekly, 'RRULE:FREQ=WEEKLY;COUNT=3'], 'Some calendar events use unsupported recurrence rules.'],
    [[...timed, 'RRULE:FREQ=WEEKLY;BYDAY='], 'Invalid weekly calendar rule.'],
    [[...timed, 'RRULE:FREQ=WEEKLY;COUNT=2;COUNT=1'], 'Invalid weekly calendar rule.'],
    [['DTSTART;TZID=Local/Unknown:20261116T180000'], 'Unsupported calendar time zone.'],
    [[...allDay, 'DTEND:bad'], 'Invalid calendar end date.'],
  ]) {
    text = calendar(vevent('Lecture', properties));
    await ctl.sync(feed.id);
    assert.equal(JSON.stringify(state), before);
    assert.equal(ctl.list().feeds[0].error, error);
  }
  text = calendar(calendar(vevent('Nested calendar', allDay)));
  await ctl.sync(feed.id);
  assert.equal(JSON.stringify(state), before);
  assert.equal(ctl.list().feeds[0].error, 'Invalid calendar file.');

  const known = state.items.map(item => item.id);
  text = calendar(vevent('Lecture', [...timed, 'RRULE:FREQ=MONTHLY;COUNT=2']), vevent('New deadline', allDay, 'other'));
  await ctl.sync(feed.id);
  assert.deepEqual(state.items.slice(0, 2).map(item => item.id), known);
  assert.equal(state.items[2].title, 'New deadline');
  assert.match(ctl.list().feeds[0].error, /unsupported recurrence/);
}

function testRevisionsAndCanonicalTitles() {
  const older = vevent('Stale series', [...timed, 'RRULE:FREQ=WEEKLY;COUNT=4', 'SEQUENCE:1']);
  const newer = vevent('Latest series', [...weekly, 'SEQUENCE:2']);
  const oldOverride = vevent('Earlier edit', ['RECURRENCE-ID:20261123T180000Z', 'DTSTART:20261124T180000Z', 'SEQUENCE:1']);
  const newOverride = vevent('Latest edit', ['RECURRENCE-ID:20261123T180000Z', 'DTSTART:20261125T180000Z', 'SEQUENCE:2']);
  for (const revisions of [[older, newer, newOverride, oldOverride], [newer, older, oldOverride, newOverride]]) {
    assert.deepEqual(C.parseICS(calendar(...revisions), true).map(e => e.title), ['Latest series', 'Latest edit']);
  }
  const sameSequence = calendar(vevent('First revision', [...timed, 'SEQUENCE:1', 'DTSTAMP:20261101T120000Z']),
    vevent('Most recent revision', [...timed, 'SEQUENCE:1', 'DTSTAMP:20261102T120000Z']));
  assert.deepEqual(C.parseICS(sameSequence, true).map(e => e.title), ['Most recent revision']);

  let state = C.normalize({ classes: [{ id: 'a', name: 'A' }], items: [],
    calendars: [{ id: 'feed', url: 'https://example.test/title', classId: 'a' }] });
  const longTitle = 'x'.repeat(199) + ' continuation';
  const initial = C.parseICS(calendar(vevent(longTitle, allDay)), true);
  Calendar.reconcile(state, state.calendars[0], initial);
  // Grod 1.2.0 could save both copies with a space at the truncation boundary.
  state.items[0].title += ' ';
  state.items[0].calendar.original.title += ' ';
  state = C.normalize(JSON.parse(JSON.stringify(C.serialize(state))));
  Calendar.reconcile(state, state.calendars[0], C.parseICS(calendar(vevent('Revised title', allDay)), true));
  assert.equal(state.items[0].title, 'Revised title');
  assert.equal(state.items[0].calendar.edited, undefined);
}

async function testUnchangedSync() {
  const text = calendar(vevent('Lecture', weekly, 'u'), vevent('Holiday', allDay, 'h'));
  let s = C.normalize({ classes: [{ id: 'a', name: 'A' }], items: [] });
  const changes = [], persisted = [];
  const ctl = Calendar.createController({ state: () => s, snapshot: () => JSON.stringify(s), call: () => ({ text }),
    changed: (_, label) => changes.push(label), persist: () => persisted.push(s.calendars[0].lastSynced) });
  await ctl.add('https://example.test/one', '');
  await ctl.add('https://example.test/two', 'a');
  s = C.normalize(C.serialize(s));
  const order = s.calendarSkipped.map(e => e.feedId);
  await ctl.syncAll();
  assert.deepEqual(s.calendarSkipped.map(e => e.feedId), order);
  assert.deepEqual(changes, ['Add Calendar', 'Add Calendar']);
  assert.equal(persisted.length, 2);
}

async function testRemovedUpstream() {
  let state = C.normalize({ classes: [{ id: 'a', name: 'A' }], items: [] });
  let text = calendar(vevent('Lecture', weekly));
  const ctl = Calendar.createController({ state: () => state, snapshot: () => JSON.stringify(state), call: () => ({ text }), changed() {} });
  await ctl.add('https://example.test/reappearing', 'a');
  const feed = state.calendars[0].id;
  for (const item of state.items) item.done = true;
  text = calendar();
  await ctl.sync(feed);
  state = C.normalize(JSON.parse(JSON.stringify(C.serialize(state))));
  assert.ok(state.items.every(i => !i.calendar && i.calendarOrigin.feedId === feed));
  C.removeItems(state, i => i.calendarOrigin.occurrence === '2026-11-16');
  text = calendar(vevent('Lecture', weekly));
  await ctl.sync(feed);
  assert.equal(state.items.length, 1);
  assert.ok(state.items[0].done);
  ctl.remove(feed);
  assert.ok(!state.items[0].calendarOrigin && !state.calendarTombstones.length);
}

function testDragAndDuplicates() {
  const state = C.normalize({ classes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], items: [] });
  const feed = { id: 'f', classId: 'a' };
  const events = C.parseICS(calendar(vevent('Lecture', allDay)), true);
  Calendar.reconcile(state, feed, events);
  const item = state.items[0];
  C.moveItemToWeek(state, item.id, 'b', '2026-11-23');
  C.moveItemToWeek(state, item.id, 'a', '2026-11-16');
  assert.deepEqual(item.calendar.edited.sort(), ['classId', 'date']);
  const duplicate = JSON.parse(JSON.stringify(item));
  duplicate.id = 'duplicate';
  delete duplicate.calendar.edited;
  state.items.push(duplicate);
  Calendar.reconcile(state, { id: 'f', classId: 'b' }, events.map(e => ({ ...e, date: '2026-11-30' })));
  assert.equal(state.items.length, 1);
  assert.deepEqual([item.classId, item.date], ['a', '2026-11-16']);
}

function testDeleteOneDuplicate() {
  const state = C.normalize({ classes: [{ id: 'a', name: 'A' }], items: [],
    calendars: [{ id: 'feed', url: 'https://example.test/duplicates', classId: 'a' }] });
  const [feed] = state.calendars;
  const events = C.parseICS(calendar(vevent('Lecture', allDay)), true);
  Calendar.reconcile(state, feed, events);
  const [first] = state.items;
  const local = { ...first, id: 'other', title: 'My separate notes', done: true };
  state.items.push(local);
  C.removeItems(state, i => i.id === first.id);
  const reopened = C.normalize(JSON.parse(JSON.stringify(C.serialize(state))));
  Calendar.reconcile(reopened, reopened.calendars[0], events);
  assert.deepEqual(reopened.items.map(i => [i.id, i.title, i.done, i.calendar]), [['other', 'My separate notes', true, undefined]]);
  assert.equal(reopened.calendarTombstones.length, 1);
}

async function testSyncWhileEditing() {
  const s = C.normalize({ classes: [{ id: 'a', name: 'A' }], items: [] });
  let text = calendar(vevent('Lecture', timed));
  let endEdit, editing;
  const ctl = Calendar.createController({
    state: () => s, snapshot: () => JSON.stringify(s), call: () => ({ text }), changed() {},
    finishEditing: () => editing,
  });
  await ctl.add('https://example.test/editor', 'a');
  const feed = s.calendars[0], item = s.items[0];
  for (const removed of [false, true]) {
    editing = new Promise(resolve => { endEdit = resolve; });
    text = removed ? calendar() : calendar(vevent('Exam', ['DTSTART:20261119T180000Z']));
    const pending = ctl.sync(feed.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(item.title, removed ? 'Exam' : 'Lecture');
    assert.ok(s.items.includes(item));
    Calendar.editItem(item, { link: 'https://example.test/notes' });
    endEdit();
    await pending;
    assert.deepEqual([item.title, item.type, item.link], ['Exam', 'exam', 'https://example.test/notes']);
    assert.equal(!!item.calendar, !removed);
    assert.ok(s.items.includes(item));
  }
}

async function main() {
  await testDeletedOccurrences();
  await testDeletedClass();
  await testFileImportDeduplication();
  await testUnchangedSync();
  await testRemovedUpstream();
  await testSyncWhileEditing();
  await testIncompleteFeedKeepsItems();
  testRecurrence();
  testRevisionsAndCanonicalTitles();
  testDragAndDuplicates();
  testDeleteOneDuplicate();
  for (const [title, properties, expected, uid] of cases) {
    const events = C.parseICS(calendar(vevent(title, properties, uid)), true);
    assert.ok(events.length, title);
    for (const event of events) assert.equal(event.type, expected, title);
  }

  const events = C.parseICS(canvas, true);
  const classes = [{ id: 'b', name: 'PHY 567 — Astrophysics' }, { id: 'a', name: 'AST 441' }, { id: 'c', name: 'Writing' }];
  assert.equal(C.matchCalendarClass(events[0].title, classes), 'a');
  assert.equal(C.matchCalendarClass(events[0].title, [classes[0]]), 'b');
  assert.equal(C.matchCalendarClass(events[1].title, classes), 'b');
  assert.equal(C.matchCalendarClass('Lecture [ NRL 421 D222 / BSTA534 G777 ]', [{ id: 'long', name: 'BSTA 534' }]), 'long');
  assert.equal(C.matchCalendarClass('Quiz [ENG654 D201]', [{ id: 'section', name: 'D201' }]), null);
  assert.equal(events[0].link, 'https://canvas.example.test/courses/42/assignments/601?view=dashboard');
  assert.equal(events[0].date, '2026-11-14');
  assert.deepEqual(events.map(event => event.type), ['assignment', 'exam', 'lecture', 'lecture', 'skip', 'skip', 'assignment']);

  const moved = vevent('Lecture moved', ['RECURRENCE-ID:20261123T180000Z', 'DTSTART:20261124T180000Z']);
  const cancelled = vevent('Cancelled session', ['RECURRENCE-ID:20261116T180000Z', 'STATUS:CANCELLED']);
  const occurrences = C.parseICS(calendar(moved, vevent('Lecture', weekly), cancelled), true);
  const localDay = stamp => {
    const d = new Date(stamp);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };
  assert.deepEqual(occurrences.map(e => [e.occurrence, e.date, e.type]), [
    ['2026-11-16', localDay('2026-11-16T18:00:00Z'), 'skip'], ['2026-11-23', localDay('2026-11-24T18:00:00Z'), 'lecture'],
  ]);
  const utcOverride = vevent('Lecture moved', ['RECURRENCE-ID:20261117T070000Z', 'DTSTART:20261118T070000Z']);
  const zonedLecture = vevent('Lecture', ['DTSTART;TZID=America/Vancouver:20261116T230000', 'RRULE:FREQ=WEEKLY;COUNT=2']);
  const zonedEvents = C.parseICS(calendar(zonedLecture, utcOverride), true);
  assert.deepEqual(zonedEvents.map(e => [e.title, e.occurrence]), [
    ['Lecture moved', '2026-11-16'], ['Lecture', '2026-11-23'],
  ]);

  let state = { classes: [classes[0], classes[2]], items: [], calendars: [], calendarSkipped: [], calendarUnmatched: [] };
  const changes = [], requests = [];
  const controller = Calendar.createController({
    state: () => state,
    snapshot: () => JSON.stringify(state),
    changed: (before, label) => changes.push({ before, label }),
    call: (op, payload) => new Promise(resolve => { requests.push({ op, payload, resolve }); }),
  });
  const reply = result => requests.shift().resolve(result);
  const canvasURL = 'https://calendar.example.test/feed?private-key=synthetic';
  await assert.rejects(controller.add('http://example.test/a', ''), /HTTPS or webcal/);
  await assert.rejects(controller.add('https:///example.test', ''), /Invalid calendar URL/);
  await assert.rejects(controller.add('https://calendar.example.test/wrong path', ''), /Invalid calendar URL/);
  await assert.rejects(controller.add('https://user:pass@example.test', ''), /Remove credentials/);
  const malformed = controller.add('https://bad.example.test', '');
  reply({ text: '<html>\nBEGIN:VCALENDAR\nEND:VCALENDAR\n</html>' });
  await assert.rejects(malformed, /Invalid calendar file/);
  const broken = controller.add('https://bad.example.test', '');
  reply({ text: calendar('BEGIN:VEVENT\r\nSUMMARY:Unclosed') });
  await assert.rejects(broken, /Invalid calendar file/);
  const failed = controller.add('https://bad.example.test', '');
  reply({ error: 'Calendar not found.' });
  await assert.rejects(failed, /Calendar not found/);
  assert.equal(state.calendars.length, 0);

  const add = controller.add(' \tWeBcAl://CALENDAR.example.test:443/feed?private-key=synthetic#ignored\n', '');
  assert.equal(requests[0].payload.url, canvasURL);
  await assert.rejects(controller.add(canvasURL, ''), /already added/);
  reply({ text: canvas });
  await add;
  assert.equal(changes[0].label, 'Add Calendar');
  assert.equal(JSON.parse(changes[0].before).items.length, 0);
  assert.equal(state.items.length, 4);
  assert.equal(state.calendarSkipped.length, 2);
  assert.equal(state.calendarUnmatched.length, 1);
  assert.equal(state.items[0].classId, 'b');
  const feedId = state.calendars[0].id;
  await assert.rejects(controller.add(canvasURL, ''), /already added/);

  // An explicit type override still applies after the upstream classifier agrees once.
  const quiz = state.items.find(item => item.type === 'exam');
  const old = state.items.find(item => item.type === 'assignment');
  old.type = 'lecture';
  old.calendar.edited = ['title'];
  old.title = 'My title';
  old.done = true;
  const oldReview = state.items.find(item => item.title.includes('Review Session'));
  oldReview.type = oldReview.calendar.original.type = 'exam';
  Calendar.editItem(quiz, { ...quiz, type: 'assignment' });
  const sync = controller.sync(feedId);
  assert.equal(controller.list().feeds[0].syncing, true);
  await controller.sync(feedId);
  assert.equal(requests.length, 1);
  const addWhileSyncing = controller.add('https://another.example.test', 'c');
  assert.equal(requests.length, 2);
  requests.pop().resolve({ text: calendar(vevent('Essay [PHY 567]', allDay)) });
  await addWhileSyncing;
  assert.equal(state.items.find(item => item.title === 'Essay [PHY 567]').classId, 'c');
  reply({ text: canvas.replace('Quiz #4', 'Worksheet due') });
  await sync;
  assert.deepEqual([old.type, old.title, old.done, old.calendar.edited], ['assignment', 'My title', true, ['title']]);
  assert.equal(oldReview.type, 'lecture');
  assert.equal(state.calendars.length, 2);
  const normalized = C.normalize(C.serialize(state));
  assert.equal(normalized.calendarSkipped.length, 2);
  assert.ok(normalized.items.find(item => item.id === quiz.id).calendar.edited.includes('type'));
  state = normalized;

  for (const note of state.calendarSkipped.slice()) controller.importNotice(note.feedId, note.uid, note.occurrence);
  assert.equal(state.calendarSkipped.length, 0);
  assert.equal(state.calendarUnmatched.length, 2);
  const again = controller.sync(feedId);
  reply({ text: canvas });
  await again;
  controller.assign('c');
  assert.equal(state.calendarUnmatched.length, 0);
  const assigned = state.items.find(item => item.title.startsWith('Podcast'));
  const afterAssignment = controller.sync(feedId);
  reply({ text: canvas.replace('Podcast 3 [ENG654 D201]', 'Podcast 3 [PHY 567]') });
  await afterAssignment;
  assert.equal(state.items.find(item => item.id === quiz.id).type, 'assignment');
  assert.equal(state.items.find(item => item.id === assigned.id).classId, 'c');
  assert.equal(state.items.filter(item => item.calendar?.includeNotice).length, 2);
  assert.equal(C.normalize(C.serialize(state)).items.filter(item => item.calendar?.includeNotice).length, 2);
  assert.equal(state.calendarSkipped.length, 0);
  assert.equal(state.calendarUnmatched.length, 0);

  const oldCount = state.items.length;
  const failedSync = controller.sync(feedId);
  reply({ text: calendar('BEGIN:VEVENT', 'END:VEVENT') });
  await failedSync;
  assert.equal(state.items.length, oldCount);
  assert.equal(controller.list().feeds[0].error, 'Invalid calendar event.');
  for (const bad of [calendar('invalid line'), calendar(vevent('Class', [...timed, 'RRULE:FREQ=WEEKLY;COUNT=0'])),
    calendar(vevent('Class', [...weekly, 'EXDATE:not-a-date']))]) {
    const before = JSON.stringify(state);
    const invalid = controller.sync(feedId);
    reply({ text: bad });
    await invalid;
    assert.equal(JSON.stringify(state), before);
    assert.match(controller.list().feeds[0].error, /Invalid/);
  }
  const recovery = controller.sync(feedId);
  reply({ text: canvas });
  await recovery;
  assert.equal(controller.list().feeds[0].error, undefined);

  const stale = controller.sync(feedId);
  controller.remove(feedId);
  reply({ text: canvas });
  await stale;
  assert.equal(state.items.length, oldCount);
  assert.ok(state.items.every(item => item.calendar?.feedId !== feedId));
  assert.equal(state.calendars.length, 1);

  const invalidated = controller.sync(state.calendars[0].id);
  state = JSON.parse(JSON.stringify(state));
  reply({ text: calendar() });
  await invalidated;
  assert.equal(state.items.length, oldCount);

  const file = controller.importFile('c');
  assert.equal(requests[0].op, 'calendarImport');
  reply({ text: canvas });
  await file;
  assert.equal(state.calendarSkipped.length, 2);
  assert.equal(state.calendarSkipped[0].feedId, '');
  assert.equal(state.items.filter(item => item.classId === 'c' && !item.calendar).length >= 5, true);
  const localNote = state.calendarSkipped[0];
  controller.importNotice('', localNote.uid, localNote.occurrence);
  assert.ok(state.items.some(item => !item.calendar && item.classId === 'c' && item.title === localNote.title));
  const secondFile = controller.importFile('b');
  reply({ text: canvas.replace('Tutorials Cancelled Today', 'No class today')
    .replace('DTSTART:20261119T200000Z', 'DTSTART:20261119T210000Z') });
  const overlap = await secondFile;
  assert.deepEqual([overlap.added, overlap.alreadyPresent, overlap.skipped], [0, 6, 1]);
  const secondNote = state.calendarSkipped.find(note => note.title.startsWith('No class today'));
  controller.importNotice(secondNote);
  assert.ok(state.items.some(item => !item.calendar && item.classId === 'b' && item.title === secondNote.title));
  assert.ok(state.calendarSkipped.some(note => note.feedId === '' && note.uid === secondNote.uid));
  console.log('calendar: ' + cases.length + ' classification fixtures and reconciliation/controller checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
