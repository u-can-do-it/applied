// store_notifications (output 2) / backfill_db -> Supabase upsert request
// Needs env vars SUPABASE_URL and SUPABASE_SECRET_KEY (tab env or the Node-RED process env).
const base = env.get('SUPABASE_URL');
const key  = env.get('SUPABASE_SECRET_KEY');
if (!base || !key) {
    node.status({ fill: 'red', shape: 'ring', text: 'SUPABASE_URL / SUPABASE_SECRET_KEY missing' });
    return null;
}

// Every row must carry exactly the same keys (PostgREST rejects the whole batch otherwise),
// so missing values become null instead of undefined - JSON.stringify drops undefined keys.
const clean = v => (v === undefined || v === null) ? null
                 : (String(v).replace(/\u0000/g, '').trim() || null);

const rows = [];
let skipped = 0;
for (const o of msg.payload || []) {
    const src = clean(o && o.src), id = clean(o && o.id), url = clean(o && o.url);
    if (!src || !id || !url) { skipped++; continue; }
    const t = new Date(o.firstSeen).getTime();
    rows.push({
        src:        src,
        id:         id,
        title:      clean(o.title) || '(no title)',
        company:    clean(o.company),
        seniority:  clean(o.seniority),
        remote:     o.remote === 'yes' || o.remote === true,
        url:        url,
        first_seen: new Date(t > 0 ? t : Date.now()).toISOString()
    });
}
if (skipped) node.warn('to_db: skipped ' + skipped + ' offer(s) without src/id/url');
if (!rows.length) return null;

const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    Prefer: 'resolution=ignore-duplicates,return=minimal'
};
// legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys must not
if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;

// accept both https://x.supabase.co and the dashboard's https://x.supabase.co/rest/v1/
const url = base.replace(/\/+$/, '').replace(/\/rest\/v1$/, '') + '/rest/v1/offers?on_conflict=src,id';

msg.method  = 'POST';
msg.url     = url;
msg.headers = headers;
msg.payload = rows;
msg.dbRows  = rows.length;
msg.dbReq   = { url, headers, body: rows };   // kept so check_db can resend on a transient error
msg.dbTry   = 0;
return msg;
