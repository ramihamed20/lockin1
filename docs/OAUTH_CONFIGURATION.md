# Lock-in Google and Apple sign-in configuration

The application uses backend authorization-code flows. Provider tokens are validated and discarded
by Django; the browser receives only the existing Lock-in HttpOnly session cookie. OAuth state,
OIDC nonce, replay expiry, and a short-lived browser-binding cookie are validated before login.

## Google

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure the OAuth
   consent screen and create an **OAuth client ID** with application type **Web application**.
2. Add this exact authorized redirect URI, replacing the example host:
   `https://lockin.ly/api/v1/auth/oauth/google/callback`.
3. This implementation does not load Google JavaScript in the browser, so an authorized JavaScript
   origin is not required for this server-side flow. If Google Identity Services is added later, add
   the production origin separately.
4. Add the values to the deployment environment:

   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET` or `GOOGLE_OAUTH_CLIENT_SECRET_FILE`
   - `GOOGLE_OAUTH_REDIRECT_URI`

## Apple

1. In [Apple Developer Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/),
   enable **Sign in with Apple** on the primary App ID.
2. Create a **Services ID** for the web application. Configure the production domain and exact return
   URL `https://lockin.ly/api/v1/auth/oauth/apple/callback` under Sign in with Apple.
3. Create a Sign in with Apple private key, record its **Key ID**, download the `.p8` file once, and
   record the developer account **Team ID**.
4. Add the values to the deployment environment:

   - `APPLE_OAUTH_SERVICES_ID`
   - `APPLE_OAUTH_TEAM_ID`
   - `APPLE_OAUTH_KEY_ID`
   - `APPLE_OAUTH_PRIVATE_KEY` or `APPLE_OAUTH_PRIVATE_KEY_FILE`
   - `APPLE_OAUTH_REDIRECT_URI`

5. If Lock-in sends mail to Apple relay addresses, register the sending domain and addresses in
   Apple Private Email Relay and configure SPF/DKIM. The implementation recognizes both current
   Apple relay domains: `privaterelay.appleid.com` and `private.icloud.com`.

## Project placement

- Local development: copy `.env.example` to the untracked `.env` and fill one complete provider.
- Current production Compose deployment: fill the direct secret variables only in the untracked
  `.env.production`. The example Compose file forwards them to Django.
- Secret-file capable deployment: mount the secret files into the backend container/process and set
  `GOOGLE_OAUTH_CLIENT_SECRET_FILE` and/or `APPLE_OAUTH_PRIVATE_KEY_FILE` instead of direct values.
- Never use a `VITE_` variable for an OAuth secret. All provider credentials are backend-only.

Production startup rejects partial provider configurations, non-HTTPS callback URLs, callback hosts
that differ from `PUBLIC_APP_URL`, and callback paths that differ from the implemented endpoints.
