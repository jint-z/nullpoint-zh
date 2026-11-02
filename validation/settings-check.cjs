const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const code = fs.readFileSync('apps/desktop/dist-electron/settings.js','utf8');
function load(stored, platform = 'win32') {
  const m = {exports:{}};
  const loginCalls = [];
  const sandbox = {module:m,exports:m.exports,console,process:{platform},require:(id)=>{
    if (id === 'electron') return {app:{getPath:()=> 'mock',setLoginItemSettings:(settings)=>loginCalls.push(settings)}};
    if (id === 'node:fs') return {readFileSync:()=>{if(stored===null) throw Error('no file'); return JSON.stringify(stored)}};
    if (id === 'node:path') return path;
    if (id === './profile.js') return require('../apps/desktop/dist-electron/profile.js');
    throw Error('unexpected module '+id);
  }};
  vm.runInNewContext(code,sandbox,{timeout:1000});
  return {settings:m.exports.readSettings(),applyLoginItemSetting:m.exports.applyLoginItemSetting,loginCalls};
}
function read(stored) { return load(stored).settings; }
const clean=read(null); assert.equal(clean.language,'zh-CN'); assert.deepEqual(Object.keys(clean.lockedSettings),[]);
const old=read({theme:'dark',knownDevices:['WH-1000XM6']}); assert.equal(old.language,'zh-CN');assert.equal(old.theme,'dark');assert.equal(old.knownDevices[0],'WH-1000XM6');assert.deepEqual(Object.keys(old.lockedSettings),[]);
const existing=read({language:'en',lockedSettings:{speakToChat:false}});assert.equal(existing.language,'en');assert.equal(existing.lockedSettings.speakToChat,false);
const previousVersion=read({language:'en',theme:'dark',accent:'teal',reconnectAutomatically:false,customEq:{'WH-1000XM6:graphic10':[1,2,3]},eqProfiles:[{id:'eq-1',name:'Saved',layout:'graphic10',values:[1,2,3]}]});
assert.equal(previousVersion.language,'en');assert.equal(previousVersion.theme,'dark');assert.equal(previousVersion.accent,'teal');assert.equal(previousVersion.reconnectAutomatically,false);
assert.deepEqual(Array.from(previousVersion.customEq['WH-1000XM6:graphic10']),[1,2,3]);assert.equal(previousVersion.eqProfiles[0].name,'Saved');assert.deepEqual(Array.from(previousVersion.eqProfiles[0].values),[1,2,3]);
const windows=load(null);windows.applyLoginItemSetting(true);windows.applyLoginItemSetting(false);
assert.equal(windows.loginCalls[0].name,'Nullpoint-zh');assert.equal(windows.loginCalls[0].openAtLogin,true);
assert.equal(windows.loginCalls[1].name,'Nullpoint-zh');assert.equal(windows.loginCalls[1].openAtLogin,false);
assert.equal(windows.loginCalls[0].args[0],'--hidden');
const mac=load(null,'darwin');mac.applyLoginItemSetting(true);assert.equal(mac.loginCalls[0].name,undefined);
const dict=JSON.parse(fs.readFileSync('apps/web/src/translations.json','utf8'));for (const k of ['Noise Canceling','Ambient Sound','Off','No headphones connected','EQUALIZER','SETTINGS']) assert(dict[k],`Missing translation ${k}`);
console.log('PASS: settings, language, lock, translations and isolated Windows login item');
