# Social inbox and analytics

Open **Projects → a project → Social inbox / Social analytics**. Configure an Ayrshare connection under Integrations and grant the project access. Writes must be enabled explicitly for replies. Existing credentials and grants are retained.

## Limits before calls

The shared **fixed external project budget** covers Content Studio, Research and Social. Set its total USD reservation ceiling and request count in Content Studio. New project budgets start at zero.

Social adds **separate price confirmations for reads and replies**. Confirm a maximum total per-request fee and expiry (at most 31 days), including all messaging/conversation, platform and plan fees. A previous publishing price does not authorize Social requests. Unknown/expired prices or exhausted budgets block dispatch before contacting the provider. Reservations use integer micro-USD and atomic database locks, including across simultaneous searches, reads and sends. Uncertain outcomes retain the maximum reservation.

These are committed ceilings, not actual provider invoices. Accurate maximum prices and provider-side spending caps are still required. Third-party fees and quotas are outside KeRnCloud's control. Provider plans, messaging activation and network permissions apply; installing KeRnCloud does not activate them.

## Collect messages and comments

1. Add a source: Facebook, Instagram or X direct messages; or comments on an Ayrshare post ID. Use the Ayrshare ID from a Studio dispatch receipt or provider history, not a network-specific post ID. Sources remain inside this project.
2. Fetch one page manually. Opening or refreshing the view only reads the local cache. There is no automatic paid polling or automatic pagination.
3. Each message request asks for up to 20 messages. Use **Next page** to make one additional budgeted request when the provider returns a continuation. X uses its live-timeline paging behavior when a limit is supplied. Initial provider history may be incomplete.
4. Comment responses are bounded to 300 KB and locally to 100 entries (including bounded nested replies). They are not a complete archive. Oversized or unexpected responses become uncertain, retaining the reservation. A new explicit read attempt can be confirmed at additional reserved cost; no background retry occurs.

Matching first-page reads reuse completed results for ten minutes, while the connection revision is unchanged. Items deduplicate by source/provider ID and keep provider timestamps, retrieval dates and revisions. Archive is local and reversible; it does not archive or mark a conversation read at the social network. Media messages show their available text; attachments/avatars are not automatically downloaded.

## Review every reply

Prepare a text reply from a received item and submit it for review. An owner/admin sees the project, connection, platform, incoming content, explicit recipient/comment ID, reply text and maximum cost in the central Inbox, then approves or rejects.

Approval binds the exact reply revision, target plan, incoming item revision, connection revision, price revision and project budget revision. Edits clear approval. Changes to the incoming item or a newer locally collected inbound message in the same DM conversation block stale sends. This checks collected context, not an uncharged live refresh of the provider.

The publisher atomically claims an approved reply once. Paused projects/workspaces, disabled sources, suspended/expired accounts or changed permissions block dispatch. Unknown or interrupted delivery becomes **uncertain**, never an automatic retry. A dispatched/uncertain reply cannot be edited or duplicated for that item. **Submitted** means provider acceptance, not confirmed recipient delivery. Inspect the provider before any further action.

Direct-message replies support Facebook, Instagram and X. Comment replies use Social Comment IDs on Facebook, Instagram, X and YouTube; LinkedIn requires the full comment URN and TikTok requires the video ID returned by the provider. Missing metadata disables replying. Other supported comment feeds may be readable without a reply action. Replies are text only; bulk outreach, automatic responses and WhatsApp/private-beta features are not enabled.

Agents can read a compact cached index, load one item and save a reply for human review, then finish without waiting. They cannot approve, send or raise limits. Inbox text is untrusted source content. Cached analytics are available through the same read tool; no paid fetch is started by an agent read. Normal AI task token/credit limits still apply.

## Measure post performance

Add an analytics source for one Ayrshare post ID and platform, then fetch manually. Each successful request stores a timestamped snapshot, showing a metric selector, history chart/table and CSV export. Repeated reads inside the cache window do not create another charge or snapshot.

Metrics retain provider field names and numeric values. Missing values remain unknown, while reported zero stays zero. Snapshots are lifetime counters, not daily increments; repeated snapshots are never summed as new engagement. Different platforms and account types expose different metrics and definitions. Choose one source/metric for a comparable history. Provider timestamps may be absent or older than retrieval dates. CSV export uses cached data only and neutralizes spreadsheet formula prefixes in text.

## Verification and provider references

Database/protocol fixtures verify separate prices, zero budgets, concurrent one-request limits, cache reuse, project and role isolation, exact approvals, changed context, duplicate sender claims, uncertain outcomes and numeric snapshots. These fixtures make no live posts or paid provider calls. Backup/update retains the added tables with existing project data and permissions.

Provider contracts: [messages](https://www.ayrshare.com/docs/apis/messages/get-messages), [send message](https://www.ayrshare.com/docs/apis/messages/send-message), [comments](https://www.ayrshare.com/docs/apis/comments/get-comments), [reply](https://www.ayrshare.com/docs/apis/comments/reply-to-comment), [post analytics](https://www.ayrshare.com/docs/apis/analytics/post).
