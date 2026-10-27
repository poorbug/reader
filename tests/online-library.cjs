const {chromium,webkit,devices}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const driver=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await driver.launch({headless:true,...(driver===chromium?{args:['--no-sandbox']}:{})});
 try{
  const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const base=process.env.BASE_URL||'http://127.0.0.1:8765/';
  const name='儿童故事 - 测试.mobi',url='https://reader-ebook.tos-cn-beijing.volces.com/books/'+encodeURIComponent(name);
  const secondName='另一部新书.mobi';
  const secondUrl='https://reader-ebook.tos-cn-beijing.volces.com/books/'+encodeURIComponent(secondName);
  let addSecond=false;
  const entry=(file,href)=>({name:file,title:file.slice(0,-5),format:'mobi',size:128,url:href});
  await page.route('**/catalog/books.json?*',route=>route.fulfill({
   status:200,contentType:'application/json',
   body:JSON.stringify({status:'ok',generatedAt:new Date().toISOString(),
    books:[entry(name,url),...(addSecond?[entry(secondName,secondUrl)]:[])]})
  }));
  const file=Buffer.alloc(128);Buffer.from('BOOKMOBI').copy(file,60);
  await page.route('https://reader-ebook.tos-cn-beijing.volces.com/books/**',route=>route.fulfill({
   status:200,contentType:'application/x-mobipocket-ebook',
   headers:{'access-control-allow-origin':'*'},body:file
  }));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('[data-tab="online"]').click();
  await page.getByText('儿童故事 - 测试',{exact:true}).waitFor({timeout:12000});
  assert.equal(await page.locator('[data-online-import]').count(),1);
  await page.locator('#online-search').fill('不存在的书名');
  assert.equal(await page.locator('[data-online-import]').count(),0,'search filters remote results');
  await page.locator('#online-search').fill('测试');
  await page.getByRole('button',{name:'一键导入'}).click();
  await page.getByRole('button',{name:'已加入书架'}).waitFor({timeout:15000});
  const books=await page.evaluate(()=>new Promise((resolve,reject)=>{
   const q=indexedDB.open('zhijian-reader',1);
   q.onsuccess=()=>{const db=q.result,request=db.transaction('books').objectStore('books').getAll();
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)};
   q.onerror=()=>reject(q.error);
  }));
  assert.equal(books.length,1,'one click should import exactly one local ebook');
  assert.equal(books[0].sourceUrl,url,'the original TOS URL should be retained');
  addSecond=true;
  await page.locator('#online-search').fill('');
  await page.locator('#online-refresh').click();
  await page.getByText('另一部新书',{exact:true}).waitFor({timeout:12000});
  assert.equal(await page.locator('[data-online-import]').count(),2,'new files appear after catalog refresh');
  assert.equal(await page.getByRole('button',{name:'已加入书架'}).count(),1,'previously imported book stays marked');
  if(errors.length)throw Error(errors.join(' | '));
  console.log('PASS '+(process.env.BROWSER||'chromium')+' online TOS catalog and one-click import');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
