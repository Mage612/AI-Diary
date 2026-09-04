import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarCheck, CheckSquare, Download, FileJson, Heart, KeyRound, ListTodo, LogOut, MessageCircle, Pencil, Send, Table2, Trash2 } from "lucide-react";
import "./styles.css";

const MESSAGE_KEY = "ai-dairy.messages.v0";
const DAILY_KEY = "ai-dairy.daily-records.v0";
const DAY_PLANS_KEY = "ai-dairy.day-plans.v0";
const WEEK_PLANS_KEY = "ai-dairy.week-plans.v0";
const MODES = [
  { key: "PLAN", label: "今日计划", icon: ListTodo },
  { key: "SUMMARY", label: "今日总结", icon: CalendarCheck },
  { key: "CHAT", label: "情绪聊天", icon: Heart }
];
const EXPORT_COLUMNS = [
  ["日期", "date"], ["周几", "weekday"], ["原始记录", "raw_query"], ["科研学习", "research"],
  ["工作求职", "work"], ["技能成长", "growth"], ["幸福小事", "happiness"], ["情绪", "emotion"],
  ["其他", "others"], ["AI今日总结", "summary"], ["明日建议", "tomorrow_plan"], ["记录次数", "entry_count"],
  ["创建时间", "created_at"], ["更新时间", "updated_at"], ["同步状态", "sync_status"]
];

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function readStorage(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    if (fallback && !Array.isArray(fallback) && typeof fallback === "object" && (parsed === null || Array.isArray(parsed) || typeof parsed !== "object")) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function App() {
  const [messages, setMessages] = useState(() => readStorage(MESSAGE_KEY, []));
  const [dailyRecords, setDailyRecords] = useState(() => readStorage(DAILY_KEY, {}));
  const [dayPlans, setDayPlans] = useState(() => readStorage(DAY_PLANS_KEY, {}));
  const [weekPlans, setWeekPlans] = useState(() => readStorage(WEEK_PLANS_KEY, {}));
  const [text, setText] = useState("");
  const [mode, setMode] = useState("AUTO");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("chat");
  const [expandedDate, setExpandedDate] = useState("");
  const [pendingSummary, setPendingSummary] = useState(null);
  const [session, setSession] = useState({ checked: false, protected: false, authenticated: false });
  const [accessPassword, setAccessPassword] = useState("");
  const [accessError, setAccessError] = useState("");
  const [accessLoading, setAccessLoading] = useState(false);
  const listRef = useRef(null);

  useEffect(() => { localStorage.setItem(MESSAGE_KEY, JSON.stringify(messages)); listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  useEffect(() => { localStorage.setItem(DAILY_KEY, JSON.stringify(dailyRecords)); }, [dailyRecords]);
  useEffect(() => { localStorage.setItem(DAY_PLANS_KEY, JSON.stringify(dayPlans)); }, [dayPlans]);
  useEffect(() => { localStorage.setItem(WEEK_PLANS_KEY, JSON.stringify(weekPlans)); }, [weekPlans]);
  useEffect(() => { checkSession(); }, []);
  useEffect(() => { if (session.checked && session.authenticated) loadCloudDailyRecords(); }, [session.checked, session.authenticated]);

  const placeholder = useMemo(() => {
    if (mode === "PLAN") return "例如：今天我要修改论文 intro，跑实验，准备面试";
    if (mode === "SUMMARY") return "例如：昨天完成了实验；8.6号补记论文和生活总结";
    if (mode === "CHAT") return "例如：我今天有点焦虑，不知道该先做什么";
    return "写下计划、总结或心情，我会自动判断。";
  }, [mode]);

  async function checkSession() {
    try {
      const response = await fetch("/api/session");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setSession({ checked: true, protected: Boolean(data.protected), authenticated: Boolean(data.authenticated) });
    } catch {
      setSession({ checked: true, protected: false, authenticated: true });
    }
  }

  async function submitAccess(event) {
    event.preventDefault();
    if (accessLoading) return;
    setAccessError("");
    setAccessLoading(true);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: accessPassword })
      });
      const data = await response.json();
      if (!response.ok || !data.authenticated) {
        setAccessError("密码不对，再试一次。");
        return;
      }
      setAccessPassword("");
      setSession({ checked: true, protected: Boolean(data.protected), authenticated: true });
    } catch {
      setAccessError("登录暂时失败，请稍后再试。");
    } finally {
      setAccessLoading(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/session", { method: "DELETE" });
    } finally {
      setSession((current) => ({ ...current, authenticated: !current.protected }));
    }
  }

  async function submit(event) {
    event?.preventDefault();
    const value = text.trim();
    if (!value || loading) return;
    const pending = pendingSummary;
    const submittedText = pending ? pending.raw_query : value;
    const requestText = pending ? `${value}。${pending.raw_query}` : value;
    setMessages((items) => [...items, { id: createId(), role: "user", text: value, createdAt: new Date().toISOString() }]);
    setText("");
    setLoading(true);
    try {
      const initial = await postChat({ text: requestText, mode: pending ? "SUMMARY" : mode });
      let data = initial;
      if (initial.type === "CLARIFY_DATE") setPendingSummary(initial.pending_summary);
      if (initial.type === "SUMMARY") {
        const existing = dailyRecords[initial.date];
        data = await postChat({ text: requestText, mode: "SUMMARY", existing_entries: existing?.raw_entries || [] });
        await persistDailyRecord(data, submittedText, existing);
        setPendingSummary(null);
      }
      if (initial.type === "PLAN") persistPlan(initial);
      setMessages((items) => [...items, { id: createId(), role: "assistant", result: data, createdAt: new Date().toISOString() }]);
    } catch (error) {
      setMessages((items) => [...items, { id: createId(), role: "assistant", result: { type: "CHAT", reply: `发送失败：${error.message || "服务暂时没有连上"}。请确认电脑服务还在运行，手机和电脑仍在同一个网络。` }, createdAt: new Date().toISOString() }]);
    } finally { setLoading(false); }
  }

  async function postChat(payload) {
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadCloudDailyRecords() {
    try {
      const response = await fetch("/api/daily-records");
      if (!response.ok) return;
      const records = await response.json();
      if (records && typeof records === "object" && !Array.isArray(records)) {
        setDailyRecords((localRecords) => ({ ...localRecords, ...records }));
      }
    } catch {
      // Local storage remains the offline fallback.
    }
  }

  function persistPlan(plan) {
    const now = new Date().toISOString();
    if (plan.plan_kind === "week") {
      const key = plan.week_start;
      setWeekPlans((plans) => ({ ...plans, [key]: { ...plan, updated_at: now, created_at: plans[key]?.created_at || plan.created_at || now } }));
      return;
    }
    const key = plan.date;
    setDayPlans((plans) => ({ ...plans, [key]: { ...plan, updated_at: now, created_at: plans[key]?.created_at || plan.created_at || now } }));
  }

  async function persistDailyRecord(summary, inputText, existing) {
    const now = new Date().toISOString();
    const rawEntries = [...(existing?.raw_entries || []), { id: createId(), text: inputText, created_at: now }];
    const record = { date: summary.date, weekday: getWeekday(summary.date), raw_entries: rawEntries, raw_query: rawEntries.map((entry) => entry.text).join("\n"), research: summary.research || "", work: summary.work || "", growth: summary.growth || "", happiness: summary.happiness || "", emotion: summary.emotion || "", others: summary.others || "", summary: summary.summary || "", tomorrow_plan: summary.tomorrow_plan || "", entry_count: rawEntries.length, created_at: existing?.created_at || now, updated_at: now, sync: { provider: "supabase", status: "syncing", record_id: existing?.sync?.record_id || "", synced_at: "" } };
    setDailyRecords((records) => ({ ...records, [summary.date]: record }));
    try {
      const saved = await saveDailyRecord(record);
      setDailyRecords((records) => ({ ...records, [summary.date]: { ...saved, sync: { ...saved.sync, provider: "supabase", status: "synced", synced_at: new Date().toISOString() } } }));
    } catch {
      setDailyRecords((records) => ({ ...records, [summary.date]: { ...record, sync: { ...record.sync, status: "failed" } } }));
    }
  }

  async function saveDailyRecord(record) {
    const response = await fetch("/api/daily-records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ record }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  if (!session.checked) return <AccessShell><div className="access-status">正在打开 AI&Diary...</div></AccessShell>;
  if (session.protected && !session.authenticated) {
    return <AccessShell>
      <form className="access-form" onSubmit={submitAccess}>
        <div className="access-icon"><KeyRound size={24} /></div>
        <h1>AI&Diary</h1>
        <p>输入访问密码后继续。</p>
        <input type="password" value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} placeholder="访问密码" autoFocus />
        {accessError && <small>{accessError}</small>}
        <button type="submit" disabled={accessLoading || !accessPassword.trim()}><KeyRound size={18} /><span>{accessLoading ? "验证中" : "进入日记"}</span></button>
      </form>
    </AccessShell>;
  }

  return <main className="app">
    <header className="topbar">
      <div><h1>AI&Diary</h1><p>个人成长管理助手 V0.4</p></div>
      <div className="top-actions">
        <button className={view === "chat" ? "nav-button active" : "nav-button"} type="button" onClick={() => setView("chat")}><MessageCircle size={16} /><span>聊天</span></button>
        <button className={view === "actions" ? "nav-button active" : "nav-button"} type="button" onClick={() => setView("actions")}><CheckSquare size={16} /><span>行动板</span></button>
        <button className={view === "records" ? "nav-button active" : "nav-button"} type="button" onClick={() => setView("records")}><Table2 size={16} /><span>每日记录</span></button>
        {session.protected && <button className="icon-button" type="button" title="退出登录" onClick={logout}><LogOut size={18} /></button>}
        <button className="icon-button" type="button" title="清空聊天" onClick={() => {
          if (window.confirm("只清空当前聊天记录，不会删除行动板和每日记录。确认清空吗？")) setMessages([]);
        }}><Trash2 size={18} /></button>
      </div>
    </header>
    {view === "chat" && <ChatView messages={messages} loading={loading} listRef={listRef} />}
    {view === "actions" && <ActionBoard dayPlans={dayPlans} setDayPlans={setDayPlans} weekPlans={weekPlans} setWeekPlans={setWeekPlans} />}
    {view === "records" && <RecordsView records={dailyRecords} expandedDate={expandedDate} setExpandedDate={setExpandedDate} />}
    <form className="composer" onSubmit={submit}>
      <div className="quick-actions">{MODES.map((item) => { const Icon = item.icon; return <button type="button" key={item.key} className={mode === item.key ? "quick active" : "quick"} onClick={() => setMode(mode === item.key ? "AUTO" : item.key)}><Icon size={16} /><span>{item.label}</span></button>; })}</div>
      <div className="input-row"><textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) submit(event); }} placeholder={pendingSummary ? "请回复日期：今天、昨天、前天、8月7号、上周五" : placeholder} rows={2} /><button className="send" type="submit" disabled={loading || !text.trim()} title="发送"><Send size={19} /></button></div>
    </form>
  </main>;
}

function AccessShell({ children }) {
  return <main className="access-page">{children}</main>;
}

function ChatView({ messages, loading, listRef }) {
  return <section className="chat" ref={listRef}>{messages.length === 0 && <div className="empty"><h2>今天先抓住一条主线。</h2><p>写计划、做总结，或者直接说说状态。我会整理成可行动的结果。</p></div>}{messages.map((message) => message.role === "user" ? <div className="bubble user" key={message.id}>{message.text}</div> : <ResultCard key={message.id} result={message.result} />)}{loading && <div className="bubble assistant">分析中...</div>}</section>;
}

function ActionBoard({ dayPlans, setDayPlans, weekPlans, setWeekPlans }) {
  const [tab, setTab] = useState("day");
  const [sortMode, setSortMode] = useState("priority");
  const dayRows = Object.values(dayPlans || {}).filter((plan) => plan && plan.date).sort((a, b) => b.date.localeCompare(a.date));
  const weekRows = Object.values(weekPlans || {}).filter((plan) => plan && plan.week_start).sort((a, b) => b.week_start.localeCompare(a.week_start));
  const activeDay = dayRows[0];
  const activeWeek = weekRows[0];

  function updateDayPlan(date, updater) {
    setDayPlans((plans) => {
      const current = plans?.[date];
      if (!current) return plans;
      return { ...plans, [date]: updater(current) };
    });
  }
  function updateWeekPlan(key, updater) {
    setWeekPlans((plans) => {
      const current = plans?.[key];
      if (!current) return plans;
      return { ...plans, [key]: updater(current) };
    });
  }

  return <section className="action-board">
    <div className="board-toolbar"><div><h2>行动板</h2><p>把计划从聊天卡片变成可执行任务。</p></div><div className="segmented"><button className={tab === "day" ? "active" : ""} onClick={() => setTab("day")} type="button">日计划</button><button className={tab === "week" ? "active" : ""} onClick={() => setTab("week")} type="button">周计划</button></div></div>
    {tab === "day" ? <DayPlanView plan={activeDay} allPlans={dayRows} sortMode={sortMode} setSortMode={setSortMode} updatePlan={updateDayPlan} /> : <WeekPlanView plan={activeWeek} allPlans={weekRows} updatePlan={updateWeekPlan} />}
  </section>;
}

function DayPlanView({ plan, allPlans, sortMode, setSortMode, updatePlan }) {
  const [selectedDate, setSelectedDate] = useState(plan?.date || "");
  const selectedPlan = allPlans.find((item) => item.date === selectedDate) || plan;
  useEffect(() => { if (!selectedDate && plan?.date) setSelectedDate(plan.date); }, [plan?.date, selectedDate]);
  if (!selectedPlan) return <div className="empty"><h2>还没有日计划。</h2><p>在聊天里输入“今天我要……”后，计划会自动保存到这里。</p></div>;
  const tasks = sortTasks(Array.isArray(selectedPlan.tasks) ? selectedPlan.tasks : [], sortMode);
  return <div className="plan-view">
    <div className="plan-controls"><select value={selectedPlan.date} onChange={(event) => setSelectedDate(event.target.value)}>{allPlans.map((item) => <option key={item.date} value={item.date}>{formatDateWithWeekday(item.date)}</option>)}</select><div className="segmented small"><button className={sortMode === "priority" ? "active" : ""} onClick={() => setSortMode("priority")} type="button">重要性优先</button><button className={sortMode === "time" ? "active" : ""} onClick={() => setSortMode("time")} type="button">时间顺序</button></div></div>
    <section className="focus-panel"><span>{formatDateWithWeekday(selectedPlan.date)}</span><h3>{selectedPlan.core_focus || selectedPlan.main_goal}</h3><ul>{(selectedPlan.success_criteria || []).map((item) => <li key={item}>{item}</li>)}</ul></section>
    <div className="task-board">{tasks.map((task) => <TaskItem key={task.id} task={task} onToggle={() => updatePlan(selectedPlan.date, (plan) => ({ ...plan, tasks: plan.tasks.map((item) => item.id === task.id ? { ...item, done: !item.done } : item), updated_at: new Date().toISOString() }))} onRename={(name) => updatePlan(selectedPlan.date, (plan) => ({ ...plan, tasks: plan.tasks.map((item) => item.id === task.id ? { ...item, name } : item), updated_at: new Date().toISOString() }))} />)}</div>
    <SchedulePanel title="行程建议" schedule={selectedPlan.schedule || []} />
    <PriorityRationale rationale={selectedPlan.priority_rationale} fallback={selectedPlan.explanation} />
  </div>;
}

function WeekPlanView({ plan, allPlans, updatePlan }) {
  const [selectedWeek, setSelectedWeek] = useState(plan?.week_start || "");
  const selectedPlan = allPlans.find((item) => item.week_start === selectedWeek) || plan;
  useEffect(() => { if (!selectedWeek && plan?.week_start) setSelectedWeek(plan.week_start); }, [plan?.week_start, selectedWeek]);
  if (!selectedPlan) return <div className="empty"><h2>还没有周计划。</h2><p>在聊天里输入“这周我要……”后，周计划会自动保存到这里。</p></div>;
  return <div className="plan-view">
    <div className="plan-controls"><select value={selectedPlan.week_start} onChange={(event) => setSelectedWeek(event.target.value)}>{allPlans.map((item) => <option key={item.week_start} value={item.week_start}>{item.week_start} - {item.week_end}</option>)}</select></div>
    <section className="focus-panel"><span>{selectedPlan.week_start} - {selectedPlan.week_end}</span><h3>{selectedPlan.weekly_focus || selectedPlan.main_goal}</h3><ul>{(selectedPlan.success_criteria || []).map((item) => <li key={item}>{item}</li>)}</ul></section>
    <div className="task-board">{(Array.isArray(selectedPlan.task_pool) ? selectedPlan.task_pool : Array.isArray(selectedPlan.tasks) ? selectedPlan.tasks : []).map((task) => <TaskItem key={task.id} task={task} onToggle={() => updatePlan(selectedPlan.week_start, (plan) => ({ ...plan, task_pool: (Array.isArray(plan.task_pool) ? plan.task_pool : Array.isArray(plan.tasks) ? plan.tasks : []).map((item) => item.id === task.id ? { ...item, done: !item.done } : item), tasks: (Array.isArray(plan.tasks) ? plan.tasks : Array.isArray(plan.task_pool) ? plan.task_pool : []).map((item) => item.id === task.id ? { ...item, done: !item.done } : item), updated_at: new Date().toISOString() }))} onRename={(name) => updatePlan(selectedPlan.week_start, (plan) => ({ ...plan, task_pool: (Array.isArray(plan.task_pool) ? plan.task_pool : Array.isArray(plan.tasks) ? plan.tasks : []).map((item) => item.id === task.id ? { ...item, name } : item), tasks: (Array.isArray(plan.tasks) ? plan.tasks : Array.isArray(plan.task_pool) ? plan.task_pool : []).map((item) => item.id === task.id ? { ...item, name } : item), updated_at: new Date().toISOString() }))} />)}</div>
    <SchedulePanel title="每日分配" schedule={selectedPlan.daily_allocation || selectedPlan.schedule || []} />
  </div>;
}

function TaskItem({ task, onToggle, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.name);
  return <article className={task.done ? "task-item done" : "task-item"}><div className="task-line"><input type="checkbox" checked={task.done} onChange={onToggle} />{editing ? <input className="edit-input" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { onRename(draft.trim() || task.name); setEditing(false); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} autoFocus /> : <strong>{task.name}</strong>}<span>{task.priority}</span><button type="button" className="tiny-button" onClick={() => setEditing(true)}><Pencil size={14} /></button></div><p>{task.reason}</p><small>{task.next_action} · {task.estimated_time}{task.scheduled_start ? ` · ${task.scheduled_start}-${task.scheduled_end}` : ""}{task.suggested_day ? ` · ${task.suggested_day}` : ""}</small></article>;
}

function PriorityRationale({ rationale, fallback }) {
  if (rationale) {
    const rows = [
      ["当前阶段最重要目标", rationale.stage_goal],
      ["最应该先执行", rationale.first_action],
      ["最低成本启动", rationale.low_cost_start],
      ["可暂缓", rationale.defer]
    ].filter(([, value]) => value);
    if (rows.length) {
      return <details className="explain"><summary>为什么这样安排？</summary><div className="rationale-list">{rows.map(([label, value]) => <div key={label}><span>{label}</span><p>{value}</p></div>)}</div></details>;
    }
  }
  if (!fallback) return null;
  return <details className="explain"><summary>为什么这样安排？</summary><p>{fallback}</p></details>;
}

function SchedulePanel({ title, schedule }) {
  if (!schedule.length) return null;
  return <section className="schedule-panel"><h3>{title}</h3>{schedule.map((item, index) => <div className="schedule-row" key={`${item.time}-${item.task}-${index}`}><span>{item.time || "建议"}</span><p>{item.task}</p></div>)}</section>;
}

function sortTasks(tasks, mode) {
  const priority = { P0: 0, P1: 1, P2: 2 };
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (mode === "time") return (a.scheduled_start || "99:99").localeCompare(b.scheduled_start || "99:99");
    return (priority[a.priority] ?? 9) - (priority[b.priority] ?? 9);
  });
}

function RecordsView({ records, expandedDate, setExpandedDate }) {
  const rows = Object.values(records || {}).filter((record) => record && record.date).sort((a, b) => b.date.localeCompare(a.date));
  function exportJson() { downloadFile("ai-diary-records.json", JSON.stringify(rows.map(toExportRow), null, 2), "application/json;charset=utf-8"); }
  function exportCsv() { const csvRows = [EXPORT_COLUMNS.map(([label]) => label), ...rows.map((record) => { const row = toExportRow(record); return EXPORT_COLUMNS.map(([, key]) => row[key] ?? ""); })]; const csv = csvRows.map((row) => row.map(escapeCsvCell).join(",")).join("\n"); downloadFile("ai-diary-records.csv", `\uFEFF${csv}`, "text/csv;charset=utf-8"); }
  return <section className="records-view"><div className="records-toolbar"><div><h2>每日记录表</h2><p>{rows.length} 天记录 · 每天一行</p></div><div className="export-actions"><button className="tool-button" type="button" onClick={exportCsv} disabled={!rows.length}><Download size={16} /><span>导出 CSV</span></button><button className="tool-button" type="button" onClick={exportJson} disabled={!rows.length}><FileJson size={16} /><span>导出 JSON</span></button></div></div>{rows.length === 0 ? <div className="empty"><h2>还没有每日记录。</h2><p>发送一条今日总结后，这里会自动生成按日期归档的表格。</p></div> : <><div className="records-table-wrap"><table className="records-table"><thead><tr><th>日期</th><th>周几</th><th>AI今日总结</th><th>科研学习</th><th>技能成长</th><th>幸福小事</th><th>情绪</th><th>记录</th><th>同步</th></tr></thead><tbody>{rows.map((record) => <React.Fragment key={record.date}><tr className="data-row" onClick={() => setExpandedDate(expandedDate === record.date ? "" : record.date)}><td>{record.date}</td><td>{getWeekday(record.date)}</td><td className="wide-cell">{record.summary || "未生成总结"}</td><td>{record.research || "-"}</td><td>{record.growth || "-"}</td><td>{record.happiness || "-"}</td><td>{record.emotion || "-"}</td><td>{record.entry_count || 1}</td><td>{formatSyncStatus(record.sync)}</td></tr>{expandedDate === record.date && <tr className="detail-row"><td colSpan="9"><RecordDetail record={record} /></td></tr>}</React.Fragment>)}</tbody></table></div><div className="record-cards-mobile">{rows.map((record) => <article className="record-card" key={record.date}><button className="record-main" type="button" onClick={() => setExpandedDate(expandedDate === record.date ? "" : record.date)}><span>{formatDateWithWeekday(record.date)}</span><strong>{record.summary || "未生成总结"}</strong><small>{record.entry_count || 1} 次记录 · {formatSyncStatus(record.sync)} · 更新于 {formatTime(record.updated_at)}</small></button>{expandedDate === record.date && <RecordDetail record={record} />}</article>)}</div></>}</section>;
}

function RecordDetail({ record }) {
  const rows = [["科研学习", record.research], ["工作求职", record.work], ["技能成长", record.growth], ["幸福小事", record.happiness], ["情绪", record.emotion], ["其他", record.others], ["AI今日总结", record.summary], ["明日建议", record.tomorrow_plan]];
  return <div className="record-detail"><div className="raw-list"><span>原始记录</span>{record.raw_entries?.map((entry, index) => <p key={entry.id || index}>{index + 1}. {formatTime(entry.created_at)} {entry.text}</p>)}</div>{rows.map(([label, value]) => <div className="summary-row" key={label}><span>{label}</span><p>{value || "未提及"}</p></div>)}</div>;
}

function ResultCard({ result }) { if (result.type === "PLAN") return <PlanCard result={result} />; if (result.type === "SUMMARY") return <SummaryCard result={result} />; if (result.type === "CLARIFY_DATE") return <div className="card chat-card">{result.reply}</div>; return <div className="card chat-card">{result.reply || result.message}</div>; }
function PlanCard({ result }) { const tasks = result.tasks || result.task_pool || []; return <article className="card"><div className="card-header"><span>PLAN · 已保存到行动板</span><strong>{result.main_goal || result.core_focus || result.weekly_focus}</strong></div><div className="task-list">{tasks.slice(0, 5).map((task) => <section className="task" key={task.id || task.name}><div className="task-title"><strong>{task.name}</strong><span>{task.priority}</span></div><p>{task.reason}</p><small>{task.next_action} · {task.estimated_time}</small></section>)}</div><div className="schedule">{(result.schedule || []).slice(0, 3).map((item, index) => <span key={index}>{item.time ? `${item.time} ` : ""}{item.task}</span>)}</div><PriorityRationale rationale={result.priority_rationale} fallback={result.explanation} /></article>; }
function SummaryCard({ result }) { const rows = [["日期", formatDateWithWeekday(result.date)], ["原始记录", result.raw_query], ["科研学习", result.research], ["工作求职", result.work], ["技能成长", result.growth], ["幸福小事", result.happiness], ["情绪", result.emotion], ["其他", result.others], ["AI今日总结", result.summary], ["明日建议", result.tomorrow_plan]]; return <article className="card summary-card"><div className="card-header"><span>SUMMARY</span><strong>{formatDateWithWeekday(result.date)}</strong></div>{rows.map(([label, value]) => <div className="summary-row" key={label}><span>{label}</span><p>{value || "未提及"}</p></div>)}</article>; }

function toExportRow(record) { return { date: record.date, weekday: getWeekday(record.date), raw_query: record.raw_query || record.raw_entries?.map((entry) => entry.text).join("\n") || "", research: record.research || "", work: record.work || "", growth: record.growth || "", happiness: record.happiness || "", emotion: record.emotion || "", others: record.others || "", summary: record.summary || "", tomorrow_plan: record.tomorrow_plan || "", entry_count: record.entry_count || record.raw_entries?.length || 1, created_at: record.created_at || "", updated_at: record.updated_at || "", sync_status: formatSyncStatus(record.sync) }; }
function escapeCsvCell(value) { const text = String(value ?? "").replace(/\r?\n/g, "\n"); return `"${text.replace(/"/g, '""')}"`; }
function downloadFile(filename, content, type) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
function formatDateWithWeekday(dateText) { if (!dateText) return ""; return `${dateText} ${getWeekday(dateText)}`; }
function getWeekday(dateText) { const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]; const date = new Date(`${dateText}T00:00:00`); if (Number.isNaN(date.getTime())) return ""; return weekdays[date.getDay()]; }
function formatSyncStatus(sync) { if (!sync?.status || sync.status === "local") return "本地"; if (sync.status === "syncing") return "同步中"; if (sync.status === "synced") return "已同步"; if (sync.status === "failed") return "失败"; return sync.status; }
function formatTime(value) { if (!value) return ""; return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }

createRoot(document.getElementById("root")).render(<App />);



