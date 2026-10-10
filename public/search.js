(function() {
  'use strict';
  const core=ReasonMapCore, input=document.getElementById('locInput');
  const box=document.getElementById('searchResults'), list=document.getElementById('searchOptions');
  const status=document.getElementById('searchStatus'), form=document.getElementById('locationSearch');
  const clear=document.getElementById('searchClear'), recentKey='reasonRecentSearches';
  let service=core.createSearchService(), timer, version=0, items=[], active=-1, composing=false;
  let autocomplete=true;
  const configReady=core.loadSearchConfig().then(config=>{
    service.cancel();
    service=core.createSearchService({endpoint:config.endpoint,minInterval:Math.max(1200,Number(config.minInterval)||1200)});
    autocomplete=config.autocomplete!==false;
  }).catch(()=>{});
  function history() {try{return core.recentSearches(localStorage.getItem(recentKey));}catch{return [];}}
  function remember(item) {try{localStorage.setItem(recentKey,JSON.stringify(core.recentSearches(localStorage.getItem(recentKey),item)));}catch{}}
  function cancel() {clearTimeout(timer);version++;service.cancel();form.classList.remove('searching');input.setAttribute('aria-busy','false');}
  function close() {box.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
  function announce(text) {status.textContent=text;box.hidden=false;input.setAttribute('aria-expanded','true');}
  function render(results, message, isHistory=false) {
    items=results; active=-1; input.removeAttribute('aria-activedescendant'); list.replaceChildren();
    results.forEach((r,i)=>{
      const row=document.createElement('li'), button=document.createElement('button');
      row.setAttribute('role','presentation'); button.type='button'; button.className='search-option';
      button.id='search-option-'+i;button.setAttribute('role','option');button.setAttribute('aria-selected','false');
      const icon=document.createElement('span');icon.className='option-icon';icon.textContent=isHistory?'↺':'⌖';icon.setAttribute('aria-hidden','true');
      const text=document.createElement('span'), title=document.createElement('strong'), detail=document.createElement('small');
      title.textContent=r.label;detail.textContent=r.detail||`${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`;
      text.append(title,detail);button.append(icon,text);button.addEventListener('click',()=>select(r));
      row.append(button);list.append(row);
    });
    document.getElementById('clearRecent').hidden=!isHistory || !results.length;
    announce(message);
  }
  function select(item) {
    cancel();input.value=item.label;clear.hidden=false;close();remember(item);input.blur();
    const ll=L.latLng(item.lat,item.lng);
    map.setView(ll,Math.max(map.getZoom(),16));
    if(tool==='distance'||tool==='area') {addMeasurePoint(ll);setMsg('已加入量測點：'+esc(item.label));setMobileSheet('tools');}
    else if(tool==='parcel') {addParcelPoint(ll);setMobileSheet('tools');}
    else if(tool==='apply'||tool==='import') {setMsg('已定位至 '+esc(item.label)+'，可繼續繪製或匯入範圍。');setMobileSheet('tools');}
    else {doStatus(ll);}
    // Reposition the marker in the uncovered map area after the sheet opens.
    requestAnimationFrame(()=>{
      if(window.innerWidth<=760) map.panBy([0,document.getElementById('resultPanel').offsetHeight/2],{animate:false});
    });
  }
  async function run(submit=false) {
    cancel();const current=version, q=input.value.trim();clear.hidden=!q;
    if(!q) {render(history(),'最近搜尋 · 僅儲存在這個裝置',true);return;}
    const coords=core.parseLocation(q);
    if(coords) {const r={...coords,label:`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,detail:'座標位置'};
      if(submit) select(r);else render([r],'選擇座標位置');return;}
    if(/^https?:\/\//i.test(q)) {render([],'請貼上含座標的 Google Maps 完整網址，或複製「緯度,經度」。短網址無法直接解析。');return;}
    // Clearly numeric input should not be sent to an address service after failed validation.
    if(/^[\d\s.,，()（）+\-]+$/.test(q)) {render([],'座標格式不正確，請使用「緯度,經度」，例如 25.033,121.5654。');return;}
    const pc=findPlusCode(q);
    if(pc && OLC.isFull(pc)) {
      const d=OLC.decode(pc),p={lat:d.latC,lng:d.lngC};
      if(!core.validLocation(p)) {render([],'Plus Code 格式不正確。');return;}
      const r={...p,label:pc,detail:'Plus Code 位置'};
      if(submit) select(r);else render([r],'選擇 Plus Code 位置');return;
    }
    if(q.length<2) {render([],'請輸入至少兩個字，例如「臺南車站」。');return;}
    await configReady;if(current!==version)return;
    if(!submit && !autocomplete) {render(history().filter(r=>(r.label+r.detail).includes(q)),'按 Enter 或搜尋查看地點');return;}
    render([],'正在尋找地點…');form.classList.add('searching');input.setAttribute('aria-busy','true');
    try {
      let query=q;
      if(pc) {
        query=q.replace(new RegExp(pc.replace('+','\\+'),'i'),'').trim();
        if(!query) {render([],'短 Plus Code 請加上縣市／地名，或貼上完整 Plus Code。');return;}
      }
      const results=await service.search(query);
      if(current!==version || results===null)return;
      const choices=pc ? results.map(r=>{
        const [lat,lng]=OLC.recover(pc,r.lat,r.lng);
        return {...r,lat,lng,label:pc+' · '+r.label,detail:'以此地點解析短 Plus Code · '+r.detail};
      }) : results;
      render(choices,choices.length ? `找到 ${choices.length} 個地點，請確認地址後選擇` : '找不到符合的地點。試試加上縣市、改用地標名稱或貼上座標。');
    } catch(error) {if(current===version)render([],error.message||'搜尋暫時無法使用，請稍後再試。');}
    finally {if(current===version){form.classList.remove('searching');input.setAttribute('aria-busy','false');}}
  }
  function schedule() {
    cancel();close();clear.hidden=!input.value;
    if(composing)return;
    timer=setTimeout(()=>run(),650);
  }
  form.addEventListener('submit',event=>{event.preventDefault();if(!composing)run(true);});
  input.addEventListener('input',schedule);
  input.addEventListener('compositionstart',()=>{composing=true;cancel();});
  input.addEventListener('compositionend',()=>{composing=false;schedule();});
  input.addEventListener('focus',()=>{if(window.innerWidth<=760)setMobileSheet('none');if(!input.value.trim())render(history(),'最近搜尋 · 僅儲存在這個裝置',true);});
  input.addEventListener('keydown',event=>{
    if(composing||event.isComposing)return;
    if(event.key==='Escape'){cancel();close();return;}
    if((event.key==='ArrowDown'||event.key==='ArrowUp')&&!box.hidden&&items.length){
      event.preventDefault();active=(active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      [...list.querySelectorAll('[role=option]')].forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));
      const el=document.getElementById('search-option-'+active);input.setAttribute('aria-activedescendant',el.id);el.scrollIntoView({block:'nearest'});
    } else if(event.key==='Enter'&&!box.hidden&&active>=0) {event.preventDefault();select(items[active]);}
  });
  clear.addEventListener('click',()=>{cancel();input.value='';clear.hidden=true;input.focus();render(history(),'最近搜尋 · 僅儲存在這個裝置',true);});
  document.getElementById('clearRecent').addEventListener('click',()=>{try{localStorage.removeItem(recentKey);}catch{}render([],'最近搜尋已清除。',true);input.focus();});
  document.addEventListener('click',e=>{if(!document.getElementById('searchBox').contains(e.target)){cancel();close();}});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();input.focus();}});
  window.goLocate=()=>run(true);
})();
