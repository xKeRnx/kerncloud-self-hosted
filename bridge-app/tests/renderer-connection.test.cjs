'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
async function renderer(savedOrigin=''){
 const els=new Map(),requests=[],defaultOrigin='https://cloud.example.com';
 const get=id=>{if(!els.has(id))els.set(id,{value:'',checked:false,hidden:false,disabled:false,required:false,textContent:'',append(){},replaceChildren(){}});return els.get(id);};
 get('connect').elements={origin:{value:'',disabled:true,required:false},name:{value:''},token:{value:'test-key'}};
 const state={defaultOrigin,origin:savedOrigin||defaultOrigin,customServer:!!savedOrigin,paused:true,connected:false,policy:{capabilities:[],roots:[],targets:[],programs:[]},name:'Mein Rechner',status:'Nicht verbunden'};
 const bridge={onStatus(){},async call(op,b){requests.push({op,b});return op==='connect'?{...state,origin:b.customServer?b.origin:defaultOrigin,customServer:b.customServer}:state;}};
 class FormData {constructor(form){this.form=form;}*[Symbol.iterator](){for(const[k,v]of Object.entries(this.form.elements))if(!v.disabled)yield[k,v.value];}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer.js'),'utf8'),{document:{getElementById:get,createElement:()=>({append(){}}),createTextNode:s=>s},window:{bridge,bridgeLanguage:{text:value=>value,set(){}}},FormData});
 await new Promise(r=>setImmediate(r));
 return {get,requests,bridge,defaultOrigin};
}
test('normal dialog sends only device name/key with a fixed default destination',async()=>{
 const {get,requests,defaultOrigin}=await renderer();
 assert.equal(get('connect').elements.origin.value,defaultOrigin);
 assert.equal(get('connect').elements.origin.disabled,true);
 assert.equal(get('custom-server-field').hidden,true);
 assert.equal(get('server-default').textContent,defaultOrigin);
 await get('connect').onsubmit({preventDefault(){},currentTarget:get('connect')});
 assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))),{op:'connect',b:{name:'Mein Rechner',token:'test-key',customServer:false}});
 assert.equal(get('connect').elements.token.value,'');
});
test('advanced override is explicit, can be reset, and keeps saved custom servers',async()=>{
 const {get,requests,defaultOrigin}=await renderer('https://saved.example.com');
 assert.equal(get('custom-server').checked,true);
 assert.equal(get('custom-server-field').hidden,false);
 assert.equal(get('connect').elements.origin.required,true);
 await get('connect').onsubmit({preventDefault(){},currentTarget:get('connect')});
 assert.equal(requests.at(-1).b.origin,'https://saved.example.com');
 assert.equal(requests.at(-1).b.customServer,true);
 get('custom-server').checked=false;get('custom-server').onchange();
 assert.equal(get('connect').elements.origin.value,defaultOrigin);
 assert.equal(get('connect').elements.origin.disabled,true);
 assert.equal(get('connect').elements.origin.required,false);
 get('custom-server').checked=true;get('custom-server').onchange();
 get('connect').elements.origin.value='https://new.example.com';
 await get('connect').onsubmit({preventDefault(){},currentTarget:get('connect')});
 assert.equal(requests.at(-1).b.origin,'https://new.example.com');
});
test('failed connection retains the key and custom address for correction',async()=>{
 const {get,bridge}=await renderer();
 get('custom-server').checked=true;get('custom-server').onchange();
 get('connect').elements.origin.value='https://custom.example.com';
 bridge.call=async()=>({error:'Verbindung abgelehnt'});
 await get('connect').onsubmit({preventDefault(){},currentTarget:get('connect')});
 assert.equal(get('error').textContent,'Verbindung abgelehnt');
 assert.equal(get('connect').elements.token.value,'test-key');
 assert.equal(get('connect').elements.origin.value,'https://custom.example.com');
});
