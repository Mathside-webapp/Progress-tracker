/* One pending action per control; installed before application handlers. */
(() => {
 const pending=new WeakSet();
 const labelFor=button=>{
  const text=button?.textContent||'';
  for(const [pattern,label] of [[/delete|remove/i,'Deleting…'],[/restore/i,'Restoring…'],[/archive/i,'Archiving…'],[/import/i,'Importing…'],[/create/i,'Creating…'],[/add student/i,'Adding…'],[/save/i,'Saving…'],[/download|export|pdf|png/i,'Preparing download…'],[/sign in/i,'Signing in…'],[/sign out/i,'Signing out…'],[/camera/i,'Opening camera…'],[/capture|scan/i,'Scanning…']])if(pattern.test(text))return label;
  return 'Loading…';
 };
 function run(owner,button,handler,event){
  if(pending.has(owner)){event.preventDefault();event.stopImmediatePropagation();return;}
  event.preventDefault();event.stopImmediatePropagation();
  const html=button?.innerHTML,disabled=button?.disabled;
  pending.add(owner);
  let result;
  try{result=handler.call(owner,event);}catch(error){pending.delete(owner);throw error;}
  if(!result||typeof result.then!=='function'){pending.delete(owner);return;}
  const host=button?.closest('.modal-card');
  const closers=host?[...host.querySelectorAll('[data-close-modal],#cancelImport,#cancelStudentDelete,#cancelStudentDelete')].map(b=>[b,b.disabled]):[];
  closers.forEach(([b])=>b.disabled=true);
  if(button){button.disabled=true;button.textContent=labelFor({textContent:html?.replace(/<[^>]+>/g,'')});button.setAttribute('aria-busy','true');}
  Promise.resolve(result).catch(error=>{
   const message=document.createElement('div');message.className='toast warn';message.textContent=error.message||'Action failed. Please retry.';document.querySelector('#toastHost')?.append(message);setTimeout(()=>message.remove(),6000);
  }).finally(()=>{
   pending.delete(owner);closers.forEach(([b,d])=>{if(b.isConnected)b.disabled=d;});
   if(button?.isConnected){button.innerHTML=html;button.disabled=disabled;button.removeAttribute('aria-busy');}
  });
 }
 document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b||!b.onclick||b.disabled)return;
  run(b,b,b.onclick,event);
 },true);
 document.addEventListener('submit',event=>{
  const form=event.target;if(!form.onsubmit)return;
  run(form,event.submitter||form.querySelector('button[type="submit"],button:not([type])'),form.onsubmit,event);
 },true);
 document.addEventListener('change',event=>{
  const input=event.target;if(input.type!=='file'||!input.onchange)return;
  const ids={keyWorkbookInput:'importKeyBtn',manageKeyFile:'manageUploadKey',scanFile:'uploadTab',cameraFallbackFile:'startCameraBtn'};
  run(input,document.getElementById(ids[input.id]),input.onchange,event);
 },true);
 document.addEventListener('keydown',event=>{
  const dialog=document.querySelector('.modal-card');if(!dialog)return;
  if(event.key==='Tab'){
   const all=[...dialog.querySelectorAll('button,input,select,textarea,a[href]')].filter(e=>!e.disabled&&e.getClientRects().length);
   if(!all.length){event.preventDefault();return;}
   if(event.shiftKey&&(document.activeElement===all[0]||document.activeElement===dialog)){event.preventDefault();all.at(-1).focus();}
   else if(!event.shiftKey&&(document.activeElement===all.at(-1)||document.activeElement===dialog)){event.preventDefault();all[0].focus();}
  }
 });
})();
