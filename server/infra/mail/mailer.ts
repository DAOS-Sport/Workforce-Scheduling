/**
 * server/infra/mail/mailer.ts
 *
 * Canonical email transport factory.
 * Provides a pre-configured nodemailer transporter and a low-level
 * sendMail helper. Higher-level helpers (e.g. sendAnomalyEmail) live in
 * server/shared/email/ and call this factory.
 *
 * New code that needs to send email should import createMailTransporter()
 * or sendMail() from this file.
 */
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";

const GMAIL_USER = process.env.GMAIL_USER || "daos.ragic.system@gmail.com";

export function createMailTransporter(): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

/**
 * Send an email via the shared Gmail transporter.
 * `options.from` defaults to the GMAIL_USER env var.
 */
export async function sendMail(options: Mail.Options): Promise<void> {
  const transporter = createMailTransporter();
  await transporter.sendMail({
    from: `"DAOS 系統通知" <${GMAIL_USER}>`,
    ...options,
  });
}
