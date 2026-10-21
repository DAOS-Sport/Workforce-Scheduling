/** 系統通知信的共用外框：微軟正黑體、600px 寬、底部加「請勿直接回覆」。 */
export function wrapNotificationHtml(html: string): string {
  return `<div style="font-family: 'Microsoft JhengHei', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${html}
      <hr style="margin-top: 20px; border: none; border-top: 1px solid #e5e7eb;" />
      <p style="color: #9ca3af; font-size: 12px;">此為系統自動發送的通知郵件，請勿直接回覆。</p>
    </div>`;
}
