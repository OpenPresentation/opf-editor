import assert from 'node:assert/strict';

export const navigationText='ABC\r\nD\rABC\r\n\rABCD';

// Source-offset expectations are independent of the editor's geometry code.
export async function checkHardLineNavigation(page,input,paint) {
  const selected=()=>input.evaluate(node=>[node.selectionStart,node.selectionEnd,node.selectionDirection]);
  const select=async offset=>{await input.evaluate((node,offset)=>{node.setSelectionRange(offset,offset);node.dispatchEvent(new Event('select'));},offset);await paint();};
  const press=async(key,offset)=>{await input.press(key);await paint();const actual=await selected();assert.equal(actual[0],offset,key+' should use visible lines');assert.equal(actual[1],offset);};
  await select(2);await press('ArrowDown',5);await press('ArrowDown',8);await press('ArrowUp',5);await press('ArrowUp',2);
  await input.press('Shift+ArrowDown');await paint();assert.deepEqual(await selected(),[2,5,'forward']);
  await input.press('Shift+ArrowDown');await paint();assert.deepEqual(await selected(),[2,8,'forward']);
  await input.press('Shift+ArrowUp');await input.press('Shift+ArrowUp');await paint();assert.equal((await selected())[0],2);assert.equal((await selected())[1],2);
  await select(7);await press('Home',6);await press('End',9);await press('ArrowDown',10);await press('ArrowDown',14);await press('ArrowDown',15);
  await select(0);await press('ArrowUp',0);await press('End',3);await press('Home',0);
  await select(7);await input.press('Shift+Home');await paint();assert.deepEqual(await selected(),[6,7,'backward']);
  await select(7);await input.press('Shift+End');await paint();assert.deepEqual(await selected(),[7,9,'forward']);
  await press('Control+Home',0);await press('Control+End',15);
}

export async function checkSoftLineNavigation(page,input,paint) {
  const lines=await page.evaluate(()=>{
    const target=document.querySelector('[data-canvas-target][data-opf-path="slides.0.text"]');
    const lines=target.hasAttribute('data-opf-rich-lines')?JSON.parse(target.dataset.opfRichLines):
      [...target.querySelectorAll('text[data-opf-source-start]')].map(node=>({start:Number(node.dataset.opfSourceStart),end:Number(node.dataset.opfSourceEnd)}));
    return lines.map(line=>{
      const node=[...target.querySelectorAll('[data-opf-caret-map]')].findLast(node=>{
        const map=JSON.parse(node.dataset.opfCaretMap);return map.start>=line.start&&map.end===line.end;
      });
      if(node){
        const map=JSON.parse(node.dataset.opfCaretMap),stop=map.stops.find(stop=>stop.offset===line.end),matrix=node.getScreenCTM();
        const top=new DOMPoint(stop.x,map.top).matrixTransform(matrix),bottom=new DOMPoint(stop.x,map.bottom).matrixTransform(matrix);
        return {...line,x:top.x,y:top.y,height:bottom.y-top.y};
      }
      const fragment=[...target.querySelectorAll('text[data-opf-text-start],tspan[data-opf-text-start]')].findLast(node=>Number(node.dataset.opfTextStart)>=line.start&&Number(node.dataset.opfTextEnd)===line.end);
      if(!fragment?.firstChild)throw Error('Expected an actual visible line-end fragment');
      const range=document.createRange(),length=fragment.textContent.length;
      range.setStart(fragment.firstChild,length-1);range.setEnd(fragment.firstChild,length);
      const box=range.getBoundingClientRect();return {...line,x:box.right,y:box.top,height:box.height};
    });
  });
  assert.ok(lines.length>=3,'Navigation fixture must actually soft wrap across at least three lines');
  for(let index=1;index<lines.length;index++)assert.equal(lines[index].start,lines[index-1].end,'This fixture contains soft wraps only');
  const select=async offset=>{await input.evaluate((node,offset)=>{node.setSelectionRange(offset,offset);node.dispatchEvent(new Event('select'));},offset);await paint();};
  const offset=()=>input.evaluate(node=>node.selectionEnd);
  for(const line of lines.slice(0,2)){
    await select(line.start+1);await input.press('End');await paint();
    assert.equal(await offset(),line.end,'End must stop at the rendered line end');
    const caret=await page.locator('.opf-rich-caret').boundingBox();assert.ok(caret);
    assert.ok(Math.abs(caret.x-line.x)<0.1&&Math.abs(caret.y-line.y)<0.1,'End must paint at this line, not jump to the next line with the same source offset');
    await input.press('Home');assert.equal(await offset(),line.start,'Home must retain the selected visual line');
    await page.mouse.click(line.x-0.2,line.y+line.height/2);await paint();assert.equal(await offset(),line.end);
    await input.press('Home');assert.equal(await offset(),line.start,'Pointer placement must retain the clicked visual line');
  }
  await select(lines[0].start);await input.press('ArrowDown');assert.equal(await offset(),lines[1].start);
  await input.press('ArrowDown');assert.equal(await offset(),lines[2].start);
  await input.press('ArrowUp');assert.equal(await offset(),lines[1].start);
  await input.press('ArrowUp');assert.equal(await offset(),lines[0].start);
  return lines;
}
