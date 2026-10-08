/* Accessible, consistent password visibility icon (no emoji) */
(() => {
 const eye = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
 const off = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.6 5.1A11.5 11.5 0 0 1 12 5c6.4 0 10 7 10 7a14 14 0 0 1-3.1 3.8M6.3 6.3C3.6 8.2 2 12 2 12s3.6 7 10 7a10.4 10.4 0 0 0 5.1-1.3"/><path d="M10 10a3 3 0 0 0 4 4"/><path d="M3 3l18 18"/></svg>`;
 document.querySelectorAll('[data-password-target]').forEach(btn => {
   btn.innerHTML = eye;
   btn.setAttribute('aria-label','Show password');
   btn.removeAttribute('aria-pressed');
 });
 document.addEventListener('click', event => {
   const btn=event.target.closest('[data-password-target]');
   if(!btn)return;
   const input=document.getElementById(btn.dataset.passwordTarget);
   if(!input)return;
   const show=input.type==='password';
   input.type=show?'text':'password';
   btn.innerHTML=show?off:eye;
   btn.setAttribute('aria-label',show?'Hide password':'Show password');
   input.focus({preventScroll:true});
 });
 window.addEventListener('pagehide', () => {
   document.querySelectorAll('[data-password-target]').forEach(btn=>{
     const input=document.getElementById(btn.dataset.passwordTarget);
     if(input)input.type='password';
     btn.innerHTML=eye;btn.setAttribute('aria-label','Show password');
   });
 });
})();
