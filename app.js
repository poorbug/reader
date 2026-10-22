'use strict';
const APP_VERSION='1.0.25';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app=$('#app');let db,books=[],tab='all',view='shelf',active=null,epub=null,rendition=null,toc=[],selection=null,selectionController=null,settings={size:18,theme:'paper',lineHeight:1.8,margin:18,paragraph:0.8,brightness:100};
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const rq=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const st=(name,mode='readonly')=>db.transaction(name,mode).objectStore(name);
const put=(name,v)=>rq(st(name,'readwrite').put(v)),get=(name,k)=>rq(st(name).get(k)),all=name=>rq(st(name).getAll()),del=(name,k)=>rq(st(name,'readwrite').delete(k));
function openDb(){return new Promise((res,rej)=>{let q=indexedDB.open('zhijian-reader',1);q.onupgradeneeded=()=>{let d=q.result;d.createObjectStore('books',{keyPath:'id'});d.createObjectStore('files',{keyPath:'id'});d.createObjectStore('progress',{keyPath:'bookId'});d.createObjectStore('highlights',{keyPath:'id'});d.createObjectStore('bookmarks',{keyPath:'id'})};q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
function saveSettings(){try{localStorage.setItem('zhijian-reading-settings',JSON.stringify(settings))}catch{}}
try{settings={...settings,...JSON.parse(localStorage.getItem('zhijian-reading-settings')||'{}')}}catch{}
function toast(s){$('.toast')?.remove();let e=document.createElement('div');e.className='toast';e.textContent=s;document.body.append(e);setTimeout(()=>e.remove(),3500)}
async function refresh(){if(!active)syncPageTheme(null);books=(await all('books')).sort((a,b)=>String(b.lastRead||b.createdAt).localeCompare(String(a.lastRead||a.createdAt)));render()}
function shell(body){app.innerHTML='<main class="app"><header class="top"><div><div class="eyebrow">MY READING SPACE</div><h1>'+({shelf:'我的书架',notes:'阅读笔记',settings:'设置'}[view])+'</h1></div>'+(view==='shelf'?'<button class="btn" id="add">＋ 导入</button>':'')+'</header>'+body+'</main><nav class="bottom">'+[['shelf','▤','书架'],['notes','✎','笔记'],['settings','⚙','设置']].map(x=>'<button class="nav '+(view===x[0]?'active':'')+'" data-nav="'+x[0]+'"><span>'+x[1]+'</span>'+x[2]+'</button>').join('')+'</nav><input type="file" accept=".epub,.pdf,.mobi,application/epub+zip,application/pdf,application/x-mobipocket-ebook" multiple hidden id="picker">';
document.querySelectorAll('[data-nav]').forEach(e=>e.onclick=()=>{view=e.dataset.nav;render()});$('#add')?.addEventListener('click',showImportOptions);$('#picker').onchange=e=>importFiles(e.target.files)}
function render(){if(active)return;if(view==='shelf'){const filtered=books.filter(b=>tab==='all'||b.status===tab);shell('<p class="muted">'+books.length+' 本书 · 所有书籍仅保存于当前设备</p><div class="tabs">'+[['all','全部'],['reading','在读'],['finished','已读'],['archived','归档']].map(x=>'<button class="tab '+(tab===x[0]?'active':'')+'" data-tab="'+x[0]+'">'+x[1]+'</button>').join('')+'</div>'+(filtered.length?'<section class="books">'+filtered.map(b=>'<article class="book" data-book="'+b.id+'"><div class="cover">'+(b.cover?'<img alt="" src="'+b.cover+'">':esc(b.title))+'</div><div class="book-title">'+esc(b.title)+'</div><div class="book-author">'+esc(b.author||'未知作者')+'</div><div class="progress"><div style="width:'+Math.round((b.percent||0)*100)+'%"></div></div><div class="actions"><button class="btn ghost small" data-manage="'+b.id+'">管理</button></div></article>').join('')+'</section>':'<div class="empty"><div class="big">▤</div><h2>你的书架还是空的</h2><p>导入 EPUB 开始阅读</p><button class="btn" id="empty-add">导入电子书</button></div>'));document.querySelectorAll('[data-tab]').forEach(e=>e.onclick=()=>{tab=e.dataset.tab;render()});document.querySelectorAll('[data-book]').forEach(e=>e.onclick=ev=>{if(!ev.target.closest('button'))openReader(e.dataset.book)});document.querySelectorAll('[data-manage]').forEach(e=>e.onclick=()=>manage(e.dataset.manage));$('#empty-add')?.addEventListener('click',showImportOptions)}else if(view==='notes')notesPage();else{shell('<div class="card"><h2>本地书库与备份</h2><p class="muted">电子书、进度、笔记保存在 IndexedDB；清理网站数据可能丢失，请定期备份。</p><button class="btn" id="export">导出完整备份</button> <button class="btn ghost" id="import-backup">恢复备份</button><input type="file" accept=".json" hidden id="backup-picker"></div><div class="card update-card"><h2>应用更新</h2><p class="muted">当前运行版本：<strong>v'+APP_VERSION+'</strong></p><p id="update-status" class="muted" role="status" aria-live="polite">点击按钮检查 GitHub Pages 上的最新版本。</p><div class="update-actions"><button class="btn" id="check-update">检查更新</button><button class="btn ghost" id="refresh-update" hidden>刷新并使用新版</button></div><p class="muted">仅更新阅读器程序，不会主动删除本地书籍和笔记。</p></div><div class="card"><h2>关于纸间</h2><p><strong>当前版本：v'+APP_VERSION+'</strong></p><p>无需账号 · 无服务器上传 · 可离线阅读</p><p class="muted">首次打开请保持联网，待应用资源缓存后再断网测试。</p></div>');$('#export').onclick=backup;$('#import-backup').onclick=()=>$('#backup-picker').click();$('#backup-picker').onchange=e=>restore(e.target.files[0]);$('#check-update').onclick=checkForAppUpdates;$('#refresh-update').onclick=()=>window.location.reload();paintUpdateStatus()}}
const updateState={checking:false,ready:false,remoteVersion:null,message:'点击检查更新，从 GitHub Pages 获取最新版本。'};
function paintUpdateStatus(){
 const msg=$('#update-status'),check=$('#check-update'),reload=$('#refresh-update');
 if(!msg||!check||!reload)return;
 msg.textContent=updateState.message;
 check.disabled=updateState.checking;
 check.textContent=updateState.checking?'检查中…':'检查更新';
 reload.hidden=!updateState.ready;
 if(updateState.ready)reload.textContent='刷新并使用 v'+updateState.remoteVersion;
}
function newerVersion(remote,local){
 const a=String(remote).split('.').map(Number),b=String(local).split('.').map(Number);
 if(a.some(x=>!Number.isFinite(x))||b.some(x=>!Number.isFinite(x)))return remote!==local;
 for(let i=0;i<Math.max(a.length,b.length);i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0)}
 return false;
}
function workerReleaseVersion(worker){
 if(!worker||typeof MessageChannel==='undefined')return Promise.resolve(null);
 return new Promise(resolve=>{
  let finished=false;const channel=new MessageChannel();
  const done=value=>{if(finished)return;finished=true;channel.port1.close();resolve(value)};
  const timer=setTimeout(()=>done(null),650);
  channel.port1.onmessage=e=>{clearTimeout(timer);done(e.data?.version||null)};
  try{worker.postMessage({type:'ZHJ_GET_VERSION'},[channel.port2])}catch{clearTimeout(timer);done(null)}
 });
}
async function waitForPreparedRelease(reg,expected){
 for(let i=0;i<14;i++){
  const version=await workerReleaseVersion(reg.active);
  if(version===expected)return true;
  await new Promise(resolve=>setTimeout(resolve,650));
 }
 return false;
}
async function checkForAppUpdates(){
 if(updateState.checking)return;
 updateState.checking=true;updateState.ready=false;updateState.message='正在检查 GitHub Pages 上的最新版本…';paintUpdateStatus();
 try{
  if(!navigator.onLine)throw Error('当前没有网络连接，请联网后重试。');
  const res=await fetch('./version.json?check='+Date.now(),{cache:'no-store'});
  if(!res.ok)throw Error('无法获取版本信息（HTTP '+res.status+'）。');
  const info=await res.json();const latest=String(info.version||'').trim();
  if(!/^\d+\.\d+\.\d+$/.test(latest))throw Error('远程版本信息格式不正确。');
  updateState.remoteVersion=latest;
  if(!newerVersion(latest,APP_VERSION)){
   updateState.message=latest===APP_VERSION?'当前已是最新版本（v'+APP_VERSION+'）。':'当前运行 v'+APP_VERSION+'，服务器发布 v'+latest+'，暂无更新。';
   return;
  }
  if(!('serviceWorker' in navigator))throw Error('此浏览器不支持自动更新，请使用 Safari 刷新网站。');
  updateState.message='发现新版本 v'+latest+'，正在下载并准备离线资源…';paintUpdateStatus();
  let reg=await navigator.serviceWorker.getRegistration('./');
  if(!reg)reg=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
  await reg.update();
  if(await waitForPreparedRelease(reg,latest)){
   updateState.ready=true;
   updateState.message='新版本 v'+latest+' 已准备好。点击下方按钮刷新后生效。';
  }else{
   updateState.message='检测到 v'+latest+'，但新版本尚未准备完成。请稍后再次检查更新。';
  }
 }catch(err){
  updateState.message='检查更新失败：'+(err?.message||'网络或缓存异常')+' 原有阅读数据不受影响。';
 }finally{updateState.checking=false;paintUpdateStatus()}
}
function showImportOptions(){
  document.querySelector('#import-dialog')?.remove();
  let overlay=document.createElement('div');overlay.id='import-dialog';overlay.className='import-overlay';
  overlay.innerHTML='<div class="import-modal" role="dialog" aria-modal="true" aria-label="导入电子书"><div class="top"><h2>导入电子书</h2><button class="icon-btn" id="import-close" aria-label="关闭">×</button></div><button class="btn" id="import-local">从本地文件导入</button><div class="muted">或通过可直接下载 EPUB、PDF 或 MOBI 的 HTTPS 链接导入</div><label for="epub-url">电子书下载地址</label><input type="url" id="epub-url" placeholder="https://example.com/book.pdf" autocomplete="url" inputmode="url"><div class="muted">链接必须公开可访问并允许跨域读取（CORS）；普通书籍介绍页不能直接导入。</div><button class="btn" id="import-url">下载并导入</button><p id="import-status" class="muted" aria-live="polite"></p></div>';
  document.body.append(overlay);
  overlay.onclick=e=>{if(e.target===overlay)overlay.remove()};
  overlay.querySelector('#import-close').onclick=()=>overlay.remove();
  overlay.querySelector('#import-local').onclick=()=>{overlay.remove();$('#picker').click()};
  overlay.querySelector('#import-url').onclick=async()=>{let input=overlay.querySelector('#epub-url'),button=overlay.querySelector('#import-url'),status=overlay.querySelector('#import-status');button.disabled=true;status.textContent='正在下载…';try{await importUrl(input.value.trim(),status);overlay.remove()}catch(e){status.textContent=e.message;button.disabled=false}};
}
async function importUrl(value,status){
  let url;try{url=new URL(value)}catch{throw Error('请输入完整的 HTTPS 下载地址')}
  if(url.protocol!=='https:')throw Error('仅支持 HTTPS 链接');
  if(url.username||url.password)throw Error('链接中不能包含账号或密码');
  // GitHub's /blob/ URL serves an HTML viewer. Convert it to a download URL.
  if(url.hostname==='github.com'){
    const match=url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if(match){
      const [,owner,repoName,branch,path]=match;
      if(owner.toLowerCase()==='poorbug'&&repoName.toLowerCase()==='reader'&&branch==='main'){
        url=new URL('https://poorbug.github.io/reader/'+path);
      }else{
        url=new URL('https://raw.githubusercontent.com/'+owner+'/'+repoName+'/'+branch+'/'+path);
      }
    }else{
      throw Error('请使用 GitHub 文件的 blob 地址或直接下载地址');
    }
  }

  
  let response;try{response=await fetch(url.href,{mode:'cors',credentials:'omit',redirect:'follow'})}catch{throw Error('无法下载：请检查地址、网络及网站是否允许跨域访问（CORS）')}
  if(!response.ok)throw Error('下载失败，HTTP '+response.status);
  const max=30*1024*1024,len=Number(response.headers.get('content-length')||0);
  if(len>max)throw Error('文件超过 30MB 上限');
  let blob;try{
    if(response.body&&response.body.getReader){let reader=response.body.getReader(),chunks=[],total=0;while(true){let {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();throw Error('文件超过 30MB 上限')}chunks.push(value);status.textContent='已下载 '+(total/1048576).toFixed(1)+' MB'}blob=new Blob(chunks)}
    else{blob=await response.blob();if(blob.size>max)throw Error('文件超过 30MB 上限')}
  }catch(e){throw Error('下载中断：'+e.message)}
  let head=new Uint8Array(await blob.slice(0,4).arrayBuffer());
  let isZip=head[0]===0x50&&head[1]===0x4b,isPDF=head[0]===0x25&&head[1]===0x50&&head[2]===0x44&&head[3]===0x46;if(!isZip&&!isPDF&&blob.size<80)throw Error('无法识别下载文件格式');
  let title;try{title=decodeURIComponent(url.pathname.split('/').pop()||'online-book')}catch{title='online-book'}title=title.replace(/[\\/:*?"<>|]/g,'_');
  if(!/\.(epub|pdf|mobi)$/i.test(title))title+='.'+(isPDF?'pdf':isZip?'epub':'mobi');
  status.textContent='正在解析和保存到本机…';
  await importFiles([new File([blob],title,{type:blob.type||'application/octet-stream'})]);
}
async function digest(buf){let a=new Uint8Array(await crypto.subtle.digest('SHA-256',buf));return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function importFiles(files){for(const f of files){try{if(!/\.(epub|pdf|mobi)$/i.test(f.name)){toast('当前支持 EPUB、PDF、MOBI');continue}toast('正在导入 '+f.name);let buf=await f.arrayBuffer(),hash=await digest(buf);if(books.some(x=>x.hash===hash)){toast('这本书已经导入');continue}let format=f.name.split('.').pop().toLowerCase(),m={title:f.name.replace(/\.(epub|pdf|mobi)$/i,''),creator:''},cover=null,instance=null;if(format==='epub'){if(typeof ePub==='undefined')throw Error('EPUB 引擎未加载');instance=ePub(buf);await instance.ready;m=await instance.loaded.metadata;try{let url=await instance.coverUrl();if(url){let b=await(await fetch(url)).blob();if(b.size<2000000)cover=await new Promise(r=>{let fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(b)})}}catch{}}else if(format==='pdf'){const h=new TextDecoder().decode(buf.slice(0,5));if(h!=='%PDF-')throw Error('不是有效的 PDF 文件')}else if(format==='mobi'){let bytes=new Uint8Array(buf);if(new TextDecoder().decode(bytes.slice(60,68))!=='BOOKMOBI')throw Error('不是标准 MOBI 文件或文件已加密')}let k=id(),book={id:k,hash,title:m.title||f.name.replace(/\.epub$/i,''),author:m.creator||'',format,cover,status:'reading',percent:0,createdAt:now(),lastRead:now()};await put('files',{id:k,blob:new Blob([buf],{type:f.type||({epub:'application/epub+zip',pdf:'application/pdf',mobi:'application/x-mobipocket-ebook'}[format])}),name:f.name});await put('books',book);instance?.destroy();toast('导入成功：'+book.title)}catch(e){console.error(e);toast('导入失败：'+e.message)}}await refresh()}
async function manage(k){let b=books.find(x=>x.id===k);let n=prompt('《'+b.title+'》\n输入 1 在读，2 已读，3 归档，4 删除','1');if(n==='4'){if(!confirm('删除电子书及关联划线与笔记？'))return;for(let x of ['books','files','progress'])await del(x,k);for(let x of await all('highlights'))if(x.bookId===k)await del('highlights',x.id);for(let x of await all('bookmarks'))if(x.bookId===k)await del('bookmarks',x.id)}else if(['1','2','3'].includes(n)){b.status=({1:'reading',2:'finished',3:'archived'})[n];await put('books',b)}await refresh()}
const palette={paper:['#f6f0e5','#333b34'],white:['#fff','#252525'],green:['#e6eee6','#294034'],dark:['#26292b','#eee']};
async function openReader(k,target){const b=books.find(x=>x.id===k),f=await get('files',k);if(!b||!f)return toast('电子书文件不存在');if((b.format||'epub')!=='epub')return openDocumentReader(b,f,target);if(typeof ePub==='undefined')return toast('EPUB 引擎未加载');active=b;app.innerHTML=readerShell(b.title,'<div id="viewer" style="width:100%;height:100%"></div>');setupReaderChrome(closeReader,'epub');try{epub=ePub(await f.blob.arrayBuffer());await epub.ready;toc=(await epub.loaded.navigation).toc||[];rendition=epub.renderTo('viewer',{width:'100%',height:'100%',flow:'scrolled',manager:'continuous',spread:'none',allowScriptedContent:false});applyTheme();rendition.on('relocated',async loc=>{if(!active)return;let percent=0;try{if(epub.locations.length())percent=epub.locations.percentageFromCfi(loc.start.cfi)||0}catch{}active.percent=percent;active.lastRead=now();await put('progress',{bookId:active.id,cfi:loc.start.cfi,percent,updatedAt:now()});await put('books',active)});rendition.on('rendered',(_section,contents)=>{try{contents.document.documentElement.style.touchAction='pan-y';contents.document.body.style.touchAction='pan-y';contents.document.documentElement.style.webkitTouchCallout='none';contents.document.body.style.webkitTouchCallout='none';contents.document.body.style.webkitUserSelect='none';const ctrl=window.ZhijianSelection?.install(contents.document,{onChange:result=>{if(!active||active.format==='mobi')return;if(!result){if(selectionController===ctrl){selection=null;$('.selected-action')?.remove()}return}selectionController=ctrl;let cfi=null;try{cfi=contents.cfiFromRange(result.range)}catch(e){console.warn('CFI conversion failed',e)}selection={text:result.text,cfi,kind:'epub'};toggleReaderChrome(false);selectionMenu()}});contents.document.addEventListener('contextmenu',e=>e.preventDefault(),{capture:true});contents.document.addEventListener('scroll',()=>toggleReaderChrome(false),{passive:true});contents.document.addEventListener('touchmove',()=>toggleReaderChrome(false),{passive:true});contents.document.addEventListener('click',()=>{if(!contents.window.getSelection()?.toString())toggleReaderChrome()})}catch{}});let saved=await get('progress',k);await rendition.display(target||saved?.cfi||undefined);epub.locations.generate(1024).catch(console.warn);await showHighlights()}catch(e){console.error(e);toast('打开失败：'+e.message)}}
function applyTheme(){if(!rendition)return;let [bg,fg]=palette[settings.theme];$('#reader').style.background=bg;$('#reader').style.color=fg;rendition.themes.default({body:{color:fg+' !important',background:bg+' !important','line-height':settings.lineHeight+' !important','padding-left':settings.margin+'px !important','padding-right':settings.margin+'px !important'},p:{'margin-bottom':settings.paragraph+'em !important'},h1:{'font-size':'clamp(22px, '+(settings.size*1.4)+'px, 40px) !important','line-height':'1.5 !important','overflow-wrap':'anywhere'},h2:{'font-size':Math.round(settings.size*1.2)+'px !important','line-height':'1.5 !important'},h3:{'font-size':Math.round(settings.size*1.1)+'px !important','line-height':'1.5 !important'}});rendition.themes.fontSize(settings.size+'px')}
function removePop(){$('.panel')?.remove();$('.read-tools')?.remove()}
function showTools(){removePop();let p=document.createElement('div');p.className='read-tools';p.innerHTML='<div class="row">行距 <input type="range" min="1.3" max="2.5" step="0.1" value="'+settings.lineHeight+'" id="lineheight"></div><div class="row">字号 <input type="range" min="14" max="30" value="'+settings.size+'" id="fontsize"> <span id="size">'+settings.size+'</span></div><div class="row">'+Object.entries({paper:'纸张',white:'白色',green:'护眼',dark:'深色'}).map(([k,v])=>'<button class="btn ghost small" data-theme="'+k+'">'+v+'</button>').join('')+'</div><button class="btn ghost small" id="addmark">添加书签</button> ';$('#reader').append(p);$('#fontsize').oninput=e=>{settings.size=+e.target.value;$('#size').textContent=settings.size;applyTheme();saveSettings()};p.querySelectorAll('[data-theme]').forEach(x=>x.onclick=()=>{settings.theme=x.dataset.theme;applyTheme();saveSettings()});$('#lineheight').oninput=e=>{settings.lineHeight=+e.target.value;applyTheme();saveSettings()};$('#addmark').onclick=async()=>{let cfi=rendition.currentLocation()?.start?.cfi;if(cfi){await put('bookmarks',{id:id(),bookId:active.id,cfi,createdAt:now()});toast('书签已保存')}}}
function showToc(){const p=$('#reading-settings');if(!p)return;if(!p.hidden&&p.dataset.kind==='toc'){closeReaderPanels();return}openReaderPanel('toc');p.innerHTML='<div class="setting-title">目录</div><div id="toc-entries" class="toc-entries">正在读取目录…</div>';if(active?.format==='epub'){const entries=$('#toc-entries');entries.innerHTML=toc.map((x,i)=>'<button class="toc-item" data-index="'+i+'">'+esc(x.label)+'</button>').join('')||'此书没有目录';entries.querySelectorAll('[data-index]').forEach(btn=>btn.onclick=async()=>{await rendition.display(toc[Number(btn.dataset.index)].href);closeReaderPanels()})}else if(active?.format==='mobi'){$('#document-body iframe')?.contentWindow?.postMessage({type:'MOBI_REQUEST_TOC'},location.origin)}else $('#toc-entries').textContent='PDF 暂不支持目录'}
function postMobiNoteChange(type,note){
 if(active?.format!=='mobi')return;
 $('#document-body iframe')?.contentWindow?.postMessage({type,note:note?{id:note.id,cfi:note.cfi||null,text:note.text||'',note:note.note||''}:null},location.origin);
}
function closeInlineNoteActions(){$('#inline-note-actions')?.remove()}
async function openInlineNoteActions(noteId){
 if(!active||!noteId)return;
 const bookId=active.id;
 let note;try{note=await get('highlights',noteId)}catch(e){console.error(e);return}
 if(!note||note.bookId!==bookId||active?.id!==bookId)return;
 closeInlineNoteActions();clearSelection();closeReaderPanels();toggleReaderChrome(false);
 const card=document.createElement('div');card.id='inline-note-actions';card.className='inline-note-actions';card.setAttribute('role','dialog');card.setAttribute('aria-label','笔记操作');
 card.innerHTML='<div class="inline-note-header"><strong>这段文字的笔记</strong><button type="button" class="inline-note-dismiss" aria-label="关闭">×</button></div><blockquote class="inline-note-excerpt">'+esc(note.text||'')+'</blockquote><div class="inline-note-content">'+esc(note.note||'（暂无笔记内容）')+'</div><div class="inline-note-buttons"><button type="button" data-action="edit">编辑笔记</button><button type="button" data-action="delete">删除笔记</button></div>';
 $('#reader')?.append(card);
 card.querySelector('.inline-note-dismiss').onclick=closeInlineNoteActions;
 card.querySelector('[data-action="edit"]').onclick=async()=>{
  const value=prompt('编辑笔记：',note.note||'');if(value===null)return;
  const latest=await get('highlights',noteId);if(!latest||latest.bookId!==active?.id)return;
  latest.note=value;latest.updatedAt=now();
  try{await put('highlights',latest);await syncNoteMark(latest);await openInlineNoteActions(latest.id);if($('#reading-settings')?.dataset.kind==='notes')await renderBookNotes(bookId);toast('笔记已更新')}
  catch(e){console.error(e);toast('保存失败')}
 };
 card.querySelector('[data-action="delete"]').onclick=async()=>{
  if(!confirm('确定删除这条笔记及对应划线？'))return;
  const latest=await get('highlights',noteId);if(!latest||latest.bookId!==active?.id)return;
  try{await del('highlights',noteId);await removeNoteMark(latest);closeInlineNoteActions();if($('#reading-settings')?.dataset.kind==='notes')await renderBookNotes(bookId);toast('笔记已删除')}
  catch(e){console.error(e);toast('删除失败')}
 };
}
async function syncNoteMark(note){
 if(!active||active.id!==note.bookId)return;
 if((active.format||'epub')==='epub')updateEpubNoteMark(note);
 else if(active.format==='mobi')postMobiNoteChange('MOBI_NOTE_UPSERT',note);
}
async function removeNoteMark(note){
 if(!active||active.id!==note.bookId)return;
 if((active.format||'epub')==='epub'&&rendition&&note.cfi){
  try{rendition.annotations.remove(note.cfi,note.note?.trim()?'underline':'highlight')}catch(e){console.warn(e)}
 }else if(active.format==='mobi')postMobiNoteChange('MOBI_NOTE_REMOVE',note);
}
async function showBookNotes(){
 const p=$('#reading-settings'),bookId=active?.id;
 if(!p||!bookId)return;
 if(!p.hidden&&p.dataset.kind==='notes'){closeReaderPanels();return}
 openReaderPanel('notes');
 p.innerHTML='<div class="setting-title">本书的划线与笔记</div><p class="muted">正在读取本地记录…</p>';
 await renderBookNotes(bookId);
}
async function renderBookNotes(bookId){
 const p=$('#reading-settings');
 if(!p||p.hidden||p.dataset.kind!=='notes'||active?.id!==bookId)return;
 let notes;
 try{notes=(await all('highlights')).filter(h=>h.bookId===bookId).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))}
 catch(e){p.innerHTML='<div class="setting-title">本书的划线与笔记</div><p>读取失败，请稍后重试。</p>';console.error(e);return}
 if(p.hidden||p.dataset.kind!=='notes'||active?.id!==bookId)return;
 const scroll=p.scrollTop;
 p.innerHTML='<div class="setting-title">本书的划线与笔记</div><p class="book-note-count">'+notes.length+' 条记录，保存在当前设备</p><div class="book-note-list">'+(notes.length?notes.map(h=>{
  const located=!!h.cfi&&['epub','mobi'].includes(active.format||'epub');
  const date=h.createdAt?new Date(h.createdAt).toLocaleDateString('zh-CN'):'';
  return '<article class="book-note-card" data-note-id="'+esc(h.id)+'"><div class="book-note-meta"><span>'+(h.note?'笔记':'划线')+'</span><time>'+esc(date)+'</time></div><blockquote class="book-note-quote">'+esc(h.text||'（未保存文字）')+'</blockquote>'+(h.note?'<div class="book-note-comment">'+esc(h.note)+'</div>':'')+'<div class="book-note-actions">'+(located?'<button class="book-note-action" data-act="jump">回到原文</button>':'<span class="book-note-unlocated">暂不支持定位</span>')+'<button class="book-note-action" data-act="edit">编辑</button><button class="book-note-action" data-act="delete">删除</button></div></article>';
 }).join(''):'<div class="book-note-empty">还没有划线或笔记。<br>在正文中长按选中文字，即可添加。</div>')+'</div>';
 p.scrollTop=scroll;
 p.querySelectorAll('[data-note-id]').forEach(card=>{
  card.querySelectorAll('[data-act]').forEach(button=>button.onclick=async()=>{
   const noteId=card.dataset.noteId,action=button.dataset.act;
   const current=await get('highlights',noteId);
   if(!current||current.bookId!==active?.id){toast('记录不存在');return}
   if(action==='jump'){
    if(!current.cfi){toast('这条记录暂不支持跳转');return}
    try{if(active.format==='mobi')$('#document-body iframe')?.contentWindow?.postMessage({type:'MOBI_GOTO_CFI',cfi:current.cfi},location.origin);else await rendition.display(current.cfi);closeReaderPanels();toggleReaderChrome(false)}
    catch(e){console.error(e);toast('无法定位原文')}
   }else if(action==='edit'){
    const value=prompt('编辑这条摘录的笔记：',current.note||'');
    if(value===null)return;
    current.note=value;current.updatedAt=now();
    try{await put('highlights',current);await syncNoteMark(current);await renderBookNotes(bookId)}catch(e){console.error(e);toast('保存失败')}
   }else if(action==='delete'){
    if(!confirm('确定删除这条划线和笔记？'))return;
    try{
     await del('highlights',current.id);
     await removeNoteMark(current);
     await renderBookNotes(bookId);toast('已删除')
    }catch(e){console.error(e);toast('删除失败')}
   }
  });
 });
}
function selectionMenu(){
 $('.selected-action')?.remove();if(!selection?.text)return;
 const el=document.createElement('div');el.className='selected-action';
 el.setAttribute('role','toolbar');el.setAttribute('aria-label','文字选中操作');
 el.innerHTML='<button id="highlight">划线</button><button id="note">笔记</button><button id="copy">复制</button><button id="cancel">取消</button>';
 $('#reader')?.append(el);
 el.querySelector('#highlight').onclick=()=>saveHighlight(false);
 el.querySelector('#note').onclick=()=>saveHighlight(true);
 el.querySelector('#copy').onclick=async()=>{
  try{await navigator.clipboard.writeText(selection.text);toast('已复制')}catch{toast('复制失败，请检查剪贴板权限')}
  clearSelection();
 };
 el.querySelector('#cancel').onclick=clearSelection;
}
function clearSelection(){
 $('.selected-action')?.remove();selection=null;
 const ctrl=selectionController;selectionController=null;ctrl?.clear();
 if(active?.format==='mobi')$('#document-body iframe')?.contentWindow?.postMessage({type:'ZHJ_CLEAR_SELECTION'},location.origin);
}
async function saveHighlight(withNote){
 if(!selection||!active)return;
 const data={...selection},bookId=active.id;
 let note='';
 if(withNote){let value=prompt('写下你对这段文字的想法：','');if(value===null)return;note=value}
 if(data.kind==='mobi'){
  const highlight={id:id(),bookId,text:data.text,note,cfi:data.cfi||null,source:'mobi-selection',createdAt:now()};
  await put('highlights',highlight);
  if(note.trim())postMobiNoteChange('MOBI_NOTE_UPSERT',highlight);
  toast('已保存'+(withNote?'笔记':'摘录')+(highlight.cfi?'':'（暂未获取原文位置）'));
 }else{
  if(!data.cfi){toast('选区定位失败，请重新选择');return}
  const highlight={id:id(),bookId,text:data.text,note,cfi:data.cfi,createdAt:now()};
  await put('highlights',highlight);
  updateEpubNoteMark(highlight);
  toast('已保存'+(withNote?'笔记':'划线'));
 }
 clearSelection();
}
function updateEpubNoteMark(h,oldNote){
 if(!rendition||!h?.cfi||active?.id!==h.bookId)return;
 try{
  rendition.annotations.remove(h.cfi,'underline');
  rendition.annotations.remove(h.cfi,'highlight');
  if(typeof h.note==='string'&&h.note.trim()){
   rendition.annotations.underline(h.cfi,{noteId:h.id},event=>{event?.stopPropagation?.();openInlineNoteActions(h.id)},'zhijian-note-underline',{'stroke':'#5a9d8b','stroke-width':'2.5','stroke-opacity':'0.95'});
  }else{
   rendition.annotations.highlight(h.cfi,{noteId:h.id},()=>{},'my-highlight',{fill:'#eac45a','fill-opacity':'0.35'});
  }
 }catch(e){console.warn('Could not render note annotation',e)}
}
async function showHighlights(){
 if(!active||!rendition)return;
 const bookId=active.id;
 for(const h of (await all('highlights')).filter(x=>x.bookId===bookId&&x.cfi)){
  if(active?.id!==bookId)return;
  updateEpubNoteMark(h);
 }
}


function readerShell(title,content){return '<section class="reader immersive-reader" id="reader"><div class="reader-body reader-full">'+content+'</div><header class="reader-top reading-chrome" id="reader-top"><button class="icon-btn" id="reader-back" aria-label="返回"><svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" focusable="false"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span class="title">'+esc(title)+'</span><span style="width:38px"></span></header><footer class="reading-chrome reader-toolbar" id="reader-toolbar"><button id="reader-toc" aria-label="目录">☰<small>目录</small></button><button id="reader-notes" aria-label="查看本书划线和笔记">✎<small>笔记</small></button><button disabled aria-label="进度稍后开放">◉<small>进度</small></button><button id="reader-colors" aria-label="颜色和亮度">☼<small>颜色</small></button><button id="reader-fonts" aria-label="字体和排版">A<small>字体</small></button></footer><div class="reading-dimmer" id="reading-dimmer"></div><div class="reading-settings" id="reading-settings" hidden></div></section>'}
function closeReaderPanels(){const p=$('#reading-settings');if(p){p.hidden=true;p.dataset.kind=''}for(const k of ['toc','notes','colors','fonts'])$('#reader-'+k)?.classList.remove('selected')}
function openReaderPanel(kind){const p=$('#reading-settings');if(!p)return;p.hidden=false;p.dataset.kind=kind;for(const k of ['toc','notes','colors','fonts'])$('#reader-'+k)?.classList.toggle('selected',k===kind)}
function toggleReaderChrome(show){if(show!==false&&$('#inline-note-actions')){closeInlineNoteActions();return}const r=$('#reader');if(!r)return;const visible=show===undefined?!r.classList.contains('chrome-visible'):show;r.classList.toggle('chrome-visible',visible);if(!visible)closeReaderPanels()}
function readerSettings(kind){const p=$('#reading-settings');if(!p)return;if(!p.hidden&&p.dataset.kind===kind){closeReaderPanels();return}openReaderPanel(kind);const colors=kind==='colors';p.innerHTML=colors?'<div class="setting-title">亮度与背景</div><label>亮度 <input id="reader-brightness" type="range" min="45" max="100" value="'+(settings.brightness??100)+'"></label><div class="theme-options">'+Object.entries({paper:'纸张',white:'白色',green:'护眼',dark:'夜间'}).map(([k,v])=>'<button class="theme-option '+(settings.theme===k?'selected':'')+'" aria-pressed="'+(settings.theme===k)+'" data-theme="'+k+'">'+v+'</button>').join('')+'</div>':'<div class="setting-title">字体与排版</div><label>字号 <input id="reader-size" type="range" min="14" max="32" value="'+settings.size+'"></label><label>行距 <input id="reader-lines" type="range" min="1.3" max="2.5" step="0.1" value="'+settings.lineHeight+'"></label><label>左右边距 <span id="margin-value">'+(settings.margin??18)+'px</span><input id="reader-margin" type="range" min="8" max="48" step="1" value="'+(settings.margin??18)+'"></label><label>段落间距 <input id="reader-paragraph" type="range" min="0" max="2" step="0.1" value="'+(settings.paragraph??0.8)+'"></label>';
p.hidden=false;
const changed=()=>{saveSettings();updateReaderAppearance();if(active?.format==='mobi')$('#document-body iframe')?.contentWindow?.postMessage({type:'MOBI_SET_PREFS',prefs:settings},location.origin)};
p.querySelectorAll('[data-theme]').forEach(x=>x.onclick=()=>{settings.theme=x.dataset.theme;p.querySelectorAll('[data-theme]').forEach(y=>{y.classList.toggle('selected',y===x);y.setAttribute('aria-pressed',String(y===x))});changed()});
for(const [key,prop] of [['reader-brightness','brightness'],['reader-size','size'],['reader-lines','lineHeight'],['reader-margin','margin'],['reader-paragraph','paragraph']]){const input=p.querySelector('#'+key);if(input)input.oninput=()=>{settings[prop]=Number(input.value);if(prop==='margin')p.querySelector('#margin-value').textContent=input.value+'px';changed()}}
}
function syncPageTheme(theme){
 const color=theme==='dark'?'#26292b':theme==='green'?'#e6eee6':theme==='white'?'#ffffff':'#f6f0e5';
 const bg=theme?color:'#f8f6f0';
 document.documentElement.style.backgroundColor=bg;
 document.body.style.backgroundColor=bg;
 document.documentElement.style.colorScheme=theme==='dark'?'dark':'light';
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',bg);
}
function updateReaderAppearance(){const r=$('#reader');if(!r)return;const [bg,fg]=palette[settings.theme]||palette.paper;r.style.background=bg;r.style.color=fg;r.style.setProperty('--reader-bg',bg);r.style.setProperty('--reader-fg',fg);r.dataset.theme=settings.theme;syncPageTheme(settings.theme);const d=$('#reading-dimmer');if(d)d.style.opacity=String((100-(settings.brightness||100))/100);if(active?.format==='epub')applyTheme()}
function setupReaderChrome(onBack,format){$('#reader-back').onclick=onBack;$('#reader-toc').onclick=showToc;$('#reader-notes').onclick=showBookNotes;$('#reader-colors').onclick=()=>readerSettings('colors');$('#reader-fonts').onclick=()=>readerSettings('fonts');updateReaderAppearance();const surface=$('#reader .reader-full');let y=0,x=0;surface?.addEventListener('touchstart',e=>{if(e.touches.length===1){y=e.touches[0].clientY;x=e.touches[0].clientX}},{passive:true});surface?.addEventListener('touchmove',e=>{if(e.touches.length===1&&(Math.abs(e.touches[0].clientY-y)>12||Math.abs(e.touches[0].clientX-x)>12))toggleReaderChrome(false)},{passive:true});surface?.addEventListener('wheel',()=>toggleReaderChrome(false),{passive:true})}
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='READER_TAP'&&!$('#inline-note-actions'))toggleReaderChrome();if(e.origin===location.origin&&e.data?.type==='READER_SCROLL')toggleReaderChrome(false)});
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.data?.type!=='MOBI_TOC_ENTRIES'||!active||active.format!=='mobi')return;const p=$('#reading-settings');if(p?.hidden||p.dataset.kind!=='toc')return;const entries=$('#toc-entries');if(!entries)return;const arr=Array.isArray(e.data.entries)?e.data.entries:[];entries.innerHTML=arr.length?arr.map((x,i)=>'<button class="toc-item" data-index="'+i+'">'+esc(x.label)+'</button>').join(''):'此书没有目录';entries.querySelectorAll('[data-index]').forEach(x=>x.onclick=()=>{$('#document-body iframe')?.contentWindow?.postMessage({type:'MOBI_GOTO_TOC',index:Number(x.dataset.index)},location.origin);closeReaderPanels()})});
window.addEventListener('message',async e=>{if(e.origin!==location.origin||!active||active.format!=='mobi')return;const d=e.data;if(d?.type==='CUSTOM_COPY_TEXT'){try{await navigator.clipboard.writeText(d.text)}catch{}return}if(d?.type!=='MOBI_CUSTOM_SELECTION'||!d.text)return;let note='';if(d.action==='note'){const v=prompt('记录这段文字的想法：','');if(v===null)return;note=v}if(d.action==='highlight'||d.action==='note'){await put('highlights',{id:id(),bookId:active.id,text:d.text,note,cfi:null,createdAt:now(),source:'mobi-selection'});toast('已保存'+(note?'笔记':'摘录')+'（暂不支持跳转定位）')}});
window.addEventListener('message',e=>{
 if(e.origin!==location.origin||!active||active.format!=='mobi'||e.data?.type!=='ZHJ_SELECTION')return;
 if(!e.data.text){if(selection?.kind==='mobi'){$('.selected-action')?.remove();selection=null}return}
 selection={text:e.data.text,kind:'mobi',cfi:e.data.cfi||null};
 toggleReaderChrome(false);selectionMenu();
});
window.addEventListener('message',e=>{
 if(e.origin!==location.origin||!active||active.format!=='mobi'||e.data?.type!=='MOBI_INLINE_NOTE')return;
 openInlineNoteActions(e.data.noteId);
});
window.addEventListener('message',async e=>{
 if(e.origin!==location.origin||!active||active.format!=='mobi'||e.data?.type!=='MOBI_NOTE_LOCATED')return;
 const bookId=active.id,{noteId,cfi}=e.data;
 if(typeof noteId!=='string'||typeof cfi!=='string'||!cfi.startsWith('epubcfi('))return;
 try{
  const item=await get('highlights',noteId);
  if(item?.bookId!==bookId||item.cfi||!item.note?.trim())return;
  item.cfi=cfi;item.updatedAt=now();
  await put('highlights',item);
  if($('#reading-settings')?.dataset.kind==='notes')await renderBookNotes(bookId);
 }catch(error){console.warn('Legacy MOBI note location could not be saved',error)}
});

let documentUrl=null;
window.addEventListener('message',async e=>{if(e.origin!==location.origin||!active||active.format!=='mobi')return;const d=e.data;if(d?.type==='MOBI_PREFS'){settings={...settings,...d.prefs};saveSettings();return}if(d?.type==='MOBI_PROGRESS'&&d.bookId===active.id){const old=await get('progress',active.id)||{};const record={...old,bookId:active.id,cfi:d.cfi||old.cfi||null,sectionIndex:d.sectionIndex??old.sectionIndex??0,percent:typeof d.percent==='number'?d.percent:(old.percent||0),updatedAt:now()};await put('progress',record);active.percent=record.percent;active.lastRead=now();await put('books',active)}});

async function openDocumentReader(b,f,target){
  active=b;let format=b.format||'epub';
  app.innerHTML=readerShell(b.title,'<div id="document-body" style="width:100%;height:100%"></div>');
  setupReaderChrome(async()=>{closeInlineNoteActions();clearSelection();documentUrl&&URL.revokeObjectURL(documentUrl);documentUrl=null;active=null;await refresh()},format);
  if(format==='pdf'){
    documentUrl=URL.createObjectURL(f.blob);
    let frame=document.createElement('iframe');frame.src=documentUrl+'#toolbar=1';frame.title=b.title;frame.style.cssText='width:100%;height:100%;border:0;background:#fff';$('#document-body').append(frame);
  }else{
    let frame=document.createElement('iframe');frame.src='./mobi-reader.html';frame.title=b.title;frame.style.cssText='width:100%;height:100%;border:0;background:#fff';$('#document-body').append(frame);
    frame.onload=async()=>{if(!active||active.id!==b.id)return;let data=await f.blob.arrayBuffer();frame.contentWindow.postMessage({type:'OPEN_MOBI',bookId:b.id,cfi:target||(await get('progress',b.id))?.cfi||null,sectionIndex:(await get('progress',b.id))?.sectionIndex??null,prefs:settings,notes:(await all('highlights')).filter(h=>h.bookId===b.id&&h.note?.trim()).map(h=>({id:h.id,cfi:h.cfi||null,text:h.text,note:h.note})),buffer:data,name:f.name||b.title+'.mobi'},location.origin,[data])};
  }
  b.lastRead=now();await put('books',b);
}
async function closeReader(){closeInlineNoteActions();clearSelection();removePop();active=null;try{rendition?.destroy();epub?.destroy()}catch{}rendition=null;epub=null;await refresh()}
async function notesPage(){let hs=(await all('highlights')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));shell('<p class="muted">'+hs.length+' 条划线与笔记</p>'+(hs.map(h=>'<div class="card"><div class="note-title">'+esc(books.find(b=>b.id===h.bookId)?.title||'已删除书籍')+'</div><div class="note">'+esc(h.text)+'</div>'+(h.note?'<p class="note-text">'+esc(h.note)+'</p>':'')+'<div class="actions"><button class="btn ghost small" data-go="'+h.id+'">回到原文</button><button class="btn ghost small" data-edit="'+h.id+'">编辑</button><button class="btn ghost small" data-del="'+h.id+'">删除</button></div></div>').join('')||'<div class="empty">暂无笔记，阅读时选中文字即可添加</div>'));document.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>{let h=hs.find(y=>y.id===x.dataset.go);openReader(h.bookId,h.cfi)});document.querySelectorAll('[data-edit]').forEach(x=>x.onclick=async()=>{let h=hs.find(y=>y.id===x.dataset.edit),v=prompt('编辑笔记',h.note||'');if(v!==null){h.note=v;await put('highlights',h);notesPage()}});document.querySelectorAll('[data-del]').forEach(x=>x.onclick=async()=>{if(confirm('删除划线与笔记？')){await del('highlights',x.dataset.del);notesPage()}})}
async function backup(){try{let out={version:1,createdAt:now(),books:await all('books'),progress:await all('progress'),highlights:await all('highlights'),bookmarks:await all('bookmarks'),files:[]};for(let f of await all('files')){let bytes=new Uint8Array(await f.blob.arrayBuffer()),str='';for(let i=0;i<bytes.length;i+=16384)str+=String.fromCharCode(...bytes.subarray(i,i+16384));out.files.push({id:f.id,name:f.name,base64:btoa(str)})}let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out)],{type:'application/json'}));a.download='zhijian-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);toast('请将备份保存到安全位置')}catch(e){toast('备份失败：'+e.message)}}
async function restore(file){if(!file)return;try{let d=JSON.parse(await file.text());if(d.version!==1||!Array.isArray(d.books)||!Array.isArray(d.files))throw Error('备份格式不正确');if(!confirm('恢复 '+d.books.length+' 本书？相同 ID 数据将覆盖'))return;for(let f of d.files){let raw=atob(f.base64),bytes=Uint8Array.from(raw,x=>x.charCodeAt(0));await put('files',{id:f.id,name:f.name,blob:new Blob([bytes],{type:({pdf:'application/pdf',mobi:'application/x-mobipocket-ebook',epub:'application/epub+zip'}[(d.books.find(b=>b.id===f.id)?.format)||'epub'])})})}for(let b of d.books)await put('books',b);for(let store of ['progress','highlights','bookmarks'])for(let row of d[store]||[])await put(store,row);view='shelf';toast('备份已恢复');await refresh()}catch(e){toast('恢复失败：'+e.message)}}
(async()=>{try{db=await openDb();await refresh();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn)}catch(e){app.textContent='数据库初始化失败：'+e.message}})();
