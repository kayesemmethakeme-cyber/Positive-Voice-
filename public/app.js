const $ = s => document.querySelector(s);
let selected = null, status = null, oauthConfig = null, googleTokenClient = null;
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3500)}
async function api(url, opts={}){const r=await fetch(url,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({error:'Unexpected server response'}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
async function refresh(){try{status=await api('/api/status');$('#connection').textContent=status.connected?'YouTube connected':'Not connected';$('#connect').classList.toggle('hidden',status.connected);$('#disconnect').classList.toggle('hidden',!status.connected);let items=[];if(!status.configured)items.push('Server setup is incomplete: '+status.missing.join(', ')+'.');else items.push('Google and YouTube API settings are present.');if(!status.aiConfigured)items.push('AI drafting is not configured yet; add an OpenAI API key to enable it.');if(status.connected)items.push('Connected as '+(status.channel?.title||'your YouTube account')+'.');$('#setupText').textContent=items.join(' ')}catch(e){$('#setupText').textContent='Could not reach the app server.'}}
$('#connect').onclick=()=>{
  if(!status?.configured){toast('The server configuration is incomplete.');return}
  if(!oauthConfig || !window.google?.accounts?.oauth2){toast('Google sign-in is still loading. Reload this page and try again.');return}
  if(!googleTokenClient){
    googleTokenClient=google.accounts.oauth2.initTokenClient({
      client_id:oauthConfig.clientId,
      scope:'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl',
      callback:async response=>{
        if(response.error){toast('Google authorization failed: '+response.error);return}
        try{
          $('#connect').disabled=true;
          const r=await fetch('/auth/google/token',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Requested-With':'XmlHttpRequest'},body:JSON.stringify({access_token:response.access_token})});
          const d=await r.json().catch(()=>({error:'Unexpected server response'}));
          if(!r.ok)throw new Error(d.error||'Google connection failed');
          toast('YouTube connected as '+(d.channel?.title||'your channel')+'.');
          await refresh();
        }catch(e){toast(e.message)}
        finally{$('#connect').disabled=false}
      },
      error_callback:error=>toast('Google sign-in could not open: '+(error.type||'popup error'))
    });
  }
  googleTokenClient.requestAccessToken({prompt:'consent'});
};
$('#disconnect').onclick=async()=>{await api('/auth/logout',{method:'POST'});toast('YouTube disconnected.');refresh()};
async function updateDiscoveryStats(){try{const d=await api('/api/discovery-stats');$('#discoveryStats').textContent=`${d.totalRemembered.toLocaleString()} videos remembered · ${d.batches} batches discovered. Previously shown videos are excluded.`}catch{}}
$('#discover').onclick=async()=>{const btn=$('#discover');btn.disabled=true;btn.textContent='Discovering…';$('#results').innerHTML='<div class="empty">Finding new public videos and filtering out previously discovered ones…</div>';try{const limit=Number($('#batchSize').value)||100;const d=await api('/api/discover',{method:'POST',body:JSON.stringify({limit})});$('#results').innerHTML='';if(!d.videos.length){$('#results').innerHTML='<div class="empty">No unseen videos were available in this part of YouTube’s discovery feed. Try again later when new videos have appeared.</div>'}else{d.videos.forEach(v=>{const el=document.createElement('article');el.className='video';el.innerHTML=`<img alt="" src="${esc(v.thumbnail||'')}"><div><h3>${esc(v.title)}</h3><p>${esc(v.channel)} · ${v.publishedAt?new Date(v.publishedAt).toLocaleDateString():'Date unavailable'}</p><button class="primary small">Prepare comment</button> <a class="small" target="_blank" rel="noopener" href="${esc(v.url)}">Watch</a></div>`;el.querySelector('button').onclick=()=>choose(v);$('#results').append(el)})}if(d.exhausted){const note=document.createElement('p');note.className='muted';note.textContent=d.note||'Fewer than 100 unseen videos were available.';$('#results').append(note)}await updateDiscoveryStats()}catch(err){$('#results').innerHTML=`<div class="empty">${esc(err.message)}</div>`}finally{btn.disabled=false;btn.textContent='Discover 100 new videos'}};
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function choose(v){selected=v;$('#drafts').innerHTML='<div class="empty">Preparing your draft…</div>';try{const d=await api('/api/draft',{method:'POST',body:JSON.stringify({...v,style:'thoughtful, positive, specific, and natural'})});showDraft(d.comment)}catch(e){showDraft('')} }
function showDraft(comment){const v=selected;$('#drafts').innerHTML='';const card=document.createElement('div');card.className='draft-card';card.innerHTML=`<h3>${esc(v.title)}</h3><p class="meta">${esc(v.channel)} · <a target="_blank" rel="noopener" href="${esc(v.url)}">Open video</a></p><textarea maxlength="1000" aria-label="Edit comment" placeholder="Write a thoughtful, relevant comment here…">${esc(comment||'')}</textarea><p class="muted">Check that your comment reflects the actual video. AI drafts use public title and description metadata, not full video viewing.</p><div class="draft-actions"><button class="primary" id="publish">Approve & publish this comment</button><button class="secondary" id="redraft">Generate another draft</button></div>`;$('#drafts').append(card);card.querySelector('#redraft').onclick=()=>choose(v);card.querySelector('#publish').onclick=async()=>{if(!status?.connected){toast('Connect your YouTube account before publishing.');return}const text=card.querySelector('textarea').value.trim();if(!text){toast('Write a comment first.');return}if(!confirm('Publish this exact comment to this video using your connected YouTube account?'))return;try{card.querySelector('#publish').disabled=true;await api('/api/publish',{method:'POST',body:JSON.stringify({videoId:v.id,channelId:v.channelId,comment:text,userConfirmed:true})});toast('Comment submitted to YouTube.');card.querySelector('#publish').textContent='Published';}catch(e){card.querySelector('#publish').disabled=false;toast(e.message)}}}
async function loadGoogleAuthorization(){
  try{oauthConfig=await api('/api/oauth-config')}catch(e){oauthConfig=null}
}
refresh();
loadGoogleAuthorization();
updateDiscoveryStats();
