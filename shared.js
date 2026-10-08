/*
  BOUESTI Vote — shared API client.
  Every page (voting portal, admin sign-in, admin dashboard) loads this
  before its own script. It talks to the Express + SQLite backend over
  HTTP (same origin, so no CORS setup needed) instead of reading and
  writing localStorage — so the voting portal and every admin section,
  and anyone else hitting this server, all see the same real data.

  Every function here that touches the server is async and returns a
  Promise; callers must await it.
*/

async function apiRequest(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    throw new Error("Couldn't reach the server. Check that it's running and try again.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch (error) {
    data = null;
  }

  if (!res.ok) {
    const error = new Error((data && data.error) || `Request failed (${res.status}).`);
    error.status = res.status;
    throw error;
  }

  return data;
}

/* Full current state: election settings, offices/candidates, live vote
   tallies, the student roster, activity, and announcements — one call,
   always fresh from the database. */
async function getResultsStore() {
  return apiRequest("GET", "/api/state");
}

function normalizeMatric(value) {
  return String(value || "").trim().toUpperCase();
}

async function hasVotedAlready(matric) {
  const data = await apiRequest("GET", `/api/voters/${encodeURIComponent(matric)}/voted`);
  return data.voted;
}

/* A matric is blocked only if there's an existing roster record for it
   that's been explicitly deactivated. No record yet is NOT a block —
   completing login + accepting the rules is what creates the record. */
async function isMatricEligible(matric) {
  const data = await apiRequest("GET", `/api/voters/${encodeURIComponent(matric)}/eligibility`);
  return data.eligible;
}