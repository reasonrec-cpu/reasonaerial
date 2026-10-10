const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const corePath = path.join(__dirname, '../public/map-core.js');
const core = fs.existsSync(corePath) ? require(corePath) : {};
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test('point queries do not count administrative boundaries as restricted areas', () => {
  const feature = { geometry: { type: 'Polygon', coordinates: [[[0,0],[2,0],[2,2],[0,2],[0,0]]] } };
  const record = groupLabel => ({groupLabel, feature, bounds: { contains: () => true }});
  const context = {records: [record('行政區界'), record('禁航區')], pipGeom: () => true,
    boundsArea: () => 1, ReasonMapCore: core};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function zonesAt('), html.indexOf('function nameOf(')), context);
  assert.deepEqual(Array.from(context.zonesAt({lat:1,lng:1}), r=>r.groupLabel), ['禁航區']);
});

test('coordinate search accepts reversed Taiwan coordinates and Google Maps URLs', () => {
  assert.equal(typeof core.parseLocation, 'function', 'coordinate parser is available');
  assert.deepEqual(core.parseLocation('（121.5654，25.033）'), {lat:25.033,lng:121.5654});
  assert.deepEqual(core.parseLocation('https://www.google.com/maps/@25.033,121.5654,17z'), {lat:25.033,lng:121.5654});
  assert.deepEqual(core.parseLocation('https://www.google.com/maps/search/?api=1&query=25.033%2C121.5654'), {lat:25.033,lng:121.5654});
  assert.equal(core.parseLocation('95,200'), null);
  assert.equal(core.parseLocation('台南市中西區'), null);
  assert.equal(core.parseLocation('https://evil.example/maps/@25,121,17z'), null);
});

test('Photon results keep distinct names, deduplicate identical points and exclude foreign places', () => {
  assert.equal(typeof core.photonResults, 'function');
  const place = (name, coords, countrycode='TW') => ({type:'Feature', geometry:{type:'Point',coordinates:coords},
    properties:{name,countrycode,city:'臺北市',district:'信義區',street:'信義路五段',housenumber:'7',osm_type:'N',osm_id:123}});
  const results = core.photonResults({features:[place('台北101',[121.5654,25.033]),place('台北101',[121.56542,25.03301]),
    place('台北101觀景台',[121.5654,25.033]),place('同名外國地點',[120,30],'CN'),place('壞座標',[NaN,25])]});
  assert.equal(results.length, 2);
  assert.equal(results[0].label, '台北101');
  assert.match(results[0].detail, /信義區/);
  assert.equal(results[0].lat, 25.033);
});

test('airspace summaries never give an all-clear with incomplete, stale or sample data', () => {
  assert.equal(typeof core.querySummary, 'function');
  const ready = {phase:'ready',stale:false,sample:false};
  assert.equal(core.querySummary([],ready).kind,'clear');
  for (const state of [{phase:'loading'}, {phase:'partial'}, {...ready,stale:true}, {...ready,sample:true}]) {
    assert.notEqual(core.querySummary([],state).kind,'clear');
  }
  assert.equal(core.querySummary([{groupLabel:'行政區界'}],ready).count,0);
  assert.equal(core.querySummary([{groupLabel:'國家公園'}],ready).kind,'managed');
  assert.equal(core.querySummary([{groupLabel:'禁航區'},{groupLabel:'行政區界'}],ready).count,1);
});

test('recent search is bounded, deduplicated, and tolerates corrupt storage', () => {
  assert.equal(typeof core.recentSearches, 'function');
  const item={label:'台北101',detail:'臺北市',lat:25.033,lng:121.5654};
  assert.deepEqual(core.recentSearches('broken',item),[item]);
  assert.equal(core.recentSearches(JSON.stringify([item,item]),item).length,1);
  assert.equal(core.recentSearches(JSON.stringify([{label:'bad',lat:100,lng:121}])).length,0);
  assert.equal(core.recentSearches(JSON.stringify(Array.from({length:20},(_,i)=>({...item,label:'地點'+i,lng:121+i/100})))).length,8);
});

test('search service rejects stale responses and bounds request rate', async () => {
  assert.equal(typeof core.createSearchService, 'function');
  const requests=[];
  const service=core.createSearchService({endpoint:'https://photon.komoot.io/api/',minInterval:0,
    fetch: (url,{signal})=>new Promise(resolve=>requests.push({url,signal,resolve}))});
  const first=service.search('台北');
  await new Promise(resolve=>setImmediate(resolve));
  const second=service.search('台南');
  await new Promise(resolve=>setImmediate(resolve));
  requests[1].resolve({ok:true,json:async()=>({features:[]})});
  assert.deepEqual(await second,[]);
  requests[0].resolve({ok:true,json:async()=>({features:[]})});
  assert.equal(await first,null);
  assert.equal(requests[0].signal.aborted,true);
  assert.equal(new URL(requests[1].url).searchParams.get('countrycode'),'TW');
});

test('dataset validation detects missing layers, old timestamps, and truncated feature collections', () => {
  assert.equal(typeof core.datasetState, 'function');
  const slugs=['uav_restricted_airspace','temporary_area','national_park','commercial_port','county'];
  const manifest={generated_at_utc:'2026-10-10T00:00:00Z',generated_at_taipei:'2026-10-10 08:00',layers:slugs.map(slug=>({slug}))};
  const now=Date.parse('2026-10-10T04:00:00Z');
  assert.equal(core.datasetState(manifest,slugs,now).phase,'ready');
  assert.equal(core.datasetState(manifest,slugs.slice(1),now).phase,'partial');
  assert.equal(core.datasetState({...manifest,layers:manifest.layers.slice(1)},slugs,now).phase,'partial');
  assert.equal(core.datasetState({...manifest,generated_at_utc:'1970-01-01T00:00:00Z'},slugs,now).sample,true);
  assert.equal(core.datasetState(manifest,slugs,now+3*86400000).stale,true);
  assert.equal(core.validFeatureCollection({type:'FeatureCollection',features:[]},{feature_count:2}),false);
  assert.equal(core.validFeatureCollection({type:'FeatureCollection',features:[]},{feature_count:0}),true);
});

test('search service caches submitted queries, reports failure and respects minimum intervals', async () => {
  const starts=[];
  const service=core.createSearchService({minInterval:35,fetch:async()=>{
    starts.push(Date.now());return {ok:true,json:async()=>({features:[]})};
  }});
  await service.search('臺南');await service.search('臺南');await service.search('臺北');
  assert.equal(starts.length,2);
  assert.ok(starts[1]-starts[0]>=30);
  const broken=core.createSearchService({fetch:async()=>({ok:false,status:429})});
  await assert.rejects(broken.search('臺南'),/忙碌/);
});

test('a tab left open beyond the freshness window no longer gives a clear result', () => {
  assert.notEqual(core.querySummary([],{phase:'ready',stale:false,sample:false,generatedAt:Date.now()-3*86400000}).kind,'clear');
});

test('unknown airspace counts stay unknown in saved-area labels', () => {
  assert.equal(typeof core.airspaceCountText,'function');
  assert.equal(core.airspaceCountText({unknown:true,count:0}),'空域數待確認');
  assert.equal(core.airspaceCountText({count:2}),'2 個空域');
});

test('a stalled configuration request falls back instead of blocking place search', async () => {
  assert.equal(typeof core.loadSearchConfig,'function');
  const config=await core.loadSearchConfig({fetch:()=>new Promise(()=>{}),timeout:15});
  assert.equal(config.endpoint,'https://photon.komoot.io/api/');
  assert.equal(config.autocomplete,true);
});

test('Taiwan station aliases do not return fuzzy matches in a different requested city', async () => {
  const urls=[];
  const service=core.createSearchService({minInterval:0,fetch:async url=>{
    urls.push(new URL(url));return {ok:true,json:async()=>({features:[
      {type:'Feature',geometry:{type:'Point',coordinates:[121.123,22.792]},properties:{name:'臺東火車站',city:'臺東市',countrycode:'TW'}},
      {type:'Feature',geometry:{type:'Point',coordinates:[120.213,22.997]},properties:{name:'臺南車站',city:'臺南市',countrycode:'TW'}}
    ]})};
  }});
  const results=await service.search('台南火車站');
  assert.equal(urls[0].searchParams.get('q'),'臺南車站');
  assert.deepEqual(results.map(r=>r.label),['臺南車站']);
});
