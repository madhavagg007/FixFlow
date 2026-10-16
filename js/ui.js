/* Views, rendering and user actions. Handlers are global because the markup uses inline onclick. */
function dlg(title,o={}){return new Promise(res=>{const d=document.getElementById('dlg');document.getElementById('dlgTitle').textContent=title;document.getElementById('dlgBody').innerHTML=o.text?'<textarea id="dlgInput" style="min-height:90px"></textarea>':'';const inp=document.getElementById('dlgInput');if(inp){inp.value=o.value||'';inp.setAttribute('aria-label',title)}if(typeof d.showModal!=='function'){res(o.text?prompt(title,o.value||''):window.confirm(title));return}d.onclose=()=>res(d.returnValue==='ok'?(o.text?inp.value.trim():true):(o.text?null:false));d.returnValue='';d.showModal();inp&&inp.focus()})}

function evCount(){const n=(current.evidence||[]).length,f=(current.evidence||[]).filter((x,i)=>(current.evidenceVals?.[i]||'').trim()).length;return f+'/'+n+' filled'}

function setEvidence(i,v){current.evidenceVals=current.evidenceVals||{};current.evidenceVals[i]=v.trim();saveCurrent();const el=document.getElementById('evCount');if(el)el.textContent=evCount()}

/* Reads an image file and returns a resized JPEG blob (max 900px). Decodes via data: URLs so it also works under strict CSP. */
function readImg(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const k=Math.min(1,900/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.width*k));c.height=Math.max(1,Math.round(im.height*k));c.getContext('2d').drawImage(im,0,0,c.width,c.height);c.toBlob(b=>b?res(b):rej(new Error('encode failed')),'image/jpeg',.7)};im.onerror=rej;im.src=r.result};r.onerror=rej;r.readAsDataURL(file)})}

async function addAttachments(e){
 const files=[...e.target.files];e.target.value='';current.attachments=current.attachments||[];
 const useDb=await imageDB.isAvailable();
 for(const f of files){
  if(!f.type.startsWith('image/'))continue;
  if(current.attachments.length>=6){showToast('Maximum 6 images per case');break}
  try{
   const blob=await readImg(f),a={id:uid(),name:f.name.slice(0,60)};
   if(useDb){await imageDB.put(a.id,blob);a.idb=true}else a.data=await blobToDataUrl(blob);
   current.attachments.push(a);
   if(!saveCurrent()){current.attachments.pop();if(a.idb)imageDB.remove(a.id).catch(()=>{});break}
  }catch(err){showToast('Could not read '+f.name)}
 }
 renderPlan(playbooks[current.category].branches[current.branch]);
}

function removeAttachment(id){
 const a=(current.attachments||[]).find(x=>x.id===id);
 current.attachments=(current.attachments||[]).filter(x=>x.id!==id);saveCurrent();
 if(a&&a.idb){imageDB.remove(id).catch(()=>{});imageSrcCache.delete(id)}
 renderPlan(playbooks[current.category].branches[current.branch]);
}

async function viewAttachment(id){
 const a=(current.attachments||[]).find(x=>x.id===id);if(!a)return;
 const src=await imageSrc(a);if(!src)return;
 const d=document.getElementById('imgDlg');document.getElementById('imgDlgImg').src=src;
 typeof d.showModal==='function'?d.showModal():window.open(src);
}

function cancelCase(){if(current){syncContext();saveCurrent()}go('diagnose')}

let lastDeleted=null;
async function delCase(id){
 if(!await dlg('Delete this case?'))return;
 const i=state.cases.findIndex(c=>c.id===id);if(i<0)return;
 lastDeleted={c:state.cases[i],i};
 state.cases.splice(i,1);if(current&&current.id===id)current=null;
 save();renderHistory();renderHome();
 showToast('Case deleted',{action:'Undo',onAction:undoDelete});
 clearTimeout(window.__purgeTimer);window.__purgeTimer=setTimeout(()=>{lastDeleted=null;purgeOrphanImages().catch(()=>{})},8500);
}
function undoDelete(){
 if(!lastDeleted)return;
 const {c,i}=lastDeleted;lastDeleted=null;clearTimeout(window.__purgeTimer);
 state.cases.splice(Math.min(i,state.cases.length),0,c);
 save();renderHistory();renderHome();showToast('Case restored');
}
async function editDetails(){
 const t=await dlg('Case title',{text:true,value:current.title});if(t===null)return;
 const d=await dlg('Case description',{text:true,value:current.description});
 if(t)current.title=t;if(d)current.description=d;   /* an empty answer keeps the old text */
 saveCurrent();renderPlan(playbooks[current.category].branches[current.branch]);
}

async function addLog(){const n=await dlg('What happened just now? (optional)',{text:true});if(n===null)return;(current.log=current.log||[]).push({t:new Date().toISOString(),n});saveCurrent();renderPlan(playbooks[current.category].branches[current.branch])}

function safetyHtml(){return current&&current.severity==='safety'?'<div class="notice danger" role="alert" style="margin-top:12px"><b>Safety first.</b> If there is smoke, a burning or gas smell, sparks, flooding near electricity, or anyone could be hurt, stop now, move away and call your local emergency number. FixFlow gives general guidance only.</div>':''}

function extraNotices(){const w=Object.values(current.stepResults||{}).includes('worse')?'<div class="notice" role="alert"><b>Something got worse.</b> Pause the remaining steps and use <b>Reassess route</b> below, or contact support.</div>':'';const c=current.status==='closed'?`<div class="notice"><b>Closed: ${esc(OUT[current.outcome]||'recorded')}</b>${current.notes?'<br>'+esc(current.notes):''}</div>`:'';return safetyHtml()+w+c}

let histStatus='all',histCat='all';


const VIEW_TITLES={home:'FixFlow — Troubleshooting, made actionable',diagnose:'Diagnose — FixFlow',case:'Case — FixFlow',history:'History — FixFlow',analytics:'Insights — FixFlow'};
const VIEW_IDS=Object.keys(VIEW_TITLES);
function viewFromHash(){const m=/^#\/(\w+)$/.exec(location.hash);return m&&VIEW_IDS.includes(m[1])?m[1]:'home'}
/* Switches screen. Each screen gets its own history entry (so Back works), its own page title,
   and keyboard/screen-reader focus moves to its heading. */
function go(view,opts={}){
 if(current&&document.getElementById('case').classList.contains('active')&&view!=='case'){try{syncContext();saveCurrent()}catch(e){}}
 document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
 document.getElementById(view).classList.add('active');
 document.querySelectorAll('.nav').forEach(x=>{const on=x.dataset.view===view;x.classList.toggle('active',on);on?x.setAttribute('aria-current','page'):x.removeAttribute('aria-current')});
 if(view==='history')renderHistory();
 if(view==='analytics')renderAnalytics();
 if(view==='diagnose')renderDiagnoseCategories();
 if(view==='home')renderHome();
 document.title=VIEW_TITLES[view]||VIEW_TITLES.home;
 if(!opts.fromHistory&&!opts.silent&&location.hash!=='#/'+view){try{history.pushState({view},'','#/'+view)}catch(e){}}
 if(!opts.silent){const v=document.getElementById(view),h=v.querySelector('h1,h2,h3')||v;if(!h.hasAttribute('tabindex'))h.setAttribute('tabindex','-1');h.focus({preventScroll:true});window.scrollTo(0,0)}
}

document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>go(b.dataset.view));

function startCase(category=''){
 current={id:uid(),log:[],evidenceVals:{},attachments:[],created:new Date().toISOString(),updated:new Date().toISOString(),title:'',description:'',category:category||'other',symptom:'',answers:{},branch:'',steps:[],evidence:[],status:'open',outcome:null,notes:'',platform:'',device:'',quickChecks:{},stepResults:{},severity:'normal'};
 go('case');renderStage1();
}

function workflowBar(active){const steps=['Define','Diagnose','Act','Check'];return `<div class="workflow-bar">${steps.map((x,i)=>`<span class="workflow-step ${i+1<active?'done':''} ${i+1===active?'active':''}"><span class="dot">${i+1<active?'✓':i+1}</span>${x}</span>${i<3?'<span class="workflow-line"></span>':''}`).join('')}</div>`}

function renderStage1(){
 document.getElementById('caseStage').textContent='Step 1 · Define';document.getElementById('caseTitle').textContent='Define the problem';
 document.getElementById('caseBody').innerHTML=`${workflowBar(1)}
 <div class="card" style="box-shadow:none;background:var(--surface2);margin-bottom:16px"><b>Start with evidence, not guesses.</b><div class="small muted" style="margin-top:4px">Tell FixFlow what you expected, what actually happened, and what device or service is affected.</div></div>
 <div class="field"><label for="problemTitle">Short title</label><input id="problemTitle" value="${esc(current.title)}" placeholder="e.g. Wi-Fi keeps disconnecting"></div>
 <div class="field"><label for="problemDesc">What is happening?</label><textarea id="problemDesc" placeholder="What did you expect, what actually happened, and when did it begin?">${esc(current.description)}</textarea></div>
 <div class="context-grid"><div><div class="mini-label">Platform</div><select id="platform" aria-label="Platform"><option value="">Select</option><option>Android</option><option>iPhone / iPad</option><option>Windows</option><option>Mac</option><option>ChromeOS</option><option>Web / browser</option><option>Other</option></select></div><div><div class="mini-label">Device / service</div><input id="deviceName" aria-label="Device or service" placeholder="e.g. phone, laptop, router, website" value="${esc(current.device||'')}"></div><div><div class="mini-label">Urgency</div><select id="severity" aria-label="Urgency" onchange="syncContext();document.getElementById('safetyNote').innerHTML=safetyHtml()"><option value="normal">Normal</option><option value="important">Important — blocking work</option><option value="safety">Safety concern</option></select></div></div>
 <div id="safetyNote">${safetyHtml()}</div><div class="field" style="margin-top:16px"><label>Category</label><div class="chips">${categories.map(c=>`<button type="button" class="chip ${current.category===c.id?'selected':''}" onclick="pickCat('${c.id}')">${c.icon} ${c.name}</button>`).join('')}</div></div>
 <div class="field"><label>Choose the closest common problem</label><div class="problem-grid">${(commonProblems[current.category]||[]).map(s=>`<button type="button" class="problem-chip" onclick="pickSymptom('${s[0]}')"><span><b>${esc(s[1])}</b><small class="muted" style="display:block;margin-top:2px">${esc(s[2])}</small></span><span class="arrow">${current.symptom===s[0]?'✓':'›'}</span></button>`).join('')}</div></div>
 ${current.category==='household'?'<div class="notice">Household mode is limited to safe, visible, normal-user checks. Stop and get a trusted adult/professional for electricity, gas, fire, chemicals, structural hazards, or anything unsafe.</div>':''}
 <div class="actions"><button class="btn" onclick="runQuickChecks()">Run safe quick checks</button><button type="button" class="btn primary" data-action="continue-diagnosis">Continue →</button></div><div id="quickCheckArea"></div>`;
 document.getElementById('platform').value=current.platform||'';document.getElementById('severity').value=current.severity||'normal';if(Object.keys(current.quickChecks||{}).length)renderQuickChecks();
}

function syncContext(){const g=id=>document.getElementById(id);if(g('problemTitle'))current.title=g('problemTitle').value.trim();if(g('problemDesc'))current.description=g('problemDesc').value.trim();if(g('platform'))current.platform=g('platform').value;if(g('deviceName'))current.device=g('deviceName').value.trim();if(g('severity'))current.severity=g('severity').value}

function runQuickChecks(){syncContext();const checks=[{name:'Internet reachability',status:navigator.onLine?'Online according to browser':'Browser reports offline',kind:navigator.onLine?'good':'warn'},{name:'Browser',status:navigator.userAgent.includes('Chrome')?'Chrome-family browser detected':'Browser detected',kind:'good'},{name:'Screen / device',status:`${window.innerWidth}×${window.innerHeight} viewport`,kind:'good'}];if(navigator.connection){const n=navigator.connection;checks.push({name:'Connection',status:[n.effectiveType,n.downlink?n.downlink+' Mbps est.':'',n.rtt?n.rtt+' ms RTT':''].filter(Boolean).join(' · ')||'Available',kind:'good'})}current.quickChecks={base:checks};renderQuickChecks();saveCurrent();if(navigator.getBattery)navigator.getBattery().then(b=>{current.quickChecks.battery={name:'Battery',status:`${Math.round(b.level*100)}%${b.charging?' · charging':''}`,kind:'good'};renderQuickChecks();saveCurrent()}).catch(()=>{})}

function renderQuickChecks(){const el=document.getElementById('quickCheckArea');if(!el)return;const vals=[];if(current.quickChecks?.base)vals.push(...current.quickChecks.base);if(current.quickChecks?.battery)vals.push(current.quickChecks.battery);el.innerHTML=`<div class="card" style="box-shadow:none;margin-top:15px"><b>Safe quick checks</b><div class="small muted">Browser-level observations only; this is not a full hardware diagnostic.</div><div class="quick-checks">${vals.map(x=>`<div class="check-card ${x.kind||''}"><b>${esc(x.name)}</b><div class="check-status">${esc(x.status)}</div></div>`).join('')}</div></div>`}

function pickCat(id){syncContext();if(current.category!==id){current.answers={};current.branch='';current.steps=[];current.stepResults={};current.evidenceVals={}}current.category=id;current.symptom='';renderStage1()}

function pickSymptom(id){syncContext();current.symptom=id;if(!current.title){const p=(commonProblems[current.category]||[]).find(x=>x[0]===id);if(p)current.title=p[1]}renderStage1()}

function nextDiagnosis(){
 syncContext();
 const t=document.getElementById('problemTitle').value.trim(),d=document.getElementById('problemDesc').value.trim();
 if(!t||!d||!current.category||!current.symptom){showToast('Add a title and description, and pick the closest problem.');return}
 current.title=t;current.description=d;
 const qs=playbooks[current.category].questions;
 renderDiagnosisQuestions();
}

function setAnswer(i,a){current.answers[i]=a;renderDiagnosisQuestions()}

function renderDiagnosisQuestions(){
 const qs=playbooks[current.category].questions;
 document.getElementById('caseStage').textContent='Step 2 · Diagnose';
 document.getElementById('caseTitle').textContent='Answer the diagnostic questions';
 const chosenProblem=(commonProblems[current.category]||[]).find(x=>x[0]===current.symptom);
 document.getElementById('caseBody').innerHTML=`
 ${workflowBar(2)}<div class="card" style="box-shadow:none;background:var(--surface2);margin-bottom:15px"><span class="badge">${esc(categories.find(c=>c.id===current.category)?.name||'Topic')}</span><h3 style="margin:8px 0 4px">${esc(chosenProblem?.[1]||'Custom problem')}</h3><div class="small muted">${esc(chosenProblem?.[2]||'')}</div></div>
 <div class="notice safe"><b>How FixFlow works:</b> answer all questions, then analyze the pattern. Your selections stay visible while you work.</div>
 ${qs.map((x,i)=>`<div class="field"><label>${i+1}. ${esc(x.q)}</label><div class="chips">${[x.yes,x.no].map(a=>`<button type="button" aria-pressed="${current.answers[i]===a}" class="chip ${current.answers[i]===a?'selected':''}" onclick="setAnswer(${i},'${a}')">${(a===x.yes?x.yl:x.nl)||(a==='multi'?'Yes — more than one':a==='single'?'No — only one':a==='router'?'Router/device related':a==='persistent'?'Yes — persistent':a==='signal'?'Yes — signal related':a==='not-signal'?'No — not signal':a==='timing'?'Yes — happens at a pattern/time':a==='not-timing'?'No — no clear timing pattern':a==='broad'?'Many areas':a==='change'?'Yes — after a change':a==='nochange'?'No recent change':a==='restart'?'Yes — restart/reboot':a==='repeat'?'Yes — repeats':a==='error'?'Yes — error shown':a==='recent'?'Yes — recent change':a==='browser'?'Only this browser/device':a==='notbrowser'?'Not limited to browser':a==='local'?'One device/location':a==='noerror'?'No clear error':a==='clear'?'Yes — clear next task':a==='unclear'?'No — unclear':a==='distraction'?'Yes — distraction':a==='internal'?'No — internal/friction':a==='recall'?'Yes — recall issue':a==='weakrecall'?'No — not mainly recall':a==='hazard'?'Yes — possible hazard':a==='stop'?'Yes — stop condition':a==='visible'?'Yes — visible only':a==='safe'?'No — safe to continue':a==='compare'?'Yes — comparison available':a==='nocompare'?'No comparison':a==='norecent'?'No recent change':a==='intermittent'?'No — intermittent':a)}</button>`).join('')}</div></div>`).join('')}
 <div id="diagnosisMessage" class="notice safe" style="display:none"></div><div class="actions"><button type="button" class="btn primary" data-action="build-plan">Analyze & build plan →</button><button type="button" class="btn" onclick="renderStage1()">Back</button></div>`;
}

function buildPlan(){
 try{
  if(!current||!current.category){throw new Error('No active case category.');}
  const pb=playbooks[current.category];
  if(!pb||!Array.isArray(pb.questions)){throw new Error('This troubleshooting category is not configured correctly.');}
  const missing=missingAnswers(pb.questions,current.answers);
  if(missing.length){
   const msg=document.getElementById('diagnosisMessage');
   if(msg){msg.textContent=`Answer question${missing.length>1?'s':''} ${missing.join(', ')} before analyzing.`;msg.className='notice';msg.style.display='block';}
   return;
  }
  let b=routeBranch(current.category,current.answers||{});
  if(!pb.branches?.[b])b=Object.keys(pb.branches||{})[0];
  const branch=pb.branches?.[b];
  if(!branch){throw new Error(`No troubleshooting route is configured for ${current.category}.`);}
  current.branch=b;
  current.steps=buildSteps(playbooks,current.category,b);
  current.evidence=Array.isArray(pb.evidence)?pb.evidence:[];
  current.status='in-progress';
  saveCurrent();
  renderPlan(branch);
 }catch(err){
  console.error('FixFlow buildPlan error:',err);
  const body=document.getElementById('caseBody');
  if(body)body.insertAdjacentHTML('afterbegin',`<div class="notice" role="alert"><b>FixFlow could not build this plan.</b><br>${esc(err.message||'Unexpected error.')} Please try the current answers again.</div>`);
 }
}

function renderPlan(branch){
 const done=current.steps.filter(s=>s.done).length,pct=current.steps.length?Math.round(done/current.steps.length*100):0;document.getElementById('caseStage').textContent='Step 3 · Act';document.getElementById('caseTitle').textContent=branch.title;
 document.getElementById('caseBody').innerHTML=`${workflowBar(3)}${extraNotices()}<div class="notice safe"><b>Why this route?</b> ${esc(branch.why)}</div><div class="card" style="box-shadow:none;background:var(--surface2);margin-bottom:16px"><b>Case snapshot</b><div class="chips" style="margin-top:9px"><span class="badge">${esc(categories.find(c=>c.id===current.category)?.name||current.category)}</span>${current.platform?`<span class="badge">${esc(current.platform)}</span>`:''}${current.device?`<span class="badge">${esc(current.device)}</span>`:''}</div><div style="margin-top:10px"><b>${esc(current.title||'Untitled case')}</b><div class="small muted">${esc(current.description)}</div></div><div class="actions" style="margin-top:8px"><button type="button" class="btn" onclick="editDetails()">Edit title &amp; description</button></div></div><div class="card" style="box-shadow:none;background:var(--surface2);margin-bottom:18px"><div style="display:flex;justify-content:space-between;gap:10px"><b>Evidence to collect</b><span class="small muted" id="evCount">${evCount()}</span></div><div class="small muted">Fill in what you know. It goes into your support summary.</div><div class="ev-grid">${(current.evidence||[]).map((x,i)=>`<div><div class="mini-label">${esc(x)}</div><input aria-label="${esc(x)}" value="${esc(current.evidenceVals?.[i]||'')}" onchange="setEvidence(${i},this.value)"></div>`).join('')}</div></div><div class="card" style="box-shadow:none;margin-bottom:18px"><b>Photos &amp; screenshots</b><div class="small muted">Attach up to 6 images (an error screen, a label, the affected area). They stay on this device.</div><div class="thumbs">${(current.attachments||[]).map(a=>`<div class="thumb"><img src="${a.data||'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}" ${a.data?'':`data-att="${a.id}"`} alt="${esc(a.name)}" onclick="viewAttachment('${a.id}')"><button type="button" aria-label="Remove ${esc(a.name)}" onclick="removeAttachment('${a.id}')">×</button></div>`).join('')}</div><div class="actions" style="margin-top:10px"><button type="button" class="btn" onclick="document.getElementById('attachFile').click()">+ Add photo / screenshot</button><input id="attachFile" aria-label="Add photos or screenshots" type="file" accept="image/*" multiple hidden onchange="addAttachments(event)"></div></div><div style="display:flex;justify-content:space-between"><b>Action progress</b><span>${done}/${current.steps.length}</span></div><div class="progress" style="margin:8px 0 14px"><i style="width:${pct}%"></i></div>${current.steps.map((s,i)=>{const result=current.stepResults?.[i]||'';return `<div class="step ${s.done?'done':''}"><div class="num">${s.done?'✓':i+1}</div><div style="flex:1"><div class="steptext"><b>${esc(s.text)}</b></div>${(()=>{const dt=s.detail||detailFor(playbooks,current.category,current.branch,i);return dt?`<div class="small muted" style="margin-top:4px">${esc(dt)}</div>`:''})()}<div class="result-row"><span class="small muted" style="align-self:center">Result:</span><button aria-pressed="${result==='helped'}" class="result-btn ${result==='helped'?'selected':''}" onclick="setStepResult(${i},'helped')">✓ Helped</button><button class="result-btn ${result==='same'?'selected':''}" onclick="setStepResult(${i},'same')">No change</button><button class="result-btn ${result==='worse'?'selected':''}" onclick="setStepResult(${i},'worse')">New / worse</button></div>${s.note?`<div class="small" style="margin-top:7px"><b>Observation:</b> ${esc(s.note)}</div>`:''}<div class="actions" style="margin-top:8px"><button class="btn" onclick="toggleStep(${i})">${s.done?'Mark incomplete':'Mark complete'}</button><button class="btn" onclick="noteStep(${i})">${s.note?'Edit observation':'Add observation'}</button></div></div></div>`}).join('')}<div class="card" style="box-shadow:none;margin-top:16px"><h3>Incident log</h3><p class="muted small">Add a timestamp each time the problem happens. Patterns are the best evidence.</p>${(current.log||[]).map(l=>`<div class="small" style="padding:3px 0">• ${esc(fmt(l.t))}${l.n?' — '+esc(l.n):''}</div>`).join('')}<div class="actions" style="margin-top:8px"><button class="btn" onclick="addLog()">+ Log it happening now</button></div></div><div class="card" style="box-shadow:none;background:var(--surface2);margin-top:16px"><h3>Decision checkpoint</h3><p class="muted">Record what happened before continuing. If the result is <b>New / worse</b>, pause and reassess instead of blindly doing the remaining steps.</p><div class="actions"><button class="btn" onclick="reassessCase()">Reassess route</button></div></div><div class="actions"><button class="btn primary" onclick="finishCase()">Record outcome →</button><button class="btn" onclick="printReport()">Save as PDF</button><button class="btn" onclick="saveCurrent();go('history')">Save & exit</button></div>`;
}

function setStepResult(i,result){current.stepResults=current.stepResults||{};current.stepResults[i]=result;if(result==='helped')current.steps[i].done=true;saveCurrent();renderPlan(playbooks[current.category].branches[current.branch])}

function reassessCase(){current.branch='';current.steps=[];current.stepResults={};current.status='open';saveCurrent();renderDiagnosisQuestions()}

function toggleStep(i){current.steps[i].done=!current.steps[i].done;saveCurrent();renderPlan(playbooks[current.category].branches[current.branch])}

async function noteStep(i){const n=await dlg('What did you observe after this step?',{text:true,value:current.steps[i].note||''});if(n!==null){current.steps[i].note=n;saveCurrent();renderPlan(playbooks[current.category].branches[current.branch])}}

function buildSupportSummary(){return summaryText(current,{categories,commonProblems,playbooks})}

async function copySupportSummary(){const text=buildSupportSummary();try{await navigator.clipboard.writeText(text);showToast('Support summary copied')}catch(e){prompt('Copy this support summary:',text)}}

function finishCase(){document.getElementById('caseStage').textContent='Step 4 · Check';document.getElementById('caseTitle').textContent='Check the outcome';document.getElementById('caseBody').innerHTML=`${workflowBar(4)}<div class="card" style="box-shadow:none;background:var(--surface2)"><h3>What happened after testing?</h3><p class="muted">Choose the outcome, then keep the evidence. A good troubleshooting record is useful even when the problem is not solved yet.</p><div class="actions"><button class="btn primary" onclick="completeCase('resolved')">✓ Resolved</button><button class="btn" onclick="completeCase('partial')">Partly helped</button><button class="btn" onclick="completeCase('unresolved')">Still unresolved</button></div><div class="field" style="margin-top:18px"><label for="outcomeNote">What did you learn?</label><textarea id="outcomeNote" placeholder="What worked, failed, or should be tried next?">${esc(current.notes||'')}</textarea></div><div class="actions"><button class="btn" onclick="copySupportSummary()">Copy support summary</button><button class="btn" onclick="printReport()">Save as PDF</button><button class="btn ghost" onclick="renderPlan(playbooks[current.category].branches[current.branch])">← Back to steps</button></div></div>`}

function completeCase(outcome){
 current.status='closed';current.outcome=outcome;current.closed=new Date().toISOString();
 current.notes=(document.getElementById('outcomeNote')?.value||'').trim();
 saveCurrent();
 document.getElementById('caseStage').textContent='Complete';
 document.getElementById('caseTitle').textContent=outcome==='resolved'?'Problem resolved':'Outcome recorded';
 document.getElementById('caseBody').innerHTML=`
 <div class="notice ${outcome==='resolved'?'safe':''}"><b>${outcome==='resolved'?'✓ Resolved':'• '+(outcome==='partial'?'Partially resolved':'Unresolved')}</b><br>Your case is now part of FixFlow history.</div>
 <div class="actions"><button class="btn primary" onclick="go('home')">Back home</button><button class="btn" onclick="go('history')">View history</button></div>`;
}

function renderHistory(){const el=document.getElementById('historyList');if(!state.cases.length){el.innerHTML='<div class="empty">No cases yet. Start with a real problem and FixFlow will keep the troubleshooting record here.</div>';return}const q0=document.getElementById('historySearch')?.value||'',st=[['all','All'],['open','In progress'],['resolved','Resolved'],['partial','Partly helped'],['unresolved','Unresolved']];el.innerHTML=`<div class="search-history"><input id="historySearch" aria-label="Search cases" placeholder="Search your cases…" oninput="filterHistory()"></div><div class="chips" style="margin-bottom:10px">${st.map(x=>`<button type="button" aria-pressed="${histStatus===x[0]}" class="chip ${histStatus===x[0]?'selected':''}" onclick="histStatus='${x[0]}';renderHistory()">${x[1]}</button>`).join('')}</div><div class="field" style="max-width:260px"><select id="histCat" aria-label="Filter by category" onchange="histCat=this.value;filterHistory()"><option value="all">All categories</option>${categories.map(c=>`<option value="${c.id}" ${histCat===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div id="historyResults"></div>`;document.getElementById('historySearch').value=q0;filterHistory()}

function filterHistory(){const q=(document.getElementById('historySearch')?.value||'').toLowerCase().trim();const list=filterCases(state.cases,{query:q,status:histStatus,category:histCat});const el=document.getElementById('historyResults');if(!el)return;el.innerHTML=list.length?list.map(c=>`<div class="history-item"><div><b>${esc(c.title||'Untitled case')}</b><div class="small muted">${esc(fmt(c.created))} • ${esc(categories.find(x=>x.id===c.category)?.name||c.category)}</div><div class="small muted">${c.steps?.filter(s=>s.done).length||0}/${c.steps?.length||0} steps completed${c.branch?' • '+esc(playbooks[c.category]?.branches[c.branch]?.title||''):''}</div></div><div style="display:flex;gap:7px;align-items:flex-start"><span class="badge ${c.outcome==='resolved'?'good':c.status!=='closed'?'resume-badge':''}">${esc(OUT[c.outcome]||'In progress')}</span><button class="btn" onclick="openCase('${c.id}')">${c.status==='closed'?'Open':'Resume'}</button><button class="btn" aria-label="Save case as PDF" onclick="printCaseById('${c.id}')">PDF</button><button class="btn danger" aria-label="Delete case" onclick="delCase('${c.id}')">Delete</button></div></div>`).join(''):`<div class="empty">No matching cases.</div>`}

function openCase(id){const c=state.cases.find(x=>x.id===id);if(!c)return;current=JSON.parse(JSON.stringify(c));go('case');if(current.branch&&playbooks[current.category]?.branches[current.branch])renderPlan(playbooks[current.category].branches[current.branch]);else renderStage1()}

function renderAnalytics(){
 const s=computeStats(state.cases);
 document.getElementById('stats').innerHTML=[
  ['Cases',s.total],['Resolved',s.resolved],['Partial',s.partial],['Open',s.open],
  ['Resolution rate',s.resolutionRate===null?'—':s.resolutionRate+'%'],
  ['Step completion',s.stepCompletion===null?'—':s.stepCompletion+'%']
 ].map(x=>`<div class="card"><div class="muted">${x[0]}</div><div class="stat">${x[1]}</div></div>`).join('');
 document.getElementById('categoryBreakdown').innerHTML=categories.map(c=>{
  const n=s.byCategory[c.id]||0,p=s.total?Math.round(n/s.total*100):0;
  return `<div style="margin:14px 0"><div style="display:flex;justify-content:space-between"><span>${c.icon} ${c.name}</span><b>${n}</b></div><div class="progress"><i style="width:${p}%"></i></div></div>`;
 }).join('');
}

/* Backups embed photos as data URLs so a backup file is complete on its own. */
async function buildExportJson(){
 const copy=JSON.parse(JSON.stringify(state));
 for(const c of copy.cases){
  const out=[];
  for(const a of c.attachments||[]){const data=await imageSrc(a);if(data)out.push({id:a.id,name:a.name,data})}
  c.attachments=out;
 }
 return JSON.stringify(copy,null,2);
}
async function exportData(){
 const blob=new Blob([await buildExportJson()],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='fixflow-v2-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}

function importData(e){
 const f=e.target.files[0];if(!f)return;
 const r=new FileReader();
 r.onload=async()=>{
  try{
   const x=JSON.parse(r.result);
   if(!x||!Array.isArray(x.cases))throw Error();
   const inc=x.cases.map(c=>normalizeCase(c,CATEGORY_IDS)).filter(Boolean);await moveInlineImagesToDb(inc);
   state={version:2,cases:mergeCases(state.cases,inc),settings:state.settings||{}};
   save();renderAnalytics();renderHome();
   showToast('Imported '+inc.length+' case(s), merged with existing');
  }catch(err){showToast('That file is not a valid FixFlow backup.')}
 };
 r.readAsText(f);e.target.value='';
}

function showToast(message,opts={}){
 const t=document.getElementById('toast');if(!t)return;
 t.textContent=message;
 if(opts.action){const b=document.createElement('button');b.type='button';b.className='toast-action';b.textContent=opts.action;b.onclick=()=>{t.classList.remove('show');opts.onAction()};t.append(' ',b)}
 t.classList.toggle('has-action',!!opts.action);t.classList.add('show');
 clearTimeout(window.__fixflowToast);window.__fixflowToast=setTimeout(()=>t.classList.remove('show'),opts.action?8000:2200);
}

function toggleTheme(){const dark=document.documentElement.classList.toggle('dark');localStorage.setItem('fixflow_theme',dark?'dark':'light');const b=document.getElementById('themeToggle');if(b){b.textContent=dark?'☀':'☾';b.title=dark?'Use light theme':'Use dark theme'}}

function initTheme(){const t=localStorage.getItem('fixflow_theme'),dark=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',dark);const b=document.getElementById('themeToggle');if(b){b.textContent=dark?'☀':'☾';b.title=dark?'Use light theme':'Use dark theme'}b?.addEventListener('click',toggleTheme)}

function renderResumeBanner(){const el=document.getElementById('resumeBanner');if(!el)return;const open=state.cases.find(c=>c.status!=='closed');if(!open){el.innerHTML='';return}const cat=categories.find(x=>x.id===open.category)?.name||open.category;el.innerHTML=`<div class="resume-banner"><div class="resume-copy"><span class="badge">Resume case</span><b>${esc(open.title||'Untitled case')}</b><span class="small muted">${esc(cat)} · ${open.steps?.length?((open.steps.filter(x=>x.done).length)+'/'+open.steps.length+' steps'): 'Not started'}</span></div><div class="actions"><button class="btn" type="button" onclick="openCase('${open.id}')">Resume</button><button class="btn ghost" type="button" onclick="dismissResume()">Dismiss</button></div></div>`}

function dismissResume(){const el=document.getElementById('resumeBanner');if(el)el.innerHTML=''}

function renderHome(){
 renderResumeBanner();
 const q=document.getElementById('quickAccess');
 if(q) q.innerHTML=categories.slice(0,6).map(c=>`<button type="button" class="quick-card" data-action="open-category" data-category="${c.id}"><span class="quick-icon">${c.icon}</span><span><b>${esc(c.name)}</b><small>${esc(c.depth)}</small></span><span class="arrow">›</span></button>`).join('');
 const r=document.getElementById('recentHome');
 if(!r)return;
 const recent=state.cases.slice(0,3);
 r.innerHTML=recent.length?recent.map(c=>`<div class="history-item"><div><b>${esc(c.title||'Untitled case')}</b><div class="small muted">${esc(categories.find(x=>x.id===c.category)?.name||c.category)} · ${new Date(c.created).toLocaleDateString()}</div></div><button class="btn" onclick="openCase('${c.id}')">Open</button></div>`).join(''):`<div class="card recent-card muted">No cases yet. Start with a real problem and FixFlow will keep the troubleshooting record here.</div>`;
}

function renderDiagnoseCategories(){
 const dir=document.getElementById('categoryDirectory');
 const panel=document.getElementById('diagnoseProblems');
 if(!dir||!panel)return;
 dir.hidden=false; panel.hidden=true;
 dir.innerHTML=categories.map(c=>`<button type="button" class="category-card" data-action="open-category" data-category="${c.id}"><span class="cat-icon">${c.icon}</span><span><b>${esc(c.name)}</b><div class="small muted">${esc(c.depth)} · ${(commonProblems[c.id]||[]).length} common problems</div></span><span class="arrow">›</span></button>`).join('');
}

function openCategory(category){
 const c=categories.find(x=>x.id===category);
 if(!c)return;
 // Always enter the Diagnose section first. This fixes Quick Access cards
 // on Home, which previously rendered their panel inside a hidden section.
 go('diagnose');
 const dir=document.getElementById('categoryDirectory'),panel=document.getElementById('diagnoseProblems');
 if(!dir||!panel)return;
 dir.hidden=true;panel.hidden=false;
 const problems=commonProblems[category]||[];
 panel.innerHTML=`<div class="section-top"><div><h3>${c.icon} ${esc(c.name)}</h3><span class="small muted">Choose the closest real symptom.</span></div><button class="btn" onclick="renderDiagnoseCategories()">← Categories</button></div><div class="diagnose-toolbar"><input id="problemSearch" placeholder="Search problems…" autocomplete="off" oninput="filterProblems('${category}')"><button class="btn primary" onclick="startCase('${category}')">Describe another problem</button></div><div id="problemList" class="problem-list">${problemRows(category,problems)}</div>`;
 panel.scrollIntoView({behavior:'smooth',block:'start'});
}

function problemRows(category,problems){
 return problems.map(x=>`<button type="button" class="problem-row" data-action="start-specific" data-category="${category}" data-symptom="${x[0]}"><span class="picon">${categories.find(c=>c.id===category)?.icon||'?'}</span><span><b>${esc(x[1])}</b><div class="small muted">${esc(x[2])}</div></span><span class="arrow">›</span></button>`).join('');
}

function filterProblems(category){
 const q=(document.getElementById('problemSearch')?.value||'').toLowerCase().trim();
 const list=(commonProblems[category]||[]).filter(x=>x.join(' ').toLowerCase().includes(q));
 const el=document.getElementById('problemList');
 if(el)el.innerHTML=list.length?problemRows(category,list):`<div class="card muted" style="grid-column:1/-1;text-align:center">No matching problem. Try a different search or describe it yourself.</div>`;
}

function startSpecific(category,symptom){
 startCase(category);
 pickSymptom(symptom);
}

/* ---- PDF / print report ---- */
async function attachmentDataUrls(c){
 const out=[];
 for(const a of c.attachments||[]){const data=await imageSrc(a);if(data)out.push({name:a.name,data})}
 return out;
}
async function renderReport(c=current){
 if(!c)return null;
 const imgs=await attachmentDataUrls(c);
 let box=document.getElementById('printReport');
 if(!box){box=document.createElement('section');box.id='printReport';box.setAttribute('aria-hidden','true');document.body.appendChild(box)}
 box.innerHTML=reportHtml(c,{categories,commonProblems,playbooks},imgs);
 await Promise.all([...box.querySelectorAll('img')].map(i=>i.decode().catch(()=>{})));
 return box;
}
async function printReport(c=current){
 const box=await renderReport(c);if(!box)return;
 const old=document.title;document.title='FixFlow report - '+(c.title||'case').slice(0,60);
 const restore=()=>{document.title=old;window.removeEventListener('afterprint',restore)};
 window.addEventListener('afterprint',restore);
 window.print();
}
function printCaseById(id){const c=state.cases.find(x=>x.id===id);if(c)printReport(c)}
