-- Workspace customer-request settings: the admin toggle, a default feedback team,
-- a revenue unit label, and the named tiers offered when attributing a customer.
-- customer.tier stays a string; the list here is the vocabulary, not a foreign key.

ALTER TABLE workspace
  ADD COLUMN customer_requests_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN customer_default_team_id uuid REFERENCES team(id) ON DELETE SET NULL,
  ADD COLUMN customer_revenue_unit text NOT NULL DEFAULT '',
  ADD COLUMN customer_tiers text[] NOT NULL DEFAULT '{}';
