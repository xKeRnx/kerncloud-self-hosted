const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {serverOrigin,loadConnection,saveConnection}=require('../connection.cjs');
test('remote client settings preserve local data and require a bounded trusted origin',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kc-connection-test-'));
 try {
  fs.mkdirSync(path.join(dir,'runtime'));fs.writeFileSync(path.join(dir,'runtime','.env'),'synthetic-key-do-not-replace');
  assert.deepEqual(loadConnection(dir),{mode:'local'});
  saveConnection(dir,{mode:'remote',url:'https://team.example.com/'});
  assert.deepEqual(loadConnection(dir),{mode:'remote',url:'https://team.example.com'});
  saveConnection(dir,{mode:'local'}); assert.equal(fs.readFileSync(path.join(dir,'runtime','.env'),'utf8'),'synthetic-key-do-not-replace');
  for(const url of ['file:///etc/passwd','javascript:alert(1)','https://user:pass@example.com','https://example.com/path','https://example.com/?key=secret','http://192.168.1.3'])assert.throws(()=>serverOrigin(url));
  assert.equal(serverOrigin('http://localhost:3100'),'http://localhost:3100');
 } finally {fs.rmSync(dir,{recursive:true});}
});
