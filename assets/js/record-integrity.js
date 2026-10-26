// Pure record/GeoJSON helpers shared by forms and tests; authoritative validation stays in PostGIS.
window.CacaoIntegrity = (() => {
  const normalize = value => String(value || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
  function duplicates(rows, values, currentId) {
    const name=normalize([values.first_name,values.middle_name,values.last_name].filter(Boolean).join(' ')||values.full_name);
    const reference=normalize(values.rsbsa_number);
    return rows.filter(row=>row.id!==currentId&&(
      (reference&&normalize(row.rsbsa_number)===reference)||
      (name&&normalize(row.full_name)===name&&(row.owner_id===values.owner_id||!values.owner_id))
    ));
  }
  function parcels(input) {
    const result=[];
    function collect(value,properties={}) {
      if(!value||typeof value!=='object')throw new Error('Invalid GeoJSON document.');
      if(value.type==='FeatureCollection'){
        if(!Array.isArray(value.features)||value.features.length>1000)throw new Error('GeoJSON must contain at most 1,000 features.');
        value.features.forEach(feature=>collect(feature));
      }else if(value.type==='Feature')collect(value.geometry,value.properties||{});
      else if(value.type==='Polygon')result.push({geometry:value,name:String(properties.name||'Parcel '+(result.length+1))});
      else if(value.type==='MultiPolygon'){
        if(!Array.isArray(value.coordinates))throw new Error('Invalid MultiPolygon.');
        value.coordinates.forEach(coordinates=>result.push({geometry:{type:'Polygon',coordinates},name:String(properties.name||'Parcel')+' '+(result.length+1)}));
      }else if(!['Point','LineString','MultiPoint','MultiLineString'].includes(value.type))throw new Error('Unsupported GeoJSON geometry.');
    }
    collect(input);
    if(!result.length||result.length>1000)throw new Error('The file must contain between 1 and 1,000 polygon parcels.');
    for(const parcel of result){
      const rings=parcel.geometry.coordinates;
      if(!Array.isArray(rings)||rings.length!==1)throw new Error('This editor supports one exterior ring per parcel; polygons with holes require GIS review.');
      const ring=rings[0];
      if(!Array.isArray(ring)||ring.length<4||ring.length>10001)throw new Error('A parcel must have 3 to 10,000 vertices.');
      if(ring.some(p=>!Array.isArray(p)||p.length!==2||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90))throw new Error('Use valid [longitude, latitude] coordinates.');
      if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw new Error('GeoJSON polygon rings must be closed.');
    }
    return result;
  }
  function download(name,value) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/geo+json'}));
    const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function overlapArea(first,second) {
    const intersection=turf.intersect({type:'FeatureCollection',features:[turf.feature(first),turf.feature(second)]});
    return intersection?Math.max(0,turf.area(intersection)):0;
  }
  return {normalize,duplicates,parcels,download,overlapArea};
})();
