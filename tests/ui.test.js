// Runs inside the real app (see run.sh): drives the page the way a person would and checks
// the result, the saved file and the native menus. Starts from an empty temporary data folder.
(async () => {
  const C = window.Core;
  const bridge = msg => window.webkit.messageHandlers.app.postMessage(msg);
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const state = () => window.App.inspect().state;
  const today = C.todayISO();
  const failures = [];
  let count = 0;

  function check(name, ok, detail) {
    count++;
    if (!ok) failures.push(name + (detail !== undefined ? ' (got ' + JSON.stringify(detail) + ')' : ''));
  }
  const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), got);

  const click = (el, detail, extra) => el.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, cancelable: true, detail: detail === undefined ? 1 : detail }, extra)));
  const type = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (el, k, extra) => el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
  const chip = id => $('.chip[data-id="' + id + '"]');
  const row = classId => $('.row[data-class="' + classId + '"]');
  const snap = name => bridge({ op: 'test.snapshot', name });
  const menu = (path, perform) => bridge({ op: 'test.menu', path, perform: perform !== false });
  const saved = async () => JSON.parse(await bridge({ op: 'test.file' }));
  const f = $('#item-form').elements;
  const dlg = $('#item-dlg');
  const inside = (inner, outer) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
  function selectDate(date) {
    let weeks = C.diffDays(C.mondayOf(date), C.mondayOf(f.date.value)) / 7;
    while (weeks !== 0) {
      click($(weeks > 0 ? '#week-next' : '#week-prev'));
      weeks += weeks > 0 ? -1 : 1;
    }
    click($('#date-days input[value="' + date + '"]'));
  }


  function checkTimelineLayout(label) {
    const stress = row('class0'), track = $('.track', stress), trackRect = track.getBoundingClientRect();
    const pills = $$('.week-chip', stress);
    const crowded = pills.filter(p => parseFloat(p.style.left) === parseFloat(chip('item-0-0').style.left));
    check(label + ': crowded week has at least eight items', crowded.length >= 8, crowded.length);
    check(label + ': crowded pills fit the row and do not overlap', crowded.every((p, i) => inside(p.getBoundingClientRect(), trackRect) && (!i || crowded[i - 1].getBoundingClientRect().bottom <= p.getBoundingClientRect().top)));
    const weekLeft = parseFloat(crowded[0].style.left) - 7;
    track.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: trackRect.left + weekLeft + 20, clientY: trackRect.top + 20 }));
    check(label + ': hover add clears a crowded stack', $('.ghost', track).getBoundingClientRect().top >= crowded[crowded.length - 1].getBoundingClientRect().bottom);
    check(label + ': pills have accessible full titles without native tooltips', !chip('item-0-0').hasAttribute('title') && chip('item-0-0').getAttribute('aria-label').includes('Molecular mechanisms of gene expression'));
    const longLecture = $('.n', chip('item-0-0'));
    check(label + ': lecture title is shown and ellipsized', longLecture.textContent.startsWith('Molecular mechanisms') && longLecture.scrollWidth > longLecture.clientWidth && getComputedStyle(longLecture).textOverflow === 'ellipsis');
    const longTitle = $('.t', chip('item-0-1'));
    check(label + ': long visible item title is ellipsized', longTitle.scrollWidth > longTitle.clientWidth && getComputedStyle(longTitle).textOverflow === 'ellipsis');
    check(label + ': weekday and check stay inside their pills', pills.every(p => {
      const box = p.getBoundingClientRect(), suffix = $('.weekday', p), icon = $('svg', p);
      return inside(suffix.getBoundingClientRect(), box) && (!icon || inside(icon.getBoundingClientRect(), box));
    }));
    const name = $('.name', stress), side = $('.side', stress);
    check(label + ': long class name stays in the sidebar and has a tooltip', inside(name.getBoundingClientRect(), side.getBoundingClientRect()) && name.title === state().classes[0].name);
    check(label + ': subline stays in the sidebar', inside($('.next', stress).getBoundingClientRect(), side.getBoundingClientRect()));
    check(label + ': week labels fit their columns', $$('.week-label').every(el => el.scrollWidth <= el.clientWidth + 1));
    check(label + ': month labels stay in their segments', $$('.month').every(el => inside($('span', el).getBoundingClientRect(), el.getBoundingClientRect())));
  }

  // Double-click anywhere in the week containing date.
  function doubleClickWeek(classId, date) {
    const track = $('.track', row(classId));
    const r = track.getBoundingClientRect();
    const R = window.App.inspect().layout.R;
    const x = r.left + (C.weekIndex(date, R.start) + 0.5) * window.App.inspect().layout.weekWidth;
    const y = r.top + 20;
    click(track, 2, { clientX: x, clientY: y });
  }

  try {
    // ------------------------------------------------------------ first launch
    eq('starts with no classes', state().classes.length, 0);
    check('class name field is ready to type in', document.activeElement && document.activeElement.id === 'new-class-input');
    check('no upcoming strip when there is nothing upcoming', $('#strip').hidden);
    check('timeline is the first view', !!$('.tl'));
    eq('current week is marked in the ruler', $$('.week-label').indexOf($('.week-label.now')), C.weekIndex(today, window.App.inspect().layout.R.start));
    const lay = window.App.inspect().layout;
    const nowOnScreen = lay.nowX - $('#scroller').scrollLeft;
    check('opens with today in view', nowOnScreen > 0 && nowOnScreen < $('#scroller').clientWidth - 232, nowOnScreen);
    const scroller = $('#scroller');
    const isAligned = () => Math.abs(scroller.scrollLeft / window.App.inspect().layout.weekWidth - Math.round(scroller.scrollLeft / window.App.inspect().layout.weekWidth)) < 0.01;
    const wholeWeeks = () => {
      const n = (scroller.clientWidth - 232) / window.App.inspect().layout.weekWidth;
      return Math.abs(n - Math.round(n)) < 0.01;
    };
    const visibleWeeks = () => Math.round((scroller.clientWidth - 232) / window.App.inspect().layout.weekWidth);
    const expectedFirstWeek = date => Math.max(0, C.weekIndex(date, window.App.inspect().layout.R.start) - visibleWeeks() + 2);
    check('whole weeks fit the timeline viewport', wholeWeeks());
    check('initial position is aligned to a week', isAligned(), scroller.scrollLeft);
    eq('launch places the current week second from the right', Math.round(scroller.scrollLeft / lay.weekWidth), expectedFirstWeek(today));
    const currentWeekPosition = () => {
      const firstVisibleLeft = $('.head .side').getBoundingClientRect().right;
      return ($('.week-label.now').getBoundingClientRect().left - firstVisibleLeft) / window.App.inspect().layout.weekWidth;
    };
    const checkCurrentWeekPosition = label => {
      const currentIndex = C.weekIndex(C.todayISO(), window.App.inspect().layout.R.start);
      const weekRect = $('.week-label.now').getBoundingClientRect();
      const viewportRect = scroller.getBoundingClientRect();
      check(label + ': current week is in the expected column', Math.abs(currentWeekPosition() - Math.min(currentIndex, visibleWeeks() - 2)) < 0.01, currentWeekPosition());
      check(label + ': current week is fully visible', weekRect.right <= viewportRect.right + 0.5 && weekRect.left >= $('.head .side').getBoundingClientRect().right - 0.5, [weekRect.left, weekRect.right, viewportRect.right]);
    };
    checkCurrentWeekPosition('launch');
    await bridge({ op: 'test.resize', width: 1700, height: 760 });
    await sleep(300);
    check('resize while anchored fits whole weeks', wholeWeeks());
    check('resize while anchored stays snapped', isAligned(), scroller.scrollLeft);
    checkCurrentWeekPosition('anchored resize');
    await bridge({ op: 'test.resize', width: 1280, height: 760 });
    await sleep(300);
    checkCurrentWeekPosition('anchored resize back');
    scroller.scrollLeft = lay.weekWidth * 3.4;
    await sleep(500);
    check('scrolling settles on a week boundary', isAligned(), scroller.scrollLeft);
    const scrolledWeek = Math.round(scroller.scrollLeft / window.App.inspect().layout.weekWidth);
    await bridge({ op: 'test.resize', width: 820, height: 520 });
    await sleep(300);
    check('resize after scrolling stays snapped', isAligned(), scroller.scrollLeft);
    eq('resize after scrolling preserves the first visible week', Math.round(scroller.scrollLeft / window.App.inspect().layout.weekWidth), scrolledWeek);
    window.App.command('today');
    await sleep(900);
    check('Today aligns to a week boundary', isAligned(), scroller.scrollLeft);
    checkCurrentWeekPosition('Today');
    await bridge({ op: 'test.resize', width: 1280, height: 760 });
    await sleep(300);
    checkCurrentWeekPosition('resize after Today');
    const initialNow = C.now;
    C.now = () => new Date(2026, 8, 2, 12);
    window.dispatchEvent(new Event('focus'));
    window.App.command('today');
    await sleep(900);
    eq('Today at the start of the range does not add empty space', scroller.scrollLeft, 0);
    checkCurrentWeekPosition('early September');
    C.now = initialNow;
    window.dispatchEvent(new Event('focus'));
    window.App.command('today');
    await sleep(900);
    eq('timeline starts the week of 1 Sep 2026', lay.R.start, '2026-08-31');
    eq('nothing is written before the first change', await bridge({ op: 'test.file' }), null);
    await snap('01-first-launch');

    // ------------------------------------------------------------ classes
    for (const name of ['BIOL 200', 'CPSC 110', 'MATH 200']) {
      const input = $('#new-class-input');
      type(input, name);
      key(input, 'Enter');
    }
    eq('three classes added from the inline field', state().classes.map(c => c.name), ['BIOL 200', 'CPSC 110', 'MATH 200']);
    check('field stays open for the next class', document.activeElement && document.activeElement.id === 'new-class-input');
    key($('#new-class-input'), 'Escape');
    await sleep(30);
    check('escape puts the field away', !$('#new-class-input') && !!$('.new-class'));
    check('first empty class explains how to add', $$('.hint').length === 1);
    const [bio, cs, math] = state().classes.map(c => c.id);
    const hint = $('.hint', row(bio)), hintTrack = $('.track', row(bio));
    const hintRect = hint.getBoundingClientRect(), hintTrackRect = hintTrack.getBoundingClientRect();
    const hintWeek = C.weekIndex(today, window.App.inspect().layout.R.start), hintWidth = window.App.inspect().layout.weekWidth;
    check('empty hint stays within one week', hintRect.left >= hintTrackRect.left + hintWeek * hintWidth && hintRect.right <= hintTrackRect.left + (hintWeek + 1) * hintWidth);
    hintTrack.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: hintTrackRect.left + (hintWeek + .5) * hintWidth, clientY: hintTrackRect.top + 20 }));
    check('hover add does not cover the hint', $('.ghost', hintTrack).getBoundingClientRect().top >= hintRect.bottom);
    eq('classes are saved to the data file', (await saved()).classes.length, 3);
    doubleClickWeek(bio, C.mondayOf(today));
    eq('current week defaults to today', [f.classId.value, f.date.value], [bio, today]);
    click($('#item-cancel'));
    await sleep(30);
    const track = $('.track', row(cs));
    const trackRect = track.getBoundingClientRect();
    const futureWeek = C.addDays(C.mondayOf(today), 14);
    const weekX = trackRect.left + (C.weekIndex(futureWeek, window.App.inspect().layout.R.start) + 0.5) * window.App.inspect().layout.weekWidth;
    track.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: weekX, clientY: trackRect.top + 20 }));
    check('hover exposes the add button', !!$('.ghost', track));
    click($('.ghost', track));
    eq('hover add opens that class and week', [dlg.open, f.classId.value, f.date.value], [true, cs, futureWeek]);
    click($('#item-cancel'));
    await sleep(30);

    // ------------------------------------------------------------ double-click a slot, bulk add
    const start = '2026-09-09';
    doubleClickWeek(bio, start);
    check('double-click opens the form', dlg.open);
    eq('form defaults to the week Monday', [f.classId.value, f.date.value, f.type.value], [bio, C.mondayOf(start), 'lecture']);
    selectDate(start);
    eq('weekday selection sets the date', f.date.value, start);
    eq('week label displays the selected week', $('#week-label').textContent, 'Sep 7–13');
    click($('#week-next'));
    eq('week stepper preserves the selected weekday', f.date.value, '2026-09-16');
    selectDate('2026-09-30');
    eq('week label spans months', $('#week-label').textContent, 'Sep 28–Oct 4');
    click($('#week-next'));
    eq('week stepper crosses month boundaries', f.date.value, '2026-10-07');
    selectDate(start);
    eq('single add by default', $('#item-save').textContent, 'Add');
    for (const wd of [0, 2, 4]) click($('#weekdays [data-wd="' + wd + '"]'));
    eq('an end date is suggested', f.until.value, C.addDays(start, 90));
    type(f.until, '2026-12-04');
    const mwf = C.recurrence(start, '2026-12-04', [0, 2, 4]);
    eq('button shows how many will be added', $('#item-save').textContent, 'Add ' + mwf.length);
    check('lecture repeats can have a title', !f.title.disabled);
    await snap('02-bulk-add-form');
    $('#item-form').requestSubmit();
    await sleep(30);
    check('form closes after adding', !dlg.open);
    eq('one lecture per Mon/Wed/Fri', state().items.filter(i => i.classId === bio).map(i => i.date), mwf);
    eq('toast reports the count', $('#toast-text').textContent, 'Added ' + mwf.length + ' lectures');
    const past = mwf.filter(d => d < today).length;
    eq('every past lecture counts as behind', $('.behind-badge', row(bio)).textContent, past + ' behind');
    eq('chips are numbered in date order', $$('.chip.lec .n', row(bio)).map(c => c.textContent), mwf.map((_, i) => 'L' + (i + 1)));
    eq('pills show their weekdays', $$('.chip.lec .weekday', row(bio)).map(c => c.textContent), mwf.map(d => '· ' + C.WEEKDAYS[C.weekday(d)]));
    const firstWeeks = $$('.chip.lec', row(bio)).slice(0, 3);
    check('same-week pills stack within one column', firstWeeks[0].style.left === firstWeeks[1].style.left && firstWeeks[1].style.left !== firstWeeks[2].style.left && parseFloat(firstWeeks[0].style.top) < parseFloat(firstWeeks[1].style.top));
    eq('past ones are solid, later ones dashed', [$$('.chip.s-behind', row(bio)).length, $$('.chip.s-future, .chip.s-today', row(bio)).length], [past, mwf.length - past]);
    eq('file has the lectures', (await saved()).items.length, mwf.length);

    // ------------------------------------------------------------ undo / redo from the menu bar
    await sleep(120);
    let m = await menu(['Edit', 'Undo']);
    eq('Edit > Undo names the change', [m.enabled, m.title], [true, 'Undo Add']);
    await sleep(150);
    eq('undo removes the series', state().items.length, 0);
    m = await menu(['Edit', 'Redo']);
    await sleep(150);
    eq('redo brings it back', state().items.length, mwf.length);

    // repeat does not double up
    doubleClickWeek(bio, start);
    selectDate(start);
    for (const wd of [0, 2, 4]) click($('#weekdays [data-wd="' + wd + '"]'));
    type(f.until, '2026-12-04');
    eq('adding the same series again adds nothing', [$('#item-save').textContent, $('#item-save').disabled], ['Add 0', true]);
    click($('#item-cancel'));
    await sleep(30);

    // ------------------------------------------------------------ mark done
    const lectures = () => C.classLectures(state(), bio);
    const first = lectures()[0].id;
    click(chip(first));
    eq('one click marks a lecture done', [find(first).done, chip(first).classList.contains('s-done')], [true, true]);
    check('done pill exposes its check and pressed state', chip(first).getAttribute('aria-pressed') === 'true' && !!$('svg', chip(first)));
    eq('behind count drops', $('.behind-badge', row(bio)).textContent, (past - 1) + ' behind');
    eq('done state is saved', (await saved()).items.find(i => i.id === first).done, true);
    click(chip(first));
    eq('clicking again clears it', find(first).done, false);

    // Mark Done Through Here (context menu action)
    const tenth = lectures()[9].id;
    await window.App.itemAction(tenth, 'through');
    eq('mark done through here', lectures().filter(i => i.done).length, 10);
    eq('behind count after catching up', $('.behind-badge', row(bio)).textContent, (past - 10) + ' behind');
    eq('corner shows the total', $('.head .total').textContent, (past - 10) + ' behind');

    // ------------------------------------------------------------ double-click a chip to edit
    const target = lectures()[10].id;
    await window.App.itemAction(target, 'toggle');
    window.App.command('undo'); // leave a redo available before opening the editor
    const depth = window.App.inspect().undo;
    click(chip(target), 1);
    click(chip(target), 2);
    check('double-click opens the editor', dlg.open);
    eq('and leaves done untouched', [find(target).done, window.App.inspect().undo], [false, depth]);
    eq('double-click preserves redo history', window.App.inspect().redo, 1);
    eq('editor shows the lecture', [f.type.value, f.date.value, f.title.placeholder, $('#item-save').textContent], ['lecture', find(target).date, 'Lecture 11', 'Save']);
    check('no repeat options when editing', $('#repeat').hidden && !$('#item-delete').hidden);
    eq('editing preselects its weekday', $('#date-days input:checked').value, find(target).date);
    type(f.title, 'Membranes');
    type(f.link, 'canvas.ubc.ca/courses/1/l11');
    await snap('03-edit-form');
    $('#item-form').requestSubmit();
    await sleep(30);
    eq('edit is applied', [find(target).title, find(target).link], ['Membranes', 'https://canvas.ubc.ca/courses/1/l11']);
    eq('timeline pill shows the lecture title', $('.n', chip(target)).textContent, 'Membranes');
    check('linked lectures are underlined', chip(target).classList.contains('has-link'));

    // ------------------------------------------------------------ hover card and opening the link
    chip(target).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(450);
    check('hover card appears without a native pill tooltip', !$('#card').hidden && !chip(target).hasAttribute('title') && !!chip(target).getAttribute('aria-label'));
    eq('card names the lecture', $('#card .c1').textContent, 'Membranes');
    eq('card offers the link', $('#card .open span').textContent, 'canvas.ubc.ca');
    await snap('04-hover-card');
    click($('#card .open'));
    check('card closes after opening', $('#card').hidden);
    click(chip(target), 1, { metaKey: true });
    eq('command-click opens without toggling', find(target).done, false);

    // ------------------------------------------------------------ assignments and exams
    const soon = C.addDays(today, 3);
    doubleClickWeek(bio, soon);
    selectDate(soon);
    $('input[name="type"][value="assignment"]').checked = true;
    $('#item-form').dispatchEvent(new Event('change', { bubbles: true }));
    eq('date and type remain editable', [f.type.value, f.date.value], ['assignment', soon]);
    type(f.title, 'Problem Set 5');
    $('#item-form').requestSubmit();
    await sleep(30);
    doubleClickWeek(math, C.addDays(today, 5));
    selectDate(C.addDays(today, 5));
    $('input[name="type"][value="exam"]').checked = true;
    $('#item-form').dispatchEvent(new Event('change', { bubbles: true }));
    check('exams can repeat', !$('#repeat').hidden);
    type(f.title, 'Midterm 2');
    $('#item-form').requestSubmit();
    await sleep(30);
    doubleClickWeek(cs, C.addDays(today, -2));
    selectDate(C.addDays(today, -2));
    $('input[name="type"][value="assignment"]').checked = true;
    $('#item-form').dispatchEvent(new Event('change', { bubbles: true }));
    type(f.title, 'Lab 4');
    $('#item-form').requestSubmit();
    await sleep(30);
    const cards = $$('#strip .up');
    eq('strip lists what is due, overdue first', cards.map(c => $('.ut', c).textContent + ' | ' + $('.uw', c).textContent),
      ['Lab 4 | 2 days late', 'Problem Set 5 | in 3 days', 'Midterm 2 | in 5 days']);
    check('overdue is flagged', cards[0].classList.contains('late') && cards[1].classList.contains('soon'));
    eq('row shows the next deadline', $('.l2 .next', row(bio)).textContent, 'Problem Set 5 due in 3 days · ' + C.fmtMedium(soon));
    eq('exam row', $('.l2 .next', row(math)).textContent, 'Midterm 2 in 5 days · ' + C.fmtMedium(C.addDays(today, 5)));
    const lab = state().items.find(i => i.title === 'Lab 4').id;
    check('late assignment chip is flagged', chip(lab).classList.contains('s-late'));
    click(chip(lab));
    eq('finishing it clears it from the strip', $$('#strip .up').length, 2);
    await snap('05-timeline');

    // strip card jumps to the item
    $('#scroller').scrollLeft = 0;
    click($$('#strip .up')[1]);
    await sleep(700);
    const exam = state().items.find(i => i.title === 'Midterm 2').id;
    const er = chip(exam).getBoundingClientRect();
    check('clicking an upcoming card scrolls to it', er.left > 232 && er.right < window.innerWidth, [er.left, $('#scroller').scrollLeft]);

    // ------------------------------------------------------------ delete, undo
    const before = state().items.length;
    await window.App.itemAction(exam, 'delete');
    eq('delete removes the item', [state().items.length, $('#toast-text').textContent], [before - 1, 'Deleted Midterm 2']);
    click($('#toast-undo'));
    eq('toast undo restores it', state().items.length, before);
    const last5 = lectures().slice(-5)[0].id;
    await window.App.itemAction(last5, 'delete-following');
    eq('delete this and following', lectures().length, mwf.length - 5);
    window.App.command('undo');
    eq('undo after bulk delete', lectures().length, mwf.length);

    // ------------------------------------------------------------ class changes
    await window.App.classAction(cs, 'rename');
    const rename = $('#rename-input');
    check('rename field opens with the name selected', rename && document.activeElement === rename && rename.value === 'CPSC 110');
    type(rename, 'CPSC 121');
    key(rename, 'Enter');
    eq('rename applies', state().classes.find(c => c.id === cs).name, 'CPSC 121');
    await window.App.classAction(math, 'up');
    eq('move up', state().classes.map(c => c.name), ['BIOL 200', 'MATH 200', 'CPSC 121']);
    click($('.dot', row(bio)));
    eq('clicking the dot changes the colour', state().classes[0].color, 1);
    await window.App.classAction(bio, 'catch-up');
    check('catch up clears the badge', !$('.behind-badge', row(bio)) && !!$('.caught', row(bio)));
    window.App.command('undo');
    await window.App.classAction(bio, 'delete');
    eq('deleting a class takes its items', [state().classes.length, state().items.filter(i => i.classId === bio).length], [2, 0]);
    window.App.command('undo');
    eq('and undo returns everything', [state().classes.length, lectures().length], [3, mwf.length]);

    // ------------------------------------------------------------ compact view through the toolbar
    await bridge({ op: 'test.toolbar', id: 'viewMode', segment: 1 });
    await sleep(200);
    check('toolbar switch shows the compact view', !!$('.cp') && state().settings.view === 'compact');
    eq('compact has lectures only', [$$('.cp .chip.lec').length, $$('.cp .chip.dl').length], [mwf.length, 0]);
    eq('compact pills show titles or lecture numbers', $$('.chip.lec .n', row(bio)).map(c => c.textContent), lectures().map((it, i) => it.title || 'L' + (i + 1)));
    eq('compact pills show their weekdays', $$('.chip.lec .weekday', row(bio)).map(c => c.textContent), lectures().map(it => '· ' + C.WEEKDAYS[C.weekday(it.date)]));
    check('compact done pill exposes its check and pressed state', chip(first).getAttribute('aria-pressed') === 'true' && !!$('svg', chip(first)));
    eq('row shows progress', $('.l2 .next', row(bio)).textContent, '10 of ' + mwf.length + ' done');
    const lineX = parseFloat($('.cp .now-line').style.left);
    const lastPast = $$('.chip.lec', row(bio))[past - 1].getBoundingClientRect();
    const firstNext = $$('.chip.lec', row(bio))[past].getBoundingClientRect();
    const lineOnScreen = $('.cp .now-line').getBoundingClientRect().left;
    check('today line sits between past and upcoming lectures', lastPast.right < lineOnScreen && lineOnScreen < firstNext.left, [lastPast.right, lineOnScreen, firstNext.left, lineX]);
    eq('view choice is saved', (await saved()).settings.view, 'compact');
    eq('toolbar and menu agree', [(await bridge({ op: 'test.chrome' })).selectedView, (await menu(['View', 'Compact'], false)).checked], [1, true]);
    click($('.cp-track', row(cs)), 2, { clientX: 600, clientY: 200 });
    eq('double-click in compact adds a lecture for that class', [dlg.open, f.classId.value, f.type.value, f.date.value], [true, cs, 'lecture', today]);
    click($('#item-cancel'));
    await sleep(30);
    await snap('06-compact');

    await menu(['View', 'Timeline']);
    await sleep(200);
    check('View > Timeline switches back', !!$('.tl') && state().settings.view === 'timeline');
    $('#scroller').scrollLeft = 0;
    await bridge({ op: 'test.toolbar', id: 'today' });
    await sleep(900);
    const back = window.App.inspect().layout.nowX - $('#scroller').scrollLeft;
    check('Today button returns to today', back > 0 && back < $('#scroller').clientWidth - 232, back);

    // ------------------------------------------------------------ drag a timeline pill
    scroller.scrollTop = 0;
    const dragItem = lectures().find(it => C.mondayOf(it.date) === C.mondayOf(today));
    const dragId = dragItem.id, originalDate = dragItem.date, originalDone = dragItem.done;
    const point = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const pointer = (el, kind, p) => el.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: kind === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
    const selection = () => $$('#grid .chip.selected').map(el => el.dataset.id);
    const startPress = id => {
      const p = point(chip(id));
      pointer(chip(id), 'pointerdown', p);
      return p;
    };
    const releasePress = (id, p, detail) => {
      pointer(chip(id), 'pointerup', p);
      click(chip(id), detail);
    };
    const destPoint = (classId, offset) => {
      const r = $('.track', row(classId)).getBoundingClientRect();
      const i = C.weekIndex(originalDate, window.App.inspect().layout.R.start) + offset;
      return { x: r.left + (i + .5) * window.App.inspect().layout.weekWidth, y: r.top + 20 };
    };
    let from = point(chip(dragId)), to = destPoint(cs, 1), beforeDrag = JSON.stringify(find(dragId));
    pointer(chip(dragId), 'pointerdown', from);
    pointer(document, 'pointermove', { x: from.x + 3, y: from.y });
    check('movement under the drag threshold does not start a drag', !$('.drag-preview') && !$('.drop-target'));
    pointer(document, 'pointerup', from);
    click(chip(dragId));
    eq('a quick click toggles after small movement without selecting', [find(dragId).done, selection()], [!originalDone, []]);
    window.App.command('undo');

    from = point(chip(dragId));
    pointer(chip(dragId), 'pointerdown', from);
    pointer(document, 'pointermove', to);
    const dropTarget = $('.drop-target', row(cs));
    check('drag shows a preview and targets the expected week', !!$('.drag-preview') && dropTarget && parseFloat(dropTarget.style.left) === (C.weekIndex(originalDate, window.App.inspect().layout.R.start) + 1) * window.App.inspect().layout.weekWidth);
    const dropStyle = getComputedStyle(dropTarget);
    check('drag target has no fill or outline', dropStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && dropStyle.backgroundImage === 'none' && dropStyle.boxShadow === 'none' && dropStyle.outlineStyle === 'none' && dropStyle.borderStyle === 'none');
    check('current week band remains visible during drag', getComputedStyle($('.today-week', row(cs))).backgroundColor !== 'rgba(0, 0, 0, 0)');
    await sleep(400);
    eq('keeping a drag pressed past the hold time does not select', selection(), []);
    pointer(document, 'pointerup', to);
    click(document.elementFromPoint(to.x, to.y));
    eq('drop moves to the same weekday and target class without toggling or editing', [find(dragId).date, find(dragId).classId, find(dragId).done, dlg.open], [C.addDays(originalDate, 7), cs, originalDone, false]);
    eq('drag creates one named undo step', (await menu(['Edit', 'Undo'], false)).title, 'Undo Move Lecture');
    window.App.command('undo');
    eq('one undo restores the move', JSON.stringify(find(dragId)), beforeDrag);
    await sleep(10);

    from = point(chip(dragId));
    pointer(chip(dragId), 'pointerdown', from);
    pointer(document, 'pointermove', destPoint(cs, 0));
    pointer(document, 'pointerup', destPoint(cs, 0));
    eq('dropping in the same week changes only the class', [find(dragId).date, find(dragId).classId], [originalDate, cs]);
    window.App.command('undo');
    await sleep(10);

    from = point(chip(dragId));
    pointer(chip(dragId), 'pointerdown', from);
    pointer(document, 'pointermove', to);
    key(document, 'Escape');
    pointer(document, 'pointerup', to);
    eq('Escape cancels a drag', JSON.stringify(find(dragId)), beforeDrag);
    check('Escape clears drag visuals', !$('.drag-preview') && !$('.drop-target'));
    await sleep(10);
    from = point(chip(dragId));
    pointer(chip(dragId), 'pointerdown', from);
    pointer(document, 'pointermove', { x: 1, y: 1 });
    check('outside the timeline has no drop highlight', !$('.drop-target'));
    pointer(document, 'pointerup', { x: 1, y: 1 });
    eq('dropping outside cancels a drag', JSON.stringify(find(dragId)), beforeDrag);
    await sleep(10);
    from = point(chip(dragId));
    const sidebarPoint = point($('.side', row(cs)));
    pointer(chip(dragId), 'pointerdown', from);
    pointer(document, 'pointermove', sidebarPoint);
    check('the sticky sidebar is not a drop target', !$('.drop-target'));
    pointer(document, 'pointerup', sidebarPoint);
    eq('dropping on the sidebar cancels a drag', JSON.stringify(find(dragId)), beforeDrag);
    await sleep(10);

    // ------------------------------------------------------------ hold to select and delete
    const otherId = lectures().find(it => it.id !== dragId && C.mondayOf(it.date) === C.mondayOf(today))?.id ?? lectures()[0].id;
    for (const mode of ['timeline', 'compact']) {
      window.App.command('view', mode);
      const depth = window.App.inspect().undo;
      let p = startPress(dragId);
      pointer(document, 'pointermove', { x: p.x + 3, y: p.y });
      await sleep(400);
      eq(mode + ': holding under the drag threshold selects while pressed', selection(), [dragId]);
      eq(mode + ': the selected pill has an outline', getComputedStyle(chip(dragId)).outlineStyle, 'solid');
      releasePress(dragId, p);
      eq(mode + ': releasing a hold leaves done and undo unchanged', [find(dragId).done, window.App.inspect().undo], [originalDone, depth]);

      p = startPress(dragId);
      releasePress(dragId, p, 2);
      eq(mode + ': a quick press after a hold toggles instead of editing', [find(dragId).done, dlg.open], [!originalDone, false]);
      p = startPress(dragId);
      releasePress(dragId, p, 3);
      eq(mode + ': two quick presses open the editor and leave done unchanged', [dlg.open, find(dragId).done, window.App.inspect().undo, selection()], [true, originalDone, depth, [dragId]]);
      click($('#item-cancel'));
      await sleep(30);

      p = startPress(otherId);
      await sleep(400);
      eq(mode + ': selecting another pill replaces the selection', selection(), [otherId]);
      const moved = { x: p.x + 4, y: p.y };
      pointer(document, 'pointermove', moved);
      releasePress(otherId, moved);
      eq(mode + ': crossing the drag threshold restores the prior selection', [selection(), window.App.inspect().undo], [[dragId], depth]);
      await sleep(10);

      if (mode === 'timeline') key(document, 'Escape');
      else click($('.cp-track', row(math)));
      eq(mode + ': ' + (mode === 'timeline' ? 'Escape' : 'clicking empty space') + ' clears selection', selection(), []);
      key(document, 'Delete');
      eq(mode + ': Delete after clearing selection leaves data unchanged', JSON.stringify(find(dragId)), beforeDrag);

      p = startPress(dragId);
      await sleep(400);
      releasePress(dragId, p);
      if (mode === 'timeline') {
        await window.App.classAction(bio, 'rename');
        const input = $('#rename-input');
        key(input, 'Backspace', { metaKey: true });
        eq('Delete in a field leaves the selected item alone', [selection(), window.App.inspect().undo], [[dragId], depth]);
        key(input, 'Escape');
        window.App.openItem(dragId);
        f.title.blur();
        key(document, 'Delete');
        eq('Delete is ignored while the editor is open', [selection(), window.App.inspect().undo], [[dragId], depth]);
        click($('#item-cancel'));
        await sleep(30);
      }
      key(document, mode === 'timeline' ? 'Backspace' : 'Delete', { metaKey: mode === 'timeline' });
      eq(mode + ': keyboard delete removes the selected pill in one undo step', [!!find(dragId), selection(), window.App.inspect().undo], [false, [], depth + 1]);
      eq(mode + ': undo is named for the deleted item type', (await menu(['Edit', 'Undo'], false)).title, 'Undo Delete Lecture');
      window.App.command('undo');
      eq(mode + ': one undo restores the item and leaves selection clear', [JSON.stringify(find(dragId)), selection(), window.App.inspect().undo], [beforeDrag, [], depth]);
    }
    window.App.command('view', 'timeline');
    const assignmentPress = startPress(lab);
    await sleep(400);
    releasePress(lab, assignmentPress);
    window.App.command('view', 'compact');
    key(document, 'Delete');
    check('hiding the selected pill clears its keyboard selection', !!find(lab));
    window.App.command('view', 'timeline');
    chip(dragId).focus({ preventScroll: true });
    key(chip(dragId), 'Backspace');
    check('Backspace deletes a keyboard-focused pill', !find(dragId));
    window.App.command('undo');

    // ------------------------------------------------------------ text editing through the Edit menu
    await menu(['File', 'New Item…']);
    await sleep(200);
    check('File > New Item opens the form', dlg.open);
    await bridge({ op: 'test.focus' });
    f.title.focus();
    const typed = document.execCommand('insertText', false, 'Hello');
    await sleep(250);
    const appUndo = window.App.inspect().undo;
    if (typed && f.title.value === 'Hello') {
      m = await menu(['Edit', 'Undo']);
      await sleep(200);
      eq('Edit > Undo undoes typing, not app changes', [m.enabled, f.title.value, window.App.inspect().undo], [true, '', appUndo]);
      m = await menu(['Edit', 'Redo']);
      await sleep(200);
      eq('Edit > Redo restores typing', f.title.value, 'Hello');
      f.title.select();
      await sleep(300);
      const copy = await menu(['Edit', 'Copy'], false);
      const cut = await menu(['Edit', 'Cut'], false);
      const paste = await menu(['Edit', 'Paste'], false);
      eq('Cut, Copy and Paste are live for selected text', [copy.enabled, cut.enabled, paste.enabled], [true, true, true]);
    } else {
      failures.push('could not type into the title field to exercise the Edit menu');
    }
    eq('view switching is off while the form is open', (await menu(['View', 'Compact'], false)).enabled, false);
    click($('#item-cancel'));
    await sleep(100);

    // ------------------------------------------------------------ export, import
    window.App.command('export');
    await sleep(300);
    const mine = JSON.stringify({ classes: state().classes, items: state().items });
    window.App.command('import');
    await sleep(500);
    check('import replaces the data', state().classes.length === 5 && state().items.length > 150, [state().classes.length, state().items.length]);
    eq('import is saved', (await saved()).classes.length, 5);
    window.App.command('undo');
    eq('undo after import restores the old data', JSON.stringify({ classes: state().classes, items: state().items }), mine);
    window.App.command('redo');
    await sleep(100);
    for (const [id, date] of [['before-range', '2019-12-15'], ['after-range', '2036-01-15']]) {
      window.App.openItem(id);
      eq('imported date is selected when editing ' + id, [f.date.value, $('#date-days input:checked').value], [date, date]);
      type(f.title, 'Edited imported item');
      $('#item-form').requestSubmit();
      await sleep(30);
      eq('saving an imported item preserves its date ' + id, [find(id).date, find(id).title], [date, 'Edited imported item']);
      window.App.command('undo');
      await sleep(30);
    }

    // ------------------------------------------------------------ appearance
    await snap('07-seeded-dark');
    await bridge({ op: 'test.toolbar', id: 'viewMode', segment: 1 });
    await sleep(250);
    await snap('08-seeded-compact');
    check('compact pill retains its accessible full title without a native tooltip', !chip('item-0-0').hasAttribute('title') && chip('item-0-0').getAttribute('aria-label').includes('Molecular mechanisms of gene expression'));
    chip('item-0-0').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(450);
    check('compact hover card shows the full title', !$('#card').hidden && $('#card .c1').textContent.includes('Molecular mechanisms of gene expression'));
    chip('item-0-0').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    check('compact long title is shown and ellipsized', $('.n', chip('item-0-0')).textContent.startsWith('Molecular mechanisms') && $('.n', chip('item-0-0')).scrollWidth > $('.n', chip('item-0-0')).clientWidth && getComputedStyle($('.n', chip('item-0-0'))).textOverflow === 'ellipsis');
    check('compact check and weekday fit the pill', $$('.cp .chip').every(p => [...p.children].every(el => inside(el.getBoundingClientRect(), p.getBoundingClientRect()))));
    await menu(['View', 'Appearance', 'Light']);
    await sleep(400);
    check('Light appearance reaches the page', matchMedia('(prefers-color-scheme: light)').matches);
    eq('appearance is saved', (await saved()).settings.theme, 'light');
    await snap('09-seeded-compact-light');
    await menu(['View', 'Timeline']);
    await sleep(250);
    checkTimelineLayout('light timeline');
    await snap('10-seeded-light');
    await menu(['View', 'Appearance', 'Dark']);
    await sleep(400);
    check('Dark appearance reaches the page', matchMedia('(prefers-color-scheme: dark)').matches);
    checkTimelineLayout('dark timeline');

    // Wide and narrow windows exercise different fitted week widths.
    await bridge({ op: 'test.resize', width: 1700, height: 760 });
    await sleep(300);
    window.App.command('today');
    await sleep(900);
    checkCurrentWeekPosition('Today in a wide window');
    checkTimelineLayout('wide timeline');
    await bridge({ op: 'test.resize', width: 820, height: 520 });
    await sleep(300);
    check('resize fits whole weeks', wholeWeeks());
    check('resize preserves a week boundary', isAligned(), scroller.scrollLeft);
    checkCurrentWeekPosition('resize after Today in a wide window');
    checkTimelineLayout('narrow timeline');
    await snap('11-seeded-small-window');
    await bridge({ op: 'test.resize', width: 760, height: 420 });
    await sleep(300);
    await bridge({ op: 'test.chrome', frameName: 'window-frame-small.png' });
    window.App.command('new-item');
    await sleep(150);
    const dialogRect = dlg.getBoundingClientRect();
    check('dialog fits the minimum window', dlg.open && dialogRect.left >= 0 && dialogRect.right <= innerWidth && dialogRect.top >= 0 && dialogRect.bottom <= innerHeight, [dialogRect.left, dialogRect.right, dialogRect.top, dialogRect.bottom]);
    check('dialog fields fit their columns', $$('.field input, .field select', dlg).every(el => el.getBoundingClientRect().right <= el.parentElement.getBoundingClientRect().right + 1));
    click($('#item-cancel'));
    await bridge({ op: 'test.resize', width: 1280, height: 760 });
    await sleep(200);

    // ------------------------------------------------------------ the day changes while the app is open
    const realNow = C.now;
    const tomorrow = C.addDays(today, 1);
    C.now = () => new Date(+tomorrow.slice(0, 4), +tomorrow.slice(5, 7) - 1, +tomorrow.slice(8, 10), 0, 5);
    window.dispatchEvent(new Event('focus'));
    eq('current week marker follows the date', $$('.week-label').indexOf($('.week-label.now')), C.weekIndex(tomorrow, window.App.inspect().layout.R.start));
    C.now = realNow;
    window.dispatchEvent(new Event('focus'));

    // ------------------------------------------------------------ weekly repeats
    const repeatDate = C.addDays(today, 21);
    const repeatDates = [repeatDate, C.addDays(repeatDate, 7)];
    for (const [kind, title, titles] of [
      ['lecture', 'Satellite tracking', ['Satellite tracking', 'Satellite tracking']],
      ['assignment', 'Orbit worksheet', ['Orbit worksheet 1', 'Orbit worksheet 2']],
      ['exam', 'Skills check', ['Skills check', 'Skills check']],
    ]) {
      const ids = new Set(state().items.map(item => item.id));
      const undoCount = window.App.inspect().undo;
      window.App.openItem(null, { classId: 'class3', date: repeatDate });
      click($('#weekdays [data-wd="' + C.weekday(repeatDate) + '"]'));
      f.type.value = kind;
      type(f.until, repeatDates[1]);
      type(f.title, title);
      type(f.link, 'course.example.test/session');
      eq(kind + ' repeat stays selected after switching type', $('#item-save').textContent, 'Add 2');
      $('#item-form').requestSubmit();
      const added = state().items.filter(item => !ids.has(item.id));
      eq(kind + ' repeat stores dates, title, type, class and link', added.map(item =>
        [item.date, item.title, item.type, item.classId, item.link]), repeatDates.map((date, index) =>
        [date, titles[index], kind, 'class3', 'https://course.example.test/session']));
      eq(kind + ' repeat is one undo step', window.App.inspect().undo, undoCount + 1);
      window.App.command('undo');
      eq(kind + ' repeat is undone as a group', state().items.length, ids.size);
      await sleep(30);
    }

    // ------------------------------------------------------------ calendars with the native fixture bridge
    window.App.command('new-class');
    type($('#new-class-input'), 'PHY 567');
    key($('#new-class-input'), 'Enter');
    key($('#new-class-input'), 'Escape');
    const physics = state().classes.find(cls => cls.name === 'PHY 567').id;
    const calendarDlg = $('#calendars-dlg');
    const calendarForm = $('#calendar-form');
    const url = calendarForm.elements.url, picker = calendarForm.elements.classId;
    const calendarError = $('#calendar-error');
    const syncButton = id => $('[data-calendar-action="sync"][data-id="' + id + '"]');
    const waitFor = async (name, condition) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (condition()) return;
        await sleep(20);
      }
      throw new Error('Timed out waiting for ' + name);
    };
    window.App.command('calendars');
    check('Calendars opens with the URL ready for paste', calendarDlg.open && document.activeElement === url);
    eq('class picker defaults to Auto', picker.value, '');
    type(url, 'http://calendar.example.test/feed');
    calendarForm.requestSubmit();
    await waitFor('validation error', () => !calendarError.hidden);
    eq('unsupported scheme shows a specific error', calendarError.textContent, 'Enter an HTTPS or webcal URL.');
    type(url, 'https://missing.example.test/feed');
    calendarForm.requestSubmit();
    await waitFor('native fetch failure', () => !calendarError.hidden);
    eq('failed native fetch leaves the form available and saves no feed',
      [calendarError.textContent, url.disabled, state().calendars.length], ['Calendar not found.', false, 0]);
    click($('#calendar-close'));
    window.App.command('calendars');
    check('reopening clears the old form error', calendarDlg.open && calendarError.hidden);

    type(url, '');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => ' \nwebcal://calendar.example.test/feed  ' } });
    url.dispatchEvent(paste);
    eq('pasting a wrapped link puts a clean URL in the form', url.value, 'webcal://calendar.example.test/feed');
    calendarForm.requestSubmit();
    await waitFor('added auto calendar', () => state().calendars.length === 1 && !url.disabled);
    const auto = state().calendars[0];
    eq('successful add updates the list and resets the form', [
      $('.calendar-url').textContent, url.value, picker.value, calendarError.hidden,
    ], ['https://calendar.example.test/feed', '', '', true]);
    const autoItems = () => state().items.filter(item => item.calendar?.feedId === auto.id);
    eq('Auto matches all four fixture items by course code', autoItems().map(item => item.classId), Array(4).fill(physics));
    eq('dialog shows unmatched and skipped counts', [
      $('#calendar-unmatched > div').textContent, $('#calendar-skipped summary').textContent,
    ], ['1 unmatched event', '2 skipped']);
    const details = $('#calendar-skipped');
    details.open = true;
    await waitFor('notice list', () => !!$('#calendar-notices button'));
    check('skipped titles can be reviewed', $('#calendar-notices').textContent.includes('Cutoff for Material'));
    click($('#calendar-notices button'));
    eq('a skipped notice can be imported', [autoItems().length, $('summary', details).textContent], [5, '1 skipped']);
    $('#calendar-assign-class').value = 'class1';
    click($('[data-calendar-action="assign"]'));
    eq('unmatched events go to the selected class', [autoItems().find(item => item.title.startsWith('Podcast')).classId, $('#calendar-unmatched').hidden], ['class1', true]);

    type(url, 'webcal://CALENDAR.example.test:443/feed#alternate');
    calendarForm.requestSubmit();
    await waitFor('duplicate URL error', () => !calendarError.hidden);
    eq('normalization catches duplicate URLs', [calendarError.textContent, state().calendars.length], ['Calendar already added.', 1]);
    click($('#calendar-close'));
    const quiz = autoItems().find(item => item.type === 'exam');
    window.App.openItem(quiz.id);
    f.type.value = 'assignment';
    $('#item-form').requestSubmit();
    check('editing an imported type saves an override', find(quiz.id).calendar.edited.includes('type'));
    window.App.command('calendars');
    check('feed and its skipped count survive reopening', $('.calendar-url').textContent === auto.url && $('summary', details).textContent === '1 skipped');

    let finishSync;
    window.__testBridge = { calendarFetch: ({ url }) => url === auto.url
      ? new Promise(resolve => { finishSync = resolve; })
      : bridge({ op: 'calendarFetch', url }) };
    click(syncButton(auto.id));
    check('sync disables only the active feed’s Sync button', syncButton(auto.id).disabled && !url.disabled);
    type(url, 'https://calendar.example.test/second');
    picker.value = 'class2';
    calendarForm.requestSubmit();
    await waitFor('second calendar added during sync', () => state().calendars.length === 2 && !url.disabled);
    const specific = state().calendars[1];
    const specificItems = state().items.filter(item => item.calendar?.feedId === specific.id);
    eq('specific class overrides bracket matching and the form resets', [
      specific.classId, specificItems.length, specificItems.every(item => item.classId === 'class2'), picker.value,
    ], ['class2', 5, true, '']);
    finishSync({ error: 'Calendar request timed out.' });
    await waitFor('sync error displayed in the row', () => $('#calendar-list').textContent.includes('Calendar request timed out.'));
    delete window.__testBridge;
    click(syncButton(auto.id));
    await waitFor('successful retry', () => !syncButton(auto.id).disabled);
    eq('retry clears the error and preserves type, assignment and notice', [
      $('#calendar-list').textContent.includes('Calendar request timed out.'),
      find(quiz.id).type, autoItems().find(item => item.title.startsWith('Podcast')).classId,
      autoItems().filter(item => item.calendar.includeNotice).length, state().calendarUnmatched.length,
    ], [false, 'assignment', 'class1', 1, 0]);
    const beforeRemove = state().items.length;
    click($('[data-calendar-action="remove"][data-id="' + auto.id + '"]'));
    eq('Remove keeps imported items and clears that feed’s pending notices', [
      state().calendars.length, state().items.length, autoItems().length, state().calendarSkipped.length,
    ], [1, beforeRemove, 0, 2]);
    picker.value = 'class3';
    click($('#calendar-import'));
    await waitFor('local ICS import', () => state().items.length === beforeRemove + 5 && !url.disabled);
    eq('file import keeps skipped notices available', state().calendarSkipped.filter(note => note.feedId === '').length, 2);
    eq('the saved fixture feed is the only subscription', (await saved()).calendars.map(feed => feed.id), [specific.id]);
    click($('#calendar-close'));

    const chrome = await bridge({ op: 'test.chrome' });
    await bridge({ op: 'test.finish', result: { ok: failures.length === 0, checks: count, failures, chrome } });
  } catch (e) {
    await bridge({ op: 'test.finish', result: { ok: false, checks: count, failures, error: String(e && e.stack || e) } });
  }

  function find(id) { return state().items.find(i => i.id === id); }
})();
