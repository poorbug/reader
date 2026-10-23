const { chromium, webkit, devices } = require('playwright');
const JSZip = require('jszip');
const assert = require('node:assert/strict');

async function fixture(){
 const z=new JSZip();
 z.file('mimetype','application/epub+zip',{compression:'STORE'});
 z.file('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
 z.file('OEBPS/content.opf','<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB Tap Smoke Test</dc:title><dc:creator>Test</dc:creator><dc:identifier id="id">test-epub-tap</dc:identifier><dc:language>zh</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>');
 z.file('OEBPS/toc.ncx','<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="test-epub-tap"/></head><docTitle><text>Test</text></docTitle><navMap><navPoint id="ch1" playOrder="1"><navLabel><text>第一章</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>');
 z.file('OEBPS/chapter.xhtml','<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><h1>第一章</h1><p id="tap-target">点击这里应该打开顶栏和底栏，这是测试正文。</p><p>可以上下滑动阅读测试文本。</p></body></html>');
 return z.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
(async()=>{
 const engine=process.env.BROWSER==='webkit'?webkit:chromium;
 const browser=await engine.launch({headless:true,...(engine===chromium?{args:['--no-sandbox']}:{})});
 const context=await browser.newContext({...devices['iPhone 13'],browserName:undefined});
 const page=await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.BASE_URL||'http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
 await page.locator('#picker').setInputFiles({name:'smoke.epub',mimeType:'application/epub+zip',buffer:await fixture()});
 await page.locator('[data-book]').first().waitFor({timeout:30000});
 await page.locator('[data-book]').first().click();
 await page.locator('#viewer iframe').first().waitFor({timeout:30000});
 const chapter=page.frameLocator('#viewer iframe').first();
 await chapter.locator('#tap-target').waitFor({timeout:30000});
 assert.equal(await page.locator('#reader').evaluate(el=>el.classList.contains('chrome-visible')),false);
 await chapter.locator('#tap-target').tap();
 await page.waitForTimeout(500);
 const visible=await page.locator('#reader').evaluate(el=>el.classList.contains('chrome-visible'));
 assert.equal(visible,true,'EPUB text tap must reveal reader chrome');
 assert.equal(await page.locator('#reader-toolbar').isVisible(),true);
 await chapter.locator('#tap-target').tap();await page.waitForTimeout(500);
 assert.equal(await page.locator('#reader').evaluate(el=>el.classList.contains('chrome-visible')),false,'second tap should hide chrome');
 if(errors.length)console.log('Browser errors:',errors.join('\n'));
 console.log('PASS: '+(process.env.BROWSER||'chromium')+' EPUB tap shows and hides top and bottom bars');
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
