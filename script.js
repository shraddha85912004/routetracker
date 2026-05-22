let map, isTracking = false, watchId = null, trackPoints = [], stopsList = [];
let startTime = null, timerInterval = null;
let potentialStopPos = null, stopFlagActive = false, lastRecordedStopPoint = null;
let routePolyline = null, stopMarkersGroup = null, currentLocationMarker = null;
let token = localStorage.getItem('token');
let scheduledStartTime = null, scheduledStopTime = null, scheduleCheckInterval = null;
let totalDistance = 0, lastLatLng = null;

const loginContainer = document.getElementById('loginContainer');
const appContainer = document.getElementById('app');
const loginError = document.getElementById('loginError');

function getDistanceMeters(lat1,lng1,lat2,lng2) {
  const R = 6371e3;
  const φ1 = lat1*Math.PI/180, φ2 = lat2*Math.PI/180;
  const Δφ = (lat2-lat1)*Math.PI/180, Δλ = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function updateTimerDisplay() {
  if (!startTime || !isTracking) return;
  const e = Date.now()-startTime;
  document.getElementById('timerDisplay').innerText =
    `${Math.floor(e/3600000).toString().padStart(2,'0')}:${Math.floor((e%3600000)/60000).toString().padStart(2,'0')}:${Math.floor((e%60000)/1000).toString().padStart(2,'0')}`;
}

function updateDistanceDisplay() {
  document.getElementById('distanceDisplay').innerText = `${(totalDistance/1000).toFixed(2)} km`;
}

function updateRouteVisual() {
  if (routePolyline) map.removeLayer(routePolyline);
  if (trackPoints.length<2) return;
  routePolyline = L.polyline(trackPoints.map(p=>[p.lat,p.lng]), {color:'#2563eb', weight:5}).addTo(map);
  map.fitBounds(routePolyline.getBounds(), {padding:[30,30]});
}

function updateStopMarkers() {
  if (!stopMarkersGroup) return;
  stopMarkersGroup.clearLayers();
  stopsList.forEach(s=>{
    const icon = L.divIcon({html:'<i class="fas fa-stop-circle" style="font-size:28px; color:#e67e22;"></i>', iconSize:[28,28]});
    L.marker([s.lat,s.lng],{icon}).addTo(stopMarkersGroup).bindPopup(`Stop at ${new Date(s.timestamp).toLocaleTimeString()}`);
  });
}

function addStopPoint(lat,lng,ts) {
  if (!stopsList.some(s=>getDistanceMeters(s.lat,s.lng,lat,lng)<5)) {
    stopsList.push({lat,lng,timestamp:ts||Date.now()});
    updateStopMarkers();
  }
}

function resetTrackingUI(resetPoints=true) {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  if (timerInterval) clearInterval(timerInterval);
  isTracking = false;
  if (resetPoints) {
    trackPoints = []; stopsList = []; totalDistance = 0; lastLatLng = null;
    updateDistanceDisplay();
    if (routePolyline) map.removeLayer(routePolyline);
    routePolyline = null;
    if (stopMarkersGroup) stopMarkersGroup.clearLayers();
  }
  if (currentLocationMarker) map.removeLayer(currentLocationMarker);
  potentialStopPos = null; stopFlagActive = false; lastRecordedStopPoint = null;
  startTime = null;
  document.getElementById('timerDisplay').innerText = '00:00:00';
}

async function saveCurrentRoute() {
  if (!trackPoints.length) return false;
  const routeData = {
    startTime: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
    endTime: new Date().toISOString(),
    points: trackPoints,
    stops: stopsList,
    totalDistanceKm: totalDistance / 1000   // store km
  };
  try {
    const res = await fetch('/api/routes', {
      method:'POST',
      headers:{'Content-Type':'application/json', 'Authorization':`Bearer ${token}`},
      body:JSON.stringify(routeData)
    });
    if (res.ok) { await loadHistoryList(); return true; }
    else { const err = await res.json(); alert("Save failed: "+err.error); return false; }
  } catch(e) { alert("Network error"); return false; }
}

async function loadHistoryList() {
  if (!token) return;
  try {
    const res = await fetch('/api/routes', {headers:{'Authorization':`Bearer ${token}`}});
    if (!res.ok) throw new Error();
    const routes = await res.json();
    document.getElementById('routeCountBadge').innerText = `${routes.length} route${routes.length!==1?'s':''}`;
    const historyList = document.getElementById('historyList');
    if (!routes.length) { historyList.innerHTML = '<li>No past routes.</li>'; return; }
    historyList.innerHTML = '';
    routes.forEach(r=>{
      const li = document.createElement('li');
      li.innerHTML = `
        <div style="display:flex; justify-content:space-between;">
          <b>Route #${r.id}</b>
          <button class="delete-btn" data-id="${r.id}" style="background:#e74c3c; border:none; color:white; border-radius:20px; padding:4px 10px;">Delete</button>
        </div>
        <div>${new Date(r.startTime).toLocaleString()} → ${new Date(r.endTime).toLocaleTimeString()}</div>
        <div><span class="badge-stop">${r.stopCount} stops</span> (${r.pointsCount} points) – ${r.totalDistanceKm?.toFixed(2) || '0.00'} km</div>`;
      const del = li.querySelector('.delete-btn');
      del.onclick = (e)=>{e.stopPropagation(); deleteRoute(r.id);};
      li.onclick = ()=>viewFullRoute(r.id);
      historyList.appendChild(li);
    });
  } catch(e) { console.error(e); }
}

async function deleteRoute(id) {
  if (!confirm('Delete permanently?')) return;
  const res = await fetch(`/api/routes/${id}`, {method:'DELETE', headers:{'Authorization':`Bearer ${token}`}});
  if (res.ok) {
    await loadHistoryList();
    if (routePolyline) map.removeLayer(routePolyline);
    stopMarkersGroup.clearLayers();
    routePolyline = null;
  } else alert('Delete failed');
}

async function viewFullRoute(routeId) {
  if (isTracking) { alert("Stop tracking first"); return; }
  const res = await fetch(`/api/routes/${routeId}`, {headers:{'Authorization':`Bearer ${token}`}});
  if (!res.ok) return;
  const route = await res.json();
  if (routePolyline) map.removeLayer(routePolyline);
  stopMarkersGroup.clearLayers();
  if (currentLocationMarker) map.removeLayer(currentLocationMarker);
  if (route.points.length>1) {
    routePolyline = L.polyline(route.points.map(p=>[p.lat,p.lng]), {color:'#9b59b6', weight:5, dashArray:'8,8'}).addTo(map);
    map.fitBounds(routePolyline.getBounds());
  }
  // Add start marker (green)
  const startPoint = route.points[0];
  const greenIcon = L.divIcon({html:'<i class="fas fa-flag-checkered" style="font-size:28px; color:#2ecc71;"></i>', iconSize:[28,28]});
  L.marker([startPoint.lat, startPoint.lng], {icon: greenIcon}).addTo(stopMarkersGroup).bindPopup("Start");
  // Add end marker (red)
  const endPoint = route.points[route.points.length-1];
  const redIcon = L.divIcon({html:'<i class="fas fa-flag-checkered" style="font-size:28px; color:#e74c3c;"></i>', iconSize:[28,28]});
  L.marker([endPoint.lat, endPoint.lng], {icon: redIcon}).addTo(stopMarkersGroup).bindPopup("End");
  // Add stop markers (orange)
  route.stops.forEach(s=>{
    const icon = L.divIcon({html:'<i class="fas fa-stop-circle" style="font-size:28px; color:#e67e22;"></i>', iconSize:[28,28]});
    L.marker([s.lat,s.lng],{icon}).addTo(stopMarkersGroup).bindPopup(`Stop at ${new Date(s.timestamp).toLocaleTimeString()}`);
  });
}

function onLocationUpdate(pos) {
  if (!isTracking) return;
  const {latitude, longitude, accuracy} = pos.coords;
  const now = Date.now();

  // --- Filter 1: reject low-accuracy readings (GPS noise) ---
  if (accuracy > 30) return;

  // Always update the blue dot for real-time feel
  if (currentLocationMarker) map.removeLayer(currentLocationMarker);
  currentLocationMarker = L.marker([latitude,longitude], {icon:L.divIcon({html:'<i class="fas fa-location-dot" style="font-size:22px; color:#1e88e5;"></i>', iconSize:[22,22]})}).addTo(map);

  if (lastLatLng) {
    const dist = getDistanceMeters(lastLatLng.lat, lastLatLng.lng, latitude, longitude);
    const elapsed = (now - lastLatLng.timestamp) / 1000; // seconds

    // --- Filter 2: ignore jitter below 5 meters ---
    if (dist < 5) return;

    // --- Filter 3: reject teleports (> 200 km/h implies GPS glitch) ---
    if (elapsed > 0 && (dist / elapsed) > 55.56) return; // 55.56 m/s ≈ 200 km/h

    totalDistance += dist;
    updateDistanceDisplay();
  }

  trackPoints.push({lat:latitude, lng:longitude, timestamp:now});
  lastLatLng = {lat:latitude, lng:longitude, timestamp:now};
  updateRouteVisual();

  // Stop detection logic (unchanged)
  if (!stopFlagActive) {
    if (!potentialStopPos) potentialStopPos = {lat:latitude, lng:longitude, startTime:now};
    else if (getDistanceMeters(potentialStopPos.lat, potentialStopPos.lng, latitude, longitude) <= 12) {
      if (now - potentialStopPos.startTime >= 60000) {
        addStopPoint(potentialStopPos.lat, potentialStopPos.lng, potentialStopPos.startTime);
        stopFlagActive = true;
        lastRecordedStopPoint = {lat:potentialStopPos.lat, lng:potentialStopPos.lng};
        potentialStopPos = null;
      }
    } else potentialStopPos = null;
  } else if (lastRecordedStopPoint && getDistanceMeters(lastRecordedStopPoint.lat, lastRecordedStopPoint.lng, latitude, longitude) > 18) {
    stopFlagActive = false; lastRecordedStopPoint = null; potentialStopPos = null;
  }
}

function initNewSession() {
  resetTrackingUI(true);
  isTracking = true;
  startTime = Date.now();
  timerInterval = setInterval(updateTimerDisplay, 1000);
  watchId = navigator.geolocation.watchPosition(onLocationUpdate, e=>alert("Location error: "+e.message), {enableHighAccuracy:true, maximumAge:3000, timeout:15000});
}

async function stopTrackingAndSave() {
  if (!isTracking) return false;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  if (timerInterval) clearInterval(timerInterval);
  const saved = trackPoints.length ? await saveCurrentRoute() : false;
  resetTrackingUI(true);
  return saved;
}

// Helper to parse datetime-local string as local time
function parseLocalDateTime(dateTimeStr) {

  const [datePart, timePart] = dateTimeStr.split('T');

  const [year, month, day] = datePart.split('-').map(Number);

  const [hour, minute, second] = timePart.split(':').map(Number);

  return new Date(
    year,
    month - 1,
    day,
    hour,
    minute,
    second || 0
  );
}

function startScheduleWatcher() {

  // clear old interval if already running
  if (scheduleCheckInterval) {
    clearInterval(scheduleCheckInterval);
  }

  // prevents auto restarting after stop
  let scheduleCompleted = false;

  scheduleCheckInterval = setInterval(async () => {

    // if schedule inputs missing
    if (!scheduledStartTime || !scheduledStopTime) return;

    const now = new Date();

    const start = parseLocalDateTime(scheduledStartTime);
    const stop = parseLocalDateTime(scheduledStopTime);

    // ===== AUTO START =====
    if (
      now >= start &&
      now < stop &&
      !isTracking &&
      !scheduleCompleted
    ) {

      console.log("Auto-starting tracking");

      initNewSession();
    }

    // ===== AUTO STOP =====
    if (
      now >= stop &&
      isTracking
    ) {

      console.log("Auto-stopping tracking");

      await stopTrackingAndSave();

      // mark completed
      scheduleCompleted = true;

      // stop checking interval
      clearInterval(scheduleCheckInterval);

      scheduleCheckInterval = null;

      // OPTIONAL: clear inputs
      document.getElementById('scheduledStart').value = '';
      document.getElementById('scheduledStop').value = '';

      // OPTIONAL: reset stored times
      scheduledStartTime = null;
      scheduledStopTime = null;

      console.log("Schedule completed successfully");
    }

  }, 1000);
}

function initMap() {
  map = L.map('map').setView([20.5937,78.9629],5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {attribution:'&copy; OSM & CartoDB'}).addTo(map);
  stopMarkersGroup = L.layerGroup().addTo(map);
  setTimeout(()=>map.invalidateSize(),100);
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>map.setView([p.coords.latitude,p.coords.longitude],14), null, {timeout:5000});
  document.getElementById('refreshHistoryBtn').onclick = ()=>loadHistoryList();
}

document.getElementById('scheduleBtn').addEventListener('click', ()=>{
  const startVal = document.getElementById('scheduledStart').value;
  const stopVal = document.getElementById('scheduledStop').value;
  if (!startVal || !stopVal) { alert("Select both times"); return; }
  const startDate = parseLocalDateTime(startVal);
  const stopDate = parseLocalDateTime(stopVal);
  if (startDate >= stopDate) { alert("Start must be before stop"); return; }
  scheduledStartTime = startVal;
  scheduledStopTime = stopVal;
  startScheduleWatcher();
  alert(`Scheduled from ${startDate.toLocaleString()} to ${stopDate.toLocaleString()}`);
});

// ---------- AUTH (backend JWT) ----------
async function login() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) { loginError.innerText = "Enter credentials"; return; }
  try {
    const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
    if (res.ok) {
      const data = await res.json();
      token = data.token;
      localStorage.setItem('token', token);
      loginContainer.style.display = 'none';
      appContainer.style.display = 'flex';
      initMap();
      loadHistoryList();
    } else {
      const err = await res.json();
      loginError.innerText = err.error || "Login failed";
    }
  } catch(e) { loginError.innerText = "Network error"; }
}

async function register() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) { loginError.innerText = "Enter credentials"; return; }
  try {
    const res = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
    if (res.ok) {
      const data = await res.json();
      token = data.token;
      localStorage.setItem('token', token);
      loginContainer.style.display = 'none';
      appContainer.style.display = 'flex';
      initMap();
      loadHistoryList();
    } else {
      const err = await res.json();
      loginError.innerText = err.error || "Registration failed";
    }
  } catch(e) { loginError.innerText = "Network error"; }
}

document.getElementById('loginBtn').onclick = login;
document.getElementById('registerBtn').onclick = register;

if (token) {
  fetch('/api/routes', { headers:{'Authorization':`Bearer ${token}`} })
    .then(res => {
      if (res.ok) {
        loginContainer.style.display = 'none';
        appContainer.style.display = 'flex';
        initMap();
        loadHistoryList();
      } else { localStorage.removeItem('token'); loginContainer.style.display = 'flex'; }
    }).catch(()=>{ loginContainer.style.display = 'flex'; });
} else {
  loginContainer.style.display = 'flex';
}