---
layout: ../layouts/Legal.astro
title: "Privacy Policy"
---


**Malipetek.dev Privacy Policy**
=====================================

**Introduction**
---------------

Malipetek.dev is the software contracting service of Muhammet Ali Petek: clients file requests through a web portal, and work is carried out by AI agents under human approval and review. This policy explains what personal data we collect, where it is stored, and what you can do with it. It covers the website, the client portal at `malipetek.dev/portal`, sites we host under `malipetek.online`, and assistants you connect to your account — including the ChatGPT app and any other MCP-compatible agent.

**Data We Collect**
-------------------

* **Account data.** You sign in with your email address via a one-time link we email you. We store your email address, role (client or admin), and session records. There is no password.
* **Contact data.** When you use the contact form or email us, we collect your name, email address, and message.
* **Portal data.** Projects you register, requests you file, conversation messages, replies, budgets, attachments you upload, and records of work performed and billed.
* **Connected services.** If you connect GitHub, we store the installation ID, account name, and which repositories you granted — never your GitHub password. If you connect an assistant (ChatGPT, Claude, or another MCP client), we store the OAuth registration and an access token that lets it act for your account.
* **Technical data.** IP addresses are used for rate limiting and abuse prevention, and Cloudflare Turnstile is used to keep bots out. Server logs are kept by our infrastructure providers under their own policies.

**How Work Is Processed**
-------------------------

Your requests and project files are processed by AI agents to produce the work you asked for. This means content you submit may be sent to AI model providers as part of a work run. Agents operate on a copy of your project; they cannot publish or deploy anything without going through the recorded approval flow.

When you connect **your own assistant**, it receives an access token scoped to your account. It can read your projects and requests and act within the permissions shown on the consent screen at connection time. Data your assistant reads is governed additionally by that assistant's own privacy policy (for example, OpenAI's for ChatGPT).

**How We Use Data**
-------------------

* To provide the service: sign you in, track your requests, build and preview your work, and bill you.
* To communicate with you about your requests and account.
* To keep the platform secure and prevent abuse.
* We do not sell your data and do not run advertising trackers.

**Where Data Lives**
--------------------

The service runs on Cloudflare (Workers, D1 database, R2 storage), so your data is stored and processed on Cloudflare's global network. Sign-in links are delivered by email. Optional connections — GitHub, your own AI assistant — involve those providers only if you use them.

**Data Retention**
-----------------

We keep your account and portal data for as long as your account is active and as needed for billing records. Magic-link tokens expire in 15 minutes; sessions expire automatically. Access tokens and stored credentials are held only as hashes where possible — a connected assistant can be revoked at any time from the portal, which deletes its access.

**Your Rights**
--------------

You can ask us at any time to:

* Access or export the personal data we hold about you
* Correct inaccurate data
* Delete your account and associated data
* Disconnect an assistant or a linked GitHub installation (you can also do both yourself, in the portal and on GitHub)

**Security**
------------

We use encryption in transit, hashed token storage, short-lived sign-in links, and per-task credentials for repository access. No method is perfectly secure; if something goes wrong that affects your data we will tell you.

**Contact**
----------

Questions about this policy: **malipetek@gmail.com**.

**Changes**
----------

We may update this policy. Material changes will be announced on the site or by email.

**Effective Date**
-----------------

27/10/2026.
