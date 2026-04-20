import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Menu,
  X,
  User,
  Clock,
  LogOut,
  CalendarRange,
  CalendarDays,
  Users,
  FileEdit,
  TimerReset,
  MapPin,
  Phone,
  ChevronRight,
} from "lucide-react";

type MenuItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  badge?: string;
};

type MenuGroup = {
  id: string;
  title: string;
  items: MenuItem[];
};

const MENU_GROUPS: MenuGroup[] = [
  {
    id: "personal",
    title: "個人資訊",
    items: [
      { id: "profile", label: "個人檔案", icon: User, hint: "蔣鎮仁 (0811379) - 主管職" },
    ],
  },
  {
    id: "attendance",
    title: "日常考勤",
    items: [
      { id: "punch", label: "打卡首頁", icon: Clock },
      { id: "checkout", label: "外出簽到", icon: LogOut },
      { id: "stats", label: "本月出缺勤統計", icon: CalendarDays },
    ],
  },
  {
    id: "schedule",
    title: "排班與協作",
    items: [
      { id: "my-schedule", label: "我的班表", icon: CalendarRange },
      { id: "partners", label: "我的工作夥伴", icon: Users },
    ],
  },
  {
    id: "forms",
    title: "表單申請",
    items: [
      { id: "punch-fix", label: "補打卡申請", icon: FileEdit, badge: "剩餘 3 次" },
      { id: "overtime", label: "加班申請", icon: TimerReset },
    ],
  },
];

type Employee = {
  id: string;
  name: string;
  shift: string;
  phone: string;
};

type RoleGroup = {
  id: string;
  name: string;
  color: string;
  employees: Employee[];
};

type VenueGroup = {
  id: string;
  name: string;
  roles: RoleGroup[];
};

const MOCK_DATA: Record<number, VenueGroup[]> = {
  19: [
    {
      id: "xinbei",
      name: "新北",
      roles: [
        {
          id: "lifeguard",
          name: "救生",
          color: "bg-emerald-500",
          employees: [
            { id: "e1", name: "曾緯文", shift: "14:00-22:30", phone: "0912-345-678" },
            { id: "e2", name: "林宥廷", shift: "06:00-14:00", phone: "0922-111-222" },
            { id: "e3", name: "陳冠霖", shift: "10:00-18:00", phone: "0933-456-789" },
            { id: "e4", name: "黃柏睿", shift: "14:00-22:30", phone: "0955-789-456" },
            { id: "e5", name: "張勝凱", shift: "06:00-14:00", phone: "0966-321-654" },
          ],
        },
        {
          id: "counter",
          name: "櫃檯",
          color: "bg-sky-500",
          employees: [
            { id: "e6", name: "王怡君", shift: "09:00-17:30", phone: "0977-222-333" },
          ],
        },
      ],
    },
    {
      id: "shanggong",
      name: "商工",
      roles: [
        {
          id: "lifeguard-2",
          name: "救生",
          color: "bg-emerald-500",
          employees: [
            { id: "e7", name: "李宗翰", shift: "10:00-18:00", phone: "0988-654-321" },
            { id: "e8", name: "吳承恩", shift: "14:00-22:30", phone: "0911-987-654" },
          ],
        },
        {
          id: "counter-2",
          name: "櫃檯",
          color: "bg-sky-500",
          employees: [
            { id: "e9", name: "劉雅婷", shift: "12:00-20:00", phone: "0922-555-888" },
            { id: "e10", name: "林佳穎", shift: "08:00-16:00", phone: "0933-777-999" },
          ],
        },
      ],
    },
  ],
  25: [
    {
      id: "xinbei",
      name: "新北",
      roles: [
        {
          id: "lifeguard",
          name: "救生",
          color: "bg-emerald-500",
          employees: [
            { id: "e11", name: "周柏豪", shift: "06:00-14:00", phone: "0912-000-111" },
            { id: "e12", name: "蔡明哲", shift: "14:00-22:30", phone: "0922-333-444" },
          ],
        },
      ],
    },
    {
      id: "shanggong",
      name: "商工",
      roles: [
        {
          id: "counter-2",
          name: "櫃檯",
          color: "bg-sky-500",
          employees: [
            { id: "e13", name: "鄭宇翔", shift: "09:00-17:30", phone: "0955-666-777" },
          ],
        },
      ],
    },
  ],
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function buildDates(start = 17, count = 14) {
  return Array.from({ length: count }, (_, i) => {
    const day = start + i;
    const weekdayIdx = (4 + i) % 7;
    return { day, weekday: WEEKDAYS[weekdayIdx] };
  });
}

export default function MobileHrPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string>("partners");
  const [pageTitle, setPageTitle] = useState("我的工作夥伴");
  const dates = useMemo(() => buildDates(17, 14), []);
  const [selectedDay, setSelectedDay] = useState(19);

  const venues = MOCK_DATA[selectedDay] ?? [];
  const totalPeople = venues.reduce(
    (acc, v) => acc + v.roles.reduce((a, r) => a + r.employees.length, 0),
    0,
  );

  const handleMenuClick = (id: string, label: string) => {
    setActiveMenu(id);
    setPageTitle(label);
    setMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Navbar */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="p-2 -ml-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors"
            data-testid="button-open-menu"
            aria-label="開啟選單"
          >
            <Menu className="h-5 w-5 text-slate-700" />
          </button>
          <h1
            className="text-[15px] font-semibold tracking-tight text-slate-900"
            data-testid="text-page-title"
          >
            {pageTitle}
          </h1>
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100"
            data-testid="status-connection"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[11px] font-medium text-emerald-700">已連線</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="pb-10">
        {activeMenu === "partners" ? (
          <PartnersView
            dates={dates}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            venues={venues}
            totalPeople={totalPeople}
          />
        ) : (
          <UnderDevelopmentView title={pageTitle} />
        )}
      </main>

      {/* Sidebar Drawer */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-40 bg-slate-900/55 backdrop-blur-[2px]"
              onClick={() => setMenuOpen(false)}
              data-testid="overlay-sidebar"
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 w-[82%] max-w-sm bg-white shadow-2xl flex flex-col"
              data-testid="drawer-sidebar"
            >
              <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200">
                <span className="text-[13px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
                  系統主選單
                </span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="p-1.5 -mr-1.5 rounded-md hover:bg-slate-100 active:bg-slate-200 transition-colors"
                  data-testid="button-close-menu"
                  aria-label="關閉選單"
                >
                  <X className="h-4.5 w-4.5 text-slate-500" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-4">
                {MENU_GROUPS.map((group) => (
                  <div key={group.id} className="mb-5 last:mb-0">
                    <div className="px-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
                      {group.title}
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeMenu === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleMenuClick(item.id, item.label)}
                            className={[
                              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                              isActive
                                ? "bg-blue-50 text-blue-700"
                                : "text-slate-700 hover:bg-slate-100 active:bg-slate-200",
                            ].join(" ")}
                            data-testid={`menu-item-${item.id}`}
                          >
                            <Icon
                              className={[
                                "h-4 w-4 shrink-0",
                                isActive ? "text-blue-600" : "text-slate-500",
                              ].join(" ")}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-[13.5px] font-medium leading-tight">
                                {item.label}
                              </div>
                              {item.hint && (
                                <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                                  {item.hint}
                                </div>
                              )}
                            </div>
                            {item.badge && (
                              <span
                                className="text-[10.5px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium"
                                data-testid={`badge-${item.id}`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-5 py-3 border-t border-slate-200 text-center">
                <span className="text-[10px] tracking-[0.18em] text-slate-400 font-medium">
                  SMART SCHEDULE V2.0
                </span>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function PartnersView({
  dates,
  selectedDay,
  onSelectDay,
  venues,
  totalPeople,
}: {
  dates: { day: number; weekday: string }[];
  selectedDay: number;
  onSelectDay: (d: number) => void;
  venues: VenueGroup[];
  totalPeople: number;
}) {
  return (
    <>
      {/* Date picker */}
      <section className="bg-white border-b border-slate-200">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <div className="text-[11px] font-medium text-slate-400 tracking-wider">
              2026 年 4 月
            </div>
            <div className="text-[15px] font-semibold text-slate-900 mt-0.5">
              {selectedDay} 日 · 共 {totalPeople} 位夥伴
            </div>
          </div>
        </div>
        <div className="overflow-x-auto scrollbar-hide pb-3 px-3">
          <div className="flex gap-1.5">
            {dates.map(({ day, weekday }) => {
              const isActive = day === selectedDay;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className="relative flex flex-col items-center justify-center w-12 h-16 rounded-2xl transition-colors shrink-0"
                  data-testid={`button-date-${day}`}
                >
                  <span
                    className={[
                      "text-[10.5px] font-medium mb-1 transition-colors",
                      isActive ? "text-slate-900" : "text-slate-400",
                    ].join(" ")}
                  >
                    {weekday}
                  </span>
                  <div className="relative w-9 h-9 flex items-center justify-center">
                    {isActive && (
                      <motion.div
                        layoutId="date-active-bg"
                        className="absolute inset-0 rounded-full bg-slate-900 shadow-lg shadow-slate-900/20"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                    <span
                      className={[
                        "relative text-[14px] font-semibold transition-colors",
                        isActive ? "text-white" : "text-slate-700",
                      ].join(" ")}
                    >
                      {day}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Grouped employee list */}
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedDay}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {venues.length === 0 ? (
            <div className="px-6 py-20 text-center text-sm text-slate-400">
              當日無排班資料
            </div>
          ) : (
            venues.map((venue) => (
              <section key={venue.id} data-testid={`venue-${venue.id}`}>
                <div className="sticky top-14 z-20 bg-slate-50/95 backdrop-blur px-4 py-2.5 border-b border-slate-200/80">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-slate-500" />
                    <span className="text-[12.5px] font-semibold text-slate-700 tracking-wide">
                      {venue.name}
                    </span>
                  </div>
                </div>

                {venue.roles.map((role) => (
                  <div key={role.id} data-testid={`role-${venue.id}-${role.id}`}>
                    <div className="sticky top-[88px] z-10 bg-white/95 backdrop-blur px-4 py-2 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${role.color}`} />
                        <span className="text-[12px] font-medium text-slate-600">
                          {role.name}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          ({role.employees.length}人)
                        </span>
                      </div>
                    </div>

                    <ul className="bg-white">
                      {role.employees.map((emp, idx) => (
                        <li
                          key={emp.id}
                          className={[
                            "flex items-center justify-between px-4 py-3 transition-colors hover:bg-slate-50/70",
                            idx !== role.employees.length - 1
                              ? "border-b border-slate-100"
                              : "",
                          ].join(" ")}
                          data-testid={`card-employee-${emp.id}`}
                        >
                          <div className="min-w-0">
                            <div
                              className="text-[14px] font-medium text-slate-900"
                              data-testid={`text-employee-name-${emp.id}`}
                            >
                              {emp.name}
                            </div>
                            <div
                              className="text-[11.5px] text-slate-400 mt-0.5 tabular-nums"
                              data-testid={`text-employee-shift-${emp.id}`}
                            >
                              {emp.shift}
                            </div>
                          </div>
                          <a
                            href={`tel:${emp.phone}`}
                            className="flex items-center justify-center h-9 w-9 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 active:bg-emerald-200 transition-colors"
                            data-testid={`button-call-${emp.id}`}
                            aria-label={`致電 ${emp.name}`}
                          >
                            <Phone className="h-4 w-4" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function UnderDevelopmentView({ title }: { title: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center px-8 text-center"
      style={{ minHeight: "calc(100vh - 3.5rem)" }}
      data-testid="view-under-development"
    >
      <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-5">
        <ChevronRight className="h-7 w-7 text-slate-400" />
      </div>
      <div className="text-[11px] font-semibold tracking-[0.22em] text-slate-400 uppercase">
        Under Development
      </div>
      <h2 className="mt-2 text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-500 max-w-xs leading-relaxed">
        此功能正在開發中，敬請期待。我們會在下個版本為您帶來更完整的體驗。
      </p>
    </div>
  );
}
