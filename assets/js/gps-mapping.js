// Shared Leaflet Draw + GPS walking engine. All coordinates are [longitude, latitude] in GeoJSON.
window.CacaoGPS = (() => {
  let mappingHost=null,bridge=null;
  let loadingBoundary=false;
  const tellHost=message=>{if(mappingHost&&!mappingHost.closed)mappingHost.postMessage({...message,bridge},location.origin);};
  let map,drawn,polygon,trail,currentMarker,accuracyCircle,watchId=null;
  let points=[],samples=[],mode='manual',phase='ready',draftId='walking-unassigned',vault=null,draftTimer,lastDraftSave=0;
  let imported=[];
  const $=id=>document.getElementById(id);
  const status=(id,value,error=false)=>{ $(id).textContent=value;$(id).className='status '+(error?'error':'success'); };
  function validatePosition(position) {
    const c=position.coords;
    if(!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)||!Number.isFinite(c.accuracy)||c.latitude < -90||c.latitude > 90||c.longitude < -180||c.longitude > 180||c.accuracy<0||!Number.isFinite(position.timestamp))throw new Error('Invalid GPS reading rejected.');
    return {latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,timestamp:position.timestamp};
  }
  function ringFor(layer) {
    if(!layer)return null;const vertices=layer.getLatLngs()[0].map(p=>[p.lng,p.lat]);
    if(vertices.length<3)return null;return [...vertices,vertices[0]];
  }
  function validateRing(ring) {
    if(!ring||ring.length<4)throw new Error('At least three distinct corners are required.');
    if(new Set(ring.slice(0,-1).map(p=>p.join(','))).size<3)throw new Error('At least three distinct corners are required.');
    if(ring.some(([lng,lat])=>!Number.isFinite(lng)||!Number.isFinite(lat)||Math.abs(lng)>180||Math.abs(lat)>90))throw new Error('Boundary coordinates are invalid.');
    const feature=turf.polygon([ring]);
    if(turf.kinks(feature).features.length)throw new Error('The boundary crosses itself. Edit the polygon points before saving.');
    if(turf.area(feature)<=0)throw new Error('Boundary must enclose a positive area.');
    return feature;
  }
  function data() {
    const ring=ringFor(polygon);
    try {
      const feature=validateRing(ring);
      return {boundary:feature.geometry,area_sqm:turf.area(feature),capture_method:mode,gps_accuracy:points,gps_samples:samples};
    }catch{return {boundary:null,area_sqm:0,capture_method:mode,gps_accuracy:points,gps_samples:samples};}
  }
  function publish(notifyHost=true) {
    if(loadingBoundary)return;
    const value=data();
    $('area-sqm').textContent=value.area_sqm.toLocaleString(undefined,{maximumFractionDigits:2})+' m²';
    $('area-ha').textContent=(value.area_sqm/10000).toFixed(4)+' ha';
    $('gps-count').textContent=String(points.length);
    if(notifyHost)tellHost({type:'boundary-change',value});
    if(vault&&!draftTimer){draftTimer=setTimeout(()=>{draftTimer=null;lastDraftSave=Date.now();vault?.save({points,samples,mode,boundary:data().boundary}).catch(error=>status('gps-status','Draft autosave failed: '+error.message,true));},Math.max(0,750-(Date.now()-lastDraftSave)));}
  }
  function updateButtons() {
    $('tracking-state').textContent=phase.charAt(0).toUpperCase()+phase.slice(1);
    $('start-walk').disabled=phase==='recording'||phase==='paused';
    $('pause-walk').disabled=phase!=='recording';$('resume-walk').disabled=phase!=='paused';
    $('finish-walk').disabled=!['recording','paused'].includes(phase);$('cancel-walk').disabled=!['recording','paused'].includes(phase);
    for(const id of ['gps-point','finish-gps'])$(id).disabled=['recording','paused'].includes(phase);
  }
  function stop() { if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;} }
  function clear() {
    stop();phase='ready';points=[];samples=[];mode='manual';drawn.clearLayers();polygon=null;
    trail?.setLatLngs([]);updateButtons();publish();
  }
  function applyPolygon(layer) {
    validateRing(ringFor(layer));drawn.clearLayers();polygon=layer;
    polygon.setStyle({color:'#287a4b',weight:3,fillOpacity:.22});drawn.addLayer(layer);
    map.fitBounds(layer.getBounds(),{padding:[22,22],maxZoom:18});publish();
  }
  function showPosition(point) {
    const latlng=[point.latitude,point.longitude];
    if(!currentMarker)currentMarker=L.circleMarker(latlng,{radius:6,color:'#225f91',fillOpacity:1}).addTo(map);else currentMarker.setLatLng(latlng);
    if(!accuracyCircle)accuracyCircle=L.circle(latlng,{radius:point.accuracy,color:'#225f91',weight:1,fillOpacity:.06}).addTo(map);
    else accuracyCircle.setLatLng(latlng).setRadius(point.accuracy);
  }
  function accept(position) {
    try {
      const point=validatePosition(position);showPosition(point);
      if(samples.length>=20000){stop();phase='paused';updateButtons();throw new Error('The session has reached its raw-reading limit. Finish and review.');}
      const sample={...point,accepted:false,reason:null};samples.push(sample);
      const limit=Number($('max-accuracy').value);
      if(!Number.isFinite(limit)||limit<5||limit>100)throw new Error('Maximum GPS error must be between 5 and 100 meters.');
      if(point.accuracy>limit){sample.reason='accuracy';publish();throw new Error('Skipped low-quality GPS reading: ±'+Math.round(point.accuracy)+' m. Move to a clearer location.');}
      if(points.some(p=>turf.distance([p.longitude,p.latitude],[point.longitude,point.latitude],{units:'meters'})<3)) {
        sample.reason='spacing';publish();status('gps-status','Position accuracy ±'+Math.round(point.accuracy)+' m. Waiting for a distinct point at least 3 meters away.');return;
      }
      if(points.length>=10000){stop();phase='paused';updateButtons();throw new Error('10,000-point limit reached. Finish and review this boundary.');}
      sample.accepted=true;points.push(point);trail.setLatLngs(points.map(p=>[p.latitude,p.longitude]));
      if(points.length===1)map.setView([point.latitude,point.longitude],18);
      status('gps-status',points.length+' accepted points · accuracy ±'+Math.round(point.accuracy)+' m');publish();
    }catch(error){status('gps-status',error.message,true);}
  }
  function geoAvailable() {
    if(!navigator.geolocation)throw new Error('Geolocation is unavailable in this browser.');
    if(!window.isSecureContext)throw new Error('GPS requires HTTPS or localhost.');
  }
  async function enableRecovery(){
    if(vault)return;
    if(await CacaoDrafts.exists(draftId)&&!confirm('A saved walk exists for this parcel. Restore it to continue it, or confirm that you want to replace that local walking snapshot with a new session.'))throw new Error('Restore the saved walking draft before continuing.');
    const passphrase=prompt('Protect automatic walking recovery with a passphrase of at least 12 characters. Keep it safe; it is needed after reopening the map.');
    if(!passphrase)throw new Error('GPS capture has not started. Choose a recovery passphrase to protect the session.');
    vault=await CacaoDrafts.createVault(draftId,passphrase);
  }
  function watch() {
    geoAvailable();phase='recording';mode='gps';updateButtons();
    status('gps-status','Waiting for a high-accuracy GPS position…');
    watchId=navigator.geolocation.watchPosition(accept,error=>{
      stop();phase='paused';updateButtons();status('gps-status','GPS interrupted: '+error.message+'. Resume when ready.',true);
    },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  }
  function finish() {
    stop();phase='paused';updateButtons();
    const coords=points.map(p=>[p.longitude,p.latitude]);
    const ring=coords.length?[...coords,coords[0]]:[];
    validateRing(ring);applyPolygon(L.polygon(points.map(p=>[p.latitude,p.longitude])));
    phase='review';updateButtons();status('form-status','Boundary closed. Use the map edit tool to review and correct points, then save the plantation.');
  }
  function button(id,handler) {$(id).addEventListener('click',()=>Promise.resolve().then(handler).catch(error=>status('form-status',error.message,true)));}
  async function onePosition() {
    geoAvailable();return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:0,timeout:20000}));
  }
  function start() {
    mappingHost=parent!==window?parent:window.opener;
    bridge=new URLSearchParams(location.search).get('bridge');
    try {
      if(!window.L||!window.turf)throw new Error('Map libraries could not load. Check your connection.');
      const settings=window.CACAO_MAP;
      map=L.map('map').setView(window.CACAO_MAP?.center||[12,123],window.CACAO_MAP?.zoom||6);L.control.scale().addTo(map);
      const street=L.tileLayer(settings.tiles,{maxZoom:settings.maxZoom,attribution:settings.attribution}).addTo(map);
      const layers={'Street map':street};if(settings.imagery?.tiles)layers.Imagery=L.tileLayer(settings.imagery.tiles,{attribution:settings.imagery.attribution,maxZoom:settings.imagery.maxZoom||19});
      L.control.layers(layers).addTo(map);
      drawn=L.featureGroup().addTo(map);trail=L.polyline([],{color:'#a57b24',weight:3}).addTo(map);
      map.addControl(new L.Control.Draw({edit:{featureGroup:drawn,remove:true},draw:{polygon:{allowIntersection:false,showArea:true},polyline:false,rectangle:false,circle:false,marker:false,circlemarker:false}}));
      map.on(L.Draw.Event.CREATED,event=>{try{if(phase==='recording')throw new Error('Pause GPS before drawing a replacement boundary.');validateRing(ringFor(event.layer));clear();applyPolygon(event.layer);status('form-status','Manual boundary captured. Review and save.');}catch(error){status('form-status',error.message,true);}});
      map.on(L.Draw.Event.EDITED,()=>{try{validateRing(ringFor(polygon));polygon.setStyle({color:'#287a4b'});status('form-status','Boundary updated.');}catch(error){polygon?.setStyle({color:'#ad5144'});status('form-status',error.message,true);}publish();});
      map.on(L.Draw.Event.DELETED,()=>{polygon=null;publish();});
      button('start-walk',async()=>{if(parent!==window&&!parent.document.body.classList.contains('mapping-expanded')){tellHost({type:'open-mapping'});return;}if((polygon||points.length)&&!confirm('Start a new walking boundary and clear the current map?'))return;await enableRecovery();clear();watch();});
      button('pause-walk',()=>{stop();phase='paused';updateButtons();status('gps-status','GPS paused. Captured points are retained.');});
      button('resume-walk',watch);button('finish-walk',finish);
      button('cancel-walk',()=>{if(confirm('Cancel this walk and clear its points?'))clear();});
      button('clear-map',()=>{if((polygon||points.length)&&!confirm('Clear this boundary and its GPS points?'))return;clear();});
      button('locate',async()=>{const point=validatePosition(await onePosition());showPosition(point);map.setView([point.latitude,point.longitude],17);status('form-status','Location accuracy ±'+Math.round(point.accuracy)+' m');});
      button('gps-point',async()=>{if(polygon)throw new Error('Clear the existing polygon before capturing GPS corners.');await enableRecovery();mode='gps';accept(await onePosition());});
      button('finish-gps',finish);
      button('save-gps-draft',async()=>{
        if(!points.length)throw new Error('Capture GPS points before saving a draft.');
        const passphrase=prompt('Create a passphrase of at least 12 characters. It is not stored; you need it to restore this walking draft.');if(!passphrase)return;
        vault=await CacaoDrafts.createVault(draftId,passphrase);
        await vault.save({points,samples,mode,boundary:data().boundary});status('form-status','Encrypted GPS draft saved. Changes now autosave while this map stays open.');
      });
      button('restore-gps-draft',async()=>{
        if((polygon||points.length)&&!confirm('Replace this map with a saved device draft?'))return;
        const passphrase=prompt('Enter the passphrase for this walking draft.');if(!passphrase)return;
        const draft=await CacaoDrafts.restore(draftId,passphrase);
        if(!Array.isArray(draft.points)||draft.points.length>10000)throw new Error('Invalid walking draft.');
        const restored=draft.points.map(point=>validatePosition({coords:point,timestamp:point.timestamp}));
        vault=null;clearTimeout(draftTimer);draftTimer=null;clear();vault=await CacaoDrafts.createVault(draftId,passphrase);points=restored;samples=draft.samples||restored.map(point=>({...point,accepted:true}));mode=draft.mode||'gps';trail.setLatLngs(points.map(p=>[p.latitude,p.longitude]));
        if(draft.boundary)applyPolygon(L.polygon(draft.boundary.coordinates[0].slice(0,-1).map(([lng,lat])=>[lat,lng])));
        phase='paused';updateButtons();publish();status('form-status','Walking draft restored. Review it or resume GPS.');
      });
      button('delete-gps-draft',async()=>{if(confirm('Delete the encrypted local draft for this plantation?')){vault=null;clearTimeout(draftTimer);draftTimer=null;await CacaoDrafts.remove(draftId);status('form-status','Local GPS draft deleted. Autosave is now off.');}});
      button('export-geojson',()=>{
        const value=data();if(!value.boundary)throw new Error('Draw or finish a valid boundary before exporting.');
        CacaoIntegrity.download('cacao-boundary.geojson',{type:'Feature',geometry:value.boundary,properties:{capture_method:mode,area_sqm:value.area_sqm,approximate:true,gps_accuracy:points,gps_samples:samples}});
      });
      $('import-geojson').addEventListener('change',async event=>{
        try{
          const file=event.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error('GeoJSON imports are limited to 5 MB.');
          imported=CacaoIntegrity.parcels(JSON.parse(await file.text()));
          const select=$('import-parcel');select.replaceChildren();
          imported.forEach((parcel,index)=>{const option=document.createElement('option');option.value=index;option.textContent=parcel.name;select.append(option);});
          $('import-controls').classList.remove('hidden');status('form-status','Choose one parcel to load. Register additional parcels as separate plantations for the same farmer.');
        }catch(error){status('form-status',error.message,true);}finally{event.target.value='';}
      });
      button('load-import-parcel',()=>{
        const parcel=imported[Number($('import-parcel').value)];if(!parcel)throw new Error('Select an imported parcel.');
        validateRing(parcel.geometry.coordinates[0]);
        if((polygon||points.length)&&!confirm('Replace the current boundary with this imported parcel?'))return;
        clear();mode='import';applyPolygon(L.polygon(parcel.geometry.coordinates[0].slice(0,-1).map(([lng,lat])=>[lat,lng])));
      });
      window.addEventListener('message',event=>{
        if(event.origin!==location.origin||event.source!==mappingHost)return;
        if(parent===window&&event.data?.bridge!==bridge)return;
        if(event.data?.type==='load-boundary'){
          try{
            loadingBoundary=true;
            if(event.data.draftId && event.data.draftId!==draftId){vault=null;clearTimeout(draftTimer);draftTimer=null;}
            clear();draftId=event.data.draftId||draftId;mode=event.data.capture_method||'manual';points=event.data.gps_accuracy||[];samples=event.data.gps_samples||[];
            if(event.data.boundary)applyPolygon(L.polygon(event.data.boundary.coordinates[0].slice(0,-1).map(([lng,lat])=>[lat,lng])));
            if(points.length&&!polygon){phase='paused';updateButtons();}
            loadingBoundary=false;publish(false);
            CacaoDrafts.exists(draftId).then(exists=>{
              $('recovery-notice').classList.toggle('hidden',!exists);
              if(exists)$('recovery-notice').textContent='A saved walking session was detected for this parcel. Use Restore walking draft and unlock it to recover your recorded points.';
            }).catch(error=>status('gps-status','Local recovery check failed: '+error.message,true));
          }catch(error){loadingBoundary=false;status('form-status',error.message,true);}
        }
      });
      const resize=()=>map.invalidateSize();window.addEventListener('resize',resize);
      if(window.ResizeObserver)new ResizeObserver(resize).observe(document.body);
      window.addEventListener('pagehide',stop);window.addEventListener('beforeunload',stop);
      document.addEventListener('visibilitychange',()=>{if(document.hidden&&phase==='recording'){stop();phase='paused';updateButtons();status('gps-status','Tracking paused while the app was hidden. Return and Resume to continue.',true);}});
      if(parent===window){
        document.body.classList.add('mapping-full');
        const bar=document.createElement('div');bar.className='mapping-return-bar';
        const use=document.createElement('button');use.type='button';use.className='btn primary';use.textContent='Use boundary and return';
        use.addEventListener('click',()=>{
          const value=data();if(!value.boundary){status('form-status','Finish and review a valid polygon before returning to the plantation form.',true);return;}
          if(!mappingHost||mappingHost.closed){status('form-status','The plantation form is no longer open. Export this boundary or save an encrypted draft before closing.',true);return;}
          stop();tellHost({type:'mapping-finished',value});mappingHost.focus();window.close();
          status('form-status','Boundary sent. Return to the plantation form and save the plantation.');
        });
        bar.append(use);document.querySelector('.map-heading').append(bar);
        // Put the map first on phones, with a compact return bar always available.
        const heading=document.querySelector('.map-heading');heading.after($('map'));
        map.invalidateSize();
      }
      updateButtons();tellHost({type:'mapping-ready'});
    }catch(error){status('form-status',error.message,true);}
  }
  return {start,validatePosition,validateRing};
})();
