const {chromium,webkit,devices}=require('playwright');
const JSZip=require('jszip');
const assert=require('node:assert/strict');
async function epub(title){
 const zip=new JSZip();
 zip.file('mimetype','application/epub+zip',{compression:'STORE'});
 zip.file('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
 zip.file('OEBPS/content.opf','<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>'+title+'</dc:title><dc:creator>Test</dc:creator><dc:identifier id="id">'+title+'</dc:identifier><dc:language>zh</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>');
 zip.file('OEBPS/toc.ncx','<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="test-share"/></head><docTitle><text>Test</text></docTitle><navMap><navPoint id="ch1" playOrder="1"><navLabel><text>第一章</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>');
 zip.file('OEBPS/chapter.xhtml','<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><h1>'+title+'</h1><p>书架分享链接自动导入测试。</p></body></html>');
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

(async()=>{
 const engine=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await engine.launch({headless:true,...(engine===chromium?{args:['--no-sandbox']}:{})});
 try{
  const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__bookShareData=data}});
  });
  const root=process.env.BASE_URL||'http://127.0.0.1:8765/';
  const download='https://books.example.invalid/reader-book.epub?source=unit&lang=zh';
  const share=root+'?import='+encodeURIComponent(download);
  const fixtureBuffer=await epub('分享测试书籍');
  await page.route('https://books.example.invalid/**',route=>route.fulfill({
   status:200,contentType:'application/epub+zip',headers:{'access-control-allow-origin':'*'},
   body:fixtureBuffer
  }));
  await page.goto(share,{waitUntil:'domcontentloaded'});
  await page.getByText('已加入书架，原有书籍和笔记都已保留。',{exact:false}).waitFor({timeout:30000});
  await page.locator('[data-book]').first().click();
  await page.locator('#reader-share-book').waitFor({timeout:30000});
  assert.equal(await page.locator('#reader-share-book').getAttribute('aria-label'),'分享本书');
  await page.locator('#reader').evaluate(el=>el.classList.add('chrome-visible'));
  await page.locator('#reader-share-book').click();
  const nativeShare=await page.evaluate(()=>window.__bookShareData);
  assert.equal(new URL(nativeShare.url).searchParams.get('import'),download,
    'Native share should send exactly this book import address');
  assert.ok(nativeShare.title.includes('分享测试书籍'));
  await page.evaluate(()=>{
   Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
  });
  await page.locator('#reader-share-book').click();
  await page.locator('#reader-share-url').waitFor();
  const copyURL=await page.locator('#reader-share-url').inputValue();
  assert.equal(new URL(copyURL).searchParams.get('import'),download);
  await page.locator('.book-share-close').click();
  await page.evaluate(()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('zhijian-reader',1);
   request.onsuccess=()=>{
    const db=request.result,tx=db.transaction('books','readwrite');
    const books=tx.objectStore('books'),q=books.getAll();
    q.onsuccess=()=>{for(const item of q.result){delete item.sourceUrl;books.put(item)}};
    tx.oncomplete=()=>{db.close();resolve()};
    tx.onerror=()=>reject(tx.error);
   };
   request.onerror=()=>reject(request.error);
  }));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-book]').first().click();
  await page.locator('#reader').evaluate(el=>el.classList.add('chrome-visible'));
  await page.locator('#reader-share-book').click();
  await page.getByText('此书没有公开 HTTPS 下载地址',{exact:false}).waitFor({timeout:5000});
  assert.equal(await page.locator('#reader-book-share-dialog').count(),0);
  if(errors.length)throw Error('Unexpected browser errors: '+errors.join(' | '));
  console.log('PASS '+(process.env.BROWSER||'chromium')+' book toolbar native share, fallback URL and local book handling');
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
