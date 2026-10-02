const store  = flow.get('offers') || {};   // src:id  -> offer
const marks  = flow.get('marks') || {};    // per-source watermark
const first  = Object.keys(store).length === 0;
const now    = Date.now();
const fresh  = [];

// titles whose stack we don't want notified (still stored, so they never resurface)
const RE = /(?:^|[^a-z0-9+#])(\.?net|dotnet|go|golang|java)(?![a-z0-9+#.])/i;

// ---- duplicate detection across job boards ---------------------------------
// Same job on two boards = same company + same title, ignoring what boards add on their own:
// legal suffixes / country ("7N Sp. z o. o." = "7N", "emagine Polska" = "emagine"),
// gender tags ("(k/m)", "(m/f/d)") and ".js" ("Node.js" = "Node"). Text in brackets that
// names the stack is kept, so "(Java)" and "(.NET)" at the same company stay separate.
const deacc  = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
const LEGAL  = /\b(sp\.?\s*z\.?\s*o\.?\s*o\.?|sp\.?\s*k\.?|sp\.?\s*j\.?|s\.?\s*a\.?|s\.?\s*c\.?|spolka\s+(z\s+ograniczona\s+odpowiedzialnoscia|akcyjna|komandytowa|jawna)|inc\.?|ltd\.?|llc|gmbh|s\.?r\.?o\.?|b\.?v\.?|polska|poland)(?=\W|$)/g;
const GENDER = /\(\s*(?:[kmfdx]\s*\/\s*[kmfdx](?:\s*\/\s*[kmfdx])?|all genders?|any gender)\s*\)|\b[kmfdx]\s*\/\s*[kmfdx](?:\s*\/\s*[kmfdx])?\b/g;
const flat   = s => s.replace(/[^a-z0-9]+/g, '');
const dupKey = o => flat(deacc(o.company).toLowerCase().replace(LEGAL, ' ')) + '|' +
                    flat(deacc(o.title).toLowerCase().replace(GENDER, ' ').replace(/\.js\b/g, ''));

// key -> first source that reported it. Rebuilt once from everything stored when the key
// format changes, so the switch doesn't re-notify offers we've already seen.
const KEYS_VERSION = 2;
let keys = flow.get('seenKeys') || {};
if (flow.get('seenKeysVersion') !== KEYS_VERSION) {
    keys = {};
    Object.values(store).sort((a, b) => a.firstSeen - b.firstSeen).forEach(o => {
        o.key = dupKey(o);
        if (!keys[o.key]) keys[o.key] = o.src;
    });
    flow.set('seenKeysVersion', KEYS_VERSION);
    node.warn(`dedup keys rebuilt from ${Object.keys(store).length} stored offers -> ${Object.keys(keys).length} keys`);
}

// Cut DB if too big
const MAX = 10000;
const stored = Object.keys(store);
if (stored.length > MAX) {
    stored.sort((a, b) => store[a].firstSeen - store[b].firstSeen)
          .slice(0, stored.length - MAX)
          .forEach(id => { delete keys[store[id].key]; delete store[id]; });
}

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

    const key = dupKey(o);
    store[ref] = {
        src: o.src, id: o.id, key: key,
        title: o.title, company: o.company,
        seniority: o.seniority, remote: o.remote, url: o.url,
        sortVal: o.sortVal, firstSeen: now, lastSeen: now
    };

    // remember the job even when it isn't notified (old or wrong stack), so the same
    // job showing up later on another board isn't treated as new
    const seenBefore = Boolean(keys[key]);
    if (!seenBefore) keys[key] = o.src;

    if (o.sortVal <= mark)     { bubbled++;  return; }   // older than watermark
    if (seenBefore)            { dupes++;    return; }   // already seen (any board)
    if (RE.test(o.title || '')){ excluded++; return; }   // wrong stack

    fresh.push(store[ref]);
});

if (src) marks[src] = highest;
flow.set('offers', store);
flow.set('seenKeys', keys);
flow.set('marks', marks);
node.status({ text: `${src}: ${seeding ? 'SEEDED' : fresh.length + ' new'}, ${bubbled} old, ${dupes} dup, ${excluded} excl | ${Object.keys(store).length} stored` });

// the database is fed by sync_recent from the stored offers, not from here

// a source's first run only seeds - never queue its whole first page
if (first || seeding) return null;

// queue everything new; flush_queue decides when it actually goes out
const queue = flow.get('queued') || [];
fresh.forEach(o => queue.push(o));
flow.set('queued', queue);

if (flow.get('paused')) {
    node.status({ text: `${src}: ${fresh.length} queued (muted), ${queue.length} waiting` });
    return null;
}

return fresh.length ? { manual: false } : null;
