import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Calendar,
  Users,
  Building2,
  ClipboardCheck,
  MapPin,
  ShieldAlert,
  CalendarCheck,
  Clock,
  FileSpreadsheet,
  CalendarOff,
  BookOpen,
  UserCheck,
  Bell,
  Settings,
  ChevronRight,
  Info,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  ArrowRight,
  ListChecks,
} from "lucide-react";

/* ─── SOP 資料結構 ──────────────────────────────────────────── */

interface Step {
  text: string;
  note?: string;
  warn?: string;
  tip?: string;
}

interface SubSection {
  title: string;
  steps: Step[];
}

interface Section {
  id: string;
  icon: React.ElementType;
  title: string;
  badge?: string;
  color: string;
  intro: string;
  subsections: SubSection[];
}

const sections: Section[] = [
  /* ─── 1. 排班管理 ─────────────────────────────── */
  {
    id: "schedule",
    icon: Calendar,
    title: "排班管理",
    color: "blue",
    intro: "排班編輯頁面是系統核心，支援週視圖的班次建立、批次操作、派遣人員管理及勞基法即時合規驗證。",
    subsections: [
      {
        title: "建立單筆班次",
        steps: [
          { text: "進入「排班編輯」，選擇上方區域分頁（三重、蘆洲等）及目標週次。" },
          { text: "點擊員工列與日期欄交叉的儲存格，彈出班次編輯器。" },
          { text: "選擇班別（開門班/關門班/一般班等）、起訖時間、場館，填寫備注。" },
          { text: "儲存後系統自動執行勞基法驗證（11小時間距、連續7天、四週160h/176h）。", note: "出現紅色警告代表違規，黃色代表提醒，綠色代表合規。" },
          { text: "如需跨區派遣，選擇「派遣至」欄位指定目的區域，該班次同時出現在兩個區域。" },
        ],
      },
      {
        title: "批次新增班次",
        steps: [
          { text: "點擊排班頁工具列「批次新增」按鈕。" },
          { text: "選擇員工（可多選）、班別、場館、日期範圍。" },
          { text: "確認後一次建立所有組合的班次，適合週期性排班。", tip: "批次後仍可對單筆班次進行編輯或刪除。" },
        ],
      },
      {
        title: "套用班表範本",
        steps: [
          { text: "工具列點擊「套用範本」，選擇已儲存的範本名稱。" },
          { text: "選擇目標週次後確認，範本中所有班次批次寫入。" },
          { text: "套用後可個別調整，範本不會被修改。" },
        ],
      },
      {
        title: "派遣人員班次管理",
        steps: [
          { text: "排班頁下方「派遣人員」區塊，點擊「新增派遣」填寫姓名、班別、日期。" },
          { text: "若要取消派遣班次，點擊刪除（軟刪除，不會真正移除）。" },
          { text: "工具列「取消記錄」可查看所有已取消的派遣班次，並可選擇「還原」。", note: "還原後班次重新出現於排班表。" },
          { text: "工具列「回填連結」可自動將派遣姓名比對系統員工，補上員工 ID 連結。" },
        ],
      },
    ],
  },
  /* ─── 2. 員工管理 ─────────────────────────────── */
  {
    id: "employees",
    icon: Users,
    title: "員工管理",
    color: "violet",
    intro: "維護員工基本資料、所屬區域與場館、LINE 綁定狀態，並可與 Ragic 雲端資料庫進行雙向同步。",
    subsections: [
      {
        title: "新增 / 編輯員工",
        steps: [
          { text: "進入「員工管理」，點擊「新增員工」按鈕。" },
          { text: "填寫員工編號（唯一）、姓名、所屬區域、角色（教練/助理等）。" },
          { text: "設定所屬場館（可多選）後儲存。" },
          { text: "如需編輯，點擊員工列右側的編輯圖示進行修改。", tip: "員工編號變更後，LINE 綁定不受影響（綁定的是 LINE User ID）。" },
        ],
      },
      {
        title: "從 Ragic 同步員工資料",
        steps: [
          { text: "點擊「同步 Ragic」按鈕，系統自動從 Ragic 拉取最新員工清單。" },
          { text: "新員工自動新增，現有員工資料（姓名、部門）自動更新。", warn: "同步不會刪除本地員工，只會新增或更新。" },
          { text: "同步完成後頁面自動刷新顯示最新狀態。" },
        ],
      },
      {
        title: "LINE 帳號綁定確認",
        steps: [
          { text: "員工列中「LINE 綁定」欄位顯示綠色勾代表已綁定，灰色代表尚未綁定。" },
          { text: "員工需加入官方帳號好友後，傳送自己的員工編號文字訊息完成綁定。" },
          { text: "綁定後即可使用 LIFF 打卡、查詢班表、查閱守則等功能。", note: "若員工換手機或 LINE 帳號，需請 IT 清除舊綁定後重新操作。" },
        ],
      },
    ],
  },
  /* ─── 3. 場館管理 ─────────────────────────────── */
  {
    id: "venues",
    icon: Building2,
    title: "場館管理",
    color: "emerald",
    intro: "管理各場館的基本資料，包含名稱、所屬區域、地址及座標，用於 GPS 打卡範圍驗證。",
    subsections: [
      {
        title: "新增 / 編輯場館",
        steps: [
          { text: "進入「場館管理」，點擊「新增場館」。" },
          { text: "填寫場館名稱、所屬區域、地址。" },
          { text: "輸入 GPS 座標（緯度/經度），用於員工打卡位置驗證。", tip: "可用 Google Maps 右鍵複製座標。" },
          { text: "儲存後該場館即可在排班、員工設定、打卡中使用。" },
        ],
      },
      {
        title: "同步場館至 Ragic",
        steps: [
          { text: "點擊「同步至 Ragic」，將本系統場館清單推送至 Ragic 資料庫。" },
          { text: "同步成功後 Ragic 端的場館資料會更新為最新狀態。" },
        ],
      },
    ],
  },
  /* ─── 4. GPS 打卡審核 ─────────────────────────── */
  {
    id: "clock",
    icon: MapPin,
    title: "GPS 打卡審核",
    badge: "含加班 / 補打卡",
    color: "orange",
    intro: "員工透過 LINE LIFF 完成 GPS 打卡，管理員在此頁審核補打卡申請、加班申請，並查閱所有打卡紀錄。",
    subsections: [
      {
        title: "查閱打卡紀錄",
        steps: [
          { text: "進入「GPS 打卡」頁，選擇日期區間或員工篩選。" },
          { text: "表格顯示每筆打卡的時間、位置、距離場館距離、早/準時/遲到狀態。" },
          { text: "點擊「查看地圖」可在 Google Maps 確認打卡座標。" },
        ],
      },
      {
        title: "審核補打卡申請",
        steps: [
          { text: "員工未正常打卡時，可在員工端提交補打卡申請（填寫原因）。" },
          { text: "後台「待審核」分頁顯示所有待處理申請，側邊欄顯示待處理筆數。" },
          { text: "審核通過後，該筆打卡記錄正式計入考勤。", warn: "拒絕時需填寫拒絕理由，系統會通知員工。" },
        ],
      },
      {
        title: "審核加班申請",
        steps: [
          { text: "員工打卡下班時選擇「加班」，系統自動建立加班申請。" },
          { text: "進入「GPS 打卡 → 加班申請」分頁查看待審項目。" },
          { text: "核准後加班時數自動計入該月薪資報表的加班欄位。" },
        ],
      },
    ],
  },
  /* ─── 5. 打卡異常 ─────────────────────────────── */
  {
    id: "anomaly",
    icon: ShieldAlert,
    title: "打卡異常處理",
    color: "red",
    intro: "員工打卡失敗或系統偵測到異常時，自動建立異常報告並發送 Email 通知，管理員在此集中處理。",
    subsections: [
      {
        title: "查看異常報告",
        steps: [
          { text: "進入「打卡異常」頁，顯示所有待處理及已處理的異常清單。" },
          { text: "每筆報告包含員工資訊、異常類型、發生時間、員工附圖（如有）。" },
          { text: "點擊報告可查看完整內容與員工自述。" },
        ],
      },
      {
        title: "批次處理異常",
        steps: [
          { text: "勾選多筆異常，點擊「批次處理」。" },
          { text: "選擇處理結果（已解決／不需處理／待追蹤）並填寫備注。" },
          { text: "確認後所有選取項目狀態更新，並從待處理清單移除。", tip: "處理完畢後側邊欄的異常計數器自動歸零。" },
        ],
      },
      {
        title: "設定異常通知信箱",
        steps: [
          { text: "至「守則與公告」頁面下方找到「Email 通知設定」。" },
          { text: "新增管理員 Email，新增後所有新異常報告都會發送通知。" },
          { text: "可設定多個收件者，每人可獨立啟用/停用。" },
        ],
      },
    ],
  },
  /* ─── 6. 考勤稽核 ─────────────────────────────── */
  {
    id: "attendance",
    icon: ClipboardCheck,
    title: "考勤稽核（XLSX 匯入）",
    color: "teal",
    intro: "支援從外部考勤系統匯出的 XLSX 檔案匯入，與本系統班表進行比對稽核。",
    subsections: [
      {
        title: "匯入考勤 XLSX",
        steps: [
          { text: "進入「考勤稽核」，點擊「匯入考勤資料」。" },
          { text: "選擇從駿斯考勤系統匯出的 XLSX 檔案（請確認格式符合範本）。" },
          { text: "系統解析後顯示匯入結果預覽，確認員工數與日期範圍正確。", warn: "若欄位格式不符，請使用提供的 XLSX 範本重新整理後再匯入。" },
          { text: "確認匯入後，考勤資料與班表進行比對，差異會標示顏色。" },
        ],
      },
      {
        title: "刪除匯入批次",
        steps: [
          { text: "在已匯入清單中找到目標批次，點擊「刪除」。" },
          { text: "確認後該批次所有考勤記錄移除，排班表不受影響。" },
        ],
      },
    ],
  },
  /* ─── 7. 週報打卡 ─────────────────────────────── */
  {
    id: "weekly",
    icon: CalendarCheck,
    title: "週報打卡",
    color: "indigo",
    intro: "以週為單位查看每位員工的打卡狀況，可一鍵推送 LINE 通知提醒未打卡人員，或以 Email 發送週報摘要。",
    subsections: [
      {
        title: "查看週報狀況",
        steps: [
          { text: "進入「週報打卡」，選擇目標週（週一至週日）。" },
          { text: "表格依員工列出每天的打卡狀態：已到班✓、缺勤✗、請假L、休息-。" },
          { text: "最右側顯示當週出勤天數合計。" },
        ],
      },
      {
        title: "推送 LINE 通知",
        steps: [
          { text: "點擊「推送 LINE 通知」，系統對所有本週有缺勤（應到未到）的員工發送提醒。" },
          { text: "員工在 LINE 收到通知，提示需補打卡或聯繫主管。", note: "僅通知尚未處理的缺勤，已有補打卡申請的不重複通知。" },
        ],
      },
      {
        title: "發送 Email 週報",
        steps: [
          { text: "點擊「Email 週報」，系統自動統計本週考勤數據。" },
          { text: "Email 發送至所有已設定的管理員信箱，包含出缺勤統計表。" },
        ],
      },
    ],
  },
  /* ─── 8. 工時總表 ─────────────────────────────── */
  {
    id: "salary",
    icon: Clock,
    title: "工時總表（薪資報表）",
    color: "amber",
    intro: "按月統計每位員工的排班工時、加班時數、請假類型，支援 CSV 和 Excel 雙格式匯出。",
    subsections: [
      {
        title: "查看當月工時",
        steps: [
          { text: "進入「工時總表」，選擇年月。" },
          { text: "表格顯示每位員工：正常工時、加班工時、各類假別天數。" },
          { text: "點擊員工姓名可展開查看逐日班次明細。" },
        ],
      },
      {
        title: "匯出 CSV",
        steps: [
          { text: "點擊「匯出 CSV」，瀏覽器下載該月工時總表的 CSV 格式。" },
          { text: "可直接用 Excel 開啟進行薪資計算。" },
        ],
      },
      {
        title: "匯出 Excel（雙工作表）",
        steps: [
          { text: "點擊「匯出 Excel」，下載含兩個工作表的 .xlsx 檔案。" },
          { text: "工作表一「工時彙總」：每位員工當月工時、加班、假別統計。" },
          { text: "工作表二「派遣明細」：當月所有已連結員工的派遣班次詳情。", tip: "Excel 格式適合直接提交給薪資作業人員使用。" },
        ],
      },
    ],
  },
  /* ─── 9. 請假管理 ─────────────────────────────── */
  {
    id: "leave",
    icon: CalendarOff,
    title: "請假管理",
    color: "pink",
    intro: "員工可透過員工端申請請假，管理員在此審核，核准後自動在排班表標記並計入工時計算。",
    subsections: [
      {
        title: "審核請假申請",
        steps: [
          { text: "進入「請假管理」，待審項目顯示在「待審核」分頁，側邊欄顯示待審計數。" },
          { text: "查看申請詳情：員工、假別（特休/病假/事假/婚假等）、日期、原因。" },
          { text: "點擊「核准」或「拒絕」，拒絕需填寫理由。" },
          { text: "核准後排班表對應日期自動標記假別，工時計算排除該班次。" },
        ],
      },
      {
        title: "假別與勞基法說明",
        steps: [
          { text: "特休假（A）：計入出勤，不影響四週彈性工時計算。" },
          { text: "病假（S）、事假（P）：視為缺勤，扣除工時。" },
          { text: "公假、婚假、喪假：系統記錄但不扣工時，需另行確認。", note: "勞基法合規驗證會自動跳過有效假期當天的違規判斷。" },
        ],
      },
    ],
  },
  /* ─── 10. 守則與公告 ──────────────────────────── */
  {
    id: "guidelines",
    icon: BookOpen,
    title: "守則與公告",
    color: "cyan",
    intro: "管理員工必讀的固定守則、每月說明文件、保密同意書，以及向特定區域發布的公告。員工需在員工端確認閱覽。",
    subsections: [
      {
        title: "新增守則文件",
        steps: [
          { text: "進入「守則與公告」，選擇「固定守則」或「每月說明」分頁，點擊「新增」。" },
          { text: "填寫標題、內容文字，可上傳圖片或影片連結。" },
          { text: "設定適用區域（可選全部）、是否啟用、排序。" },
          { text: "儲存後員工登入員工端時，系統自動要求閱覽確認未讀文件。" },
        ],
      },
      {
        title: "發布公告",
        steps: [
          { text: "切換到「公告」分頁，點擊「新增公告」。" },
          { text: "填寫公告標題、內容、適用區域、到期日。" },
          { text: "啟用後，對應區域員工登入員工端立即看到公告橫幅。", tip: "超過到期日的公告自動停止顯示，無需手動關閉。" },
        ],
      },
      {
        title: "查看守則簽署紀錄",
        steps: [
          { text: "進入「守則簽署紀錄」頁，可依守則或依員工篩選查詢。" },
          { text: "顯示每位員工對每份文件的確認時間。" },
          { text: "未確認的員工可在此名單中辨識，必要時可提醒員工登入確認。" },
        ],
      },
    ],
  },
  /* ─── 11. 報表匯出 ────────────────────────────── */
  {
    id: "reports",
    icon: FileSpreadsheet,
    title: "報表匯出",
    color: "slate",
    intro: "彙整各類報表一次下載，包含班表報表、工時統計、勞基法合規報告等。",
    subsections: [
      {
        title: "匯出班表 CSV",
        steps: [
          { text: "進入「報表匯出」，選擇區域與日期範圍。" },
          { text: "點擊「匯出班表」下載該期間所有班次的 CSV。" },
          { text: "欄位含員工、日期、班別、場館、工時，可用於外部薪資系統。" },
        ],
      },
      {
        title: "勞基法合規報告",
        steps: [
          { text: "選擇區域與四週週期，點擊「合規報告」。" },
          { text: "報告顯示每位員工的四週總工時、是否超過 160h/176h 上限。" },
          { text: "標紅色的員工需立即調整排班以符合規定。", warn: "此報告為參考，請以實際打卡紀錄為準。" },
        ],
      },
    ],
  },
  /* ─── 12. 員工端（員工 Portal）──────────────── */
  {
    id: "portal",
    icon: UserCheck,
    title: "員工端操作說明",
    color: "green",
    intro: "員工透過 LINE 登入專屬員工端，可查詢班表、閱覽守則、查看同班同事、外出簽到，以及申請補打卡/請假。",
    subsections: [
      {
        title: "員工第一次登入流程",
        steps: [
          { text: "員工先加入公司 LINE 官方帳號好友。" },
          { text: "在聊天室傳送自己的員工編號（例如：E001）完成帳號綁定。" },
          { text: "點擊選單中的「員工入口」連結，使用 LINE 帳號登入。" },
          { text: "首次登入系統自動列出待確認的守則文件，需逐一閱覽確認。" },
        ],
      },
      {
        title: "查詢個人班表",
        steps: [
          { text: "員工端首頁顯示未來 7 天的班次清單。" },
          { text: "點擊任一班次可查看詳情：場館地址、班別時間、備注。" },
          { text: "「我的班表」頁面可查詢任意週次的完整班表。" },
        ],
      },
      {
        title: "外出打卡（Outing）",
        steps: [
          { text: "員工需外出至場館以外地點時，使用員工端「外出打卡」功能。" },
          { text: "填寫外出地點/事由，系統記錄 GPS 座標並上傳。" },
          { text: "返回後同樣在員工端點擊「返回打卡」完成記錄。", note: "外出記錄可在後台「GPS 打卡」頁查閱。" },
        ],
      },
    ],
  },
  /* ─── 13. 系統通知設定 ────────────────────────── */
  {
    id: "notifications",
    icon: Bell,
    title: "自動通知設定",
    color: "yellow",
    intro: "系統可自動推送班次提醒、缺勤提醒至員工 LINE，並發送 Email 通知至管理員信箱。",
    subsections: [
      {
        title: "班次提醒（排班前一天）",
        steps: [
          { text: "系統每日固定時間（預設 20:00）自動推送隔日班次至員工 LINE。" },
          { text: "已綁定 LINE 的員工自動收到，未綁定者不受影響。", note: "推送時間可由系統管理員在功能旗標設定調整。" },
        ],
      },
      {
        title: "缺勤未打卡提醒",
        steps: [
          { text: "系統偵測應到班但未打卡的員工，自動於班次結束後發送 LINE 提醒。" },
          { text: "員工可點擊連結直接申請補打卡。" },
        ],
      },
      {
        title: "管理員 Email 設定",
        steps: [
          { text: "進入「守則與公告」頁面，找到「Email 通知管理」區塊。" },
          { text: "點擊「新增收件者」，輸入 Email 並設定通知類型。" },
          { text: "點擊「發送測試信」確認 Email 設定正確。", tip: "建議至少設定 2 位收件者以避免通知遺漏。" },
        ],
      },
    ],
  },
  /* ─── 14. 常見問題排查 ───────────────────────── */
  {
    id: "troubleshoot",
    icon: Settings,
    title: "常見問題排查",
    color: "gray",
    intro: "整理管理員在日常操作中最常遇到的問題及解決方式。",
    subsections: [
      {
        title: "員工打卡失敗",
        steps: [
          { text: "確認員工已加入官方帳號好友並完成員工編號綁定。" },
          { text: "確認員工手機 GPS 已開啟，且允許 LINE 取得位置權限。" },
          { text: "確認打卡場館的 GPS 座標已正確設定於場館管理頁面。", warn: "若距離超過設定容差（預設 300 公尺），打卡會被標記為異常。" },
          { text: "異常仍可由員工提交補打卡申請，管理員審核後補記。" },
        ],
      },
      {
        title: "勞基法警告誤觸",
        steps: [
          { text: "確認員工的假別已正確核准（系統驗證跳過請假日）。" },
          { text: "確認班次時間設定正確，11 小時間距從「下班時間」到「隔日上班時間」計算。" },
          { text: "四週工時超限：調整班次工時分布，或確認是否有加班時數未計入。" },
        ],
      },
      {
        title: "Ragic 同步失敗",
        steps: [
          { text: "確認伺服器環境變數 RAGIC_API_KEY 設定正確。" },
          { text: "確認 Ragic 帳號有對應資料表的讀取/寫入權限。" },
          { text: "網路連線問題時，可稍後重試，同步為冪等操作不會重複新增。" },
        ],
      },
      {
        title: "守則未顯示給員工",
        steps: [
          { text: "確認守則已設定為「啟用」狀態。" },
          { text: "確認守則的適用區域包含該員工所屬區域。" },
          { text: "員工已確認過的守則不會再次彈出，若要重新顯示需新增版本。" },
        ],
      },
    ],
  },
];

/* ─── 色彩對應表 ──────────────────────────────────── */
const colorMap: Record<string, { bg: string; text: string; border: string; badge: string; dot: string }> = {
  blue:    { bg: "bg-blue-50 dark:bg-blue-950/30",    text: "text-blue-700 dark:text-blue-300",    border: "border-blue-200 dark:border-blue-800",   badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",    dot: "bg-blue-500" },
  violet:  { bg: "bg-violet-50 dark:bg-violet-950/30", text: "text-violet-700 dark:text-violet-300", border: "border-violet-200 dark:border-violet-800", badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300", dot: "bg-violet-500" },
  emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300", dot: "bg-emerald-500" },
  orange:  { bg: "bg-orange-50 dark:bg-orange-950/30",  text: "text-orange-700 dark:text-orange-300",  border: "border-orange-200 dark:border-orange-800",  badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",  dot: "bg-orange-500" },
  red:     { bg: "bg-red-50 dark:bg-red-950/30",     text: "text-red-700 dark:text-red-300",     border: "border-red-200 dark:border-red-800",    badge: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",     dot: "bg-red-500" },
  teal:    { bg: "bg-teal-50 dark:bg-teal-950/30",    text: "text-teal-700 dark:text-teal-300",    border: "border-teal-200 dark:border-teal-800",   badge: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300",    dot: "bg-teal-500" },
  indigo:  { bg: "bg-indigo-50 dark:bg-indigo-950/30", text: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-200 dark:border-indigo-800", badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300", dot: "bg-indigo-500" },
  amber:   { bg: "bg-amber-50 dark:bg-amber-950/30",   text: "text-amber-700 dark:text-amber-300",   border: "border-amber-200 dark:border-amber-800",  badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",   dot: "bg-amber-500" },
  pink:    { bg: "bg-pink-50 dark:bg-pink-950/30",    text: "text-pink-700 dark:text-pink-300",    border: "border-pink-200 dark:border-pink-800",   badge: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300",    dot: "bg-pink-500" },
  cyan:    { bg: "bg-cyan-50 dark:bg-cyan-950/30",    text: "text-cyan-700 dark:text-cyan-300",    border: "border-cyan-200 dark:border-cyan-800",   badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",    dot: "bg-cyan-500" },
  slate:   { bg: "bg-slate-50 dark:bg-slate-950/30",   text: "text-slate-700 dark:text-slate-300",   border: "border-slate-200 dark:border-slate-800",  badge: "bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300",   dot: "bg-slate-500" },
  green:   { bg: "bg-green-50 dark:bg-green-950/30",   text: "text-green-700 dark:text-green-300",   border: "border-green-200 dark:border-green-800",  badge: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",   dot: "bg-green-500" },
  yellow:  { bg: "bg-yellow-50 dark:bg-yellow-950/30", text: "text-yellow-700 dark:text-yellow-300", border: "border-yellow-200 dark:border-yellow-800", badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300", dot: "bg-yellow-500" },
  gray:    { bg: "bg-gray-50 dark:bg-gray-950/30",    text: "text-gray-700 dark:text-gray-300",    border: "border-gray-200 dark:border-gray-800",   badge: "bg-gray-100 text-gray-700 dark:bg-gray-900/50 dark:text-gray-300",    dot: "bg-gray-500" },
};

/* ─── 步驟卡片 ────────────────────────────────────── */
function StepItem({ step, index }: { step: Step; index: number }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold mt-0.5">
        {index + 1}
      </div>
      <div className="flex-1 space-y-1.5">
        <p className="text-sm leading-relaxed text-foreground">{step.text}</p>
        {step.note && (
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{step.note}</span>
          </div>
        )}
        {step.warn && (
          <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md px-2.5 py-1.5 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{step.warn}</span>
          </div>
        )}
        {step.tip && (
          <div className="flex items-start gap-1.5 text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded-md px-2.5 py-1.5 border border-blue-200 dark:border-blue-800">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{step.tip}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── 主頁面 ──────────────────────────────────────── */
export default function SopPage() {
  const [activeId, setActiveId] = useState<string>(sections[0].id);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /* 滾動時更新 active section */
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handleScroll = () => {
      const scrollTop = container.scrollTop + 80;
      let current = sections[0].id;
      for (const sec of sections) {
        const el = sectionRefs.current[sec.id];
        if (el && el.offsetTop <= scrollTop) current = sec.id;
      }
      setActiveId(current);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = sectionRefs.current[id];
    const container = contentRef.current;
    if (el && container) {
      container.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-background" data-testid="page-sop">
      {/* ── 左側目錄 ── */}
      <aside className="hidden lg:flex w-56 xl:w-64 flex-col border-r border-border shrink-0">
        <div className="px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">系統 SOP 目錄</h2>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">共 {sections.length} 個功能模組</p>
        </div>
        <ScrollArea className="flex-1">
          <nav className="py-2 px-2 space-y-0.5" data-testid="nav-sop-toc">
            {sections.map((sec, idx) => {
              const c = colorMap[sec.color];
              const isActive = activeId === sec.id;
              return (
                <button
                  key={sec.id}
                  data-testid={`link-sop-${sec.id}`}
                  onClick={() => scrollTo(sec.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-all",
                    isActive
                      ? `${c.bg} ${c.text} font-semibold`
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <span className={cn("flex-shrink-0 relative flex items-center justify-center h-6 w-6 rounded-md", isActive ? c.badge : "bg-muted text-muted-foreground")}>
                    <sec.icon className="h-3.5 w-3.5" />
                    <span className="absolute -bottom-1 -right-1 flex items-center justify-center h-3.5 w-3.5 rounded-full bg-background border border-border text-[8px] font-bold leading-none text-foreground">
                      {idx + 1}
                    </span>
                  </span>
                  <span className="truncate flex-1">{sec.title}</span>
                  {isActive && <ChevronRight className="h-3 w-3 shrink-0" />}
                </button>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* ── 右側內容 ── */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        {/* 頂部標題 */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4.5 w-4.5 text-primary" />
            <h1 className="text-sm font-bold">三蘆智慧管理 — 系統操作 SOP</h1>
          </div>
          <Badge variant="secondary" className="text-[11px]">115年版</Badge>
        </div>

        <div className="max-w-3xl mx-auto px-6 py-6 space-y-10">
          {/* 總覽卡片 */}
          <div className="rounded-xl border border-border bg-gradient-to-br from-primary/5 to-primary/0 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">本文件涵蓋系統全部功能模組的操作說明</p>
                <p className="text-xs text-muted-foreground mt-1">
                  包含排班管理、員工與場館、打卡系統、考勤稽核、薪資報表、守則公告、請假管理及常見問題排查，共 {sections.length} 個模組、
                  {sections.reduce((a, s) => a + s.subsections.reduce((b, ss) => b + ss.steps.length, 0), 0)} 個操作步驟。
                </p>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                  <ArrowRight className="h-3 w-3" />
                  <span>點擊左側目錄快速跳轉；或直接向下捲動閱覽。</span>
                </div>
              </div>
            </div>
          </div>

          {/* 各區段 */}
          {sections.map((sec, idx) => {
            const c = colorMap[sec.color];
            const Icon = sec.icon;
            return (
              <div
                key={sec.id}
                ref={(el) => { sectionRefs.current[sec.id] = el; }}
                data-testid={`section-sop-${sec.id}`}
                className="scroll-mt-16 space-y-4"
              >
                {/* 區段標題列 */}
                <div className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border", c.bg, c.border)}>
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg shrink-0", c.badge)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className={cn("text-sm font-bold", c.text)}>
                        {idx + 1}. {sec.title}
                      </h2>
                      {sec.badge && (
                        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full border", c.badge, c.border)}>
                          {sec.badge}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 模組簡介 */}
                <p className="text-xs text-muted-foreground px-1 leading-relaxed">{sec.intro}</p>

                {/* 子章節 */}
                <div className="space-y-4">
                  {sec.subsections.map((sub) => (
                    <div key={sub.title} className="rounded-xl border border-border bg-card">
                      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
                        <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", c.dot)} />
                        <h3 className="text-xs font-semibold text-foreground">{sub.title}</h3>
                      </div>
                      <div className="px-4 py-3 space-y-3">
                        {sub.steps.map((step, i) => (
                          <StepItem key={i} step={step} index={i} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* 底部版本說明 */}
          <div className="border-t border-border pt-6 pb-4 text-center space-y-1">
            <p className="text-xs font-medium text-muted-foreground">三蘆智慧管理 PT 排班系統 — 系統操作 SOP</p>
            <p className="text-[11px] text-muted-foreground">115年版 · 如有疑問請聯繫系統管理員</p>
          </div>
        </div>
      </div>
    </div>
  );
}
