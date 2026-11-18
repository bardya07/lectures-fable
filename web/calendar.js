/* Calendar feed reconciliation and native bridge coordination. */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.Core;
  const key = e => JSON.stringify([e.uid, e.occurrence || '']);
  const fields = C.CALENDAR_FIELDS;
  const entryFields = [...fields, 'includeNotice'];

  function editedFields(item) {
    return new Set([...(item.calendar.edited || []),
      ...fields.filter(field => field !== 'type' && item[field] !== item.calendar.original[field])]);
  }

  function eventClass(state, feed, title) {
    return state.classes.some(c => c.id === feed.classId) ? feed.classId : C.matchCalendarClass(title, state.classes);
  }

  function importedItem(event, classId, assigned = false) {
    const original = { classId, type: event.type, title: event.title, date: event.date, link: event.link || '' };
    const item = Object.assign({ id: C.uid(), done: false }, original);
    if (event.feedId) {
      item.calendar = { feedId: event.feedId, uid: event.uid, occurrence: event.occurrence || '', original };
      if (assigned) item.calendar.edited = ['classId'];
      if (event.includeNotice) item.calendar.includeNotice = true;
    }
    return item;
  }

  function reconcile(state, feed, events) {
    const sameFeed = e => e.feedId === feed.id;
    const existing = new Map();
    const seen = new Set((state.calendarTombstones || []).filter(sameFeed).map(key));
    for (const item of state.items) {
      if (item.calendarOrigin && sameFeed(item.calendarOrigin)) seen.add(key(item.calendarOrigin));
      if (!item.calendar || !sameFeed(item.calendar)) continue;
      const k = key(item.calendar);
      if (!existing.has(k) || item.done || editedFields(item).size) existing.set(k, item);
    }
    const allowedNotices = new Set((state.calendarUnmatched || []).filter(e => sameFeed(e) && e.includeNotice).map(key));
    const kept = new Set();
    const unmatched = [], skipped = [];
    for (const event of events) {
      const k = key(event);
      if (seen.has(k)) continue;
      seen.add(k);
      const item = existing.get(k);
      const edited = item ? editedFields(item) : new Set();
      const classId = eventClass(state, feed, event.title) ||
        (item && state.classes.some(c => c.id === item.classId) ? item.classId : null);
      const type = event.type || C.calendarType(event);
      const incoming = { classId, type: type === 'skip' ? 'lecture' : type, title: event.title, date: event.date, link: event.link || '' };
      const entry = Object.assign({ feedId: feed.id, uid: event.uid, occurrence: event.occurrence || '' }, incoming);
      const keepNotice = allowedNotices.has(k) || (item && (item.calendar.includeNotice || item.done || edited.size > 0));
      if (type === 'skip' && !keepNotice) {
        entry.classId = classId || '';
        skipped.push(entry);
        continue;
      }
      if (type === 'skip' || allowedNotices.has(k) || (item && item.calendar.includeNotice)) entry.includeNotice = true;
      if (!classId) {
        delete entry.classId;
        unmatched.push(entry);
      } else if (item) {
        // Retain the previous type if a locally changed item becomes a notice.
        if (type === 'skip') incoming.type = item.calendar.original.type;
        for (const field of fields) if (!edited.has(field)) item[field] = incoming[field];
        if (edited.size) item.calendar.edited = Array.from(edited);
        item.calendar.original = incoming;
        if (entry.includeNotice) item.calendar.includeNotice = true;
        kept.add(item);
      } else {
        const added = importedItem(entry, classId);
        state.items.push(added);
        kept.add(added);
      }
    }
    state.items = state.items.filter(item => {
      if (!item.calendar || !sameFeed(item.calendar) || kept.has(item)) return true;
      if (item.done || item.calendar.includeNotice || editedFields(item).size) {
        if (!seen.has(key(item.calendar))) {
          const { feedId, uid, occurrence } = item.calendar;
          item.calendarOrigin = { feedId, uid, occurrence };
        }
        delete item.calendar;
        return true;
      }
      return false;
    });
    function replaceEntries(entries, incoming) {
      const previous = entries.filter(sameFeed);
      if (previous.length === incoming.length && previous.every((entry, i) =>
        key(entry) === key(incoming[i]) && entryFields.every(f => entry[f] === incoming[i][f]))) return entries;
      return entries.filter(e => !sameFeed(e)).concat(incoming);
    }
    state.calendarUnmatched = replaceEntries(state.calendarUnmatched || [], unmatched);
    state.calendarSkipped = replaceEntries(state.calendarSkipped || [], skipped);
  }

  function assign(state, classId) {
    if (!state.classes.some(c => c.id === classId)) throw new Error('Choose a class.');
    for (const event of state.calendarUnmatched || []) state.items.push(importedItem(event, classId, true));
    state.calendarUnmatched = [];
  }

  function importNotice(state, feedId, uid, occurrence) {
    const skipped = state.calendarSkipped;
    // Different local files may contain the same UID. The dialog passes the exact entry.
    const index = typeof feedId === 'object' ? skipped.indexOf(feedId) :
      skipped.findIndex(e => e.feedId === feedId && e.uid === uid && e.occurrence === occurrence);
    if (index < 0) return;
    const [event] = skipped.splice(index, 1);
    const feed = state.calendars.find(f => f.id === event.feedId) || event;
    const classId = eventClass(state, feed, event.title);
    event.includeNotice = true;
    if (classId) state.items.push(importedItem(event, classId));
    else { delete event.classId; state.calendarUnmatched.push(event); }
  }

  function calendarURL(raw) {
    const value = String(raw || '').trim();
    if (!/^(?:https|webcal):\/\//i.test(value)) throw new Error('Enter an HTTPS or webcal URL.');
    if (!/^(?:https|webcal):\/\/[^/?#]+/i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) {
      throw new Error('Invalid calendar URL.');
    }
    let url;
    try { url = new URL(value.replace(/^webcal:/i, 'https:')); }
    catch (_) { throw new Error('Invalid calendar URL.'); }
    if (!url.hostname) throw new Error('Invalid calendar URL.');
    if (url.username || url.password) throw new Error('Remove credentials from the URL.');
    url.hash = '';
    if (url.href.length > 2000) throw new Error('Calendar URL is too long.');
    return url.href;
  }

  function createController(api) {
    const syncing = new WeakSet();
    const errors = new WeakMap();
    const adding = new Set();
    const state = () => api.state();
    const refresh = () => { if (root.App && root.App.refreshCalendars) root.App.refreshCalendars(); };
    const change = (label, apply) => {
      const before = api.snapshot();
      apply(state());
      api.changed(before, label);
      refresh();
    };
    async function fetchEvents(url) {
      const result = await api.call('calendarFetch', { url });
      if (result && result.error) throw new Error(result.error);
      return C.parseICS(result && result.text, true);
    }
    async function sync(id) {
      const feed = state().calendars.find(f => f.id === id);
      if (!feed || syncing.has(feed)) return;
      syncing.add(feed);
      errors.delete(feed);
      refresh();
      try {
        const events = await fetchEvents(calendarURL(feed.url));
        if (api.finishEditing) await api.finishEditing();
        if (!state().calendars.includes(feed)) return;
        const before = api.snapshot();
        reconcile(state(), feed, events);
        const changedItems = api.snapshot() !== before;
        feed.lastSynced = new Date().toISOString();
        if (changedItems) api.changed(before, 'Sync Calendar');
        else if (api.persist) api.persist();
      } catch (error) {
        if (state().calendars.includes(feed)) errors.set(feed, error.message || 'Calendar sync failed.');
      } finally {
        syncing.delete(feed);
        refresh();
      }
    }
    async function syncAll() {
      for (const feed of state().calendars.slice()) {
        if (state().calendars.includes(feed)) await sync(feed.id);
      }
    }
    return {
      list: () => ({
        feeds: state().calendars.map(feed => Object.assign({}, feed, { error: errors.get(feed), syncing: syncing.has(feed) })),
        unmatched: state().calendarUnmatched.length, skipped: state().calendarSkipped,
      }),
      async add(raw, classId) {
        const url = calendarURL(raw);
        const feeds = state().calendars;
        const duplicate = feeds.some(feed => {
          try { return calendarURL(feed.url) === url; } catch (_) { return false; }
        });
        if (duplicate || adding.has(url)) throw new Error('Calendar already added.');
        adding.add(url);
        try {
          const events = await fetchEvents(url);
          if (state().calendars !== feeds) throw new Error('Calendar list changed. Try again.');
          if (classId && !state().classes.some(c => c.id === classId)) throw new Error('Choose a class.');
          const feed = { id: C.uid(), url, classId: classId || '', lastSynced: new Date().toISOString() };
          change('Add Calendar', state => {
            state.calendars.push(feed);
            reconcile(state, feed, events);
          });
        } finally {
          adding.delete(url);
        }
      },
      sync,
      syncAll,
      remove(id) {
        const index = state().calendars.findIndex(f => f.id === id);
        if (index < 0) return;
        change('Remove Calendar', state => {
          state.calendars.splice(index, 1);
          state.calendarUnmatched = state.calendarUnmatched.filter(e => e.feedId !== id);
          state.calendarSkipped = state.calendarSkipped.filter(e => e.feedId !== id);
          state.calendarTombstones = (state.calendarTombstones || []).filter(e => e.feedId !== id);
          // Keep imported items as ordinary items after unsubscribing.
          for (const item of state.items) {
            if (item.calendar?.feedId === id) delete item.calendar;
            if (item.calendarOrigin?.feedId === id) delete item.calendarOrigin;
          }
        });
      },
      assign(classId) { change('Assign Calendar', state => assign(state, classId)); },
      importNotice(feedId, uid, occurrence) {
        change('Import Calendar Notice', state => importNotice(state, feedId, uid, occurrence));
      },
      async importFile(classId) {
        const feeds = state().calendars;
        const file = await api.call('calendarImport');
        if (!file) return;
        if (file.error) throw new Error(file.error);
        const events = C.parseICS(file.text, true);
        if (state().calendars !== feeds) throw new Error('Calendar list changed. Try again.');
        if (classId && !state().classes.some(c => c.id === classId)) throw new Error('Choose a class.');
        change('Import Calendar', state => {
          const temporary = { id: C.uid(), classId: classId || '' };
          reconcile(state, temporary, events);
          for (const item of state.items) if (item.calendar && item.calendar.feedId === temporary.id) delete item.calendar;
          for (const entry of state.calendarUnmatched.concat(state.calendarSkipped)) {
            if (entry.feedId === temporary.id) entry.feedId = '';
          }
        });
      },
    };
  }

  function start(api) {
    const controller = createController(api);
    root.CalendarUIHooks = controller;
    controller.syncAll();
    setInterval(controller.syncAll, 6 * 60 * 60 * 1000);
  }

  const Calendar = { reconcile, assign, editItem: C.editItem, calendarURL, createController, start };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calendar;
  else root.Calendar = Calendar;
})(typeof globalThis !== 'undefined' ? globalThis : this);
