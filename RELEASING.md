# Releasing

Publishing is automated with GitHub Actions using a **version-bump** trigger.

## How to cut a release

1. Bump the `version` in `manifest.json` (e.g. `1.5.0` -> `1.5.1`).
   Also update the version shown in `options.html` and add a `CHANGELOG.md` entry.
2. Commit and push to `main`.
3. The **Release** workflow runs. It publishes **only if** the manifest version is
   higher than the latest `vX.Y.Z` GitHub Release tag. If the version is unchanged,
   it does nothing — so ordinary code pushes never publish.

That's it: **change the version + push = publish. Same version + push = no-op.**

### Manual run

You can also publish on demand: GitHub -> **Actions** -> **Release** -> **Run workflow**.
Tick **force** to publish even if the version didn't change (rarely needed).

## One-time setup: GitHub repo secrets

Add these under **Settings -> Secrets and variables -> Actions -> New repository secret**.

### Chrome Web Store (required now)

| Secret | Value |
| --- | --- |
| `CHROME_EXTENSION_ID` | `namfjahinpffehdannbnpdjdjkkkchjg` |
| `CHROME_CLIENT_ID` | OAuth client id (see below) |
| `CHROME_CLIENT_SECRET` | OAuth client secret |
| `CHROME_REFRESH_TOKEN` | Long-lived refresh token |

How to get the OAuth credentials (one-time):

1. Go to the Google Cloud Console, create (or pick) a project.
2. Enable the **Chrome Web Store API** for that project.
3. Configure the OAuth consent screen (External, add yourself as a test user).
4. Create an **OAuth client ID** of type **Desktop app** -> note the client id + secret.
5. Generate a refresh token once. Easiest:
   ```bash
   npx chrome-webstore-upload-keys
   ```
   Follow the prompts (it opens a Google consent page, you paste back a code) and it
   prints the `refresh_token`. Save client id, secret, and refresh token as the secrets above.

### Edge Add-ons (later — account still in verification)

Product ID is already known: `0683f83c-0e7e-4085-b6e7-14b02d74832d`.

When your Partner Center account is verified and you can create API credentials:

| Secret | Value |
| --- | --- |
| `EDGE_PRODUCT_ID` | `0683f83c-0e7e-4085-b6e7-14b02d74832d` |
| `EDGE_CLIENT_ID` | from Partner Center API settings |
| `EDGE_API_KEY` | from Partner Center API settings |

Then uncomment the "Publish to Edge Add-ons" step in `.github/workflows/release.yml`.

## Notes

- The **first** Chrome submission must be done manually in the dashboard (listing,
  screenshots, privacy URL). The API only updates an existing item.
- With `<all_urls>`, every published version still goes through store review before
  going live. The workflow submits; approval is on the store side.
- Local build for testing: `bash package.sh` -> produces `dist/extension.zip`.
