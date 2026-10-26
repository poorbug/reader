/* 纸间 · 笔记分享卡片。纯 Canvas 绘制，离线可用，不上传笔记。 */
'use strict';
(function(){
  let overlay=null,previewUrl=null,exportBlob=null,busy=false;
  const BASE_W=750, MIN_HEIGHT=1000, MAX_CHARS=3500;
  const PALETTE={bg:'#1c1e23',ink:'#dfd1ab',soft:'#c6b991',muted:'#54544d',line:'#51504b',qr:'#f0e2bd'};
  const serif='"STKaiti","KaiTi","Songti SC","STSong","Noto Serif CJK SC",serif';
  function safeText(value){return String(value??'').trim().slice(0,MAX_CHARS)}
  function bookShareAddress(book){
    // The QR MUST point to a shareable book import URL, never just the home page.
    // Locally imported books have no fetchable URL and therefore no QR.
    if(!book?.sourceUrl)return null;
    try{
      const source=new URL(book.sourceUrl);
      if(source.protocol!=='https:'||source.username||source.password)return null;
      const site=new URL('./',location.href);
      site.searchParams.set('import',source.href);
      return site.href;
    }catch{return null}
  }
  function cardData(note,book){
    const title=safeText(book?.title)||'未命名书籍';
    const author=safeText(book?.author||book?.creator);
    const chapter=safeText(note?.chapterLabel||note?.chapter);
    return {note:safeText(note?.note),quote:safeText(note?.text)||'（暂无书摘内容）',
      title,author,chapter,qr:bookShareAddress(book)};
  }
  function textLines(ctx,text,maxWidth){
    const lines=[];
    for(const part of String(text).replace(/\r\n?/g,'\n').split('\n')){
      if(!part){lines.push('');continue}
      let line='';
      for(const letter of part){
        if(line&&ctx.measureText(line+letter).width>maxWidth){lines.push(line);line=letter}
        else line+=letter;
      }
      lines.push(line);
    }
    return lines;
  }
  function makeQRCode(text){
    return new Promise((resolve,reject)=>{
      if(typeof QRCode==='undefined')return reject(Error('二维码组件未加载'));
      const host=document.createElement('div');
      host.style.cssText='position:fixed;left:-9999px;top:-9999px;width:192px;height:192px;visibility:hidden';
      document.body.append(host);
      try{
        new QRCode(host,{text,width:192,height:192,colorDark:PALETTE.bg,
          colorLight:PALETTE.qr,correctLevel:QRCode.CorrectLevel.M});
        const canvas=host.querySelector('canvas');
        if(canvas&&canvas.width){const result=document.createElement('canvas');
          result.width=192;result.height=192;result.getContext('2d').drawImage(canvas,0,0);
          host.remove();resolve(result);return}
        const image=host.querySelector('img');
        if(!image)throw Error('二维码绘制失败');
        image.onload=()=>{const result=document.createElement('canvas');result.width=192;result.height=192;
          result.getContext('2d').drawImage(image,0,0);host.remove();resolve(result)};
        image.onerror=()=>{host.remove();reject(Error('二维码加载失败'))};
        if(image.complete&&image.naturalWidth)image.onload();
      }catch(error){host.remove();reject(error)}
    });
  }
  async function buildImage(data){
    // Calculate vertical rhythm before creating the export canvas.
    const scratch=document.createElement('canvas').getContext('2d');
    scratch.font='36px '+serif;
    const noteLines=data.note?textLines(scratch,data.note,618):[];
    scratch.font='38px '+serif;
    const quoteLines=textLines(scratch,data.quote,618);
    scratch.font='27px '+serif;
    const source='/ '+data.title+(data.chapter?' · '+data.chapter:'');
    const sourceLines=textLines(scratch,source,618);
    const noteBlock=noteLines.length?noteLines.length*58+112:0;
    const quotationTop=noteLines.length?135+noteBlock+46:304;
    const quoteTop=quotationTop+91;
    const sourceTop=quoteTop+quoteLines.length*63+43;
    const authorTop=sourceTop+sourceLines.length*44+(data.author?13:0);
    const endText=authorTop+(data.author?48:0);
    const ruleY=Math.max(835,endText+85);
    const height=Math.min(8000,Math.max(MIN_HEIGHT,ruleY+196));
    const canvas=document.createElement('canvas');
    canvas.width=BASE_W;canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle=PALETTE.bg;ctx.fillRect(0,0,BASE_W,height);
    ctx.textBaseline='top';
    if(noteLines.length){
      ctx.fillStyle=PALETTE.ink;ctx.font='36px '+serif;
      let y=135;for(const line of noteLines){ctx.fillText(line,64,y);y+=58}
    }
    ctx.fillStyle=PALETTE.muted;ctx.font='bold 130px Georgia,serif';
    ctx.fillText('“',56,quotationTop-30);
    ctx.fillStyle=PALETTE.ink;ctx.font='38px '+serif;
    let y=quoteTop;for(const line of quoteLines){ctx.fillText(line,64,y);y+=63}
    ctx.fillStyle=PALETTE.soft;ctx.font='27px '+serif;
    y=sourceTop;for(const line of sourceLines){ctx.fillText(line,64,y);y+=44}
    if(data.author){ctx.fillStyle=PALETTE.ink;ctx.fillText(data.author,82,authorTop)}
    ctx.strokeStyle=PALETTE.line;ctx.lineWidth=1;ctx.beginPath();
    ctx.moveTo(64,ruleY);ctx.lineTo(686,ruleY);ctx.stroke();
    ctx.fillStyle=PALETTE.ink;ctx.font='bold 28px '+serif;ctx.fillText('纸间',65,ruleY+86);
    // QR points to 纸间/?import=<encoded HTTPS book source>.
    // Do not draw a misleading home-page QR for local-only books.
    if(data.qr){
      const qr=await makeQRCode(data.qr);
      ctx.fillStyle=PALETTE.qr;ctx.fillRect(524,ruleY+21,162,162);
      ctx.drawImage(qr,532,ruleY+29,146,146);
    }
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('无法导出 PNG 图片')),'image/png'));
  }
  function close(){
    overlay?.remove();overlay=null;exportBlob=null;
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}
  }
  async function shareFile(blob,title){
    if(!blob)throw Error('分享图片尚未生成');
    const file=new File([blob],'纸间笔记.png',{type:'image/png'});
    if(!navigator.canShare?.({files:[file]})||!navigator.share)throw Error('当前浏览器不支持系统图片分享，可使用「保存图片」');
    await navigator.share({files:[file],title:'纸间 · '+title});
  }
  function saveFile(blob){
    if(!blob)return;
    const link=document.createElement('a');
    link.href=URL.createObjectURL(blob);link.download='纸间笔记-'+new Date().toISOString().slice(0,10)+'.png';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(link.href),10000);
  }
  async function open(note,book){
    if(!note)return;
    close();
    const data=cardData(note,book);
    const layer=document.createElement('div');
    layer.className='note-share-overlay';layer.setAttribute('role','presentation');
    layer.innerHTML='<div class="note-share-sheet" role="dialog" aria-modal="true" aria-label="分享笔记">'
      +'<div class="note-share-head"><strong>分享笔记</strong><button type="button" class="note-share-close" aria-label="关闭">×</button></div>'
      +'<div class="note-share-preview"><p class="note-share-loading">正在生成分享图片…</p><img alt="纸间笔记分享图预览" hidden></div>'
      +(data.qr?'':'<p class="note-share-source-missing">此书尚无公开 HTTPS 下载地址，分享图暂不包含二维码。</p>')
      +'<div class="note-share-controls"><button class="btn" type="button" data-note-share="save" disabled>保存图片</button>'
      +'<button class="btn ghost" type="button" data-note-share="system" disabled>分享图片</button></div>'
      +'</div>';
    document.body.append(layer);overlay=layer;
    const image=layer.querySelector('img'),message=layer.querySelector('.note-share-loading');
    const save=layer.querySelector('[data-note-share="save"]'),system=layer.querySelector('[data-note-share="system"]');
    layer.querySelector('.note-share-close').onclick=close;
    layer.addEventListener('click',event=>{if(event.target===layer)close()});
    save.onclick=()=>saveFile(exportBlob);
    system.onclick=async()=>{
      try{await shareFile(exportBlob,data.title)}catch(error){if(error.name!=='AbortError')alert(error.message)}
    };
    try{
      busy=true;
      const blob=await buildImage(data);
      if(overlay!==layer)return;
      exportBlob=blob;previewUrl=URL.createObjectURL(blob);
      image.src=previewUrl;image.hidden=false;message.hidden=true;
      save.disabled=false;system.disabled=!navigator.canShare?.({files:[new File([blob],'纸间笔记.png',{type:'image/png'})]});
    }catch(error){
      console.error('分享图生成失败',error);
      if(overlay===layer)message.textContent='生成失败：'+error.message;
    }finally{busy=false}
  }
  window.ZhijianNoteShare={open};
})();