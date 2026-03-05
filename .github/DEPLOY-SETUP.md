# Automatic Firebase Deploy Setup

The repo deploys to Firebase Hosting automatically when you push to `main`. You can also trigger a deploy manually from the [Actions tab](https://github.com/YOUR_ORG/YOUR_REPO/actions) on GitHub.

## One-time setup (do this at home)

### 1. Get a Firebase CI token

Run this in your terminal (it will open a browser to sign in):

```bash
npx firebase login:ci
```

Copy the long token it prints (starts with something like `1//...`).

### 2. Add the token to GitHub

1. Open your repo on GitHub
2. Go to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `FIREBASE_TOKEN`
5. Value: paste the token from step 1

### 3. Push the workflow

Make sure this file is committed and pushed:

```
.github/workflows/deploy.yml
```

## After setup

- **Automatic**: Any push to `main` (including from Cursor when you're away) will build and deploy.
- **Manual**: Go to Actions → "Deploy to Firebase Hosting" → "Run workflow".
