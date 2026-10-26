-- Daily Heckler seed: workspace, brand, empty knowledge-file templates, owner allowlist.
-- The owner becomes a member via claim_owner() on first login (no user id is known here).

insert into owner_allowlist (email) values ('julyssesd@gmail.com') on conflict do nothing;

with ws as (
  insert into workspaces (name, plan) values ('Julio Dominguez', 'owner') returning id
), br as (
  insert into brands (workspace_id, name, slug, timezone, reply_mode, settings)
  select ws.id, 'Daily Heckler', 'daily-heckler', 'America/Chicago', 'draft_only', $json$
  {
    "slug": "daily-heckler",
    "timezone": "America/Chicago",
    "ai_label": false,
    "autopublish": false,
    "publish_mode": "dry_run",
    "reply_mode": "draft_only",
    "platforms": {
      "instagram": {"via": "metricool", "story_to_both": true},
      "facebook":  {"via": "metricool"},
      "x":         {"via": "manual"},
      "threads":   {"via": "api", "phase": 3},
      "bluesky":   {"via": "api", "phase": 3},
      "tiktok":    {"via": "later", "phase": 4}
    },
    "editorial": {"both_parties": true, "invent_quotes": false}
  }
  $json$::jsonb from ws returning id
)
insert into knowledge_files (brand_id, folder, filename, content_md)
select br.id, f.folder, f.filename, f.content_md
from br, (values
  ('voice', 'voice-guide.md', E'# Voice guide\n\n## Persona\n\n## Five adjectives\n\n## Do\n\n## Don''t\n\n## Ten sample lines\n'),
  ('voice', 'banned-words.md', E'# Banned words\n\n'),
  ('content', 'editorial-rules.md', E'# Editorial rules\n\n## Satire vs. fact line\n\n## Naming real people\n\n## No invented quotes\n\n## Both-parties rule\n'),
  ('platforms', 'instagram-rules.md', E'# Instagram rules\n\n'),
  ('platforms', 'x-rules.md', E'# X rules\n\n'),
  ('platforms', 'threads-rules.md', E'# Threads rules\n\n'),
  ('platforms', 'bluesky-rules.md', E'# Bluesky rules\n\n'),
  ('community', 'reply-rules.md', E'# Reply rules\n\n'),
  ('hooks', 'hook-library.md', E'# Hook library\n\n'),
  ('reporting', 'kpi-model.md', E'# KPI model\n\n')
) as f(folder, filename, content_md);
