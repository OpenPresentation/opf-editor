import {richTextContent, updateRichTextInput} from './rich-text.js';
import {textInputMap} from './text-input.js';

/** Native input owns text/IME; navigation uses the displayed source geometry. */
export function createRichTextInput(root, overlay, {path, value, getTarget, onInput, onCommit, onCancel, onFormat, onError}) {
  const doc=root.ownerDocument, win=doc.defaultView;
  const scalar=typeof value==='string',initial=scalar?[value]:value;
  const input=doc.createElement('textarea'), marks=doc.createElement('div'), actions=doc.createElement('div');
  input.className='opf-rich-input';input.value=richTextContent(initial);
  input.setAttribute('aria-label',scalar?`Edit ${path.split('.').at(-1)} inline`:'Edit rich text inline');input.spellcheck=true;
  input.dir='auto';
  input.style.cssText='position:absolute;width:1px;padding:0;border:0;opacity:0;pointer-events:none;resize:none;overflow:hidden;z-index:3';
  marks.className='opf-rich-selection';marks.setAttribute('aria-hidden','true');marks.style.cssText='position:absolute;inset:0;pointer-events:none';
  actions.style.cssText='position:absolute;bottom:8px;left:8px;display:flex;gap:6px;pointer-events:auto;z-index:4';
  for(const [label,action] of [...(onFormat?[[scalar?'Format text':'Format selection',()=>{const map=currentMap();onFormat(map.toSource(input.selectionStart),map.toSource(input.selectionEnd));}]]:[]),...(scalar?[]:[['Done',onCommit]])]) {
    const button=doc.createElement('button');button.type='button';button.textContent=label;
    button.style.cssText='padding:6px 10px;background:#fff;color:#574774;border:1px solid #d5cce5;border-radius:5px';
    button.onmousedown=event=>event.preventDefault();button.onclick=action;actions.append(button);
  }
  overlay.append(marks,input,actions);
  let current=structuredClone(initial), composing=false, change=null, anchor=null, disposed=false, emptyAnchor=null;
  let history=[{value:structuredClone(current),start:0,end:input.value.length}], historyIndex=0, compositionBase=null;
  let navigation=null;
  const selectionKey=()=>`${input.selectionStart}:${input.selectionEnd}:${input.selectionDirection}`;
  let boundarySource=null,sourceBoundaries;
  function graphemeBoundaries() {
    const source=richTextContent(current);
    if(source!==boundarySource){
      boundarySource=source;sourceBoundaries=new Set([source.length]);
      for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(source))sourceBoundaries.add(part.index);
    }
    return sourceBoundaries;
  }
  const currentMap=()=>textInputMap(richTextContent(current));
  function remember() {
    history.splice(historyIndex+1);history.push({value:structuredClone(current),start:input.selectionStart,end:input.selectionEnd});historyIndex++;
  }
  function fragments() { return [...(getTarget(path)?.querySelectorAll('text[data-opf-text-start],tspan[data-opf-text-start]')??[])]; }
  const mapCache=new WeakMap();
  function prepared() {
    return [...(getTarget(path)?.querySelectorAll('[data-opf-caret-map]')??[])].map(node=>{
      const text=node.getAttribute('data-opf-caret-map');let cached=mapCache.get(node);
      if(cached?.text!==text){
        const map=JSON.parse(text);
        if(map.version!==1||![map.start,map.end].every(Number.isInteger)||map.start<0||map.end<map.start||
          ![map.top,map.bottom].every(Number.isFinite)||map.bottom<=map.top||!Array.isArray(map.stops)||
          map.direction!==undefined&&!['ltr','rtl'].includes(map.direction)||
          map.stops.some(stop=>!Number.isInteger(stop.offset)||stop.offset<map.start||stop.offset>map.end||!Number.isFinite(stop.x)))
          throw new Error('Invalid prepared text caret geometry.');
        cached={text,map};mapCache.set(node,cached);
      }
      return {node,map:cached.map,matrix:node.getScreenCTM()};
    }).filter(item=>item.matrix);
  }
  function nativeFragments(){return fragments().filter(node=>!node.closest('[data-opf-shaped-text]')?.querySelector('[data-opf-caret-map]'));}
  function mappedBox(matrix,left,right,top,bottom){
    const points=[[left,top],[right,top],[left,bottom],[right,bottom]].map(([x,y])=>new win.DOMPoint(x,y).matrixTransform(matrix));
    const xs=points.map(point=>point.x),ys=points.map(point=>point.y);
    return {left:Math.min(...xs),top:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
  }
  function rect(node,start,end) {
    // Jointly shaped SVG text can contain styled tspans and links. DOM Range
    // offsets belong to their text nodes, not to the outer element's children.
    const position=offset=>{
      const walker=doc.createTreeWalker(node,win.NodeFilter.SHOW_TEXT);let text=walker.nextNode();
      while(text){if(offset<=text.length)return [text,offset];offset-=text.length;text=walker.nextNode();}
      throw new RangeError('Rich text range exceeds its rendered source.');
    };
    const range=doc.createRange();range.setStart(...position(start));range.setEnd(...position(end));return range.getBoundingClientRect();
  }
  function boundaries() {
    const result=[],target=getTarget(path),allowed=graphemeBoundaries();
    const lines=target?.hasAttribute('data-opf-rich-lines')?JSON.parse(target.dataset.opfRichLines):
      [...(target?.querySelectorAll('text[data-opf-source-start]')??[])].map(node=>({start:Number(node.dataset.opfSourceStart),end:Number(node.dataset.opfSourceEnd)}));
    const add=(point,start,end)=>{
      // A run/paint fragment can split a base from its combining marks. Only
      // whole-source grapheme boundaries are editable, regardless of styling.
      if(!allowed.has(point.offset))return;
      // A fragment belongs to one accepted line, even when its final offset
      // is also the first offset of the next soft-wrapped line.
      const line=lines.findIndex(line=>line.start<=start&&end<=line.end);
      result.push({...point,line});
    };
    for(const {node,map,matrix}of prepared())for(const stop of map.stops){
      const box=mappedBox(matrix,stop.x,stop.x,map.top,map.bottom);
      add({offset:stop.offset,x:box.left,y:box.top,height:box.height,node,basis:stop.basis},map.start,map.end);
    }
    for(const node of nativeFragments()) {
      if(!node.firstChild)continue;
      const start=Number(node.dataset.opfTextStart),text=node.textContent;
      for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)) {
        const box=rect(node,part.index,part.index+part.segment.length),rtl=win.getComputedStyle(node).direction==='rtl';
        add({offset:start+part.index,x:rtl?box.right:box.left,y:box.top,height:box.height,node},start,start+text.length);
        add({offset:start+part.index+part.segment.length,x:rtl?box.left:box.right,y:box.top,height:box.height,node},start,start+text.length);
      }
    }
    const matrix=target?.getScreenCTM();
    if(matrix)for(const [index,line]of JSON.parse(target.dataset.opfRichLines??'[]').entries()) {
      if(line.start!==line.end||!allowed.has(line.start))continue;
      const point=new win.DOMPoint(line.x,line.y).matrixTransform(matrix);
      result.push({offset:line.start,x:point.x,y:point.y,height:line.height*Math.hypot(matrix.c,matrix.d),line:index});
    }
    return result;
  }
  function activePoint(points,offset) {
    if(navigation?.selection!==selectionKey())navigation=null;
    return (navigation&&points.findLast(p=>p.offset===offset&&p.line===navigation.line))??
      points.findLast(p=>p.offset===offset)??points.reduce((best,p)=>!best||Math.abs(p.offset-offset)<Math.abs(best.offset-offset)?p:best,null);
  }
  function moveByLine(event) {
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key)||event.altKey)return false;
    const vertical=event.key==='ArrowUp'||event.key==='ArrowDown';
    if(vertical&&(event.ctrlKey||event.metaKey))return false;
    const map=currentMap(),start=map.toSource(input.selectionStart),end=map.toSource(input.selectionEnd);
    const backward=input.selectionDirection==='backward',focus=backward?start:end,anchor=backward?end:start;
    const points=boundaries(),point=activePoint(points,focus);
    if(!point||point.line<0)return false;
    const goal=vertical?(navigation?.x??point.x):null;
    const ordered=[...new Set(points.map(p=>p.line).filter(line=>line>=0))].sort((a,b)=>a-b);
    let line=point.line,target;
    if(vertical){
      const next=ordered[ordered.indexOf(line)+(event.key==='ArrowUp'?-1:1)];
      if(next===undefined){
        const offset=event.key==='ArrowUp'?0:richTextContent(current).length;
        target=points.findLast(p=>p.offset===offset);
      }else{
        line=next;
        target=points.filter(p=>p.line===line).reduce((best,p)=>!best||Math.abs(p.x-goal)<Math.abs(best.x-goal)?p:best,null);
      }
    }else{
      const documentEdge=event.ctrlKey||event.metaKey;
      const choices=documentEdge?points:points.filter(p=>p.line===line);
      const offset=choices.reduce((offset,p)=>Math[event.key==='Home'?'min':'max'](offset,p.offset),choices[0].offset);
      target=choices.findLast(p=>p.offset===offset);
    }
    if(!target)return false;
    const fixed=event.shiftKey?anchor:target.offset;
    input.setSelectionRange(map.toInput(Math.min(fixed,target.offset)),map.toInput(Math.max(fixed,target.offset)),target.offset<fixed?'backward':'forward');
    // Keep the desired x through short/empty lines and the visual affinity of
    // a soft-wrap boundary. External selection changes invalidate both.
    navigation={selection:selectionKey(),line:target.line,x:goal};
    update();return true;
  }
  function update() {
    if(disposed)return;marks.replaceChildren();
    const map=currentMap(),origin=root.getBoundingClientRect(),start=map.toSource(input.selectionStart),end=map.toSource(input.selectionEnd);
    const append=(box,caret=false)=>{
      const mark=doc.createElement('div');mark.className=caret?'opf-rich-caret':'opf-rich-range';
      mark.style.cssText=`position:absolute;left:${box.left-origin.left}px;top:${box.top-origin.top}px;width:${caret?1.5:box.width}px;height:${Math.max(12,box.height)}px;background:${caret?(box.color??'#6551ba'):'#8975d955'}`;
      marks.append(mark);
    };
    if(start!==end){
      for(const {map,matrix}of prepared()){
        const xs=[];
        for(let i=0;i<map.stops.length-1;i++){
          const left=map.stops[i],right=map.stops[i+1];
          if(left.offset<end&&right.offset>start)xs.push(left.x,right.x);
        }
        if(xs.length)append(mappedBox(matrix,Math.min(...xs),Math.max(...xs),map.top,map.bottom));
      }
      for(const node of nativeFragments()) {
        const a=Math.max(0,start-Number(node.dataset.opfTextStart)),b=Math.min(node.textContent.length,end-Number(node.dataset.opfTextStart));
        if(a<b&&node.firstChild)append(rect(node,a,b));
      }
    }
    const points=boundaries();
    if(points.length)emptyAnchor=points[0];
    const offset=input.selectionDirection==='backward'?start:end;
    // Prefer the beginning of the next fragment at wrapped line boundaries.
    const point=activePoint(points,offset);
    const target=emptyAnchor?{left:emptyAnchor.x,top:emptyAnchor.y,width:1,height:emptyAnchor.height}:getTarget(path)?.getBoundingClientRect();
    const box=point?{left:point.x,top:point.y,width:1,height:point.height,color:point.node?win.getComputedStyle(point.node).fill:undefined}:target;
    if(box) {
      if(start===end)append(box,true);
      input.style.left=`${box.left-origin.left}px`;input.style.top=`${box.top-origin.top}px`;input.style.height=`${Math.max(20,box.height)}px`;
      if(point?.node){
        input.style.font=win.getComputedStyle(point.node).font;
        input.dir=mapCache.get(point.node)?.map.direction??'auto';
      }
    }
  }
  function nearest(event) {
    return boundaries().reduce((best,p)=>{
      const vertical=Math.max(p.y-event.clientY,0,event.clientY-p.y-p.height);
      const distance=vertical*vertical*100+Math.pow(p.x-event.clientX,2);
      return !best||distance<best.distance?{...p,distance}:best;
    },null)??{offset:0,line:-1};
  }
  function pointerDown(event) {
    if(event.button!==0||!getTarget(path)?.contains(event.target))return;
    event.preventDefault();event.stopPropagation();navigation=null;
    const map=currentMap(),point=nearest(event);
    anchor=event.shiftKey?map.toSource(input.selectionDirection==='backward'?input.selectionEnd:input.selectionStart):point.offset;input.focus({preventScroll:true});
    const end=point.offset;input.setSelectionRange(map.toInput(Math.min(anchor,end)),map.toInput(Math.max(anchor,end)),end<anchor?'backward':'forward');
    navigation={selection:selectionKey(),line:point.line,x:null};
    root.setPointerCapture(event.pointerId);update();
  }
  function pointerMove(event) {
    if(anchor===null)return;event.preventDefault();const point=nearest(event),end=point.offset,map=currentMap();
    input.setSelectionRange(map.toInput(Math.min(anchor,end)),map.toInput(Math.max(anchor,end)),end<anchor?'backward':'forward');
    navigation={selection:selectionKey(),line:point.line,x:null};update();
  }
  function pointerUp(event) {if(anchor!==null){anchor=null;if(root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);}}
  function undo(direction) {
    navigation=null;
    const next=historyIndex+direction;if(next<0||next>=history.length)return;
    historyIndex=next;const saved=history[next];current=structuredClone(saved.value);input.value=richTextContent(current);
    input.setSelectionRange(saved.start,saved.end);onInput(current);update();
  }
  input.addEventListener('beforeinput',event=>{
    navigation=null;
    if(event.inputType==='historyUndo'||event.inputType==='historyRedo'){event.preventDefault();undo(event.inputType==='historyUndo'?-1:1);return;}
    change={start:input.selectionStart,end:input.selectionEnd,inputType:event.inputType};
    if(!composing){history[historyIndex].start=input.selectionStart;history[historyIndex].end=input.selectionEnd;}
  });
  input.addEventListener('input',()=>{
    try{current=updateRichTextInput(current,input.value,change);change=null;if(!composing)remember();onInput(current);update();}
    catch(error){input.value=richTextContent(current);change=null;onError(error);}
  });
  input.addEventListener('compositionstart',()=>{composing=true;compositionBase=JSON.stringify(current);});
  input.addEventListener('compositionend',()=>{composing=false;if(JSON.stringify(current)!==compositionBase)remember();onInput(current);update();});
  input.addEventListener('keydown',event=>{
    if(event.isComposing||composing)return;
    if(moveByLine(event)){event.preventDefault();event.stopPropagation();}
    else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopPropagation();undo(event.shiftKey?1:-1);}
    else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel();}
    else if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();onCommit();}
    else if(!['Shift','Control','Meta','Alt'].includes(event.key))navigation=null;
  });
  input.addEventListener('select',update);input.addEventListener('keyup',update);
  input.addEventListener('blur',()=>{if(!disposed&&!composing)onCommit();});
  root.addEventListener('pointerdown',pointerDown,true);root.addEventListener('pointermove',pointerMove);root.addEventListener('pointerup',pointerUp);root.addEventListener('pointercancel',pointerUp);
  input.focus({preventScroll:true});input.select();update();
  return {input,update,get value(){return scalar?richTextContent(current):structuredClone(current);},get composing(){return composing;},destroy(){disposed=true;root.removeEventListener('pointerdown',pointerDown,true);root.removeEventListener('pointermove',pointerMove);root.removeEventListener('pointerup',pointerUp);root.removeEventListener('pointercancel',pointerUp);marks.remove();input.remove();actions.remove();}};
}
