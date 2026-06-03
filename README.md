# Bookmark Maker - Double-Sided Song Lyrics

A Streamlit web app to generate a 2-page PDF for double-sided printable bookmarks:

- **Page 1**: 5 bookmark fronts (title + optional image)
- **Page 2**: 5 bookmark backs (song lyrics), using the **exact same coordinates**
- Letter paper in landscape (`11 x 8.5 in`)
- Designed for duplex printing with **flip on short edge**

## Run locally

```powershell
cd c:\Users\Brockston King\Code\HomeUse\bookmark-maker
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run app.py
```

## Deploy on Streamlit Community Cloud (free)

1. Push this folder to a GitHub repository.
2. Go to https://share.streamlit.io/
3. Click **New app**.
4. Select your repo and branch.
5. Set **Main file path** to `app.py`.
6. Click **Deploy**.

After deploy, you will get a public URL like:

`https://your-app-name.streamlit.app`

If you get `DNS_PROBE_FINISHED_NXDOMAIN` right after deploy:

1. Wait 2-10 minutes and hard refresh.
2. Open the app from your Streamlit dashboard using the globe icon (this avoids typo/cached URL issues).
3. Try a different network or DNS (for example Cloudflare `1.1.1.1` or Google `8.8.8.8`).
4. Rename the app URL in Streamlit settings and redeploy.

## Alternative Deployment 1: Hugging Face Spaces (recommended fallback)

Hugging Face Spaces runs Streamlit apps directly and gives a stable public URL.

1. Create a new Space at https://huggingface.co/new-space
2. Choose **Docker** SDK (this app is Streamlit, and Docker is the reliable way to run it on HF).
3. Connect this GitHub repository or upload these files.
4. Ensure `app.py` and `requirements.txt` are in the Space root.
5. Spaces builds automatically and provides a URL like:
	`https://huggingface.co/spaces/<username>/bookmark-maker`

### Auto-sync this GitHub repo to your HF Space

This repo includes a GitHub Actions workflow at `.github/workflows/sync-to-huggingface-space.yml`.

Set these once in your GitHub repository settings:

1. Create a Hugging Face token at https://huggingface.co/settings/tokens with **write** access.
2. In GitHub repo settings, add secret `HF_TOKEN` with that token value.
3. In GitHub repo settings, add variable `HF_SPACE_ID` with value like `LoneStormRider/bookmark-maker-lyrics`.
4. Push to `main` (or run the workflow manually from Actions).

After sync, your live app URL is:

`https://<your-space-subdomain>.hf.space`

## Alternative Deployment 2: Render (Docker)

This repo includes Docker deployment files:

- `Dockerfile`
- `render.yaml`

To deploy on Render:

1. Go to https://render.com/
2. Create **New +** > **Blueprint**.
3. Select this repository.
4. Render reads `render.yaml`, builds Docker, and deploys.
5. You get a public URL like `https://bookmark-maker.onrender.com`.
