// script.js – frontend map & tracking logic
const map = L.map('map').setView([20.5937, 78.9629], 5);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM & CartoDB'
}).addTo(map);

let isTracking = false;
let watchId = null;
let trackPoints = [];
let stopsList = [];
let startTime = null;
let timerInterval = null;
let potentialStopPos = null;
let stopFlagActive = false;
let lastRecordedStopPoint = null;
let routePolyline = null;
let stopMarkersGroup = L.layerGroup().addTo(map);
let currentLocationMarker = null;

function getDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lng2-lng1) * Math.PI/180;
    const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function updateTimerDisplay() {
    if (!startTime || !isTracking) return;
    const elapsed = Date.now() - startTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    document.getElementById('timerDisplay').innerText = 
        `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
}

function updateRouteVisual() {
    if (routePolyline) map.removeLayer(routePolyline);
    if (trackPoints.length < 2) return;
    const latlngs = trackPoints.map(p => [p.lat, p.lng]);
    routePolyline = L.polyline(latlngs, { color: '#2563eb', weight: 5 }).addTo(map);
    map.fitBounds(routePolyline.getBounds(), { padding: [30,30] });
}

function updateStopMarkers() {
    stopMarkersGroup.clearLayers();
    stopsList.forEach(stop => {
        const icon = L.divIcon({
            html: '<i class="fas fa-stop-circle" style="font-size:28px; color:#e67e22;"></i>',
            iconSize: [28,28]
        });
        L.marker([stop.lat, stop.lng], { icon }).addTo(stopMarkersGroup)
            .bindPopup(`Stop at ${new Date(stop.timestamp).toLocaleTimeString()}`);
    });
}

function addStopPoint(lat, lng, timestamp) {
    const exists = stopsList.some(s => getDistanceMeters(s.lat, s.lng, lat, lng) < 5);
    if (!exists) {
        stopsList.push({ lat, lng, timestamp: timestamp || Date.now() });
        updateStopMarkers();
    }
}

function resetTrackingUI(resetPoints = true) {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (timerInterval) clearInterval(timerInterval);
    isTracking = false;
    if (resetPoints) {
        trackPoints = [];
        stopsList = [];
        if (routePolyline) map.removeLayer(routePolyline);
        routePolyline = null;
        stopMarkersGroup.clearLayers();
    }
    if (currentLocationMarker) map.removeLayer(currentLocationMarker);
    potentialStopPos = null;
    stopFlagActive = false;
    lastRecordedStopPoint = null;
    startTime = null;
    document.getElementById('timerDisplay').innerText = '00:00:00';
}

async function saveCurrentRoute() {
    if (!trackPoints.length) {
        alert("No route data to save.");
        return false;
    }
    const routeData = {
        startTime: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
        endTime: new Date().toISOString(),
        points: trackPoints,
        stops: stopsList
    };
    try {
        const res = await fetch('/api/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(routeData)
        });
        if (res.ok) {
            await loadHistoryList();
            return true;
        } else {
            alert("Save failed");
            return false;
        }
    } catch (err) {
        alert("Network error");
        return false;
    }
}

async function loadHistoryList() {
    try {
        const res = await fetch('/api/routes');
        if (!res.ok) throw new Error();
        const routes = await res.json();
        document.getElementById('routeCountBadge').innerText = `${routes.length} route${routes.length !== 1 ? 's' : ''}`;
        const historyList = document.getElementById('historyList');
        if (!routes.length) {
            historyList.innerHTML = '<li style="text-align:center;">No past routes.</li>';
            return;
        }
        historyList.innerHTML = '';
        routes.forEach(route => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div><b>Route #${route.id}</b></div>
                <div>${new Date(route.startTime).toLocaleString()} → ${new Date(route.endTime).toLocaleTimeString()}</div>
                <div><span class="badge-stop">${route.stopCount} stops</span> (${route.pointsCount} points)</div>
            `;
            li.onclick = () => viewFullRoute(route.id);
            historyList.appendChild(li);
        });
    } catch (err) {
        console.error(err);
    }
}

async function viewFullRoute(routeId) {
    if (isTracking) {
        alert("Stop tracking first.");
        return;
    }
    try {
        const res = await fetch(`/api/routes/${routeId}`);
        if (!res.ok) throw new Error();
        const route = await res.json();
        if (routePolyline) map.removeLayer(routePolyline);
        stopMarkersGroup.clearLayers();
        if (route.points.length > 1) {
            const latlngs = route.points.map(p => [p.lat, p.lng]);
            routePolyline = L.polyline(latlngs, { color: '#9b59b6', weight: 5, dashArray: '8,8' }).addTo(map);
            map.fitBounds(routePolyline.getBounds(), { padding: [30,30] });
        }
        route.stops.forEach(stop => {
            const icon = L.divIcon({
                html: '<i class="fas fa-stop-circle" style="font-size:28px; color:#d35400;"></i>',
                iconSize: [28,28]
            });
            L.marker([stop.lat, stop.lng], { icon }).addTo(stopMarkersGroup).bindPopup("Historic stop");
        });
    } catch (err) {
        alert("Failed to load route");
    }
}

function onLocationUpdate(position) {
    if (!isTracking) return;
    const { latitude, longitude } = position.coords;
    const now = Date.now();
    trackPoints.push({ lat: latitude, lng: longitude, timestamp: now });
    if (currentLocationMarker) map.removeLayer(currentLocationMarker);
    currentLocationMarker = L.marker([latitude, longitude], {
        icon: L.divIcon({ html: '<i class="fas fa-location-dot" style="font-size:22px; color:#1e88e5;"></i>', iconSize: [22,22] })
    }).addTo(map);
    updateRouteVisual();

    // Stop detection (1 minute stationary within 12 meters)
    if (!stopFlagActive) {
        if (!potentialStopPos) {
            potentialStopPos = { lat: latitude, lng: longitude, startTime: now };
        } else if (getDistanceMeters(potentialStopPos.lat, potentialStopPos.lng, latitude, longitude) <= 12) {
            if (now - potentialStopPos.startTime >= 60000) {
                addStopPoint(potentialStopPos.lat, potentialStopPos.lng, potentialStopPos.startTime);
                stopFlagActive = true;
                lastRecordedStopPoint = { lat: potentialStopPos.lat, lng: potentialStopPos.lng };
                potentialStopPos = null;
            }
        } else {
            potentialStopPos = null;
        }
    } else if (lastRecordedStopPoint && getDistanceMeters(lastRecordedStopPoint.lat, lastRecordedStopPoint.lng, latitude, longitude) > 18) {
        stopFlagActive = false;
        lastRecordedStopPoint = null;
        potentialStopPos = null;
    }
}

function onLocationError(err) {
    alert("Location error: " + err.message);
}

function initNewSession() {
    resetTrackingUI(true);
    isTracking = true;
    startTime = Date.now();
    timerInterval = setInterval(updateTimerDisplay, 1000);
    watchId = navigator.geolocation.watchPosition(onLocationUpdate, onLocationError, {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000
    });
}

function startTracking() {
    if (isTracking) {
        if (confirm("Tracking in progress. Save current and start fresh?")) {
            stopTrackingAndSave().then(() => initNewSession());
        }
        return;
    }
    initNewSession();
}

async function stopTrackingAndSave() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (timerInterval) clearInterval(timerInterval);
    const saved = trackPoints.length ? await saveCurrentRoute() : false;
    resetTrackingUI(true);
    return saved;
}

async function onStop() {
    if (!isTracking && trackPoints.length === 0) {
        alert("No active tracking session.");
        return;
    }
    await stopTrackingAndSave();
    await loadHistoryList();
}

document.getElementById('startBtn').addEventListener('click', startTracking);
document.getElementById('stopBtn').addEventListener('click', onStop);
document.getElementById('refreshHistoryBtn').addEventListener('click', loadHistoryList);

loadHistoryList();
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => map.setView([pos.coords.latitude, pos.coords.longitude], 14), null, { timeout: 5000 });
}