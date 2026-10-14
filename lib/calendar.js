'use strict';

// Kalender dari alamat iCal (.ics) rahasia: Google Calendar ("Alamat rahasia dalam format iCal")
// atau Outlook/Microsoft 365 ("Publikasikan kalender" → tautan ICS). Hanya dibaca, tanpa login.
// Acara berulang (RRULE, EXDATE, perubahan satu kejadian) diurai oleh node-ical.

const ical = require('node-ical');

const LOOKAHEAD_MS = 36 * 3_600_000; // acara 36 jam ke depan cukup untuk "hari ini" & "besok pagi"

// Link rapat online yang dikenali, urut dari yang paling sering.
const MEETING_LINK =
  /https?:\/\/(?:[\w-]+\.)?(?:zoom\.us\/(?:j|my|w)\/[^\s"'<>]+|meet\.google\.com\/[a-z0-9-]+|teams\.microsoft\.com\/(?:l\/meetup-join|meet)\/[^\s"'<>]+|teams\.live\.com\/meet\/[^\s"'<>]+|[\w-]+\.webex\.com\/[^\s"'<>]+)/i;

// webcal:// = https:// (Google & Outlook memakai keduanya).
function normalizeUrl(url) {
  const value = String(url ?? '').trim().replace(/^webcal:\/\//i, 'https://');
  return /^https:\/\/[^\s]+$/i.test(value) ? value : null;
}

const text = (value) => (typeof value === 'string' ? value : value?.val ?? '').trim();

function meetingLink(event) {
  for (const field of [event.location, event.url, event.description, event['MICROSOFT-SKYPETEAMSMEETINGURL']]) {
    const found = text(field).match(MEETING_LINK);
    if (found) return found[0].replace(/[).,]+$/, '');
  }
  return null;
}

// Kejadian (sudah diurai) → bentuk sederhana untuk Zenopod.
// source = kejadian itu sendiri (bisa override), parent = acara induk (link rapat biasanya di sini).
function toItem(instance, source, parent, feed) {
  const start = new Date(instance.start);
  const end = new Date(instance.end ?? instance.start);
  return {
    id: `${feed.id}:${source.uid ?? text(source.summary)}:${start.getTime()}`,
    title: text(instance.summary ?? source.summary) || '(Tanpa judul)',
    start: start.getTime(),
    end: end.getTime(),
    allDay: Boolean(instance.isFullDay),
    location: text(source.location || parent.location).slice(0, 120),
    link: meetingLink(source) ?? meetingLink(parent),
    calendar: feed.name,
  };
}

// Isi ICS → acara yang beririsan dengan [from, to].
function eventsFromIcs(body, feed, from, to) {
  const parsed = ical.sync.parseICS(body);
  const out = [];
  for (const event of Object.values(parsed)) {
    if (event.type !== 'VEVENT' || event.status === 'CANCELLED') continue;
    // Override satu kejadian (RECURRENCE-ID) sudah ikut di acara induknya.
    if (event.recurrenceid && !event.rrule) continue;
    let instances;
    try {
      instances = ical.expandRecurringEvent(event, { from, to, expandOngoing: true });
    } catch {
      continue; // aturan berulang rusak: lewati acara ini saja
    }
    for (const instance of instances) {
      if (instance.event?.status === 'CANCELLED') continue;
      const item = toItem(instance, instance.event ?? event, event, feed);
      if (item.end > from.getTime() && item.start < to.getTime()) out.push(item);
    }
  }
  return out;
}

async function fetchFeed(feed, url, from, to) {
  const res = await fetch(url, { headers: { accept: 'text/calendar, */*' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(res.status === 404 || res.status === 401 || res.status === 403 ? 'alamat tidak valid atau sudah diganti' : `HTTP ${res.status}`);
  const body = await res.text();
  if (!body.includes('BEGIN:VCALENDAR')) throw new Error('bukan file kalender (.ics)');
  return eventsFromIcs(body, feed, from, to);
}

// feeds: [{ id, name, url }] → { events (urut waktu), errors: { feedId: pesan } }
async function upcoming(feeds, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // sejak awal hari ini
  const to = new Date(now.getTime() + LOOKAHEAD_MS);
  const errors = {};
  const lists = await Promise.all(
    feeds.map(async (feed) => {
      const url = normalizeUrl(feed.url);
      if (!url) {
        errors[feed.id] = 'alamat harus diawali https:// atau webcal://';
        return [];
      }
      try {
        return await fetchFeed(feed, url, from, to);
      } catch (error) {
        errors[feed.id] = error.name === 'TimeoutError' ? 'tidak menjawab (20 dtk)' : error.message;
        return [];
      }
    }),
  );
  const seen = new Set();
  const events = lists
    .flat()
    .filter((e) => !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return { events, errors };
}

// Acara berjam (bukan seharian) berikutnya yang belum selesai.
function nextTimed(events, now = Date.now()) {
  return events.find((e) => !e.allDay && e.end > now) ?? null;
}

module.exports = { normalizeUrl, eventsFromIcs, upcoming, nextTimed, meetingLink };
