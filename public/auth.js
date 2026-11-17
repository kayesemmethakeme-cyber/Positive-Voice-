(function(){
  'use strict';
  document.documentElement.classList.add('suhuis-auth-pending');
  const gate=document.getElementById('suhuisAuthGate');
  const form=document.getElementById('suhuisAuthForm');
  const message=document.getElementById('authMessage');
  const title=document.getElementById('authTitle');
  const description=document.getElementById('authDescription');
  const submit=document.getElementById('authSubmit');
  const modeButton=document.getElementById('authMode');
  const password=document.getElementById('authPassword');
  let mode='signin', client=null, currentUser=null, switching=false;
  const setMessage=(text,isError=false)=>{message.textContent=text;message.dataset.error=isError?'true':'false';};
  const showGate=()=>{document.documentElement.classList.remove('suhuis-auth-pending');gate.hidden=false;document.querySelector('.app-shell')?.setAttribute('hidden','');document.getElementById('sidebarToggle')?.setAttribute('hidden','');};
  const showApp=()=>{document.documentElement.classList.remove('suhuis-auth-pending');gate.hidden=true;document.querySelector('.app-shell')?.removeAttribute('hidden');document.getElementById('sidebarToggle')?.removeAttribute('hidden');};
  function setMode(next){
    mode=next;const signup=mode==='signup';const updating=mode==='update';
    title.textContent=updating?'Choose a new password':signup?'Create your SUHAIS account':'Welcome to SUHAIS';
    description.textContent=updating?'Set a new password for your SUHAIS account.':signup?'Create a private workspace for your writing and YouTube activity.':'Sign in to open your private workspace.';
    submit.textContent=updating?'Save new password':signup?'Create account':'Sign in';
    password.autocomplete=(signup||updating)?'new-password':'current-password';
    modeButton.textContent=signup?'Already have an account? Sign in':'Create an account';
    document.getElementById('authReset').hidden=signup||updating;document.getElementById('authGoogle').hidden=updating;document.getElementById('authEmail').parentElement.querySelector('label')?.toggleAttribute('hidden',updating);document.getElementById('authEmail').hidden=updating;document.getElementById('authEmail').required=!updating;modeButton.hidden=updating;
    setMessage('');
  }
  async function boot(){
    try{
      const cfgResponse=await fetch('/api/supabase-config',{cache:'no-store'});
      const cfg=await cfgResponse.json();
      if(!cfgResponse.ok)throw new Error(cfg.error||'Account service is not configured.');
      if(!window.supabase?.createClient)throw new Error('The account library could not be loaded. Refresh this page.');
      client=window.supabase.createClient(cfg.url,cfg.key,{auth:{storageKey:'suhuis-auth-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
      window.suhuisSupabase=client;
      const {data,error}=await client.auth.getSession();
      if(error)throw error;
      currentUser=data.session?.user||null;
      if(currentUser?.id)localStorage.setItem('suhuis-active-user',currentUser.id);
      if(location.hash.includes('type=recovery')||location.hash.includes('reset-password')){window.suhuisUser=currentUser;showGate();setMode('update');}
      else if(currentUser){showApp();window.suhuisUser=currentUser;window.dispatchEvent(new CustomEvent('suhuis:authenticated',{detail:{user:currentUser}}));}
      else showGate();
      client.auth.onAuthStateChange((event,session)=>{
        const next=session?.user||null;
        if(event==='SIGNED_OUT'){if(currentUser?.id)sessionStorage.removeItem('pv-google-token:'+currentUser.id);localStorage.removeItem('suhuis-active-user');currentUser=null;window.suhuisUser=null;location.replace(location.pathname+location.search);return;}
        if(next&&currentUser&&next.id!==currentUser.id){switching=true;localStorage.setItem('suhuis-active-user',next.id);location.replace(location.pathname+location.search);return;}
        if(next&&!currentUser){currentUser=next;window.suhuisUser=next;localStorage.setItem('suhuis-active-user',next.id);location.replace(location.pathname+location.search);}
      });
    }catch(error){showGate();setMessage(error.message||'Could not initialize account access.',true);}
  }
  window.suhuisAuthReady=boot();
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!client)return setMessage('Account service is not ready. Refresh and try again.',true);
    submit.disabled=true;setMessage('Please wait…');
    const email=document.getElementById('authEmail').value.trim();
    const pass=password.value;
    try{
      if(mode==='update'){
        const {error}=await client.auth.updateUser({password:pass});if(error)throw error;
        setMessage('Your password has been updated. Opening your workspace…');showApp();history.replaceState(null,'',location.pathname+location.search);
      }else if(mode==='signup'){
        const {data,error}=await client.auth.signUp({email,password:pass,options:{emailRedirectTo:location.origin}});
        if(error)throw error;
        if(data.session){setMessage('Account created. Opening your workspace…');}
        else setMessage('Check your email and confirm your address before signing in.');
      }else{
        const {error}=await client.auth.signInWithPassword({email,password:pass});if(error)throw error;
        setMessage('Signed in. Loading your workspace…');
      }
    }catch(error){setMessage(error.message||'Authentication failed.',true);}
    finally{submit.disabled=false;}
  });
  modeButton.addEventListener('click',()=>setMode(mode==='signup'?'signin':'signup'));
  document.getElementById('authGoogle').addEventListener('click',async()=>{
    if(!client)return;setMessage('Opening Google sign-in…');
    try{
      const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:new URL('/',location.origin).href,queryParams:{prompt:'select_account'}}});
      if(error)throw error;
    }catch(error){setMessage('Google sign-in could not be started: '+(error.message||'Please try again.'),true);}
  });
  document.getElementById('authReset').addEventListener('click',async()=>{
    if(!client)return;const email=document.getElementById('authEmail').value.trim();
    if(!email)return setMessage('Enter your email address first.',true);
    const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/#reset-password'});
    setMessage(error?error.message:'If an account exists for that address, a password-reset email has been sent.',Boolean(error));
  });
  window.addEventListener('DOMContentLoaded',()=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='auth-signout secondary';
    button.id='suhuisSignOut';
    button.textContent='Sign out';
    button.setAttribute('aria-label','Sign out of your SUHAIS account');
    button.addEventListener('click',async()=>{
      if(!client)return;
      button.disabled=true;
      button.textContent='Signing out…';
      const {error}=await client.auth.signOut();
      if(error){setMessage(error.message,true);button.disabled=false;button.textContent='Sign out';}
      else{localStorage.removeItem('suhuis-active-user');location.replace(location.pathname+location.search);}
    });
    const destination=document.querySelector('.sidebar-bottom');
    if(destination){const identity=document.createElement('div');identity.className='suhuis-account-identity';identity.id='suhuisAccountIdentity';identity.textContent=window.suhuisUser?.email||'Signed-in account';destination.prepend(identity);destination.append(button);}
    else document.querySelector('.header-tools')?.append(button);
  });
  window.suhuisSignOut=async()=>client?.auth.signOut();
  setMode('signin');
})();