import type { PersonalLanguage } from "@/lib/product/profiles";

export interface MeetingBriefDetails { title:string;date:string }
export const emptyMeetingBrief=():MeetingBriefDetails=>({title:"",date:""});
export function validMeetingDate(value:unknown):value is string {
  if(value==="")return true;
  if(typeof value!=="string" || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value))return false;
  const parsed=new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10)===value;
}
export function parseMeetingDetails(value:unknown):MeetingBriefDetails|null {
  if(!value || typeof value!=="object" || Array.isArray(value))return null;
  const details=value as Record<string,unknown>;
  if(Object.keys(details).sort().join(",")!=="date,title" || typeof details.title!=="string" || details.title.length>160
    || /[\u0000-\u001f\u007f]/.test(details.title) || !validMeetingDate(details.date))return null;
  return {title:details.title.trim(),date:details.date};
}
/** Keep selected IDs only, preserve manual order, append later additions. Never mutate the feed. */
export function meetingArticleOrder(selected:readonly string[],stored:readonly string[]):string[] {
  const available=new Set(selected),seen=new Set<string>();
  return [...stored,...selected].filter(id=>{
    if(!available.has(id)||seen.has(id))return false;
    seen.add(id);return true;
  });
}
export function moveMeetingArticle(order:readonly string[],id:string,direction:"up"|"down"):string[] {
  const result=[...order],from=result.indexOf(id),to=from+(direction==="up"?-1:1);
  if(from>=0 && to>=0 && to<result.length)[result[from],result[to]]=[result[to],result[from]];
  return result;
}
export function meetingDateLabel(date:string,language:PersonalLanguage):string {
  if(!date || !validMeetingDate(date))return "";
  const locale={sv:"sv-SE",nb:"nb-NO",en:"en-GB",es:"es-MX"}[language];
  return new Intl.DateTimeFormat(locale,{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
}
