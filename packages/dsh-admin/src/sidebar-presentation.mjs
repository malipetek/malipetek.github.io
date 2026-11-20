export function sidebarTicketLabel(ticket) {
  return ticket.title?.trim() || ticket.title_en?.trim() || `Ticket #${ticket.id}`;
}

export function sidebarRunShortcut(run) {
  return `Open ${run.kind === 'task' ? 'my task' : 'client ticket'} #${run.ticketId}`;
}
