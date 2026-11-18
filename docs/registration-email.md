# Registration email codes

New players enter an email, click Send verification code, and submit the six-digit code with their username and password. Existing accounts still sign in normally; their email is nullable for compatibility.

1. Create a Resend account and sending API key: https://resend.com/api-keys
2. Add a verified sender domain in Resend: https://resend.com/domains
3. Set backend `.env` values (never frontend public variables):

   ```env
   RESEND_API_KEY=re_your_key
   RESEND_FROM_EMAIL="IdleOn <noreply@your-verified-domain.com>"
   ```

   `onboarding@resend.dev` only sends test messages to the email associated with your Resend account. Public registration needs your verified domain. This integration uses the ordinary send-email API and can use the free plan; its quotas still apply.

4. From `idleon-be`, apply pending migrations and regenerate the client:

   ```powershell
   npm.cmd run db:deploy
   npm.cmd run db:generate
   ```

5. Restart the backend, open registration, request a code, and check the inbox (and spam folder). No real email is sent by automated tests.

`POST /api/auth/register/code` accepts `{ email }`. `POST /api/auth/register` requires `{ username, password, confirmPassword, email, code }`. Passwords and verification codes are hashed. Codes expire after 10 minutes, are single-use, allow five incorrect attempts, and can be replaced after 60 seconds. Email sends are limited to five requests per IP per hour; registration has a separate attempt limit. Sending failures preserve the previous code, and missing provider configuration returns a friendly error. Unique email and username constraints and transactional code consumption prevent replay and concurrent account creation.

Provider references: https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/knowledge-base/403-error-resend-dev-domain
