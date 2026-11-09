import assert from 'node:assert/strict';
import { isSelfHosted } from '../../src/server/self-hosted.ts';

export async function selfHostedEditionTests(t: any, { request, pool, admin }: any) {
  const email='local-invited@fixture.invalid', password='local-fixture-password';
  const proof={password:'integration-admin-password',code:''};
  let id='', cookie='';
  await t.test('Public edition stays self-hosted and hides SaaS commerce routes',async()=>{
    const previous=process.env.DEPLOYMENT_MODE;
    try {
      process.env.DEPLOYMENT_MODE='saas';
      assert.equal(isSelfHosted(),true);
      for(const path of ['billing/checkout','billing/portal','invoices','contracts/cancel','pages','admin/plans','admin/company','admin/site','admin/self-hosted']) {
        assert.equal((await request(path,undefined,admin.cookie)).status,404,path);
      }
    } finally { if(previous===undefined)delete process.env.DEPLOYMENT_MODE;else process.env.DEPLOYMENT_MODE=previous; }
  });
  await t.test('Closed registration still permits administrator invitations with one-time activation',async()=>{
    const previous=process.env.ALLOW_REGISTRATION;
    process.env.ALLOW_REGISTRATION='false';
    try {
      assert.equal((await request('auth/signup',{name:'Blocked',email:'blocked-local@fixture.invalid',password,privacyAccepted:true})).status,403);
      const invited=await request('admin/customers',{name:'Local invited user',email,send:false,reason:'Self-hosted invitation fixture',proof},admin.cookie);
      assert.equal(invited.status,200,invited.data.error);id=invited.data.id;
      const token=new URL(invited.data.url).hash.slice(1);
      assert.equal((await request('auth/password-reset',{token,password,privacyAccepted:true})).status,200);
      assert.equal((await request('auth/password-reset',{token,password,privacyAccepted:true})).status,400);
      const signed=await request('auth/login',{email,password});assert.equal(signed.status,200);cookie=signed.cookie;
      const state=(await request('state',undefined,cookie)).data;
      assert.equal(state.user.role,'user');
      const account=(await pool.query('SELECT * FROM accounts WHERE owner_id=$1',[id])).rows[0];
      assert.equal(account.plan_id,'self-hosted');assert.equal(account.subscription_status,'active');
      assert.equal(account.access_source,'self_hosted');assert.equal(account.access_expires_at,null);
      assert.equal(account.stripe_subscription_id,null);
    } finally { if(previous===undefined)delete process.env.ALLOW_REGISTRATION;else process.env.ALLOW_REGISTRATION=previous; }
  });
  await t.test('Local administration requires proof and suspended users lose authenticated access',async()=>{
    assert.equal((await request('admin/customers',undefined,cookie)).status,403);
    const body={action:'suspend',suspended:true,reason:'Self-hosted access fixture'};
    assert.equal((await request('admin/customers/'+id,{...body,proof:{password:'invalid-password',code:''}},admin.cookie)).status,401);
    assert.equal((await request('admin/customers/'+id,{...body,proof},admin.cookie)).status,200);
    assert.equal((await request('auth/status',undefined,cookie)).data.authenticated,false);
    assert.equal((await request('auth/login',{email,password})).status,403);
  });
}
