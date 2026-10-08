if (
  typeof getResultsStore === "undefined" ||
  typeof hasVotedAlready === "undefined" ||
  typeof isMatricEligible === "undefined"
) {
  document.body.innerHTML =
    '<div style="max-width:520px;margin:80px auto;padding:24px;' +
    'font:16px/1.5 sans-serif;text-align:center;">' +
    "<h1 style=\"font-size:1.3rem;\">Setup problem</h1>" +
    "<p>This page needs <code>shared.js</code>, and it did not load " +
    "correctly. Make sure a file named exactly <code>shared.js</code> " +
    "sits in the same folder as <code>index.html</code>, then reload.</p>" +
    "</div>";
  throw new Error("shared.js did not load — required globals are missing.");
}

const panels = document.querySelectorAll(".panel");
const steps = document.querySelectorAll(".step");

const loginForm = document.getElementById("loginForm");
const identityForm = document.getElementById("identityForm");
const otpForm = document.getElementById("otpForm");
const ballotForm = document.getElementById("ballotForm");

const matricNumber = document.getElementById("matricNumber");
const password = document.getElementById("password");
const matricConfirm = document.getElementById("matricConfirm");
const universityEmail = document.getElementById("universityEmail");
const otpInput = document.getElementById("otpInput");

const rulesDialog = document.getElementById("rulesDialog");
const rulesBody = document.getElementById("rulesBody");
const agreeRules = document.getElementById("agreeRules");
const acceptRulesButton = document.getElementById("acceptRules");
const declineRulesButton = document.getElementById("declineRules");

const resendButton = document.getElementById("resendButton");
const voteConfirmation = document.getElementById("voteConfirmation");
const returnHomeButton = document.getElementById("returnHomeButton");

const RESEND_COOLDOWN_SECONDS = 30;
const STATUS_POLL_MS = 4000;

let timerId;
let resendCooldownId;
let voteBannerTimeoutId;

/* Snapshot of offices/candidates taken when the ballot is rendered, from
   the server. Offices and candidates are admin-editable (see the admin
   dashboard), but only while the election is "upcoming" — once voting
   is active this stays stable for the rest of the session. */
let currentOffices = [];

function showPanel(panelId, activeStep) {
  panels.forEach((panel) => {
    panel.classList.toggle("active-panel", panel.id === panelId);
  });

  steps.forEach((step) => {
    step.classList.toggle("active", Number(step.dataset.step) === activeStep);
  });

  document.querySelector(".voting-shell").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function showMessage(elementId, text = "") {
  document.getElementById(elementId).textContent = text;
}

function maskEmail(email) {
  const [name, domain] = email.split("@");
  const hidden = "•".repeat(Math.max(2, name.length - 2));
  return `${name.slice(0, 2)}${hidden}@${domain}`;
}

function candidatePlaceholder(name) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
      <rect width="120" height="120" rx="60" fill="#d7e5e7"/>
      <circle cx="60" cy="43" r="21" fill="#7d9a9d"/>
      <path d="M22 109c6-24 22-36 38-36s32 12 38 36" fill="#7d9a9d"/>
      <text x="60" y="111" text-anchor="middle"
        font-family="Arial" font-size="12" font-weight="bold"
        fill="#152f3e">${initials}</text>
    </svg>
  `;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* Offices with no approved candidates yet are left off the ballot
   entirely — a voter is never asked to choose for an empty race. */
function ballotableOffices(offices) {
  return offices
    .map((office) => ({
      ...office,
      candidates: office.candidates.filter((c) => c.status === "approved")
    }))
    .filter((office) => office.candidates.length > 0);
}

async function renderBallot() {
  let store;
  try {
    store = await getResultsStore();
  } catch (error) {
    document.getElementById("ballotPositions").innerHTML =
      `<p class="form-message">${error.message}</p>`;
    return;
  }

  currentOffices = ballotableOffices(store.offices);

  const container = document.getElementById("ballotPositions");

  container.innerHTML = currentOffices
    .map(({ office, candidates }) => {
      const cards = candidates
        .map(({ name, photoUrl }) => {
          const photo = photoUrl || candidatePlaceholder(name);

          return `
            <label class="candidate">
              <input type="radio" name="${office}" value="${name}" required />
              <img
                class="candidate-photo"
                src="${photo}"
                alt="Photo of ${name}"
              />
              <span>
                <strong>${name}</strong>
                <small>BOUESTI student candidate</small>
                ${photoUrl ? "" : '<small class="photo-note">Official photo slot</small>'}
              </span>
              <i>✓</i>
            </label>
          `;
        })
        .join("");

      return `
        <fieldset>
          <legend>${office}</legend>
          <div class="candidate-grid">${cards}</div>
        </fieldset>
      `;
    })
    .join("");
}

function startTimer() {
  clearInterval(timerId);

  let seconds = 300;

  timerId = setInterval(() => {
    seconds -= 1;

    const minutes = String(Math.max(0, Math.floor(seconds / 60))).padStart(2, "0");
    const remainingSeconds = String(Math.max(0, seconds % 60)).padStart(2, "0");

    document.getElementById("timer").textContent =
      `${minutes}:${remainingSeconds}`;

    if (seconds <= 0) {
      clearInterval(timerId);
      showMessage("otpMessage", "Your OTP has expired. Request a new code.");
    }
  }, 1000);
}

function resetResendButton() {
  clearInterval(resendCooldownId);
  resendButton.disabled = false;
  resendButton.textContent = "Resend code";
}

function startResendCooldown() {
  let remaining = RESEND_COOLDOWN_SECONDS;

  resendButton.disabled = true;
  resendButton.textContent = `Resend code (${remaining}s)`;

  clearInterval(resendCooldownId);
  resendCooldownId = setInterval(() => {
    remaining -= 1;

    if (remaining <= 0) {
      resetResendButton();
      return;
    }

    resendButton.textContent = `Resend code (${remaining}s)`;
  }, 1000);
}

/* Election rules dialog: voters must scroll and accept before voting */
function unlockRulesCheckbox() {
  agreeRules.disabled = false;
}

function checkRulesScroll() {
  const scrolledToBottom =
    rulesBody.scrollTop + rulesBody.clientHeight >= rulesBody.scrollHeight - 8;

  if (scrolledToBottom) {
    unlockRulesCheckbox();
  }
}

function openRulesDialog() {
  agreeRules.checked = false;
  agreeRules.disabled = true;
  acceptRulesButton.disabled = true;
  showMessage("rulesMessage");

  rulesDialog.showModal();

  requestAnimationFrame(() => {
    rulesBody.scrollTop = 0;

    if (rulesBody.scrollHeight <= rulesBody.clientHeight) {
      unlockRulesCheckbox();
    }
  });
}

async function resetVotingPortal() {
  clearInterval(timerId);
  resetResendButton();

  loginForm.reset();
  identityForm.reset();
  otpForm.reset();
  ballotForm.reset();

  const confirmVoteBox = document.getElementById("confirmVote");
  if (confirmVoteBox) confirmVoteBox.checked = false;

  agreeRules.checked = false;
  agreeRules.disabled = true;
  acceptRulesButton.disabled = true;

  const alreadyVotedNotice = document.getElementById("alreadyVotedNotice");
  if (alreadyVotedNotice) alreadyVotedNotice.hidden = true;

  const notEligibleNotice = document.getElementById("notEligibleNotice");
  if (notEligibleNotice) notEligibleNotice.hidden = true;

  showMessage("loginMessage");
  showMessage("identityMessage");
  showMessage("otpMessage");
  showMessage("ballotMessage");
  showMessage("reviewMessage");
  showMessage("rulesMessage");

  await renderBallot();
  showPanel("loginPanel", 1);
  await applyElectionStatus();
}

function showVoteConfirmationBanner() {
  voteConfirmation.hidden = false;

  clearTimeout(voteBannerTimeoutId);
  voteBannerTimeoutId = setTimeout(() => {
    voteConfirmation.hidden = true;
  }, 8000);
}

/* Registered = completed login and accepted the election rules.
   Verified = completed OTP. Both are tracked on the same student record
   the admin dashboard's Voters/Students section shows, so an admin can
   see exactly how far each matric number has gotten. The server creates
   the record on first registration and enforces both flags again at
   vote time — these calls just report progress as it happens. */
async function markStudentRegistered(matric) {
  if (!matric) return;
  try {
    await apiRequest("POST", "/api/voters/register", { matric });
  } catch (error) {
    console.warn("Could not record registration:", error.message);
  }
}

async function markStudentVerified(matric) {
  if (!matric) return;
  try {
    await apiRequest("POST", "/api/voters/verify", { matric });
  } catch (error) {
    console.warn("Could not record verification:", error.message);
  }
}

/* Reflect the live election status (upcoming / active / closed, set from
   the admin dashboard), the current election name, and any announcement —
   all from one fetch of the current state. */
async function applyElectionStatus() {
  let store;
  try {
    store = await getResultsStore();
  } catch (error) {
    return;
  }

  const status = store.status;
  const active = status === "active";

  const statusDot = document.getElementById("electionStatusDot");
  const statusText = document.getElementById("electionStatusText");
  const closedNotice = document.getElementById("electionClosedNotice");
  const eyebrow = document.getElementById("electionNameEyebrow");

  if (statusDot) statusDot.classList.toggle("status-dot--closed", !active);

  if (statusText) {
    statusText.innerHTML =
      status === "active"
        ? 'Elections close <strong>Friday, 6:00 PM</strong>'
        : status === "upcoming"
          ? "Elections are <strong>upcoming</strong>"
          : "Elections are <strong>closed</strong>";
  }

  if (eyebrow) {
    eyebrow.textContent = `${store.electionName} · Voting Portal`;
  }

  if (closedNotice) {
    if (status === "closed") {
      closedNotice.hidden = false;
      closedNotice.textContent =
        "Voting has closed for this election. Thank you to everyone who " +
        "participated — results will be announced by the Electoral Committee.";
    } else if (status === "upcoming") {
      closedNotice.hidden = false;
      closedNotice.textContent =
        "Voting hasn't opened yet for this election. Please check back " +
        "once the Electoral Committee opens voting.";
    } else {
      closedNotice.hidden = true;
    }
  }

  loginForm.querySelectorAll("input, button").forEach((el) => {
    el.disabled = !active;
  });

  applyAnnouncementBanner(store);
}

function applyAnnouncementBanner(store) {
  const banner = document.getElementById("announcementBanner");
  const text = document.getElementById("announcementText");
  if (!banner || !text) return;

  const latest = store.announcements.length ? store.announcements[0] : null;

  if (!latest || latest.hidden) {
    banner.hidden = true;
    return;
  }

  text.textContent = latest.message;
  banner.hidden = false;
}

/* Render the ballot and apply live status on load, then poll periodically
   so an admin closing voting or posting an announcement in another tab —
   or on another device entirely, since this is now a real server — shows
   up here within a few seconds. */
(async () => {
  await renderBallot();
  await applyElectionStatus();
})();

setInterval(() => {
  applyElectionStatus();
}, STATUS_POLL_MS);

document.getElementById("dismissAnnouncement")?.addEventListener("click", () => {
  document.getElementById("announcementBanner").hidden = true;
});

/* Required login */
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const matric = matricNumber.value.trim();
  const alreadyVotedNotice = document.getElementById("alreadyVotedNotice");
  const notEligibleNotice = document.getElementById("notEligibleNotice");
  if (alreadyVotedNotice) alreadyVotedNotice.hidden = true;
  if (notEligibleNotice) notEligibleNotice.hidden = true;

  if (matric.length < 6) {
    showMessage("loginMessage", "Enter a valid BOUESTI matriculation number.");
    return;
  }

  if (password.value.length < 8) {
    showMessage("loginMessage", "Enter your student-account password to continue.");
    return;
  }

  let eligible;
  let voted;
  try {
    eligible = await isMatricEligible(matric);
    voted = eligible ? await hasVotedAlready(matric) : false;
  } catch (error) {
    showMessage("loginMessage", error.message);
    return;
  }

  if (!eligible) {
    showMessage("loginMessage");
    password.value = "";
    if (notEligibleNotice) notEligibleNotice.hidden = false;
    return;
  }

  if (voted) {
    showMessage("loginMessage");
    password.value = "";
    if (alreadyVotedNotice) alreadyVotedNotice.hidden = false;
    return;
  }

  matricConfirm.value = matric;
  showMessage("loginMessage");
  openRulesDialog();
});

/* Election rules: scroll to unlock, then accept to proceed */
rulesBody.addEventListener("scroll", checkRulesScroll);

agreeRules.addEventListener("change", () => {
  acceptRulesButton.disabled = !agreeRules.checked;
});

acceptRulesButton.addEventListener("click", async () => {
  if (!agreeRules.checked) {
    showMessage("rulesMessage", "Please confirm you agree to the election rules.");
    return;
  }

  await markStudentRegistered(matricConfirm.value);

  rulesDialog.close();
  showPanel("verifyPanel", 2);
  universityEmail.focus();
});

declineRulesButton.addEventListener("click", () => {
  rulesDialog.close();
  loginForm.reset();
  showPanel("loginPanel", 1);
  showMessage(
    "loginMessage",
    "You must accept the election rules before you can vote. Log in again to review them."
  );
});

/* University email validation and OTP */
identityForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const matric = matricConfirm.value.trim();
  const email = universityEmail.value.trim();

  if (matric.length < 6) {
    showMessage("identityMessage", "Enter a valid BOUESTI matriculation number.");
    return;
  }

  if (!/^[^\s@]+@bouesti\.edu\.ng$/i.test(email)) {
    showMessage(
      "identityMessage",
      "Use your university-registered @bouesti.edu.ng email address."
    );
    return;
  }

  showMessage("identityMessage");
  document.getElementById("maskedEmail").textContent = maskEmail(email);
  document.getElementById("timer").textContent = "05:00";

  resetResendButton();
  startTimer();
  showPanel("otpPanel", 2);
  otpInput.focus();
});

/* OTP verification */
otpForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  /*
    Demo only. In production, verify the OTP server-side against a
    real one-time code, not a hardcoded value.
  */
  if (otpInput.value !== "123456") {
    showMessage(
      "otpMessage",
      "That code is incorrect. Try again or request a new code."
    );
    return;
  }

  await markStudentVerified(matricConfirm.value);

  clearInterval(timerId);
  showMessage("otpMessage");
  showPanel("ballotPanel", 3);
});

/* Resend OTP */
resendButton.addEventListener("click", () => {
  document.getElementById("timer").textContent = "05:00";
  startTimer();
  startResendCooldown();
  showMessage("otpMessage", "A fresh OTP has been sent to your university email.");
});

/* Back buttons */
document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.back;

    const step =
      target === "loginPanel" ? 1 :
      target === "verifyPanel" ? 2 :
      3;

    showPanel(target, step);
  });
});

/* Ballot validation and review — uses the offices snapshot already
   fetched when the ballot was rendered, so this stays instant. */
ballotForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const choices = new FormData(ballotForm);

  const missingOffice = currentOffices.find(({ office }) => !choices.get(office));

  if (missingOffice) {
    showMessage(
      "ballotMessage",
      `Choose a candidate for ${missingOffice.office}.`
    );
    return;
  }

  const reviewHtml = currentOffices
    .map(({ office }) => {
      return `
        <div>
          <dt>${office}</dt>
          <dd>${choices.get(office)}</dd>
        </div>
      `;
    })
    .join("");

  document.getElementById("reviewList").innerHTML = reviewHtml;
  showMessage("ballotMessage");
  showPanel("reviewPanel", 4);
});

/* Ballot submission — the server has the final say: it re-checks
   registered + verified + not-already-voted + that every choice is a
   real approved candidate before it ever records anything. */
document.getElementById("submitVote").addEventListener("click", async () => {
  const confirmed = document.getElementById("confirmVote").checked;

  if (!confirmed) {
    showMessage(
      "reviewMessage",
      "Confirm your choices before submitting your ballot."
    );
    return;
  }

  const matric = matricConfirm.value.trim();
  const choices = {};
  new FormData(ballotForm).forEach((value, key) => {
    choices[key] = value;
  });

  let result;
  try {
    result = await apiRequest("POST", "/api/votes", { matric, choices });
  } catch (error) {
    showMessage("reviewMessage", error.message);
    return;
  }

  document.getElementById("receiptId").textContent = result.receiptId;
  showPanel("successPanel", 4);
});

/* Help dialog */
document.getElementById("helpButton").addEventListener("click", () => {
  document.getElementById("helpDialog").showModal();
});

document.getElementById("closeHelp").addEventListener("click", () => {
  document.getElementById("helpDialog").close();
});

/* Return to homepage after voting */
returnHomeButton.addEventListener("click", async (event) => {
  event.preventDefault();

  await resetVotingPortal();
  showVoteConfirmationBanner();

  document.querySelector(".hero").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
});

document.getElementById("dismissConfirmation").addEventListener("click", () => {
  voteConfirmation.hidden = true;
  clearTimeout(voteBannerTimeoutId);
});