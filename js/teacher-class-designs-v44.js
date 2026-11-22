/* V45: account-synchronized class artwork; V44 local preferences are migration previews only. */
(() => {
'use strict';
const originals=[['Orange hills','assets/teacher-pixelmatch/class-orange.png','#ff810e'],['Green grid','assets/teacher-pixelmatch/class-green.png','#20b95f'],['Blue bridge','assets/teacher-pixelmatch/class-blue.png','#168cf6'],['Purple planet','assets/teacher-pixelmatch/class-purple.png','#a043dd'],['Yellow mathematics','assets/teacher-classes-v32/class-yellow.png','#ffb300'],['Rose mathematics','assets/teacher-classes-v32/class-rose.png','#ed4c7f']];
const extra=[["Geometry", "assets/teacher-art-v44/class-01.png", "#f88b12"], ["Graphing", "assets/teacher-art-v44/class-02.png", "#009ba8"], ["Astronomy", "assets/teacher-art-v44/class-03.png", "#873ee1"], ["Engineering", "assets/teacher-art-v44/class-04.png", "#167bea"], ["Statistics", "assets/teacher-art-v44/class-05.png", "#64a824"], ["Math ideas", "assets/teacher-art-v44/class-06.png", "#e5a600"], ["Fractions", "assets/teacher-art-v44/class-07.png", "#e75162"], ["Algebra", "assets/teacher-art-v44/class-08.png", "#5559d9"], ["Measurement", "assets/teacher-art-v44/class-09.png", "#00a5bd"], ["Tessellation", "assets/teacher-art-v44/class-10.png", "#d445a9"]];
const themes=[...originals,...extra].map(([label,file,accent],i)=>({id:String(i),label,file,accent}));
let volatile=Object.create(null);
const owner=()=>String(typeof state!=='undefined'?(state.user?.id||state.profile?.id||'session'):'session');
const key=()=>`mathside-v44-class-designs:${owner()}`;
function load(){try{const data=JSON.parse(localStorage.getItem(key())||'{}');return {...(data&&typeof data==='object'&&!Array.isArray(data)?data:{}),...(volatile[key()]||{})};}catch{return {...(volatile[key()]||{})};}}
function fallback(s){const list=(typeof state!=='undefined'?state.sections||[]:[]).filter(c=>!c.archived_at);const i=Math.max(0,list.findIndex(c=>String(c.id)===String(s.id)));return themes[list.length===1?1:i%themes.length];}
function get(s){const cloud=themes.find(t=>t.id===s.theme_id);if(cloud)return cloud;const legacy=load()[String(s.id)];return themes.find(t=>t.id===legacy)||fallback(s);}
async function set(s,id){
  if(!themes.some(t=>t.id===id))throw new Error('Invalid class design.');
  const userId=state.user?.id;
  if(!userId||!db||state.profile?.role!=='teacher'||String(s.teacher_id)!==String(userId)||s.archived_at)throw new Error('Sign in as the class teacher to save a design.');
  const {data,error}=await db.from('mathside_sections').update({theme_id:id}).eq('id',s.id).eq('teacher_id',userId).is('archived_at',null).select('id,theme_id').single();
  if(error)throw error;
  if(!data||String(data.id)!==String(s.id)||data.theme_id!==id)throw new Error('The database did not confirm the design.');
  if(String(state.user?.id)!==String(userId))return false;
  const latest=state.sections.find(c=>String(c.id)===String(s.id)&&String(c.teacher_id)===String(userId));
  if(latest)latest.theme_id=data.theme_id;
  // Never replace a confirmed server value with an old browser preference.
  const next=load();delete next[String(s.id)];volatile[key()]=next;
  try{localStorage.setItem(key(),JSON.stringify(next));}catch{}
  return true;
}
function open(id,trigger){const section=(state.sections||[]).find(s=>String(s.id)===String(id)&&!s.archived_at);if(!section)return;
const dialog=document.createElement('dialog');dialog.className='ms44-theme-dialog';dialog.setAttribute('aria-label','Change class design');
const heading=document.createElement('h2');heading.textContent='Change class design';
const desc=document.createElement('p');desc.textContent=`Choose an illustration for ${section.name||'this class'}. It will appear on Dashboard and Classes on every device signed in to your account.`;
const close=document.createElement('button');close.type='button';close.className='ms44-close';close.textContent='×';close.setAttribute('aria-label','Close');close.onclick=()=>dialog.close();
const grid=document.createElement('div');grid.className='ms44-theme-grid';const current=get(section).id;
let selected=current;
for(const t of themes){const b=document.createElement('button');b.type='button';b.className='ms44-theme-option';b.setAttribute('aria-pressed',String(t.id===current));const img=document.createElement('img');img.src=t.file;img.alt='';const label=document.createElement('span');label.textContent=t.label;b.append(img,label);b.onclick=()=>{selected=t.id;grid.querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));};grid.append(b);}
const footer=document.createElement('div');footer.className='ms44-theme-footer';const hint=document.createElement('small');hint.textContent='16 designs • saved to your account';const save=document.createElement('button');save.type='button';save.className='ms44-save';save.textContent='Apply design';save.onclick=async()=>{save.disabled=true;close.disabled=true;grid.querySelectorAll('button').forEach(b=>b.disabled=true);save.textContent='Saving…';hint.textContent='Saving to your account…';try{const saved=await set(section,selected);if(saved){dialog.close();window.MathsideClassesV32?.render();window.MathsideTeacherPixelMatchV27?.render();if(typeof toast==='function')toast('Class design saved to your account.','green');}else if(dialog.open)dialog.close();}catch(error){hint.textContent=/theme_id|schema cache/i.test(String(error?.message||error))?'Run the V45 SQL migration first.':'Could not save. Check your connection and try again.';hint.setAttribute('role','alert');save.disabled=false;close.disabled=false;grid.querySelectorAll('button').forEach(b=>b.disabled=false);save.textContent='Apply design';}};dialog.addEventListener('cancel',e=>{if(save.disabled)e.preventDefault();});footer.append(hint,save);dialog.append(close,heading,desc,grid,footer);document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus();});dialog.addEventListener('click',e=>{if(e.target===dialog&&!save.disabled)dialog.close();});dialog.showModal();}
window.MathsideClassDesignsV44={themes,get,set,open};
document.addEventListener('click',e=>{const button=e.target.closest('[data-ms44-design]');if(!button)return;e.preventDefault();const id=button.dataset.ms44Design;document.querySelectorAll('#view-classes .ms32-card-more').forEach(d=>d.open=false);open(id,button.closest('details')?.querySelector('summary'));});
})();