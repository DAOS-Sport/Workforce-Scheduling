/**
 * 異常通報信。異常模組（新通報）、通知模組（測試信按鈕）與系統模組（週出勤報告）共用。
 */
import { MAIL_SENDER, sendMail } from "../../adapters/mail";
import { wrapNotificationHtml } from "./notificationLayout";

export async function sendAnomalyEmail(
  to: string[],
  subject: string,
  html: string,
): Promise<void> {
  await sendMail({
    from: `"DAOS 打卡異常通知" <${MAIL_SENDER}>`,
    to: to.join(", "),
    subject,
    html: wrapNotificationHtml(html),
  });
}
