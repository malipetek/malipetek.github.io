/** Only project-scoped, current-session portal operations. Never use cat_ or global admin tokens. */
const operations = ['project.read','project.update','recipients.list','mentions.send','work.list','work.draft','work.queue'];
export const PROJECT_OPERATIONS = {
  description: 'Read or update a project, list its people or work, notify saved-message recipients, or create a draft/queued system task. Uses current signed-in portal authority. work.queue creates a NEW approved task; it does not modify an existing ticket. Secrets, membership grants, global settings and raw runner execution require a super-admin decision and are unavailable here. To give a client (by email, account or not) access to a project, use admin_directory with action "invite".',
  parameters: {
    type:'object', additionalProperties:false, required:['operation','projectId'],
    properties: {
      operation:{type:'string',enum:operations}, projectId:{type:'string'},
      name:{type:'string'}, kind:{type:'string',enum:['new','existing']}, brief:{oneOf:[{type:'string'},{type:'object'}]},
      title:{type:'string'}, priority:{type:'string'}, executor:{type:'string'}, requires:{type:'array',items:{type:'string'}},
      ticketId:{type:'integer'},messageId:{type:'integer'},recipientUserIds:{type:'array',items:{type:'string'},minItems:1,maxItems:25},requestId:{type:'string'},
    },
  },
};
const pick=(args,keys)=>Object.fromEntries(keys.filter(key=>args[key]!==undefined).map(key=>[key,args[key]]));
export function projectOperationRequest(operation,args={}) {
  if (!operations.includes(operation)) throw new Error('super_admin_decision_required');
  if (typeof args.projectId!=='string' || !args.projectId.trim() || args.projectId.length>128) throw new Error('project_required');
  const project=`/admin/projects/${encodeURIComponent(args.projectId)}`;
  switch(operation) {
    case 'project.read': return {method:'GET',path:project};
    case 'project.update': return {method:'PATCH',path:project,body:pick(args,['name','kind','brief'])};
    case 'recipients.list': return {method:'GET',path:`${project}/recipients`};
    case 'mentions.send': return {method:'POST',path:`${project}/mentions`,body:pick(args,['ticketId','messageId','recipientUserIds','requestId'])};
    case 'work.list': return {method:'GET',path:`/admin/tickets?projectId=${encodeURIComponent(args.projectId)}`};
    case 'work.draft':
    case 'work.queue':
      if(typeof args.title!=='string'||!args.title.trim()||typeof args.brief!=='string'||!args.brief.trim()) throw new Error('work_title_and_brief_required');
      return {method:'POST',path:'/admin/work',body:{projectId:args.projectId,...pick(args,['title','brief','priority','executor','requires']),approve:operation==='work.queue',source:'dsh'}};
  }
}
