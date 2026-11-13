"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntelligenceItem } from "@/lib/types";
import { emptyPersonalSelections, validSelectionRevision, type PersonalSelections, type PersonalSelectionChange, type PersonalSelectionKind } from "@/lib/product/selections";
import { moveMeetingArticle,type MeetingBriefDetails } from "@/lib/product/meeting-brief";

type SelectionError = "load" | "save" | "conflict" | null;
// Authentication/account changes require a fresh document, clearing private client state.
const signInAgain=()=>window.location.assign(new URL("/account",window.location.origin).href);
export function usePersonalSelections(accountId:string|undefined, initial:PersonalSelections|null|undefined) {
  const [snapshot,setSnapshot] = useState<PersonalSelections|null>(initial && initial.accountId===accountId?initial:null);
  const [saving,setSaving] = useState(false);
  const [saved,setSaved] = useState(false);
  const [error,setError] = useState<SelectionError>(null);
  const current=useRef(snapshot),pending=useRef(false),mounted=useRef(true),loading=useRef<AbortController|null>(null);
  const accept=useCallback((next:PersonalSelections)=>{
    if(!accountId || next.accountId!==accountId){signInAgain();throw new Error("Account changed");}
    if(!validSelectionRevision(next.revision))throw new Error("Invalid selection revision");
    if(current.current && BigInt(next.revision)<BigInt(current.current.revision))return;
    current.current=next;if(mounted.current)setSnapshot(next);
  },[accountId]);
  const reload=useCallback(async(dismissError=false)=>{
    if(!accountId || pending.current)return;
    loading.current?.abort();const controller=new AbortController();loading.current=controller;
    try{
      const response=await fetch("/api/personal/selections",{cache:"no-store",signal:controller.signal});
      if(response.status===401||response.status===403){signInAgain();return;}
      if(!response.ok)throw new Error("Selection load failed");
      const next=await response.json() as PersonalSelections;
      if(!controller.signal.aborted && !pending.current){accept(next);if(mounted.current)setError(previous=>dismissError || previous==="load"?null:previous);}
    }catch{if(!controller.signal.aborted && mounted.current)setError(previous=>current.current?previous:"load");}
  },[accountId,accept]);
  useEffect(()=>{
    mounted.current=true;
    let cancelled=false;
    queueMicrotask(()=>{if(!cancelled)void reload();});
    const focus=()=>void reload();
    const visible=()=>{if(document.visibilityState==="visible")void reload();};
    window.addEventListener("focus",focus);document.addEventListener("visibilitychange",visible);
    return()=>{cancelled=true;mounted.current=false;loading.current?.abort();window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",visible);};
  },[reload]);
  useEffect(()=>{if(!saved)return;const timer=setTimeout(()=>setSaved(false),5000);return()=>clearTimeout(timer);},[saved]);

  const change=useCallback(async(operation:PersonalSelectionChange,item?:IntelligenceItem)=>{
    if(!accountId || !current.current || pending.current)return false;
    const before=current.current;
    pending.current=true;loading.current?.abort();setSaving(true);setSaved(false);setError(null);
    const optimistic={...before,priorities:[...before.priorities],meeting:[...before.meeting],retained:{...before.retained}};
    if("clear" in operation)optimistic.meeting=[];
    else if("details" in operation)optimistic.meetingBrief={...operation.details};
    else if("move" in operation)optimistic.meeting=moveMeetingArticle(optimistic.meeting,operation.move.itemId,operation.move.direction);
    else{
      const key=operation.kind==="priority"?"priorities":"meeting";
      optimistic[key]=operation.selected?[...new Set([...optimistic[key],operation.itemId])]:optimistic[key].filter(id=>id!==operation.itemId);
      if(operation.selected && item)optimistic.retained[item.id]=item;
    }
    current.current=optimistic;setSnapshot(optimistic);
    try{
      const response=await fetch("/api/personal/selections",{method:"PATCH",headers:{"Content-Type":"application/json","X-Selection-Account":accountId},
        body:JSON.stringify(operation),cache:"no-store",keepalive:true});
      if(response.status===401||response.status===403){signInAgain();throw new Error("Authentication required");}
      if(!response.ok){
        if(response.status===409){const body=await response.json();if(body.error==="account_changed")signInAgain();throw new Error("conflict");}
        throw new Error("save");
      }
      const next=await response.json() as PersonalSelections;
      accept(next);if(mounted.current)setSaved(true);return true;
    }catch(failure){current.current=before;if(mounted.current){setSnapshot(before);setError(failure instanceof Error && failure.message==="conflict"?"conflict":"save");}return false;}
    finally{pending.current=false;if(mounted.current){setSaving(false);void reload();}}
  },[accountId,accept,reload]);
  const select=(kind:PersonalSelectionKind,item:IntelligenceItem,selected:boolean)=>change({kind,itemId:item.id,selected},item);
  const clearMeeting=()=>current.current?change({kind:"meeting",clear:true,revision:current.current.revision}):Promise.resolve();
  const saveMeetingDetails=(details:MeetingBriefDetails,revision:string)=>change({kind:"meeting",details,revision});
  const moveMeeting=(itemId:string,direction:"up"|"down")=>current.current?change({kind:"meeting",move:{itemId,direction},revision:current.current.revision}):Promise.resolve(false);
  return {...(snapshot ?? emptyPersonalSelections(accountId ?? "")),ready:!!snapshot && !!accountId,saving,saved,error,reload,select,clearMeeting,saveMeetingDetails,moveMeeting};
}
