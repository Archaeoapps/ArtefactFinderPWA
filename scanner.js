let active=false;

export async function scanQRCode(dialog,video,cancelButton,hint,allowKey=false) {
  if(active) return null;
  if(typeof window.jsQR!=='function')
    throw new Error('QR scanner is unavailable.');
  if(!navigator.mediaDevices?.getUserMedia)
    throw new Error('Camera access is unavailable. Use file import instead.');
  active=true;
  dialog.hidden=false;
  hint.textContent='Point the camera at the QR code.';
  let stream=null,frame=0,settled=false,last=0;
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  let accept,fail;
  const result=new Promise((resolve,reject)=>{accept=resolve;fail=reject;});
  function finish(value,error=null){
    if(settled)return;
    settled=true;
    cancelAnimationFrame(frame);
    if(stream) stream.getTracks().forEach(track=>track.stop());
    video.pause();
    video.srcObject=null;
    dialog.hidden=true;
    cancelButton.removeEventListener('click',cancel);
    active=false;
    if(error)fail(error);else accept(value);
  }
  function cancel(){finish(null);}
  cancelButton.addEventListener('click',cancel);
  try {
    stream=await navigator.mediaDevices.getUserMedia({
      audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}
    });
    if(settled){stream.getTracks().forEach(track=>track.stop());return result;}
    video.srcObject=stream;
    await video.play();
    function capture(time) {
      if(settled)return;
      frame=requestAnimationFrame(capture);
      if(time-last<120||video.readyState<2||!video.videoWidth)return;
      last=time;
      const scale=Math.min(1,640/video.videoWidth);
      canvas.width=Math.round(video.videoWidth*scale);
      canvas.height=Math.round(video.videoHeight*scale);
      if(!canvas.width||!canvas.height)return;
      try{
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const image=ctx.getImageData(0,0,canvas.width,canvas.height);
        const qr=window.jsQR(image.data,image.width,image.height,
          {inversionAttempts:'attemptBoth'});
        if(!qr?.data)return;
        const value=qr.data.trim();
        // A secret supplied directly by an administrator-controlled QR stays
        // entirely local: no browser download or cross-origin request needed.
        if(allowKey && /^RFKEY1:[A-Za-z0-9_-]{43}$/.test(value)){
          finish(value);
          return;
        }
        hint.textContent='Scan the administrator secret QR, not a download link.';
      }catch{
        hint.textContent='Unable to read the image. Move the camera closer.';
      }
    }
    frame=requestAnimationFrame(capture);
  }catch(err){
    finish(null,new Error('Could not open the camera: '+(err?.message||'Access denied.')));
  }
  return result;
}
