// Builds node-red/db-nodes.json from the .js function bodies in node-red/.
// Run: node scripts/build-flow.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../node-red/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');

const TAB = '925b4b5e231836f3';          // scrap-offers
const STORE = 'ac47f3b477cfd38e';        // store_notifications (replaced)
const FLUSH = '422b705aaa86a1c8';        // flush_queue (existing)
const ID = {
  toDb: '7d1c3e9a5b2f4e01',
  writeDb: '7d1c3e9a5b2f4e02',
  checkDb: '7d1c3e9a5b2f4e03',
  inject: '7d1c3e9a5b2f4e04',
  backfill: '7d1c3e9a5b2f4e05',
};

const fn = (id, name, file, x, y, wires, outputs = 1) => ({
  id, type: 'function', z: TAB, name, func: read(file), outputs,
  timeout: 0, noerr: 0, initialize: '', finalize: '', libs: [], x, y, wires,
});

const nodes = [
  fn(STORE, 'store_notifications', 'store_notifications.js', 770, 300, [[FLUSH], [ID.toDb]], 2),
  fn(ID.toDb, 'to_db', 'to_db.js', 990, 300, [[ID.writeDb]]),
  {
    id: ID.writeDb, type: 'http request', z: TAB, name: 'write_db', method: 'use', ret: 'txt',
    paytoqs: 'ignore', url: '', tls: '', persist: false, proxy: '', insecureHTTPParser: false,
    authType: '', senderr: false, headers: [], x: 1160, y: 300, wires: [[ID.checkDb]],
  },
  fn(ID.checkDb, 'check_db', 'check_db.js', 1330, 300, [[ID.writeDb]]),   // retries loop back
  {
    id: ID.inject, type: 'inject', z: TAB, name: 'backfill (click once)', props: [],
    repeat: '', crontab: '', once: false, onceDelay: 0.1, topic: '', x: 800, y: 220,
    wires: [[ID.backfill]],
  },
  fn(ID.backfill, 'backfill_db', 'backfill_db.js', 990, 220, [[ID.toDb]]),
];

writeFileSync(new URL('db-nodes.json', dir), JSON.stringify(nodes, null, 4) + '\n');
console.log(`wrote node-red/db-nodes.json (${nodes.length} nodes)`);
