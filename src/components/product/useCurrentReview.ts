"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newCurrentSignalIds, type CurrentReview, type CurrentReviewChange } from "@/lib/product/current-review";
import { validSelectionRevision } from "@/lib/product/selections";

type ReviewError="load"|"save"|"conflict"|"unavailable"|null;
const signInAgain=()=>window.location.assign(new URL("/account",window.location.origin).href);
export function useCurrentReview(accountId:string|undefined,initial:CurrentReview|null|undefined,ids:string[]) {
  const [snapshot,setSnapshot]=useState<CurrentReview|null>(initial && initial.accountId===accountId?initial:null);
  const [saving,setSaving]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState<ReviewError>(null);
  const current=useRef(snapshot),pending=useRef(false),mounted=useRef(true),loading=useRef<AbortController|null>(null);
  const accept=useCallback((next:CurrentReview)=>{
    if(next.accountId!==accountId){signInAgain();throw new Error("Account changed");}
    if(!validSelectionRevision(next.revision))throw new Error("Invalid review revision");
    if(current.current && BigInt(next.revision)<BigInt(current.current.revision))return;
    current.current=next;if(mounted.current)setSnapshot(next);
  },[accountId]);
  const send=useCallback(async(change:CurrentReviewChange)=>{
    const response=await fetch("/api/personal/current-review",{method:"POST",headers:{"Content-Type":"application/json","X-Review-Account":accountId??""},
      body:JSON.stringify(change),cache:"no-store",keepalive:true});
    if(response.status===401||response.status===403){signInAgain();throw new Error("save");}
    if(!response.ok){const body=await response.json().catch(()=>({}));
      if(body.error==="account_changed")signInAgain();
      throw new Error(body.error==="review_material_unavailable"?"unavailable":response.status===409?"conflict":"save");}
    return await response.json() as CurrentReview;
  },[accountId]);
  const reload=useCallback(async(dismissError=false)=>{
    if(!accountId || pending.current)return;
    loading.current?.abort();const controller=new AbortController();loading.current=controller;
    try{
      const response=await fetch("/api/personal/current-review",{cache:"no-store",signal:controller.signal});
      if(response.status===401||response.status===403){signInAgain();return;}
      if(!response.ok)throw new Error("load");
      let next=await response.json() as CurrentReview;
      if(controller.signal.aborted || pending.current)return;
      if(!next.initialized)next=await send({action:"initialize",revision:"0",ids});
      if(!controller.signal.aborted && !pending.current){accept(next);if(mounted.current)setError(previous=>dismissError || previous==="load"?null:previous);}
    }catch{if(!controller.signal.aborted && mounted.current)setError(previous=>current.current?.initialized?previous:"load");}
  },[accountId,accept,send,ids]);
  useEffect(()=>{
    mounted.current=true;let cancelled=false;queueMicrotask(()=>{if(!cancelled)void reload();});
    const focus=()=>void reload(),visible=()=>{if(document.visibilityState==="visible")void reload();};
    window.addEventListener("focus",focus);document.addEventListener("visibilitychange",visible);
    return()=>{cancelled=true;mounted.current=false;loading.current?.abort();window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",visible);};
  },[reload]);
  useEffect(()=>{if(!saved)return;const timer=setTimeout(()=>setSaved(false),5000);return()=>clearTimeout(timer);},[saved]);
  const acknowledge=async()=>{
    if(!accountId || !current.current?.initialized || pending.current)return;
    pending.current=true;loading.current?.abort();setSaving(true);setSaved(false);setError(null);
    try{const next=await send({action:"acknowledge",revision:current.current.revision,ids:[...ids]});accept(next);if(mounted.current)setSaved(true);}
    catch(failure){if(mounted.current)setError(failure instanceof Error && ["conflict","unavailable"].includes(failure.message)?failure.message as ReviewError:"save");}
    finally{pending.current=false;if(mounted.current){setSaving(false);void reload();}}
  };
  const newIds=useMemo(()=>new Set(newCurrentSignalIds(ids,snapshot)),[ids,snapshot]);
  return {newIds,ready:!!snapshot?.initialized,saving,saved,error,reload,acknowledge};
}
