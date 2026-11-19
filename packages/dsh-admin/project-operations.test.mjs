import test from 'node:test';
import assert from 'node:assert/strict';
import {projectOperationRequest,PROJECT_OPERATIONS} from './project-operations.mjs';

test('coordinator maps scoped operations to the same portal routes as UI',()=>{
 assert.deepEqual(projectOperationRequest('project.read',{projectId:'a/b'}),{method:'GET',path:'/admin/projects/a%2Fb'});
 assert.deepEqual(projectOperationRequest('work.list',{projectId:'p'}),{method:'GET',path:'/admin/tickets?projectId=p'});
 assert.deepEqual(projectOperationRequest('work.draft',{projectId:'p',title:'Task',brief:'Do it',approve:true}),{method:'POST',path:'/admin/work',body:{projectId:'p',title:'Task',brief:'Do it',approve:false,source:'dsh'}});
 assert.equal(projectOperationRequest('work.queue',{projectId:'p',title:'Task',brief:'Do it'}).body.approve,true);
 assert.equal(PROJECT_OPERATIONS.parameters.properties.operation.enum.includes('mentions.send'),true);
});
test('coordinator never forwards global, arbitrary request fields or secret operations',()=>{
 for(const operation of ['settings.update','credentials.read','runner.exec','memberships.grant']) assert.throws(()=>projectOperationRequest(operation,{projectId:'p'}),/super_admin_decision_required/);
 assert.throws(()=>projectOperationRequest('project.read',{}),/project_required/);
 assert.deepEqual(projectOperationRequest('project.update',{projectId:'p',name:'Renamed',role:'admin',secret:'NO',repo:'evil',brief:{goal:'Ship'}}),{method:'PATCH',path:'/admin/projects/p',body:{name:'Renamed',brief:{goal:'Ship'}}});
 assert.deepEqual(projectOperationRequest('mentions.send',{projectId:'p',ticketId:1,messageId:2,recipientUserIds:['u'],requestId:'request_123',email:'evil'}).body,{ticketId:1,messageId:2,recipientUserIds:['u'],requestId:'request_123'});
});
