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
async function dbRead(page,store){
 return page.evaluate(name=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('zhijian-reader',1);
  request.onsuccess=()=>{
   const database=request.result,tx=database.transaction(name,'readonly');
   const operation=tx.objectStore(name).getAll();
   operation.onsuccess=()=>{resolve(operation.result);database.close()};
   operation.onerror=()=>reject(operation.error);
  };
  request.onerror=()=>reject(request.error);
 }),store);
}
(async()=>{
 const driver=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await driver.launch({headless:true,...(driver===chromium?{args:['--no-sandbox']}:{})});
 try{
  const ctx=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
  const page=await ctx.newPage(),origin=process.env.BASE_URL||'http://127.0.0.1:8765/';
  const fixtureA=await epub('原有书籍'),fixtureB=await epub('分享新书');
  const source='https://books.example.invalid/new-book.epub';
  const sameContentDifferentURL='https://books.example.invalid/copy.epub';
  await page.route('https://books.example.invalid/**',route=>route.fulfill({
   status:200,contentType:'application/epub+zip',
   headers:{'access-control-allow-origin':'*'},
   body:fixtureB
  }));
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#picker').setInputFiles({name:'old-book.epub',mimeType:'application/epub+zip',buffer:fixtureA});
  await page.locator('[data-book]').first().waitFor({timeout:30000});
  assert.equal((await dbRead(page,'books')).length,1);
  const original=(await dbRead(page,'books'))[0];
  await page.evaluate(id=>new Promise((resolve,reject)=>{
   const req=indexedDB.open('zhijian-reader',1);
   req.onsuccess=()=>{
    const db=req.result,tx=db.transaction(['progress','highlights'],'readwrite');
    tx.objectStore('progress').put({bookId:id,cfi:'epubcfi(/6/2)',percent:0.43});
    tx.objectStore('highlights').put({id:'existing-note',bookId:id,text:'此前保留的划线',note:'已有笔记'});
    tx.oncomplete=()=>{db.close();resolve()};
    tx.onerror=()=>reject(tx.error);
   };
   req.onerror=()=>reject(req.error);
  }),original.id);
  const share=url=>origin+'?import='+encodeURIComponent(url);
  await page.goto(share(source),{waitUntil:'domcontentloaded'});
  await page.getByText('已加入书架，原有书籍和笔记都已保留。',{exact:false}).waitFor({timeout:30000});
  assert.equal((await dbRead(page,'books')).length,2,'shared book must append to existing shelf');
  assert.equal((await dbRead(page,'progress'))[0]?.percent,0.43,'existing reading progress must remain');
  assert.equal((await dbRead(page,'highlights'))[0]?.text,'此前保留的划线','existing notes must remain');
  assert.equal(new URL(page.url()).searchParams.has('import'),false,'successful import should clear query');
  await page.goto(share(source),{waitUntil:'domcontentloaded'});
  await page.getByText('没有重复添加。',{exact:false}).waitFor({timeout:30000});
  assert.equal((await dbRead(page,'books')).length,2,'repeat share should not duplicate');
  await page.goto(share(sameContentDifferentURL),{waitUntil:'domcontentloaded'});
  await page.getByText('没有重复添加。',{exact:false}).waitFor({timeout:30000});
  assert.equal((await dbRead(page,'books')).length,2,'identical file from another URL must deduplicate by SHA-256');
  console.log('PASS '+(process.env.BROWSER||'chromium')+' shared books append to shelf without duplicates');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
