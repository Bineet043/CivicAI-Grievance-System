// CivicAI Grievance Decision System - Core Logic

// ─── SUPABASE CLIENT ────────────────────────────────────────────────────────
const SUPABASE_URL = "https://cujtglxnriadmwsmyndn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1anRnbHhucmlhZG13c215bmRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTUxOTYsImV4cCI6MjA5NjU5MTE5Nn0.67wfH82Ndx7z1RpkiHfToEsIP3kO4Ls_qSWd8eda5dU";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Upload image blob/dataURL to Supabase Storage, return public URL ────────
async function uploadImageToSupabase(imgSrc, ticketId) {
    try {
        let blob;
        if (imgSrc.startsWith('data:')) {
            // Convert dataURL → Blob
            const res = await fetch(imgSrc);
            blob = await res.blob();
        } else {
            // It's a path like assets/pothole.png — fetch it
            const res = await fetch(imgSrc);
            blob = await res.blob();
        }
        const ext = blob.type.split('/')[1] || 'jpg';
        const fileName = `${ticketId}.${ext}`;
        const { data, error } = await supabaseClient.storage
            .from('grievance-images')
            .upload(fileName, blob, { contentType: blob.type, upsert: true });
        if (error) throw error;
        const { data: urlData } = supabaseClient.storage
            .from('grievance-images')
            .getPublicUrl(fileName);
        return urlData.publicUrl;
    } catch (e) {
        console.warn('[SUPABASE] Image upload failed:', e.message);
        return imgSrc; // fallback: use original src
    }
}

// ─── Save a ticket object to Supabase DB ─────────────────────────────────────
async function saveTicketToSupabase(ticket, imageUrl) {
    const row = {
        ticket_id:   ticket.id,
        category:    ticket.category,
        lat:         ticket.lat,
        lng:         ticket.lng,
        address:     ticket.description || '',
        urgency:     ticket.urgency,
        status:      ticket.status.toUpperCase(),
        department:  ticket.department,
        image_url:   imageUrl,
        created_at:  ticket.timestamp
    };
    const { error } = await supabaseClient.from('tickets').insert(row);
    if (error) console.warn('[SUPABASE] Insert failed:', error.message);
    else writeLog(`[SUPABASE] Ticket ${ticket.id} persisted to database ✓`, 'success');
}

// ─── Update ticket status in Supabase DB ─────────────────────────────────────
async function updateTicketStatusInSupabase(ticketId, newStatus) {
    const { error } = await supabaseClient
        .from('tickets')
        .update({ status: newStatus.toUpperCase() })
        .eq('ticket_id', ticketId);
    if (error) console.warn('[SUPABASE] Status update failed:', error.message);
    else writeLog(`[SUPABASE] Ticket ${ticketId} status -> ${newStatus.toUpperCase()} OK`, 'success');
}

// ─── Delete a ticket row from Supabase DB ─────────────────────────────────────
async function deleteTicketFromSupabase(ticketId) {
    const { error } = await supabaseClient
        .from('tickets')
        .delete()
        .eq('ticket_id', ticketId);
    if (error) console.warn('[SUPABASE] Delete failed:', error.message);
    else writeLog(`[SUPABASE] Ticket ${ticketId} permanently deleted from database OK`, 'success');
}

// ─── Load all tickets from Supabase and merge into local state ───────────────
async function loadTicketsFromSupabase() {
    const { data, error } = await supabaseClient
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) {
        console.warn('[SUPABASE] Load failed:', error.message);
        return;
    }
    if (!data || data.length === 0) return;

    // Map DB rows → local ticket shape
    const dbTickets = data.map(row => ({
        id:          row.ticket_id,
        category:    row.category,
        urgency:     row.urgency,
        status:      (row.status || 'PENDING').toLowerCase(),
        lat:         row.lat,
        lng:         row.lng,
        image:       row.image_url || 'assets/pothole.png',
        description: row.address || '',
        timestamp:   row.created_at ? row.created_at.substring(0, 19).replace('T', ' ') : '',
        department:  row.department,
        severity:    row.urgency > 80 ? 5 : row.urgency > 50 ? 4 : row.urgency > 30 ? 3 : 2
    }));

    // Replace the in-memory array with DB data
    tickets.length = 0;
    dbTickets.forEach(t => tickets.push(t));
    writeLog(`[SUPABASE] Loaded ${tickets.length} tickets from database ✓`, 'success');
}

// ─── Subscribe to real-time inserts on the tickets table ─────────────────────
function subscribeToTicketUpdates() {
    supabaseClient
        .channel('tickets-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, payload => {
            const row = payload.new;
            // Avoid duplicates (we already added locally)
            if (tickets.find(t => t.id === row.ticket_id)) return;
            const t = {
                id:          row.ticket_id,
                category:    row.category,
                urgency:     row.urgency,
                status:      (row.status || 'PENDING').toLowerCase(),
                lat:         row.lat,
                lng:         row.lng,
                image:       row.image_url || 'assets/pothole.png',
                description: row.address || '',
                timestamp:   row.created_at ? row.created_at.substring(0, 19).replace('T', ' ') : '',
                department:  row.department,
                severity:    row.urgency > 80 ? 5 : row.urgency > 50 ? 4 : 3
            };
            tickets.unshift(t);
            addNewMarker(t);
            updateDashboardMetrics();
            renderTicketsTable('all');
            if (typeof renderAdminPanelTable === 'function') renderAdminPanelTable();
            updateCharts();
            writeLog(`[REALTIME] New ticket received: ${t.id} (${t.category})`, 'success');
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, payload => {
            const row = payload.new;
            const idx = tickets.findIndex(t => t.id === row.ticket_id);
            if (idx !== -1) {
                tickets[idx].status = (row.status || 'PENDING').toLowerCase();
                updateMarkerStatus(tickets[idx].id, tickets[idx].status, tickets[idx].urgency);
                updateDashboardMetrics();
                renderTicketsTable('all');
                if (typeof renderAdminPanelTable === 'function') renderAdminPanelTable();
                updateCharts();
                writeLog(`[REALTIME] Ticket ${row.ticket_id} updated → ${row.status}`, 'system');
            }
        })
        .subscribe();
}

// 1. DATABASE & INITIAL STATE
let tickets = [
    {
        id: "GRV-38291",
        category: "Streetlight",
        urgency: 82,
        status: "dispatched",
        lat: 12.9784,
        lng: 77.5902,
        image: "assets/streetlight.png",
        description: "Streetlight has been out for 3 days, rendering the pedestrian crossing pitch black and dangerous.",
        timestamp: "2026-06-07 15:30:22",
        department: "Electricity Board",
        severity: 4
    },
    {
        id: "GRV-84920",
        category: "Pothole",
        urgency: 74,
        status: "dispatched",
        lat: 12.9698,
        lng: 77.6105,
        image: "assets/pothole.png",
        description: "Deep crater-like pothole near the highway entrance. Vehicles are swerving to avoid it, causing hazards.",
        timestamp: "2026-06-07 17:15:40",
        department: "Department of Public Works",
        severity: 4
    },
    {
        id: "GRV-10394",
        category: "Garbage",
        urgency: 42,
        status: "pending",
        lat: 12.9825,
        lng: 77.5982,
        image: "assets/garbage.png",
        description: "Large heap of unsorted plastic bags piled outside the local municipal park boundary. Attracting stray animals.",
        timestamp: "2026-06-07 18:02:11",
        department: "Sanitation Board",
        severity: 2
    },
    {
        id: "GRV-05829",
        category: "Water Leak",
        urgency: 92,
        status: "resolved",
        lat: 12.9612,
        lng: 77.5855,
        image: "assets/water_leak.png",
        description: "High-pressure water main rupture spraying clean water all over the road, eroding the soil base.",
        timestamp: "2026-06-07 10:14:05",
        department: "Water Supply & Sewage Board",
        severity: 5
    }
];

// Custom Coordinate Selector (Updated when user clicks map)
let nextReportCoords = { lat: 12.9716, lng: 77.5946 };

// UI Active Navigation State
let activeTab = "citizen";
let currentAdminFilter = "all";

// Active selection for new reports
let selectedIssueType = null;
let customImageData = null;
let customImageFile = null; // Raw File object for ML classification upload
let lastMlSource = null;
let lastMlConfidence = null;

// ML Classification backend URL (points to local or Hugging Face Space)
const CLASSIFY_API_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000/classify"
    : "https://bineetog-civicai-classifier.hf.space/classify";

// Map & Charts instances
let map;
let markersGroup = [];
let deptChartInstance = null;
let priorityChartInstance = null;

// Active ticket in Modal
let activeTicketId = null;

// Helper to keep Form Coordinates in sync with nextReportCoords state
function updateFormCoordinates() {
    const latEl = document.getElementById("coord-lat");
    const lngEl = document.getElementById("coord-lng");
    if (latEl && lngEl) {
        latEl.textContent = nextReportCoords.lat.toFixed(5);
        lngEl.textContent = nextReportCoords.lng.toFixed(5);
    }
}

// Reverse geocode lat/lng → human address via OpenStreetMap Nominatim (no API key needed)
async function reverseGeocode(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
        const response = await fetch(url, {
            headers: { 'Accept-Language': 'en', 'User-Agent': 'CivicAI-GrievanceSystem/1.0' }
        });
        if (!response.ok) throw new Error('Nominatim request failed');
        const data = await response.json();

        // Build a short human-readable address
        const a = data.address || {};
        const parts = [
            a.road || a.pedestrian || a.path || a.neighbourhood,
            a.suburb || a.city_district || a.quarter,
            a.city || a.town || a.village || a.county,
            a.state
        ].filter(Boolean);

        return parts.slice(0, 3).join(', ') || data.display_name.split(',').slice(0, 2).join(',').trim();
    } catch (e) {
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

// Set address chip + accuracy indicator
function setLocationUI(address, accuracyMeters, source) {
    const addrEl = document.getElementById('gps-address');
    const accEl = document.getElementById('gps-accuracy-text');
    const dotEl = document.getElementById('accuracy-dot');

    if (addrEl) addrEl.textContent = address;
    if (accEl) {
        if (accuracyMeters !== null) {
            accEl.textContent = `${source} · ±${Math.round(accuracyMeters)} m accuracy`;
        } else {
            accEl.textContent = `Source: ${source}`;
        }
    }
    if (dotEl) {
        dotEl.className = 'accuracy-dot';
        if (accuracyMeters === null || accuracyMeters > 500) dotEl.classList.add('poor');
        else if (accuracyMeters > 100) dotEl.classList.add('medium');
        else dotEl.classList.add('good');
    }
}

// Flash the GPS box to confirm a coordinate update
function flashGpsBox() {
    const box = document.getElementById('gps-selector-box');
    if (!box) return;
    box.classList.remove('flash');
    void box.offsetWidth; // force reflow
    box.classList.add('flash');
    setTimeout(() => box.classList.remove('flash'), 1300);
}

// Persistent you-are-here marker & accuracy circle on Leaflet map
let youAreHereMarker = null;
let accuracyCircle = null;

function placeYouAreHereMarker(lat, lng, accuracyMeters) {
    if (!map) return;

    // Remove old markers
    if (youAreHereMarker) { map.removeLayer(youAreHereMarker); youAreHereMarker = null; }
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }

    // Accuracy radius circle (translucent cyan)
    if (accuracyMeters && accuracyMeters < 5000) {
        accuracyCircle = L.circle([lat, lng], {
            radius: accuracyMeters,
            color: '#00f2fe',
            fillColor: '#00f2fe',
            fillOpacity: 0.06,
            weight: 1.5,
            dashArray: '4 4'
        }).addTo(map);
    }

    // Pulsing you-are-here dot (DivIcon)
    const icon = L.divIcon({
        className: '',
        html: '<div class="you-are-here-dot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    youAreHereMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup('<strong style="font-family:var(--font-heading);font-size:12px;">📍 Your Location</strong>');

    map.setView([lat, lng], 16, { animate: true });
}

// 2. INITIALIZATION ON DOM LOAD
document.addEventListener("DOMContentLoaded", async () => {
    initNavigation();
    initCitizenPortal();
    initAdminConsole();
    initSandbox();
    initModal();

    // ── Supabase: load persisted tickets then subscribe to live updates ──
    await loadTicketsFromSupabase();

    // Re-render everything with DB tickets (map markers were added by initAdminConsole before load)
    // Clear existing markers and re-add from updated tickets array
    markersGroup.forEach(m => { if (map) map.removeLayer(m.markerObj); });
    markersGroup.length = 0;
    tickets.forEach(t => addNewMarker(t));

    // Initial Render of tables & charts with live DB data
    updateDashboardMetrics();
    renderTicketsTable("all");
    if (typeof renderAdminPanelTable === "function") renderAdminPanelTable();
    updateCharts();

    // Subscribe to real-time changes
    subscribeToTicketUpdates();

    // Silently acquire real location on page load so form is pre-filled
    initGeolocation();
});

// Silent background geolocation — runs once on page load
function initGeolocation() {
    if (!navigator.geolocation) {
        writeLog('[GPS] Geolocation API not available. Using default coordinates.', 'warn');
        return;
    }

    // Show a subtle 'acquiring location…' state in the accuracy row
    setLocationUI('Acquiring location…', null, 'Initializing…');
    const dotEl = document.getElementById('accuracy-dot');
    if (dotEl) dotEl.className = 'accuracy-dot medium';

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const acc = position.coords.accuracy;

            // Update the global coordinate state
            nextReportCoords = { lat, lng };
            updateFormCoordinates();         // update lat/lng spans
            flashGpsBox();

            // Reverse geocode for a human-readable address
            const address = await reverseGeocode(lat, lng);
            setLocationUI(address, acc, 'Device GPS');

            // Center map on current location and place visual marker
            placeYouAreHereMarker(lat, lng, acc);

            writeLog(`[GPS] Auto-location on load: [${lat.toFixed(5)}, ${lng.toFixed(5)}] ±${Math.round(acc)}m`, 'success');
            writeLog(`[GEOCODE] Address: "${address}"`, 'success');
        },
        async (err) => {
            // Permission denied or unavailable — silently fall back, no alert
            writeLog(`[GPS] Auto-location failed (${err.message}). Keeping default Bengaluru coords.`, 'warn');
            const address = await reverseGeocode(nextReportCoords.lat, nextReportCoords.lng);
            setLocationUI(address, null, 'Default (permission denied)');
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
}

// 3. NAVIGATION HANDLER
function initNavigation() {
    const navItems = document.querySelectorAll(".nav-item");
    const sections = document.querySelectorAll(".tab-content");

    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const targetTab = item.getAttribute("data-tab");

            navItems.forEach(n => n.classList.remove("active"));
            sections.forEach(s => s.classList.remove("active"));

            item.classList.add("active");
            document.getElementById(`${targetTab}-section`).classList.add("active");

            activeTab = targetTab;
            writeLog(`[NAVIGATION] Switched workspace view to: ${targetTab.toUpperCase()}`, "system");

            // Leaflet map needs resize recalculation if it was initialized in a hidden tab
            if (targetTab === "admin" && map) {
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
            }

            // Render admin panel table on tab switch
            if (targetTab === "admin-panel") {
                if (typeof renderAdminPanelTable === "function") {
                    renderAdminPanelTable();
                }
            }
        });
    });
}

// 4. CITIZEN PORTAL SIMULATOR FLOW
function initCitizenPortal() {
    const sampleCards = document.querySelectorAll(".sample-card");
    const customUploadBtn = document.getElementById("custom-upload-trigger");
    const customFileInput = document.getElementById("custom-image-input");

    const screenHome = document.getElementById("screen-home");
    const screenDetails = document.getElementById("screen-details");
    const backToHomeBtn = document.getElementById("back-to-home");
    const selectedImgPreview = document.getElementById("selected-image-preview");

    const btnMockGps = document.getElementById("btn-mock-gps");
    const btnSubmitReport = document.getElementById("btn-submit-report");
    const btnResetSimulator = document.getElementById("btn-reset-simulator");



    // Custom Upload Trigger
    customUploadBtn.addEventListener("click", () => {
        customFileInput.click();
    });

    customFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            lastMlSource = null;
            lastMlConfidence = null;
            customImageFile = file; // Store raw File for ML classification
            const reader = new FileReader();
            reader.onload = (event) => {
                selectedIssueType = "custom";
                customImageData = event.target.result;

                selectedImgPreview.src = customImageData;
                document.getElementById("issue-description").value = "";
                document.getElementById("issue-severity-slider").value = 3;

                // Coordinates
                updateFormCoordinates();

                screenHome.classList.remove("active");
                screenDetails.classList.add("active");

                writeLog(`[INGESTION] Custom file loaded: ${file.name} (${Math.round(file.size / 1024)} KB)`, "info");
            };
            reader.readAsDataURL(file);
        }
    });

    // Back to Screen 1
    backToHomeBtn.addEventListener("click", () => {
        screenDetails.classList.remove("active");
        screenHome.classList.add("active");
        lastMlSource = null;
        lastMlConfidence = null;
        writeLog("[SYSTEM] Returned to home screen. Session cleared.", "system");
    });

    // GPS Geolocation Handler with reverse geocoding, accuracy circle, and you-are-here marker
    btnMockGps.addEventListener("click", () => {
        writeLog("[GPS] Requesting high-accuracy fix from device...", "info");
        btnMockGps.disabled = true;
        btnMockGps.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Locating...`;

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    const acc = position.coords.accuracy; // metres

                    nextReportCoords = { lat, lng };
                    updateFormCoordinates();
                    flashGpsBox();

                    // Reverse geocode for address
                    writeLog(`[GPS] Fix acquired: [${lat.toFixed(6)}, ${lng.toFixed(6)}] ±${Math.round(acc)}m. Reverse geocoding...`, "success");
                    const address = await reverseGeocode(lat, lng);
                    setLocationUI(address, acc, 'Device GPS');

                    // Place you-are-here marker + accuracy circle on admin map
                    placeYouAreHereMarker(lat, lng, acc);

                    writeLog(`[GEOCODE] Address resolved: "${address}"`, "success");
                    resetGpsButton();
                },
                async (error) => {
                    // Fallback: simulated network triangulation jitter around Bengaluru
                    const jitterLat = 12.9716 + (Math.random() - 0.5) * 0.04;
                    const jitterLng = 77.5946 + (Math.random() - 0.5) * 0.04;
                    nextReportCoords = { lat: jitterLat, lng: jitterLng };
                    updateFormCoordinates();
                    flashGpsBox();

                    writeLog(`[GPS] Access denied (${error.message}). Falling back to simulated triangulation.`, "warn");
                    const address = await reverseGeocode(jitterLat, jitterLng);
                    setLocationUI(address, 350, 'Network Triangulation (fallback)');
                    placeYouAreHereMarker(jitterLat, jitterLng, 350);
                    writeLog(`[GEOCODE] Estimated address: "${address}"`, "warn");
                    resetGpsButton();
                },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
            );
        } else {
            const jitterLat = 12.9716 + (Math.random() - 0.5) * 0.04;
            const jitterLng = 77.5946 + (Math.random() - 0.5) * 0.04;
            nextReportCoords = { lat: jitterLat, lng: jitterLng };
            updateFormCoordinates();
            flashGpsBox();
            reverseGeocode(jitterLat, jitterLng).then(address => {
                setLocationUI(address, null, 'Simulated (no API)');
                placeYouAreHereMarker(jitterLat, jitterLng, null);
                writeLog(`[GEOCODE] Estimated address: "${address}"`, "warn");
            });
            writeLog("[GPS] Geolocation API not supported. Using simulated coordinates.", "warn");
            resetGpsButton();
        }
    });

    function resetGpsButton() {
        btnMockGps.disabled = false;
        btnMockGps.innerHTML = `<i class="fa-solid fa-location-crosshairs"></i> GPS`;
    }

    // Submit / Run AI Flow
    btnSubmitReport.addEventListener("click", async () => {
        const desc = document.getElementById("issue-description").value.trim();
        const severity = parseInt(document.getElementById("issue-severity-slider").value);
        const imgSrc = selectedImgPreview.src;

        const screenScanning = document.getElementById("screen-scanning");
        const scanningImg = document.getElementById("scanning-image-preview");

        scanningImg.src = imgSrc;
        screenDetails.classList.remove("active");
        screenScanning.classList.add("active");

        // For custom uploads, call the real ML classification backend
        if (selectedIssueType === "custom" && customImageFile) {
            writeLog("[ML] Sending image to real classification backend (YOLO → CLIP → Gemini)...", "system");
            try {
                const formData = new FormData();
                formData.append("file", customImageFile);

                const response = await fetch(CLASSIFY_API_URL, {
                    method: "POST",
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`Server returned ${response.status}`);
                }

                const result = await response.json();
                console.log("[ML Classification Result]", result);
                writeLog(`[ML] Classification response: ${JSON.stringify(result)}`, "model");

                if (!result.isValid) {
                    // Not a valid grievance — abort the pipeline
                    writeLog(`[ML] Image rejected: ${result.reason}`, "warn");
                    screenScanning.classList.remove("active");
                    screenDetails.classList.add("active");
                    alert("Not a valid grievance: " + (result.reason || "Image was not recognized as a civic issue."));
                    return;
                }

                // Valid grievance — map the returned category to a selectedIssueType key
                const categoryMap = {
                    "Pothole": "pothole",
                    "Road Crack / Damaged Road": "road_crack",
                    "Trash Pile": "trash_pile",
                    "Overflowing Garbage Bin": "garbage_bin",
                    "Water Leakage": "water_leakage",
                    "Waterlogging / Flooded Road": "waterlogging",
                    "Blocked Drain": "blocked_drain",
                    "Sewage Overflow": "sewage_overflow",
                    "Open Manhole": "open_manhole",
                    "Streetlight Not Working": "streetlight_not_working",
                    "Fallen Tree / Large Branch": "fallen_tree",
                    "Stray Animal": "stray_animal",
                    "Illegal Dumping of Construction Debris": "illegal_dumping",
                    "Damaged Footpath / Sidewalk": "damaged_footpath",
                    "Encroachment / Obstruction on Road": "encroachment"
                };
                const mappedType = categoryMap[result.category];
                if (mappedType) {
                    selectedIssueType = mappedType;
                } else {
                    selectedIssueType = result.category || "pothole";
                }
                
                // Store ML classification telemetry
                lastMlSource = result.source;
                lastMlConfidence = result.confidence;

                writeLog(`[ML] Real classification: ${result.category} (${(result.confidence * 100).toFixed(1)}%) via ${result.source.toUpperCase()}`, "success");

            } catch (err) {
                // Backend unreachable — fall back to simulated keyword logic silently
                console.warn("[ML] Classification backend unreachable, falling back to simulation.", err);
                writeLog(`[ML] Backend unreachable (${err.message}). Falling back to simulated classification.`, "warn");
                selectedIssueType = "custom"; // keep as custom so the else block handles it
            }
        }

        // Trigger the processing pipeline (now with real or simulated category)
        runAIPipeline(imgSrc, desc, severity);
    });

    // Reset back to Screen 1
    btnResetSimulator.addEventListener("click", () => {
        document.getElementById("screen-success").classList.remove("active");
        screenHome.classList.add("active");
        lastMlSource = null;
        lastMlConfidence = null;
        writeLog("[SYSTEM] Simulator reset. Ready for next submission.", "system");
    });
}

// 5. SIMULATED MULTI-MODAL PIPELINE
function runAIPipeline(imgSrc, desc, userSeverity) {
    const progressBar = document.getElementById("scanner-progress");
    const phaseTitle = document.getElementById("scanner-phase-title");
    const logText = document.getElementById("scanner-log");

    progressBar.style.width = "0%";

    writeLog("--------------------------------------------------", "system");
    writeLog("[PIPELINE] Initiating Multi-Modal AI Decision Flow...", "system");

    // Determine category based on selection
    let predictedCategory = "Infrastructure";
    let department = "Department of Public Works";
    let baseUrgency = 50;

    if (selectedIssueType === "pothole" || selectedIssueType === "Pothole") {
        predictedCategory = "Pothole";
        department = "Department of Public Works";
        baseUrgency = 50;
    } else if (selectedIssueType === "road_crack" || selectedIssueType === "Road Crack / Damaged Road") {
        predictedCategory = "Road Crack / Damaged Road";
        department = "Department of Public Works";
        baseUrgency = 35;
    } else if (selectedIssueType === "trash_pile" || selectedIssueType === "Trash Pile" || selectedIssueType === "garbage") {
        predictedCategory = "Trash Pile";
        department = "Sanitation Board";
        baseUrgency = 30;
    } else if (selectedIssueType === "garbage_bin" || selectedIssueType === "Overflowing Garbage Bin") {
        predictedCategory = "Overflowing Garbage Bin";
        department = "Sanitation Board";
        baseUrgency = 35;
    } else if (selectedIssueType === "water_leakage" || selectedIssueType === "Water Leakage" || selectedIssueType === "water_leak") {
        predictedCategory = "Water Leakage";
        department = "Water Supply & Sewage Board";
        baseUrgency = 60;
    } else if (selectedIssueType === "waterlogging" || selectedIssueType === "Waterlogging / Flooded Road") {
        predictedCategory = "Waterlogging / Flooded Road";
        department = "Water Supply & Sewage Board";
        baseUrgency = 70;
    } else if (selectedIssueType === "blocked_drain" || selectedIssueType === "Blocked Drain") {
        predictedCategory = "Blocked Drain";
        department = "Water Supply & Sewage Board";
        baseUrgency = 55;
    } else if (selectedIssueType === "sewage_overflow" || selectedIssueType === "Sewage Overflow") {
        predictedCategory = "Sewage Overflow";
        department = "Water Supply & Sewage Board";
        baseUrgency = 80;
    } else if (selectedIssueType === "open_manhole" || selectedIssueType === "Open Manhole") {
        predictedCategory = "Open Manhole";
        department = "Department of Public Works";
        baseUrgency = 85;
    } else if (selectedIssueType === "streetlight_not_working" || selectedIssueType === "Streetlight Not Working" || selectedIssueType === "streetlight") {
        predictedCategory = "Streetlight Not Working";
        department = "Electricity Board";
        baseUrgency = 40;
    } else if (selectedIssueType === "fallen_tree" || selectedIssueType === "Fallen Tree / Large Branch") {
        predictedCategory = "Fallen Tree / Large Branch";
        department = "Forestry Department";
        baseUrgency = 65;
    } else if (selectedIssueType === "stray_animal" || selectedIssueType === "Stray Animal") {
        predictedCategory = "Stray Animal";
        department = "Animal Control Board";
        baseUrgency = 45;
    } else if (selectedIssueType === "illegal_dumping" || selectedIssueType === "Illegal Dumping of Construction Debris") {
        predictedCategory = "Illegal Dumping of Construction Debris";
        department = "Sanitation Board";
        baseUrgency = 50;
    } else if (selectedIssueType === "damaged_footpath" || selectedIssueType === "Damaged Footpath / Sidewalk") {
        predictedCategory = "Damaged Footpath / Sidewalk";
        department = "Department of Public Works";
        baseUrgency = 30;
    } else if (selectedIssueType === "encroachment" || selectedIssueType === "Encroachment / Obstruction on Road") {
        predictedCategory = "Encroachment / Obstruction on Road";
        department = "Traffic Management / Police";
        baseUrgency = 60;
    } else {
        // Fallback simulated NLP matching for other custom text description keywords
        const text = desc.toLowerCase();
        if (text.includes("light") || text.includes("dark") || text.includes("electric") || text.includes("wire")) {
            predictedCategory = "Streetlight Not Working";
            department = "Electricity Board";
            baseUrgency = 40;
        } else if (text.includes("trash") || text.includes("garbage") || text.includes("dump") || text.includes("smell") || text.includes("bin")) {
            predictedCategory = "Trash Pile";
            department = "Sanitation Board";
            baseUrgency = 30;
        } else if (text.includes("leak") || text.includes("flood") || text.includes("pipe") || text.includes("water")) {
            predictedCategory = "Water Leakage";
            department = "Water Supply & Sewage Board";
            baseUrgency = 60;
        } else if (text.includes("manhole")) {
            predictedCategory = "Open Manhole";
            department = "Department of Public Works";
            baseUrgency = 85;
        } else if (text.includes("tree") || text.includes("branch")) {
            predictedCategory = "Fallen Tree / Large Branch";
            department = "Forestry Department";
            baseUrgency = 65;
        } else if (text.includes("animal") || text.includes("dog") || text.includes("cow")) {
            predictedCategory = "Stray Animal";
            department = "Animal Control Board";
            baseUrgency = 45;
        } else if (text.includes("crack") || text.includes("road")) {
            predictedCategory = "Road Crack / Damaged Road";
            department = "Department of Public Works";
            baseUrgency = 35;
        } else {
            predictedCategory = "Pothole";
            department = "Department of Public Works";
            baseUrgency = 50;
        }
    }

    // Read Sandbox modifiers
    const weatherVal = document.getElementById("weather-val").textContent;
    const qualityVal = document.getElementById("quality-val").textContent;
    const occlusionVal = document.getElementById("occlusion-val").textContent;

    // Compute Urgency (Adaptive testing logic)
    let severityMod = userSeverity * 8; // Max 40
    let environmentMod = 0;

    // Weather increases urgency of road/light safety risks
    // Weather increases urgency of road/light safety risks
    const predCatLower = predictedCategory.toLowerCase();
    if (weatherVal === "Rain") {
        if (predCatLower.includes("pothole") || predCatLower.includes("crack") || predCatLower.includes("leak") || predCatLower.includes("flood") || predCatLower.includes("waterlogging") || predCatLower.includes("drain") || predCatLower.includes("manhole") || predCatLower.includes("sewage")) {
            environmentMod += 12;
        }
    } else if (weatherVal === "Night") {
        if (predCatLower.includes("streetlight") || predCatLower.includes("pothole") || predCatLower.includes("manhole") || predCatLower.includes("waterlogging") || predCatLower.includes("flood")) {
            environmentMod += 16;
        }
    } else if (weatherVal === "Dense Fog") {
        environmentMod += 10;
    }

    let finalUrgency = Math.min(98, Math.max(15, baseUrgency + severityMod + environmentMod));

    // Pipeline speed (simulated with standard baseline + noise adjustments)
    let baseCnnLat = 120;
    if (qualityVal === "HD (1080p)") baseCnnLat = 110;
    if (qualityVal === "Low (480p)") baseCnnLat = 135;
    if (qualityVal === "Blurry/Occluded") baseCnnLat = 165; // Pre-processing filter active

    if (weatherVal === "Rain" || weatherVal === "Dense Fog") baseCnnLat += 20; // Denoising filter latency

    let totalLatency = baseCnnLat + 42 + 20; // CNN + NLP + Route

    // Timeline steps for progress bar
    setTimeout(() => {
        progressBar.style.width = "25%";
        phaseTitle.textContent = "Phase 1: Ingestion & EXIF Parsing";
        logText.textContent = "Extracting coordinates, payload verification, EXIF telemetry sanitization...";

        writeLog("[PHASE 1] Multi-modal payload ingested. Image size parsed, metadata sanitized.", "input");
        writeLog(`[GPS] Location coordinates bind: [${nextReportCoords.lat.toFixed(6)}, ${nextReportCoords.lng.toFixed(6)}]`, "input");
    }, 600);

    setTimeout(() => {
        progressBar.style.width = "55%";
        const sourceLabel = lastMlSource ? lastMlSource.toUpperCase() : "CNN";
        phaseTitle.textContent = `Phase 2: ${sourceLabel} Image Classification`;
        logText.textContent = `Running ${sourceLabel === "CNN" ? "MobileNet" : sourceLabel} inference layers. Identifying core urban defect class...`;

        // Calculate simulated confidence or use real ML confidence
        let confidence;
        if (lastMlSource && lastMlConfidence !== null) {
            confidence = Math.round(lastMlConfidence * 100);
        } else {
            let confidenceBase = 96;
            if (qualityVal === "Low (480p)") confidenceBase -= 6;
            if (qualityVal === "Blurry/Occluded") confidenceBase -= 18;
            if (weatherVal === "Rain") confidenceBase -= 4;
            if (weatherVal === "Night") confidenceBase -= 6;
            if (weatherVal === "Dense Fog") confidenceBase -= 12;
            if (occlusionVal === "Partial") confidenceBase -= 8;
            if (occlusionVal === "Heavy") confidenceBase -= 22;
            confidence = Math.max(42, confidenceBase + Math.floor(Math.random() * 3));
        }

        writeLog(`[${sourceLabel}] Model predicted Category: ${predictedCategory.toUpperCase()} (Confidence: ${confidence}%)`, "model");
        writeLog(`[${sourceLabel}] Forward pass latency: ${baseCnnLat}ms. Denoising/De-blur filters: ACTIVE`, "model");
    }, 1200);

    setTimeout(() => {
        progressBar.style.width = "80%";
        phaseTitle.textContent = "Phase 3: NLP Urgency Computation";
        logText.textContent = "Analyzing description tokens. Calculating safety & adaptive weights...";

        // NLP sentiment logs
        writeLog(`[NLP] Tokenized description: "${desc || "No description provided by citizen"}"`, "model");
        let threatTokens = [];
        const text = desc.toLowerCase();
        if (text.includes("danger") || text.includes("accident") || text.includes("hospital") || text.includes("school") || text.includes("risk")) {
            threatTokens.push("safety_hazard");
            writeLog(`[NLP] Identified high-priority token weight multiplier (+8)`, "warn");
        }

        writeLog(`[DECISION] Formula: Urgency = (Base: ${baseUrgency}) + (UserSev: ${severityMod}) + (EnvFactor: ${environmentMod})`, "model");
        writeLog(`[DECISION] Computed Urgency Index: ${finalUrgency}/100 (Severity Code: Priority_${finalUrgency > 80 ? "CRITICAL" : finalUrgency > 50 ? "HIGH" : "STANDARD"})`, "model");
    }, 1800);

    setTimeout(async () => {
        progressBar.style.width = "100%";
        phaseTitle.textContent = "Phase 4: Automated Routing Matrix";
        logText.textContent = "Database insert queueing. Sending routed API webhook...";

        // Generate dynamic ticket ID
        const ticketNum = Math.floor(10000 + Math.random() * 90000);
        const ticketId = `GRV-${ticketNum}`;

        writeLog(`[ROUTING] Dynamic route assigned: ${department.toUpperCase()}`, "success");
        writeLog(`[ROUTING] Webhook dispatched to queue: API_ROUTE_POST_${department.replace(/\s+/g, '')}`, "success");
        writeLog(`[SUCCESS] Ticket ${ticketId} resolved into database state. Inference completed in ${totalLatency}ms.`, "success");

        // Save new ticket to in-memory state
        const newTicket = {
            id: ticketId,
            category: predictedCategory,
            urgency: finalUrgency,
            status: "pending",
            lat: nextReportCoords.lat,
            lng: nextReportCoords.lng,
            image: imgSrc,
            description: desc || `Citizen reported a ${predictedCategory.toLowerCase()} issue. Dynamic AI routed.`,
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
            department: department,
            severity: userSeverity
        };

        tickets.unshift(newTicket);

        // ── Supabase: upload image then persist ticket ──
        writeLog(`[SUPABASE] Uploading image to grievance-images bucket...`, "system");
        const imageUrl = await uploadImageToSupabase(imgSrc, ticketId);
        writeLog(`[SUPABASE] Image URL: ${imageUrl.substring(0, 60)}...`, "system");
        // Update local ticket image to the public URL
        newTicket.image = imageUrl;
        await saveTicketToSupabase(newTicket, imageUrl);

        // Update UI components
        updateDashboardMetrics();
        renderTicketsTable("all");
        if (typeof renderAdminPanelTable === "function") {
            renderAdminPanelTable();
        }
        updateCharts();
        addNewMarker(newTicket);

        // Set success screen UI details
        document.getElementById("success-ticket-id").textContent = `#${ticketId}`;
        document.getElementById("success-category").textContent = predictedCategory;

        let priorityLabel = "Low";
        if (finalUrgency > 80) priorityLabel = "Critical";
        else if (finalUrgency > 50) priorityLabel = "High";
        else if (finalUrgency > 30) priorityLabel = "Medium";

        document.getElementById("success-priority").textContent = `${priorityLabel} (${finalUrgency}/100)`;

        // Style success priority badge
        const successPrioElement = document.getElementById("success-priority");
        successPrioElement.className = "value";
        if (finalUrgency > 80) successPrioElement.classList.add("priority-badge");
        else if (finalUrgency > 50) successPrioElement.style.color = "var(--color-warning)";
        else successPrioElement.style.color = "var(--color-info)";

        document.getElementById("success-department").textContent = department;
        document.getElementById("success-status").textContent = "Pending";

        // Telemetry speeds
        const sourceLabel = lastMlSource ? lastMlSource.toUpperCase() : "CNN";
        document.getElementById("telemetry-speed").textContent = `${totalLatency}ms`;
        document.getElementById("telemetry-path").textContent = `${sourceLabel} -> NLP -> BBMP_${department.split(' ')[0]}`;

        // Navigate to success screen
        document.getElementById("screen-scanning").classList.remove("active");
        document.getElementById("screen-success").classList.add("active");

    }, 2400);
}

// Write to Telemetry console
function writeLog(message, type = "info") {
    const consoleLogs = document.getElementById("console-logs");
    if (!consoleLogs) return;

    const div = document.createElement("div");
    div.className = `log-line ${type}`;
    div.textContent = message;
    consoleLogs.appendChild(div);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// 6. ADMIN COMMAND CENTER & LEAFLET MAP
function initAdminConsole() {
    // 6.1 Initialize Leaflet Map
    // Coordinates centered on Bengaluru
    map = L.map('grievance-map', {
        zoomControl: false,
        attributionControl: false
    }).setView([12.9716, 77.5946], 13);

    // Modern Dark Tile Map Layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
    }).addTo(map);

    // Zoom control at bottom right
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);

    // Populate Map markers
    tickets.forEach(ticket => {
        addNewMarker(ticket);
    });
    if (typeof renderAdminPanelTable === "function") {
        renderAdminPanelTable();
    }

    // Map Click: update coords, reverse geocode, place pin, flash citizen form
    map.on('click', async (e) => {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        nextReportCoords = { lat, lng };
        updateFormCoordinates();
        flashGpsBox();

        writeLog(`[MAP] Pinned custom coordinate: [${lat.toFixed(5)}, ${lng.toFixed(5)}]`, "tip");

        // Reverse geocode the clicked point
        const address = await reverseGeocode(lat, lng);
        setLocationUI(address, null, 'Map Pin (manual)');
        writeLog(`[GEOCODE] Map pin address: "${address}"`, "tip");

        // Place a visual pin marker for the selected location
        placeYouAreHereMarker(lat, lng, null);

        // Flash the map-hint bar briefly
        const hintEl = document.querySelector('.map-hint');
        if (hintEl) {
            hintEl.textContent = `Pinned: ${address.split(',')[0]}`;
            hintEl.style.color = 'var(--primary)';
            hintEl.style.borderColor = 'var(--primary)';
            setTimeout(() => {
                hintEl.textContent = 'Click map to set custom coordinates for next citizen report';
                hintEl.style.color = '';
                hintEl.style.borderColor = '';
            }, 3500);
        }
    });

    // 6.2 Filter Controls Table
    const filterButtons = document.querySelectorAll(".btn-filter");
    filterButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            filterButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const filterValue = btn.getAttribute("data-filter");
            renderTicketsTable(filterValue);
            writeLog(`[ADMIN] Filtered ticket feed: ${filterValue.toUpperCase()}`, "system");
        });
    });

    // 6.3 Admin Panel Filter Controls
    const adminFilterButtons = document.querySelectorAll(".btn-filter-admin");
    adminFilterButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            adminFilterButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const filterValue = btn.getAttribute("data-filter");
            currentAdminFilter = filterValue;
            renderAdminPanelTable();
            writeLog(`[ADMIN PORTAL] Filtered Admin feed: ${filterValue.toUpperCase()}`, "system");
        });
    });
}

function getMarkerColor(urgency, status) {
    if (status === "resolved") return "var(--color-success)";
    if (urgency > 80) return "var(--color-danger)";
    if (urgency > 50) return "var(--color-warning)";
    return "var(--color-info)";
}

function addNewMarker(ticket) {
    const color = getMarkerColor(ticket.urgency, ticket.status);

    const marker = L.circleMarker([ticket.lat, ticket.lng], {
        radius: 9,
        fillColor: color,
        color: '#ffffff',
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.95
    }).addTo(map);

    // Custom popup
    const popupContent = `
        <div class="map-popup-card">
            <h4>${ticket.category} Ticket</h4>
            <img src="${ticket.image}" alt="Grievance">
            <p>${ticket.description.substring(0, 50)}...</p>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                <span class="urgency-lbl">Urgency: ${ticket.urgency}/100</span>
                <span style="font-size:9px; background:rgba(255,255,255,0.06); padding:1px 4px; border-radius:2px; text-transform:uppercase; color:${color}; font-weight:bold;">${ticket.status}</span>
            </div>
        </div>
    `;

    marker.bindPopup(popupContent);

    // Store reference to update later
    markersGroup.push({
        id: ticket.id,
        markerObj: marker
    });
}

function updateMarkerStatus(id, newStatus, urgency) {
    const item = markersGroup.find(m => m.id === id);
    if (item) {
        const color = getMarkerColor(urgency, newStatus);
        item.markerObj.setStyle({
            fillColor: color
        });

        // Update popup content
        const ticket = tickets.find(t => t.id === id);
        if (ticket) {
            const popupContent = `
                <div class="map-popup-card">
                    <h4>${ticket.category} Ticket</h4>
                    <img src="${ticket.image}" alt="Grievance">
                    <p>${ticket.description.substring(0, 50)}...</p>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                        <span class="urgency-lbl">Urgency: ${ticket.urgency}/100</span>
                        <span style="font-size:9px; background:rgba(255,255,255,0.06); padding:1px 4px; border-radius:2px; text-transform:uppercase; color:${color}; font-weight:bold;">${newStatus}</span>
                    </div>
                </div>
            `;
            item.markerObj.setPopupContent(popupContent);
        }
    }
}

// 7. RENDERING TABLES & METRICS
function updateDashboardMetrics() {
    const total = tickets.length;
    const critical = tickets.filter(t => t.urgency > 80 && t.status !== "resolved").length;
    const dispatched = tickets.filter(t => t.status === "dispatched").length;
    const resolved = tickets.filter(t => t.status === "resolved").length;

    document.getElementById("metric-total").textContent = total;
    document.getElementById("metric-critical").textContent = critical;
    document.getElementById("metric-dispatched").textContent = dispatched;
    document.getElementById("metric-resolved").textContent = resolved;
}

function renderTicketsTable(filter = "all") {
    const tbody = document.getElementById("tickets-table-body");
    tbody.innerHTML = "";

    let filteredTickets = tickets;

    if (filter === "critical") {
        filteredTickets = tickets.filter(t => t.urgency > 80);
    } else if (filter === "public-works") {
        filteredTickets = tickets.filter(t => t.department.includes("Public Works"));
    } else if (filter === "sanitation") {
        filteredTickets = tickets.filter(t => t.department.includes("Sanitation"));
    } else if (filter === "electricity") {
        filteredTickets = tickets.filter(t => t.department.includes("Electricity"));
    }

    if (filteredTickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-secondary); padding: 30px;">No tickets found matching this filter.</td></tr>`;
        return;
    }

    filteredTickets.forEach(t => {
        const tr = document.createElement("tr");

        let urgencyColor = "var(--color-info)";
        if (t.urgency > 80) urgencyColor = "var(--color-danger)";
        else if (t.urgency > 50) urgencyColor = "var(--color-warning)";

        tr.innerHTML = `
            <td class="tbl-ticket-id">${t.id}</td>
            <td>
                <div class="tbl-img-thumb">
                    <img src="${t.image}" alt="Thumb">
                </div>
            </td>
            <td><span class="font-bold" style="color:#fff;">${t.category}</span></td>
            <td><span style="font-family:var(--font-mono); font-size:11px;">${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}</span></td>
            <td>
                <div class="tbl-urgency-cell">
                    <span class="tbl-urgency-val" style="color:${urgencyColor}">${t.urgency}</span>
                    <div class="tbl-urgency-bar">
                        <div class="tbl-urgency-bar-fill" style="width: ${t.urgency}%; background-color: ${urgencyColor}"></div>
                    </div>
                </div>
            </td>
            <td><span class="dept-badge" style="font-weight: 500;">${t.department}</span></td>
            <td><span class="status-badge-table ${t.status}">${t.status}</span></td>
            <td><button class="btn-view-details" onclick="openTicketDetails('${t.id}')">Inspect</button></td>
        `;
        tbody.appendChild(tr);
    });
}

// Global hook to open details modal
window.openTicketDetails = function (id) {
    const ticket = tickets.find(t => t.id === id);
    if (!ticket) return;

    activeTicketId = id;

    document.getElementById("modal-ticket-id").textContent = `Inspect Ticket #${ticket.id}`;
    document.getElementById("modal-img").src = ticket.image;
    document.getElementById("modal-category").textContent = ticket.category;
    document.getElementById("modal-timestamp").textContent = ticket.timestamp;
    document.getElementById("modal-coords").textContent = `${ticket.lat.toFixed(5)}, ${ticket.lng.toFixed(5)}`;

    document.getElementById("modal-urgency").textContent = `${ticket.urgency}/100`;
    document.getElementById("modal-urgency-fill").style.width = `${ticket.urgency}%`;

    let urgencyColor = "var(--color-info)";
    if (ticket.urgency > 80) urgencyColor = "var(--color-danger)";
    else if (ticket.urgency > 50) urgencyColor = "var(--color-warning)";
    document.getElementById("modal-urgency-fill").style.backgroundColor = urgencyColor;

    document.getElementById("modal-desc").textContent = `"${ticket.description}"`;
    document.getElementById("modal-department").textContent = ticket.department;
    document.getElementById("modal-status").textContent = ticket.status;

    // Style status in modal
    const modalStatusEl = document.getElementById("modal-status");
    modalStatusEl.className = "info-value status-badge";
    modalStatusEl.classList.add(ticket.status);

    // Enable/disable modal action buttons depending on current status
    const dispatchBtn = document.getElementById("btn-modal-dispatch");
    const resolveBtn = document.getElementById("btn-modal-resolve");

    if (ticket.status === "resolved") {
        dispatchBtn.style.display = "none";
        resolveBtn.style.display = "none";
    } else if (ticket.status === "dispatched") {
        dispatchBtn.style.display = "none";
        resolveBtn.style.display = "block";
    } else {
        dispatchBtn.style.display = "block";
        resolveBtn.style.display = "block";
    }

    document.getElementById("ticket-modal").classList.add("active");
};

// 8. CHART UTILITIES
function updateCharts() {
    // 8.1 Department Distribution Calculation
    let deptCounts = {
        "Public Works": 0,
        "Sanitation": 0,
        "Electricity": 0,
        "Water Supply": 0
    };

    tickets.forEach(t => {
        if (t.department.includes("Public Works")) deptCounts["Public Works"]++;
        else if (t.department.includes("Sanitation")) deptCounts["Sanitation"]++;
        else if (t.department.includes("Electricity")) deptCounts["Electricity"]++;
        else if (t.department.includes("Water Supply")) deptCounts["Water Supply"]++;
    });

    const deptData = [
        deptCounts["Public Works"],
        deptCounts["Sanitation"],
        deptCounts["Electricity"],
        deptCounts["Water Supply"]
    ];

    if (deptChartInstance) {
        deptChartInstance.data.datasets[0].data = deptData;
        deptChartInstance.update();
    } else {
        const ctx = document.getElementById('deptChart').getContext('2d');
        deptChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Public Works', 'Sanitation', 'Electricity', 'Water Supply'],
                datasets: [{
                    data: deptData,
                    backgroundColor: [
                        '#7f00ff', // Purple
                        '#ff9f43', // Orange
                        '#00f2fe', // Cyan
                        '#1e90ff'  // Blue
                    ],
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.08)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#8e9bb3',
                            font: { size: 10, family: 'Inter' },
                            boxWidth: 10
                        }
                    }
                },
                cutout: '65%'
            }
        });
    }

    // 8.2 Priority Bands Calculation
    let priorityBands = { low: 0, med: 0, high: 0 };
    tickets.forEach(t => {
        if (t.urgency > 80) priorityBands.high++;
        else if (t.urgency > 50) priorityBands.med++;
        else priorityBands.low++;
    });

    const priorityData = [priorityBands.low, priorityBands.med, priorityBands.high];

    if (priorityChartInstance) {
        priorityChartInstance.data.datasets[0].data = priorityData;
        priorityChartInstance.update();
    } else {
        const ctx2 = document.getElementById('priorityChart').getContext('2d');
        priorityChartInstance = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: ['Low (<50)', 'Med (50-80)', 'High (>80)'],
                datasets: [{
                    label: 'Tickets count',
                    data: priorityData,
                    backgroundColor: [
                        'rgba(30, 144, 255, 0.45)',
                        'rgba(255, 165, 2, 0.45)',
                        'rgba(255, 71, 87, 0.45)'
                    ],
                    borderColor: [
                        '#1e90ff',
                        '#ffa502',
                        '#ff4757'
                    ],
                    borderWidth: 1.5,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#8e9bb3', font: { size: 10 } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#8e9bb3', font: { size: 10 }, stepSize: 1 }
                    }
                }
            }
        });
    }
}

// 9. MODAL STATE SHEET
function initModal() {
    const modal = document.getElementById("ticket-modal");
    const closeBtn = document.getElementById("btn-close-modal");
    const dispatchBtn = document.getElementById("btn-modal-dispatch");
    const resolveBtn = document.getElementById("btn-modal-resolve");

    // Close modal
    closeBtn.addEventListener("click", () => {
        modal.classList.remove("active");
    });

    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.remove("active");
        }
    });

    // Dispatch service action
    dispatchBtn.addEventListener("click", async () => {
        if (!activeTicketId) return;

        const ticketIndex = tickets.findIndex(t => t.id === activeTicketId);
        if (ticketIndex !== -1) {
            tickets[ticketIndex].status = "dispatched";

            // Log Action
            writeLog(`[DISPATCH] Service truck dispatched for ticket ${activeTicketId} (${tickets[ticketIndex].category}).`, "warn");

            // Persist to Supabase
            await updateTicketStatusInSupabase(activeTicketId, "dispatched");

            // Updates
            updateDashboardMetrics();
            renderTicketsTable("all");
            if (typeof renderAdminPanelTable === "function") {
                renderAdminPanelTable();
            }
            updateCharts();
            updateMarkerStatus(activeTicketId, "dispatched", tickets[ticketIndex].urgency);
        }
        modal.classList.remove("active");
    });

    // Resolve ticket action
    resolveBtn.addEventListener("click", async () => {
        if (!activeTicketId) return;

        const ticketIndex = tickets.findIndex(t => t.id === activeTicketId);
        if (ticketIndex !== -1) {
            tickets[ticketIndex].status = "resolved";

            // Log Action
            writeLog(`[RESOLVE] Ticket ${activeTicketId} marked as RESOLVED by administrator. Outbox cleared.`, "success");

            // Persist to Supabase
            await updateTicketStatusInSupabase(activeTicketId, "resolved");

            // Updates
            updateDashboardMetrics();
            renderTicketsTable("all");
            if (typeof renderAdminPanelTable === "function") {
                renderAdminPanelTable();
            }
            updateCharts();
            updateMarkerStatus(activeTicketId, "resolved", tickets[ticketIndex].urgency);
        }
        modal.classList.remove("active");
    });
}

// 10. AI SANDBOX & STRESS TESTING CONTROLLERS
function initSandbox() {
    const weatherSlider = document.getElementById("weather-slider");
    const qualitySlider = document.getElementById("quality-slider");
    const occlusionSlider = document.getElementById("occlusion-slider");

    const weatherVal = document.getElementById("weather-val");
    const qualityVal = document.getElementById("quality-val");
    const occlusionVal = document.getElementById("occlusion-val");

    // Listeners
    weatherSlider.addEventListener("input", updateSandboxState);
    qualitySlider.addEventListener("input", updateSandboxState);
    occlusionSlider.addEventListener("input", updateSandboxState);

    // Initial evaluation
    updateSandboxState();
}

function updateSandboxState() {
    const weatherValIdx = parseInt(document.getElementById("weather-slider").value);
    const qualityValIdx = parseInt(document.getElementById("quality-slider").value);
    const occlusionValIdx = parseInt(document.getElementById("occlusion-slider").value);

    const weatherVal = document.getElementById("weather-val");
    const qualityVal = document.getElementById("quality-val");
    const occlusionVal = document.getElementById("occlusion-val");

    // Step naming mappings
    const weatherNames = ["Clear Day", "Heavy Rain", "Night Setting", "Dense Fog"];
    const qualityNames = ["Blurry/Occluded", "Low (480p)", "HD (1080p)"];
    const occlusionNames = ["None", "Partial", "Heavy"];

    weatherVal.textContent = weatherNames[weatherValIdx - 1];
    qualityVal.textContent = qualityNames[qualityValIdx - 1];
    occlusionVal.textContent = occlusionNames[occlusionValIdx - 1];

    // Compute Simulated CNN Confidence Score
    let confidenceBase = 97;

    // Penalize confidence based on environmental noise
    if (qualityValIdx === 2) confidenceBase -= 6; // 480p
    if (qualityValIdx === 1) confidenceBase -= 18; // Blurry

    if (weatherValIdx === 2) confidenceBase -= 5;  // Rain
    if (weatherValIdx === 3) confidenceBase -= 8;  // Night
    if (weatherValIdx === 4) confidenceBase -= 14; // Fog

    if (occlusionValIdx === 2) confidenceBase -= 7;  // Partial
    if (occlusionValIdx === 3) confidenceBase -= 20; // Heavy

    // Add minor variance noise
    let computedConfidence = Math.max(38, Math.min(99, confidenceBase));

    // Update gauge text
    document.getElementById("accuracy-percentage").textContent = `${computedConfidence}%`;

    // Update SVG radial gauge circumference offset
    // Circumference = 2 * PI * r = 2 * 3.14159 * 50 = 314
    const accuracyGauge = document.getElementById("accuracy-gauge");
    const offset = 314 * (1 - computedConfidence / 100);
    accuracyGauge.style.strokeDashoffset = offset;

    // Style gauge color based on score
    if (computedConfidence > 85) {
        accuracyGauge.style.stroke = "var(--color-success)";
        document.getElementById("accuracy-percentage").style.color = "var(--color-success)";
    } else if (computedConfidence > 70) {
        accuracyGauge.style.stroke = "var(--color-warning)";
        document.getElementById("accuracy-percentage").style.color = "var(--color-warning)";
    } else {
        accuracyGauge.style.stroke = "var(--color-danger)";
        document.getElementById("accuracy-percentage").style.color = "var(--color-danger)";
    }

    // Compute pipeline latencies
    let cnnLatency = 110;
    if (qualityValIdx === 2) cnnLatency = 130;
    if (qualityValIdx === 1) cnnLatency = 160; // Blurry needs filter kernel pass

    if (weatherValIdx === 2 || weatherValIdx === 4) {
        cnnLatency += 20; // Denoising active
    }

    let nlpLatency = 42;
    let routingLatency = 18;

    let totalLatency = cnnLatency + nlpLatency + routingLatency;

    // Update Latency Labels in UI
    document.getElementById("sandbox-latency").textContent = `${totalLatency} ms`;
    document.getElementById("lat-cnn").textContent = `${cnnLatency}ms`;
    document.getElementById("lat-nlp").textContent = `${nlpLatency}ms`;
    document.getElementById("lat-route").textContent = `${routingLatency}ms`;

    // Update progress bars widths
    const maxBar = 240; // Simulated scale width mapping
    document.getElementById("bar-cnn").style.width = `${(cnnLatency / totalLatency) * 100}%`;
    document.getElementById("bar-nlp").style.width = `${(nlpLatency / totalLatency) * 100}%`;
    document.getElementById("bar-route").style.width = `${(routingLatency / totalLatency) * 100}%`;

    // Urgency modifier label
    let urgencyModifier = 0;
    if (weatherValIdx === 2) urgencyModifier += 12; // Rain
    if (weatherValIdx === 3) urgencyModifier += 16; // Night
    if (weatherValIdx === 4) urgencyModifier += 10; // Fog

    const modifierText = urgencyModifier > 0 ? `+${urgencyModifier} (Boost)` : "0.0 (None)";
    document.getElementById("sandbox-urgency-mod").textContent = modifierText;

    // System Log
    writeLog(`[SANDBOX] Parameters mutated. System Latency: ${totalLatency}ms | Confidence Level: ${computedConfidence}%`, "system");
}

// ─── Admin Panel Local Management ───────────────────────────────────────────

function removeMarkerFromMap(id) {
    const markerIdx = markersGroup.findIndex(m => m.id === id);
    if (markerIdx !== -1) {
        const markerObj = markersGroup[markerIdx].markerObj;
        map.removeLayer(markerObj);
        markersGroup.splice(markerIdx, 1);
        console.log(`Removed marker for ticket ${id} from map.`);
    }
}

function renderAdminPanelTable() {
    const tbody = document.getElementById("admin-panel-table-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    let filteredTickets = tickets.filter(t => t.status !== 'resolved');

    if (currentAdminFilter === "critical") {
        filteredTickets = filteredTickets.filter(t => t.urgency > 80);
    } else if (currentAdminFilter === "public-works") {
        filteredTickets = filteredTickets.filter(t => t.department.includes("Public Works"));
    } else if (currentAdminFilter === "sanitation") {
        filteredTickets = filteredTickets.filter(t => t.department.includes("Sanitation"));
    } else if (currentAdminFilter === "electricity") {
        filteredTickets = filteredTickets.filter(t => t.department.includes("Electricity"));
    }

    if (filteredTickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-secondary); padding: 30px;">No tickets found matching this filter.</td></tr>`;
        return;
    }

    filteredTickets.forEach(t => {
        const tr = document.createElement("tr");

        let urgencyColor = "var(--color-info)";
        if (t.urgency > 80) urgencyColor = "var(--color-danger)";
        else if (t.urgency > 50) urgencyColor = "var(--color-warning)";

        const isResolved = t.status === "resolved";

        tr.innerHTML = `
            <td class="tbl-ticket-id">${t.id}</td>
            <td>
                <div class="tbl-img-thumb">
                    <img src="${t.image}" alt="Thumb">
                </div>
            </td>
            <td><span class="font-bold" style="color:#fff;">${t.category}</span></td>
            <td><span style="font-family:var(--font-mono); font-size:11px;">${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}</span></td>
            <td>
                <div class="tbl-urgency-cell">
                    <span class="tbl-urgency-val" style="color:${urgencyColor}">${t.urgency}</span>
                    <div class="tbl-urgency-bar">
                        <div class="tbl-urgency-bar-fill" style="width: ${t.urgency}%; background-color: ${urgencyColor}"></div>
                    </div>
                </div>
            </td>
            <td><span class="dept-badge" style="font-weight: 500;">${t.department}</span></td>
            <td><span class="status-badge-table ${t.status}">${t.status}</span></td>
            <td>
                <div style="display:flex; gap:6px;">
                    <button class="btn-view-details" onclick="openTicketDetails('${t.id}')">Inspect</button>
                    <button class="btn-view-details resolve-btn" onclick="resolveTicketAdmin('${t.id}')">Resolve</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Resolve ticket from Admin Portal — marks resolved in DB + Tickets (live feed), removes from Admin Portal
window.resolveTicketAdmin = async function(id) {
    const ticketIndex = tickets.findIndex(t => t.id === id);
    if (ticketIndex === -1) return;

    // 1. Update local status
    tickets[ticketIndex].status = 'resolved';
    writeLog(`[RESOLVE] Ticket ${id} marked RESOLVED by administrator.`, 'success');

    // 2. Persist status change to Supabase
    await updateTicketStatusInSupabase(id, 'resolved');

    // 3. Update map marker colour to resolved (green)
    updateMarkerStatus(id, 'resolved', tickets[ticketIndex].urgency);

    // 4. Re-render Admin Portal (resolved tickets are now filtered out — ticket disappears here)
    renderAdminPanelTable();

    // 5. Re-render Tickets (ticket stays, status badge shows resolved)
    updateDashboardMetrics();
    renderTicketsTable('all');
    updateCharts();
};
