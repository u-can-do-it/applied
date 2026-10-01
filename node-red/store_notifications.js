const store  = flow.get('offers') || {};   // src:id  -> offer
const keys   = flow.get('seenKeys') || {}; // company|title -> first source that reported it
const marks  = flow.get('marks') || {};    // per-source watermark
const first  = Object.keys(store).length === 0;
const now    = Date.now();
const fresh  = [];
const added  = [];                         // every newly stored offer -> output 2 (database)

// titles whose stack we don't want notified (still stored, so they never resurface)
const RE = /(?:^|[^a-z0-9+#])(\.?net|dotnet|go|golang|java)(?![a-z0-9+#.])/i;

// Cut DB if too big
const MAX = 10000;
const stored = Object.keys(store);
if (stored.length > MAX) {
    stored.sort((a, b) => store[a].firstSeen - store[b].firstSeen)
          .slice(0, stored.length - MAX)
          .forEach(id => { delete keys[store[id].key]; delete store[id]; });
}

// ---- TEST: forget the 3 newest offers of one source ------------------------
// const SRC = 'eldorado';
// const top = Object.values(store).filter(o => o.src === SRC)
//                   .sort((a, b) => b.sortVal - a.sortVal).slice(0, 3);
// top.forEach(o => { delete keys[o.key]; delete store[o.src + ':' + o.id]; });
// marks[SRC] = Math.max(...Object.values(store).filter(o => o.src === SRC).map(o => o.sortVal));
// flow.set('offers', store); flow.set('seenKeys', keys); flow.set('marks', marks);
// node.warn('forgot ' + top.map(o => o.id).join(', ') + ' | ' + SRC + ' mark now ' + marks[SRC]);
// return null;
// ---------------------------------------------------------------------------

const list    = msg.payload || [];
const src     = list.length ? list[0].src : null;
const seeding = src !== null && marks[src] === undefined;  // first sight of this source
const mark    = marks[src] || 0;
let highest = mark, bubbled = 0, dupes = 0, excluded = 0;

list.forEach(o => {
    if (!o || !o.id) return;
    const ref = o.src + ':' + o.id;

    if (o.sortVal > highest) highest = o.sortVal;

    if (store[ref]) { store[ref].lastSeen = now; return; }

    store[ref] = {
        src: o.src, id: o.id, key: o.key,
        title: o.title, company: o.company,
        seniority: o.seniority, remote: o.remote, url: o.url,
        sortVal: o.sortVal, firstSeen: now, lastSeen: now
    };
    added.push(store[ref]);

    if (o.sortVal <= mark)     { bubbled++;  return; }   // older than watermark
    if (keys[o.key])           { dupes++;    return; }   // already seen via other source
    if (RE.test(o.title || '')){ excluded++; return; }   // wrong stack

    keys[o.key] = o.src;
    fresh.push(store[ref]);
});

if (src) marks[src] = highest;
flow.set('offers', store);
flow.set('seenKeys', keys);
flow.set('marks', marks);
node.status({ text: `${src}: ${seeding ? 'SEEDED' : fresh.length + ' new'}, ${bubbled} old, ${dupes} dup, ${excluded} excl | ${Object.keys(store).length} stored` });

// output 2: everything newly stored goes to the database, seeding runs included
const db = added.length ? { payload: added } : null;

// a source's first run only seeds - never queue its whole first page
if (first || seeding) return [null, db];

// queue everything new; flush_queue decides when it actually goes out
const queue = flow.get('queued') || [];
fresh.forEach(o => queue.push(o));
flow.set('queued', queue);

if (flow.get('paused')) {
    node.status({ text: `${src}: ${fresh.length} queued (muted), ${queue.length} waiting` });
    return [null, db];
}

return [fresh.length ? { manual: false } : null, db];
