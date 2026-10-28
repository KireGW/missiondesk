import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
import { readPersonalTestEnvironment } from "./personal-test-env.mjs";

if (process.argv.length !== 3 || !["--configure","--status"].includes(process.argv[2]) || process.env.VERCEL) {
  throw new Error("Run locally with --configure or --status.");
}
const configure=process.argv[2]==="--configure";
const {values:local}=readPersonalTestEnvironment();
const tenant=local.AUTH0_DOMAIN;
const purpose="missiondesk-online-pilot";
const projectName="missiondesk-pilot";
const team="wissmusicproductions-8982s-projects";
const statePath=".env.pilot.local";
const reportPath="reports/online-pilot-configuration.json";
execFileSync("git",["check-ignore","-q",statePath],{stdio:"pipe"});
let state={};
if(existsSync(statePath)) {
  if((statSync(statePath).mode & 0o077)!==0) throw new Error("Pilot credentials must have permissions 0600.");
  state=parseEnv(readFileSync(statePath,"utf8"));
  if(state.PILOT_PURPOSE!==purpose || state.AUTH0_DOMAIN!==tenant) throw new Error("Unexpected saved pilot configuration.");
}
function save() {
  writeFileSync(statePath,Object.entries(state).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join("\n")+"\n",{mode:0o600});
  chmodSync(statePath,0o600);
}
function command(binary,args,input) {
  try {
    const output=execFileSync(binary,args,{input:input===undefined ? undefined : JSON.stringify(input),encoding:"utf8",stdio:["pipe","pipe","pipe"],timeout:120_000});
    return output.trim() ? JSON.parse(output) : null;
  } catch {throw new Error(`${binary==="npx" ? "Vercel" : "Auth0"} operation failed; private provider output withheld. Saved pilot credentials retained.`);}
}
const vercel=(path,method="GET",body)=>command("npx",["--yes","vercel@65.5.0","api",path,"--scope",team,"--method",method,...(body===undefined?[]:["--input","-"])],body);
const auth0=(method,path,body,reveal=false)=>command(process.env.AUTH0_CLI_PATH ?? "auth0",["api",method,path,...(body===undefined?[]:["--data","@-"]),
  ...(reveal?["--reveal-secrets"]:[]),"--tenant",tenant,"--json","--no-input"],body);
const production=(project)=>({projectId:project.id,deploymentId:project.targets?.production?.id,commit:project.targets?.production?.meta?.githubCommitSha});
const mainBefore=production(vercel("/v9/projects/missiondesk"));
if(mainBefore.projectId!=="prj_I2ORipsrJoF6rR0o5O3DgUREB9eG") throw new Error("Unexpected existing production project.");
const dbUrl=new URL(local.DATABASE_URL);
if(decodeURIComponent(dbUrl.username)!=="missiondesk_personal_app" || local.MISSIONDESK_PERSONAL_DATA_MODE!=="pilot") throw new Error("The permanent isolated app role is required.");
if(dbUrl.searchParams.get("sslmode")==="require") dbUrl.searchParams.set("sslmode","verify-full");
const db=new pg.Pool({connectionString:dbUrl.toString(),max:1});
let account;
try {
  account=(await db.query(`SELECT a.id,a.status,a.plan,a.llm_monthly_budget_micros,a.social_monthly_budget_micros,
    p.connection_name,p.enabled,p.interface_profile FROM product_accounts a JOIN product_username_logins p ON p.account_id=a.id
    WHERE a.auth_subject=$1`,[`${tenant.toLowerCase()}|${local.MISSIONDESK_DANIEL_AUTH0_USER_ID}`])).rows[0];
  if(account?.status!=="active" || account.plan!=="free" || !account.enabled || account.connection_name!==local.MISSIONDESK_USERNAME_CONNECTION ||
    account.llm_monthly_budget_micros!=="0" || account.social_monthly_budget_micros!=="0") throw new Error("The existing free, approved pilot account is required.");
} finally {await db.end();}

const projects=vercel("/v9/projects").projects;
let project=projects.find(item=>item.name===projectName);
if(!project) {
  if(!configure || state.VERCEL_PROJECT_ID) throw new Error("Pilot project missing; refusing to replace it.");
  project=vercel("/v11/projects","POST",{name:projectName,framework:"nextjs",buildCommand:"npm run build",
    serverlessFunctionRegion:"iad1",ssoProtection:{deploymentType:"preview"},previewDeploymentsDisabled:true});
  if(!project.id || project.id===mainBefore.projectId || project.name!==projectName) throw new Error("Unexpected project creation.");
  state={PILOT_PURPOSE:purpose,VERCEL_PROJECT_ID:project.id,VERCEL_ORG_ID:project.accountId,AUTH0_DOMAIN:tenant};save();
}
if(project.id!==state.VERCEL_PROJECT_ID || project.id===mainBefore.projectId) throw new Error("Refusing an unverified or existing production project.");
const projectId=project.id;
const domains=vercel(`/v9/projects/${projectId}/domains`).domains;
const domain=domains.find(item=>item.name===`${projectName}.vercel.app` && item.verified);
if(!domain) throw new Error("The expected pilot domain is not assigned and verified; review before continuing.");
const baseUrl=`https://${domain.name}`;
if(state.APP_BASE_URL && state.APP_BASE_URL!==baseUrl) throw new Error("Saved pilot URL differs; refusing to redirect it.");
state.APP_BASE_URL=baseUrl;save();

const appName="MissionDesk Online Pilot";
const apps=auth0("get","clients?fields=client_id,name,app_type,client_metadata,callbacks&include_fields=true&per_page=100");
const matches=apps.filter(item=>item.name===appName);
if(matches.length>1 || (matches[0] && matches[0].client_metadata?.purpose!==purpose)) throw new Error("Conflicting Auth0 pilot app.");
let app;
if(matches[0]) app=auth0("get",`clients/${matches[0].client_id}`);
else {
  if(!configure || state.AUTH0_CLIENT_ID) throw new Error("Pilot Auth0 app missing; refusing to replace an identity environment.");
  app=auth0("post","clients",{name:appName,app_type:"regular_web",token_endpoint_auth_method:"client_secret_post",
    grant_types:["authorization_code"],callbacks:[`${baseUrl}/auth/callback`],allowed_logout_urls:[baseUrl],
    oidc_conformant:true,organization_usage:"deny",client_metadata:{purpose}});
}
if(app.app_type!=="regular_web" || app.client_metadata?.purpose!==purpose || app.client_id===local.AUTH0_CLIENT_ID ||
  (state.AUTH0_CLIENT_ID && state.AUTH0_CLIENT_ID!==app.client_id) || app.callbacks?.length!==1 || app.callbacks[0]!==`${baseUrl}/auth/callback` ||
  app.allowed_logout_urls?.length!==1 || app.allowed_logout_urls[0]!==baseUrl) throw new Error("Unexpected online Auth0 app.");
app=auth0("get",`clients/${app.client_id}`,undefined,true);
if(!app.client_secret) throw new Error("Online client secret unavailable; no credentials printed.");
state={...state,AUTH0_CLIENT_ID:app.client_id,AUTH0_CLIENT_SECRET:app.client_secret,
  AUTH0_SECRET:state.AUTH0_SECRET ?? randomBytes(32).toString("hex"),DATABASE_URL:local.DATABASE_URL,
  MISSIONDESK_ACCESS_MODE:"personal",MISSIONDESK_PILOT_INVITE_ONLY:"true",MISSIONDESK_PERSONAL_DATA_MODE:"pilot",
  MISSIONDESK_USERNAME_CONNECTION:local.MISSIONDESK_USERNAME_CONNECTION,MISSIONDESK_WORKSPACE_PILOT:"true",MISSIONDESK_WORKSPACE_REFRESH:"true"};save();
if(state.AUTH0_SECRET===local.AUTH0_SECRET) throw new Error("Online and local cookies must use distinct secrets.");
const connections=auth0("get","connections?per_page=100");
if(connections.length>=100) throw new Error("Review connection pagination before configuration.");
const managed=connections.find(item=>item.name===local.MISSIONDESK_USERNAME_CONNECTION);
if(!managed) throw new Error("Existing managed connection missing.");
const details=auth0("get",`connections/${managed.id}`);
if(details.strategy!=="auth0" || details.is_domain_connection || !details.options?.disable_signup || !details.options?.brute_force_protection ||
  !details.options?.attributes?.username?.identifier?.active || !Number.isInteger(details.options?.password_complexity_options?.min_length) ||
  details.options.password_complexity_options.min_length<15) throw new Error("Managed username/password protection must be preserved.");
const user=auth0("get",`users/${encodeURIComponent(local.MISSIONDESK_DANIEL_AUTH0_USER_ID)}`);
if(user.user_id!==local.MISSIONDESK_DANIEL_AUTH0_USER_ID || user.blocked ||
  !user.identities?.some(item=>item.connection===managed.name)) throw new Error("The existing Daniel identity must remain active and unchanged.");
function enabledClients(connectionId) {
  const result=auth0("get",`connections/${connectionId}/clients?take=100`);
  if(result.next) throw new Error("Review enabled-client pagination before configuration.");
  return Array.isArray(result) ? result : result.clients;
}
let enabledConnections=0;
for(const connection of connections) {
  const clients=enabledClients(connection.id);
  const enabled=clients.some(item=>item.client_id===app.client_id);
  const desired=connection.id===managed.id;
  if(desired && !clients.some(item=>item.client_id===local.AUTH0_CLIENT_ID)) throw new Error("The local managed login must remain enabled.");
  if(enabled!==desired && configure) auth0("patch",`connections/${connection.id}/clients`,[{client_id:app.client_id,status:desired}]);
  const verified=configure && enabled!==desired ? enabledClients(connection.id) : clients;
  if(verified.some(item=>item.client_id===app.client_id)!==desired) throw new Error("Pilot Auth0 connection isolation failed.");
  if(desired) {
    if(verified.some(item=>![app.client_id,local.AUTH0_CLIENT_ID].includes(item.client_id))) throw new Error("Unexpected client on the managed connection.");
    enabledConnections++;
  }
}
if(enabledConnections!==1) throw new Error("Exactly one closed username connection must serve the pilot.");
const localApp=auth0("get",`clients/${local.AUTH0_CLIENT_ID}`);
if(localApp.callbacks?.length!==1 || localApp.callbacks[0]!==`${local.APP_BASE_URL}/auth/callback`) throw new Error("Local Auth0 callback changed unexpectedly.");

const envKeys=["APP_BASE_URL","AUTH0_DOMAIN","AUTH0_CLIENT_ID","AUTH0_CLIENT_SECRET","AUTH0_SECRET","DATABASE_URL",
  "MISSIONDESK_ACCESS_MODE","MISSIONDESK_PILOT_INVITE_ONLY","MISSIONDESK_USERNAME_CONNECTION","MISSIONDESK_PERSONAL_DATA_MODE",
  "MISSIONDESK_WORKSPACE_PILOT","MISSIONDESK_WORKSPACE_REFRESH"];
if(configure) {
  vercel(`/v9/projects/${projectId}`,"PATCH",{nodeVersion:"22.x",resourceConfig:{functionDefaultRegions:["iad1"],functionDefaultTimeout:60},
    protectedSourcemaps:true,enableProductionFeedback:false});
  for(const key of envKeys) vercel(`/v10/projects/${projectId}/env?upsert=true`,"POST",{key,value:state[key],target:["production","preview"],
    type:["AUTH0_CLIENT_SECRET","AUTH0_SECRET","DATABASE_URL"].includes(key) ? "sensitive" : "plain"});
}
const configured=vercel(`/v9/projects/${projectId}`);
const keys=configured.env?.map(item=>item.key) ?? [];
if(envKeys.some(key=>!keys.includes(key)) || keys.some(key=>/OPENAI_API_KEY|AI_GATEWAY_API_KEY|X_.*TOKEN|TWITTER_.*TOKEN/.test(key))) throw new Error("Runtime variables missing, or paid provider credentials present.");
if(JSON.stringify(mainBefore)!==JSON.stringify(production(vercel("/v9/projects/missiondesk")))) throw new Error("Existing production changed during configuration.");
const report={project:projectName,projectId,baseUrl,auth0Application:appName,auth0ClientId:app.client_id,
  inviteOnly:true,existingDanielAccountPreserved:true,localAuthPreserved:true,paidProviderKeys:false,mainProductionUnchanged:true,
  mainProduction:mainBefore,gitAutoDeploy:false,configuredAt:new Date().toISOString()};
writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report));
