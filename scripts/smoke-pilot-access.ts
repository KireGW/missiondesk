import assert from "node:assert/strict";
import { mock } from "node:test";
import { getAccessMode } from "../src/lib/product/config";
import type { UsernameLoginApproval } from "../src/lib/product/username-login";

for (const mode of [undefined,"legacy","invalid"]) {
  assert.equal(getAccessMode({MISSIONDESK_ACCESS_MODE:mode,MISSIONDESK_PILOT_INVITE_ONLY:"true"}),"invalid");
}
assert.equal(getAccessMode({MISSIONDESK_ACCESS_MODE:"personal",MISSIONDESK_PILOT_INVITE_ONLY:"true"}),"personal");
assert.equal(getAccessMode({MISSIONDESK_PILOT_INVITE_ONLY:"false"}),"legacy");
assert.equal(getAccessMode({MISSIONDESK_ACCESS_MODE:"personal",MISSIONDESK_PILOT_INVITE_ONLY:"treu"}),"invalid");

let session: {user:{sub:string;email_verified:boolean};internal:{createdAt:number}} | null=null;
let approval: UsernameLoginApproval | null=null;
let accountWrites=0;
mock.module("react",{namedExports:{cache:(fn:unknown)=>fn}});
mock.module("@auth0/nextjs-auth0/server",{namedExports:{Auth0Client:class {async getSession(){return session;}}}});
mock.module(new URL("../src/lib/product/username-login-store.ts",import.meta.url),{namedExports:{getUsernameLoginApproval:async()=>approval}});
mock.module(new URL("../src/lib/product/store.ts",import.meta.url),{namedExports:{findOrCreateAccount:async()=>{accountWrites++;return {id:"approved-existing",status:"active",plan:"free",premiumUntil:null};}}});
const {getPersonalSessionIdentity}=await import("../src/lib/product/auth");
const {getPersonalAccount}=await import("../src/lib/product/account");
const values={MISSIONDESK_ACCESS_MODE:"personal",MISSIONDESK_PILOT_INVITE_ONLY:"true",AUTH0_DOMAIN:"test.us.auth0.com",
  AUTH0_CLIENT_ID:"test",AUTH0_CLIENT_SECRET:"test",AUTH0_SECRET:"a".repeat(64),APP_BASE_URL:"https://pilot.example",
  MISSIONDESK_USERNAME_CONNECTION:"Managed-Users"};
const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
const previousFetch=globalThis.fetch;
try {
  Object.assign(process.env,values);
  globalThis.fetch=async()=>{throw new Error("Pilot access tests must not call live services");};
  assert.equal(await getPersonalAccount(),null);
  for(const sub of ["google-oauth2|uninvited","auth0|uninvited"]) {
    session={user:{sub,email_verified:true},internal:{createdAt:101}};
    assert.equal((await getPersonalSessionIdentity())?.invitationRequired,true);
    assert.equal(await getPersonalAccount(),null,"Verified email alone cannot enter or create an online pilot account");
  }
  assert.equal(accountWrites,0);
  session={user:{sub:"auth0|approved",email_verified:false},internal:{createdAt:101}};
  approval={displayName:"Daniel",connection:"Managed-Users",enabled:true,accountActive:true,sessionsValidAfter:100,interfaceProfile:"norwegian"};
  assert.equal((await getPersonalSessionIdentity())?.interfaceProfile,"norwegian");
  assert.equal((await getPersonalAccount())?.id,"approved-existing");
  assert.equal(accountWrites,1);
  for(const change of [{enabled:false},{accountActive:false},{connection:"Other-Users"},{sessionsValidAfter:102}]) {
    const original: UsernameLoginApproval=approval!;
    approval={...original,...change};
    assert.equal(await getPersonalAccount(),null,"Disabled, suspended, revoked and mismatched approvals remain denied");
    approval=original;
  }
  assert.equal(accountWrites,1);
  approval=null;session={user:{sub:"google-oauth2|existing-local",email_verified:true},internal:{createdAt:101}};
  process.env.MISSIONDESK_PILOT_INVITE_ONLY="false";
  assert.ok(await getPersonalAccount(),"The existing local email/Google flow is unchanged when invite-only is disabled");
} finally {
  globalThis.fetch=previousFetch;
  for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  mock.restoreAll();
}
console.log("[smoke:pilot-access] Fail-closed mode, anonymous/uninvited denial before account creation, approved stable identity, revocation and unchanged local access passed; no live services.");
