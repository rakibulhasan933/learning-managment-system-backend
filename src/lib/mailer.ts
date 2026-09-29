import nodemailer from 'nodemailer';

import { env } from '../config/env.js';

const colors = {
  accent: '#C9A15A',
  background: '#12151C',
  muted: '#8B8D98',
  surface: '#1B1F29',
  text: '#F2EFE7',
};

function getTransport() {
  if (!env.GMAIL_SMTP_USER || !env.GMAIL_SMTP_APP_PASSWORD) {
    throw new Error('Email service is not configured.');
  }

  return nodemailer.createTransport({
    auth: {
      pass: env.GMAIL_SMTP_APP_PASSWORD,
      user: env.GMAIL_SMTP_USER,
    },
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
  });
}

function renderEmail({
  body,
  ctaLabel,
  ctaUrl,
  title,
}: {
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  title: string;
}) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:${colors.background};font-family:Inter,Arial,sans-serif;color:${colors.text};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${colors.background};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:${colors.surface};border:1px solid #2A2F3A;">
            <tr>
              <td style="padding:28px;">
                <div style="width:112px;height:1px;background:${colors.accent};margin-bottom:24px;"></div>
                <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2;font-weight:600;color:${colors.text};">${title}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:${colors.muted};">${body}</p>
                <a href="${ctaUrl}" style="display:inline-block;background:${colors.accent};color:#12151C;text-decoration:none;padding:12px 18px;font-size:14px;font-weight:700;">${ctaLabel}</a>
                <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:${colors.muted};">If the button does not work, paste this link into your browser:<br><span style="color:${colors.text};word-break:break-all;">${ctaUrl}</span></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendMail({
  html,
  subject,
  text,
  to,
}: {
  html: string;
  subject: string;
  text: string;
  to: string;
}) {
  const transport = getTransport();

  await transport.sendMail({
    from: `"LMS" <${env.GMAIL_SMTP_USER}>`,
    html,
    subject,
    text,
    to,
  });
}

export async function sendVerificationEmail({
  email,
  verificationUrl,
}: {
  email: string;
  verificationUrl: string;
}) {
  await sendMail({
    html: renderEmail({
      body: 'Confirm your email address to finish setting up your LMS account.',
      ctaLabel: 'Verify email',
      ctaUrl: verificationUrl,
      title: 'Verify your email',
    }),
    subject: 'Verify your LMS email',
    text: `Verify your LMS email: ${verificationUrl}`,
    to: email,
  });
}

export async function sendPasswordResetEmail({
  email,
  resetUrl,
}: {
  email: string;
  resetUrl: string;
}) {
  await sendMail({
    html: renderEmail({
      body: 'Use this secure link to choose a new password for your LMS account.',
      ctaLabel: 'Reset password',
      ctaUrl: resetUrl,
      title: 'Reset your password',
    }),
    subject: 'Reset your LMS password',
    text: `Reset your LMS password: ${resetUrl}`,
    to: email,
  });
}

export async function sendPaymentApprovedEmail({
  amount,
  courseTitle,
  dashboardUrl,
  email,
  referenceCode,
  transactionId,
}: {
  amount: string;
  courseTitle: string;
  dashboardUrl: string;
  email: string;
  referenceCode: string;
  transactionId: string | null;
}) {
  await sendMail({
    html: renderEmail({
      body: `Your payment for ${courseTitle} has been approved. Amount: ${amount} BDT. Reference: ${referenceCode}. Transaction ID: ${transactionId ?? 'Not provided'}. Your enrollment is now active.`,
      ctaLabel: 'Open dashboard',
      ctaUrl: dashboardUrl,
      title: 'Payment approved',
    }),
    subject: 'Your LMS payment was approved',
    text: `Payment receipt\nCourse: ${courseTitle}\nAmount: ${amount} BDT\nReference: ${referenceCode}\nTransaction ID: ${transactionId ?? 'Not provided'}\n\nYour enrollment is active. Open your dashboard: ${dashboardUrl}`,
    to: email,
  });
}

export async function sendPaymentRejectedEmail({
  courseTitle,
  dashboardUrl,
  email,
  reason,
}: {
  courseTitle: string;
  dashboardUrl: string;
  email: string;
  reason: string;
}) {
  await sendMail({
    html: renderEmail({
      body: `Your payment proof for ${courseTitle} was rejected. Reason: ${reason}`,
      ctaLabel: 'Open dashboard',
      ctaUrl: dashboardUrl,
      title: 'Payment needs attention',
    }),
    subject: 'Your LMS payment needs attention',
    text: `Your payment proof for ${courseTitle} was rejected. Reason: ${reason}. Open your dashboard: ${dashboardUrl}`,
    to: email,
  });
}
