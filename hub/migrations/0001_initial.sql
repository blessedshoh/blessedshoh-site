-- The hub's content and counters. Everything a visitor sees is read from here,
-- and everything the admin dashboard changes is written here.

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT '',            -- short label on the card, e.g. "Derivatives"
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'soon', 'hidden')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  in_header INTEGER NOT NULL DEFAULT 1 CHECK (in_header IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  writeup_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE site_text (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tool_settings (
  tool TEXT PRIMARY KEY,
  json TEXT NOT NULL,                       -- validated settings document
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Larger computed documents, such as a tool's stored default grid.
CREATE TABLE stored_files (
  name TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily totals only: no cookies, no addresses, no visitor identifiers.
CREATE TABLE daily_visits (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer TEXT NOT NULL DEFAULT '',        -- host name only, '' for direct visits
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, referrer)
);

CREATE TABLE daily_events (
  day TEXT NOT NULL,
  tool TEXT NOT NULL,
  event TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tool, event)
);

CREATE TABLE changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  who TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL,
  summary TEXT NOT NULL
);

CREATE INDEX changes_by_time ON changes (at DESC);

-- Starting content, editable from the dashboard.
INSERT INTO site_text (key, value) VALUES
  ('headline', 'Quant work, built from first principles.'),
  ('intro', 'Tools and research on derivatives and risk: priced in Python, tested against industry libraries, and explained line by line.'),
  ('about', 'I build tools that take finance from formula to working software. Every number on these pages comes from a Python engine I can explain on a whiteboard, and each project has a write-up of how it works and where its model breaks down.'),
  ('facts', '1,898 | tests passing' || char(10) || '1e-6 | largest gap to QuantLib' || char(10) || '9 | pricing API routes' || char(10) || '0 | cookies or trackers'),
  ('github_url', 'https://github.com/blessedshoh'),
  ('linkedin_url', ''),
  ('email', '');

INSERT INTO projects (slug, title, summary, url, tag, status, featured, in_header, sort, writeup_url) VALUES
  ('options', 'Options risk tool',
   'Profit and loss across price, time and volatility; American exercise with binomial trees; an arbitrage checker; and a payoff sketcher that builds the portfolio you draw.',
   'https://options.blessedshoh.dev', 'Derivatives', 'live', 1, 1, 10, 'https://github.com/blessedshoh/quant-core'),
  ('cfa-prep', 'CFA Level I prep',
   'Study modules, flashcards and timed mock exams across the Level I curriculum. Sign-in required.',
   'https://prep.blessedshoh.dev', 'Study', 'live', 0, 1, 20, ''),
  ('bonds', 'Bond calculator',
   'Prices, yields, duration and convexity for fixed-rate bonds.',
   '', 'Fixed income', 'soon', 0, 0, 30, '');

INSERT INTO tool_settings (tool, json) VALUES
  ('options', '{"flags":{"risk":true,"binomial":true,"chain":true,"sketch":true,"compare":true},"banner":null,"example":null}');
