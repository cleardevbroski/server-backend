const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const EMAIL_ADDRESS = "[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+";
const BARE_EMAIL_FROM = new RegExp(`^${EMAIL_ADDRESS}$`, "i");
const NAMED_EMAIL_FROM = new RegExp(`^[^<>\\r\\n]+\\s+<${EMAIL_ADDRESS}>$`, "i");
const DEFAULT_EMAIL_FROM = "ClearTitle One <onboarding@resend.dev>";

function normalizeEmailFrom(value) {
  let candidate = String(value || "").trim();
  if ((candidate.startsWith('"') && candidate.endsWith('"')) || (candidate.startsWith("'") && candidate.endsWith("'"))) {
    candidate = candidate.slice(1, -1).trim();
  }
  return BARE_EMAIL_FROM.test(candidate) || NAMED_EMAIL_FROM.test(candidate) ? candidate : "";
}

function resolveEmailFrom(preferred) {
  return [preferred, process.env.CHANNEL_PARTNER_EMAIL_FROM, process.env.PASSWORD_RESET_FROM, DEFAULT_EMAIL_FROM]
    .map(normalizeEmailFrom)
    .find(Boolean) || DEFAULT_EMAIL_FROM;
}

async function sendEmail({ to, subject, html, from }) {
  if (!to) throw new Error("Email recipient is required");
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[DEV] Email queued: ${subject} -> ${String(to).replace(/^(.{2}).*(@.*)$/, "$1•••$2")}`);
      return { delivered: false, development: true };
    }
    throw new Error("Email service is not configured");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: resolveEmailFrom(from),
      to: [to], subject, html,
      ...(process.env.CHANNEL_PARTNER_REPLY_TO ? { reply_to: process.env.CHANNEL_PARTNER_REPLY_TO } : {}),
    }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const detail = typeof failure?.message === "string" ? `: ${failure.message}` : "";
    throw new Error(`Email could not be sent (provider status ${response.status})${detail}`);
  }
  const data = await response.json().catch(() => ({}));
  return { delivered: true, id: data.id };
}

function emailShell(content) {
  return `<div style="margin:0;background:#f2f3f6;padding:28px 12px;font-family:Arial,sans-serif;color:#222"><div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb"><div style="background:#0b1328;padding:22px 28px;color:#fff;font-size:21px;font-weight:700">Clear<span style="color:#f2c052">Title</span><span style="color:#ddaa42">One</span></div><div style="padding:28px;line-height:1.6">${content}</div></div></div>`;
}

const formatDate = (value) => new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function detailCard(rows) {
  return `<div style="background:#f8f7fa;border:1px solid #ece9ef;border-radius:12px;padding:18px;margin:20px 0">${rows
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `<p style="margin:0 0 6px"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`)
    .join("")}</div>`;
}

const signature = `<p style="margin-top:28px">Regards,<br><strong>ClearTitle One Channel Sales Team</strong></p>`;

function publicAppUrl() {
  const configured = process.env.PUBLIC_APP_URL || String(process.env.FRONTEND_URL || "").split(",")[0];
  return (configured.trim() || "http://localhost:5173").replace(/\/$/, "");
}

async function sendChannelPartnerRegisteredEmail({ email, name, applicationNumber, partnerCode }) {
  const registrationUrl = `${publicAppUrl()}/cp-registration`;
  const dashboardUrl = `${publicAppUrl()}/cp-dashboard`;
  return sendEmail({
    to: email,
    subject: "Welcome to ClearTitle One - Channel Partner Registration Successful",
    html: emailShell(`<h1 style="font-size:22px;color:#121b35;margin:0 0 18px">Channel Partner Registration Successful</h1><p>Dear ${escapeHtml(name || "Partner")},</p><p>Greetings from ClearTitle One!</p><p>Thank you for registering as a Channel Partner. Your account is active and you can now register clients for available projects.</p><div style="background:#fff8e8;border:1px solid #ecd8a8;border-radius:12px;padding:18px;margin:22px 0"><div style="font-size:12px;color:#6a5727">Your Channel Partner Code</div><div style="font-size:28px;font-weight:800;letter-spacing:2px;color:#121b35">${escapeHtml(partnerCode)}</div><div style="margin-top:8px;font-size:12px;color:#6a5727">Application: ${escapeHtml(applicationNumber)}</div></div><p>Use this unique code whenever you register a client. Please keep it private and do not share it with anyone.</p><p><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#ddaa42;color:#0b1328;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px;margin-right:8px">Open CP Dashboard</a><a href="${escapeHtml(registrationUrl)}" style="display:inline-block;background:#121b35;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px">Register a Client</a></p>${signature}`),
  });
}

async function sendChannelPartnerRecoveryOtpEmail({ email, name, otp }) {
  return sendEmail({
    to: email,
    subject: "Verify your ClearTitle One CP code recovery",
    html: emailShell(`<h1 style="font-size:22px;color:#121b35;margin:0 0 18px">Verify CP Code Recovery</h1><p>Dear ${escapeHtml(name || "Partner")},</p><p>Enter this one-time password to request a replacement Channel Partner code.</p><div style="background:#fff8e8;border:1px solid #ecd8a8;border-radius:12px;padding:18px;margin:22px 0;text-align:center"><div style="font-size:12px;color:#6a5727">Your verification OTP</div><div style="font-size:30px;font-weight:800;letter-spacing:5px;color:#121b35">${escapeHtml(otp)}</div></div><p>This OTP expires in 10 minutes. If you did not request it, do not share it or take any action.</p>${signature}`),
  });
}

async function sendChannelPartnerCodeRotatedEmail({ email, name, applicationNumber, partnerCode }) {
  const dashboardUrl = `${publicAppUrl()}/cp-dashboard`;
  return sendEmail({
    to: email,
    subject: "Your new ClearTitle One Channel Partner code",
    html: emailShell(`<h1 style="font-size:22px;color:#121b35;margin:0 0 18px">Your CP Code Has Been Replaced</h1><p>Dear ${escapeHtml(name || "Partner")},</p><p>Your previous Channel Partner code is no longer active. Use the new code below to access your dashboard.</p><div style="background:#fff8e8;border:1px solid #ecd8a8;border-radius:12px;padding:18px;margin:22px 0"><div style="font-size:12px;color:#6a5727">New Channel Partner Code</div><div style="font-size:28px;font-weight:800;letter-spacing:2px;color:#121b35">${escapeHtml(partnerCode)}</div><div style="margin-top:8px;font-size:12px;color:#6a5727">Application: ${escapeHtml(applicationNumber)}</div></div><p><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#ddaa42;color:#0b1328;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px">Open CP Dashboard</a></p><p>If you did not request this change, contact the ClearTitle One Channel Sales Team immediately.</p>${signature}`),
  });
}

const statusMessages = {
  active: "Your Channel Partner account is active. You may continue registering clients using your partner code.",
  under_review: "Our Channel Sales Team has started reviewing your application.",
  changes_requested: "We need additional information or corrections before we can complete the review.",
  resubmitted: "We have received your updated application and it is ready for review.",
  approved: "Your Channel Partner application has been approved.",
  rejected: "Your Channel Partner application was not approved.",
  suspended: "Access to your Channel Partner account has been suspended.",
};

async function sendChannelPartnerStatusEmail({ email, name, applicationNumber, status, note }) {
  const label = String(status || "updated").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return sendEmail({
    to: email,
    subject: `Channel Partner Application ${label} - ${applicationNumber}`,
    html: emailShell(`<h1 style="font-size:22px;color:#121b35;margin:0 0 18px">Application Status Updated</h1><p>Dear ${escapeHtml(name || "Partner")},</p><p>${escapeHtml(statusMessages[status] || "The status of your Channel Partner application has been updated.")}</p>${detailCard([["Application reference", applicationNumber], ["New status", label], ["Message from our team", note]])}<p>If you need assistance, reply to this email and quote your application reference.</p>${signature}`),
  });
}

async function sendChannelPartnerClientRegisteredEmail({ email, partnerName, leadNumber, clientName, mobileLast4, projectTitle, registeredAt, ownershipExpiresAt }) {
  const dashboardUrl = `${publicAppUrl()}/cp-dashboard`;
  return sendEmail({
    to: email,
    subject: `Client Registration Confirmed - ${leadNumber}`,
    html: emailShell(`<h1 style="font-size:22px;color:#121b35;margin:0 0 18px">Client Registered Successfully</h1><p>Dear ${escapeHtml(partnerName || "Partner")},</p><p>Greetings from ClearTitle One!</p><p>Your client has been registered and is pending admin review. If it is not approved, the registration expires after 90 days.</p>${detailCard([["Lead reference", leadNumber], ["Client name", clientName], ["Contact number", `••••••${mobileLast4}`], ["Project", projectTitle], ["Registration date", formatDate(registeredAt)], ["Pending until", formatDate(ownershipExpiresAt)]])}<p><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#ddaa42;color:#0b1328;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px">Open CP Dashboard</a></p><p style="font-size:12px;color:#68646f">Dashboard: <a href="${escapeHtml(dashboardUrl)}" style="color:#273559">${escapeHtml(dashboardUrl)}</a></p><p>Please quote the lead reference in future communication about this client.</p>${signature}`),
  });
}

async function sendSamePartnerClientDuplicateEmail({ email, partnerName, leadNumber, clientName, mobileLast4, projectTitle, registeredAt, ownershipExpiresAt, currentStatus }) {
  const pending = currentStatus === "pending";
  return sendEmail({
    to: email,
    subject: "Alert: Client Already Registered",
    html: emailShell(`<h1 style="font-size:22px;color:#121b35;margin:0 0 18px">Client Already Registered</h1><p>Dear ${escapeHtml(partnerName || "Partner")},</p><p>Greetings from ClearTitle One!</p><p>This client is already active under your account. No new lead was created and your original registration remains unchanged.</p>${detailCard([["Lead reference", leadNumber], ["Client name", clientName], ["Contact number", `••••••${mobileLast4}`], ["Project", projectTitle], ["Originally registered", formatDate(registeredAt)], [pending ? "Pending until" : "Current status", pending ? formatDate(ownershipExpiresAt) : currentStatus]])}<p>You may continue using the original lead reference.</p>${signature}`),
  });
}

async function sendClientClashAttemptEmail({ email, partnerName, clientName, mobileLast4, projectTitle, ownershipExpiresAt, currentStatus }) {
  const pending = currentStatus === "pending";
  return sendEmail({
    to: email,
    subject: "Alert: Client Already Registered",
    html: emailShell(`<h1 style="font-size:22px;color:#121b35;margin:0 0 18px">Client Registration Clash</h1><p>Dear ${escapeHtml(partnerName || "Partner")},</p><p>Greetings from ClearTitle One!</p><p>The client you submitted already has an active registration in our system through another Channel Partner.</p>${detailCard([["Client name", clientName], ["Contact number", `••••••${mobileLast4}`], ["Project", projectTitle], [pending ? "Current registration pending until" : "Current registration status", pending ? formatDate(ownershipExpiresAt) : currentStatus]])}<p><strong>No new lead or ownership was created for this submission.</strong> Please contact the Channel Sales Team if you believe this is incorrect.</p>${signature}`),
  });
}

async function sendClientClashOwnerEmail({ email, partnerName, leadNumber, clientName, mobileLast4, projectTitle, ownershipExpiresAt, currentStatus }) {
  const pending = currentStatus === "pending";
  return sendEmail({
    to: email,
    subject: "Alert: Another Channel Partner Attempted to Register Your Client",
    html: emailShell(`<h1 style="font-size:22px;color:#121b35;margin:0 0 18px">Client Re-registration Alert</h1><p>Dear ${escapeHtml(partnerName || "Partner")},</p><p>Greetings from ClearTitle One!</p><p>Another Channel Partner attempted to register a client who is already active under your registration.</p>${detailCard([["Lead reference", leadNumber], ["Client name", clientName], ["Contact number", `••••••${mobileLast4}`], ["Project", projectTitle], [pending ? "Your registration is pending until" : "Your registration status", pending ? formatDate(ownershipExpiresAt) : currentStatus]])}<p><strong>Your existing registration has not been changed.</strong> No details about either Channel Partner have been shared.</p>${signature}`),
  });
}

async function sendPasswordResetEmail({ email, name, token }) {
  const resetBaseUrl = publicAppUrl();
  const resetUrl = `${resetBaseUrl}/postproperty?resetToken=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  const result = await sendEmail({
    to: email,
    from: process.env.PASSWORD_RESET_FROM,
    subject: "Reset your ClearTitle One password",
    html: `<p>Hello ${escapeHtml(name || "there")},</p><p>Use the secure link below to reset your password. It expires in 15 minutes and can only be used once.</p><p><a href="${escapeHtml(resetUrl)}">Reset password</a></p>`,
  });
  return result.development ? { ...result, devResetUrl: resetUrl } : result;
}

async function sendPropertyLoginOtpEmail({ email, otp }) {
  return sendEmail({
    to: email,
    from: process.env.PROPERTY_EMAIL_FROM || process.env.PASSWORD_RESET_FROM,
    subject: "Your ClearTitle One property login code",
    html: emailShell(`<h1 style="font-size:22px;color:#121b35;margin:0 0 18px">Verify Your Email</h1><p>Use the code below to sign in and manage your property submissions.</p><div style="background:#fff8e8;border:1px solid #ecd8a8;border-radius:12px;padding:18px;margin:22px 0;text-align:center"><div style="font-size:12px;color:#6a5727">Your verification code</div><div style="font-size:30px;font-weight:800;letter-spacing:5px;color:#121b35">${escapeHtml(otp)}</div></div><p>This code expires in 10 minutes and can be used once. If you did not request it, you can ignore this email.</p>`),
  });
}

async function sendPropertySubmissionEmail({ email, name, propertyTitle, reference, status = "submitted" }) {
  const dashboardUrl = `${publicAppUrl()}/postproperty?view=my`;
  const statusLabel = String(status).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return sendEmail({
    to: email,
    from: process.env.PROPERTY_EMAIL_FROM || process.env.PASSWORD_RESET_FROM,
    subject: `Property submission ${statusLabel} - ${reference}`,
    html: emailShell(`<h1 style="font-size:22px;color:#121b35;margin:0 0 18px">Property Submission ${escapeHtml(statusLabel)}</h1><p>Hello ${escapeHtml(name || "Property Owner")},</p><p>We have received an update for your property submission.</p>${detailCard([["Reference", reference], ["Property", propertyTitle || "Untitled property"], ["Status", statusLabel]])}<p><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#ddaa42;color:#0b1328;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px">View My Properties</a></p>`),
  });
}

module.exports = {
  sendPasswordResetEmail,
  sendPropertyLoginOtpEmail,
  sendPropertySubmissionEmail,
  sendChannelPartnerRegisteredEmail,
  sendChannelPartnerRecoveryOtpEmail,
  sendChannelPartnerCodeRotatedEmail,
  sendChannelPartnerStatusEmail,
  sendChannelPartnerClientRegisteredEmail,
  sendSamePartnerClientDuplicateEmail,
  sendClientClashAttemptEmail,
  sendClientClashOwnerEmail,
};
