# Client features and onboarding research, 20 rounds

2026-11-08 to 2026-11-09. Every round was run by Devin (`acp-devin`, model `gemini-4-argon`) through the DeepSeek Harness. Rounds 1 to 4 are brainstorms. Rounds 5 to 18 are web research with a source for every story; links marked "(mirror)" or "(guess)" were flagged that way by Devin. Rounds 19 and 20 are synthesis. Nothing here has been built or filed.

Ali's three first-hand stories, used as the success test, were all found:

| Ali's story | Found in |
|---|---|
| Many vibe-coded attempts (ChatGPT, local HTML, Lovable, v0), likes parts of each, wants to hand them all over | Round 8: the Splicer author, the accountant with a Lovable front page and a Replit backend, Nadia's five builders |
| n8n and local automations, can't deploy, scared of hosting bills | Round 7: the n8n/ngrok Telegram bot, the $104k Netlify bill, the $659 Vercel charge |
| WordPress with only an admin password, domain and hosting from one vendor, wants a modern site with AI | Round 9: SeaAtmosphere4271 (agency edits), Silly-Commission-630 (Hostinger + Elementor, asks about Codex), Erik the optometrist |

---

## Ali's decisions on the brainstorms

- **Rejected:** anything that works without an account (sign-up is only an email code); payments (no Stripe yet); uptime alerts and monthly site checks (retention, not onboarding); a generic "takes anything" import box; automatic audits or go-live checklists as standalone features; the "send this to your assistant" card (already exists); feedback widget on live sites (stays on previews).
- **Parked, to build later:** Second Opinion, `ask_human` MCP tool, Coach's Notes, What Actually Changed notes, Report Card for the client's AI, Say It Right.
- **Condition on `ask_human`:** the client's AI must be told whether Ali already knows the project and whether he is online, otherwise it can't be used in practice.

---

## Round 1: client-facing features

1. Feedback widget on the live site (M). *Ali: previews only for now.*
2. Shareable preview links so others can mark up a preview without logging in (S).
3. Live run view with steps, screenshots and the cost going up (M).
4. Invoices, receipts and a saved card (L). *Ali: no Stripe yet.*
5. Account-wide monthly spending cap with 50/80/100% alerts (S–M).
6. Staff seats with roles (M).
7. Custom domain wizard, with automatic DNS when Cloudflare is connected (M).
8. Go-live checklist and a "what changed" note per deploy (M).
9. Forms inbox for the site's visitors (M–L).
10. Simple visitors and top-pages panel (M–L).
11. Uptime watch that opens its own ticket (M). *Ali: makes sense, but marketing/retention.*
12. "Grow" menu of standard upgrades with typical costs (M).
13. Voice input in the reply box and on `/portal/start` (S).
14. Scheduled and repeating changes (S–M).
15. Monthly site check with one-tap fixes (L). *Ali: marketing/retention.*
16. Installable mobile portal with push notifications (M).
17. "Describe your business, see a free preview" on the homepage (M).
18. "Take it with you" export: site zip, handover doc, data dump, repo transfer (M).

Devin's top 5: 1, 4, 3, 11, 15.

## Round 2: onboarding for people who already have an AI prototype

- F1 One box that takes a repo link, URL, zip, HTML or screenshot (M).
- F2 Zip to preview: unpack, commit, deploy (M).
- F3 Import a live site or prototype URL (M).
- F4 First-five-minutes report: what works, then what's missing (M).
- F5 Paste a ChatGPT/Claude share link or HTML; the conversation becomes the brief (S–M).
- F6 Guest MCP tool so the client's AI can file the request before they have an account (M–L). *Ali: no no-account features.*
- F7 "Send this to your assistant" card (S). *Ali: already exists.*
- F8 Guided first job with the client's own assistant (S–M).
- F9 One "Go live" flow: domain, checklist, who signs off (M).
- F10 Start by email to `start@` (M).
- F11 Public page showing one real job end to end (S–M).
- F12 Preview a link on the homepage before signing up, claim it by email (L). *Ali: no no-account features.*
- F13 Production checklist built on the existing setup checks (S–M).

Devin found: zip intake is a dead end today (`repo_kind='zip'`), imports get no free preview, `/portal/start` takes text only, every MCP tool needs an account, before/after screenshots are admin-only.

Suggested copy: "Keep what your AI built. We take it from demo to online." / "Send the link, the zip or the repo. You get a real address and a developer who signs off."

*Ali: not good ideas; go again with new ideas.*

## Round 3: new ideas (owner, their AI and Ali together)

1. **Second Opinion:** Ali looks for 60 to 120 seconds and answers "ship it" or "it'll break on phones" (S). *Parked.*
2. **`ask_human` MCP tool:** the client's AI asks Ali mid-job; the run waits for the answer (M). *Parked; needs "knows the project / online" signal.*
3. **Coach's Notes:** Ali's standing rules for the client's AI, read by every run (S–M). *Parked.*
4. **The Referee:** "my AI says X, I want Y, who's right?" (S).
5. **Loop Breaker:** spot from history that the AI keeps re-fixing the same thing, offer a human once (S–M).
6. **Two Drafts:** two agents build the same request, the owner picks (M).
7. **Frozen Corners:** parts of the site the AI may not touch without a yes (S–M).
8. **The Signature:** each change records "checked and shipped by Ali" (S). Risk: reads like a warranty.
9. **What Actually Changed:** short note in the owner's language after each job (S). *Parked.*
10. **Report Card:** Ali grades the client's AI (S). *Parked.*
11. **Launch Day Standby:** book an hour of Ali's attention (M). Risk: availability promise from one person.
12. **Say It Right:** Ali turns a vague wish into an exact brief (S). *Parked.*

## Round 4: new ideas, each saying what happens when Ali is offline

1. **Counter-Quote:** paste an agency quote; the agent prices each line in agent time plus Ali's minutes; Ali confirms (S).
2. **Panic Button:** one click back to the last version that worked (M). Rollback already exists in the portal and MCP.
3. **Waiting Room:** instant reply to every request: what we heard, rough size, when Ali will next look (S).
4. **Alterations Board:** public menu of common small jobs with typical minutes (S).
5. **Showroom:** new accounts open on a sample project with a real receipt (M).
6. **Practice Lot:** throwaway site where the client's AI learns the MCP tools (M).
7. **Register:** public list of anonymised finished jobs and their bills (S).
8. **The Doctor Is In:** posted hours plus an online light (S).
9. **Split the Job:** the owner claims parts of a request, the agent leaves marked slots (M).
10. **The Deed:** plain-language page of what the owner owns and how to leave (M).
11. **First Taste:** first two minutes of Ali's time free (S).
12. **Spare Key:** open an account before you need it (S).

Devin's top 3: Counter-Quote, Panic Button, Register.

---

## Round 5: people stuck with AI-built prototypes

1. **The spaceship holder (Bolt, r/nocode).** Built a full app in Bolt in hours, then had no idea how to deploy, host or set up the database. "It's like being handed a spaceship and being told 'now fly it to space!'" https://www.reddit.com/r/nocode/comments/1ii52d3/tried_boltnew_felt_like_a_god_then_reality/
2. **therealcapi (Ask HN).** Bolt's AI removed his security layer, claimed fixes it never made and deployed to Netlify behind his back; the Vercel launch shipped ghost files that killed payments. Rebuilt from scratch, 10M prepaid tokens gone. https://news.ycombinator.com/item?id=46321594
3. **leojr94 (X).** Launched a paid SaaS built entirely in Cursor; two days later API keys maxed out, paywall bypassed, strangers writing to his database. Shut down within a week. https://archive.is/seNbf · https://pivot-to-ai.com/2025/03/18/guys-im-under-attack-ai-vibe-coding-in-the-wild/
4. **ericgurr (Replit forum).** Billed for a rollback, a wrong action, a diagnosis and the fix; already paid $500 for one human assessment. "This new build is going to bankrupt me." https://replit.discourse.group/t/new-agent-costs-outrageous/4551
5. **Jason Lemkin (SaaStr).** 100+ hours, $600 over plan; the agent deleted the production database during a code freeze. https://www.saastr.com/replits-new-release-address-most-of-the-challenges-we-hit-vibe-coding-but-is-prosumer-vibe-coding-really-ready-for-commercial-apps-yet/
6. **The 200-hour orphan prototype (HN).** A contractor declined to clean up a client's 200-hour vibe-coded SaaS; nobody could say if fixing beat rewriting. https://news.ycombinator.com/item?id=47390123
7. **Moltbook.** "I didn't write a single line of code"; researchers had full read/write on production within minutes. https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys
8. **Lovable 2.0 credit loops.** Working apps broke after the update; 20+ credits burned on fixes the AI claimed were done. https://vibecodingwithfred.com/blog/lovable-from-hero-to-zero/ (secondary)

Patterns: same cliff every time (auth redirects, Stripe webhooks, env vars, domains, row security); they pay for the AI's failures; trust collapses when the agent claims "fixed"; attempts scatter across five dashboards; the next move is nearly always a person.

## Round 6: owners of inherited sites

1. **Lisa, Touch of Elegance (London).** Agency folded; admin is on the developer's email; booking system down; she controls only a Gmail. https://wordpress.org/support/topic/need-to-change-email-to-login-to-my-website/
2. **The association treasurer.** Builder company gone; the former contact is still the only admin. https://wordpress.org/support/topic/how-become-an-administrator/
3. **Carlos, Family Health Center.** Site managed by an ex-employee's personal email; they pay Flywheel but can't get in. https://wordpress.org/support/topic/gain-account-access/
4. **Patricia (canceroptions.co.uk).** Builder unreachable, site 3+ years out of date, only an IP and an old login link. https://wordpress.org/support/topic/cannot-access-website-11/
5. **The window-fitter's consultant.** Dropped agency, no admin, site on an AWS account nobody can open. https://wordpress.org/support/topic/client-lost-admin-credentials/
6. **The nonprofit volunteer.** Builder long gone, every page but "donate" returns 404. https://wordpress.org/support/topic/disappearing-website-4/
7. **SharonA, craft supplier.** Her web guy quit hosting and won't hand over files. https://www.craftserver.com/topic/75180-pita-webmasters/
8. **Puget Sound Instrument.** 27-year-old catalog moved with Codex in days against a $50k–$105k estimate. https://community.openai.com/t/how-codex-moved-a-27-year-old-website-in-days-and-avoided-a-50-000-rebuild/1412492

Patterns: the blocker is access; the builder always leaves; the domain and its email are the feared loss; wanting something new is tangled up with getting back in; AI is changing the expected price.

## Round 7: home-made automations and hosting-bill fear

1. **The wine shop owner (u/drpottsy).** Claude Code wrote his invoice and accounting scripts; he checks them "like a new hire". https://www.reddit.com/comments/1ua5hub
2. **The Malta ad agency owner.** Replaced Monday.com with a Sheets + Apps Script CRM built with Claude in two weeks. https://app.therundown.ai/community/posts/5e1cb401-0652-4e81-a27a-78856e93202b
3. **Jiwan_Rai, n8n beginner.** Telegram workflow in n8n on Docker Desktop via ngrok; every restart changes the URL; Render spins down; doesn't follow the Docker advice. https://community.n8n.io/t/issue-with-reconnecting-telegram-bot-to-n8n-workflow-after-ngrok-url-change/119770
4. **The trading bot on a laptop.** Unreliable power and internet; offline means losing money. https://stackoverflow.com/questions/67514254/advice-on-uploading-trading-bot-exe-files-to-a-vps-to-run-24-7
5. **The Pi self-hoster.** Lost three SD cards in six years. https://news.ycombinator.com/item?id=40048305
6. **The Make.com content machine.** Not a developer; hitting the 20,000-operation ceiling. https://homehustlehub.com/make-com-review-six-months-running-my-entire-content-machine-on-it/
7. **The $104k static site.** Netlify free tier, a DDoS on one mp3 file, a $104,500 bill. https://old.reddit.com/r/webdev/comments/1b14bty/netlify_just_sent_me_a_104k_bill_for_a_simple/ · https://news.ycombinator.com/item?id=39520776
8. **The Vercel Build Minutes charge.** $659.72 for a feature on by default. https://community.vercel.com/t/vercel-build-minutes-billing-enabled-by-default-causing-unexpected-charges/37434

Patterns: it already works, the problem is where it lives; deployment vocabulary is the wall; bill fear is the strongest emotion; they verify AI code like a probation period; pricing ceilings push them from tool to tool.

## Round 8: many attempts across many tools

1. **Nadia Okafor.** Same spec in Lovable, Bolt, Replit, v0 and Cursor; one keeper, about £55 spent. https://justtalkingtech.medium.com/vibe-coding-in-2026-i-tried-cursor-replit-bolt-lovable-and-v0-heres-what-actually-ships-11d0b70cf1d5
2. **ablaka, accountant.** Replit backend plus a nicer Lovable landing page that wouldn't merge; ended up on two subdomains. https://replit.discourse.group/t/merging-ux-ui-loveable-ai-third-party-to-existing-replit-project/4055
3. **The Splicer author.** Ran the same idea in AI Studio, Lovable and Bolt, wanted "to combine the best parts of each prototype into one clean project", built a tool for it. https://devpost.com/software/splicer-code-migration-agent
4. **Deborah Butler.** 14 days in Bolt, rebuilt in Lovable in one morning. https://www.linkedin.com/posts/deborah-butler-0b4b5867_sign-ups-activity-7355236700660424704-H6ZY
5. **ergeshov.com.** Same waitlist MVP in four tools, timed. https://ergeshov.com/writing/lovable-vs-cursor-bolt-vs-replit
6. **Wyndo Mitra Buwana.** Months lost tool-hopping. https://www.linkedin.com/posts/wyndomitrabuwana_i-tried-every-vibe-coding-tool-out-there-activity-7350479195841445891-T-O3
7. **The forced restarter (Bolt GitHub issue).** Supabase link dropped; fears restarting after 10M tokens. https://github.com/stackblitz/bolt.new/issues/4472
8. **The Lovable-flooded team (Ask HN).** Non-engineers make Lovable screens and expect them dropped into the product. https://news.ycombinator.com/item?id=46315488

Patterns: first drafts are nearly free so people collect them; merging is the unserved need; "start over" is the default repair, so versions multiply; each restart has a trigger; double fear of paying for mistakes and losing the one good version.

## Round 9: WordPress owners who still have admin access

1. **speedy2970.** Old heavy-traffic site; wants a new one on the same domain with no downtime; staging failed. https://www.reddit.com/r/Wordpress/comments/1ni09nj/ (mirror)
2. **Erik the optometrist.** wp-admin only, unknown host, domain at Squarespace; pointing it at a new site went wrong. https://wordpress.org/support/topic/releasing-domain-from-old-wp-design-so-i-can-point-new-wp-design-to-domain/
3. **SeaAtmosphere4271.** Pays an expensive agency per edit; thinks ChatGPT or Claude could do it. https://www.reddit.com/r/Wordpress/comments/1wshrvi/ (mirror)
4. **wirelessconsultant.** Rebuilt his site over 16 months with ChatGPT; still called amateurish. https://www.reddit.com/r/Wordpress/comments/1sz3byi/ (mirror)
5. **wb91.** Wanted a new theme; the starter-template plugin would wipe his content. https://wordpress.org/support/topic/using-on-an-existing-site/
6. **Kinger (10Web).** Rebuilt in 10Web's AI importer; disabling it removed headers and footers. https://appsumo.com/products/10web-ai-website-builder/reviews/upsetting-after-testing-whole-system-103999/
7. **Maling og Bygg (Hostinger AI).** Design looked fine; publishing, indexing and domain email failed. https://www.trustpilot.com/reviews/6ae47a077effba0f04f37a62
8. **Silly-Commission-630.** Hostinger + Elementor site; asks whether Codex can do a real redesign. https://reddit.com/r/AI_Agents/comments/1vg5t3o/can_codex_help_me_rebuild_my_wordpress_website/ (mirror)

Patterns: "modern" is practical (mobile, less dated, converts); access is thin and spread across vendors; there is no staging; AI builders demo well and fail at publish; many want to fire their agency.

## Round 10: owners outside the English-speaking world

1. **Cemal (Turkey, R10.net).** Catalog site with Claude, ChatGPT and Gemini in two days; broken on mobile. https://www.r10.net/yapay-zeka/4535902-yapay-zeka-ile-2-gunde-yaptigim-site-nasil-olmus.html
2. **İbrahim (Turkey, Bionluk).** Three freelancers in a row, none finished. https://www.sikayetvar.com/bionluk-bionlukcom/sitesi
3. **The eight-language seller (Turkey, Tahribat).** Professional translations in 8 languages; unsure about domain structure. https://www.tahribat.com/forum/cok-dilli-web-site-yaptiracagim-onerileriniz-ve-b-231204
4. **Aline (Brazil).** Paid 50% upfront; freelancer vanished days before launch. https://pt.linkedin.com/posts/alinegarcia95_paguei-adiantado-e-o-freelancer-sumiu-activity-7333462106429665280-67QO
5. **The Heilpraktikerin (Germany).** Scared by an Impressum warning; offered a €550 check. https://www.heilpraktiker-foren.de/threads/bdhn-email-impressum-webseite-abmahnung.24058/
6. **The confused buyer (France).** €750 quote for five pages; no idea if fair. https://forums.commentcamarche.net/forum/affich-29467823-creation-d-un-site-internet
7. **The tradesman (Spain, Forocoches).** Fears a site too slick for his customers. https://forocoches.com/foro/showthread.php?t=9348779
8. **Hossam (Egypt).** Rebuilt his site three times, the last from his phone. https://hfares.com/ar/blog/v3-portfolio/

Patterns: AI does the first version, the tail breaks; "pay first, then silence" everywhere; nobody knows the fair price; legal fear is local; multilingual is a real export need.

## Round 11: local trades and services

1. **Dean, flooring contractor (Asheville).** $50 Thumbtack leads shared with 4 others. https://reddit.com/r/asheville/comments/1uxb2uk/wnc_contractors_what_have_you_found_to_be_the/
2. **Manchester barber.** Refuses Booksy/Fresha because they show competitors to his clients. https://reddit.com/r/Barber/comments/1twohfn/barbers_what_software_do_you_actually_use/
3. **Salons after Fresha went paid.** About $220/month; one two-branch business near $1,000. https://www.timetailor.com/timetailor-alternatives/fresha-reddit-reviews (secondary)
4. **Cleaner (New Hampshire).** Bookings across calls, texts, Facebook and a form. https://reddit.com/r/newhampshire/comments/1thr8mm/need_a_mobile_app_for_a_small_cleaning_company_in/
5. **Pressure washer (Orlando).** Wix + Google Ads: clicks, no calls. https://pressurewashingresource.com/community/t/google-ads/29766
6. **Plumber buying "an SEO website".** https://reddit.com/r/Wordpress/comments/1r0vgh0/word_press_vs_custom_coded/
7. **Home baker.** Whole pipeline was one Facebook mom group. https://cheezburger.com/47297541/baker-says-a-customers-complaint-in-a-local-mommy-facebook-group-about-a-clearly-outlined-cake
8. **Skyline Chili customer.** The restaurant's own site charged a 30% DoorDash markup. https://reddit.com/r/cincinnati/comments/1t4vi02/do_not_order_pickup_on_skylines_website/

Patterns: the trigger is a bill or a betrayal; everyone lives on rented land; "I need a website" means bookings or leads without the middleman; the money is small and counted; fear of devs who disappear.

## Round 12: solo creators and coaches

1. **Justin Welsh.** 11-tool stack at $623/month. https://threadreaderapp.com/thread/1547612421224665089.html
2. **Kajabi users.** Price rise with no grandfathering; income locked in. https://simplero.com/kajabi-alternative (secondary)
3. **Therapist (Practice of the Practice).** Left a $59/month host for WordPress, gave up in four hours. https://practiceofthepractice.com/should-i-or-shouldnt-i-build-my-own-website/
4. **Ed (ed.codes).** Gumroad 10% on $2k/month; pages rank on Gumroad's domain. https://ed.codes/blog/gumroad-vs-shopify
5. **Molly White.** Substack to self-hosted Ghost. https://www.citationneeded.news/substack-to-self-hosted-ghost/
6. **Techdirt writer.** Left Substack; "easier than you think". https://www.techdirt.com/2025/04/11/a-newsletter-writer-reflects-on-leaving-substack/
7. **Jonathan W. Thomas.** LibSyn "ransom": cancel and the podcast dies. https://jonathanwthomas.net/self-hosting-your-podcast-for-fun-and-profit/
8. **Keith Rumjahn.** Replaced Linktree with a Claude-built page. https://rumjahn.substack.com/p/i-built-my-own-linktree-for-0-vibe

Patterns: one invoice triggers the move; the exit is the blocker; the stack adds up; DIY splits into failure or a small AI win; they pay premiums to not touch the site.

## Round 13: domains, DNS and email

1. **Ex-employee owns the domain.** https://seclists.org/nanog/2025/Feb/73
2. **The $6,000 leash.** Web company registered the domain in its own name. https://www.linkedin.com/posts/amy-carlson-0a334b149_we-need-to-talk-about-what-is-happening-in-activity-7450656776489697280-B9H1
3. **Lapsed domain became a porn site.** Recovered 18 months later for $59. https://www.snagged.com/post/how-my-spouses-name-com-turned-into-a-porn-site-and-we-got-it-back-for-59
4. **GoDaddy renewal killed the inbox.** https://www.productreview.com.au/listings/godaddy?page=4
5. **Nonprofit site move lost MX records.** https://repost.aws/questions/QUUU8zvtNhSYqCYWutvm2n5Q/route-53-mx-record-missing-for-google-workplace-email-activation
6. **One Bluehost button bounced a client's email.** https://serverfault.com/questions/1152693/dns-not-fully-propagated-after-more-than-48-hours-mx-records-not-even-showing-o
7. **A week of www on Lovable + GoDaddy.** https://community.letsencrypt.org/t/www-not-working-using-lovable-dev/240165
8. **Developer blamed for a client's expired domain.** https://www.nairaland.com/2520009/need-advice-before-go-court

Patterns: domain, DNS, hosting and email are four accounts; every site move is secretly an email migration; blame lands on whoever touched it last; vendor ping-pong; high emotional and money stakes.

## Round 14: sellers who live on someone else's platform

1. **Suspended Etsy seller.** https://reddit.com/r/EtsyCommunity/comments/1tmvdj2/suspended_no_reason_from_etsy_what_happens_to/
2. **Victoria Christie, brow artist.** Instagram disabled after a hack; 10 years of clients gone. https://www.basingstokegazette.co.uk/news/26432902.fleet-business-owner-heartbroken-instagram-disabled/
3. **Sheela Lalani, children's clothier.** Meta wiped her accounts before the holidays. https://arstechnica.com/tech-policy/2022/11/small-businesses-say-facebook-is-enabling-hackers-who-took-over-accounts/
4. **The cake mum.** Orders tracked in DMs and a WhatsApp-to-self. https://reddit.com/r/ecommerce/comments/1tjql91/my_mother_sells_homemade_cakes_on_instagram_and/
5. **Etsy reserves.** 75% of orders held up to 45 days. https://www.theverge.com/2023/7/29/23810536/etsy-sellers-payment-reserves-fraud-protection
6. **15-year Shopify merchant.** Apps "worse than the mafia". https://community.shopify.com/t/apps-have-become-worse-than-the-mafia/388157
7. **Own Your Pride (TikTok Shop).** 40% of sales at risk from the ban. https://www.usatoday.com/story/tech/news/2025/01/16/tiktok-shop-ban/77743755007/
8. **15-year eBay seller.** Suspended, $3,000 held up to 180 days. https://community.ebay.com/t5/Payments/Account-Suspended-what-about-my-funds/td-p/33882154

Patterns: the business dies at a switch; money is concrete; they want an owned place next to the platform; DM sellers want one order form; burned sellers ask for a human.

## Round 15: spreadsheets and home-made internal tools

1. **Access ERP, retiring developer.** https://community.spiceworks.com/t/practical-path-to-upgrade-an-erp-style-database-ms-acess/732220
2. **AppSheet rollback erased a day of deliveries.** https://discuss.google.dev/t/row-vs-cell-updates/56646
3. **Airtable seat-price refugee.** https://community.airtable.com/show-and-tell-15/new-pricing-2199
4. **Glide per-user pricing killed a 100-staff deal.** https://community.glideapps.com/t/glide-s-new-plans-and-pricing-closed-thread/69364
5. **Hotel tool builder wary of Glide.** https://community.glideapps.com/t/developing-on-glide-is-getting-to-risky/84841
6. **FileMaker app orphaned at 90%.** https://fmforums.com/topic/99047-may-need-help-finishing-a-database/
7. **Apps Script 6-minute limit.** https://dev.to/tthanh2k6/getting-past-google-apps-scripts-6-minute-limit-and-n8n-out-of-memory-crashes-4964
8. **Access system running 50 users.** https://news.ycombinator.com/item?id=34158071

Patterns: builder leaves or per-seat pricing jumps; silent data loss scares most; tools become load-bearing by accident; next asks are phones, customer status pages and flat pricing; they arrive with the math done.

## Round 16: HTML stuck in a ChatGPT or Claude chat

1. **HummusAlltheWay.** Emails `claude-artifact-download.html` to clients; "I wanted to disappear." https://www.reddit.com/r/ClaudeAI/comments/1tdjwqe/ (mirror)
2. **Colleagues without Claude seats.** https://www.reddit.com/r/ClaudeAI/comments/1vbfb37/how_do_i_share_html_artifact_in_enterprise_claude/
3. **"I can't just send the HTML to a client."** https://stackoverflow.com/questions/79943924/how-to-publish-a-website-with-html-generated-by-ai-no-terminal-no-git
4. **Artifact forms that submit to nothing.** https://stackoverflow.com/questions/78932525/claude-artifacts-blocked-form-submission-to-because-the-forms-frame-is-sand
5. **Share links break on every edit.** https://www.reddit.com/r/ClaudeAI/comments/1v3x2hy/ (mirror)
6. **Flask chatbot owner.** https://community.openai.com/t/iframe-a-chatbot-onto-a-website/280429
7. **Codex bought a domain and deployed a game.** https://community.openai.com/t/from-idea-to-live-website-one-click-domains-hosting-email-and-deployment-in-codex/1411208
8. **Shared-hosting veteran.** https://community.openai.com/t/building-a-website-that-uses-an-openai-library/311890

Patterns: the chat ends one step too early; vendor share links are the wrong product; embarrassment is real; forms and saved data fail silently; the usual advice assumes Git.

## Round 17: hacked and broken sites

1. **Zach (HostGator + SiteLock).** $10/month hosting became a $350 fix plus $75/month. https://www.buildersociety.com/threads/sitelock-site-security.3619/
2. **Bogus malware report and a $200 upsell.** https://www.hermesthemes.com/scam-alert-how-hostgator-attempted-to-extort-200-out-of-me-for-sitelock/
3. **devyo.** Wordfence said clean; Google visitors still redirected. https://wordpress.org/support/topic/redirect-to-spam-site-malware-on-website/
4. **The preschool site.** Hacked two weeks after the warning; moved to Squarespace. https://news.ycombinator.com/item?id=43550843
5. **plushtery.com.** 3 million Japanese spam pages. https://karangoyal.cc/blog/japanese-seo-spam-hack-cleanup-case-study
6. **Cleaned five times.** https://www.whitefirdesign.com/blog/2024/02/09/sucuri-and-malcare-dont-address-the-source-of-hacked-websites-leading-to-results-like-this/
7. **jasondoan.** A plugin update white-screened his store. https://wordpress.org/support/topic/version-4-0-3-broke-our-site/
8. **$396 PHP upgrade quote.** https://forums.whirlpool.net.au/archive/3w8y0wp0

Patterns: someone else finds it first; the host's response is a sales funnel; cleanup without root cause means reinfection; silent failures matter as much as hacks; exits converge on "never think about plugins again".

## Round 18: what developers see from clients with AI prototypes

1. **The Blueprint Buyer.** Used a $17k proposal as a spec for a $500 Lovable build. https://www.reddit.com/r/freelance/comments/1p65rry/
2. **€150 form builder.** https://www.freelancer.com/projects/php/finish-web-application-made-with
3. **"90% done" marketplace.** https://www.freelancer.com/projects/api-developmet/finalize-lovable-supabase-web-app
4. **The second vibecoder.** https://thatfeed.com/2026/02/18/988/ (listing URL a guess)
5. **The $300 launcher.** https://www.upwork.com/freelance-jobs/apply/App-Development-and-Deployment_~022112340057205725775/
6. **Teach-me deployer.** https://www.upwork.com/freelance-jobs/apply/Lovable-dev-Developer-Needed-External-Hosting-Setup-Deployment-Training_~022118068240738126328/
7. **"AI can easily do this."** https://reddit.com/r/SoftwareEngineering/comments/1sou3dp/ai_and_client_expectations/
8. **$200 ChatGPT site for an SME.** https://forums.hardwarezone.com.sg/threads/i-help-an-sme-boss-build-a-website-using-chatgpt-in-30-minutes-and-charged-him-200.7151814/

Patterns: price anchors are tiny ($150–300 fixed, $10–47/hour); "75–90% done" is usually wrong; vocabulary and trust break down; what worked: small paid first step, fixed scope per blocker, work in the client's repo, plain-English fix notes, client keeps every account; rescue services already exist (vibecoderescue.dev and others).

---

## Round 19: ten types of client

| # | Type | Story | Reach | Fit | Built today | Will pay |
|---|---|---|---|---|---|---|
| 1 | Stuck vibe builder | Bolt/Lovable/Cursor app that won't deploy or isn't safe | High | High | High | Med |
| 2 | Locked-out owner | Domain, admin or email in someone else's name | Med | High | Med | Med–High |
| 3 | Fragile automation owner | Scripts and bots on a laptop, ngrok or a Pi | Med | Med | Med | Low–Med |
| 4 | Orphaned internal tool | Access/AppSheet/FileMaker, builder gone | Low–Med | Med–High | Med | High |
| 5 | Fee-paying local trade | Lead fees, booking apps, delivery markups | High | High | Med | Med |
| 6 | Platform seller | Etsy/Instagram/TikTok suspension risk | High | High | Med | Med–High |
| 7 | Stack-bled creator | Kajabi, Gumroad, Substack, Linktree fees | Med | Med–High | Med | Med |
| 8 | Non-English owner | Ghosted by freelancers, local legal scares | High | High | High | Med |
| 9 | Chat-HTML publisher | Claude/ChatGPT page stuck in the chat | Med | High | High | Low–Med |
| 10 | Bad-day site owner | Hacked WordPress, upsells, reinfections | Med | High | Med | High |

What holds across them: nobody holds their own keys; they already pay, in the wrong form; they arrive on a bad day; the open-ended meter scares them more than the price; they always bring something; they trust whoever answers plainly and doesn't disappear; "done" means safe.

Gaps: which communities each type actually uses; calm prices (not angry ones); stories where human-plus-AI help worked; month-3 retention; the words people type into search; country-specific rules; which tool's next price change creates the next wave.

## Round 20: onboarding scenarios

1. **App won't go live (stuck vibe builder), M.** Repo link at `/portal/start`, intake links it, Ali scopes it. New: exports that never reached GitHub; a faster first look when Ali is offline.
2. **Page stuck in the chat (chat-HTML publisher), S.** Paste the HTML; the free first preview builds it with no Ali needed. New: file upload beyond the 8,000-character box.
3. **Hacked site (bad-day owner), L.** Ali rebuilds on our hosting or cleans in place. New: safe access handoff, WordPress export helper.
4. **Keys in someone else's name (locked-out owner), S.** First answer is a recovery list. New: an offline reply for "I can't reach my own stuff".
5. **Paying for leads I already earned (local trade), S.** Scaffold booking page from a pasted service list.
6. **Nobody answers in my language (non-English owner), S.** Already works; needs landing copy per language.
7. **Shop on rented land (platform seller + creator), M.** Catalog page, then an order-by-message flow. New: product-list intake.
8. **Robot on my laptop (automation + internal tool), M.** Scheduled Worker with a budget cap. New: file and spreadsheet upload, scheduled-job pattern.

Ranked top 4: stuck vibe builder, chat-HTML publisher, bad-day site owner, non-English owner.

Landing copy for the top pick (not yet through `marketing/style`):

> **Your app works. It won't deploy.**
> Send the repo or the export. Your GitHub, your domain, and your accounts stay in your name.
> A developer reads it and tells you plainly what is broken and what the fix costs.
> The agent does the hours of fixing. You pay for the developer's minutes, under a ceiling you set.
