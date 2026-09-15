import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.resolve(process.argv[2]??'artifacts/prepared-carets.json');
const consumer=process.argv[3]?await realpath(process.argv[3]):null;
const runtimeRoot=consumer??root,resolve=createRequire(path.join(runtimeRoot,'package.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const {loadOfficeFontRegistry}=await import(pathToFileURL(resolve.resolve('@openpresentation/opf-render/fonts-node')));
const registry=await loadOfficeFontRegistry();
const faces=registry.embeddedFonts.filter(face=>['Gelasio','Carlito','Arimo'].includes(face.family)&&face.weight===400&&!face.italic);registry.dispose();
const bundle=await build({stdin:{resolveDir:runtimeRoot,contents:`
 import {createEditorSession} from '@openpresentation/opf-editor';
 import {createCanvasEditor} from '@openpresentation/opf-editor/canvas';
 import {loadBrowserFontRegistry} from '@openpresentation/opf-render/fonts-browser';
 import {loadHarfBuzzShaper} from '@openpresentation/opf-render/font-shaping-browser';
 window.mount=async({deck,faces,width})=>{
  window.canvas?.destroy();window.fonts?.dispose();window.failures=[];
  document.querySelector('#host').style.width=width+'px';
  window.fonts=await loadBrowserFontRegistry(faces.map(face=>({...face,data:Uint8Array.from(atob(face.dataUrl.split(',')[1]),c=>c.charCodeAt(0))})),{fontShaper:await loadHarfBuzzShaper()});
  window.editor=createEditorSession(deck,{rejectInvalid:true});
  window.canvas=createCanvasEditor(document.querySelector('#host'),{editor,renderOptions:{textMeasurement:fonts.textMeasurement,textPainting:fonts.textPainting,embeddedFonts:fonts.embeddedFonts},onError:error=>failures.push(error.message)});
  await canvas.ready;
 };`},bundle:true,platform:'browser',format:'esm',write:false,metafile:true});
const wasm=await readFile(resolve.resolve('@openpresentation/opf-render/harfbuzz.wasm'));
const inputs={};for(const file of Object.keys(bundle.metafile.inputs)){
 if(file==='<stdin>'||file.startsWith('(disabled):'))continue;
 const actual=await realpath(path.resolve(file));
 if(consumer)assert.ok(actual.startsWith(path.join(consumer,'node_modules')+path.sep),'Installed browser must not load checkout sources');
 inputs[actual]=hash(await readFile(actual));
}
// Read GDEF/advances independently through raw pinned HarfBuzz, outside the
// renderer's caret provider. SVG path matrices then identify the painted origin.
const hb=await import(pathToFileURL(createRequire(await realpath(resolve.resolve('@openpresentation/opf-render/package.json'))).resolve('harfbuzzjs')));
const references={};
for(const face of faces){
 const bytes=Buffer.from(face.dataUrl.split(',')[1],'base64'),physical=new hb.Font(new hb.Face(new hb.Blob(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))));
 const buffer=new hb.Buffer();buffer.addText('office affine');buffer.guessSegmentProperties();hb.shape(physical,buffer);
 references[face.family]=Object.fromEntries(buffer.getGlyphInfosAndPositions().map(glyph=>[glyph.codepoint,{advance:glyph.xAdvance,carets:physical.getLigatureCarets(hb.Direction.LTR,glyph.codepoint)}]));
}
const browser=await chromium.launch();const report={node:process.version,browser:browser.version(),runtime:consumer?'installed':'checkout',inputs,
 bundleSha256:hash(bundle.outputFiles[0].contents),wasmSha256:hash(wasm),verifierSha256:hash(await readFile(new URL(import.meta.url))),
 ...(consumer?{lockSha256:hash(await readFile(path.join(consumer,'package-lock.json')))}:{}),checks:[],errors:[],externalRequests:[],status:'running'};
let page;
try{
 page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',error=>report.errors.push(error.message));
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url==='https://opf-carets.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}</style><div id="host"></div>'});
  if(url==='https://opf-carets.test/harfbuzz.wasm')return route.fulfill({contentType:'application/wasm',body:wasm});
  report.externalRequests.push(url);return route.abort();
 });
 await page.goto('https://opf-carets.test/');await page.addScriptTag({type:'module',content:bundle.outputFiles[0].text});
 const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 for(const width of [640,1100])for(const [family,scalar]of [['Gelasio',false],['Gelasio',true],['Carlito',false]]){
  const source=(family==='Carlito'?'office affine  Cafe':'office affine  o\u0302\u0301')+'\r\nWrapped source stays exact.\rTail';
  const value=scalar?source:[{text:source,fontFamily:family,fontSize:32,underline:true,link:'https://example.org'}];
  const original={name:'Keep metadata',design:{fontScheme:{id:'roboto',heading:{family},body:{family},code:{family}}},slides:[{id:'caret',text:value,notes:'Keep notes'}],extensions:{keep:{value:42}}};
  await page.evaluate(args=>mount(args),{deck:original,faces,width});await paint();
  await page.evaluate(()=>canvas.beginEdit('slides.0.text'));await paint();
  const input=page.locator('.opf-rich-input');
  assert.equal(await input.count(),1,'Prepared scalar and rich text must use glyph-based caret input');
  const points=await page.evaluate(({family,references})=>{
   const paths=[...document.querySelectorAll('.opf-canvas-preview path[data-opf-glyph-source-start]')];
   const glyph=paths.find(node=>Number(node.dataset.opfGlyphSourceStart)===1&&Number(node.dataset.opfGlyphSourceEnd)===4);
   if(!glyph)throw Error('The fixture requires an actual ffi ligature');
   const reference=references[family][Number(glyph.dataset.opfGlyphId)],matrix=glyph.getScreenCTM();
   return [2,3].map((offset,index)=>({offset,x:matrix.e+(reference.carets[index]??reference.advance*(index+1)/3)*matrix.a,basis:reference.carets.length?'font':'interpolated'}));
  },{family,references});
  const observe=async()=>{
   const samples=[];
   for(const expected of points){
    await input.evaluate((node,offset)=>{node.setSelectionRange(offset,offset);node.dispatchEvent(new Event('select'));},expected.offset);await paint();
    const actual=await page.locator('.opf-rich-caret').boundingBox();assert.ok(actual);
    samples.push({...expected,actual:actual.x,delta:actual.x-expected.x});
   }
   return samples;
  };
  const before=await observe();
  const svg=page.locator('.opf-canvas-preview svg');
  const ink=async()=>{
   await page.locator('.opf-rich-selection').evaluate(node=>{node.style.visibility='hidden';});
   try{return await svg.screenshot();}finally{await page.locator('.opf-rich-selection').evaluate(node=>{node.style.visibility='';});}
  };
  const beforeInk=await ink();
  const changedNative=await page.evaluate(()=>{
   const node=document.querySelector('[data-opf-logical-text]');const before=node.getBoundingClientRect().height;
   document.querySelectorAll('[data-opf-logical-text]').forEach(node=>{node.style.fontFamily='monospace';node.style.fontSize='64px';});
   return {before,after:node.getBoundingClientRect().height};
  });
  assert.notEqual(changedNative.before,changedNative.after,'The negative control must change native text geometry');
  const after=await observe(),afterInk=await ink();
  report.checks.push({family,scalar,width,before,after,inkSha256:hash(beforeInk),afterInkSha256:hash(afterInk)});
  for(const sample of [...before,...after])assert.ok(Math.abs(sample.delta)<0.1,`Caret at ${sample.offset} must match ${sample.basis} glyph geometry: ${sample.delta}px`);
  assert.equal(hash(afterInk),hash(beforeInk),'Changing invisible native text must not change painted slide pixels');
  await input.evaluate(node=>{node.setSelectionRange(2,3);node.dispatchEvent(new Event('select'));});await paint();
  const selection=await page.locator('.opf-rich-range').boundingBox();assert.ok(selection);
  assert.ok(Math.abs(selection.x-points[0].x)<0.1);assert.ok(Math.abs(selection.width-(points[1].x-points[0].x))<0.1,'Selection must use the same ligature interior stops');
  await page.mouse.click(points[0].x,selection.y+selection.height/2);
  assert.equal(await input.evaluate(node=>node.selectionStart),2,'Trusted hit testing must select the same source boundary');
  await input.pressSequentially('!');await paint();
  assert.deepEqual(await page.evaluate(()=>editor.document),original,'Draft typing must not write the document');
  await input.press('Control+Enter');await paint();
  const edited=await page.evaluate(()=>editor.document);const expected=source.slice(0,2)+'!'+source.slice(2);
  assert.deepEqual(edited,{...original,slides:[{...original.slides[0],text:scalar?expected:[{...value[0],text:expected}]}]});
  await page.evaluate(()=>editor.undo());assert.deepEqual(await page.evaluate(()=>editor.document),original);
  assert.deepEqual(await page.evaluate(()=>failures),[]);
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status='passed';
 console.log(`Prepared caret browser: ${report.checks.length} scalar/rich, font/interpolated, responsive, selection, pointer and exact-source undo workflows pass (${report.runtime}).`);
}catch(error){report.status='failed';report.failure=error.stack;throw error;}
finally{await browser.close();await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}
