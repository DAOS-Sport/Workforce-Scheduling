/**
 * 排班、工時與勞基法共用的假別：班次 role 是其中之一就不算上班。
 * 打卡異常報表（server/modules/clock）另有一份內容不同的清單，值統一之前不能直接換成這份。
 */
export const LEAVE_TYPES: readonly string[] = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"];

/**
 * 員工前台與對外 CMS 判斷「這天休息」用的身分：假別再加育嬰、留職停薪、補休。
 * 這些班不能被當成上班顯示，否則員工會被誤判成在班。
 */
export const OFF_DUTY_ROLES: ReadonlySet<string> = new Set([...LEAVE_TYPES, "育嬰", "留職停薪", "補休"]);
