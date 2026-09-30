# Integrations: platform reference

How Central talks to each ad platform, what a person must paste on **Settings → Connected accounts**
(`/settings/connections`, FR1.6 / ADR-086) and where the official documentation lives. Organization connections
(OAuth, `/admin/integrations`) use the same providers (ADR-067); see `ARCHITECTURE.md` for the provider interface.

Every platform call goes through `src/modules/integrations/providers/<platform>.ts`. Tokens are stored in Supabase
Vault (`app.integration_put_secret`) and never returned to the browser; the list only shows a hint (`EAAB…wxyz`).
With `INTEGRATIONS_SANDBOX=true` (dev/tests) each platform also has a **sandbox** mode with fixed demo accounts.

## Personal connections: the flow

1. **Connect account** → pick a platform, paste an access token (plus a refresh token and expiry date when the
   platform issues them; Google also needs the Ads customer id). The token is checked immediately (the platform's
   "who am I" call) and the reachable ad accounts are discovered.
2. **Test connection** re-reads the ad accounts (and their campaigns).
3. Map each ad account to a **client** you can access (RLS limits the choice). Mapped accounts are then available to
   the daily sync like organization connections (sync stays off until someone with `integrations:manage` enables it).
4. **Fetch campaigns** lists the account's campaigns from the platform.
5. Seven days before the entered expiry date the owner gets a notification (`integration_expiring`); an expired or
   revoked token notifies the owner and the integration managers.

Visibility: owners see only their own personal connections; `integrations:read` / `integrations:manage` holders see
everyone's (masked) on `/admin/integrations`, and managers can **reassign** a connection to another person who holds
`integrations:connect`. Client users never see any connection.

## Platforms

### Meta (Facebook & Instagram): Marketing API

- **Token**: a user or system-user access token with `ads_read` (and `leads_retrieval` / `pages_show_list` for lead
  ads). Short-lived user tokens last about an hour; exchange for a long-lived token (~60 days) or use a system user
  token from Business Settings (does not expire).
- **Calls**: `GET /me` (identity), `GET /me/adaccounts` (ad accounts), `GET /act_{id}/campaigns` (campaigns),
  `GET /act_{id}/insights` (daily numbers). Graph version from `META_GRAPH_VERSION` (default `v23.0`).
- A personal Meta connection works without the app env (`META_APP_ID`/`META_APP_SECRET`) because nothing is
  exchanged; those are only needed for OAuth and webhook signatures.
- Docs: https://developers.facebook.com/docs/marketing-apis ·
  access tokens https://developers.facebook.com/docs/facebook-login/guides/access-tokens ·
  long-lived tokens https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived ·
  system users https://developers.facebook.com/docs/marketing-api/system-users ·
  versions https://developers.facebook.com/docs/graph-api/changelog

### TikTok: TikTok API for Business

- **Token**: an advertiser access token from the TikTok for Business developer portal (header `Access-Token`).
  Long-term tokens don't expire until revoked.
- **Calls**: `GET /open_api/v1.3/oauth2/advertiser/get/` (authorized advertisers), `GET /campaign/get/`,
  `GET /report/integrated/get/` (daily numbers).
- Docs: https://business-api.tiktok.com/portal/docs · authentication
  https://business-api.tiktok.com/portal/docs?id=1738373164380162

### Snapchat: Snap Marketing API

- **Token**: an OAuth access token (expires after 30 minutes) **and its refresh token**. Paste both; Central refreshes
  with the app's `SNAPCHAT_CLIENT_ID` / `SNAPCHAT_CLIENT_SECRET`.
- **Calls**: `GET /v1/me`, `GET /v1/me/organizations?with_ad_accounts=true`, `GET /v1/adaccounts/{id}/campaigns`,
  `GET /v1/campaigns/{id}/stats`.
- Docs: https://developers.snap.com/api/marketing-api/Ads-API/introduction · authentication
  https://developers.snap.com/api/marketing-api/Ads-API/authentication

### Google Ads: Google Ads API

- **Token**: an OAuth access token for the `https://www.googleapis.com/auth/adwords` scope (1 hour) plus a refresh
  token, and the **customer id** of the Ads account (10 digits, dashes are removed). Server env needs
  `GOOGLE_ADS_DEVELOPER_TOKEN` (and `GOOGLE_CLIENT_ID`/`SECRET` to refresh); `GOOGLE_ADS_LOGIN_CUSTOMER_ID` when going
  through a manager (MCC) account.
- **Calls**: `customers:listAccessibleCustomers`, `customers/{id}/googleAds:search` (GAQL) for campaigns and daily
  metrics. Version from `GOOGLE_ADS_API_VERSION` (default `v21`).
- Docs: https://developers.google.com/google-ads/api/docs/start · OAuth
  https://developers.google.com/google-ads/api/docs/oauth/overview · developer token
  https://developers.google.com/google-ads/api/docs/api-policy/developer-token · versions
  https://developers.google.com/google-ads/api/docs/sunset-dates

### X (Twitter): X API v2 and X Ads API

- **Token**: an OAuth 2.0 user access token (identity via `GET https://api.x.com/2/users/me`, scopes `users.read
  tweet.read`). OAuth 2.0 tokens last 2 hours unless `offline.access` issued a refresh token.
- **Ad accounts**: `GET https://ads-api.x.com/12/accounts`. The Ads API needs an app approved for Ads API access and
  officially authenticates with **OAuth 1.0a user context**; with a token that lacks it the connection still works but
  lists no ad accounts. Numbers are not synced for X yet (see Deferred in `HANDOFF.md`).
- Docs: https://docs.x.com/x-api/introduction · Ads API https://docs.x.com/x-ads-api/introduction · authentication
  https://docs.x.com/resources/fundamentals/authentication/overview

### LinkedIn: LinkedIn Marketing API (versioned)

- **Token**: a 3-legged OAuth access token (60 days; refresh tokens last 365 days for approved apps) with `r_ads`
  (and `r_ads_reporting` for numbers), `openid profile` for identity.
- **Headers**: every `/rest` call sends `LinkedIn-Version: 202509` (YYYYMM, see `providers/linkedin.ts`) and
  `X-Restli-Protocol-Version: 2.0.0`. LinkedIn retires each version after about a year; bump the constant then.
- **Calls**: `GET /v2/userinfo`, `GET /rest/adAccounts?q=search`, `GET /rest/adAccounts/{id}/adCampaigns?q=search`.
- Docs: https://learn.microsoft.com/en-us/linkedin/marketing/ · versioning
  https://learn.microsoft.com/en-us/linkedin/marketing/versioning · ad accounts
  https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-accounts ·
  OAuth https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow

## Moving to OAuth later

Pasted tokens are stored exactly like OAuth tokens (`TokenSet` in Vault: access, refresh, expiry, scopes), with
`settings.source = 'pasted'`. Adding an OAuth button for personal connections only needs the existing
`/api/integrations/<provider>/callback` flow to pass `ownerId` to `saveConnection`; nothing in the data model changes.
