// Exercise the bundled UI through its normal commands, with in-memory calendar and file replies.
async function testWebRegressions() {
  const C = window.Core, app = window.App, hooks = window.CalendarUIHooks;
  const state = () => app.inspect().state;
  const $ = selector => document.querySelector(selector);
  const scroller = $('#scroller'), form = $('#item-form'), f = form.elements;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const previousBridge = window.__testBridge, realNow = C.now;
  let checks = 0;
  function check(name, passed) {
    if (!passed) throw new Error(name);
    checks++;
  }
  async function until(predicate) {
    for (let i = 0; i < 150; i++) {
      if (predicate()) return;
      await sleep(20);
    }
    throw new Error('Timed out waiting for ' + predicate);
  }
  const anchor = () => {
    const { R, weekWidth } = app.inspect().layout;
    return C.addDays(R.start, Math.round(scroller.scrollLeft / weekWidth) * 7);
  };
  const fixture = (title, date, extra = '') => 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:one\nSUMMARY:' + title +
    '\nDTSTART;VALUE=DATE:' + date + '\nEND:VEVENT\n' + extra + 'END:VCALENDAR';
  const extraEvent = (uid, date) => 'BEGIN:VEVENT\nUID:' + uid + '\nSUMMARY:Lecture\nDTSTART;VALUE=DATE:' + date + '\nEND:VEVENT\n';
  const seed = { classes: [{ id: 'course', name: 'Course', color: 0 }], items: [],
    settings: { view: 'timeline', theme: 'light' } };
  for (let i = 0; i < 52; i++) seed.items.push({ id: 'lecture-' + i, classId: 'course', type: 'lecture',
    title: '', date: i < 40 ? '2026-11-09' : '2026-11-23', done: false, link: '' });
  let accept = false, backups = 0, backupError = false, alerts = [];
  let text = fixture('Lecture', '20261116');
  const bridge = window.__testBridge = { ...previousBridge,
    import: () => ({ name: 'Test.json', text: JSON.stringify(seed) }), confirm: () => accept,
    backUpBeforeImport() { backups++; if (backupError) throw new Error('Backup unavailable'); },
    calendarFetch: () => ({ text }), open: () => false, alert: p => { alerts.push(p); },
  };
  try {
    C.now = () => new Date(2026, 10, 16, 12);
    window.dispatchEvent(new Event('focus'));
    if (!state().classes.length) {
      const input = $('#new-class-input');
      input.value = 'Before import';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
      check('Confirming an IME candidate leaves the class draft open', !state().classes.length && input.value === 'Before import');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      $('#new-class-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    app.command('view', 'compact');
    app.command('theme', 'dark');
    app.command('import');
    await sleep(20);
    check('Cancelling import keeps the previous data and backups', !backups && !state().classes.some(c => c.id === 'course'));
    accept = backupError = true;
    app.command('import');
    await until(() => alerts.length);
    check('Backup failure leaves the current data in place', !state().classes.some(c => c.id === 'course') && alerts[0].message.includes('Backup unavailable'));
    backupError = false;
    app.command('import');
    await until(() => state().classes[0].id === 'course');
    check('Import restores the saved view and theme', !!$('.tl') && state().settings.theme === 'light');
    app.command('undo');
    check('Undo import restores the previous view and theme', !!$('.cp') && state().settings.theme === 'dark');
    app.command('redo');
    check('Redo import restores the imported settings', !!$('.tl') && state().settings.theme === 'light');

    app.reveal('lecture-18');
    const rect = $('.chip[data-id="lecture-18"]').getBoundingClientRect();
    check('Reveal scrolls the requested chip into a viewport shorter than its row',
      rect.top >= $('.head').getBoundingClientRect().bottom - 1 && rect.bottom <= scroller.getBoundingClientRect().bottom + 1);
    const focused = $('.chip[data-id="lecture-18"]');
    focused.focus({ preventScroll: true });
    focused.click();
    check('Toggling with the keyboard preserves chip focus', document.activeElement.dataset.id === 'lecture-18');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    check('Delete works after a keyboard toggle', !state().items.some(i => i.id === 'lecture-18'));
    app.command('undo');
    const hold = async id => {
      const chip = $('.chip[data-id="' + id + '"]');
      const event = { bubbles: true, pointerId: 1, button: 0 };
      chip.dispatchEvent(new PointerEvent('pointerdown', event));
      await sleep(370);
      chip.dispatchEvent(new PointerEvent('pointerup', event));
      await sleep(20);
      if (!chip.classList.contains('selected')) throw new Error('Hold did not select ' + id);
    };
    await hold('lecture-18');
    const nextChip = $('.chip[data-id="lecture-19"]');
    nextChip.click();
    check('Clicking a different chip clears a stale hold selection', !$('.chip.selected'));
    app.command('undo');
    await hold('lecture-18');
    $('.chip[data-id="lecture-19"]').focus({ preventScroll: true });
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    check('Delete follows keyboard focus after a hold selection', state().items.some(i => i.id === 'lecture-18') &&
      !state().items.some(i => i.id === 'lecture-19'));
    app.command('undo');

    app.openItem(null, { date: '2019-12-30' });
    check('A partial first week opens on an enabled day', f.date.value === C.RANGE_MIN && !$('#date-days input:checked').disabled);
    $('#item-cancel').click();
    app.openItem('lecture-1');
    await sleep(40);
    f.title.value = 'Edited';
    form.requestSubmit();
    check('A queued close from the previous dialog cannot turn Edit into Add',
      state().items.length === seed.items.length && state().items.find(i => i.id === 'lecture-1').title === 'Edited');
    app.openItem(null, { date: C.RANGE_MAX });
    $('#weekdays button').click();
    check('A late repeat suggests a valid inclusive end date', f.until.value === C.RANGE_MAX && f.until.validity.valid);
    $('#item-cancel').click();
    await sleep(30);

    await hooks.add('https://calendar.example.test/web-regression', 'course');
    const feed = state().calendars[0].id;
    const item = () => state().items.find(i => i.calendar?.uid === 'one');
    await app.itemAction(item().id, 'toggle');
    app.command('undo');
    await hooks.sync(feed);
    check('An unchanged sync preserves redo', app.inspect().redo === 1);
    let reply;
    bridge.calendarFetch = () => new Promise(resolve => { reply = resolve; });
    const syncing = hooks.sync(feed);
    app.openItem(item().id);
    f.link.value = 'https://example.test/my-notes';
    text = fixture('Exam', '20261119');
    reply({ text });
    await sleep(20);
    form.requestSubmit();
    await syncing;
    check('Saving a draft during sync preserves both the user and upstream changes',
      item().title === 'Exam' && item().date === '2026-11-19' && item().type === 'exam' &&
      item().link === 'https://example.test/my-notes' && item().calendar.edited.join() === 'link');
    await app.itemAction(item().id, 'open');
    await until(() => alerts.some(a => a.message === item().link));
    check('Failed link opens show an error', alerts.some(a => a.title.includes('opened')));

    bridge.calendarFetch = () => ({ text });
    await app.classAction('course', 'rename');
    $('#rename-input').value = 'Unsubmitted name';
    $('#rename-input').setSelectionRange(2, 5);
    text = fixture('Exam updated', '20261119');
    await hooks.sync(feed);
    const draft = $('#rename-input');
    check('Sync preserves an inline draft and its caret', draft.value === 'Unsubmitted name' &&
      draft.selectionStart === 2 && draft.selectionEnd === 5 && document.activeElement === draft);
    draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
    check('IME confirmation does not submit an inline rename', $('#rename-input') === draft && state().classes[0].name === 'Course');
    draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    scroller.scrollLeft = app.inspect().layout.weekWidth * 3;
    await sleep(250);
    const monday = anchor();
    scroller.style.width = '1012px';
    text = fixture('Exam updated', '20261119', extraEvent('early', '20250505'));
    await hooks.sync(feed);
    await sleep(250);
    check('A sync extending the timeline during a resize keeps the first visible Monday', anchor() === monday);

    app.command('today');
    await sleep(800);
    C.now = () => new Date(2026, 10, 23, 12);
    window.dispatchEvent(new Event('focus'));
    const visible = Math.round((scroller.clientWidth - 232) / app.inspect().layout.weekWidth);
    check('Crossing Monday keeps Today in its landing column', anchor() === C.addDays('2026-11-23', -7 * Math.max(0, visible - 2)));
    app.command('view', 'compact');
    scroller.style.width = '760px';
    await sleep(250);
    check('Compact keeps Today anchored after a resize', Math.abs(scroller.scrollLeft -
      (app.inspect().layout.nowX - (scroller.clientWidth - 232) * 0.66)) < 2);

    app.command('view', 'timeline');
    let confirm;
    bridge.confirm = () => new Promise(resolve => { confirm = resolve; });
    const deletion = app.itemAction('lecture-39', 'delete-following');
    text = fixture('Exam updated', '20261119', extraEvent('new', '20261130'));
    await hooks.sync(feed);
    confirm(true);
    await deletion;
    check('Bulk delete keeps lectures received after confirmation opened', state().items.some(i => i.calendar?.uid === 'new'));
    const deleteClass = app.classAction('course', 'delete');
    text = fixture('Exam updated', '20261119', extraEvent('new', '20261130') + extraEvent('another', '20261207'));
    await hooks.sync(feed);
    const firstConfirm = confirm;
    confirm(true);
    await until(() => confirm !== firstConfirm);
    confirm(false);
    await deleteClass;
    check('Class deletion rechecks the affected items', state().classes.length === 1 && state().items.some(i => i.calendar?.uid === 'another'));
    bridge.confirm = () => true;
    await app.classAction('course', 'delete');
    check('An empty new-class field permits undo of the last class deletion', document.activeElement.id === 'new-class-input' &&
      app.command('undo') && state().classes[0].id === 'course');
    const deleted = item().id;
    app.openItem(deleted);
    $('#item-delete').click();
    check('The item form deletes the occurrence and saves its identity', !item() &&
      state().calendarTombstones.some(t => t.feedId === feed && t.uid === 'one' && t.occurrence === ''));
    const undoResult = app.command('undo');
    check('Undo immediately after closing the editor restores the deleted feed item', undoResult && item()?.id === deleted &&
      !state().calendarTombstones.some(t => t.uid === 'one'));
    app.command('redo');
    await hooks.sync(feed);
    check('Redo keeps the deleted occurrence gone on sync', !item());

    const edge = { id: 'edge', classId: 'course', type: 'assignment', date: '9999-12-31', title: 'Outside the timeline' };
    bridge.import = () => ({ name: 'Outlier.json', text: JSON.stringify({ ...seed, items: [edge] }) });
    app.command('import');
    await until(() => state().items.some(i => i.id === edge.id));
    $('#strip [data-id="edge"]').click();
    check('A deadline beyond the timeline can be opened from its strip card', $('#item-dlg').open);
    const dateState = [f.date.value, $('#date-days input:checked')?.value, $('#week-next').disabled,
      document.querySelectorAll('#date-days input').length];
    check('The final supported week has a valid selection and no next week (' + dateState.join(', ') + ')',
      JSON.stringify(dateState) === JSON.stringify([edge.date, edge.date, true, 5]));
    $('#week-prev').click();
    $('#week-next').click();
    check('The week stepper can return to the final valid Friday', f.date.value === edge.date);
    $('#item-cancel').click();

    bridge.calendarImport = () => ({ text: 'BEGIN:VCALENDAR\n' +
      extraEvent('supported', '20261130').replace('SUMMARY:Lecture', 'SUMMARY:Imported lecture') +
      extraEvent('unsupported', '20261130').replace('END:VEVENT', 'RRULE:FREQ=MONTHLY;COUNT=2\nEND:VEVENT') +
      'END:VCALENDAR' });
    app.command('calendars');
    $('#calendar-form').elements.classId.value = 'course';
    $('#calendar-import').click();
    await until(() => !$('#calendar-import').disabled);
    check('One-off import adds supported entries and reports unsupported recurrence',
      state().items.some(i => i.title === 'Imported lecture' && !i.calendar) &&
      state().items.length === 2 && $('#calendar-error').textContent.includes('unsupported recurrence'));
    $('#calendar-close').click();
    return checks;
  } finally {
    scroller.style.width = '';
    window.__testBridge = previousBridge;
    C.now = realNow;
    window.dispatchEvent(new Event('focus'));
  }
}

function testLoadFailure(scenario, writes, copies, warnings) {
  window.App.command('theme', 'dark');
  if (scenario === 'partial') {
    if (copies.length !== 1 || writes.length !== 1 || writes[0].classes[0].id !== 'c' ||
        !warnings.some(message => message.includes('invalid entry'))) throw new Error('Partial data was not backed up and reported');
  } else if (writes.length || !warnings.some(message => message.includes('Saving is disabled'))) {
    throw new Error('Failed load left saving enabled or was silent');
  }
  return 1;
}

async function testBrowserFallback() {
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  const previous = window.__testBridge, create = document.createElement;
  const warnings = [], revoked = [], downloads = [];
  const bridge = window.__testBridge = { ...previous, alert: p => warnings.push(p) };
  delete bridge.save;
  let full = true, cancel = true, saves = 0, checks = 0;
  const check = (name, ok) => { if (!ok) throw new Error(name); checks++; };
  const storage = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    setItem() { if (full) throw new Error('Storage full'); saves++; },
  } });
  const makeURL = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:https://example.test/export';
  URL.revokeObjectURL = url => revoked.push(url);
  document.createElement = function (tag, ...options) {
    const element = create.call(this, tag, ...options);
    if (tag === 'a') element.click = () => downloads.push(element.href);
    if (tag === 'input') element.click = () => {
      if (cancel) element.oncancel();
      else {
        Object.defineProperty(element, 'files', { value: [{ name: 'file.ics', text: async () => { throw new Error('File read failed'); } }] });
        element.onchange();
      }
    };
    return element;
  };
  try {
    window.App.command('theme', 'dark');
    window.App.command('theme', 'light');
    await tick();
    check('A storage error is visible and does not interrupt edits', warnings.length === 1 && warnings[0].message === 'Storage full');
    full = false;
    window.App.command('theme', 'system');
    await tick();
    full = true;
    window.App.command('theme', 'dark');
    await tick();
    check('A successful save resets the error notification', saves === 1 && warnings.length === 2);
    window.App.command('export');
    await tick();
    check('Browser export releases its download URL', downloads.length === 1 && revoked[0] === downloads[0]);
    window.App.command('calendars');
    document.querySelector('#calendar-import').click();
    await tick();
    check('Cancelling the browser file picker unlocks the form', !document.querySelector('#calendar-import').disabled);
    cancel = false;
    document.querySelector('#calendar-import').click();
    await tick();
    check('File read errors unlock the form and explain the failure',
      !document.querySelector('#calendar-import').disabled && document.querySelector('#calendar-error').textContent === 'File read failed');
    const current = window.App.inspect().state.settings.view;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: current === 'timeline' ? '2' : '1', metaKey: true, bubbles: true }));
    check('Browser view shortcuts respect an open dialog', window.App.inspect().state.settings.view === current);
    document.querySelector('#calendar-close').click();
    return checks;
  } finally {
    window.__testBridge = previous;
    document.createElement = create;
    URL.createObjectURL = makeURL;
    URL.revokeObjectURL = revoke;
    if (storage) Object.defineProperty(window, 'localStorage', storage);
    else delete window.localStorage;
  }
}
