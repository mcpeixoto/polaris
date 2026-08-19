-- Linkbacks are the comment posted back onto a GitHub PR or commit when it attaches to
-- an issue. Disableable because that comment is also a GitHub notification, and some
-- installs do not want one every time a PR opens. Default on, matching the product.
--
-- Replicated: the settings screen already stores the rest of the connection on the
-- replica, and a toggle that vanished after reload would look broken.

ALTER TABLE github_connection
  ADD COLUMN linkbacks boolean NOT NULL DEFAULT true;
