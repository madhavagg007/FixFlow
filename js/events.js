/* Global event wiring. */
document.addEventListener('click', function(e){
 const el=e.target.closest('[data-action]');
 if(!el)return;
 const action=el.dataset.action;
 if(action==='open-category'){
   e.preventDefault();
   openCategory(el.dataset.category);
   return;
 }
 if(action==='new-case'){
   e.preventDefault();
   startCase('other');
   return;
 }
 if(action==='open-history'){
   e.preventDefault();
   go('history');
   return;
 }
 if(action==='continue-diagnosis'){
   e.preventDefault();
   nextDiagnosis();
   return;
 }
 if(action==='start-specific'){
   e.preventDefault();
   startSpecific(el.dataset.category,el.dataset.symptom);
   return;
 }
 if(action==='build-plan'){
   e.preventDefault();
   buildPlan();
   return;
 }
});

// Keep category navigation working even when the app is opened from a file/preview
// environment where inline onclick handlers may be restricted.

window.addEventListener('error', function(e){ console.error('FixFlow error:', e.error || e.message); });

window.addEventListener('storage',e=>{if(e.key===KEY){state=load();renderHome()}});

/* ---- Back/forward buttons and deep links ---- */
window.addEventListener('popstate',()=>{let v=viewFromHash();if(v==='case'&&!current)v='home';go(v,{fromHistory:true})});

/* ---- Autosave drafts while typing, so a reload or closed tab never loses the case ---- */
let draftTimer=null;
function flushDraft(){clearTimeout(draftTimer);draftTimer=null;if(current&&document.getElementById('case').classList.contains('active')&&document.getElementById('problemTitle')){try{syncContext();saveCurrent()}catch(e){}}}
document.addEventListener('input',e=>{if(e.target.matches&&e.target.matches('#problemTitle,#problemDesc,#deviceName,#platform,#severity')){clearTimeout(draftTimer);draftTimer=setTimeout(flushDraft,500)}});
window.addEventListener('pagehide',flushDraft);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushDraft()});

/* ---- Skip link (a plain #main link would collide with the #/view routes) ---- */
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a.skip');if(!a)return;e.preventDefault();document.getElementById('main').focus()});
