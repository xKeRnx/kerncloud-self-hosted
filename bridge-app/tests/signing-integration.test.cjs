'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {buildRepository}=require('../scripts/build-linux-repository.cjs');
const {run}=require('../scripts/signing/common.cjs');
const available=bin=>!spawnSync(bin,['--version'],{stdio:'ignore'}).error;
const canRun=process.platform==='linux'&&['gpg','gpgv','dpkg-deb','dpkg-scanpackages','apt-get','makensis'].every(available);
test('real isolated GPG/APT repository verifies, rejects tampering and refuses wrong versions',{skip:!canRun,timeout:120000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'kerncloud-signing-integration-'));await fs.chmod(root,0o755);
 t.after(async()=>{run('gpgconf',['--homedir',path.join(root,'gnupg'),'--kill','gpg-agent']);if(!root.startsWith(os.tmpdir()+path.sep+'kerncloud-signing-integration-'))throw Error('Cleanup scope');await fs.rm(root,{recursive:true,force:true});});
 const home=path.join(root,'gnupg');await fs.mkdir(home,{mode:0o700});
 run('gpg',['--homedir',home,'--batch','--pinentry-mode','loopback','--passphrase','','--quick-generate-key','KeRnCloud SIGNING TEST FIXTURE <signing-fixture@example.invalid>','ed25519','sign','1d']);
 const list=run('gpg',['--homedir',home,'--batch','--with-colons','--list-keys']);const fingerprint=list.split('\n').find(s=>s.startsWith('fpr:')).split(':')[9];
 const version='1.2.3',pkg=path.join(root,'pkg');await fs.mkdir(path.join(pkg,'DEBIAN'),{recursive:true});await fs.writeFile(path.join(pkg,'DEBIAN/control'),'Package: kerncloud-bridge\nVersion: '+version+'\nArchitecture: amd64\nMaintainer: SIGNING TEST FIXTURE <fixture@example.invalid>\nDescription: isolated fixture with no executable code\n');
 const deb=path.join(root,'fixture.deb');run('dpkg-deb',['--root-owner-group','--build',pkg,deb]);
 const config={publisher:{name:'KeRnCloud SIGNING TEST FIXTURE',website:'https://example.invalid',email:'fixture@example.invalid'},linux:{gpg:'gpg',gpgv:'gpgv',fingerprint,gnupgHome:home,repositoryUrl:'https://example.invalid/apt',suite:'stable',component:'main',validDays:14}};
 const work=path.join(root,'candidate');await fs.mkdir(work);const report=await buildRepository({root,version,work,config},deb);
 assert.equal(report.platform,'linux');assert.equal(report.published,false);assert.equal(report.artifacts[0].signed,false);assert.equal(report.artifacts[0].repository_authenticated,true);
 const repo=path.join(work,'apt'),key=path.join(repo,'kern-ws-archive-keyring.gpg');
 const sources=path.join(root,'fixture.list');await fs.writeFile(sources,'deb [signed-by='+key+'] file:'+repo+' stable main\n');
 const apt=async dir=>{await fs.mkdir(path.join(dir,'partial'),{recursive:true});return spawnSync('apt-get',['-o','Dir::Etc::sourcelist='+sources,'-o','Dir::Etc::sourceparts=-','-o','Dir::State::lists='+dir,'-o','Dir::Cache::archives='+path.join(root,'cache'),'-o','Dir::Etc::trusted='+key,'-o','Dir::Etc::trustedparts=-','-o','APT::Get::List-Cleanup=false','update'],{encoding:'utf8'});};
 let checked=await apt(path.join(root,'lists-valid'));assert.equal(checked.status,0,checked.stderr);assert.ok(checked.stdout.includes('InRelease'));
 const inRelease=path.join(repo,'dists/stable/InRelease');await fs.appendFile(inRelease,'TAMPERED TEST FIXTURE\n');
 // Trailing text need not invalidate every clearsign parser: change authenticated content.
 await fs.writeFile(inRelease,(await fs.readFile(inRelease,'utf8')).replace('Origin: KeRnCloud SIGNING TEST FIXTURE','Origin: TAMPERED TEST FIXTURE'));
 checked=await apt(path.join(root,'lists-tampered'));assert.notEqual(checked.status,0);assert.match(checked.stderr,/signature|BADSIG|signed/i);
 const mismatch=path.join(root,'mismatch');await fs.mkdir(mismatch);await assert.rejects(buildRepository({root,version:'9.9.9',work:mismatch,config},deb),/version/);
});
test('actual NSIS uninstaller signing hook aborts compilation on signer failure',{skip:!canRun,timeout:30000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'kerncloud-nsis-signing-fixture-'));t.after(async()=>{if(!root.startsWith(os.tmpdir()+path.sep+'kerncloud-nsis-signing-fixture-'))throw Error('Cleanup scope');await fs.rm(root,{recursive:true,force:true});});
 const script=path.join(root,'test.nsi'),out=path.join(root,'fixture.exe'),hook=path.join(root,'hook.cjs'),marker=path.join(root,'hook-called.json');
 await fs.writeFile(hook,'const fs=require("node:fs");const b=fs.readFileSync(process.argv[2]);if(b.subarray(0,2).toString()!=="MZ")process.exit(99);fs.writeFileSync('+JSON.stringify(marker)+',JSON.stringify({fixture:true,validPE:true}));process.exit(23);');
 await fs.writeFile(script,'Unicode true\nName "SIGNING TEST FIXTURE"\nOutFile "'+out+'"\n!uninstfinalize \'"'+process.execPath+'" "'+hook+'" "%1"\' = 0\nSection\nWriteUninstaller "$TEMP/fixture-uninstall.exe"\nSectionEnd\nSection "Uninstall"\nSectionEnd\n');
 const compiled=spawnSync('makensis',['-V3',script],{encoding:'utf8'});assert.notEqual(compiled.status,0);assert.deepEqual(JSON.parse(await fs.readFile(marker)),{fixture:true,validPE:true});assert.match(compiled.stdout+compiled.stderr,/uninstfinalize|returned|23/i);
});
test('production NSIS template compiles the KeRn-WS metadata with a new version',{skip:!canRun,timeout:30000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'kerncloud-nsis-template-fixture-'));t.after(async()=>{if(!root.startsWith(os.tmpdir()+path.sep+'kerncloud-nsis-template-fixture-'))throw Error('Cleanup scope');await fs.rm(root,{recursive:true,force:true});});
 const payload=path.join(root,'payload'),out=path.join(root,'fixture.exe'),uninstall=path.join(root,'uninstall.nsh');await fs.mkdir(payload);await fs.writeFile(path.join(payload,'fixture.txt'),'SIGNING BUILD TEST FIXTURE - never installed');await fs.writeFile(uninstall,'Delete "$INSTDIR\\fixture.txt"\n');
 const app=path.resolve(__dirname,'..');run('makensis',['-V2','-WX','-DAPP_VERSION=1.2.3','-DAPP_FILES_DIR='+payload,'-DAPP_ICON='+path.join(app,'assets/icon.ico'),'-DOUTPUT_FILE='+out,'-DUNINSTALL_FILES='+uninstall,'-DAPP_SIZE_KB=1',path.join(app,'installer/windows.nsi')]);
 const bytes=await fs.readFile(out);assert.equal(bytes.subarray(0,2).toString(),'MZ');assert.ok(bytes.includes(Buffer.from('KeRn-WS','utf16le')));assert.ok(bytes.includes(Buffer.from('1.2.3','utf16le')));
});
