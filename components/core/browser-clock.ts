"use client";
import {useSyncExternalStore} from 'react';
const subscribe=(callback:()=>void)=>{const timer=setInterval(callback,1000);return()=>clearInterval(timer);};
const snapshot=()=>Math.floor(Date.now()/1000)*1000;
const serverSnapshot=()=>0;
/** A stable server snapshot prevents hydration mismatches before browser time is available. */
export const useBrowserClock=()=>useSyncExternalStore(subscribe,snapshot,serverSnapshot);
