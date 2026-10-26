const {chromium,webkit,devices}=require('playwright');
const assert=require('node:assert/strict');
// Construct a minimal uncompressed MOBI6 book with two mbp:pagebreak sections.
// No copyrighted text or external fixture is required.
function mobiFixture(){
 const encoder=new TextEncoder();
 const chapter=n=>'<h1>第'+n+'章</h1>'+Array.from({length:25},(_,i)=>'<p>第'+n+'章第'+(i+1)+'段，连续滚动测试文字。</p>').join('');
 const raw=encoder.encode('<html><head><title>连续阅读测试</title></head><body>'+chapter(1)+'<mbp:pagebreak/>'+chapter(2)+'</body></html>');
 const title=encoder.encode('Continuous MOBI Test');
 const rec0=new Uint8Array(280);
 const h=new DataView(rec0.buffer);
 h.setUint16(0,1);           // no compression
 h.setUint32(4,raw.length);  // text length
 h.setUint16(8,1);           // text record count
 h.setUint16(10,4096);      // record size
 h.setUint16(12,0);         // no DRM
 rec0.set(encoder.encode('MOBI'),16);
 h.setUint32(20,232);       // MOBI header length
 h.setUint32(24,2);         // Mobipocket book
 h.setUint32(28,65001);     // UTF-8
 h.setUint32(32,1234);
 h.setUint32(36,6);         // MOBI6, not KF8
 h.setUint32(84,256);       // full name offset
 h.setUint32(88,title.length);
 h.setUint32(108,0xffffffff); // no resources
 h.setUint32(112,0xffffffff); // no huff
 h.setUint32(244,0xffffffff); // no NCX
 rec0.set(title,256);
 const numRecords=2;
 const headerLen=78+numRecords*8+2;
 const pdb=new Uint8Array(headerLen);
 const pd=new DataView(pdb.buffer);
 pdb.set(encoder.encode('Paper Reader MOBI'),0);
 pdb.set(encoder.encode('BOOKMOBI'),60);
 pd.setUint16(76,numRecords);
 pd.setUint32(78,headerLen);
 pd.setUint32(86,headerLen+rec0.length);
 const out=new Uint8Array(headerLen+rec0.length+raw.length);
 out.set(pdb,0);out.set(rec0,headerLen);out.set(raw,headerLen+rec0.length);
 return Buffer.from(out);
}
(async()=>{
 const type=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await type.launch({headless:true,...(type===chromium?{args:['--no-sandbox']}:{})});
 try{
  const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BASE_URL||'http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  await page.locator('#picker').setInputFiles({
   name:'continuous-fixture.mobi',mimeType:'application/x-mobipocket-ebook',buffer:mobiFixture()
  });
  await page.locator('[data-book]').first().waitFor({timeout:30000});
  await page.locator('[data-book]').first().click();
  const frame=page.locator('#document-body iframe');
  await frame.waitFor({timeout:15000});
  assert.ok((await frame.getAttribute('src')).includes('continuous-reader.html?embed=1'),
   'MOBI should open continuous renderer, not old paginated renderer');
  await page.waitForFunction(()=>{
   const inside=document.querySelector('#document-body iframe')?.contentDocument;
   const chapters=inside?.querySelectorAll('.chapter iframe');
   return chapters?.length>=2&&[...chapters].every(x=>!!x.contentDocument?.body?.textContent?.trim());
  },{timeout:30000});
  const metrics=await frame.evaluate(el=>{
   const root=el.contentDocument.querySelector('#scroll');
   const first=root.querySelector('[data-index="0"]'),second=root.querySelector('[data-index="1"]');
   const relative=Math.abs(first.getBoundingClientRect().bottom-second.getBoundingClientRect().top);
   return {first:first.getBoundingClientRect().height,second:second.getBoundingClientRect().height,
    gap:relative,scrolled:root.scrollHeight>root.clientHeight,src:el.getAttribute('src')};
  });
  assert.ok(metrics.first>100&&metrics.second>100,'both sections need real content');
  assert.ok(metrics.gap<4,'sections should touch in one native vertical scroller');
  assert.ok(metrics.scrolled,'book should scroll naturally without paging');
  await frame.evaluate(el=>{
   const root=el.contentDocument.querySelector('#scroll');
   root.scrollTop=root.querySelector('[data-index="1"]').offsetTop+50;
   root.dispatchEvent(new Event('scroll'));
  });
  await page.waitForFunction(()=>{
   const inside=document.querySelector('#document-body iframe')?.contentDocument;
   return inside?.querySelector('#progress')?.textContent.startsWith('2 /');
  },{timeout:10000}).catch(()=>{}); // Embedded progress badge is hidden but its text updates
  const scroll=await frame.evaluate(el=>{
   const root=el.contentDocument.querySelector('#scroll');
   return {position:root.scrollTop,nextTop:root.querySelector('[data-index="1"]').offsetTop};
  });
  assert.ok(scroll.position>=scroll.nextTop,'native scroll must enter next MOBI chapter');
  if(errors.length)throw Error(errors.join(' | '));
  console.log('PASS '+(process.env.BROWSER||'chromium')+' MOBI continuous chapter rendering');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
