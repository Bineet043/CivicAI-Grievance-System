# CivicAI: AI-Assisted Citizen Grievance System

[![Platform](https://img.shields.io/badge/Platform-Web-00f2fe.svg?style=flat-glass)](https://github.com/Bineet043/CivicAI-Grievance-System)
[![License](https://img.shields.io/badge/License-MIT-7f00ff.svg?style=flat-glass)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Operational-2ed573.svg?style=flat-glass)](https://github.com/Bineet043/CivicAI-Grievance-System)

CivicAI is a high-reliability, smart governance web application that transforms unstructured citizen grievance submissions—including geo-tagged images, hazard parameters, and descriptions—into prioritized, auto-routed municipal work tickets.

---

## 🌟 Key Features

### 📱 1. Citizen Portal (Simulated Interface)
*   **Multi-Modal Ingestion:** Supports camera uploads or selection of pre-configured urban grievances (potholes, streetlights, sanitation blocks, water leaks).
*   **Geotagging:** Lat/lng coordinate generation based on mock GPS or interactive map selection.
*   **AI Scanning Simulation:** Radial visual scanning animation with real-time telemetry logs streaming from classification to routing.

### 📊 2. Admin Command Center
*   **Live Grievance Map:** Custom Leaflet.js dark tile map marking active grievance coordinates (colored circles indicate priority: Red for critical, Orange for medium, Blue for low, Green for resolved).
*   **Analytics Dashboard:** Chart.js charts detailing department workload distribution and priority bands.
*   **Live Work Queue:** Table tracking with action controls (**Inspect**, **Dispatch Service Team**, **Mark as Resolved**).

### 🧪 3. Model Validation Sandbox
*   **Environmental Regulators:** Simulates CNN and NLP degradation under varying conditions (heavy rain, night lighting, fog, camera resolutions, and occlusions).
*   **Telemetry Logs:** Computes real-time accuracy percentages and outputs ms pipeline execution latencies.

---

## ⚙️ Technical Stack

*   **Core Logic & Structure:** HTML5 / CSS3 / JavaScript (ES6+)
*   **Data Visualization:** Chart.js (custom dark themes)
*   **Geospatial Processing:** Leaflet.js (CartoDB Dark Matter tiles)
*   **Local Host Server:** Node.js / Express.js

---

## 🔬 Mathematical Prioritization Formula

The Urgency Score ($U_{score}$) is determined dynamically via:

$$U_{score} = \text{Base} + (S_{user} \times 8) + E_{modifier}$$

Where:
*   **Base:** Constant based on grievance category (Water Leak = 60, Pothole = 50, Streetlight = 40, Garbage = 30).
*   **$S_{user}$:** Immediate hazard severity level selected by the citizen (1 to 5).
*   **$E_{modifier}$:** Dynamic environmental boost determined by Sandbox inputs (e.g., Rain = +12 for potholes, Night = +16 for streetlights).

---

## 📚 Academic Foundations

*   **Computer Vision:** *Learning OpenCV 4* by Adrian Kaehler & Gary Bradski — Informs preprocessing noise-filters in low-resolution settings.
*   **System Design:** *Designing Data-Intensive Applications* by Martin Kleppmann — Applied for robust event logs and outbox queue routing.
*   **Adaptive Prioritization:** *Elements of Adaptive Testing* by van der Linden & Glas — Used for dynamic score weighting.
*   **Cognitive Load:** *Multimedia Learning* by Richard E. Mayer — Applied to design a distraction-free, progressive interface.

---

## 🚀 How to Run Locally

### Prerequisites
* [Node.js](https://nodejs.org/) installed
* [Python 3.8+](https://www.python.org/) installed

### Project Directory Structure
The repository is split into:
* `frontend/`: Direct static assets (`index.html`, `app.js`, `style.css`, static `assets`).
* `backend/`: Server-side code (`server.js`), ML models (`classify_server.py`), YOLO weights (`weights/`), and configurations.

---

### Setup & Launch

#### 1. Start Node.js Web Server (Express)
Serves the static web page.
```bash
cd backend
npm install
npm run dev
```
Access the portal at: **`http://localhost:3000`**

#### 2. Start ML Classification Server (FastAPI)
Handles YOLO/CLIP image classification and Gemini validation.
```bash
# From root directory
cd backend

# Install dependencies
pip install -r requirements.txt

# Create .env file with your Gemini API Key
# GEMINI_API_KEY=your_api_key_here

# Launch server
python -m uvicorn classify_server:app --host 0.0.0.0 --port 8000
```
The ML backend will be listening on: **`http://localhost:8000`**

