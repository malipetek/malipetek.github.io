import test from 'node:test';
import assert from 'node:assert/strict';
import {createMentionDelivery, deliverMentions, visibleRecipients} from './mention-delivery.js';

test('delivery retries retain saved message and immutable recipients, never save a note', async () => {
  const calls=[]; let first=true; const recipients=['dev'];
  const delivery=createMentionDelivery({api:async (...args)=>{calls.push(args); if(first){first=false;throw Error('offline');} return {ok:true};},projectId:'a/b',ticketId:3,recipientUserIds:recipients,requestId:'retry-key-123'});
  recipients.push('client');
  await assert.rejects(delivery({messageId:9}),/offline/);
  await delivery();
  assert.deepEqual(calls[0],calls[1]);
  assert.equal(calls[0][1],'/admin/projects/a%2Fb/mentions');
  assert.deepEqual(calls[0][2],{ticketId:3,messageId:9,recipientUserIds:['dev'],requestId:'retry-key-123'});
});
test('delivery refuses unsaved messages and returns failed delivery honestly',async()=>{
  let calls=0; const api=async()=>{calls++;return {ok:false,deliveries:[{status:'failed'}]};};
  const delivery=createMentionDelivery({api,projectId:'p',ticketId:3,recipientUserIds:['dev'],requestId:'retry-key-123'});
  await assert.rejects(delivery(),/saved_message_required/); assert.equal(calls,0);
  assert.equal((await delivery({messageId:9})).ok,false);
  assert.deepEqual(await deliverMentions({api,recipientUserIds:[]}),{ok:true,deliveries:[]});
});
test('internal recipients use trusted grants, not email guesses',()=>{
  const recipients=[{userId:'dev',memberType:'trusted_developer'},{userId:'client',memberType:'client'}];
  assert.deepEqual(visibleRecipients(recipients,true),[recipients[0]]);
  assert.deepEqual(visibleRecipients(recipients,false),recipients);
});
