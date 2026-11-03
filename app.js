import {checkBundle,decryptBundle,importSecret} from './crypto.js';
import {loadVault,saveVault} from './vault.js';
import {scanQRCode} from './scanner.js';

const $ = id => document.getElementById(id);
const fmt = number => Number(number).toLocaleString('en-US');
const PAGE_SIZE=80;
let records=null,matched=[],shown=0,searchTimer=0;
let provisioning=false;
let pending={dataBytes:null,keyText:null};

function normalize(value) {
  return String(value||'').trim().toLocaleLowerCase().replaceAll('ς','σ');
}
function setTheme(theme) {
  document.documentElement.dataset.theme=theme;
  try{localStorage.setItem('rf-theme',theme);}catch{}
  $('themeToggle').setAttribute('aria-label',
    theme==='dark'?'Switch to light mode':'Switch to dark mode');
}
function initializeTheme(){
  let saved;
  try{saved=localStorage.getItem('rf-theme');}catch{}
  setTheme(saved==='light'||saved==='dark'?saved:
    matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
}
function setNotice(message,error=false){
  const notice=$('notice');
  notice.textContent=message||'';
  notice.classList.toggle('error',!!error);
  notice.hidden=!message;
}
function setSetupNotice(message,error=false){
  const element=$('setupNotice');
  element.textContent=message||'';
  element.classList.toggle('error',!!error);
  element.hidden=!message;
}
function setReady(data){
  records=data;
  pending={dataBytes:null,keyText:null};
  $('setupScreen').hidden=true;
  $('searchScreen').hidden=false;
  $('searchInput').value='';
  $('searchInput').disabled=false;
  $('searchButton').disabled=false;
  $('recordCount').textContent=fmt(data.length)+' records available';
  $('resultArea').hidden=true;
  $('resultList').replaceChildren();
  setNotice('');
}
function setNeedsSetup(message=''){
  records=null;
  $('setupScreen').hidden=false;
  $('searchScreen').hidden=true;
  $('resultArea').hidden=true;
  $('resultList').replaceChildren();
  setSetupNotice(message);
  refreshSetup();
}
function refreshSetup(){
  const hasData=!!pending.dataBytes;
  const hasKey=!!pending.keyText;
  $('dataState').textContent=hasData?'Encrypted file verified':'Not selected';
  $('keyState').textContent=hasKey?'Secret QR verified':'Not scanned';
  $('importData').disabled=provisioning;
  $('scanKey').disabled=!hasData||provisioning;
  $('installData').disabled=!hasData||!hasKey||provisioning;
}

async function scanKey(){
  if(provisioning||!pending.dataBytes)return;
  setSetupNotice('');
  $('cameraTitle').textContent='Scan secret QR';
  try{
    const text=await scanQRCode($('cameraLayer'),$('cameraVideo'),
      $('cameraCancel'),$('cameraHint'),true);
    if(!text)return;
    if(!/^RFKEY1:[A-Za-z0-9_-]{43}$/.test(text))
      throw new Error('This QR contains a link, not the secret key. Scan the administrator direct-key QR.');
    await importSecret(text);
    pending.keyText=text;
    refreshSetup();
    setSetupNotice('Secret key verified. Ready to complete setup.');
  }catch(e){setSetupNotice(e?.message||'Unable to scan the key QR.',true);}
}

async function importLocal(file){
  if(!file||provisioning)return;
  const limit=25*1024*1024;
  setSetupNotice('Checking selected file…');
  try{
    if(file.size>limit)
      throw new Error('Selected file is '+file.size.toLocaleString('en-US')+
        ' bytes, exceeding the 25 MB limit.');
    // Read the actual bytes: iOS Files providers can report size=0 incorrectly.
    const bytes=await file.arrayBuffer();
    if(bytes.byteLength===0)
      throw new Error('The selected file is empty (0 bytes). Download the complete .rfdb file into Files, then select it again.');
    if(bytes.byteLength>limit)
      throw new Error('The selected file exceeds the 25 MB limit.');
    if(bytes.byteLength<36)
      throw new Error('The selected file contains only '+bytes.byteLength+
        ' bytes. The encrypted download is incomplete.');
    const signature=new TextDecoder().decode(bytes.slice(0,8));
    if(signature!=='RFDATA01'){
      const hint=signature.startsWith('PK')?'A ZIP archive was selected. Extract the .rfdb file first.':
        signature.startsWith('<')?'A web page was selected instead of the encrypted .rfdb file.':
        'The selected file is not the expected encrypted .rfdb package.';
      throw new Error(hint);
    }
    checkBundle(bytes);
    pending.dataBytes=bytes;
    refreshSetup();
    setSetupNotice('Encrypted data verified ('+
      bytes.byteLength.toLocaleString('en-US')+' bytes). Scan the secret QR next.');
  }catch(e){
    pending.dataBytes=null;
    pending.keyText=null;
    refreshSetup();
    setSetupNotice(e?.message||'Unable to read the selected file.',true);
  }
}

async function install(){
  if(provisioning||!pending.dataBytes||!pending.keyText)return;
  provisioning=true;
  refreshSetup();
  setSetupNotice('Decrypting and verifying local data…');
  try{
    const key=await importSecret(pending.keyText);
    const bytes=pending.dataBytes;
    const data=await decryptBundle(bytes,key);
    setSetupNotice('Saving encrypted data on this device…');
    await saveVault(bytes,key);
    try{await navigator.storage?.persist?.();}catch{}
    setReady(data);
  }catch(e){
    setSetupNotice(e?.message||'Setup could not be completed.',true);
  }finally{
    provisioning=false;
    refreshSetup();
  }
}
function line(label,text){
  const row=document.createElement('div');row.className='result-line';
  const heading=document.createElement('span');heading.className='line-label';heading.textContent=label;
  const value=document.createElement('span');value.textContent=text||'—';
  row.append(heading,value);return row;
}
function more(){
  const fragment=document.createDocumentFragment();
  const next=Math.min(matched.length,shown+PAGE_SIZE);
  for(let i=shown;i<next;i++){
    const item=matched[i];
    const article=document.createElement('article');article.className='result-item';
    const first=document.createElement('div');first.className='result-primary';
    first.textContent='SIN '+(item[1]||'—')+(item[2]?'  ·  '+item[2]:'');
    article.append(first,line('AM',item[3]),line('SE',item[4]));
    fragment.append(article);
  }
  $('resultList').append(fragment);
  shown=next;
  $('showMore').hidden=shown>=matched.length;
}
function clearResults(){
  matched=[];shown=0;
  $('resultList').replaceChildren();
  $('resultArea').hidden=true;
}
function search(allowShort=false){
  if(!records)return;
  const q=normalize($('searchInput').value);
  if(!q||(!allowShort&&q.length<4)){clearResults();return;}
  matched=[];
  for(const record of records){
    if(record[5].some(term=>term.includes(q)))matched.push(record);
  }
  shown=0;
  $('resultList').replaceChildren();
  $('resultArea').hidden=false;
  $('resultTitle').textContent=matched.length?'Matching records':'No matches';
  $('matchCount').textContent=fmt(matched.length)+' found';
  more();
}
function wire(){
  $('themeToggle').addEventListener('click',()=>setTheme(
    document.documentElement.dataset.theme==='dark'?'light':'dark'));
  $('scanKey').addEventListener('click',scanKey);
  $('installData').addEventListener('click',install);
  $('importData').addEventListener('click',()=>$('dataFile').click());
  $('dataFile').addEventListener('change',event=>{
    importLocal(event.target.files?.[0]);
    event.target.value='';
  });
  $('searchForm').addEventListener('submit',event=>{
    event.preventDefault();clearTimeout(searchTimer);
    search(true);$('searchInput').blur();
  });
  $('searchInput').addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>search(false),140);
  });
  $('showMore').addEventListener('click',more);
}
async function init(){
  initializeTheme();wire();setNeedsSetup();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{
      if(!records) setSetupNotice('Offline app files could not be cached. Reload while online.',true);
    });
  }
  try {
    const stored=await loadVault();
    if(stored?.bundle&&stored?.key){
      const data=await decryptBundle(stored.bundle,stored.key);
      setReady(data);
    } else {
      setNeedsSetup();
    }
  }catch{
    setNeedsSetup('Administrator setup required.');
  }
}
init();
