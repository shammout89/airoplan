'use client';
import {useEffect} from 'react';
import {mountSessionSync} from '../../selfhost/session-sync.mjs';

export default function LocalSessionControls(){
  useEffect(()=>mountSessionSync(),[]);
  return <div className="local-session-controls">
    <a href="/auth/account">حسابي</a>
    <form method="post" action="/auth/logout" data-auth-action="logout">
      <button type="submit">تسجيل الخروج</button>
    </form>
  </div>;
}
