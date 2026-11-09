// Test-only query counts. No SQL, parameters, credentials or content are recorded.
const pg = require('pg');
let queries = 0;
const original = pg.Client.prototype.query;
pg.Client.prototype.query = function (...args) { queries++; return original.apply(this,args); };
process.on('message', message => {
  if(message?.kind === 'kc-load-stats' && process.send)
    process.send({kind:'kc-load-stats',id:message.id,queries});
});
