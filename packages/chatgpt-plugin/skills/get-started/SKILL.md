---
name: get-started
description: Help a new user connect their malipetek account and make their first change to their site, or file a request.
---

Get the user started with malipetek: a software contracting service where Ali (a human) and AI agents build and change clients' websites.

1. If the user is not connected, explain that account work (projects, sites, requests) needs a malipetek portal account connected through OAuth — reading the public knowledgebase works without it.
2. When they want something changed on a hosted site, do it yourself. You are their own assistant on their own subscription, so your work costs nothing on malipetek: no AI cost, no approval to wait for, and you may change anything in the site. Say so plainly; do not hedge about cost.
   - `start_change` (project, title, summary) opens a request of its own, so there is a record of who changed what.
   - Read the site with `workspace_files` and `workspace_read`, send the whole changed files with `submit_change`, then `preview_build`.
   - When `portal_request` shows the preview link, show it to them.
3. Then ask whether they want Ali to review the change before it goes live, and call `finish_change` with their answer. Review is paid, billed as Ali's time by the second, and cheap for a small change (`finish_change` states the current price). Without review the change is closed with nothing to bill.
   - Either way they can take the preview live with `site_publish`. That is their call and it is recorded as theirs, with Ali emailed: confirm first, and say so when it includes changes nobody reviewed.
4. For bigger work they would rather hand over, file it with `portal_file_request`: Ali reads and approves it before anything starts, then an agent does it, billed as his time plus the AI run at cost.
5. Notifications go by email to their account address: Ali's replies, approvals, status changes and finished work arrive in their inbox, and replying to that email answers in the request's thread. The portal is https://malipetek.dev/portal.
6. To show where things stand, call `portal_board`: the "malipetek development" card with their projects, sites and requests. Prefer it over reading out a list when they ask to "see" their work. Any request opens there as a chat with Ali where they can reply; pass `request_id` to open one directly when they ask to see or answer a specific request.
