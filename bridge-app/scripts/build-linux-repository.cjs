'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib');
const {run,releaseContext,sha256,reportRelease,validateConfig}=require('./signing/common.cjs');
function releaseText(config,files,now=new Date()){
 const c=config.linux;validateConfig(config,'linux');
 return ['Origin: '+config.publisher.name,'Label: KeRnCloud Bridge','Suite: '+c.suite,'Codename: '+c.suite,'Date: '+now.toUTCString(),'Valid-Until: '+new Date(+now+c.validDays*86400000).toUTCString(),'Architectures: amd64','Components: '+c.component,'Description: KeRnCloud Bridge packages from '+config.publisher.website,'SHA256:',...files.map(f=>' '+f.sha256+' '+f.bytes+' '+f.name),''].join('\n');
}
function gpgArgs(config){return config.linux.gnupgHome?['--homedir',config.linux.gnupgHome]:[];}
function assertGpgFingerprint(list,fingerprint){const primary=list.split(/\r?\n/).findIndex(s=>s.startsWith('pub:'));const line=list.split(/\r?\n/).slice(primary+1).find(s=>s.startsWith('fpr:'));if(primary<0||line?.split(':')[9]?.toUpperCase()!==fingerprint.toUpperCase())throw Error('Exported OpenPGP key does not match configured primary fingerprint');}
async function buildRepository(ctx,deb,{runner=run}={}){
 const {config,version,work}=ctx,c=config.linux;validateConfig(config,'linux');
 const stat=await fs.stat(deb);if(!stat.isFile())throw Error('Expected a Debian package');
 const field=k=>runner('dpkg-deb',['--field',deb,k]).trim();
 if(field('Package')!=='kerncloud-bridge'||field('Version')!==version||field('Architecture')!=='amd64')throw Error('Debian package identity/version/architecture mismatch');
 // Accept only the requested primary key. Authentication stays in gpg-agent.
 const pub=runner(c.gpg,[...gpgArgs(config),'--batch','--export',c.fingerprint],{encoding:null});if(!pub.length)throw Error('No OpenPGP public key found');
 const repo=path.join(work,'apt'),pool=path.join(repo,'pool/main/k/kerncloud-bridge'),binary=path.join(repo,'dists',c.suite,c.component,'binary-amd64');
 await fs.mkdir(pool,{recursive:true});await fs.mkdir(binary,{recursive:true});
 const publicKey=path.join(repo,'kern-ws-archive-keyring.gpg');await fs.writeFile(publicKey,pub,{flag:'wx'});
 assertGpgFingerprint(runner(c.gpg,['--batch','--with-colons','--show-keys',publicKey]),c.fingerprint);
 const name='kerncloud-bridge_'+version+'_amd64.deb';await fs.copyFile(deb,path.join(pool,name),require('node:fs').constants.COPYFILE_EXCL);
 const packages=runner('dpkg-scanpackages',['--multiversion','pool','/dev/null'],{cwd:repo});
 if(!packages.includes('Filename: pool/main/k/kerncloud-bridge/'+name)||!packages.includes('SHA256: '+await sha256(deb)))throw Error('APT package index failed verification');
 await fs.writeFile(path.join(binary,'Packages'),packages);await fs.writeFile(path.join(binary,'Packages.gz'),zlib.gzipSync(packages));
 const releaseDir=path.join(repo,'dists',c.suite),release=path.join(releaseDir,'Release'),items=[];
 for(const name of ['Packages','Packages.gz']){const file=path.join(binary,name);items.push({name:c.component+'/binary-amd64/'+name,bytes:(await fs.stat(file)).size,sha256:await sha256(file)});}
 await fs.writeFile(release,releaseText(config,items));
 for(const [file,args]of [['Release.gpg',['--armor','--detach-sign']],['InRelease',['--clearsign']]])runner(c.gpg,[...gpgArgs(config),'--batch','--local-user',c.fingerprint,...args,'--output',path.join(releaseDir,file),release]);
 runner(c.gpgv,['--keyring',publicKey,path.join(releaseDir,'Release.gpg'),release]);runner(c.gpgv,['--keyring',publicKey,path.join(releaseDir,'InRelease')]);
 const sources='Types: deb\nURIs: '+c.repositoryUrl+'\nSuites: '+c.suite+'\nComponents: '+c.component+'\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/kern-ws-archive-keyring.gpg\n';
 await fs.writeFile(path.join(repo,'kern-ws-bridge.sources'),sources);
 const artifacts=[{path:path.join(pool,name),format:'deb',kind:'installer',platform:'linux',arch:'x64',label:'Linux · Debian / Ubuntu',primary:true,signed:false,repository_authenticated:true},{path:release,format:'apt-release',kind:'repository'},{path:path.join(releaseDir,'Release.gpg'),format:'asc',kind:'repository-signature'},{path:path.join(releaseDir,'InRelease'),format:'inrelease',kind:'repository-signature'},{path:publicKey,format:'gpg',kind:'public-key'},{path:path.join(repo,'kern-ws-bridge.sources'),format:'sources',kind:'repository-config'}];
 return reportRelease(ctx,'linux',artifacts,{verified:true,method:'APT signed repository metadata (not an embedded .deb signature)',fingerprint:c.fingerprint.toUpperCase(),repository:repo,publishing_required:true});
}
async function main(){
 if(process.platform!=='linux')throw Error('APT repository builds require a Linux release runner');
 const ctx=await releaseContext('linux');const deb=process.argv[2];if(!deb)throw Error('Pass the newly built .deb package path');await buildRepository(ctx,path.resolve(deb));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main,buildRepository,releaseText,assertGpgFingerprint};
