// netlify/functions/feed.js
//
// Garmin inReach MapShare proxy, served at /api/feed.
//
// Pulls the Garmin inReach MapShare Raw KML feed server-side (the feed is
// CORS-locked, so the browser cannot read it directly) and returns clean JSON.
//
// Two INDEPENDENT reads, so "where are they NOW" can never be corrupted by the
// historical track ordering:
//   1) CURRENT: the feed with NO date params. Garmin returns the single most
//      recent fix by design. This drives the live position marker.
//   2) TRACK:   the feed windowed d1=TRIP_START..d2=now. This draws the line.
//
// Latest position is chosen by the newest VALID timestamp, never by array
// position, so a timeless "last known location" / message placemark (an airport
// check-in) can never hijack the marker. That was the airport-pin bug.
//
// Zero dependencies on purpose: no `npm install`, works on any deploy method.
//
// Both environment variables are optional; the defaults below are the live
// trip, so this works with no Netlify configuration at all.
//
//   FEED_URL    The Garmin Raw KML feed URL. Note this is the /Feed/Share/
//               path, not the public MapShare page at share.garmin.com/VH5B5 —
//               same code, different path. Found under
//               explore.garmin.com -> Social -> Feeds -> Raw KML Data.
//               The MapShare feed password must be BLANK for this to read it.
//               Set the env var to point at a different device or trip.
//
//   TRIP_START  ISO date the historical track starts from.
//               Default 2026-08-23T00:00:00Z (departure for São Miguel).

// The device behind this trip. Not a secret: the same MapShare code is linked
// publicly from the itinerary page, and the feed is readable by anyone who has
// it — which is the point of MapShare. Override with the FEED_URL env var.
const DEFAULT_FEED_URL = "https://share.garmin.com/Feed/Share/VH5B5";

function num(s) {
  if (s === undefined || s === null) return NaN;
  return parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
}

// Parse Garmin MapShare KML with no XML library. Each tracking point is a
// <Placemark> with <Point><coordinates>lon,lat,alt</coordinates>, a <when>
// timestamp, and <ExtendedData> name/value pairs.
function parseKml(xml) {
  const points = [];
  const blocks = xml.match(/<Placemark\b[\s\S]*?<\/Placemark>/g) || [];
  for (const b of blocks) {
    const coord = b.match(/<coordinates>\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)(?:\s*,\s*([-\d.eE]+))?/);
    if (!coord) continue;
    const lon = parseFloat(coord[1]);
    const lat = parseFloat(coord[2]);
    if (!isFinite(lat) || !isFinite(lon)) continue;

    const ext = {};
    const dataRe = /<Data\b[^>]*\bname="([^"]+)"[^>]*>\s*<value>([\s\S]*?)<\/value>/g;
    let m;
    while ((m = dataRe.exec(b))) ext[m[1]] = m[2].trim();

    const whenM = b.match(/<when>([^<]+)<\/when>/);

    let alt = num(ext["Elevation"]);
    if (!isFinite(alt)) alt = parseFloat(coord[3]);

    const time = (whenM && whenM[1]) || ext["Time UTC"] || ext["Time"] || null;

    points.push({
      lat, lon,
      alt: isFinite(alt) ? alt : null,
      time: time || null,
      velocity: ext["Velocity"] || null,
      course: ext["Course"] || null,
      inEmergency: String(ext["In Emergency"] || "").toLowerCase() === "true",
      text: ext["Text"] || null,
    });
  }
  return points;
}

// True only if a point carries a parseable timestamp.
function hasTime(p) {
  return !!p.time && !isNaN(Date.parse(p.time));
}

// Newest point by valid timestamp, or null if none are timed.
function newestTimed(points) {
  const timed = points.filter(hasTime);
  if (!timed.length) return null;
  return timed.reduce((a, b) => (Date.parse(b.time) > Date.parse(a.time) ? b : a));
}

// Fetch a URL and parse it to points. Returns an array (possibly empty);
// throws with .status set on an HTTP error so the caller can report it.
async function fetchPoints(url) {
  const res = await fetch(url, { headers: { "User-Agent": "lightapps-tracker/1.0" } });
  if (!res.ok) {
    const e = new Error("Garmin feed returned " + res.status + ".");
    e.status = res.status;
    throw e;
  }
  const xml = await res.text();
  if (!xml || xml.indexOf("<") === -1) return [];
  return parseKml(xml);
}

exports.handler = async () => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=60",
    "Access-Control-Allow-Origin": "*",
  };

  const base = process.env.FEED_URL || DEFAULT_FEED_URL;
  const tripStart = process.env.TRIP_START || "2026-08-23T00:00:00Z";

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const sep = base.includes("?") ? "&" : "?";
  const trackUrl = base + sep + "d1=" + encodeURIComponent(tripStart) + "&d2=" + encodeURIComponent(now);

  try {
    // TRACK: the windowed historical line. This is the authoritative read,
    // so an HTTP error here surfaces to the user.
    let track = await fetchPoints(trackUrl);

    // CURRENT: no date params -> Garmin's single most-recent fix. If this read
    // fails for any reason we swallow it and fall back to the track below, so
    // the marker still resolves rather than blanking the whole response.
    let current = [];
    try {
      current = await fetchPoints(base);
    } catch (_) {
      current = [];
    }

    // Clean track: timed points only, sorted ascending, adjacent-dupe removed.
    // Dropping timeless points also keeps a stray "last known" placemark from
    // injecting a phantom segment back to the airport.
    track = track.filter(hasTime).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const deduped = [];
    let prev = null;
    for (const p of track) {
      const k = p.lat + "," + p.lon + "," + p.time;
      if (k !== prev) deduped.push(p);
      prev = k;
    }
    track = deduped;

    // Latest: newest valid fix from the dedicated current read; if that came
    // back empty, fall back to the newest point on the track.
    const latest = newestTimed(current) || (track.length ? track[track.length - 1] : null);

    return { statusCode: 200, headers, body: JSON.stringify({
      ok: true,
      count: track.length,
      points: track,
      latest,
      generatedAt: now,
    })};
  } catch (err) {
    const isHttp = err && err.status;
    return {
      statusCode: isHttp ? 502 : 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: isHttp
          ? "Garmin feed returned " + err.status + ". Check that MapShare is on and the feed has no password."
          : "Failed to read the Garmin feed: " + (err && err.message ? err.message : String(err)),
      }),
    };
  }
};
