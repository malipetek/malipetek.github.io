/** Mention delivery is a separate stage after saving; retry must never save the note again. */
export const visibleRecipients = (recipients, internal) => recipients.filter(person => !internal || person.memberType === 'trusted_developer');

export async function deliverMentions({api, projectId, ticketId, messageId, recipientUserIds, requestId}) {
  if (!recipientUserIds?.length) return {ok:true, deliveries:[]};
  if (!Number.isSafeInteger(messageId) || messageId < 1) throw new Error('saved_message_required');
  return api('POST', `/admin/projects/${encodeURIComponent(projectId)}/mentions`, {ticketId, messageId, recipientUserIds, requestId});
}

export function createMentionDelivery({api, projectId, ticketId, recipientUserIds, requestId = globalThis.crypto.randomUUID()}) {
  const recipients = [...new Set(recipientUserIds || [])];
  let messageId;
  let pending;
  return function deliver(saved) {
    if (saved?.messageId && !messageId) messageId = saved.messageId;
    if (pending) return pending;
    pending = deliverMentions({api, projectId, ticketId, messageId, recipientUserIds:recipients, requestId}).finally(() => {pending = null;});
    return pending;
  };
}
