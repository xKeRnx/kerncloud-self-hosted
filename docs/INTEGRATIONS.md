# Integrations

KeRnCloud includes 35 service adapters in a searchable gallery under **Connections & environments → Integrations**. This is a list of implemented API contracts, not a claim that customer accounts have been connected or live-certified. Real access requires your provider account, permissions and credentials.

## Included adapters

| Service                                                                                     | Connection     | Implemented capabilities                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Gmail](https://developers.google.com/workspace/gmail/api/guides)                           | OAuth          | Find and read messages; send plain-text email with approval.                                                                                                        |
| [Google Calendar](https://developers.google.com/workspace/calendar/api/guides/overview)     | OAuth          | Read upcoming events and create appointments with approval.                                                                                                         |
| [Google Drive](https://developers.google.com/workspace/drive/api/guides/about-sdk)          | OAuth          | List files and read or export supported text documents.                                                                                                             |
| [Outlook Mail](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview)     | OAuth          | Read messages and send email with approval.                                                                                                                         |
| [Microsoft Calendar](https://learn.microsoft.com/en-us/graph/api/resources/calendar)        | OAuth          | Read upcoming events and create appointments with approval.                                                                                                         |
| [OneDrive](https://learn.microsoft.com/en-us/graph/api/resources/onedrive)                  | OAuth          | List files and read supported text files.                                                                                                                           |
| [GitHub](https://docs.github.com/en/rest)                                                   | OAuth          | List repositories and publish reviewed files as a draft pull request.                                                                                               |
| [Discord](https://docs.discord.com/developers/resources/message)                            | Provider token | Read channel messages and send bot messages with approval. Bot access only.                                                                                         |
| [Slack](https://docs.slack.dev/reference/methods/)                                          | Provider token | List channels, read recent messages and send messages with approval.                                                                                                |
| [Notion](https://developers.notion.com/reference/intro)                                     | Provider token | Search shared pages, read page blocks and append text with approval.                                                                                                |
| [Linear](https://linear.app/developers/graphql)                                             | Provider token | List teams and assigned issues; create an issue with approval.                                                                                                      |
| [Todoist](https://developer.todoist.com/api/v1/)                                            | Provider token | List projects and tasks; create a task with approval.                                                                                                               |
| [Asana](https://developers.asana.com/reference)                                             | Provider token | List workspaces and project tasks; create a task with approval.                                                                                                     |
| [ClickUp](https://developer.clickup.com/reference)                                          | Provider token | List workspaces and list tasks; create a task with approval.                                                                                                        |
| [Airtable](https://airtable.com/developers/web/api/introduction)                            | Provider token | List accessible bases, read records and create one record with approval.                                                                                            |
| [HubSpot](https://developers.hubspot.com/docs/api-reference/overview)                       | Provider token | Read contacts and deals; create a contact with approval.                                                                                                            |
| [Dropbox](https://www.dropbox.com/developers/documentation/http/documentation)              | Provider token | Identify account and list folder contents.                                                                                                                          |
| [Figma](https://developers.figma.com/docs/rest-api/)                                        | Provider token | Identify account, inspect file metadata and read file comments.                                                                                                     |
| [Vercel](https://vercel.com/docs/rest-api)                                                  | Provider token | List projects and recent deployments. Deployment changes are not enabled.                                                                                           |
| [Cloudflare](https://developers.cloudflare.com/api/)                                        | Provider token | Verify API token, list zones and inspect DNS records.                                                                                                               |
| [Google Docs](https://developers.google.com/workspace/docs/api/reference/rest)              | OAuth          | Find document metadata and read document structure and text.                                                                                                        |
| [Google Sheets](https://developers.google.com/workspace/sheets/api/reference/rest)          | OAuth          | Find spreadsheets and read a bounded cell range.                                                                                                                    |
| [Google Tasks](https://developers.google.com/workspace/tasks/reference/rest)                | OAuth          | List task lists and tasks; create a task with approval.                                                                                                             |
| [Google Contacts](https://developers.google.com/people/api/rest/v1/people.connections/list) | OAuth          | Read contact names and email addresses.                                                                                                                             |
| [YouTube](https://developers.google.com/youtube/v3/docs)                                    | OAuth          | Read your channels and playlist items. No publishing or deletion.                                                                                                   |
| [Microsoft To Do](https://learn.microsoft.com/en-us/graph/api/resources/todo-overview)      | OAuth          | List task lists and tasks; create a task with approval.                                                                                                             |
| [Microsoft Contacts](https://learn.microsoft.com/en-us/graph/api/user-list-contacts)        | OAuth          | Read contact names and email addresses.                                                                                                                             |
| [OneNote](https://learn.microsoft.com/en-us/graph/api/resources/onenote-api-overview)       | OAuth          | List notebook and page metadata.                                                                                                                                    |
| [Microsoft Teams](https://learn.microsoft.com/en-us/graph/api/chat-list)                    | OAuth          | List your chats and read recent messages. Tenant consent may be required.                                                                                           |
| [GitLab.com](https://docs.gitlab.com/api/rest/)                                             | Provider token | List member projects and project issues; create an issue with approval.                                                                                             |
| [Ayrshare Social Media](https://www.ayrshare.com/docs/introduction)                         | Provider token | Connect profiles in Ayrshare; inspect connected accounts and history. Publish approved text posts to supported text networks. A separate provider plan is required. |
| [Apify Datasets](https://docs.apify.com/api/v2)                                             | Provider token | List existing datasets and read a bounded page of collected records. Does not start actors or paid scraping jobs.                                                   |

| [Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search) | Provider token | Budgeted basic search in the project Research area |
| [Brave Search](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started) | Provider token | Budgeted web search in the project Research area |
| [Exa](https://exa.ai/docs/reference/search) | Provider token | Budgeted lite search and bounded highlights in the project Research area |

## Set up a connection

1. Search for a service and open **Set up**. The card lists its supported actions and links to the official provider documentation.
2. For Google, Microsoft and GitHub, register an OAuth application for your own installation under the administration section. Copy the exact callback URL. New service-specific connections request only the listed service scopes. Existing broad OAuth grants remain unchanged; reconnect if you want to narrow them. Some providers or organization policies require consent or app review.
3. For token-based services, create a scoped API or bot token at the provider and paste its raw value. Tokens remain encrypted in the installation; they are never included in model context. Discord uses a bot token, not a user password.
4. Select the projects, then save the connection. New connections grant **no agent access** until you choose agents under **Connected** and save permissions. No selected projects means no agent access. An explicit all-projects grant also covers future projects.
5. Use **Test connection**. This makes a bounded read-only provider request, without a model call. Tests are limited to once a minute per connection. A passing test verifies that read endpoint, not every scope or resource.
6. Enable writes separately if needed. OAuth connections must have the service's write scopes. Every agent write also needs approval of its exact arguments in Decisions.

Token replacement keeps existing project and agent grants. Disconnect removes the installation's connection and immediately blocks future tool use; you can also revoke the token or OAuth consent at the provider. Permission changes and credential rotation invalidate previously granted action approvals.

## Social media and external data

Ayrshare links social accounts in its dashboard. Content Studio now prepares text/media drafts, schedules dispatch and requires exact owner/admin approval and fixed project limits. Generic agent publishing is blocked. See [Content Studio and Research](CONTENT-RESEARCH.md). Acceptance is not proof of final publication. Social inboxes and performance analytics remain expansion work.

Apify reads existing datasets, with a page limit of 20 items. It cannot start Actors, launches or paid extraction jobs. It does not expose the private user/account endpoint to an agent.

Provider subscriptions, rate limits and external API charges are separate from KeRnCloud AI credits. Set provider-side spending caps where available. Neither a connection test nor a platform AI-credit limit guarantees zero external fees. This release does not automatically start external paid jobs or connect any customer accounts.

## Token and execution budgets

Only authorized connection summaries for the current agent and project are discoverable. Action descriptions and fields are loaded **for one selected connection on demand**; the full gallery is not appended to each model request. List operations use bounded page sizes. Large results and text exports are capped, and read data is marked untrusted. The existing task token, call and credit limits remain in force.

Writes use the existing exact-approval and once-only operation mechanisms. An uncertain external outcome is not automatically retried. Integration endpoints are fixed, HTTPS-only, provider-specific and reject redirects; an agent cannot choose an arbitrary URL to receive the credential.

## Further integration ideas

These are extension candidates, **not shipped adapters**. Provider API support, account type, app review, pricing and redistribution terms must be checked before implementation. A useful integration requires tested actions, not just a logo. Existing reviewed MCP connections can provide additional tools separately.

| Area                      | Candidates                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Social profiles           | Instagram, TikTok, Facebook Pages, LinkedIn, X, Threads, Pinterest, Bluesky, Mastodon, Reddit, Snapchat, Twitch                   |
| Social aggregation        | Ayrshare media/inbox/analytics, Zernio, Buffer                                                                                    |
| Messaging                 | Telegram, WhatsApp Business, Matrix, Mattermost, Rocket.Chat, Zoom                                                                |
| Research and extraction   | Tavily, Exa, Brave Search, Firecrawl, Apify Actor execution with separate expense controls, SerpAPI, DataForSEO, Bright Data      |
| Business and places data  | Google Places, OpenStreetMap, Wikidata, OpenCorporates, Crunchbase                                                                |
| Office and storage        | SharePoint, Outlook attachments, Google Forms, Google Slides, Microsoft Excel, Box, Nextcloud, ownCloud, WebDAV, S3, Backblaze B2 |
| Project management        | Jira, Confluence, Trello, Monday, Basecamp, Wrike, Teamwork                                                                       |
| Sales and support         | Salesforce, Pipedrive, Zoho CRM, Zendesk, Freshdesk, Intercom, Help Scout                                                         |
| Commerce and payments     | Shopify, WooCommerce, BigCommerce, Stripe, PayPal, Paddle, Lemon Squeezy                                                          |
| Content and marketing     | WordPress, Ghost, Webflow, Contentful, Sanity, Mailchimp, Brevo, ConvertKit                                                       |
| Design and media          | Canva, Adobe Express, Unsplash, Pexels, ElevenLabs, Cloudinary                                                                    |
| Monitoring and deployment | Sentry, Grafana, Datadog, Better Stack, Uptime Kuma, Netlify, Render, Fly.io, DigitalOcean                                        |
| Analytics                 | Google Analytics, Search Console, Plausible, Matomo, PostHog                                                                      |
| Automation                | n8n, Make, Zapier, Pipedream, reviewed incoming/outgoing webhooks                                                                 |
| Home and devices          | Home Assistant, MQTT, Node-RED, approved Bridge device actions                                                                    |

## Optional connector and data platforms

[Pipedream Connect](https://pipedream.com/docs/connect) and [Composio](https://docs.composio.dev/docs) are candidates for optional managed authentication and large connector catalogs. They are not installed or enabled by this release. Such a mode would require an explicit choice about external credential handling, data routing, tool permissions and provider costs; native self-hosted adapters remain useful independently.

[RapidAPI](https://docs.rapidapi.com/docs/consumer-quick-start-guide) is a marketplace for data APIs rather than one universal data source. Each API needs its own reviewed request contract, quota and spending controls. Other research candidates include [Firecrawl](https://docs.firecrawl.dev/introduction), [Tavily](https://docs.tavily.com/) and [DataForSEO](https://docs.dataforseo.com/v3/).

Useful product workflows include a social-content studio (planning, drafts, media, review, publishing, performance), a unified comments inbox, brand and competitor monitoring, recurring sourced research reports and reviewed lead enrichment. These are product ideas beyond the bounded actions listed above, not claims of implemented end-to-end workflows.

## Verification details

Unit tests exercise every adapter action's request contract, provider-specific authentication, fixed-origin checks, bounded spreadsheet reads and read/write separation. Database integration fixtures cover encrypted storage, workspace/project/agent isolation, credential rotation, health checks, throttling, revocation and approval requirements. These tests use protocol fixtures; live provider account verification happens only after the account owner connects and tests a service.
