/* ---- PWA: install prompt, offline badge, update flow ---- */

let deferredInstall=null;

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;const b=document.getElementById('installBtn');if(b)b.hidden=false});

window.addEventListener('appinstalled',()=>{deferredInstall=null;const b=document.getElementById('installBtn');if(b)b.hidden=true;showToast('FixFlow installed')});

function installApp(){if(!deferredInstall)return;deferredInstall.prompt();deferredInstall.userChoice.finally(()=>{deferredInstall=null;const b=document.getElementById('installBtn');if(b)b.hidden=true})}

function updateNet(){const el=document.getElementById('netBadge');if(el)el.hidden=navigator.onLine}

window.addEventListener('online',updateNet);window.addEventListener('offline',updateNet);

function showUpdateBar(reg){if(document.getElementById('updateBar'))return;const d=document.createElement('div');d.id='updateBar';d.className='update-bar';d.setAttribute('role','status');d.innerHTML='<span>A new version of FixFlow is ready.</span><button class="btn primary" type="button" id="updateBtn">Reload</button>';document.body.appendChild(d);document.getElementById('updateBtn').onclick=()=>{reg.waiting&&reg.waiting.postMessage('SKIP_WAITING')}}

if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)){
 const hadController=!!navigator.serviceWorker.controller;let refreshing=false;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!hadController||refreshing)return;refreshing=true;location.reload()});
 window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(reg=>{
  if(reg.waiting&&navigator.serviceWorker.controller)showUpdateBar(reg);
  reg.addEventListener('updatefound',()=>{const w=reg.installing;if(w)w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)showUpdateBar(reg)})});
 }).catch(()=>{}));
}

updateNet();
