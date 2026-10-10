/* Shared, dependency-free search and status rules. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReasonMapCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function validLocation(p) {
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat)<=90 && Math.abs(p.lng)<=180;
  }
  function parseLocation(value) {
    let s=String(value).normalize('NFKC').trim();
    if (/^https?:\/\//i.test(s)) {
      try {
        const u=new URL(s);
        if (!/^(www\.|maps\.)?google\.(com|com\.tw)$/.test(u.hostname)) return null;
        // Prefer the destination coordinates over the map camera position.
        const dest=u.pathname.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        const camera=u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
        s=dest ? dest[1]+','+dest[2] : u.searchParams.get('query') || u.searchParams.get('q') || (camera ? camera[1]+','+camera[2] : '');
      } catch { return null; }
    }
    s=s.replace(/[()[\]]/g,' ').replace(/[，、]/g,',').trim();
    const m=s.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    let lat=Number(m[1]),lng=Number(m[2]);
    if (lat>=118 && lat<=124 && lng>=18 && lng<=27) [lat,lng]=[lng,lat];
    const p={lat,lng};
    return validLocation(p) ? p : null;
  }
  function photonResults(data) {
    if (!data || !Array.isArray(data.features)) throw new Error('搜尋服務回傳格式不正確，請稍後再試。');
    const seen=new Set(), results=[];
    for (const f of data.features) {
      const p=f.properties||{}, c=f.geometry?.coordinates;
      if (f.geometry?.type!=='Point' || !Array.isArray(c)) continue;
      const item={lat:c[1],lng:c[0]};
      if (!validLocation(item) || item.lat<18 || item.lat>27 || item.lng<117 || item.lng>124) continue;
      if (p.countrycode && String(p.countrycode).toUpperCase()!=='TW') continue;
      item.label=String(p.name||p.street||p.city||p.county||'未命名地點');
      item.detail=[...new Set([p.state,p.county,p.city,p.district,p.locality,
        [p.street,p.housenumber].filter(Boolean).join(' ')].filter(Boolean))].join(' · ');
      const key=item.label+'|'+item.lat.toFixed(5)+'|'+item.lng.toFixed(5);
      if (seen.has(key) || results.some(r=>r.label===item.label && Math.hypot((r.lat-item.lat)*111000,(r.lng-item.lng)*101000)<30)) continue;
      seen.add(key); results.push(item);
      if (results.length===8) break;
    }
    return results;
  }
  function recentSearches(raw, latest) {
    let items=[];
    try { items=JSON.parse(raw||'[]'); } catch {}
    if (!Array.isArray(items)) items=[];
    if (latest) items.unshift(latest);
    const seen=new Set();
    return items.filter(p=> {
      if (!validLocation(p) || typeof p.label!=='string') return false;
      const key=p.label+'|'+p.lat.toFixed(5)+'|'+p.lng.toFixed(5);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0,8).map(p=>({label:p.label.slice(0,180),detail:String(p.detail||'').slice(0,300),lat:p.lat,lng:p.lng}));
  }
  function querySummary(matches, state) {
    const relevant=matches.filter(r=>r.groupLabel!=='行政區界');
    const restricted=relevant.filter(r=>['禁航區','限航區','臨時空域'].includes(r.groupLabel));
    const result={count:relevant.length,restrictionCount:restricted.length,managementCount:relevant.length-restricted.length};
    if (state.phase==='loading') return {...result,kind:'unknown',title:'空域圖資載入中',note:'載入完成後會自動更新查詢。'};
    if (state.phase!=='ready' || state.sample) return {...result,kind:'unknown',title:'資料不完整，暫無法確認',note:'部分圖層未取得或仍為範例資料，請重新載入或查閱主管機關公告。'};
    if (isStale(state)) return {...result,kind:'unknown',title:'圖資已超過 48 小時未更新',note:'以下為最近取得的資料，不能作為最新空域狀態的確認。'};
    if (restricted.length) return {...result,kind:'restricted',title:'命中 '+restricted.length+' 筆空域限制',note:'請核對各筆有效期間、高度條件與主管機關說明。'};
    if (relevant.length) return {...result,kind:'managed',title:'涉及 '+relevant.length+' 筆其他管理範圍',note:'包含國家公園或商港等管理範圍，請查看管理單位要求。'};
    return {...result,kind:'clear',title:'未命中已收錄的管制範圍',note:'這不代表已獲飛行許可；仍須核對最新公告與現場條件。'};
  }
  function isStale(state, now=Date.now()) {
    return Boolean(state.stale || (Number.isFinite(state.generatedAt) && (now-state.generatedAt>48*3600000 || state.generatedAt>now+3600000)));
  }
  function airspaceCountText(info) {return info.unknown?'空域數待確認':info.count+' 個空域';}
  function validFeatureCollection(fc, info) {
    if (!fc || fc.type!=='FeatureCollection' || !Array.isArray(fc.features)) return false;
    if (Number.isFinite(info.feature_count) && fc.features.length!==info.feature_count) return false;
    return fc.features.every(f=>{
      if (!f || f.type!=='Feature' || !f.geometry) return false;
      const g=f.geometry;
      const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:null;
      return Array.isArray(polygons) && polygons.length>0 && polygons.every(poly=>Array.isArray(poly)&&poly.length>0&&poly.every(ring=>
        Array.isArray(ring)&&ring.length>=4&&ring.every(c=>Array.isArray(c)&&validLocation({lat:c[1],lng:c[0]}))&&
        ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1]));
    });
  }
  function datasetState(manifest, loaded, now=Date.now()) {
    const required=['uav_restricted_airspace','temporary_area','national_park','commercial_port','county'];
    const expected=new Set((manifest?.layers||[]).map(l=>l.slug));
    const failed=required.filter(slug=>!expected.has(slug)||!loaded.includes(slug));
    for(const slug of expected)if(!loaded.includes(slug)&&!failed.includes(slug))failed.push(slug);
    const timestamp=Date.parse(manifest?.generated_at_utc);
    const sample=!Number.isFinite(timestamp)||timestamp<Date.UTC(2020,0,1)||/範例/.test(manifest?.source||'');
    return {phase:failed.length?'partial':'ready',failed,sample,generatedAt:timestamp,stale:!Number.isFinite(timestamp)||now-timestamp>48*3600000||timestamp>now+3600000,updated:manifest?.generated_at_taipei||''};
  }
  async function loadSearchConfig(options={}) {
    const fallback={endpoint:'https://photon.komoot.io/api/',autocomplete:true,minInterval:1200};
    const controller=new AbortController();let timer;
    try {
      const config=await Promise.race([
        (options.fetch||globalThis.fetch.bind(globalThis))('./search-config.json',{signal:controller.signal}).then(r=>r.ok?r.json():null),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Configuration timeout'));},options.timeout??2500);})
      ]);
      if(!config || !/^https:\/\//.test(config.endpoint))return fallback;
      return {endpoint:config.endpoint,autocomplete:config.autocomplete!==false,minInterval:Math.max(1200,Number(config.minInterval)||1200)};
    } catch {return fallback;} finally {clearTimeout(timer);}
  }
  function createSearchService(options={}) {
    const fetcher=options.fetch||globalThis.fetch.bind(globalThis);
    const endpoint=options.endpoint||'https://photon.komoot.io/api/';
    const interval=options.minInterval??1200;
    let generation=0,controller=null,lastRequest=0;
    const cache=new Map();
    function cancel() { generation++; if(controller) controller.abort(); }
    async function search(query) {
      cancel();
      const id=generation, q=String(query).normalize('NFKC').trim().replace(/台(?=[北中南東灣])/g,'臺').replace(/火車站/g,'車站');
      if (q.length<2) return [];
      if (cache.has(q)) return cache.get(q);
      const active=new AbortController(); controller=active;
      let timeout, timedOut=false;
      try {
        const delay=Math.max(0,lastRequest+interval-Date.now());
        if (delay) await new Promise((resolve,reject)=>{
          const aborted=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
          const timer=setTimeout(()=>{active.signal.removeEventListener('abort',aborted);resolve();},delay);
          active.signal.addEventListener('abort',aborted,{once:true});
        });
        if (id!==generation) return null;
        const url=new URL(endpoint);
        url.searchParams.set('q',q); url.searchParams.set('limit','8');
        url.searchParams.set('countrycode','TW'); url.searchParams.set('bbox','117,18,124,27');
        // A fixed Taiwan bias avoids sending the user's current map/GPS position.
        url.searchParams.set('lat','23.7'); url.searchParams.set('lon','120.9');
        lastRequest=Date.now();
        timeout=setTimeout(()=>{timedOut=true;active.abort();},options.timeout??9000);
        const response=await fetcher(url.toString(),{signal:active.signal,headers:{Accept:'application/json'}});
        if (id!==generation) return null;
        if (!response.ok) throw new Error(response.status===429 ? '搜尋服務忙碌中，請稍候再試。' : '暫時無法取得搜尋結果，請再試一次。');
        let results=photonResults(await response.json());
        // Photon fuzzy matching can return a station in a completely different city.
        const city=q.match(/(?:^|\s)(?:\d{3,6}\s*)?(?:臺灣\s*)?(臺北|新北|桃園|臺中|臺南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|臺東|澎湖|金門|連江)/)?.[1];
        if(city)results=results.filter(r=>(r.label+' '+r.detail).replace(/台/g,'臺').includes(city));
        if (id!==generation) return null;
        cache.set(q,results);
        if(cache.size>40) cache.delete(cache.keys().next().value);
        return results;
      } catch (error) {
        if (id!==generation) return null;
        if (timedOut) throw new Error('搜尋逾時，請確認網路後再試。');
        throw error;
      } finally {clearTimeout(timeout);}
    }
    return {search,cancel};
  }
  return {validLocation,parseLocation,photonResults,recentSearches,querySummary,isStale,airspaceCountText,validFeatureCollection,datasetState,loadSearchConfig,createSearchService};
});
