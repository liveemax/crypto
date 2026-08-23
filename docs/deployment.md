# Production deployment

The Vercel project must define these server-only environment variables:

- `RESEARCH_API_BASE_URL` — the HTTPS origin exposed by the bot's TLS proxy;
- `RESEARCH_API_KEY`;
- `RESEARCH_API_ADMIN_KEY`;
- `ADMIN_PASSWORD`.

Do not add a `NEXT_PUBLIC_` variant of any secret. This release has no translation-provider variable.

## First live deployment

The bot's TLS proxy must be available on port 443 before deployment. After setting the four
Production variables, compare the live response with the recorded fixture before accepting the
deployment:

```sh
pnpm live:check
```

The command deliberately fails loudly when keys or value types differ. Pass another protocol-page
fixture as its argument when required, for example `pnpm live:check contract/fixtures/protocol-no-en.json`.
Then verify both public locales and confirm that `/admin` redirects to the password form.

## Key rotation

Rotate without an outage in this order:

1. put the new value in the corresponding Vercel Production environment variable;
2. put the same value in the bot environment;
3. restart the bot.

Reversing the first two operations creates a window in which the site sends an invalid key.
