# Plan several posts with CSV

Preview up to 200 rows and correct individual errors before saving your campaign.

## Steps

1. Open [Plan several posts](/app/posts/bulk) and select the brand.
2. Fill rows manually or copy the CSV template below into a UTF-8 .csv file.
3. Import the file and inspect the preview. Comma or semicolon separators and a UTF-8 BOM are accepted; files must be at most 512 KB.
4. Use YYYY-MM-DD dates and HH:MM times in the selected brand’s timezone, or prepare drafts without scheduling.
5. Separate channel display names or providers with |. A provider selects all matching channels for this brand.
6. Optionally use auto-distribute with a start date, number of days and time slots.
7. Review counters, image and approval choices, then save. Inspect every row result and retry only failed rows.

## CSV template

```csv
date,time,text,channels,image_url,requires_approval
2030-01-07,09:00,"Hello from our team",bluesky,,false
2030-01-08,14:00,"A second update",bluesky|mastodon,,true
```

Replace the sample dates with your future schedule and channels with your connected accounts. Quote text containing commas or newlines; escape a quote by doubling it. Approval accepts true/false, yes/no or 1/0. Agency access is required for approval requests.

Bulk planning is available on every plan, with the normal publishing, brand and storage rules. Each row allows one image. A failed row does not undo successfully saved rows; submitting them all again can create duplicates.

## Related

- [Calendar](/docs/calendar)
- [Uploads](/docs/uploads)
- [Approvals](/docs/approvals)
- [Api webhooks](/docs/api-webhooks)
