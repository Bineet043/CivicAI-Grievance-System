# 🚀 CivicAI Grievance System Deployment Guide

We need to deploy two components:
1. **ML Classification Server** (`backend/classify_server.py`): Hosts the FastAPI app with YOLO and CLIP. Since this requires high memory, we will host it for free on **Hugging Face Spaces** (Docker-based, 16GB RAM free tier).
2. **Frontend & Express Web Server** (`backend/server.js` & `frontend/`): Serves the web interface and maps to Supabase. We will host this on **Render** (Node.js free tier).

---

## 🤖 Part 1: Deploying the ML Server to Hugging Face Spaces

1. Go to [Hugging Face](https://huggingface.co/) and log in.
2. Click your profile picture -> **New Space** (or go to [huggingface.co/new-space](https://huggingface.co/new-space)).
3. Configure the Space:
   * **Space Name**: `civicai-classifier` (must match exactly to sync with the dynamic URL)
   * **SDK**: **Docker** 🐳
   * **Template**: **Blank**
   * **Space Hardware**: **CPU Basic** (Free, 16GB RAM)
   * **Visibility**: **Public**
4. Click **Create Space**.
5. Push the files in the `backend/` directory to the Hugging Face Space repository:
   * You can clone the Space repository locally, copy the contents of `backend/` (`Dockerfile`, `classify_server.py`, `requirements.txt`) into it, and push:
     ```bash
     git clone https://huggingface.co/spaces/bineetOG/civicai-classifier
     # Copy Dockerfile, classify_server.py, and requirements.txt into the cloned directory
     git add .
     git commit -m "Deploy ML Classification Server"
     git push
     ```
   * *Alternatively*, you can upload these 3 files directly via the Hugging Face website interface.
6. **Set up the Gemini Key**:
   * In your Hugging Face Space, go to the **Settings** tab.
   * Scroll down to **Variables and secrets** -> **New secret**.
   * Add a secret:
     * **Name**: `GEMINI_API_KEY`
     * **Value**: `YOUR_GEMINI_API_KEY_HERE`
7. Once files are uploaded and secrets are set, Hugging Face will automatically build and start the server. It will be live at:
   `https://bineetog-civicai-classifier.hf.space`

---

## 🌐 Part 2: Deploying the Web Client to Render

1. Go to [Render](https://render.com/) and log in with GitHub.
2. Click **New +** -> **Web Service**.
3. Choose your GitHub repository **`Bineet043/CivicAI-Grievance-System`**.
4. Configure the Web Service settings:
   * **Name**: `civicai-grievance-system`
   * **Language/Runtime**: `Node`
   * **Branch**: `main`
   * **Root Directory**: `backend` *(Critical: This points Render to the folder containing `package.json` & `server.js`)*
   * **Build Command**: `npm install`
   * **Start Command**: `node server.js`
   * **Instance Type**: `Free`
5. Click **Deploy Web Service**.
6. Once deployed, Render will provide a public URL for your web app (e.g., `https://civicai-grievance-system.onrender.com`).

---

## ⚡ How the Dynamic Connection Works
We updated the frontend (`frontend/app.js`) to dynamically resolve the ML server URL:
* If running on **localhost**, it will send classification requests to your local Python server (`http://localhost:8000/classify`).
* If running on **production (Render)**, it will send classification requests to your deployed Hugging Face Space ML server (`https://bineetog-civicai-classifier.hf.space/classify`).
