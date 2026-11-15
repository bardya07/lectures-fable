/* Calendar feed reconciliation and native bridge coordination. */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.Core;
  const key = e => JSON.stringify([e.uid, e.occurrence || '']);
  const fields = ['classId', 'type', 'title', 'date', 'link'];

  function reconcile(state, feed, events) {
    state.calendarUnmatched = state.calendarUnmatched || [];
    const existing = new Map(state.items.filter(i => i.calendar && i.calendar.feedId === feed.id).map(i => [key(i.calendar), i]));
    const seen = new Set();
    const unmatched = [];
    for (const event of events) {
      const k = key(event);
      if (seen.has(k)) continue;
      seen.add(k);
      const item = existing.get(k);
      let classId = feed.classId && feed.classId !== 'auto' && state.classes.some(c => c.id === feed.classId)
        ? feed.classId : C.matchCalendarClass(event.title, state.classes);
      // A manually assigned unmatched event stays assigned on future syncs.
      if (!classId && item && state.classes.some(c => c.id === item.classId)) classId = item.classId;
      const incoming = { classId, type: C.calendarType(event.title), title: event.title, date: event.date, link: event.link || '' };
      if (!classId) {
        unmatched.push(Object.assign({ feedId: feed.id, uid: event.uid, occurrence: event.occurrence || '' }, incoming));
        continue;
      }
      if (item) {
        const original = item.calendar.original || {};
        const edited = item.calendar.edited || [];
        for (const field of fields) {
          if (item[field] !== original[field] && !edited.includes(field)) edited.push(field);
          if (!edited.includes(field)) item[field] = incoming[field];
        }
        item.calendar.edited = edited;
        item.calendar.original = incoming;
      } else {
        state.items.push(Object.assign({ id: C.uid(), done: false, calendar: { feedId: feed.id, uid: event.uid, occurrence: event.occurrence || '', original: incoming } }, incoming));
      }
    }
    state.items = state.items.filter(item => {
      if (!item.calendar || item.calendar.feedId !== feed.id || seen.has(key(item.calendar))) return true;
      const original = item.calendar.original || {};
      if (item.done || (item.calendar.edited || []).length || fields.some(field => item[field] !== original[field])) {
        delete item.calendar;
        return true;
      }
      return false;
    });
    state.calendarUnmatched = state.calendarUnmatched.filter(e => e.feedId !== feed.id).concat(unmatched);
  }

  function assign(state, classId) {
    if (!state.classes.some(c => c.id === classId)) throw new Error('Choose a class.');
    for (const e of state.calendarUnmatched || []) {
      const original = { classId, type: e.type, title: e.title, date: e.date, link: e.link || '' };
      const item = Object.assign({ id: C.uid(), done: false }, original);
      if (e.feedId) item.calendar = { feedId: e.feedId, uid: e.uid, occurrence: e.occurrence || '', original: Object.assign({}, original) };
      state.items.push(item);
    }
    state.calendarUnmatched = [];
  }

  function parse(text) {
    if (typeof text !== 'string' || !/BEGIN:VCALENDAR/i.test(text) || !/END:VCALENDAR/i.test(text)) throw new Error('Invalid calendar.');
    return C.parseICS(text);
  }

  function start(api) {
    const active = new Set();
    const errors = new Map();
    const state = () => api.state();
    const changed = (before, label) => { api.changed(before, label); if (root.App && root.App.refreshCalendars) root.App.refreshCalendars(); };
    async function sync(id) {
      const feed = state().calendars.find(f => f.id === id);
      if (!feed || active.has(id)) return;
      active.add(id);
      try {
        const result = await api.call('calendarFetch', { url: feed.url });
        const events = parse(result && result.text);
        // The feed may have been removed or the store replaced while fetching.
        const current = state().calendars.find(f => f.id === id);
        if (!current) return;
        const before = api.snapshot();
        reconcile(state(), current, events);
        current.lastSynced = new Date().toISOString();
        errors.delete(id);
        changed(before, 'Sync Calendar');
      } catch (error) {
        errors.set(id, error && error.message ? error.message : 'Calendar failed.');
        if (root.App && root.App.refreshCalendars) root.App.refreshCalendars();
        throw error;
      } finally { active.delete(id); }
    }
    async function syncAll() {
      for (const feed of state().calendars.slice()) {
        try { await sync(feed.id); } catch (_) { /* Individual errors are shown by manual sync. */ }
      }
    }
    root.CalendarUIHooks = {
      list: () => ({ feeds: state().calendars.map(feed => Object.assign({}, feed, { error: errors.get(feed.id) })), unmatched: state().calendarUnmatched.length }),
      async add(url, classId) {
        url = String(url || '').trim();
        if (!/^https:\/\//i.test(url) && !/^webcal:\/\//i.test(url)) throw new Error('Use an HTTPS or webcal URL.');
        try { const parsed = new URL(url.replace(/^webcal:/i, 'https:')); if (!parsed.hostname) throw new Error(); }
        catch (_) { throw new Error('Invalid URL.'); }
        const feed = { id: C.uid(), url, classId: classId || '', lastSynced: null };
        const before = api.snapshot();
        state().calendars.push(feed);
        changed(before, 'Add Calendar');
        await sync(feed.id);
      },
      sync,
      remove(id) {
        const before = api.snapshot();
        errors.delete(id);
        state().calendars = state().calendars.filter(f => f.id !== id);
        state().calendarUnmatched = state().calendarUnmatched.filter(e => e.feedId !== id);
        // Keep imported items as ordinary items after unsubscribing.
        for (const item of state().items) if (item.calendar && item.calendar.feedId === id) delete item.calendar;
        changed(before, 'Remove Calendar');
      },
      assign(classId) { const before = api.snapshot(); assign(state(), classId); changed(before, 'Assign Calendar'); },
      async importFile(classId) {
        const file = await api.call('calendarImport');
        if (!file) return;
        const events = parse(file.text);
        const before = api.snapshot();
        const temporary = { id: C.uid(), classId: classId || '' };
        reconcile(state(), temporary, events);
        for (const item of state().items) if (item.calendar && item.calendar.feedId === temporary.id) delete item.calendar;
        for (const event of state().calendarUnmatched) if (event.feedId === temporary.id) event.feedId = '';
        changed(before, 'Import Calendar');
      },
    };
    syncAll();
    setInterval(syncAll, 6 * 60 * 60 * 1000);
  }
  const Calendar = { reconcile, assign, start };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calendar;
  else root.Calendar = Calendar;
})(typeof globalThis !== 'undefined' ? globalThis : this);
