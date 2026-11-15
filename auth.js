import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';

window.workoutAuthReady=(async()=>{
  const response=await fetch('./firebase-config.json',{cache:'no-store'});
  if(!response.ok)throw Error('로그인 설정을 불러오지 못했어.');
  const config=await response.json();
  if(!config.enabled||!config.firebase)throw Error('Firebase 전환을 준비 중이야. 아직 기존 앱을 사용해줘.');
  const auth=getAuth(initializeApp(config.firebase));
  const button=document.getElementById('loginButton'),status=document.getElementById('bootStatus');
  return new Promise((resolve,reject)=>{
    button.onclick=async()=>{
      button.disabled=true;
      try{const provider=new GoogleAuthProvider();provider.setCustomParameters({login_hint:config.ownerEmail});await signInWithPopup(auth,provider);}
      catch(e){status.textContent='로그인을 완료하지 못했어. 팝업 허용 후 다시 눌러줘.';button.disabled=false;}
    };
    onAuthStateChanged(auth,async user=>{
      if(!user){status.textContent='내 기록을 열려면 Google 계정으로 로그인해줘.';button.hidden=false;button.disabled=false;return;}
      if(user.email!==config.ownerEmail||!user.emailVerified){await signOut(auth);status.textContent='운동기록 소유자 계정으로 로그인해줘.';return;}
      button.hidden=true;
      resolve({url:config.databaseURL+'/workout_primary_v1.json',token:async()=>{
        if(auth.currentUser?.email!==config.ownerEmail)throw Error('다시 로그인해줘.');
        return auth.currentUser.getIdToken();
      }});
    },reject);
  });
})();
window.workoutAuthReady.catch(e=>{document.getElementById('bootStatus').textContent=e.message;});
