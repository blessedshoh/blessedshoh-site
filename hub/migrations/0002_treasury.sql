-- Daily Treasury par yields (U.S. Department of the Treasury, public domain), one row
-- per day and maturity. Loaded by the blessedshoh-data Worker; read by the bonds site.
CREATE TABLE treasury_par_yields (
  day TEXT NOT NULL,            -- YYYY-MM-DD, a Treasury business day
  tenor TEXT NOT NULL,          -- the CSV header label, e.g. '10 Yr', '1.5 Month'
  yield_pct REAL NOT NULL,      -- as published, in percent
  PRIMARY KEY (day, tenor)
);

CREATE INDEX treasury_par_yields_by_day ON treasury_par_yields (day);
