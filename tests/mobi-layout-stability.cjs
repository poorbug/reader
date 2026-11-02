const { chromium, webkit, devices } = require('playwright');
const assert = require('node:assert/strict');

// A short MOBI section is shorter than the viewport, followed by a long section.
// This catches iframe-height feedback: body.scrollHeight is often at least
// the iframe viewport height, and using it to grow that viewport can drift forever.
function shortMobiFixture() {
 const encoder = new TextEncoder();
 const chapter = (number, count) => '<h1>第' + number + '章</h1>' +
  Array.from({length:count}, (_,i) => '<p>第'+number+'章第'+(i+1)+'段。测量章节滚动高度。</p>').join('');
 const raw = encoder.encode(
  '<html><head><title>连续阅读短章节回归</title></head><body>'+
  chapter(1,1)+'<mbp:pagebreak/>'+chapter(2,30)+'<mbp:pagebreak/>'+chapter(3,2)+
  '</body></html>');
 if(raw.length>4096)throw Error('Fixture exceeds one MOBI text record: '+raw.length);
 const rec0=new Uint8Array(280),header=new DataView(rec0.buffer);
 header.setUint16(0,1);header.setUint32(4,raw.length);
 header.setUint16(8,1);header.setUint16(10,4096);header.setUint16(12,0);
 rec0.set(encoder.encode('MOBI'),16);header.setUint32(20,232);
 header.setUint32(24,2);header.setUint32(28,65001);header.setUint32(32,1234);
 header.setUint32(36,6);header.setUint32(84,256);
 const name=encoder.encode('Short MOBI Fixture');header.setUint32(88,name.length);
 header.setUint32(108,0xffffffff);header.setUint32(112,0xffffffff);
 header.setUint32(244,0xffffffff);rec0.set(name,256);
 const recordOffset=78+2*8+2,pdb=new Uint8Array(recordOffset),p=new DataView(pdb.buffer);
 pdb.set(encoder.encode('Short MOBI Fixture'),0);
 pdb.set(encoder.encode('BOOKMOBI'),60);
 p.setUint16(76,2);p.setUint32(78,recordOffset);
 p.setUint32(86,recordOffset+rec0.length);
 const result=new Uint8Array(recordOffset+rec0.length+raw.length);
 result.set(pdb);result.set(rec0,recordOffset);result.set(raw,recordOffset+rec0.length);
 return Buffer.from(result);
}
async function sampleStability(page) {
 return page.evaluate(async () => {
  const root=document.querySelector('#scroll');
  const first=root.querySelector('[data-index="0"]');
  const second=root.querySelector('[data-index="1"]');
  const snap=()=>{
   const doc=first.querySelector('iframe')?.contentDocument,body=doc?.body;
   return {
    time:performance.now(),height:first.offsetHeight,secondTop:second.offsetTop,
    bodyHeight:body?.getBoundingClientRect().height,
    bodyScrollHeight:body?.scrollHeight,iframeHeight:first.querySelector('iframe')?.offsetHeight,
    scrollTop:root.scrollTop
   };
  };
  root.scrollTop=Math.max(0,Math.min(root.scrollHeight-root.clientHeight,second.offsetTop-60));
  root.dispatchEvent(new Event('scroll'));
  const samples=[];
  for(let i=0;i<14;i++){samples.push(snap());await new Promise(resolve=>setTimeout(resolve,125))}
  const doc=first.querySelector('iframe')?.contentDocument,body=doc?.body;
  const bodyRect=body?.getBoundingClientRect();
  const diagnostic={
   htmlHeight:doc?.documentElement?.getBoundingClientRect().height,
   bodyHeight:bodyRect?.height,
   bodyScrollHeight:body?.scrollHeight,
   bodyStyle:body&&{height:getComputedStyle(body).height,minHeight:getComputedStyle(body).minHeight,
    display:getComputedStyle(body).display,overflow:getComputedStyle(body).overflow},
   children:[...(body?.children||[])].slice(0,12).map(el=>({
    tag:el.tagName,className:String(el.className||'').slice(0,80),
    top:Math.round(el.getBoundingClientRect().top-(bodyRect?.top||0)),
    bottom:Math.round(el.getBoundingClientRect().bottom-(bodyRect?.top||0)),
    height:Math.round(el.getBoundingClientRect().height),
    computedHeight:getComputedStyle(el).height
   }))
  };
  return {samples,viewport:root.clientHeight,secondHeight:second.offsetHeight,firstContent:body?.textContent?.slice(0,90),diagnostic};
 });
}
(async()=>{
 const kind=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await kind.launch({headless:true,...(kind===chromium?{args:['--no-sandbox']}:{})});
 try {
  const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const base=process.env.BASE_URL||'http://127.0.0.1:8765/';
  await page.goto(base+'continuous-reader.html',{waitUntil:'domcontentloaded'});
  await page.locator('#file').setInputFiles({
   name:'short-chapters.mobi',mimeType:'application/x-mobipocket-ebook',
   buffer:shortMobiFixture()
  });
  await page.waitForFunction(()=>{
   const root=document.querySelector('#scroll');
   return document.querySelector('#status')?.textContent?.includes('多章节连续滚动')&&
     !!root?.querySelector('[data-index="0"] iframe')?.contentDocument?.body&&
     !!root?.querySelector('[data-index="1"] iframe')?.contentDocument?.body;
  },{timeout:30000});
  const result=await sampleStability(page);
  const {samples}=result,first=samples[0],last=samples.at(-1);
  console.log('SHORT_CHAPTER_METRICS '+JSON.stringify(result));
  assert.ok(last.height<result.viewport*.8,
   'Short chapter should use actual content bounds, not the iframe viewport: '+last.height);
  assert.ok(result.secondHeight>result.viewport,
   'Long next chapter should not be clipped by intrinsic sizing');
  const delta=last.height-first.height;
  assert.ok(delta<6,'A short chapter grows by '+delta+'px without user input (iframe feedback loop)');
  const sectionShift=last.secondTop-first.secondTop;
  assert.ok(Math.abs(sectionShift)<6,'Chapter boundary moves by '+sectionShift+'px while idle');
  const scrollShift=last.scrollTop-first.scrollTop;
  assert.ok(Math.abs(scrollShift)<6,'Scroll position drifts by '+scrollShift+'px while idle');
  if(errors.length)throw Error(errors.join(' | '));
  console.log('PASS '+(process.env.BROWSER||'chromium')+' short MOBI chapter is stable with no touch');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
