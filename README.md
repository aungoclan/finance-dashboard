# Finance Dashboard V2.2

A personal all-in-one money dashboard built with React, Vite, Supabase, and Recharts.

This app is designed to track and analyze:

- Accounts
- Investments
- Holdings
- Portfolio intelligence
- Dividend income
- Cashflow
- Budgets
- Bills
- Net worth
- Financial goals
- Debt payoff
- Debt strategy
- Data health
- CSV imports
- App settings

---

## Tech Stack

- React
- Vite
- React Router
- Supabase
- Recharts
- PapaParse

---

## Project Structure

```txt
src/
  components/
    charts/
    ui/
    Layout.jsx
    Sidebar.jsx
    ProtectedRoute.jsx

  lib/
    auth.js
    routes.js
    supabase.js
    marketPrice.js
    holdings.js
    cashflow.js
    budget.js
    dashboard.js
    debt.js
    debtStrategy.js
    networth.js
    snapshot.js
    importers.js
    chartData.js
    appSettings.js

  pages/
    DashboardPage.jsx
    AccountsPage.jsx
    InvestmentsPage.jsx
    HoldingsPage.jsx
    PortfolioIntelligencePage.jsx
    DividendIncomePage.jsx
    FinancialGoalsPage.jsx
    CashflowPage.jsx
    BudgetPage.jsx
    NetWorthPage.jsx
    BillsPage.jsx
    ImportPage.jsx
    DebtPayoffPage.jsx
    DebtStrategyPage.jsx
    DataHealthPage.jsx
    SettingsPage.jsx
    LoginPage.jsx

supabase/
  functions/
    refresh-market-prices/