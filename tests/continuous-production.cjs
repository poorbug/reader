const {chromium,webkit,devices}=require('playwright');
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
 const driver=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await driver.launch({headless:true,...(driver===chromium?{args:['--no-sandbox']}:{})});
 try{
  const page=await browser.newPage(devices['iPhone 13']);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.goto(process.env.BASE_URL||'http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  await page.locator('#picker').setInputFiles({name:'continuous.epub',mimeType:'application/epub+zip',buffer:await makeFixture()});
  await page.locator('[data-book]').first().waitFor({timeout:30000});
  await page.locator('[data-book]').first().click();
  const child=page.frameLocator('#document-body iframe');
  await child.locator('#scroll .chapter iframe').first().waitFor({timeout:30000});
  await page.waitForFunction(()=>{
   const child=document.querySelector('#document-body iframe')?.contentDocument;
   return !!child?.querySelector('[data-index="1"] iframe')?.contentDocument?.body;
  },{timeout:30000});
  const spans=await child.locator('#scroll').evaluate(root=>{
   const first=root.querySelector('[data-index="0"]').getBoundingClientRect();
   const second=root.querySelector('[data-index="1"]').getBoundingClientRect();
   return {difference:Math.abs(first.bottom-second.top),frames:root.querySelectorAll('.chapter iframe').length};
  });
  assert.ok(spans.difference<4,'Adjacent chapters should touch without a manual flip');
  assert.ok(spans.frames>=2,'Nearby chapters should both be mounted');
  await child.frameLocator('.chapter iframe').first().locator('h1').tap();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#reader').evaluate(el=>el.classList.contains('chrome-visible')),true,
   'Tap inside new continuous EPUB should show top and bottom chrome');
  await child.locator('#scroll').evaluate(root=>{
   root.scrollTop=root.querySelector('[data-index="1"]').offsetTop+80;
   root.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(950);
  assert.equal(await child.locator('#progress').isVisible(),false,'Embedded reader hides test-only progress badge');
  if(errors.length)throw Error('Browser errors: '+errors.join(' | '));
  console.log('PASS '+(process.env.BROWSER||'chromium')+' production EPUB seamless scroll + toolbar bridge');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
