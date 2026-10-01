// write_db -> surface failures, retry transient ones; Supabase answers 201 on success
// output 1 is wired back into write_db for retries
const code = msg.statusCode;
const body = String(msg.payload || '');

if (code >= 200 && code < 300) {
    node.status({ fill: 'green', shape: 'dot', text: `saved ${msg.dbRows} @ ${new Date().toLocaleTimeString()}` });
    return null;
}

// network errors (statusCode is e.g. "ECONNRESET"), 5xx, rate limits and Supabase's
// "JWT issued at future" clock-skew 401 are worth another go; anything else is a real bug
const transient = typeof code !== 'number' || code >= 500 || code === 429 ||
                  (code === 401 && body.includes('PGRST303'));
const tries = msg.dbTry || 0;

if (transient && msg.dbReq && tries < 3) {
    const r = msg.dbReq;
    const wait = 5000 * (tries + 1);
    node.status({ fill: 'yellow', shape: 'ring', text: `retry ${tries + 1}/3 in ${wait / 1000}s (${code})` });
    setTimeout(() => node.send({
        method: 'POST', url: r.url, headers: r.headers, payload: r.body,
        dbReq: r, dbRows: msg.dbRows, dbTry: tries + 1
    }), wait);
    return null;
}

node.status({ fill: 'red', shape: 'ring', text: 'db error ' + (code || '?') });
node.error('supabase: status ' + code + (tries ? ' after ' + tries + ' retries' : '') + ': ' + body.slice(0, 500), msg);
return null;
