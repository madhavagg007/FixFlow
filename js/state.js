/* App state and persistence (localStorage). Loaded after data.js and core.js. */
const KEY='fixflow_v1';
const CATEGORY_IDS=categories.map(c=>c.id);

const APP_VERSION=2;

function defaultState(){return {version:2,cases:[],settings:{}}}

let stateRecovered=false; /* true when saved data was unreadable and a fresh state was created */
function load(){let raw=null;try{raw=localStorage.getItem(KEY);const x=JSON.parse(raw);if(x&&x.version===2&&Array.isArray(x.cases)){x.cases=x.cases.map(c=>normalizeCase(c,CATEGORY_IDS)).filter(Boolean);return x}}catch(e){}
 if(raw){stateRecovered=true;try{localStorage.setItem(KEY+'_backup',raw)}catch(e){}}return defaultState()}

let state=load(),current=null;

function save(){try{localStorage.setItem(KEY,JSON.stringify(state));return true}catch(e){showToast('Could not save: browser storage is full or blocked');return false}}

function saveCurrent(){if(!current.title&&!current.description&&!(current.steps||[]).length)return false;current.updated=new Date().toISOString();const i=state.cases.findIndex(c=>c.id===current.id);if(i>=0)state.cases[i]=current;else state.cases.unshift(current);return save()}
