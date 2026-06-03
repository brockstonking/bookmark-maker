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
