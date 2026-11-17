const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../web/core.js');
const Calendar = require('../web/calendar.js');

const canvas = fs.readFileSync(path.join(__dirname, 'fixtures', 'canvas.ics'), 'utf8');
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
  ['Regional closure', [...allDay, 'CATEGORIES:Holidays'], 'skip'],
  ['Labour Day', allDay, 'skip'],
  ['Session 3', [...timed, 'STATUS:CANCELLED'], 'skip'],
  ['Block A', ['DTSTART;TZID=America/Vancouver:20261215T130000', 'DURATION:PT2H30M'], 'exam'],
  ['Block A', ['DTSTART:20261015T130000Z', 'DTEND:20261015T153000Z'], 'lecture'],
  ['Block A', ['DTSTART:20261215T130000Z', 'DTEND:20261215T153000Z', 'RRULE:FREQ=WEEKLY;COUNT=2'], 'lecture'],
  ['Module 1', [...timed, 'CATEGORIES:Assignments,Exams'], 'lecture'],
  ['Seminar: holiday customs', timed, 'lecture'],
];

async function main() {
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
  assert.deepEqual(occurrences.map(e => [e.occurrence, e.date, e.type]), [
    ['2026-11-16', '2026-11-16', 'skip'], ['2026-11-23', '2026-11-24', 'lecture'],
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
  console.log('calendar: ' + cases.length + ' classification fixtures and reconciliation/controller checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
