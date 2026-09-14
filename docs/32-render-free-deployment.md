# Render Free Deployment

This deployment uses no Render persistent disk:

- MongoDB Atlas stores live Baileys credentials and Signal keys.
- A hosted PostgreSQL database stores sessions, messages, API keys, and audit records.
- The no-browser Baileys engine fits Render's free instance much better than Chromium.

MongoDB cannot replace PostgreSQL here: OpenWA's application entities, transactions, queries, and
migrations are relational. The included `render.yaml` therefore uses Atlas for the state that was
previously filesystem-only and PostgreSQL for the relational state.

## 1. Create MongoDB Atlas

1. Create an Atlas free cluster and a database user with read/write access to `openwa`.
2. Copy the `mongodb+srv://...` driver URI and replace its password placeholder.
3. Temporarily add `0.0.0.0/0` to Atlas **Network Access** for the first deploy. Replace it with
   Render's actual outbound ranges in step 5 below.

Do not commit this URI. Render prompts for it as `MONGODB_URI` when the Blueprint is created.

## 2. Create PostgreSQL

Create a persistent free PostgreSQL database with an external provider such as Neon or Supabase.
Do not use Render Free Postgres for a lasting installation: free Render databases expire after 30
days. Copy its host, database, username, and password. Keep port `5432` unless the provider says
otherwise, and require TLS.

## 3. Deploy the Blueprint

1. Push this repository to GitHub or GitLab.
2. In Render, choose **New > Blueprint** and select the repository.
3. Render reads `render.yaml`. Enter these prompted secrets:
   - `MONGODB_URI`
   - `DATABASE_HOST`
   - `DATABASE_NAME`
   - `DATABASE_USERNAME`
   - `DATABASE_PASSWORD`
4. Deploy and wait for `/api/health/ready` to pass.
5. In the deployed Render service, open **Connect > Outbound**. Add all listed CIDR ranges to the
   Atlas **Network Access** list, then remove the temporary `0.0.0.0/0` entry.
6. Open the service URL. Get the generated `API_MASTER_KEY` from the first-deploy logs or the
   service environment, sign in, create a session, and scan the QR code.
7. After the session reaches `READY`, redeploy once and confirm it reconnects without a new QR.

## 4. Free-tier availability

Render Free web services sleep after 15 minutes without inbound HTTP or WebSocket traffic. A quiet
WhatsApp connection therefore cannot be treated as an always-on production gateway, and a WhatsApp
message cannot reliably wake a service whose outbound connection has already closed. An HTTP visit
wakes it and `AUTO_START_SESSIONS=true` reconnects the saved session. For production, move the same
service to an always-on paid instance; no data migration is needed because Atlas and PostgreSQL
remain external.

Local media archiving, installed plugins, and dashboard-saved infrastructure configuration are
intentionally disabled or environment-managed in this Blueprint because the filesystem is
ephemeral. Configure an S3-compatible bucket before enabling media archival.
