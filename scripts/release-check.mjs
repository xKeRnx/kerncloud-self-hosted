import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),problems=[];
const skipped=new Set(['node_modules','.next','.git','test-results','backups','dist','payload','.release']);
const required=['README.md','README.en.md','LICENSE','SECURITY.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','docs/PUBLISHING.md','docs/SELF-HOSTING.md','docs/DESKTOP.md','compose.self-hosted.yaml','.github/workflows/ci.yml','.github/workflows/desktop.yml'];
for(const f of required)if(!fs.existsSync(path.join(root,f)))problems.push('Missing '+f);
let count=0;
function walk(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){
 const p=path.join(folder,e.name),rel=path.relative(root,p).replaceAll('\\','/');
 if(skipped.has(e.name))continue;
 if(e.isSymbolicLink()){problems.push('Symlink '+rel);continue;}
 if(e.isDirectory()){if(skipped.has(e.name))continue;if(['.signing','.bridge-update-keys'].includes(e.name))problems.push('Private directory '+rel);else walk(p);continue;}
 if(e.name.startsWith('.env')&&!['.env.example','.env.self-hosted.example'].includes(e.name)||/\.(pfx|p12|p8|key|pem|dump)$/i.test(e.name))problems.push('Forbidden local material '+rel);
 if(e.name.endsWith('.tsbuildinfo'))continue;
 count++;if(fs.statSync(p).size>5000000||! /\.(md|json|ya?ml|ts|tsx|js|mjs|cjs|html|sh|ps1|cmd|svg)$/.test(p))continue;
 const text=fs.readFileSync(p,'utf8');
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bsk-(?:or-v1-)?[A-Za-z0-9]{40,}|\bAKIA[A-Z0-9]{16}\b/.test(text))problems.push('Potential secret '+rel);
 if(rel==='README.md'||rel==='README.en.md'){
  for(const m of text.matchAll(/(?:\]\(|src=")([^\s)"#]+)(?:#[^\s)"]*)?[)"]/g)){
   const target=m[1];if(/^(https?:|mailto:|#)/.test(target))continue;
   if(!fs.existsSync(path.resolve(path.dirname(p),target)))problems.push('Broken README link '+target);
  }
 }
}}
walk(root);
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}else console.log(JSON.stringify({ok:true,filesChecked:count,scope:'Release file hygiene, common credential patterns and README links. Not a complete security or rights audit.'}));
