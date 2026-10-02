// Every 5 min (inject node): push offers first seen in the last few hours to the database.
// Independent of store_notifications' wiring. Overlapping windows are fine - to_db upserts
// with ignore-duplicates - and a failed run is retried by the next ones inside the window.
const WINDOW_MS = 3 * 60 * 60 * 1000;
const since = Date.now() - WINDOW_MS;

// the store key is always "src:id", so fill those from it for older entries
const recent = Object.entries(flow.get('offers') || {})
    .filter(([, o]) => o && o.firstSeen >= since)
    .map(([ref, o]) => {
        const i = ref.indexOf(':');
        return Object.assign({}, o, {
            src: o.src || ref.slice(0, i),
            id:  (o.id !== undefined && o.id !== null) ? o.id : ref.slice(i + 1)
        });
    });

const time = new Date().toLocaleTimeString();
if (!recent.length) {
    node.status({ fill: 'grey', shape: 'ring', text: `nothing new in 3h @ ${time}` });
    return null;
}
node.status({ fill: 'blue', shape: 'dot', text: `sent ${recent.length} recent @ ${time}` });
return { payload: recent };
