/**
 * Gmail SMTP 的唯一對外出口。信件內容與寄件人名稱由呼叫端決定（見 server/shared/email/）。
 */
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { recordIntegration } from "../shared/health/healthState";

/** 寄件信箱。`from` 欄位要用這個地址，Gmail 才會接受。 */
export const MAIL_SENDER = process.env.GMAIL_USER || "daos.ragic.system@gmail.com";

function createMailTransporter(): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: MAIL_SENDER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

/** 寄一封信；沒給 `from` 時用「DAOS 系統通知」。失敗會丟錯，由呼叫端處理。 */
export async function sendMail(options: Mail.Options): Promise<void> {
  const transporter = createMailTransporter();
  try {
    await transporter.sendMail({
      from: `"DAOS 系統通知" <${MAIL_SENDER}>`,
      ...options,
    });
  } catch (err) {
    recordIntegration("mail", false, err);
    throw err;
  }
  recordIntegration("mail", true);
}
