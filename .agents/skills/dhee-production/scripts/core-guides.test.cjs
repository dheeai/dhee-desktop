const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const script = path.join(__dirname,'core-guides.cjs');
function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dhee-guides-'));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'dhee-core'}));
 fs.mkdirSync(path.join(root,'prompts/skills/defaults'),{recursive:true});
 fs.writeFileSync(path.join(root,'prompts/skills/defaults/test.md'),'Actual source guide\n');
 return root;
}
function run(root,...args) {return spawnSync(process.execPath,[script,...args,'--core-root',root],{encoding:'utf8',cwd:os.tmpdir()});}
test('reads source bytes from an explicitly located Core, independent of cwd',()=>{
 const root=fixture();try {const r=run(root,'read','defaults/test');assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'Actual source guide\n');fs.writeFileSync(path.join(root,'prompts/skills/defaults/test.md'),'Updated guide');assert.equal(run(root,'read','defaults/test').stdout,'Updated guide');}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('lists packaged guides when repository-only skills are absent',()=>{
 const root=fixture();try {fs.mkdirSync(path.join(root,'dist/skill'),{recursive:true});fs.writeFileSync(path.join(root,'dist/skill/SKILL.md'),'Agent guide');const r=run(root,'list');assert.equal(r.status,0,r.stderr);const guides=JSON.parse(r.stdout).guides;assert.equal(guides.length,2);assert.ok(guides.find(g=>g.id==='agent/dhee'));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('rejects unknown IDs, traversal and the wrong dependency root',()=>{
 const root=fixture();try {assert.notEqual(run(root,'read','../../package.json').status,0);assert.notEqual(run(root,'read','missing').status,0);fs.writeFileSync(path.join(root,'package.json'),'{"name":"other"}');assert.notEqual(run(root,'list').status,0);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('refuses an authoring guide symlink outside Core',()=>{
 const root=fixture();try {fs.mkdirSync(path.join(root,'.claude/skills/dhee'),{recursive:true});fs.symlinkSync(script,path.join(root,'.claude/skills/dhee/SKILL.md'));const r=run(root,'list');assert.notEqual(r.status,0);assert.match(r.stderr,/escapes Core/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
