/**
 * Minimal email-sending abstraction.
 *
 * No email provider is wired in yet — this stub logs the email content
 * (including the actual verification/reset link) to the console instead
 * of sending it. That's enough to test the verification/reset flow
 * end-to-end during development, since you can grab the link straight
 * from Render's logs.
 *
 * To go live, replace the body of `sendEmail` with a real provider call.
 * Any transactional email API works (Resend, Postmark, SendGrid, AWS SES,
 * etc.) — they all take roughly { to, subject, html/text } and an API key
 * from an environment variable. None are wired in here since that
 * requires an account and API key only you can create.
 */
async function sendEmail({ to, subject, text }) {
  console.log(`\n--- EMAIL (stub — no provider configured) ---`);
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(text);
  console.log(`--- END EMAIL ---\n`);
}

async function sendVerificationEmail(to, verifyUrl) {
  await sendEmail({
    to,
    subject: 'Verify your Wiretrade email',
    text: `Click to verify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  });
}

async function sendPasswordResetEmail(to, resetUrl) {
  await sendEmail({
    to,
    subject: 'Reset your Wiretrade password',
    text: `Click to reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
