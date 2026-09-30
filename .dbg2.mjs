import {readFileSync} from 'node:fs';
import * as browserFonts from '@openpresentation/opf-render/fonts-browser';
import {loadBundledFontRegistry} from '@openpresentation/opf-render/fonts-node';
const gallery = JSON.parse(readFileSync('../eb/pptx-gallery/public/opf-editor/gallery.json','utf8'));
const item = gallery.items.find(i => i.id === 'font-schemes/aptos');
console.log(Object.keys(item), JSON.stringify(item.opf).slice(0, 300));
const base = JSON.parse(readFileSync('artifacts/playground-split/base-fonts.json','utf8'));
const startup = JSON.parse(readFileSync('artifacts/playground-split/fonts.json','utf8'));
class Face { constructor(f,b,d){Object.assign(this,{family:f,bytes:b,descriptors:d})} async load(){return this} }
const fonts = new Set(); fonts.ready = Promise.resolve();
const document = {fonts, defaultView:{FontFace:Face}, baseURI:'http://x/'};
const registry = await browserFonts.loadBrowserFontRegistry(startup.map(f=>({family:f.family,weight:f.weight,italic:f.italic,license:f.license,data:Uint8Array.from(atob(f.dataUrl.split(',')[1]),c=>c.charCodeAt(0))})), {document, substitutionPolicy:'visual', fallbackFamily:'Roboto', lazyFontsBaseUrl:'http://x/', scriptBaseUrl:'http://x/s/'});
const list = base.map(f=>({...f, package:'base'}));
const need = browserFonts.lazyFacesNeeded(item.opf, {}, {lazy:[...registry.lazyFonts, ...list], held: registry.describeFaces(), loaded:new Set(), policy:'visual', fallbackFamily:'Roboto'});
console.log(need.map(f=>f.file));
