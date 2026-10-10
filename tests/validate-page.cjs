const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
let count=0;
for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if(/application\/ld\+json/.test(match[1])) {JSON.parse(match[2]);continue;}
  if(/src=/.test(match[1]))continue;
  new vm.Script(match[2],{filename:'index.html inline script '+(++count)});
}
for(const file of ['map-core.js','search.js']) new vm.Script(fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),{filename:file});
JSON.parse(fs.readFileSync(path.join(__dirname,'../public/search-config.json'),'utf8'));
console.log('Inline scripts, search scripts and configuration parse successfully.');
