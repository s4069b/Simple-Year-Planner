(() => {
  const $=s=>document.querySelector(s);
  const calendarsHost=$('#calendars'), shadingHost=$('#shading'), notice=$('#notice');
  let state={calendars:[],shading:[],years:[]};

  function tell(message, ok=true){notice.hidden=false;notice.textContent=message;notice.style.background=ok?'#eef6ef':'#fff0f0';}
  async function api(path, options={}){
    const res=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const body=await res.json();
    if(!res.ok||body.ok===false)throw new Error(body.error||'Request failed');
    return body;
  }
  function calendarForm(c={}){
    const form=document.createElement('form'); form.className='form-grid';
    form.innerHTML=`<label>Name<input name="name" required></label><label>Colour<input name="colour" type="color"></label>
      <label class="wide">Public ICS URL<input name="url" type="url" required></label><label><span>Enabled</span><input name="enabled" type="checkbox"></label>
      <div class="row"><button class="primary">Save</button>${c.id?'<button type="button" class="danger remove">Remove</button>':''}</div>`;
    form.name.value=c.name||''; form.colour.value=c.colour||'#356a8a'; form.url.value=c.url||''; form.enabled.checked=c.enabled!==false;
    form.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/calendar',{method:'POST',body:JSON.stringify({id:c.id,...Object.fromEntries(new FormData(form)),enabled:form.enabled.checked})});tell('Calendar saved.');await load();}catch(e){tell(e.message,false);}});
    form.querySelector('.remove')?.addEventListener('click',async()=>{if(!confirm(`Remove “${c.name}”?`))return;try{await api('/api/admin/calendar/'+encodeURIComponent(c.id),{method:'DELETE',body:'{}'});tell('Calendar removed.');await load();}catch(e){tell(e.message,false);}});
    return form;
  }
  function shadeForm(s={}){
    const form=document.createElement('form'); form.className='form-grid';
    const years=state.years.map(y=>`<option>${y}</option>`).join('');
    form.innerHTML=`<label>Name<input name="name" required></label><label>Year<select name="year">${years}</select></label>
      <label>Start<input name="start" type="date" required></label><label>End<input name="end" type="date" required></label>
      <label>Colour<input name="colour" type="color"></label><div class="row"><button class="primary">Save</button>${s.id?'<button type="button" class="danger remove">Remove</button>':''}</div>`;
    form.name.value=s.name||'';form.year.value=s.year||state.years[0];form.start.value=s.start||'';form.end.value=s.end||'';form.colour.value=s.colour||'#e5e7eb';
    form.addEventListener('submit',async e=>{e.preventDefault();try{const data=Object.fromEntries(new FormData(form));await api('/api/admin/shading',{method:'POST',body:JSON.stringify({id:s.id,...data,year:Number(data.year)})});tell('Shading saved.');await load();}catch(e){tell(e.message,false);}});
    form.querySelector('.remove')?.addEventListener('click',async()=>{if(!confirm(`Remove “${s.name}”?`))return;try{await api('/api/admin/shading/'+encodeURIComponent(s.id),{method:'DELETE',body:'{}'});tell('Shading removed.');await load();}catch(e){tell(e.message,false);}});
    return form;
  }
  async function load(){
    state=await api('/api/admin/config');
    calendarsHost.replaceChildren(...state.calendars.map(calendarForm));
    shadingHost.replaceChildren(...state.shading.map(shadeForm));
  }
  $('#add-calendar').addEventListener('click',()=>calendarsHost.append(calendarForm()));
  $('#add-shade').addEventListener('click',()=>shadingHost.append(shadeForm()));
  $('#refresh').addEventListener('click',async()=>{try{tell('Refreshing…');await api('/api/admin/sync',{method:'POST',body:'{}'});tell('Calendars refreshed.');}catch(e){tell(e.message,false);}});
  load().catch(e=>tell(e.message,false));
})();