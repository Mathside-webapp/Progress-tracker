/* Mathside Teacher Pixel Match V27: presentation layer only.
 * Operates against existing teacher data and existing actions; does not write to Supabase.
 * Screenshot-derived sample labels are not installed as production class data. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const asset='assets/teacher-pixelmatch/';
 const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const active=()=>!!($('teacherApp')&&!$('teacherApp').hidden && typeof state!=='undefined'&&state.profile?.role==='teacher');
 const png=(name,variant='orange')=>`${asset}icons/${variant}/${name}.png`;
 const icon=(name,variant='orange')=>`<img src="${png(name,variant)}" alt="" aria-hidden="true">`;
 const sections=()=> (state.sections||[]).filter(s=>!s.archived_at);
 const n=(value)=>Number(value);
 const pct=(values)=>values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10:null;
 const activeAssignments=()=> (state.assignments||[]).filter(a=>a.status!=='archived'&&!a.archived_at && sections().some(s=>String(s.id)===String(a.section_id)));
 const avgFor=(sectionId=null)=>{
   const assign=new Map(activeAssignments().filter(a=>sectionId===null||String(a.section_id)===String(sectionId)).map(a=>[String(a.id),a]));
   const grades=[];
   for(const submission of (state.submissions||[])){
     if(submission.status!=='graded')continue;
     const a=assign.get(String(submission.assignment_id));if(!a)continue;
     const max=typeof totalPoints==='function'?n(totalPoints(a.id)):0;
     const points=n(submission.teacher_score??submission.auto_score);
     if(max>0 && Number.isFinite(points) && points>=0)grades.push(Math.max(0,Math.min(100,points/max*100)));
   }
   return pct(grades);
 };
 const countStudents=section=>{
   if(typeof studentsForSection==='function')return studentsForSection(section.id).length;
   const mids=(state.members||[]).filter(m=>String(m.section_id)===String(section.id)).map(m=>String(m.student_id));
   return new Set(mids).size;
 };
 function renderClassCards(){
   const grid=$('dashboardClassGrid'); if(!grid)return;
   const list=sections().slice(0,4);
   if(!list.length){
     grid.innerHTML=`<div class="pm-class-empty"><b>No classes yet</b><p>Create a class to begin organizing students and assessment work.</p><button type="button" data-empty-create-class>Create Class</button></div>`;
     return;
   }
   const banners=['class-orange.png','class-green.png','class-blue.png','class-purple.png'];
   grid.innerHTML=list.map((s,i)=>{
     const avg=avgFor(s.id);
     const grade=s.grade_level==null?'':`Grade ${safe(s.grade_level)}`;
     const title=`${s.grade_level==null?'':safe(s.grade_level)+' – '}${safe(s.name||'Class')}`;
     const progress=avg===null?'0':String(avg);
     const summary=avg===null?'Not yet graded':`${avg.toFixed(1)}% Avg.`;
     const count=countStudents(s);
     const theme=window.MathsideClassDesignsV44?.get(s);
     return `<article class="pm-class-card" data-class-card-id="${safe(s.id)}" data-dashboard-class="true">
       <div class="pm-class-banner" style="background-image:url('${theme?.file||asset+banners[i%4]}')"><span class="pm-class-grade">${grade}</span></div>
       <div class="pm-class-body"><div class="pm-class-title-line"><button class="pm-class-name-button" type="button" data-view-class-students="${safe(s.id)}" aria-label="Open ${title} student roster"><h4 class="pm-class-title">${title}</h4></button><button type="button" class="pm-class-more" data-view-class-students="${safe(s.id)}" title="Open class roster" aria-label="Open ${title} roster">${icon('ellipsis','charcoal')}</button></div>
       <div class="pm-class-meta">${icon('02-classes','charcoal')}<span>${count} Student${count===1?'':'s'}</span></div>
       <div class="pm-class-meta">${icon('chart','charcoal')}<span>${summary}</span></div>
       <div class="pm-class-bar" aria-label="${avg===null?'No graded submissions':summary}"><span style="width:${progress}%"></span></div></div>
     </article>`;
   }).join('');
 }
 function refreshInlineIcons(){
   const iconConfig=[['twRecentList','file'],['twPendingList','02-classes'],['twReminderList','calendar']];
   for(const [id,kind] of iconConfig){
     const parent=$(id);if(!parent)continue;
     for(const row of parent.querySelectorAll('.tw-list-row')){
       const marker=row.querySelector('.tw-list-icon');
       if(marker){marker.innerHTML=icon(kind,'orange');}
       if(!row.querySelector('.pm-row-chevron')){
         const arrow=document.createElement('img');arrow.className='pm-row-chevron';arrow.src=png('chevron','gray');arrow.setAttribute('aria-hidden','true');arrow.alt='';row.appendChild(arrow);
       }
     }
   }
   const recent=$('twRecentList');if(recent){
     for(const row of recent.querySelectorAll('.tw-list-row')){
       const label=row.querySelector('.tw-row-pill');
       if(label && label.textContent.trim().toLowerCase()==='closed')label.classList.add('tw-success');
     }
   }
 }
 function syncSidebar(){
   const val=Math.max(0,n($('twPendingStat')?.textContent)||0);
   const pending=$('pmSidebarPending');if(pending){pending.textContent=String(val);pending.hidden=val===0;}
   const source=$('teacherNotificationBadge');const count=Math.max(0,n(source?.textContent)||0);
   const target=$('pmSecondaryCount');if(target){target.textContent=String(count);target.hidden=source?.hidden!==false || count===0;}
 }
 function render(){
   if(!active())return;
   renderClassCards();refreshInlineIcons();syncSidebar();
   const mean=avgFor();
   const avg=$('pmClassAverage');if(avg)avg.textContent=mean===null?'—':`${mean.toFixed(1)}%`;
   const date=$('twTodayDate');if(date)date.textContent=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date());
   const name=String(state.profile?.display_name||'Teacher').trim();
   if($('twWelcomeName'))$('twWelcomeName').textContent=name;
   if($('twProfileName'))$('twProfileName').textContent=name;
   if($('pmAccountName'))$('pmAccountName').textContent=name;
 }
 // The original Mathside app and V26 layer already wrap this render function.
 // Keep their normal updates, then refresh the visual-only dashboard.
 if(typeof renderTeacher==='function'){
   const previous=renderTeacher;
   renderTeacher=function(...args){const result=previous(...args);render();return result;};
 }
 // Accessible search and original teacher workflows stay delegated to existing app.js.
 $('pmSidebarNotifications')?.addEventListener('click',()=>$('teacherNotificationBtn')?.click());
 $('pmAccountNotifications')?.addEventListener('click',()=>{$('pmAccountMenu').hidden=true;$('teacherNotificationBtn')?.click();});
 $('pmAccountSignout')?.addEventListener('click',()=>$('teacherSignout')?.click());
 $('pmAccountToggle')?.addEventListener('click',()=>{
   const menu=$('pmAccountMenu');menu.hidden=!menu.hidden;
   $('pmAccountToggle').setAttribute('aria-expanded',String(!menu.hidden));
 });
 document.addEventListener('click',e=>{
   if(!e.target.closest('#pmAccountToggle,#pmAccountMenu')){
     const menu=$('pmAccountMenu');if(menu)menu.hidden=true;
     $('pmAccountToggle')?.setAttribute('aria-expanded','false');
   }
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('pmAccountMenu'))$('pmAccountMenu').hidden=true;});
 // V28: the teacher Settings entry and its preferences popup have been retired.
 // Keep the sidebar notification badge in sync with the existing async notification refresh.
 const notif=$('teacherNotificationBadge');if(notif){new MutationObserver(syncSidebar).observe(notif,{attributes:true,childList:true,characterData:true,subtree:true});}
 if(active())render();
 window.MathsideTeacherPixelMatchV27={render};
})();
