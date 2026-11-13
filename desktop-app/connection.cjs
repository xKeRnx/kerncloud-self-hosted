'use strict';
const fs = require('node:fs'), path = require('node:path');
function serverOrigin(value) {
  if (typeof value !== 'string' || value.length > 2000) throw Error('Enter the server HTTPS address');
  const u = new URL(value.trim());
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || !['https:', 'http:'].includes(u.protocol)) throw Error('Use a server origin without credentials, path or query');
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw Error('Remote servers require HTTPS');
  return u.origin;
}
function loadConnection(directory) {
  try {const p = JSON.parse(fs.readFileSync(path.join(directory,'connection.json'),'utf8')); return p.mode === 'remote' ? {mode:'remote',url:serverOrigin(p.url)} : {mode:'local'};}
  catch (e) {if(e.code === 'ENOENT') return {mode:'local'}; throw Error('Saved connection settings are invalid; local data has not been changed');}
}
function saveConnection(directory, input) {
  if (!['local','remote'].includes(input?.mode)) throw Error('Invalid connection mode');
  const next = input.mode === 'remote' ? {mode:'remote',url:serverOrigin(input.url)} : {mode:'local'};
  fs.mkdirSync(directory,{recursive:true});
  const file = path.join(directory,'connection.json'); fs.writeFileSync(file+'.tmp',JSON.stringify(next),{mode:0o600}); fs.renameSync(file+'.tmp',file);
  return next;
}
module.exports={serverOrigin,loadConnection,saveConnection};
