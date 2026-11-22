/* V46: preview the selected class banner; the existing create-class handlers
   insert theme_id atomically with the new section. */
(() => {
 'use strict';
 const form=document.getElementById('sectionForm');
 const gallery=document.getElementById('ms46ThemeChoices');
 const selectedImage=document.getElementById('ms46ThemePreview');
 const selectedName=document.getElementById('ms46ThemeName');
 if(!form || !gallery || !selectedImage || !selectedName)return;
 const allowed=window.MathsideClassDesignsV44?.themes || [];
 function syncPreview(){
   const input=form.querySelector('input[name="theme_id"]:checked');
   const theme=allowed.find(t=>t.id===input?.value);
   if(theme){selectedImage.src=theme.file;selectedName.textContent=theme.label;}
 }
 form.addEventListener('change',e=>{if(e.target.matches('input[name="theme_id"]'))syncPreview();});
 form.addEventListener('reset',()=>{gallery.open=false;queueMicrotask(syncPreview);});
 gallery.querySelectorAll('img[loading="lazy"]').forEach(img=>{img.addEventListener('error',()=>{img.classList.add('ms46-image-missing');});});
 syncPreview();
})();
