/**
 * Shared anomaly notification email helper.
 *
 * Used by anomaly module (when a new anomaly is reported), notification
 * module (test-email button), and system module (weekly attendance report).
 * Lives in shared/email/ so all three modules import a single canonical
 * implementation instead of duplicating it.
 */
import nodemailer from "nodemailer";

export async function sendAnomalyEmail(to: string[], subject: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER || "daos.ragic.system@gmail.com",
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"DAOS 打卡異常通知" <${process.env.GMAIL_USER || "daos.ragic.system@gmail.com"}>`,
    to: to.join(", "),
    subject,
    html: `<div style="font-family: 'Microsoft JhengHei', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${html}
      <hr style="margin-top: 20px; border: none; border-top: 1px solid #e5e7eb;" />
      <p style="color: #9ca3af; font-size: 12px;">此為系統自動發送的通知郵件，請勿直接回覆。</p>
    </div>`,
  });
}
