(function(global){
'use strict';
/* Shared custom text selection for embedded EPUB/MOBI chapter documents.
   Never invokes browser selection UI: it renders highlight and drag handles. */
function install(doc,options={}){
 if(!doc||!doc.body)return null;
 if(doc.__zhjSelectionApi)return doc.__zhjSelectionApi;
 const win=doc.defaultView;
 doc.documentElement.style.setProperty('-webkit-touch-callout','none','important');
 doc.body.style.setProperty('-webkit-touch-callout','none','important');
 doc.body.style.setProperty('-webkit-user-select','none','important');
 doc.body.style.setProperty('user-select','none','important');
 let timer=null,origin=null,anchor=null,head=null,selectionRange=null,overlay=null,handleDrag=null,longPress=false,moved=false,touchX=0,touchY=0,lastSelectionAt=0;
 const point=(x,y)=>{
  try{
   let caret=doc.caretRangeFromPoint?.(x,y);
   if(!caret&&doc.caretPositionFromPoint){const p=doc.caretPositionFromPoint(x,y);if(p){caret=doc.createRange();caret.setStart(p.offsetNode,p.offset);caret.collapse(true)}}
   if(!caret)return null;
   const n=caret.startContainer;
   if(n.nodeType!==3)return null;
   return {node:n,offset:Math.max(0,Math.min(n.textContent.length,caret.startOffset))};
  }catch{return null}
 };
 const order=(a,b)=>{
  if(!a||!b)return null;
  try{
   const r=doc.createRange();r.setStart(a.node,a.offset);r.collapse(true);
   return r.comparePoint(b.node,b.offset)<0?[b,a]:[a,b];
  }catch{return null}
 };
 const updateRange=()=>{
  const pair=order(anchor,head);
  if(!pair)return false;
  try{
   const r=doc.createRange();
   r.setStart(pair[0].node,pair[0].offset);
   r.setEnd(pair[1].node,pair[1].offset);
   if(r.collapsed)return false;
   selectionRange=r;return true;
  }catch{return false}
 };
 const clearView=()=>{overlay?.remove();overlay=null};
 const notify=()=>{
  lastSelectionAt=Date.now();
  const value=selectionRange?.toString().trim()||'';
  doc.__zhijianSelectionActive=!!value;
  options.onChange?.(value?{text:value,range:selectionRange.cloneRange()}:null);
 };
 const draw=()=>{
  if(!selectionRange)return;
  if(!overlay){overlay=doc.createElement('div');overlay.setAttribute('data-zhj-selection-overlay','');overlay.style.cssText='position:fixed;inset:0;z-index:2147483630;pointer-events:none;overflow:visible;';doc.body.appendChild(overlay)}
  overlay.querySelectorAll('[data-zhj-rect]').forEach(n=>n.remove());
  const rects=[...selectionRange.getClientRects()].filter(r=>r.width>0&&r.height>0);
  for(const r of rects){
   const d=doc.createElement('div');d.dataset.zhjRect='';
   d.style.cssText='position:absolute;pointer-events:none;background:rgba(57,135,206,.32);left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px';
   overlay.appendChild(d);
  }
  if(!rects.length)return;
  [['start',rects[0].left,rects[0].top],['end',rects[rects.length-1].right,rects[rects.length-1].bottom]].forEach(([side,x,y])=>{
   let h=overlay.querySelector('[data-zhj-handle="'+side+'"]');const isNew=!h;if(!h)h=doc.createElement('div');h.dataset.zhjHandle=side;
   const atTop=side==='start';
   h.style.cssText='position:absolute;box-sizing:border-box;pointer-events:auto;touch-action:none;-webkit-touch-callout:none;width:24px;height:24px;border-radius:50%;background:#247bd0;border:3px solid white;box-shadow:0 1px 5px #0006;left:'+(x-12)+'px;top:'+(y-12)+'px;';
   h.setAttribute('aria-label',side==='start'?'拖动选区起点':'拖动选区终点');
   if(isNew)h.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;e.preventDefault();e.stopPropagation();handleDrag=side;doc.__zhijianSelecting=true},{passive:false});
   if(isNew)h.addEventListener('mousedown',e=>{e.preventDefault();handleDrag=side;doc.__zhijianSelecting=true});
   if(isNew)overlay.appendChild(h);
  });
 };
 const moveEndpoint=(x,y)=>{
  const pos=point(x,y);if(!pos||!selectionRange)return;
  if(handleDrag==='start')anchor=pos;
  else head=pos;
  if(updateRange())draw();
 };
 const word=(pos)=>{
  if(!pos||!pos.node?.textContent)return null;
  const txt=pos.node.textContent,offset=Math.max(0,Math.min(pos.offset,txt.length-1));
  let left=offset,right=offset+1;
  try{
   if(typeof Intl.Segmenter==='function'){
    const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
    for(const seg of segmenter.segment(txt)){
     if(seg.index<=offset&&offset<seg.index+seg.segment.length){
      left=seg.index;right=seg.index+seg.segment.length;break;
     }
    }
   }
  }catch{}
  if(right-left>30){left=offset;right=Math.min(txt.length,offset+1)}
  return {start:{node:pos.node,offset:left},end:{node:pos.node,offset:right}};
 };
 function clear(){clearTimeout(timer);origin=anchor=head=selectionRange=null;longPress=moved=false;handleDrag=null;doc.__zhijianSelecting=false;doc.__zhijianSelectionActive=false;clearView();options.onChange?.(null)}
 function current(){return selectionRange?.toString().trim()||''}
 doc.addEventListener('touchstart',e=>{
  if(e.touches.length!==1)return;
  if(e.target?.closest?.('[data-zhj-handle],button,input,textarea,select'))return;
  clearTimeout(timer);
  touchX=e.touches[0].clientX;touchY=e.touches[0].clientY;
  origin=point(touchX,touchY);moved=false;longPress=false;
  timer=setTimeout(()=>{
   if(!origin||moved)return;
   const w=word(origin);if(!w)return;
   anchor=w.start;head=w.end;
   if(!updateRange())return;
   longPress=true;doc.__zhijianSelecting=true;draw();
   win.navigator?.vibrate?.(12);
  },440);
 },{passive:true});
 doc.addEventListener('touchmove',e=>{
  if(e.touches.length!==1)return;
  const t=e.touches[0];
  if(handleDrag){e.preventDefault();moveEndpoint(t.clientX,t.clientY);e.stopImmediatePropagation();return}
  if(longPress){e.preventDefault();const pos=point(t.clientX,t.clientY);if(pos){head=pos;if(updateRange())draw()}e.stopImmediatePropagation();return}
  if(Math.hypot(t.clientX-touchX,t.clientY-touchY)>10){moved=true;clearTimeout(timer)}
 },{capture:true,passive:false});
 doc.addEventListener('touchend',e=>{
  clearTimeout(timer);
  if(handleDrag){handleDrag=null;doc.__zhijianSelecting=false;notify();e.preventDefault();e.stopImmediatePropagation();return}
  if(longPress){longPress=false;doc.__zhijianSelecting=false;notify();e.preventDefault();e.stopImmediatePropagation()}
 },{capture:true,passive:false});
 doc.addEventListener('touchcancel',()=>{clearTimeout(timer);handleDrag=null;longPress=false;doc.__zhijianSelecting=false},{passive:true});
 doc.addEventListener('contextmenu',e=>e.preventDefault(),true);
 doc.addEventListener('selectstart',e=>e.preventDefault(),true);
 doc.addEventListener('click',e=>{
  if(e.target.closest?.('[data-zhj-handle]'))return;
  if(selectionRange&&!longPress&&Date.now()-lastSelectionAt>700){clear()}
 },true);
 doc.addEventListener('scroll',()=>{if(selectionRange)draw()},{capture:true,passive:true});
 const api={clear,getText:current,hasSelection:()=>!!selectionRange,getRange:()=>selectionRange?.cloneRange()};
 doc.__zhjSelectionApi=api;
 return api;
}
global.ZhijianSelection={install};
})(window);
