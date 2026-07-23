async function sendPasswordResetEmail({ email, name, token }) {
  const resetBaseUrl = process.env.PUBLIC_APP_URL || "http://localhost:5173";
  const resetUrl = `${resetBaseUrl}/postproperty?resetToken=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[DEV] Password reset for ${email}: ${resetUrl}`);
      return { delivered: false, devResetUrl: resetUrl };
    }
    throw new Error("Password reset email service is not configured");
  }

  const safeName = String(name || "there").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.PASSWORD_RESET_FROM || "ClearTitle One <onboarding@resend.dev>",
      to: [email],
      subject: "Reset your ClearTitle One password",
      html: `<p>Hello ${safeName},</p><p>Use the secure link below to reset your password. It expires in 15 minutes and can only be used once.</p><p><a href="${resetUrl}">Reset password</a></p>`,
    }),
  });

  if (!response.ok) throw new Error("Password reset email could not be sent");
  return { delivered: true };
}

module.exports = { sendPasswordResetEmail };
