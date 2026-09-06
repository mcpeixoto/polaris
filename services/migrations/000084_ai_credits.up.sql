-- Metered AI spend.
--
-- docs/06-product-model/02-plans-and-packaging.md draws the line: a self-hosted install
-- brings its own provider key and pays its provider directly, so it is never metered; our
-- cloud holds the key and sells prepaid credits. Both run the same code — the difference is
-- one config flag, not a fork.
--
-- Denominated in **micros of a US dollar**, which is not an arbitrary unit: model prices are
-- quoted per million tokens, so one micro per token is exactly one dollar per million and a
-- charge is a multiplication with no rounding anywhere.
CREATE TABLE ai_credit_ledger (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  -- Negative for spend, positive for a grant or a top-up. An append-only log rather than a
  -- number that gets edited: when somebody asks why their balance is what it is, the answer
  -- has to be a list of things that happened.
  micros       bigint NOT NULL,
  reason       text NOT NULL,
  session_id   uuid REFERENCES agent_session(id) ON DELETE SET NULL,
  model        text,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_credit_ledger_workspace_idx ON ai_credit_ledger (workspace_id, created_at DESC);

-- The running total, kept beside the log rather than summed on every check: the balance is
-- read before every run, and a sum over a workspace's whole history to answer "may this
-- proceed" gets slower exactly as a customer uses the product more.
CREATE TABLE ai_credit_balance (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  micros       bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
