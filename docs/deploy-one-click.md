# Put PennyATS online in a few clicks

This guide is for founders and recruiters who want their own private copy of PennyATS on the internet without using a terminal. You will need a credit card for the hosting company. Expect to pay them roughly the cost of a small server and a small database each month; check their pricing page for current numbers. PennyATS itself is free.

If you only want to look around first, use the public demo instead (see [demo.md](demo.md)). Never type real candidate data into the demo.

## What you get

- Your own PennyATS at a web address the host gives you (you can add your own domain later).
- A private database that only your copy uses.
- Storage for resumes that survives updates and restarts.
- A random secret key, made for you. You never have to invent a password for the server.

Nothing is shared with the PennyATS project. Your data lives in your account with the host.

## Option 1: Render

1. Click **Deploy to Render** in the [README](../README.md#put-it-online).
2. Sign in to Render, or create an account.
3. Render shows what it will create: a web service called `pennyats`, a database called `pennyats-db`, and a 1 GB disk for resumes. Click **Apply**.
4. Wait. The first build takes about 10 minutes. You can watch progress on the `pennyats` service page.
5. When the service shows **Live**, click the address at the top of the page (it ends in `onrender.com`).
6. You land on **Set up your workspace**. Enter your name, email, and a password. This makes you the admin.

That is it. Invite your team from **Settings, Users**.

Render plans: resume storage needs a paid web service (the template picks **Starter**) and a paid database. The free database is deleted after a few weeks, so do not use it for real hiring.

## Option 2: Railway

The Railway button is not published yet. It needs a Railway template, which the project maintainers create from a Railway account. Until then, you can set it up by hand in about ten clicks:

1. In Railway, create a new project and choose **Deploy from GitHub repo**, then pick your copy (fork) of PennyATS. Railway reads `railway.json` and builds `docker/Dockerfile.platform`.
2. Add a **PostgreSQL** database to the same project.
3. On the PennyATS service, open **Variables** and add:
   - `DATABASE_URL` with the value `${{Postgres.DATABASE_URL}}`
   - `AUTH_SECRET` with the value `${{secret(48)}}` (Railway fills in a random value)
   - `STORAGE_DIR` with the value `/data/uploads`
4. On the PennyATS service, add a **Volume** mounted at `/data/uploads`. This is where resumes are kept.
5. Under **Settings, Networking**, click **Generate Domain**. PennyATS picks up that address by itself.
6. Open the address and create your admin account.

## What the words mean

- **Deploy**: put a copy of the app on a server so you can open it in a browser.
- **Database**: where PennyATS keeps jobs, candidates, notes, and everything else. It is Postgres, a widely used open source database.
- **Disk** or **volume**: storage that is kept when the app restarts or updates. Resumes go here.
- **Secret** (`AUTH_SECRET`): a long random value the app uses to lock up stored keys, such as calendar connections. The template makes one for you. Do not change it later, or saved calendar connections and webhook secrets stop working.

## Updating to a newer version

- **Render**: open the `pennyats` service and click **Manual Deploy, Deploy latest commit**. If you deployed from your own fork, first click **Sync fork** on GitHub. The database is updated automatically when the new version starts.
- **Railway**: if you deployed from a fork, click **Sync fork** on GitHub; Railway redeploys on its own. The database is updated automatically when the new version starts.

Take a backup before you update.

## Backing up

You need two things backed up: the database and the resumes.

- **Database**: Render takes daily backups on paid databases (see the database's **Recovery** tab). Railway offers backups on the database service's **Backups** tab. You can also download your whole workspace at any time from PennyATS (**Settings, Privacy**, workspace export) in an open format you can import into a new copy.
- **Resumes**: Render snapshots disks daily. On Railway, volume backups are under the service's **Backups** tab.

## Do not load demo data

PennyATS has a command that fills it with made-up candidates and a demo login with a password that is published online. It must never run on your real copy. It refuses to run once you have created your admin account, and the one-click setup never runs it.

## If something goes wrong

- **The page says "PennyATS cannot start"** in the host's logs: read the line after it. It names the missing setting (usually the database or the secret).
- **Uploads disappear after an update**: the disk or volume is missing or mounted somewhere other than `/data/uploads`.
- Still stuck? Open an issue at https://github.com/PennyATS/PennyATS/issues and paste the error, but never paste secrets or candidate data.

## Status of this guide

The Render blueprint and Railway config are checked in CI by building the one-click image, starting it against a fresh Postgres with a root-owned volume, and checking that it migrates, reaches the setup page, refuses a missing or example secret, and keeps uploads across a redeploy. The steps above have not yet been run end to end on Render and Railway from a clean account, and the screenshots are still to come; see issue #131.
