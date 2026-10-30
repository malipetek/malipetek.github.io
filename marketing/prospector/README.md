# Prospector

Three tools that turn public pages into a CSV the Marketing desk imports.

- `extract.mjs` reads a list of pages Ali chose. One request each, then stop.
- `directory.mjs` walks one trade directory to find its member profiles, their
  contact addresses, or the members' own sites.
- `bulk.mjs` reads homepages from a big domain list and asks Jev which ones are
  US small businesses.
- `osm.mjs` turns OpenStreetMap categories into a list of business websites.

None guesses addresses (`first.last@company.com`), uses a search engine, or
reads a site it was not pointed at. None sends anything.

## Extract

```sh
cat > prospects.txt <<'EOF'
# Small bakeries and florists with an order form and no online payment
acme-bakery.com/contact
rosas.co.uk
EOF

node marketing/prospector/extract.mjs --urls=prospects.txt
# → marketing/prospector/prospects-2026-10-28.csv
```

`prospects.txt`, `prospects-*.csv`, `directory-*.csv`, `signals-*.jsonl`,
`*-sites.txt` and the Tranco list are gitignored: they hold other people's
contact details (or are 22 MB), and this repository is public.

## Directories

```sh
# Just the directory's own pages: listing → pagination → member profile.
node marketing/prospector/directory.mjs --site=https://example-directory.com

# Only member pages matching a pattern, a smaller budget.
node marketing/prospector/directory.mjs --site=example.com --include='/members/' --max-pages=80

# Profiles hide the address — keep the member sites and let the extractor read them.
node marketing/prospector/directory.mjs --site=example.com --links-out=member-sites.txt
node marketing/prospector/extract.mjs --urls=member-sites.txt
```

- Starts at `--site=` (repeatable) or `--urls=a-file`, then breadth-first
  follows links to `--max-depth` hops (default 2: listing → pagination →
  profile) and at most `--max-pages` (default 60, hard stop 200).
- Stays on the start host unless `--any-host`. Most directories keep the
  address off the profile, so the useful default is to collect member sites
  with `--links-out` and let the extractor visit each one once.
- Skips logins, carts, feeds, files, and social/maps/review hosts before
  fetching. Query strings are kept, because that is how pagination works.
- `--include` and `--exclude` are case-insensitive regular expressions on the
  full URL, applied to every link before it is fetched.
- Output is `directory-<date>.csv`, same columns as below. `site` is the
  member's own domain when the profile links to one; `source_url` is the
  profile page, so the row is still traceable after the crawl.

With `--any-host` the crawler is reading businesses' own sites — the same thing
`extract.mjs` does — but from a list nobody looked at. Keep the budget small,
read the rows, and drop anything that is not a business contact.

Many directories paginate with JavaScript, so a plain crawl reaches only the
first page of results. When a run comes back with a handful of profiles, seed
the category or county filter pages (`--site=...` repeated) instead: each is a
normal page, and the profiles under it are ordinary links.

## Bulk lists

A directory gives you forty businesses you had to choose yourself. A bulk list
gives you a hundred thousand you did not. Two stages, because the judgement is
the only part that costs money:

```sh
# 1. Read homepages. Free, no key. Stops at ~2 minutes per 1,000 domains.
node marketing/prospector/bulk.mjs collect \
  --domains=tranco-top-1m.csv --rank-from=300000 --limit=1500

# 2. Ask Jev which are US small businesses. Only pages with an address are sent.
TYPESAFE_API_KEY=… node marketing/prospector/bulk.mjs qualify \
  --in=signals-2026-10-29.jsonl
```

`collect` writes `signals-<date>.jsonl`, one record per homepage that publishes
an address: name, description, headings, the first 1,200 characters of text, and
the address with the page it was found on. Pages without an address are
dropped, not shelved. Interrupt it and rerun the same command: domains already
in the file are skipped.

`qualify` sends each record to `POST /v1/systemone` as one request with three
questions — small business (0–1), US-based (0–1), sector (one of eight). Rows
pass at `--min-small=0.7` and `--min-us=0.6`; the sector and both probabilities
go into `notes`. Jev cost is about $0.04 per thousand pages, so a ten-thousand
page run is a rounding error; the network is the expensive part.

- `--domains=` accepts `rank,domain` (Tranco), one domain per line, or the
  Rapid7 FDNS JSONL (`jq -r 'select(.type=="mx") | .name' fdns.2026-10-28.json`).
  FDNS downloads are account-gated at sonardata.rapid7.com; Tranco's top-1M is
  free and needs no key.
- `--rank-from`/`--rank-to` slice a ranked list. Skip the head: ranks under
  ~100k are big companies. Ranks around 300k read as the long tail of real
  sites with plenty of noise.
- `--tlds` defaults to `com,net,org,us,co`, which throws away most of the
  non-US web before a single request. `--tlds=any` turns it off.
- Expect roughly **one address per five domains** in that tail (measured: 261
  records from 1,283 domains), and only a small share of those survive Jev —
  most of the tail is not a US business. Popularity is not a proxy for "small
  business", which is why OSM below is the better starting list.
- A domain that answers slowly or not at all is not retried; the next run will
  pick it up.

## OpenStreetMap

Popularity ranks nobody by trade. OSM already knows the plumber on the corner
and, for 932 of 2,130 US plumbers, their website. `osm.mjs` turns one category
at a time into a domain list; the bulk reader then finds the address.

```sh
node marketing/prospector/osm.mjs --area=US --categories=plumber,dentist,florist
# → marketing/prospector/osm-US-domains-2026-10-29.txt   (+ a .jsonl of names)

node marketing/prospector/bulk.mjs collect --domains=… --tlds=any
TYPESAFE_API_KEY=… node marketing/prospector/bulk.mjs qualify --in=…
```

- `--categories=` takes names from `CATEGORIES` in `osm.mjs` (30 trades and
  local services) and defaults to all of them; `--area=US` is an ISO 3166-1
  code, `--bbox=south,west,north,east` works instead.
- Only elements with a `website`, `contact:website`, `email` or
  `contact:email` tag come back. Socials, marketplaces and site builders
  (`wixsite.com`, `square.site`, …) are dropped: one host cannot stand for
  forty businesses.
- One query at a time, three seconds apart, 2,000 elements per category, and
  the data is OSM's (ODbL, © OpenStreetMap contributors).
- Overpass queues hard when it is busy. The tool tries the main instance, then
  two mirrors, and reports a category as failed rather than half-reading it.

Run fewer categories at once when it fails: the response size is the cost, and
`restaurant` in the whole US is far heavier than `locksmith`.

## What comes out

```
email,name,business,site,source_url,gap,consent_basis,notes
info@rosas.co.uk,,Rosa Florist,https://rosas.co.uk,https://rosas.co.uk/contact,,legitimate_interest,...
```

- `name` is empty. Only a person who knows the business should fill it in.
- `business` is `og:site_name` or the first part of `<title>`; fix the odd one.
- `source_url` is the page the address was published on — the evidence that it
  was public, and the field to cite if anyone asks where it came from.
- `gap` is empty. **Write it yourself**, one specific observation per business
  ("your order form asks for a card before it shows a total"). The desk pauses
  every contact without one, so nothing half-written can leave.
- `consent_basis` is `legitimate_interest`: a business address, published for
  contact, and a message about that business's own site. Change it to
  `existing_relationship` for people Ali has actually worked with.

Then: **Admin → Marketing → Contacts → Import**, pick the sequence, and the
contacts queue. Read them once before importing; a wrong row is easier to fix
in the CSV than in the desk.

## Rules they follow

- **Only these pages.** The extractor reads the URLs you give it. The crawler
  follows links only from the directory you name, up to its depth and page
  budget. No search engines, no sitemaps.
- **robots.txt is read first**, both `*` and a group naming this crawler, once
  per origin per run. A disallowed page is skipped, and so is an origin whose
  robots.txt is unreachable or refuses.
- **One request at a time, at least 1.5 s apart** — slower when the host's
  `Crawl-delay` asks for it. The bulk reader makes one homepage request and at
  most one contact-page request per domain, so it runs several domains at once
  and never returns to the same host.
- **Identifies itself** as `MalipetekProspector/1.0 (+https://malipetek.dev/bot)`.
- **The business's own domain wins** over the web agency or form vendor in the
  footer, whenever the page sits on that domain.
- **No opt-out needed to be extracted**: the desk adds the postal address and
  the reply-"no" line, and stops the sequence the moment someone replies.

## The parts that are on Ali

Scraping public pages for business contact details is lawful in most places,
but cold email is not lawful everywhere and not welcome everywhere:

- **Turkey (KVKK) and the EU/UK (GDPR)** want a lawful basis and a short
  retention period. `legitimate_interest` is defensible for a B2B address that
  the business publishes for enquiries, not for a personal address lifted from
  a team page. When in doubt, leave the row out.
- **The US (CAN-SPAM)** requires a real postal address and a working opt-out.
  Both are set in **Marketing → Settings**; a send refuses to start without the
  address.
- **Some addresses are role inboxes** (`info@`, `hello@`). That is fine for a
  business enquiry; it is not a person who can consent.
- **Delete on request**, not just from the queue: the contact row is the record.
  Opting out keeps the address so it is never imported again.
