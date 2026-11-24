'use strict';
const importButton=document.getElementById('importButton');
const rebuildButton=document.getElementById('rebuildButton');
const importProgress=document.getElementById('importProgress');
let importPolling=false;
async function requireImportServer(){
  const response=await fetch('/api/import');
  const type=response.headers.get('Content-Type')||'';
  if(!response.ok || !type.includes('application/json')){
    throw Error(`This server does not support local import (HTTP ${response.status}). Stop the existing server with Ctrl+C, restart start-viewer.cmd or python serve.py, then refresh this page.`);
  }
  return response.json();
}
async function watchImport(){
  if(importPolling)return;
  importPolling=true;
  try{
    let state;
    do{
      const response=await fetch('/api/import');
      if(!response.ok)throw Error('Import status unavailable. Start the viewer with python serve.py.');
      state=await response.json();
      importButton.disabled=rebuildButton.disabled=state.status==='running';
      importProgress.textContent=state.stage||'';
      if(state.status==='running'){
        const progress=document.createElement('progress');
        progress.max=state.total||1;progress.value=state.completed||0;
        importProgress.appendChild(progress);
        importProgress.appendChild(document.createTextNode(` ${state.completed||0} / ${state.total||0}`));
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    }while(state.status==='running');
    if(state.status==='complete'){
      importProgress.textContent=`Imported ${state.cases} cases. Reloading…`;
      location.reload();
    }
  }catch(error){importProgress.textContent=error.message;}
  finally{importButton.disabled=rebuildButton.disabled=false;importPolling=false;}
}
async function startImport(mode){
  importButton.disabled=rebuildButton.disabled=true;
  importProgress.textContent='Detecting local harness history…';
  try{
    await requireImportServer();
    const response=await fetch('/api/import',{method:'POST',headers:{'X-Swimlane-Import':'1','Content-Type':'application/json'},body:JSON.stringify({mode,scramble:document.getElementById('scrambleImport').checked})});
    if(!response.ok&&response.status!==409){
      const detail=await response.json().catch(()=>({}));
      throw Error(`Could not start local import (HTTP ${response.status}). ${detail.error||'Restart python serve.py and refresh the page.'}`);
    }
    await watchImport();
  }catch(error){importProgress.textContent=error.message;importButton.disabled=rebuildButton.disabled=false;}
}
importButton.addEventListener('click',()=>startImport('incremental'));
rebuildButton.addEventListener('click',()=>startImport('full'));

document.getElementById('packageButton').addEventListener('click',async()=>{
 const button=document.getElementById('packageButton');button.disabled=true;
 try{
 const response=await fetch('/api/package',{method:'POST',headers:{'X-Swimlane-Import':'1','Content-Type':'application/json'},body:JSON.stringify({scramble:document.getElementById('scramblePackage').checked})});
 if(!response.ok)throw Error('Package creation failed');
 const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='agent-swimlane.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){importProgress.textContent=error.message;}finally{button.disabled=false;}
});
