# Help and legal open items — September 9, 2026

- Company registration/representation still requires the operator verification noted in README; no new company details were invented.
- Proxy and build-log time retention is not verified. Container logs are size-rotated at 3 × 10 MB, not a time promise. Set and verify an operational retention policy separately.
- Host backups retain two successful dumps; pre-release dumps remain through release acceptance. The manual release-archive cleanup deadline and an offsite copy remain unverified. Privacy discloses these limits.
- DPA Annex 3 remains authoritative and unchanged (accepted versions must be preserved). Privacy now matches its named providers/recipients, including Mattermost. Verify actual vendor contracts/transfer safeguards and any future email provider before enabling new processing; this task does not invent vendor agreements.
- Native n8n npm publication and Cloud verification are pending. Help describes the working HTTP fallback and labels native installation/trigger steps as post-publication.
- Existing Mastodon connection guide recommends 1 MB; the adapter permits 16 MB downloads, while uploads accept 5 MiB. Help labels 1 MB as a conservative cross-network recommendation.
- Waitlist confirmation and delivery are not enabled. Existing consent/deletion wording is retained; actual launch notification/deletion must be implemented before sending.

References checked: README.md, docs/offboarding.md, docs/connect-*.md, content/dpa.json, content/availability.json, application services and sibling n8n README. Legal alignment preserves existing statutory language; GDPR controller/processor return-or-delete context: https://eur-lex.europa.eu/eli/reg/2016/679/oj (Article 28).
