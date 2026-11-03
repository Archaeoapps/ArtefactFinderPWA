import {checkBundle,decryptBundle,importSecret} from './crypto.js';
import {loadVault,saveVault} from './vault.js';
import {scanQRCode} from './scanner.js';

const $ = id => document.getElementById(id);
const fmt = number => Number(number).toLocaleString('en-US');
const PAGE_SIZE=80;
let records=null,matched=[],shown=0,searchTimer=0;
let provisioning=false;
let pending={dataUrl:null,keyUrl:null,dataFile:null,keyFile:null,keyText:null};

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
  pending={dataUrl:null,keyUrl:null,dataFile:null,keyFile:null,keyText:null};
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
function directDownloadUrl(url){
  const u=new URL(url);
  if(u.protocol!=='https:' || u.username || u.password)
    throw new Error('Only secure HTTPS links are supported.');
  // Convert a standard share page URL to the file download URL.
  const parts=u.pathname.split('/').filter(Boolean);
  if(parts.length===2 && parts[0]==='s' && /^[A-Za-z0-9_-]+$/.test(parts[1]))
    u.pathname='/s/'+parts[1]+'/download';
  return u.href;
}
function refreshSetup(){
  const hasData=!!(pending.dataUrl||pending.dataFile);
  const hasKey=!!(pending.keyUrl||pending.keyFile||pending.keyText);
  $('dataState').textContent=pending.dataFile?'Encrypted file selected':
    pending.dataUrl?'Download link captured':'Not selected';
  $('keyState').textContent=pending.keyText?'Key QR captured locally':
    pending.keyFile?'Key file selected':pending.keyUrl?'Key link captured':'Not selected';
  // Public file downloads can be opened normally, even when cross-origin fetch is blocked.
  const dataOpen=$('openDataDownload');
  dataOpen.hidden=!pending.dataUrl||!!pending.dataFile;
  if(!dataOpen.hidden)dataOpen.href=directDownloadUrl(pending.dataUrl);
  const keyOpen=$('openKeyDownload');
  keyOpen.hidden=!pending.keyUrl||!!(pending.keyFile||pending.keyText);
  if(!keyOpen.hidden)keyOpen.href=directDownloadUrl(pending.keyUrl);
  $('scanKey').disabled=!hasData||provisioning;
  $('installData').disabled=!hasData||!hasKey||provisioning;
  $('scanData').disabled=provisioning;
  $('importData').disabled=provisioning;
  $('importKey').disabled=provisioning;
}
async function captureQr(which){
  if(provisioning)return;
  setSetupNotice('');
  $('cameraTitle').textContent=which==='data'?'Scan data link':'Scan key link';
  try{
    const value=await scanQRCode($('cameraLayer'),$('cameraVideo'),
      $('cameraCancel'),$('cameraHint'),which==='key');
    if(!value)return;
    if(which==='data'){
      pending.dataUrl=value;pending.dataFile=null;
      setSetupNotice('Data link captured. If automatic download is blocked, use Open download, save the encrypted file in Files, then Choose file.');
    }else if(value.startsWith('RFKEY1:')){
      pending.keyText=value;pending.keyUrl=null;pending.keyFile=null;
      setSetupNotice('Key captured directly from QR. No key file download required.');
    }else{
      pending.keyUrl=value;pending.keyFile=null;pending.keyText=null;
      setSetupNotice('Key link captured. If automatic download is blocked, open the download and import the key file.');
    }
    refreshSetup();
  }catch(e){setSetupNotice(e.message,true);}
}
async function importLocal(which,file){
  if(!file||provisioning)return;
  const isData=which==='data';
  const limit=isData?25*1024*1024:8192;
  setSetupNotice('Checking selected file…');
  try{
    if(file.size>limit)
      throw new Error('Selected file is '+file.size.toLocaleString('en-US')+
        ' bytes, exceeding the '+(isData?'25 MB':'8 KB')+' limit.');
    // Some iOS Files providers report size=0 for files that can still be read.
    // Check the bytes themselves rather than trusting File.size.
    const bytes=await file.arrayBuffer();
    if(bytes.byteLength===0)
      throw new Error('The selected file is empty (0 bytes). Download the full encrypted .rfdb file first, then select it again.');
    if(bytes.byteLength>limit)
      throw new Error('The selected file exceeds the supported size.');
    if(isData){
      if(bytes.byteLength<36)
        throw new Error('The selected encrypted file contains only '+
          bytes.byteLength+' bytes. The download is incomplete.');
      const signature=new TextDecoder().decode(bytes.slice(0,8));
      if(signature!=='RFDATA01'){
        const hint=signature.startsWith('PK')?'A ZIP archive was selected. Extract the .rfdb file first.':
          signature.startsWith('<')?'A web page was selected instead of the encrypted .rfdb file.':
          'The selected file is not the expected encrypted .rfdb package.';
        throw new Error(hint);
      }
      checkBundle(bytes);
      pending.dataFile=file;
      pending.dataUrl=null;
      setSetupNotice('Encrypted data verified ('+
        bytes.byteLength.toLocaleString('en-US')+' bytes). Select the key next.');
    }else{
      const text=new TextDecoder().decode(bytes);
      await importSecret(text);
      pending.keyFile=file;pending.keyUrl=null;pending.keyText=null;
      setSetupNotice('Key file verified. Ready to complete setup.');
    }
    refreshSetup();
  }catch(e){
    setSetupNotice(e?.message||'Unable to read the selected file.',true);
  }
}
async function download(url,asText=false){
  if(!url||new URL(url).protocol!=='https:')
    throw new Error('Only HTTPS links are supported.');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(directDownloadUrl(url),{
      method:'GET',mode:'cors',credentials:'omit',
      cache:'no-store',redirect:'follow',
      referrerPolicy:'no-referrer',signal:controller.signal
    });
    if(!response.ok)throw new Error('The remote file could not be downloaded (HTTP '+response.status+').');
    if((response.headers.get('content-type')||'').includes('text/html'))
      throw new Error('The link returned a web page instead of a file. Open the download link and import the file from Files.');
    const length=Number(response.headers.get('content-length')||0);
    const limit=asText?8192:25*1024*1024;
    if(length>limit)throw new Error('The remote file is too large.');
    const content=asText?await response.text():await response.arrayBuffer();
    if((asText?content.length:content.byteLength)>limit)
      throw new Error('The remote file is too large.');
    return content;
  }catch(e){
    if(e.name==='AbortError')throw new Error('Download timed out. Check the network.');
    if(e instanceof TypeError)
      throw new Error('This file host blocks direct downloads into the app. Tap Open download, save the file in iPhone Files, then Choose file. A key QR containing the key itself avoids a separate key download.');
    throw e;
  }finally{clearTimeout(timer);}
}
async function install(){
  if(provisioning)return;
  const dataSource=pending.dataFile||pending.dataUrl;
  const keySource=pending.keyText||pending.keyFile||pending.keyUrl;
  if(!dataSource||!keySource)return;
  provisioning=true;refreshSetup();
  setSetupNotice('Downloading and verifying encrypted data…');
  try{
    const bytes= pending.dataFile?await pending.dataFile.arrayBuffer():await download(pending.dataUrl,false);
    checkBundle(bytes);
    const rawKey=pending.keyText || (pending.keyFile
      ?await pending.keyFile.text():await download(pending.keyUrl,true));
    const key=await importSecret(rawKey);
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
  $('scanData').addEventListener('click',()=>captureQr('data'));
  $('scanKey').addEventListener('click',()=>captureQr('key'));
  $('installData').addEventListener('click',install);
  $('importData').addEventListener('click',()=>$('dataFile').click());
  $('importKey').addEventListener('click',()=>$('keyFile').click());
  $('dataFile').addEventListener('change',event=>{
    importLocal('data',event.target.files?.[0]);event.target.value='';
  });
  $('keyFile').addEventListener('change',event=>{
    importLocal('key',event.target.files?.[0]);event.target.value='';
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
