-- The SEO desk: what our own two hosts look like to search engines and to
-- assistants, what is wrong with them, and what we did about it.
--
-- Days are UTC calendar days, 'YYYY-MM-DD' text, because a reader compares
-- days (the 30-day score series, "a core update 10 days ago") far more often
-- than it does times of day. Times are unix seconds, like the rest of the
-- store. One row per page per day: the audit overwrites today's row, so a
-- re-run does not double the series.

CREATE TABLE seo_pages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  host           TEXT NOT NULL,
  path           TEXT NOT NULL,
  day            TEXT NOT NULL,
  status         INTEGER NOT NULL,
  title          TEXT,
  title_len      INTEGER NOT NULL DEFAULT 0,
  description    TEXT,
  desc_len       INTEGER NOT NULL DEFAULT 0,
  canonical      TEXT,
  hreflang_count INTEGER NOT NULL DEFAULT 0,
  -- JSON array of the @type values found in the page's JSON-LD.
  jsonld_types   TEXT NOT NULL DEFAULT '[]',
  h1_count       INTEGER NOT NULL DEFAULT 0,
  internal_links INTEGER NOT NULL DEFAULT 0,
  bytes          INTEGER NOT NULL DEFAULT 0,
  ms             INTEGER NOT NULL DEFAULT 0,
  in_sitemap     INTEGER NOT NULL DEFAULT 1,
  in_llms        INTEGER NOT NULL DEFAULT 0,
  -- JSON array of {code, severity, detail}: the page's issues that day.
  issues_json    TEXT NOT NULL DEFAULT '[]',
  score          INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX seo_pages_page_day ON seo_pages(host, path, day);
CREATE INDEX seo_pages_day ON seo_pages(day, host);

-- Open issues, one row per host + path + code. An audit that no longer sees
-- one sets resolved_at; seeing it again clears it and keeps first_seen, so the
-- age of a problem is honest across a fix that did not hold.
CREATE TABLE seo_findings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  host       TEXT NOT NULL,
  path       TEXT NOT NULL,
  code       TEXT NOT NULL,
  severity   TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  detail     TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  resolved_at INTEGER,
  -- The SEO cycle ticket that was asked to fix it, when there is one.
  ticket_id  INTEGER REFERENCES tickets(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX seo_findings_key ON seo_findings(host, path, code);
CREATE INDEX seo_findings_open ON seo_findings(resolved_at, severity, last_seen DESC);
CREATE INDEX seo_findings_ticket ON seo_findings(ticket_id);

-- What an assistant says when someone asks a buyer's question. One row per
-- question per probe, so the mention rate is a series and not a guess.
CREATE TABLE seo_geo_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  day              TEXT NOT NULL,
  question         TEXT NOT NULL,
  engine           TEXT NOT NULL DEFAULT 'deepseek',
  answer_excerpt   TEXT,
  mentions_us      INTEGER NOT NULL DEFAULT 0,
  -- JSON arrays of strings: the URLs it gave, the companies and products it named.
  cited_urls_json  TEXT NOT NULL DEFAULT '[]',
  competitors_json TEXT NOT NULL DEFAULT '[]',
  created_at       INTEGER NOT NULL
);
CREATE INDEX seo_geo_runs_day ON seo_geo_runs(day, id);

-- Backlink and profile placements: the places we can put a link to ourselves.
-- DR is the Ahrefs domain rating at the time the row was seeded; it is a
-- sorting hint, nothing here refreshes it.
CREATE TABLE seo_citations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  platform         TEXT NOT NULL,
  domain           TEXT NOT NULL,
  dr               INTEGER,
  profile_url      TEXT,
  status           TEXT NOT NULL DEFAULT 'todo'
                   CHECK (status IN ('todo', 'drafted', 'live', 'verified', 'skipped')),
  link_verified_at INTEGER,
  last_checked     INTEGER,
  -- The draft bio and link text, or why the row was skipped.
  note             TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX seo_citations_domain ON seo_citations(domain);

-- Annotations: the days Google changed something and the days we did. The
-- score series is read against these; without them a swing has no cause.
CREATE TABLE seo_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT NOT NULL,
  kind       TEXT NOT NULL,
  label      TEXT NOT NULL,
  source     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX seo_events_day ON seo_events(day DESC, id DESC);

-- Google rankings for the keywords we sell against. One row per keyword per
-- check (weekly), so a core update can be read against a real position change
-- instead of a feeling. position is NULL when we are not in the top 100; the
-- top_domains_json list is what was in front of us that week.
CREATE TABLE seo_ranks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  day              TEXT NOT NULL,
  keyword          TEXT NOT NULL,
  location_code    INTEGER NOT NULL,
  language_code    TEXT NOT NULL,
  -- Which of our hosts ranked, or NULL when neither did.
  host             TEXT,
  position         INTEGER,
  url              TEXT,
  -- JSON array of the top 10 organic domains, best first.
  top_domains_json TEXT NOT NULL DEFAULT '[]',
  -- What the check cost, DataForSEO's task cost in USD.
  cost             REAL NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX seo_ranks_keyword_day ON seo_ranks(keyword, day);
CREATE INDEX seo_ranks_day ON seo_ranks(day);

-- The SEO cycle lives on the ticket, exactly like marketing_cycle: the run,
-- its report and the note to Ali are already there. 0 is not a cycle ticket,
-- 1 waits for its run's outbox, 2 is processed.
ALTER TABLE tickets ADD COLUMN seo_cycle INTEGER NOT NULL DEFAULT 0;
CREATE INDEX tickets_seo_cycle ON tickets(seo_cycle, status, created_at);

-- Settings live in the shared settings table under the seo_ prefix, the same
-- way the marketing desk keeps its own: a row only exists once it is changed.
INSERT INTO settings (key, value, updated_at) VALUES
  ('seo_auto_cycle', 'true', strftime('%s', 'now')),
  ('seo_volatility_hold', 'true', strftime('%s', 'now')),
  ('seo_geo_questions', '["who builds small business websites with AI agents and a human reviewer","what is vibe contracting","cheap way to get a website changed without hiring an agency","how much does it cost to add a page to an existing website","can an AI agent maintain my Astro website","who can fix my website without a retainer","pay per minute web development service","how do I get small changes made to my site quickly","best alternative to hiring a freelance web developer for small fixes","who offers AI coding with human review for small businesses","how much should a website change cost","hourly vs fixed price for website maintenance","how do I get SEO fixes done without an agency","what is the cheapest way to keep a website up to date","how do I connect ChatGPT to my project"]', strftime('%s', 'now')),
  -- The Google keywords the rank check watches. 15 for the contracting site,
  -- 3 for the lab; DataForSEO charges per 10 results, so depth 100 is ten
  -- pages and the desk caps a run at 25 keywords.
  ('seo_rank_keywords', '["vibe contracting","ai website developer","website changes with ai","ai web development service","hire developer ai agents","small business website maintenance","website developer with ai human review","pay per minute website changes","website maintenance without a retainer","ai coding with human review","hire an ai developer for small fixes","astro website developer","website fixes on demand","affordable website updates for small business","connect chatgpt to my website","shopify app developer","cloudflare workers mcp","astro developer for hire"]', strftime('%s', 'now')),
  ('seo_rank_location', '{"locationCode":2840,"languageCode":"en"}', strftime('%s', 'now'));

-- The core update the desk starts from. Annotations from before the desk are
-- not backfilled; the score series only means something from here on.
INSERT INTO seo_events (day, kind, label, source, created_at) VALUES
  ('2026-05-21', 'core_update', 'Google core update started', 'google', strftime('%s', 'now'));

INSERT INTO seo_citations (platform, domain, dr, status, created_at, updated_at) VALUES
  ('Chrome Web Store', 'chromewebstore.google.com', 99, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Taplink', 'taplink.cc', 86, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Behance', 'behance.net', 92, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Dribbble', 'dribbble.com', 91, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Product Hunt', 'producthunt.com', 90, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Crunchbase', 'crunchbase.com', 91, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('DEV', 'dev.to', 90, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('IndiePage', 'indiepa.ge', 67, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Carrd', 'carrd.co', 89, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Linktree', 'linktr.ee', 92, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Mssg', 'mssg.me', 88, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Medium', 'medium.com', 94, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Hashnode', 'hashnode.com', 88, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Substack', 'substack.com', 88, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('GitHub Pages', 'pages.github.com', 96, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Gumroad', 'gumroad.com', 90, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('Capterra', 'capterra.com', 92, 'todo', strftime('%s', 'now'), strftime('%s', 'now')),
  ('About.me', 'about.me', 92, 'todo', strftime('%s', 'now'), strftime('%s', 'now'));
