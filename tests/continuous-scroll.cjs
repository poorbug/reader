const { chromium, webkit, devices } = require('playwright');
const JSZip = require('jszip');
const assert = require('node:assert/strict');
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
 const browserType=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await browserType.launch({headless:true,...(browserType===chromium?{args:['--no-sandbox']}:{})});
 try{
  const context=await browser.newContext(devices['iPhone 13']);const page=await context.newPage();
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.goto(process.env.BASE_URL||'http://127.0.0.1:8765/continuous-reader-test.html',{waitUntil:'domcontentloaded'});
  await page.locator('#file').setInputFiles({name:'test.epub',mimeType:'application/epub+zip',buffer:await makeFixture()});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('多章节连续滚动'),{timeout:30000});
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.chapter')).slice(0,3).every(x=>x.querySelector('iframe')?.contentDocument?.body),{timeout:30000});
  const before=await page.locator('#scroll').evaluate(root=>{
   const a=root.querySelector('[data-index="0"]'),b=root.querySelector('[data-index="1"]');
   return {first:a.getBoundingClientRect().bottom,second:b.getBoundingClientRect().top,frameCount:root.querySelectorAll('.chapter iframe').length};
  });
  assert.ok(Math.abs(before.first-before.second)<=3,'adjacent chapters must share one seamless scroll flow');
  assert.ok(before.frameCount>=2,'at least two chapters must be mounted simultaneously');
  await page.locator('#scroll').evaluate(root=>{root.scrollTop=root.querySelector('[data-index="1"]').offsetTop+80;root.dispatchEvent(new Event('scroll'))});
  await page.waitForFunction(()=>document.querySelector('#progress')?.textContent.startsWith('2 /'),{timeout:12000});
  await page.waitForFunction(()=>document.querySelector('[data-index="3"] iframe')?.contentDocument?.body,{timeout:12000});
  const after=await page.locator('#scroll').evaluate(root=>({position:root.scrollTop,second:root.querySelector('[data-index="1"]').offsetTop,thirdMounted:!!root.querySelector('[data-index="3"] iframe')}));
  assert.ok(after.position>=after.second,'native scroll position must reach next chapter without a second gesture');
  assert.ok(after.thirdMounted,'nearby chapters must load automatically');
  // Regression: when an earlier chapter finishes loading/reflows, the currently
  // visible paragraph in the next chapter must stay at the same screen position.
  const initial=await page.locator('#scroll').evaluate(root=>{
   const chapter=root.querySelector('[data-index="1"]');
   return {relativeTop:chapter.getBoundingClientRect().top-root.getBoundingClientRect().top,
    previousHeight:root.querySelector('[data-index="0"]').getBoundingClientRect().height};
  });
  await page.locator('#scroll').evaluate(root=>{
   const doc=root.querySelector('[data-index="0"] iframe').contentDocument;
   const imageLike=doc.createElement('div');imageLike.style.cssText='height:480px;width:100%';
   doc.body.append(imageLike);
  });
  await page.waitForFunction(oldHeight=>
   document.querySelector('[data-index="0"]').getBoundingClientRect().height>oldHeight+350,
   initial.previousHeight,{timeout:12000});
  const stabilized=await page.locator('#scroll').evaluate(root=>{
   const chapter=root.querySelector('[data-index="1"]');
   return chapter.getBoundingClientRect().top-root.getBoundingClientRect().top;
  });
  assert.ok(Math.abs(stabilized-initial.relativeTop)<5,
   'late reflow in a previous chapter must not move the visible text (before='+initial.relativeTop+', after='+stabilized+')');
  if(errors.length)throw Error(errors.join('; '));
  console.log('PASS '+(process.env.BROWSER||'chromium')+' continuous EPUB: adjacent frames, native crossing, windowed preloading');
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
