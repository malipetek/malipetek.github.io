# Competitive landscape

**Internal only.** No name, price or claim from this file goes into public copy,
email, listings or the site. It exists to keep positioning decisions honest, not
to be quoted.

Source: a public-web research pass (October 2026). Prices and counts are
**reported, not verified**. Treat them as directional; verify before relying on
any figure, and never cite a competitor by name in marketing.

## The four categories a buyer is actually choosing between

| Category | Examples (reported) | Model | Why it is not this |
| --- | --- | --- | --- |
| Vibe-code rescue / cleanup | SoftTeco, Redwerk, Belitsoft, bitnoise, Assembler AI, asd.team, izzy.agency | Audit → fixed quote, $1,500–$4,000+ | Project-sized messes, calls, weeks; solves it after it is big |
| Unlimited dev subscriptions | Figue, Awesomic, Eastlancers, AsyncForge, DesignJoy | Monthly fee, queue, one active request, €1,990–$7,990/mo | A commitment; 100–1000× the entry price |
| Marketplaces and live help | VibeCodeFixers, Fiverr, Upwork, Codementor | Per-project or per-minute, human | Introduces a stranger; no single accountable builder; Codementor has a 15-minute floor and is synchronous |
| DIY agents | Devin, Factory, Cursor, Claude Code, Codex, Copilot | $20–$200/mo, buyer operates it | No human accountability; the buyer does the work |

## The nearest direct offers

| Offer | Reported model | Reported price | Difference |
| --- | --- | --- | --- |
| Rune | Flat-rate code repair, human devs, 24–48h | $99 / $299 / $499 | Closest on "small fix, fast, no contract"; fixed packages, not metered; no agent pipeline |
| VibeCodeFixers | Marketplace of ~300 developers | Not published | Same audience; no single accountable builder, no portal |
| Codementor | Live per-minute help | ~$8–$30 per 15 min | Closest on metering; 15-minute minimum, synchronous, developer-facing |
| WP Buffs / Urgent Website Fix | Unlimited small-fix subscription | Care plans; custom dev ~$100/hr | Closest on "small fixes for small business"; WordPress-only, recurring, response windows |
| Rescue agencies | Audit → quote | ~$110/hr or $1,500–$4,000 audit | They fix project-sized messes, not a single small job |

## What is actually ours

1. **Per-second metering with no minimum.** The only per-minute analogue
   (Codementor) has a 15-minute floor and requires a live session. Nobody
   reported combines per-second billing with asynchronous work.
2. **The portal is the product.** Request → approval → budget → one thread →
   preview → publish. Competitors use calls, forms, email, Slack or a
   marketplace introduction.
3. **The explicit human sign-off.** Most agencies either hide the agent or lead
   with it. "The agent types. I sign off." is a distinct trust position where
   the buyer's real fear is that nobody is accountable.
4. **Small jobs are the product, not the loss leader.** Every competitor has a
   floor: $99, 15 minutes, a $1,500 audit, or a monthly subscription. A $2–$8
   job sits beneath almost every minimum.

The agent is not the differentiator. The portal, the meter and the sign-off are.

## Where the market is converging

- **Downmarket:** rescue agencies and subscriptions add cheap "small fix"
  tiers; WordPress care plans already own that relationship in WordPress.
- **Upmarket:** marketplaces add instant pricing and agent-assisted fixes.
- **Commoditization:** "Claude Code agency" is already a label; "one-person dev
  shop with an agent" is becoming common.
- **DIY pressure:** at $20/month a technical buyer tries an agent first. The
  buyer here is the one who does not want to operate it.

## What this changes in the kit

1. **Do not chase "vibe code cleanup" or "rescue" SEO.** The category is
   crowded and priced in projects. Keep "the last mile" and "small fixes".
2. **Compare categories, not companies.** `WHY_NOT` in `src/lib/offer.js`
   already does this: doing it yourself, a chatbot, a freelancer/agency, the
   cheapest developer. Keep it. Naming a competitor invites comparison shopping
   and dates the copy.
3. **Make the meter concrete with the pilot range.** "$1.67 a minute" is the
   hook; "the first five jobs billed $2.18–$8.25" is the number a buyer can hold
   in their head. `proof.md` and the one-pager already lead with it.

## What this does not change

- The offer, the price, the hooks and the safeguards. No competitor discovery
  changes what the system does.
- The audience: business owners who do not want to operate an agent.
- The proof frame: pilot jobs, not clients.

## Before citing any of this

- [ ] Check the competitor's live pricing page, not a blog post about it.
- [ ] Check the date on any marketplace count (developer counts age fast).
- [ ] Confirm the model: human, agent, or hybrid; synchronous or asynchronous.
- [ ] Decide whether the comparison is even necessary. Usually it is not: the
      buyer's alternatives in `WHY_NOT` are categories, not companies.

## Monitoring

Quarterly, check five names only: Rune, VibeCodeFixers, Codementor, one
unlimited-dev subscription, and one rescue agency. Look for a cheap small-fix
tier, instant pricing, or agent-assisted delivery. If one appears, the answer is
not to copy it — it is to make the portal, meter and sign-off more visible.

## Sources from the research pass

Unverified; keep for provenance, not for copy.

- Rune — on-demand code repair: runeintel.com/blog/on-demand-code-repair-service
- VibeCodeFixers — vibecodefixers.com; Slashdot coverage, Sep 2025
- Codementor — codementor.io/real-time-experts
- WP Buffs — wpbuffs.com/services/unlimited-support/
- Urgent Website Fix — urgentwebsitefix.com/website-subscription/
- Figue — figue.ai/en/blog/best-unlimited-development-subscriptions
- Awesomic — awesomic.com
- Eastlancers — eastlancers.com/custom-software-development
- AsyncForge — asyncforge.com/services/fix-and-improve-software/
- DesignJoy — designjoy.co
- Assembler AI — assemblerai.io/code-rescue/
- asd.team — asd.team/software-project-rescue-services/
- bitnoise — bitnoise.pl/services/vibe-code-rescue
- Redwerk — redwerk.com/services/vibe-code-cleanup/
- Devin — devin.ai/pricing
- Factory — developersdigest.tech/blog/factory-ai-droid-model-routing-costs
- HN discussion — news.ycombinator.com/item?id=45320431
