# Supabase function editor setup

supabase/functions/invite-team/index.ts is TypeScript for the Supabase Deno runtime. Keep it in the backend folder; do not add it to an HTML script tag or run it with Node.js.

This workspace scopes Deno to supabase/functions in .vscode/settings.json. The function's deno.json resolves the pinned Supabase SDK dependency and enables strict checking. Browser JavaScript keeps the standard VS Code JavaScript language service.

For local editor diagnostics:

1. Install Deno and verify that deno --version works in a new terminal.
2. Install the recommended VS Code extension **Deno** (denoland.vscode-deno).
3. Open the CacaoIndustry-Web folder as the workspace, then run **Developer: Reload Window**. Open index.ts and allow its dependencies to download.
4. From supabase/functions/invite-team, run deno task check and deno task lint.

Without Deno and its extension, the standard TypeScript language service may report that Deno or the Deno import cannot be resolved. Do not add fake globals, disable validation or change the function to browser JavaScript to hide those diagnostics.

Configure ALLOWED_ORIGIN as the exact website origin (scheme, hostname and port, with no trailing slash or path). Hosted Supabase supplies SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Never put the service key in assets/js/config.js. Configure Auth redirects and SMTP before testing delivery.

Deploy only when the backend project is ready:

    supabase functions deploy invite-team --no-verify-jwt

The handler explicitly validates the bearer user and active protected super-admin profile before using the server-only invite client. The deployment flag does not grant anonymous invitation access.

Local handler regression checks run without sending emails:

    node --test tests/invite-team.test.cjs

These checks use Node 24's built-in TypeScript stripping and isolated SDK fixtures. They validate request handling and authorization branches, not hosted email delivery. Full Deno checking requires the real runtime/dependencies.

Official setup references: [Supabase development environment](https://supabase.com/docs/guides/functions/development-environment), [function dependencies](https://supabase.com/docs/guides/functions/dependencies), and [Deno for VS Code](https://docs.deno.com/runtime/reference/vscode/).
