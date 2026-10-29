const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const code = fs.readFileSync('apps/desktop/dist-electron/settings.js','utf8');
function read(stored) {
  const m = {exports:{}};
  const sandbox = {module:m,exports:m.exports,console,require:(id)=>{
    if (id === 'electron') return {app:{getPath:()=> 'mock'}};
    if (id === 'node:fs') return {readFileSync:()=>{if(stored===null) throw Error('no file'); return JSON.stringify(stored)}};
    if (id === 'node:path') return path;
    throw Error('unexpected module '+id);
  }};
  vm.runInNewContext(code,sandbox,{timeout:1000});
  return m.exports.readSettings();
}
const clean=read(null); assert.equal(clean.language,'zh-CN'); assert.deepEqual(Object.keys(clean.lockedSettings),[]);
const old=read({theme:'dark',knownDevices:['WH-1000XM6']}); assert.equal(old.language,'zh-CN');assert.equal(old.theme,'dark');assert.equal(old.knownDevices[0],'WH-1000XM6');assert.deepEqual(Object.keys(old.lockedSettings),[]);
const existing=read({language:'en',lockedSettings:{speakToChat:false}});assert.equal(existing.language,'en');assert.equal(existing.lockedSettings.speakToChat,false);
const dict=JSON.parse(fs.readFileSync('apps/web/src/translations.json','utf8'));for (const k of ['Noise Canceling','Ambient Sound','Off','No headphones connected','EQUALIZER','SETTINGS']) assert(dict[k],`Missing translation ${k}`);
console.log('PASS: clean and legacy settings, existing language and lock, key translations');
