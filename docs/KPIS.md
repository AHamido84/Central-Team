# KPI definitions (Executive Center, FR7)

Every number in the Executive Center, the board report (PDF / PowerPoint / Excel), the scheduled email and the
assistant's `executive_kpis` tool. The same text appears in the app behind each tile's ⓘ (`messages/*/executive.json`,
`kpi.<key>`); code is in `src/modules/executive/{kpi,catalog,compute}.ts` (ADR-096).

## Rules that apply to every KPI

- **Period**: this month, last month, quarter to date, year to date, last 12 months, or custom. Days follow the agency's
  time zone (Asia/Riyadh). "This month", QTD and YTD run to the end of the month / quarter / year and are marked
  *incomplete*: values cover the days so far, and flow metrics show a pro-rated projection (value ÷ elapsed days ×
  total days).
- **Comparison**: the previous period of the *same number of elapsed days*, or the same dates a year earlier. An
  incomplete period is compared with an equally long stretch, never with a full one.
- **Change**: `(current − previous) ÷ |previous|`; no percentage when the previous value is 0 (shown as new). Rates
  change in percentage points. The colour follows the KPI's direction (green = good news).
- **Rates** keep their numerator and denominator (shown on hover). Fewer than **5** observations → "small sample".
- **Durations** use the median and the 90th percentile (linear interpolation, like a spreadsheet's PERCENTILE.INC),
  never the mean, except where the owning screen defines it as a mean (sales cycle, revision rounds).
- **Sparklines**: twelve monthly values ending with the period's month; state metrics read month-end snapshots.
- **Moving average**: trailing 3 months on the revenue trend.
- **Targets** (`/executive/targets`): rates use the quarter's target, else the year's; amounts are pro-rated over the
  days the period covers (quarterly target, else the yearly one) and compared with the elapsed share when the period
  is incomplete. Progress = value ÷ target (target ÷ value for lower-is-better).
- **Filters**: client and account manager narrow everything client-scoped; department narrows tasks, time and
  capacity; platform narrows marketing. Revenue, health and risks follow the client filters.
- **Money** is stored in halalas and shown in SAR. Package revenue is recurring revenue; won deals are *bookings* and
  are not added to revenue (no double counting).
- **Same numbers as the other screens**: SLA compliance (`compliance`), client health (operations), campaign health
  and pacing (campaign analysis), win rate / cycle / forecast / funnel (sales dashboard), capacity levels (capacity
  planning). `tests/db/rls-executive.test.ts` checks they match.

## Definitions

### Clients & revenue

| KPI | Definition | Formula | Unit · direction · kind | Target | Source | Drill-down |
|---|---|---|---|---|---|---|
| **Active clients** · العملاء النشطون (`active_clients`) | Clients with a package covering the last day of the period (or today, for a period still running). | `count(clients with a package period covering the day)` | count · higher is better · state | — | Client packages | `/clients` |
| **New clients** · عملاء جدد (`new_clients`) | Clients whose first-ever package starts in the period. | `count(first package start ∈ period)` | count · higher is better · flow | new_clients (amount) | Client packages | `/clients` |
| **Churned clients** · عملاء غادروا (`churned_clients`) | Clients whose last package ended in the period with no later package. | `count(last package end ∈ period, end < today)` | count · lower is better · flow | — | Client packages | `/clients` |
| **Revenue** · الإيرادات (`revenue`) | Recurring package revenue recognized in the period: each package's monthly price spread over the days it covers. | `Σ monthly price × 12 ÷ 365 × days covered in the period` | currency · higher is better · flow | revenue (amount) | Packages and client packages | `/clients` |
| **Retention** · الاحتفاظ بالعملاء (`retention_rate`) | Share of clients active on the first day of the period who are still active on its last day. | `active at end and at start ÷ active at start` | percent · higher is better · rate | — | Client packages | `/clients` |
| **Top-5 client share** · حصة أكبر 5 عملاء (`top5_share`) | Share of the period's revenue that comes from the five largest clients. One client above 30% is flagged as a concentration risk. | `revenue of top 5 ÷ total revenue` | percent · lower is better · rate | — | Packages | `/clients` |
| **Revenue per hour** · الإيراد لكل ساعة (`revenue_per_hour`) | Package revenue of the period divided by the hours the team logged — a profitability proxy. | `revenue ÷ logged hours` | currency · higher is better · rate | — | Packages, time entries | `/clients` |
| **Client lifetime value** · القيمة الدائمة للعميل (`clv`) | Average monthly revenue per active client over the last 12 months × average client tenure in months. | `(revenue₁₂ ÷ 12 ÷ active clients) × mean tenure (months)` | currency · higher is better · state | — | Packages, client packages | `/clients` |
| **Extra requests** · طلبات إضافية (`extra_requests`) | Requests submitted in the period outside the package allowance (billable extras). | `count(is_extra ∧ submitted ∈ period)` | count · neither · flow | — | Requests | `/requests` |
| **Average client health** · متوسط صحة العملاء (`avg_health`) | Mean health score (0–100) of all clients, from the same penalty score as the operations dashboard. | `mean(client health score)` | count · higher is better · state | — | Operations dashboard | `/dashboard` |

### Operations & delivery

| KPI | Definition | Formula | Unit · direction · kind | Target | Source | Drill-down |
|---|---|---|---|---|---|---|
| **Requests submitted** · الطلبات المقدّمة (`requests_submitted`) | Requests submitted by clients in the period. | `count(submitted ∈ period)` | count · neither · flow | — | Requests | `/requests` |
| **Requests delivered** · الطلبات المسلّمة (`requests_delivered`) | Requests delivered in the period. | `count(delivered ∈ period)` | count · higher is better · flow | — | Requests | `/requests` |
| **Turnaround (median)** · مدة الإنجاز (الوسيط) (`turnaround_median`) | Median days from submission to delivery, for requests delivered in the period. | `median(delivered − submitted)` | days · lower is better · rate | — | Requests | `/requests` |
| **Turnaround (P90)** · مدة الإنجاز (P90) (`turnaround_p90`) | 90% of requests delivered in the period took this many days or fewer. | `90th percentile(delivered − submitted)` | days · lower is better · rate | — | Requests | `/requests` |
| **On-time delivery** · التسليم في الموعد (`on_time_rate`) | Of requests submitted in the period and delivered with a due date, the share delivered by the end of the due day — the SLA monitor's resolution compliance. | `delivered by due ÷ delivered with a due date` | percent · higher is better · rate | on_time_rate (rate) | SLA monitor (compliance) | `/sla` |
| **SLA compliance** · الالتزام بمستوى الخدمة (`sla_compliance`) | Of requests submitted in the period whose reply target has passed or been answered, the share answered in time — the SLA monitor's response compliance. | `answered in time ÷ (answered + past target)` | percent · higher is better · rate | sla_compliance (rate) | SLA monitor (compliance) | `/sla` |
| **Revision rounds** · جولات التعديل (`revision_rounds`) | Average rounds of changes per deliverable approved in the period. | `mean(revision rounds of deliverables approved ∈ period)` | decimal · lower is better · rate | — | Deliverables | `/deliverables` |
| **First-time approval** · الاعتماد من أول مرة (`first_time_approval`) | Share of deliverables approved in the period without any revision round. | `approved with 0 rounds ÷ approved` | percent · higher is better · rate | — | Deliverables | `/deliverables` |
| **Client approval wait** · انتظار اعتماد العميل (`approval_wait`) | Median days between sending a version to the client and the client's decision, for decisions in the period. | `median(decided − sent to client)` | days · lower is better · rate | — | Deliverable versions | `/deliverables` |
| **Open backlog** · الطلبات المفتوحة (`backlog_open`) | Requests submitted and not yet delivered, closed, cancelled or rejected (today). | `count(open requests)` | count · lower is better · state | — | Requests | `/requests` |
| **Aged backlog** · طلبات متقادمة (`backlog_aged`) | Open requests submitted more than 14 days ago. | `count(open ∧ age > 14 days)` | count · lower is better · state | — | Requests | `/requests` |

### Team & capacity

| KPI | Definition | Formula | Unit · direction · kind | Target | Source | Drill-down |
|---|---|---|---|---|---|---|
| **Team utilization** · استغلال الفريق (`utilization`) | Hours logged by department members ÷ their available hours (hours per week × working days ÷ 5, minus holidays and time off) — the capacity planner's capacity. | `logged hours ÷ available hours` | percent · neither · rate | utilization (rate) | Time entries, capacity planning | `/team` |
| **Tasks completed** · المهام المنجزة (`tasks_done`) | Tasks completed in the period. | `count(completed ∈ period)` | count · higher is better · flow | — | Tasks | `/tasks` |
| **Tasks on time** · المهام في موعدها (`task_on_time_rate`) | Of tasks completed in the period that had a due date, the share completed on or before it. | `completed by due ÷ completed with a due date` | percent · higher is better · rate | — | Tasks | `/tasks` |
| **Over-allocated departments** · أقسام فوق طاقتها (`overloaded_departments`) | Departments whose demand exceeds capacity in at least one of the next four weeks (capacity planning, including weighted pipeline). | `count(departments with an 'over' week in the next 4)` | count · lower is better · state | — | Capacity planning | `/capacity` |

### Marketing

| KPI | Definition | Formula | Unit · direction · kind | Target | Source | Drill-down |
|---|---|---|---|---|---|---|
| **Ad spend managed** · الإنفاق الإعلاني المُدار (`ad_spend`) | Total spend across all clients' campaigns in the period. | `Σ daily spend` | currency · neither · flow | — | Campaign daily numbers | `/campaigns` |
| **Conversions** · التحويلات (`conversions`) | Conversions reported by the ad platforms in the period. | `Σ daily conversions` | count · higher is better · flow | — | Campaign daily numbers | `/campaigns` |
| **Blended CPA** · تكلفة التحويل المجمّعة (`cpa`) | Spend ÷ conversions across all campaigns. | `Σ spend ÷ Σ conversions` | currency · lower is better · rate | — | Campaign daily numbers | `/campaigns` |
| **Cost per lead** · تكلفة العميل المحتمل (`cpl`) | Spend ÷ leads reported by the ad platforms. | `Σ spend ÷ Σ leads` | currency · lower is better · rate | — | Campaign daily numbers | `/campaigns` |
| **Blended ROAS** · العائد على الإنفاق الإعلاني (`roas`) | Revenue attributed by the ad platforms ÷ spend. | `Σ revenue ÷ Σ spend` | ratio · higher is better · rate | roas (rate) | Campaign daily numbers | `/campaigns` |
| **CTR** · نسبة النقر (`ctr`) | Clicks ÷ impressions across all campaigns. | `Σ clicks ÷ Σ impressions` | percent · higher is better · rate | — | Campaign daily numbers | `/campaigns` |
| **Campaigns at risk** · حملات في خطر (`campaigns_at_risk`) | Active campaigns whose pacing health is at risk or off track — the campaign analysis' health (today). | `count(active ∧ health is at risk or off track)` | count · lower is better · state | — | Campaign analysis | `/campaigns` |

### Sales

| KPI | Definition | Formula | Unit · direction · kind | Target | Source | Drill-down |
|---|---|---|---|---|---|---|
| **New leads** · عملاء محتملون جدد (`leads_new`) | Leads created in the period (merged and deleted leads excluded). | `count(created ∈ period)` | count · higher is better · flow | — | CRM leads | `/crm/leads` |
| **Win rate** · نسبة الفوز (`win_rate`) | Deals won ÷ deals won or lost in the period — the sales dashboard's win rate. | `won ÷ (won + lost), closed ∈ period` | percent · higher is better · rate | win_rate (rate) | Sales dashboard | `/crm/dashboard` |
| **Sales cycle** · دورة البيع (`sales_cycle`) | Average days from creating a deal to winning it, for deals won in the period (the sales dashboard's definition). | `mean(won − created)` | days · lower is better · rate | — | Sales dashboard | `/crm/dashboard` |
| **Average deal size** · متوسط قيمة الصفقة (`avg_deal_size`) | Average value of deals won in the period. | `Σ won value ÷ deals won` | currency · higher is better · rate | — | CRM deals | `/crm/dashboard` |
| **Bookings** · المبيعات المحجوزة (`bookings`) | Value of deals won in the period. | `Σ value of deals won ∈ period` | currency · higher is better · flow | — | CRM deals | `/crm/pipeline` |
| **Pipeline value** · قيمة مسار المبيعات (`pipeline_value`) | Value of all open deals (today). | `Σ value of open deals` | currency · higher is better · state | — | Sales pipeline | `/crm/pipeline` |
| **Weighted forecast** · التوقعات المرجّحة (`weighted_forecast`) | Open deals' value × their probability (today). | `Σ value × probability` | currency · higher is better · state | — | Sales pipeline | `/crm/dashboard` |
| **Lead response time** · سرعة الرد على العميل المحتمل (`lead_response`) | Median hours from a lead's creation to the first activity on it, for leads created in the period. | `median(first activity − created)` | hours · lower is better · rate | — | CRM leads and activities | `/crm/leads` |

### Risks

| KPI | Definition | Formula | Unit · direction · kind | Target | Source | Drill-down |
|---|---|---|---|---|---|---|
| **Open risks** · المخاطر القائمة (`open_risks`) | Items in the risk register today: at-risk clients, SLA breaches, overdue deliverables, over-allocated departments, revenue concentration, expiring integrations and the AI budget. | `count(risk register items)` | count · lower is better · state | — | Risk register | — |

## Tabs

| Tab | Tiles |
|---|---|
| overview | `active_clients`, `new_clients`, `churned_clients`, `revenue`, `pipeline_value`, `weighted_forecast`, `requests_delivered`, `on_time_rate`, `sla_compliance`, `avg_health`, `utilization`, `ad_spend`, `roas`, `cpa` |
| clients | `revenue`, `active_clients`, `new_clients`, `churned_clients`, `retention_rate`, `top5_share`, `revenue_per_hour`, `clv`, `extra_requests` |
| operations | `requests_submitted`, `requests_delivered`, `turnaround_median`, `turnaround_p90`, `on_time_rate`, `sla_compliance`, `revision_rounds`, `first_time_approval`, `approval_wait`, `backlog_open`, `backlog_aged` |
| team | `utilization`, `tasks_done`, `task_on_time_rate`, `overloaded_departments` |
| marketing | `ad_spend`, `conversions`, `cpa`, `cpl`, `roas`, `ctr`, `campaigns_at_risk` |
| sales | `leads_new`, `win_rate`, `sales_cycle`, `avg_deal_size`, `bookings`, `pipeline_value`, `weighted_forecast`, `lead_response` |
| risks | `open_risks` |

## Risk register and “Needs attention”

Ranked by severity (high → low), then impact. Sources: at-risk client health (high below 35), unacknowledged SLA
breaches and requests past their SLA, overdue deliverables, departments over capacity in the next 4 weeks,
revenue concentration (one client above 30%, high above 50%), expired or expiring (≤ 14 days) integration tokens, and
AI use at 80% of the monthly budget. "Needs attention" adds off-pace campaigns, deals without activity for the CRM's
stale days, and packages used beyond 100%.

