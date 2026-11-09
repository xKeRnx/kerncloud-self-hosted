import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {probeModel} from '../src/server/model-monitor.ts';

test('Catalog checks do not generate text, disclose errors or follow redirects', async()=>{
  process.env.ALLOW_LOCAL_ENDPOINTS='true';
  let redirectReached=false, generated=false;
  const server=createServer((req,res)=>{
    if(req.url?.includes('chat')) generated=true;
    if(req.url==='/target') redirectReached=true;
    if(req.url==='/yes/models') res.end(JSON.stringify({data:[{id:'allowed'}]}));
    else if(req.url==='/denied/models') {res.statusCode=401;res.end('sensitive provider body');}
    else if(req.url==='/redirect/models') {res.statusCode=302;res.setHeader('location','/target');res.end();}
    else if(req.url==='/huge/models') res.end('x'.repeat(1048577));
    else {res.statusCode=404;res.end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const addr=server.address(); assert.ok(addr && typeof addr!=='string');
  const base=`http://127.0.0.1:${addr.port}`;
  try {
    assert.equal(await probeModel(base+'/yes','allowed','fixture'),'available');
    assert.equal(await probeModel(base+'/yes','missing','fixture'),'unlisted');
    assert.equal(await probeModel(base+'/denied','allowed','fixture'),'unavailable');
    assert.equal(await probeModel(base+'/missing','allowed','fixture'),'unsupported');
    assert.equal(await probeModel(base+'/redirect','allowed','fixture'),'unavailable');
    assert.equal(await probeModel(base+'/huge','allowed','fixture'),'unsupported');
    assert.equal(generated,false); assert.equal(redirectReached,false);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
