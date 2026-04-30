import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import ErrorBoundary from './components/ErrorBoundary'

import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import MoneyPlanPage from './pages/MoneyPlanPage'
import MonthSetupPage from './pages/MonthSetupPage'
import CategoryCleanupPage from './pages/CategoryCleanupPage'
import AccountsPage from './pages/AccountsPage'
import CashWalletLedgerPage from './pages/CashWalletLedgerPage'
import InvestmentsPage from './pages/InvestmentsPage'
import CashflowPage from './pages/CashflowPage'
import HoldingsPage from './pages/HoldingsPage'
import BudgetPage from './pages/BudgetPage'
import NetWorthPage from './pages/NetWorthPage'
import ImportPage from './pages/ImportPage'
import DebtPayoffPage from './pages/DebtPayoffPage'
import DebtStrategyPage from './pages/DebtStrategyPage'
import DebtHealthPage from './pages/DebtHealthPage'
import BillsPage from './pages/BillsPage'
import DataHealthPage from './pages/DataHealthPage'
import PortfolioIntelligencePage from './pages/PortfolioIntelligencePage'
import DividendIncomePage from './pages/DividendIncomePage'
import PnLCenterPage from './pages/PnLCenterPage'
import FinancialGoalsPage from './pages/FinancialGoalsPage'
import ProductionReadinessPage from './pages/ProductionReadinessPage'
import SettingsPage from './pages/SettingsPage'

import { APP_ROUTE_SEGMENTS, APP_ROUTES } from './lib/routes'

function PageBoundary({ children, name }) {
  return (
    <ErrorBoundary
      title={`${name} could not load`}
      description="This page hit a runtime error. The safety layer caught it so the whole app does not turn into a blank screen."
      resetKey={name}
    >
      {children}
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary
        title="Financial Dashboard could not load"
        description="The app shell hit a runtime error. Reload the page first. If it happens again, check the browser console and recent code changes."
        resetKey="app-shell"
      >
        <Routes>
          <Route
            path={APP_ROUTES.login}
            element={
              <PageBoundary name="Login">
                <LoginPage />
              </PageBoundary>
            }
          />

          <Route
            path={APP_ROUTES.overview}
            element={
              <ProtectedRoute>
                <PageBoundary name="App Layout">
                  <Layout />
                </PageBoundary>
              </ProtectedRoute>
            }
          >
            <Route
              index
              element={
                <PageBoundary name="Dashboard">
                  <DashboardPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.moneyPlan}
              element={
                <PageBoundary name="Money Plan">
                  <MoneyPlanPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.monthSetup}
              element={
                <PageBoundary name="Month Setup">
                  <MonthSetupPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.categoryCleanup}
              element={
                <PageBoundary name="Category Cleanup">
                  <CategoryCleanupPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.accounts}
              element={
                <PageBoundary name="Accounts">
                  <AccountsPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.cashWalletLedger}
              element={
                <PageBoundary name="Cash Wallet Ledger">
                  <CashWalletLedgerPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.investments}
              element={
                <PageBoundary name="Investments">
                  <InvestmentsPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.holdings}
              element={
                <PageBoundary name="Holdings">
                  <HoldingsPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.portfolioIntelligence}
              element={
                <PageBoundary name="Portfolio Intelligence">
                  <PortfolioIntelligencePage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.dividendIncome}
              element={
                <PageBoundary name="Dividend Income">
                  <DividendIncomePage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.pnlCenter}
              element={
                <PageBoundary name="P&L Center">
                  <PnLCenterPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.financialGoals}
              element={
                <PageBoundary name="Financial Goals">
                  <FinancialGoalsPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.cashflow}
              element={
                <PageBoundary name="Cashflow">
                  <CashflowPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.budget}
              element={
                <PageBoundary name="Budget">
                  <BudgetPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.netWorth}
              element={
                <PageBoundary name="Net Worth">
                  <NetWorthPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.bills}
              element={
                <PageBoundary name="Bills">
                  <BillsPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.imports}
              element={
                <PageBoundary name="Import">
                  <ImportPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.debtHealth}
              element={
                <PageBoundary name="Debt Health">
                  <DebtHealthPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.debtPayoff}
              element={
                <PageBoundary name="Debt Payoff">
                  <DebtPayoffPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.debtStrategy}
              element={
                <PageBoundary name="Debt Strategy">
                  <DebtStrategyPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.dataHealth}
              element={
                <PageBoundary name="Data Health">
                  <DataHealthPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.productionReadiness}
              element={
                <PageBoundary name="Production Readiness">
                  <ProductionReadinessPage />
                </PageBoundary>
              }
            />
            <Route
              path={APP_ROUTE_SEGMENTS.settings}
              element={
                <PageBoundary name="Settings">
                  <SettingsPage />
                </PageBoundary>
              }
            />

            <Route path="*" element={<Navigate to={APP_ROUTES.overview} replace />} />
          </Route>

          <Route path="*" element={<Navigate to={APP_ROUTES.overview} replace />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
