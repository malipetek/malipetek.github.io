-- The translation bridge (src/translate.ts): clients write and read in their
-- own language; Ali and the fleet agents read and write English.
--
-- users.locale        the client's language, a code from src/lib/locales.js
-- users.translation   who may translate their messages: deepseek | cloudflare | off
--                     ('off' sends nothing to a translator; 'cloudflare' keeps it
--                     on Workers AI)
-- ticket_messages.lang  the detected language of the original text; NULL until
--                     the bridge has looked at it
-- tickets.title_en    the English title when the client filed it in another language
--
-- message_translations caches every translation, so a message is translated
-- once per locale. The original body in ticket_messages is never changed.

ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en-US';
ALTER TABLE users ADD COLUMN translation TEXT NOT NULL DEFAULT 'deepseek'
  CHECK (translation IN ('deepseek', 'cloudflare', 'off'));

ALTER TABLE ticket_messages ADD COLUMN lang TEXT;
ALTER TABLE tickets ADD COLUMN title_en TEXT;

CREATE TABLE message_translations (
  message_id  INTEGER NOT NULL REFERENCES ticket_messages(id) ON DELETE CASCADE,
  locale      TEXT NOT NULL,
  body        TEXT NOT NULL,
  engine      TEXT NOT NULL CHECK (engine IN ('deepseek', 'm2m100')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (message_id, locale)
);
