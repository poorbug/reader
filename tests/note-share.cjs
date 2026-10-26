const {chromium,webkit,devices}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
 const engine=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await engine.launch({headless:true,...(engine===chromium?{args:['--no-sandbox']}:{})});
 try{
  const page=await browser.newPage(devices['iPhone 13']);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BASE_URL||'http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('[data-nav="notes"]'));
  await page.evaluate(()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('zhijian-reader',1);
   request.onsuccess=()=>{
    const db=request.result,tx=db.transaction(['books','highlights'],'readwrite');
    tx.objectStore('books').put({id:'share-fixture',title:'二千年间',author:'胡绳',status:'reading',format:'epub',sourceUrl:'https://cdn.example.com/books/%E8%AE%B7%E6%B2%B3%E5%BE%80%E4%BA%8B.mobi?download=1&source=reader',createdAt:'2026-10-26T00:00:00Z'});
    tx.objectStore('highlights').put({id:'note-1',bookId:'share-fixture',text:'文化上也发展得',note:'测试一下书摘',createdAt:'2026-10-26T00:00:00Z'});
    tx.objectStore('highlights').put({id:'note-2',bookId:'share-fixture',text:'文化在时代的长河中不断流转',note:'',createdAt:'2026-10-26T00:01:00Z'});
    tx.oncomplete=()=>{db.close();resolve()};
    tx.onerror=()=>reject(tx.error);
   };
   request.onerror=()=>reject(request.error);
  }));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-nav="notes"]').click();
  await page.locator('[data-note-book="share-fixture"]').click();
  const buttons=page.locator('[data-note-act="share"]');
  assert.equal(await buttons.count(),2,'Both excerpts and annotated notes should be shareable');
  await page.evaluate(()=>{
   const Base=window.QRCode;
   if(!Base)throw Error('QR component unavailable');
   function Spy(host,settings){window.__noteQRDestination=settings.text;return new Base(host,settings)}
   Spy.CorrectLevel=Base.CorrectLevel;
   window.QRCode=Spy;
  });
  await buttons.last().click();
  const preview=page.locator('.note-share-preview img');
  await page.waitForFunction(()=>document.querySelector('.note-share-preview img')?.naturalWidth>0,{timeout:20000});
  assert.equal(await page.locator('.note-share-close').isVisible(),true,'Share preview should be open');
  assert.equal(await page.locator('[data-note-share="save"]').isEnabled(),true,'PNG download should become available');
  const sharedAddress=await page.evaluate(()=>window.__noteQRDestination);
  const encoded=new URL(sharedAddress);
  assert.equal(encoded.searchParams.get('import'),'https://cdn.example.com/books/%E8%AE%B7%E6%B2%B3%E5%BE%80%E4%BA%8B.mobi?download=1&source=reader','QR must import this particular book');
  assert.equal(encoded.pathname,new URL(process.env.BASE_URL||'http://127.0.0.1:8765/').pathname,'QR points to the same reader site');

  const info=await preview.evaluate(async img=>{
   const data=await(await fetch(img.src)).arrayBuffer();
   const view=new DataView(data);
   return {width:view.getUint32(16),height:view.getUint32(20),
     signature:Array.from(new Uint8Array(data,0,8))};
  });
  assert.deepEqual(info.signature,[137,80,78,71,13,10,26,10],'Export must be a PNG');
  assert.equal(info.width,750);
  assert.ok(info.height>=1000);
  // The PNG includes the note and quote; scan a small preview region for non-background pixels.
  const pixels=await preview.evaluate(async img=>{
   const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
   const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
   let changes=0;
   for(let y=130;y<Math.min(600,canvas.height);y+=7){
    for(let x=70;x<690;x+=7){
     const rgb=ctx.getImageData(x,y,1,1).data;
     if(rgb[0]>150&&rgb[1]>120&&rgb[2]>65)changes++;
    }
   }
   return changes;
  });
  assert.ok(pixels>30,'Quote card must contain rendered text');
  await page.locator('.note-share-close').click();
  await buttons.first().click();
  await page.waitForFunction(()=>document.querySelector('.note-share-preview img')?.naturalWidth>0,{timeout:20000});
  assert.equal(await page.locator('[data-note-share="save"]').isEnabled(),true,'Excerpt without personal note should also export');
  // Existing local-only books have no retrievable download source: never show a
  // QR to the home page that pretends it can import that ebook.
  await page.locator('.note-share-close').click();
  await page.evaluate(()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('zhijian-reader',1);
   request.onsuccess=()=>{
    const db=request.result,tx=db.transaction('books','readwrite'),store=tx.objectStore('books');
    const entry=store.get('share-fixture');
    entry.onsuccess=()=>{const value=entry.result;delete value.sourceUrl;store.put(value)};
    tx.oncomplete=()=>{db.close();resolve()};
    tx.onerror=()=>reject(tx.error);
   };request.onerror=()=>reject(request.error);
  }));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-nav="notes"]').click();
  await page.locator('[data-note-book="share-fixture"]').click();
  await page.evaluate(()=>{
   const Base=window.QRCode;
   function Spy(host,settings){window.__noteQRDestination=settings.text;return new Base(host,settings)}
   Spy.CorrectLevel=Base.CorrectLevel;
   window.QRCode=Spy;
   window.__noteQRDestination=null;
  });
  await page.locator('[data-note-act="share"]').first().click();
  await page.waitForFunction(()=>document.querySelector('.note-share-preview img')?.naturalWidth>0,{timeout:20000});
  assert.equal(await page.locator('.note-share-source-missing').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.__noteQRDestination),null,'No QR should be drawn for local-only books');

  if(errors.length)throw Error('Unexpected browser errors: '+errors.join(' | '));
  console.log('PASS '+(process.env.BROWSER||'chromium')+' note-card PNG preview, offline QR and quote-only mode');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});