// ../tr-api/shim/next-server.js
var NextResponse = {
  json(body, init = {}) {
    return new Response(JSON.stringify(body), { status: init.status || 200, headers: { "content-type": "application/json; charset=utf-8" } });
  }
};

// ../tr-build/lib/amap.ts
var AMAP_KEY = void 0;
var BASE = "https://restapi.amap.com/v3";
function hasAmapKey() {
  return Boolean(AMAP_KEY);
}
async function geocode(destination) {
  if (!AMAP_KEY) return null;
  const params = new URLSearchParams({
    key: AMAP_KEY,
    address: destination
  });
  const res = await fetch(`${BASE}/geocode/geo?${params}`, {
    next: { revalidate: 86400 }
  });
  if (!res.ok) return null;
  const data = await res.json();
  const loc = data?.geocodes?.[0]?.location;
  if (!loc) return null;
  const [lng, lat] = loc.split(",").map(Number);
  return { lng, lat };
}
function parsePoi(item, category) {
  const loc = item?.location;
  if (!loc) return null;
  const [lng, lat] = String(loc).split(",").map(Number);
  if (!isFinite(lng) || !isFinite(lat)) return null;
  return {
    id: String(item.id ?? `${lng},${lat}`),
    name: item.name,
    address: typeof item.address === "string" && item.address ? item.address : item.pname ? `${item.pname}${item.cityname ?? ""}${item.adname ?? ""}` : "",
    category,
    type: item.type,
    rating: item?.biz_ext?.rating || void 0,
    tel: typeof item.tel === "string" ? item.tel : void 0,
    lng,
    lat
  };
}
async function searchPoi(keywords, city, types, category, limit = 20) {
  if (!AMAP_KEY) return [];
  const params = new URLSearchParams({
    key: AMAP_KEY,
    keywords,
    city,
    citylimit: "true",
    types,
    offset: String(limit),
    page: "1",
    extensions: "all"
  });
  const res = await fetch(`${BASE}/place/text?${params}`, {
    next: { revalidate: 3600 }
  });
  if (!res.ok) return [];
  const data = await res.json();
  const pois = Array.isArray(data?.pois) ? data.pois : [];
  return pois.map((p) => parsePoi(p, category)).filter((p) => p !== null);
}
async function fetchAttractions(city) {
  return searchPoi("\u666F\u70B9", city, "110000|110100|110200", "attraction", 25);
}
async function fetchHotels(city) {
  return searchPoi("\u9152\u5E97", city, "100000|100100|100200", "hotel", 15);
}

// ../tr-build/lib/weather.ts
var WEATHER_CODE_MAP = {
  0: "\u6674",
  1: "\u6674\u95F4\u591A\u4E91",
  2: "\u591A\u4E91",
  3: "\u9634",
  45: "\u6709\u96FE",
  48: "\u96FE\u51C7",
  51: "\u6BDB\u6BDB\u96E8",
  53: "\u5C0F\u96E8",
  55: "\u4E2D\u96E8",
  56: "\u51BB\u6BDB\u6BDB\u96E8",
  57: "\u51BB\u96E8",
  61: "\u5C0F\u96E8",
  63: "\u4E2D\u96E8",
  65: "\u5927\u96E8",
  66: "\u51BB\u96E8",
  67: "\u5F3A\u51BB\u96E8",
  71: "\u5C0F\u96EA",
  73: "\u4E2D\u96EA",
  75: "\u5927\u96EA",
  77: "\u96EA\u7C92",
  80: "\u9635\u96E8",
  81: "\u5F3A\u9635\u96E8",
  82: "\u66B4\u96E8",
  85: "\u9635\u96EA",
  86: "\u5F3A\u9635\u96EA",
  95: "\u96F7\u9635\u96E8",
  96: "\u96F7\u9635\u96E8\u4F34\u51B0\u96F9",
  99: "\u5F3A\u96F7\u66B4\u4F34\u51B0\u96F9"
};
function describeWeather(code) {
  return WEATHER_CODE_MAP[code] ?? "\u672A\u77E5";
}
var WEEKDAYS = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"];
async function fetchWeather(center, startDate, endDate) {
  const params = new URLSearchParams({
    latitude: String(center.lat),
    longitude: String(center.lng),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
    timezone: "auto",
    start_date: startDate,
    end_date: endDate
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) return [];
  const data = await res.json();
  const daily = data?.daily;
  if (!daily?.time) return [];
  return daily.time.map((date, i) => {
    const code = daily.weather_code[i] ?? 0;
    const d = /* @__PURE__ */ new Date(date + "T00:00:00");
    return {
      date,
      weekday: WEEKDAYS[d.getDay()],
      tempMax: Math.round(daily.temperature_2m_max[i]),
      tempMin: Math.round(daily.temperature_2m_min[i]),
      precipitation: Math.round((daily.precipitation_sum[i] ?? 0) * 10) / 10,
      weatherCode: code,
      summary: describeWeather(code)
    };
  });
}

// ../tr-build/lib/route.ts
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function kMeans(points, k, iterations = 50) {
  if (k <= 1 || points.length <= k) {
    return splitEvenly(points, k);
  }
  let best = null;
  for (let restart = 0; restart < 8; restart++) {
    let centroids = initCentroids(points, k, restart);
    let assignments = new Array(points.length).fill(0);
    for (let iter = 0; iter < iterations; iter++) {
      let changed = false;
      for (let i = 0; i < points.length; i++) {
        let bestC = 0;
        let bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const d = sqDist(points[i], centroids[c]);
          if (d < bestD) {
            bestD = d;
            bestC = c;
          }
        }
        if (assignments[i] !== bestC) {
          assignments[i] = bestC;
          changed = true;
        }
      }
      const sums = Array.from({ length: k }, () => ({ lng: 0, lat: 0, n: 0 }));
      for (let i = 0; i < points.length; i++) {
        const c = assignments[i];
        sums[c].lng += points[i].lng;
        sums[c].lat += points[i].lat;
        sums[c].n += 1;
      }
      centroids = centroids.map(
        (old, c) => sums[c].n > 0 ? { lng: sums[c].lng / sums[c].n, lat: sums[c].lat / sums[c].n } : old
      );
      if (!changed) break;
    }
    const clusters = Array.from({ length: k }, () => []);
    points.forEach((p, i) => clusters[assignments[i]].push(p));
    let inertia = 0;
    points.forEach((p, i) => inertia += sqDist(p, centroids[assignments[i]]));
    if (!best || inertia < best.inertia) best = { clusters, inertia };
  }
  return balanceClusters(best.clusters, k);
}
function sqDist(a, b) {
  const dx = a.lng - b.lng;
  const dy = a.lat - b.lat;
  return dx * dx + dy * dy;
}
function initCentroids(points, k, seed) {
  const centroids = [];
  const first = points[(seed * 7 + 3) % points.length];
  centroids.push({ lng: first.lng, lat: first.lat });
  while (centroids.length < k) {
    let bestPoint = points[0];
    let bestMinDist = -1;
    for (const p of points) {
      let minD = Infinity;
      for (const c of centroids) minD = Math.min(minD, sqDist(p, c));
      if (minD > bestMinDist) {
        bestMinDist = minD;
        bestPoint = p;
      }
    }
    centroids.push({ lng: bestPoint.lng, lat: bestPoint.lat });
  }
  return centroids;
}
function splitEvenly(points, k) {
  const clusters = Array.from({ length: k }, () => []);
  points.forEach((p, i) => clusters[i % k].push(p));
  return clusters;
}
function balanceClusters(clusters, k) {
  const all = clusters.flat();
  const target = Math.ceil(all.length / k);
  const result = clusters.map((c) => [...c]);
  for (let guard = 0; guard < all.length; guard++) {
    const over = result.findIndex((c) => c.length > target);
    const under = result.findIndex((c) => c.length < Math.floor(all.length / k));
    if (over === -1 || under === -1) break;
    const centroidUnder = centroidOf(result[under].length ? result[under] : all);
    let idx = 0;
    let bestD = Infinity;
    result[over].forEach((p, i) => {
      const d = sqDist(p, centroidUnder);
      if (d < bestD) {
        bestD = d;
        idx = i;
      }
    });
    const [moved] = result[over].splice(idx, 1);
    result[under].push(moved);
  }
  return result;
}
function centroidOf(points) {
  const s = points.reduce(
    (acc, p) => ({ lng: acc.lng + p.lng, lat: acc.lat + p.lat }),
    { lng: 0, lat: 0 }
  );
  return { lng: s.lng / points.length, lat: s.lat / points.length };
}
function solveTsp(points, start) {
  if (points.length <= 2) return [...points];
  const remaining = [...points];
  const route = [];
  let currentPos = start ?? (() => {
    const c = centroidOf(points);
    let idx = 0;
    let bestD = Infinity;
    remaining.forEach((p, i) => {
      const d = sqDist(p, c);
      if (d < bestD) {
        bestD = d;
        idx = i;
      }
    });
    return remaining[idx];
  })();
  while (remaining.length) {
    let idx = 0;
    let bestD = Infinity;
    remaining.forEach((p, i) => {
      const d = sqDist(p, currentPos);
      if (d < bestD) {
        bestD = d;
        idx = i;
      }
    });
    const [next] = remaining.splice(idx, 1);
    route.push(next);
    currentPos = next;
  }
  return twoOpt(route);
}
function twoOpt(route) {
  let best = [...route];
  let improved = true;
  const dist = (a, b) => haversineKm(a, b);
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const a = best[i - 1];
        const b = best[i];
        const c = best[j];
        const d = best[j + 1];
        const before = (a ? dist(a, b) : 0) + (d ? dist(c, d) : 0);
        const after = (a ? dist(a, c) : 0) + (d ? dist(b, d) : 0);
        if (after + 1e-9 < before) {
          const segment = best.slice(i, j + 1).reverse();
          best = [...best.slice(0, i), ...segment, ...best.slice(j + 1)];
          improved = true;
        }
      }
    }
  }
  return best;
}
function routeDistanceKm(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineKm(points[i], points[i + 1]);
  }
  return Math.round(total * 10) / 10;
}

// ../tr-build/lib/mock.ts
var CITY_CENTERS = {
  \u5317\u4EAC: { lng: 116.407, lat: 39.904 },
  \u4E0A\u6D77: { lng: 121.473, lat: 31.23 },
  \u5E7F\u5DDE: { lng: 113.264, lat: 23.129 },
  \u6DF1\u5733: { lng: 114.057, lat: 22.543 },
  \u676D\u5DDE: { lng: 120.155, lat: 30.274 },
  \u6210\u90FD: { lng: 104.066, lat: 30.572 },
  \u897F\u5B89: { lng: 108.94, lat: 34.341 },
  \u5357\u4EAC: { lng: 118.796, lat: 32.06 },
  \u91CD\u5E86: { lng: 106.551, lat: 29.563 },
  \u53A6\u95E8: { lng: 118.089, lat: 24.48 },
  \u4E1C\u4EAC: { lng: 139.767, lat: 35.681 },
  \u5DF4\u9ECE: { lng: 2.352, lat: 48.857 }
};
function mockGeocode(destination) {
  for (const [name, center] of Object.entries(CITY_CENTERS)) {
    if (destination.includes(name)) return center;
  }
  return CITY_CENTERS["\u5317\u4EAC"];
}
var ATTRACTION_NAMES = [
  "\u5386\u53F2\u6587\u5316\u53E4\u57CE\u533A",
  "\u57CE\u5E02\u4E2D\u592E\u516C\u56ED",
  "\u6EE8\u6C5F\u89C2\u666F\u6B65\u9053",
  "\u5730\u6807\u89C2\u666F\u5854",
  "\u73B0\u4EE3\u827A\u672F\u535A\u7269\u9986",
  "\u8001\u57CE\u624B\u5DE5\u827A\u8857",
  "\u5C71\u9876\u89C2\u666F\u53F0",
  "\u7687\u5BB6\u56ED\u6797",
  "\u6E56\u7554\u98CE\u666F\u533A",
  "\u7F51\u7EA2\u7F8E\u98DF\u8857",
  "\u6D77\u6D0B\u4E3B\u9898\u9986",
  "\u53E4\u4EE3\u5BFA\u5E99\u7FA4",
  "\u57CE\u5E02\u690D\u7269\u56ED",
  "\u6C11\u4FD7\u98CE\u60C5\u6751",
  "\u591C\u666F\u706F\u5149\u5E7F\u573A"
];
var HOTEL_NAMES = [
  "\u57CE\u5E02\u4E2D\u5FC3\u5927\u9152\u5E97",
  "\u6EE8\u6C5F\u7CBE\u54C1\u9152\u5E97",
  "\u82B1\u56ED\u5EA6\u5047\u9152\u5E97",
  "\u5546\u52A1\u667A\u9009\u9152\u5E97",
  "\u8001\u57CE\u6587\u5316\u5BA2\u6808",
  "\u6E56\u666F\u6E29\u6CC9\u9152\u5E97"
];
function scatter(center, count, radiusKm, seed) {
  const points = [];
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const dLat = radiusKm / 111;
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rand()) * radiusKm;
    const theta = rand() * Math.PI * 2;
    const dLng = r / 111 / Math.cos(center.lat * Math.PI / 180);
    points.push({
      lat: center.lat + r / radiusKm * dLat * Math.sin(theta),
      lng: center.lng + dLng * Math.cos(theta)
    });
  }
  return points;
}
function mockAttractions(destination, center) {
  const pts = scatter(center, ATTRACTION_NAMES.length, 12, 42);
  return ATTRACTION_NAMES.map((name, i) => ({
    id: `mock-a-${i}`,
    name: `${destination}${name}`,
    address: `${destination}\u5E02\u533A\u793A\u4F8B\u5730\u5740 ${i + 1} \u53F7`,
    category: "attraction",
    type: "\u98CE\u666F\u540D\u80DC",
    rating: (4 + i * 7 % 10 / 10).toFixed(1),
    lng: pts[i].lng,
    lat: pts[i].lat
  }));
}
function mockHotels(destination, center) {
  const pts = scatter(center, HOTEL_NAMES.length, 8, 88);
  return HOTEL_NAMES.map((name, i) => ({
    id: `mock-h-${i}`,
    name: `${destination}${name}`,
    address: `${destination}\u5E02\u4E2D\u5FC3\u793A\u4F8B\u8DEF ${i + 1} \u53F7`,
    category: "hotel",
    type: "\u4F4F\u5BBF\u670D\u52A1",
    rating: (4.2 + i * 5 % 8 / 10).toFixed(1),
    tel: "400-000-0000",
    lng: pts[i].lng,
    lat: pts[i].lat
  }));
}

// ../tr-api/src/route.ts
var PYTHON_BACKEND_URL = void 0;
function daysBetween(start, end) {
  const s = /* @__PURE__ */ new Date(start + "T00:00:00Z");
  const e = /* @__PURE__ */ new Date(end + "T00:00:00Z");
  const diff = Math.round((e.getTime() - s.getTime()) / 864e5) + 1;
  return Math.max(1, diff);
}
function addDays(date, n) {
  const d = /* @__PURE__ */ new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
async function callPythonBackend(payload) {
  if (!PYTHON_BACKEND_URL) return null;
  try {
    const base = PYTHON_BACKEND_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
    if (!res.ok) {
      console.log("[v0] python backend responded with error status:", res.status);
      return null;
    }
    const raw = await res.json();
    return mapBackendResponse(raw);
  } catch (err) {
    console.log("[v0] python backend call failed:", err.message);
    return null;
  }
}
function mapBackendResponse(raw) {
  return {
    destination: raw.destination,
    center: raw.center,
    startDate: raw.startDate,
    endDate: raw.endDate,
    days: raw.days,
    weather: raw.weather,
    hotels: raw.hotels,
    attractions: raw.attractions,
    usingMockData: false
  };
}
async function buildFallbackPlan(destination, startDate, endDate, totalDays, live) {
  const useServer = hasAmapKey();
  let usingMockData = false;
  let center = live?.center ?? (useServer ? await geocode(destination) : null);
  if (!center) {
    center = mockGeocode(destination);
    usingMockData = true;
  }
  const [serverAttractions, serverHotels, weather] = await Promise.all([
    live?.attractions?.length ? Promise.resolve(live.attractions) : useServer ? fetchAttractions(destination) : Promise.resolve([]),
    live?.hotels?.length ? Promise.resolve(live.hotels) : useServer ? fetchHotels(destination) : Promise.resolve([]),
    fetchWeather(center, startDate, endDate).catch(() => [])
  ]);
  let attractions;
  if (serverAttractions.length > 0) {
    attractions = serverAttractions;
  } else {
    usingMockData = true;
    attractions = mockAttractions(destination, center);
  }
  let hotels;
  if (serverHotels.length > 0) {
    hotels = serverHotels;
  } else {
    usingMockData = true;
    hotels = mockHotels(destination, center);
  }
  const clusters = kMeans(attractions, totalDays);
  clusters.sort((a, b) => {
    const ca = a.length ? a[0] : center;
    const cb = b.length ? b[0] : center;
    const da = (ca.lng - center.lng) ** 2 + (ca.lat - center.lat) ** 2;
    const db = (cb.lng - center.lng) ** 2 + (cb.lat - center.lat) ** 2;
    return da - db;
  });
  const days = clusters.map((cluster, i) => {
    const ordered = solveTsp(cluster);
    const stops = ordered.map((p, idx) => ({
      ...p,
      order: idx + 1
    }));
    let hotel;
    if (hotels.length && stops.length) {
      const anchor = stops[0];
      hotel = [...hotels].sort(
        (h1, h2) => (h1.lng - anchor.lng) ** 2 + (h1.lat - anchor.lat) ** 2 - ((h2.lng - anchor.lng) ** 2 + (h2.lat - anchor.lat) ** 2)
      )[0];
    } else {
      hotel = hotels[i % Math.max(1, hotels.length)];
    }
    const distanceKm = routeDistanceKm(
      hotel ? [hotel, ...stops, hotel] : stops
    );
    return {
      day: i + 1,
      date: addDays(startDate, i),
      weather: weather[i],
      hotel,
      stops,
      distanceKm
    };
  });
  return {
    destination,
    center,
    startDate,
    endDate,
    days,
    weather,
    hotels,
    attractions,
    usingMockData
  };
}
async function POST(req) {
  try {
    const body = await req.json();
    const destination = String(body.destination ?? "").trim();
    const startDate = String(body.startDate ?? "").trim();
    const endDate = String(body.endDate ?? "").trim();
    if (!destination || !startDate || !endDate) {
      return NextResponse.json(
        { error: "\u8BF7\u586B\u5199\u76EE\u7684\u5730\u4E0E\u8D77\u6B62\u65E5\u671F" },
        { status: 400 }
      );
    }
    if (new Date(endDate) < new Date(startDate)) {
      return NextResponse.json(
        { error: "\u7ED3\u675F\u65E5\u671F\u4E0D\u80FD\u65E9\u4E8E\u5F00\u59CB\u65E5\u671F" },
        { status: 400 }
      );
    }
    const totalDays = daysBetween(startDate, endDate);
    if (totalDays > 14) {
      return NextResponse.json(
        { error: "\u884C\u7A0B\u5929\u6570\u8BF7\u63A7\u5236\u5728 14 \u5929\u4EE5\u5185" },
        { status: 400 }
      );
    }
    const backendResult = await callPythonBackend({
      destination,
      startDate,
      endDate
    });
    if (backendResult) {
      return NextResponse.json(backendResult);
    }
    const fallback = await buildFallbackPlan(
      destination,
      startDate,
      endDate,
      totalDays,
      sanitizeLive(body)
    );
    return NextResponse.json(fallback);
  } catch (err) {
    console.log("[v0] plan api error:", err.message);
    return NextResponse.json({ error: "\u751F\u6210\u884C\u7A0B\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5" }, { status: 500 });
  }
}
function sanitizeLive(body) {
  const num = (v) => typeof v === "number" && isFinite(v) ? v : NaN;
  const str = (v, n = 80) => typeof v === "string" ? v.slice(0, n) : "";
  const pt = (o) => {
    const lng = num(o?.lng), lat = num(o?.lat);
    return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 ? { lng, lat } : null;
  };
  const pois = (arr, category, max) => (Array.isArray(arr) ? arr : []).slice(0, max).map((p, i) => {
    const c = pt(p);
    if (!c || !str(p?.name)) return null;
    return { id: str(p.id, 40) || `${category}-${i}`, name: str(p.name), address: str(p.address, 120), category, rating: str(p.rating, 8) || void 0, tel: str(p.tel, 40) || void 0, ...c };
  }).filter((p) => p !== null);
  const center = pt(body?.center) ?? void 0;
  const attractions = pois(body?.attractions, "attraction", 40);
  const hotels = pois(body?.hotels, "hotel", 20);
  if (!center || attractions.length < 3) return void 0;
  return { center, attractions, hotels };
}

// ../tr-api/entry.ts
async function onRequestPost(context) {
  return POST(context.request);
}
async function onRequestGet() {
  return new Response(JSON.stringify({ error: "\u8BF7\u4F7F\u7528 POST" }), { status: 405, headers: { "content-type": "application/json" } });
}
export {
  onRequestGet,
  onRequestPost
};
