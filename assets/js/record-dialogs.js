// Present the existing forms in dialogs; persistence and permissions stay in their modules.
(()=>{
 const editor=document.getElementById('monitor-editor')||document.getElementById('editor-panel')||document.getElementById('plantation-form')?.closest('section');
 if(editor&&!editor.closest('dialog')){
  const dialog=document.createElement('dialog');dialog.className='record-dialog';dialog.id='record-dialog';
  const heading=editor.querySelector('h2');if(heading){heading.id||='record-dialog-title';dialog.setAttribute('aria-labelledby',heading.id);}
  const launch=document.createElement('button');launch.type='button';launch.className='btn primary record-launch';launch.textContent=document.getElementById('plantation-form')?'Register a plantation':'New record';launch.setAttribute('aria-haspopup','dialog');launch.setAttribute('aria-controls',dialog.id);
  editor.before(launch,dialog);
  const bar=document.createElement('div');bar.className='record-dialog-bar';const close=document.createElement('button');close.type='button';close.className='btn secondary';close.textContent='Close';bar.append(close);dialog.append(bar,editor);
  function open(){if(editor.classList.contains('hidden'))return;if(!dialog.open)dialog.showModal();dialog.scrollTop=0;}
  launch.addEventListener('click',()=>{
   if(/^Edit\b/.test(heading?.textContent||'')){
    const reset=document.getElementById('monitor-reset')||document.getElementById('reset-record')||document.getElementById('reset-farm');reset?.click();
   }
   open();
  });close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{document.body.classList.remove('mapping-expanded');const back=document.getElementById('close-expanded-map');if(back)back.hidden=true;launch.focus();});
  new MutationObserver(()=>{launch.hidden=editor.classList.contains('hidden');}).observe(editor,{attributes:true,attributeFilter:['class']});
  const status=document.getElementById('page-status'),copy=document.createElement('p');copy.setAttribute('role','status');copy.setAttribute('aria-live','polite');dialog.append(copy);
  if(status)new MutationObserver(()=>{copy.textContent=status.textContent;copy.className=status.className;}).observe(status,{childList:true,subtree:true,attributes:true});
  window.CacaoRecordModal={open};
 }
 const valueProperty=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
 function enhance(select){
  if(select.dataset.searchReady)return;select.dataset.searchReady='true';
  const input=document.createElement('input');input.type='search';input.id=select.id+'-search';input.autocomplete='off';input.placeholder='Type to search…';input.required=select.required;select.required=false;select.hidden=true;
  select.after(input);const label=select.closest('label');if(label)label.htmlFor=input.id;
  const results=document.createElement('div');results.className='record-search-results';results.id=select.id+'-results';results.hidden=true;results.setAttribute('role','region');results.setAttribute('aria-label','Matching records');input.setAttribute('aria-controls',results.id);
  if(label){const wrapper=document.createElement('div');wrapper.className='record-picker';label.before(wrapper);wrapper.append(label,results);}else input.after(results);
  let typing=false;
  function sync(){if(typing)return;const option=select.selectedOptions[0];input.value=select.value?option?.textContent||'':'';input.disabled=select.disabled;input.setCustomValidity('');results.hidden=true;}
  Object.defineProperty(select,'value',{configurable:true,get(){return valueProperty.get.call(this);},set(value){valueProperty.set.call(this,value);sync();}});
  function render(){
   results.replaceChildren();const query=input.value.trim().toLocaleLowerCase();results.hidden=!query;if(!query)return;
   const matches=[...select.options].filter(option=>option.value&&!option.disabled&&option.textContent.toLocaleLowerCase().includes(query));
   for(const option of matches.slice(0,30)){
    const button=document.createElement('button');button.type='button';button.textContent=option.textContent;
    if(matches.filter(other=>other.textContent===option.textContent).length>1)button.textContent+=' · '+option.value.slice(-6);
    button.addEventListener('click',()=>{if(select.disabled)return;select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));results.hidden=true;input.focus();});results.append(button);
   }
   if(!matches.length){const text=document.createElement('p');text.textContent='No matching records. Try another name.';results.append(text);}
   if(matches.length>30){const text=document.createElement('p');text.textContent=matches.length+' matches. Keep typing to narrow your search.';results.append(text);}
  }
  input.addEventListener('input',()=>{typing=true;select.value='';typing=false;input.setCustomValidity(input.value?'Choose a matching record from the search results.':'');select.dispatchEvent(new Event('change',{bubbles:true}));render();});
  input.addEventListener('focus',()=>input.select());
  input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){results.querySelector('button')?.focus();event.preventDefault();}if(event.key==='Escape'&&!results.hidden){results.hidden=true;event.preventDefault();event.stopPropagation();}});
  select.addEventListener('change',()=>{if(!typing&&select.value)sync();});
  new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected']});
  select.form?.addEventListener('reset',()=>queueMicrotask(sync));sync();
 }
 function scan(){for(const select of document.querySelectorAll('form select:is(#plantation_id,#worker_id,#farmer-record)'))enhance(select);}
 scan();new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
})();
