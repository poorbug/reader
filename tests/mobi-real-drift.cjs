const {chromium, devices}=require('playwright');
const assert=require('node:assert/strict');
const MAX_BYTES=30*1024*1024;
const url=process.env.TEST_MOBI_URL;
if(!url)throw Error('TEST_MOBI_URL is required');
(async()=>{
 const res=await fetch(url,{signal:AbortSignal.timeout(50000)});
 assert.ok(res.ok,'Public MOBI file returned HTTP '+res.status);
 const len=Number(res.headers.get('content-length')||0);
 if(len>MAX_BYTES){console.log('SKIP real MOBI (over standalone 30 MiB limit), bytes='+len);return}
 const buffer=Buffer.from(await res.arrayBuffer());
 if(buffer.length>MAX_BYTES){console.log('SKIP real MOBI (over standalone 30 MiB limit), bytes='+buffer.length);return}
 assert.equal(buffer.toString('ascii',60,68),'BOOKMOBI','Unexpected MOBI header');
 console.log('REAL_MOBI_DOWNLOAD bytes='+buffer.length);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto((process.env.BASE_URL||'http://127.0.0.1:8765/')+'continuous-reader.html',{waitUntil:'domcontentloaded'});
  await page.locator('#file').setInputFiles({name:'nehe.mobi',mimeType:'application/x-mobipocket-ebook',buffer});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('多章节连续滚动'),{timeout:70000});
  const result=await page.evaluate(async()=>{
   const root=document.querySelector('#scroll'),chapters=[...root.querySelectorAll('.chapter')];
   const index=chapters.findIndex((c,i)=>i>=1&&c.getAttribute('data-index')&&c.offsetHeight>0);
   const target=chapters[index>=0?index:0];
   const snapshots=[];
   const sample=()=>({
    currentScroll:root.scrollTop,
    firstHeight:chapters[0].offsetHeight,
    targetTop:target.offsetTop,
    targetHeight:target.offsetHeight,
    readyFrames:chapters.filter(c=>c.querySelector('iframe')?.contentDocument?.body).length
   });
   snapshots.push(sample());
   root.scrollTop=Math.max(0,target.offsetTop-70);
   root.dispatchEvent(new Event('scroll'));
   await new Promise(resolve=>setTimeout(resolve,650));
   for(let i=0;i<13;i++){
    snapshots.push(sample());
    await new Promise(resolve=>setTimeout(resolve,160));
   }
   return {sections:chapters.length,index:index>=0?index:0,
    snapshots,viewHeight:root.clientHeight,viewWidth:root.clientWidth};
  });
  const stable=result.snapshots.slice(2),first=stable[0],last=stable.at(-1);
  const topDrift=last.targetTop-first.targetTop;
  const heightDrift=last.targetHeight-first.targetHeight;
  const scrollDrift=last.currentScroll-first.currentScroll;
  console.log('REAL_MOBI_SCROLL_METRICS '+JSON.stringify({
   bytes:buffer.length,sections:result.sections,section:result.index,
   first,last,topDrift,heightDrift,scrollDrift,
   viewport:[result.viewWidth,result.viewHeight]
  }));
  assert.ok(Math.abs(topDrift)<12,'Real MOBI chapter boundary drifts '+topDrift+'px without user input');
  assert.ok(Math.abs(heightDrift)<12,'Real MOBI section height grows '+heightDrift+'px without input');
  assert.ok(Math.abs(scrollDrift)<12,'Real MOBI scrollTop drifts '+scrollDrift+'px without input');
  if(errors.length)throw Error(errors.join(' | '));
  console.log('PASS real public MOBI idle chapter stability');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
