// one-off: push every offer already held in flow context to the database.
// Safe to click again - rows already in the table are ignored.
const CHUNK = 500;

// older entries may predate some fields; the store key is always "src:id", so fill from it
const all = Object.entries(flow.get('offers') || {}).map(([ref, o]) => {
    const i = ref.indexOf(':');
    return Object.assign({}, o, {
        src: (o && o.src) || ref.slice(0, i),
        id:  (o && o.id !== undefined && o.id !== null) ? o.id : ref.slice(i + 1)
    });
});

// one request every 2 s instead of all at once
const chunks = Math.ceil(all.length / CHUNK);
for (let c = 0; c < chunks; c++) {
    setTimeout(() => node.send({ payload: all.slice(c * CHUNK, (c + 1) * CHUNK) }), c * 2000);
}
node.status({ text: `sending ${all.length} in ${chunks} chunk(s)` });
return null;
