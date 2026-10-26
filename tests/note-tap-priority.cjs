const { chromium, webkit, devices }=require('playwright');
const JSZip=require('jszip');
const assert=require('node:assert/strict');
async function makeFixture(){
 const zip=new JSZip();zip.file('mimetype','application/epub+zip',{compression:'STORE'});
 zip.file('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
 const manifest=Array.from({length:6},(_,i)=>'<item id="s'+i+'" href="c'+i+'.xhtml" media-type="application/xhtml+xml"/>').join('');
 const spine=Array.from({length:6},(_,i)=>'<itemref idref="s'+i+'"/>').join('');
 zip.file('OEBPS/content.opf','<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Continuous EPUB Fixture</dc:title><dc:creator>Test</dc:creator><dc:identifier id="uid">continuous-fixture</dc:identifier><dc:language>zh</dc:language></metadata><manifest>'+manifest+'<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx">'+spine+'</spine></package>');
 const entries=Array.from({length:6},(_,i)=>'<navPoint id="n'+i+'" playOrder="'+(i+1)+'"><navLabel><text>第'+(i+1)+'章</text></navLabel><content src="c'+i+'.xhtml"/></navPoint>').join('');
 zip.file('OEBPS/toc.ncx','<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="continuous-fixture"/></head><docTitle><text>Continuous EPUB</text></docTitle><navMap>'+entries+'</navMap></ncx>');
 for(let i=0;i<6;i++){
  const paragraphs=Array.from({length:22},(_,j)=>'<p>章节 '+(i+1)+' 测试段落 '+(j+1)+'。这是可连续滚动的正文。</p>').join('');
  zip.file('OEBPS/c'+i+'.xhtml','<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>章节 '+(i+1)+'</title></head><body><h1>第'+(i+1)+'章</h1>'+paragraphs+'</body></html>');
 }
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

(async()=>{
 const engine=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await engine.launch({headless:true,...(engine===chromium?{args:['--no-sandbox']}:{})});
 try{
  const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
  const page=await context.newPage(),origin=process.env.BASE_URL||'http://127.0.0.1:8765/';
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#picker').setInputFiles({name:'note-hit.epub',mimeType:'application/epub+zip',buffer:await makeFixture()});
  await page.locator('[data-book]').first().waitFor({timeout:30000});
  await page.locator('[data-book]').first().click();
  await page.waitForFunction(()=>{
   const inner=document.querySelector('#document-body iframe')?.contentDocument;
   return !!inner?.querySelector('.chapter iframe')?.contentDocument?.querySelector('p');
  },{timeout:30000});
  const injected=await page.evaluate(async()=>{
   const iframe=document.querySelector('#document-body iframe');
   const doc=iframe.contentDocument.querySelector('.chapter iframe').contentDocument;
   const p=doc.querySelector('p'),text=p.firstChild;
   const range=doc.createRange();range.setStart(text,0);range.setEnd(text,Math.min(text.length,10));
   const cfiModule=await import('./vendor/foliate-js/epubcfi.js');
   const readerModule=await import('./vendor/foliate-js/view.js');
   const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('zhijian-reader',1);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
   });
   const files=await new Promise((resolve,reject)=>{
    const req=db.transaction('files').objectStore('files').getAll();
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
   });
   const file=files[0],book=await readerModule.makeBook(new File([file.blob],file.name||'note-hit.epub'));
   const cfi=cfiModule.joinIndir(book.sections[0].cfi,cfiModule.fromRange(range));
   const bookId=file.id;
   await new Promise((resolve,reject)=>{
    const tx=db.transaction('highlights','readwrite');
    tx.objectStore('highlights').put({id:'tap-priority-note',bookId,text:range.toString(),note:'标注优先',cfi,createdAt:new Date().toISOString()});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
   });
   book.destroy?.();db.close();
   return {bookId,cfi};
  });
  assert.ok(injected.cfi.startsWith('epubcfi('),'The fixture annotation needs a valid CFI');
  await page.locator('#reader-back').evaluate(button=>button.click());
  await page.locator('[data-book]').first().waitFor({timeout:30000});
  await page.locator('[data-book]').first().click();
  await page.waitForFunction(()=>{
   const doc=document.querySelector('#document-body iframe')?.contentDocument?.querySelector('.chapter iframe')?.contentDocument;
   return (doc?.__zhijianNoteHitRects||[]).some(rect=>rect.noteId==='tap-priority-note');
  },{timeout:30000});
  const tap=await page.evaluate(()=>{
   const frame=document.querySelector('#document-body iframe');
   const inside=frame.contentDocument.querySelector('.chapter iframe');
   const r=inside.contentDocument.__zhijianNoteHitRects.find(x=>x.noteId==='tap-priority-note');
   const a=frame.getBoundingClientRect(),b=inside.getBoundingClientRect();
   return {x:a.left+b.left+(r.left+r.right)/2,y:a.top+b.top+(r.top+r.bottom)/2};
  });
  await page.touchscreen.tap(tap.x,tap.y);
  await page.locator('#inline-note-actions').waitFor({timeout:10000});
  assert.equal(await page.locator('#inline-note-header').count(),0,'No heading text should be shown');
  assert.equal(await page.locator('#inline-note-actions .inline-note-header strong').count(),0,'Remove this text highlight/notes heading');
  const del=page.locator('#inline-note-actions [data-action="delete"]');
  assert.equal(await del.getAttribute('aria-label'),'删除划线','Trash icon must have an accessible name');
  assert.equal(await del.locator('svg').count(),1,'Delete must be an icon');
  assert.equal((await del.innerText()).trim(),'','Delete should not show text label');

  await page.waitForTimeout(360);
  assert.equal(await page.locator('#reader').evaluate(el=>el.classList.contains('chrome-visible')),false,
   'Tapping an annotation must not display the reading toolbar');
  await page.evaluate(()=>window.postMessage({type:'READER_TAP'},location.origin));
  await page.waitForTimeout(360);
  assert.equal(await page.locator('#inline-note-actions').count(),1,
   'A delayed ordinary tap must not close the inline note panel');
  assert.equal(await page.locator('#reader').evaluate(el=>el.classList.contains('chrome-visible')),false);
  if(errors.length)throw Error('Browser errors: '+errors.join(' | '));
  console.log('PASS '+(process.env.BROWSER||'chromium')+' annotation tap opens note actions ahead of toolbar');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
