const {chromium,webkit,devices}=require('playwright');
const assert=require('node:assert/strict');

// Minimal, unencrypted two-chapter MOBI fixture. No external book downloads.
function mobiFixture(){
 const encoder=new TextEncoder();
 const chapter=n=>'<h1>第'+n+'章</h1>'+Array.from({length:28},(_,i)=>
  '<p>第'+n+'章第'+(i+1)+'段，手机息屏恢复位置测试。</p>').join('');
 const raw=encoder.encode('<html><head><title>阅读进度恢复</title></head><body>'+chapter(1)+'<mbp:pagebreak/>'+chapter(2)+'</body></html>');
 const title=encoder.encode('Mobile Resume Fixture'),rec0=new Uint8Array(280),h=new DataView(rec0.buffer);
 h.setUint16(0,1);h.setUint32(4,raw.length);h.setUint16(8,1);h.setUint16(10,4096);h.setUint16(12,0);
 rec0.set(encoder.encode('MOBI'),16);
 h.setUint32(20,232);h.setUint32(24,2);h.setUint32(28,65001);
 h.setUint32(32,1234);h.setUint32(36,6);h.setUint32(84,256);
 h.setUint32(88,title.length);h.setUint32(108,0xffffffff);h.setUint32(112,0xffffffff);
 h.setUint32(244,0xffffffff);rec0.set(title,256);
 const headerLen=78+2*8+2,pdb=new Uint8Array(headerLen),pd=new DataView(pdb.buffer);
 pdb.set(encoder.encode('Mobile Resume MOBI'),0);pdb.set(encoder.encode('BOOKMOBI'),60);
 pd.setUint16(76,2);pd.setUint32(78,headerLen);pd.setUint32(86,headerLen+rec0.length);
 const output=new Uint8Array(headerLen+rec0.length+raw.length);
 output.set(pdb);output.set(rec0,headerLen);output.set(raw,headerLen+rec0.length);
 return Buffer.from(output);
}
async function getReadingState(page){
 return page.evaluate(()=>{
  const frame=document.querySelector('#document-body iframe');
  const doc=frame?.contentDocument,scroll=doc?.querySelector('#scroll');
  if(!scroll)return null;
  const second=scroll.querySelector('[data-index="1"]');
  const session=JSON.parse(localStorage.getItem('zhijian-reader-open-book')||'null');
  const checkpoint=session&&JSON.parse(localStorage.getItem('zhijian-reader-position:'+session.bookId)||'null');
  return {session,checkpoint,scrollTop:scroll.scrollTop,secondTop:second?.offsetTop,
   secondHeight:second?.offsetHeight,viewport:scroll.clientHeight,
   ready:doc.querySelector('#reader-loading')?.hidden,progress:doc.querySelector('#progress')?.textContent};
 });
}
(async()=>{
 const browserType=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await browserType.launch({headless:true,...(browserType===chromium?{args:['--no-sandbox']}:{})});
 try{
  const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const root=process.env.BASE_URL||'http://127.0.0.1:8765/';
  await page.goto(root,{waitUntil:'domcontentloaded'});
  await page.locator('[data-tab="all"]').waitFor({timeout:15000});
  // Seed the storage directly: this regression tests recovery, not the
  // unrelated file-picker/MOBI import implementation on iOS WebKit.
  await page.evaluate(async(encoded)=>{
   const data=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));
   const database=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('zhijian-reader',1);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
   });
   const id='resume-test-book',date=new Date().toISOString();
   await new Promise((resolve,reject)=>{
    const tx=database.transaction(['books','files'],'readwrite');
    const fail=event=>{
     const reason=event?.target?.error||tx.error;
     reject(Error('Fixture IndexedDB transaction '+(reason?.name||'unknown')+': '+(reason?.message||'no details')));
    };
    tx.onabort=fail;tx.onerror=fail;
    tx.objectStore('books').put({
     id,hash:'resume-test-hash',title:'手机恢复测试',author:'',format:'mobi',cover:null,
     sourceUrl:null,status:'reading',percent:0,createdAt:date,lastRead:date
    }).onerror=fail;
    tx.objectStore('files').put({
     id,name:'mobile-resume.mobi',blob:new Blob([data],{type:'application/x-mobipocket-ebook'})
    }).onerror=fail;
    tx.oncomplete=resolve;
   });
   database.close();
  },mobiFixture().toString('base64'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-book]').first().waitFor({timeout:15000});
  await page.locator('[data-book]').first().click();
  await page.waitForFunction(()=>{
   const doc=document.querySelector('#document-body iframe')?.contentDocument;
   return doc?.querySelector('#reader-loading')?.hidden&&
    !!doc?.querySelector('[data-index="1"] iframe')?.contentDocument?.body;
  },{timeout:30000});
  // Let the asynchronously mounted preceding section settle before measuring.
  await page.waitForTimeout(500);
  const targetFraction=.42;
  await page.evaluate(fraction=>{
   const root=document.querySelector('#document-body iframe').contentDocument.querySelector('#scroll');
   const second=root.querySelector('[data-index="1"]');
   root.scrollTop=second.offsetTop+Math.round(Math.max(1,second.offsetHeight-root.clientHeight)*fraction);
   root.dispatchEvent(new Event('scroll'));
  },targetFraction);
  await page.waitForFunction(fraction=>{
   const doc=document.querySelector('#document-body iframe')?.contentDocument,root=doc?.querySelector('#scroll');
   if(!root)return false;
   const section=root.querySelector('[data-index="1"]');
   const value=(root.scrollTop-section.offsetTop)/Math.max(1,section.offsetHeight-root.clientHeight);
   return Math.abs(value-fraction)<.09;
  },targetFraction,{timeout:6000});
  // Simulate sudden backgrounding before the delayed IndexedDB save runs.
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  const before=await getReadingState(page);
  assert.ok(before.checkpoint,'pagehide must write synchronous local checkpoint');
  assert.equal(before.checkpoint.sectionIndex,1,'checkpoint must contain the active chapter');
  assert.ok(Math.abs(before.checkpoint.sectionFraction-targetFraction)<.11,
   'checkpoint should capture the position within the chapter: '+JSON.stringify(before));
  assert.ok(before.session?.bookId,'the currently open book must be remembered');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
   const frame=document.querySelector('#document-body iframe'),doc=frame?.contentDocument;
   return doc?.querySelector('#reader-loading')?.hidden&&
    doc.querySelector('[data-index="1"] iframe')?.contentDocument?.body;
  },{timeout:30000});
  const after=await getReadingState(page);
  assert.ok(after.ready,'app must automatically reopen the previous book');
  assert.equal(after.checkpoint.sectionIndex,1,'restarted reader should retain the chapter');
  const restoredFraction=(after.scrollTop-after.secondTop)/Math.max(1,after.secondHeight-after.viewport);
  assert.ok(Math.abs(restoredFraction-targetFraction)<.12,
   'restore should return to the saved paragraph (fraction='+restoredFraction+') '+JSON.stringify(after));
  await page.locator('#reader-back').evaluate(button=>button.click());
  await page.locator('[data-book]').first().waitFor({timeout:15000});
  assert.equal(await page.evaluate(()=>localStorage.getItem('zhijian-reader-open-book')),null,
   'explicitly leaving the reader must cancel automatic reopen');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-book]').first().waitFor({timeout:15000});
  assert.equal(await page.locator('#document-body iframe').count(),0,
   'reader should remain on shelf after manual exit');
  if(errors.length)throw Error(errors.join(' | '));
  console.log('PASS '+(process.env.BROWSER||'chromium')+' mobile pagehide checkpoint, process reload, resume, and manual exit');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
