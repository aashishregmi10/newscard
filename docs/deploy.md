# Deploying SAAR

How to put SAAR's servers and website on the internet, over HTTPS, and point the app at them. It works on
any Linux machine that runs Docker. The free option chosen for now is a virtual machine such as **Oracle
Cloud Always Free**.

> **Not yet run end to end.** The Docker files were written on 7 Oct 2026 on a machine without Docker. The
> pieces they run were tested: the TypeScript build, the website's production build, and the production
> setting checks. The first build on the server is the image's first test. If a step fails, the error names
> the file.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Reader API (`apps/api`) | Docker, `api` service | `/v1/*` (the app) and `/media/*` (photos, videos) |
| Editorial API (`apps/cms-api`) | Docker, `cms-api` service | `/api/*`; also runs the news collector |
| Website and editorial site (`apps/cms-web`) | Docker, `caddy` service | everything else; `/privacy`, `/terms`, `/delete-account` |
| HTTPS | Caddy | gets and renews the certificate itself |
| Database | MongoDB Atlas | a **production** database, separate from development |
| Uploaded media | Docker volume `saar_media` | shared by both servers, kept across deploys |
| The app | EAS (Expo's build service) | `apps/mobile/eas.json`, `production` profile |

Everything is on **one domain** (for example `saar.example.com`). The app uses it for the API and the
website; the editorial site uses it for its API.

## 1. Before you start

- **A domain**, with access to its DNS.
- **A Linux server:** at least 2 CPUs and 4 GB of memory (summaries, image and video processing), with a
  public IP, and ports 80 and 443 open to the internet.
- **A production database on Atlas:** a new database (for example `saar_prod`) and a new database user
  for it. Development must never write to it.

## 2. The production database

On your own computer, from the repository:

```bash
MONGO_URI="mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/saar_prod" npm run db:init
```

This creates the validators and every index. It prints any index it could not build, and exits with an
error if there was one.

Create the real editorial accounts. Each password is generated and shown once; the person changes it after
signing in (the key icon, top right):

```bash
MONGO_URI="mongodb+srv://…/saar_prod" npx tsx scripts/staff.ts add someone@yourdomain.com "Their Name"
```

Never run `npm run db:seed` against it. The seed scripts refuse a database that is not on your machine,
unless given `--force-remote`; there is no reason to give it here.

## 3. The server

On the server (Ubuntu):

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER   # then log out and back in
git clone https://github.com/<you>/<repo>.git saar && cd saar
cp infra/production.env.example .env.production
chmod 600 .env.production
nano .env.production            # fill in every value — the comments say what each is
```

Point the domain at the server: a DNS **A record** for `saar.example.com` → the server's IP. Wait until
`ping saar.example.com` answers with that IP.

Start everything:

```bash
GIT_SHA=$(git rev-parse --short HEAD) docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f infra/docker-compose.prod.yml --env-file .env.production logs -f
```

A missing setting stops the server it belongs to with a message naming the setting.

## 4. Check it

- `https://saar.example.com/v1/health` shows `ok`, and the commit you deployed.
- `https://saar.example.com/` is the website; `/privacy`, `/terms` and `/delete-account` load.
- `https://saar.example.com/#/queue` asks for an editorial sign-in, and the account from step 2 works.

## 5. Google Cloud

In the Google Cloud project used for sign-in:

1. **OAuth consent screen:** set the publishing status to **In production**.
2. **Web client ID** (the one in `GOOGLE_WEB_CLIENT_ID`): add `https://saar.example.com` as an
   **Authorized JavaScript origin**. The account-deletion page signs in with it.
3. **Android client ID** (package `com.saar.news`): after the first upload to Play Console, add the
   **SHA-1 of Play's app signing key** (Play Console → Test and release → App integrity). Keep the EAS
   key's SHA-1 too, so internal builds still sign in.
4. **API keys:** restrict the YouTube key to the server's IP and to the YouTube Data API.

## 6. The app

Set the domain in `apps/mobile/eas.json`: replace `https://saar.example.invalid` in the `production`
(and `preview`) profile with `https://saar.example.com`. Then:

```bash
cd apps/mobile
npx eas-cli build -p android --profile production
```

This builds an app bundle (`.aab`) for Play Console. The version code is kept by EAS and goes up on each
production build. A `preview` build makes an installable APK pointed at production, for testing on a phone.

## 7. Updating

```bash
cd saar && git pull
GIT_SHA=$(git rev-parse --short HEAD) docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
```

After a change to the database's indexes or validators, run step 2's `db:init` again.

## 8. Backups

The free Atlas tier keeps none. From any computer with the repository, weekly:

```bash
MONGO_URI="mongodb+srv://…/saar_prod" npx tsx scripts/backup-db.ts --out /path/to/backups
```

And the media, on the server:

```bash
docker run --rm -v saar_media:/m -v "$PWD/backups":/b alpine tar czf /b/media-$(date +%F).tgz -C /m .
```

Keep both somewhere other than the server. Try a restore once, into a scratch database:

```bash
MONGO_URI=mongodb://localhost:27017/saar_restore_test npx tsx scripts/restore-db.ts /path/to/backups/saar_prod-…
```

The files hold readers' data (hashed account IDs, votes, install IDs), so keep them as carefully as the
database.

## 9. Moving existing photos and videos

The development media (227 MB in `media/`) is mostly demonstration content. Production should start clean,
with publishers' real content. If some of it is needed, copy it into the volume:

```bash
docker run --rm -v saar_media:/m -v "$PWD/media":/src alpine sh -c "cp -r /src/. /m/"
```
