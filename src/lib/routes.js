export const APP_ROUTES = {
  overview: '/',
  moneyPlan: '/money-plan',
  monthSetup: '/month-setup',
  categoryCleanup: '/category-cleanup',
  accounts: '/accounts',
  cashWalletLedger: '/cash-wallet-ledger',
  investments: '/investments',
  holdings: '/holdings',
  portfolioIntelligence: '/portfolio-intelligence',
  dividendIncome: '/dividend-income',
  pnlCenter: '/pnl-center',
  financialGoals: '/financial-goals',
  cashflow: '/cashflow',
  budget: '/budget',
  netWorth: '/net-worth',
  bills: '/bills',
  imports: '/imports',
  debtHealth: '/debt-health',
  debtPayoff: '/debt-payoff',
  debtStrategy: '/debt-strategy',
  dataHealth: '/data-health',
  productionReadiness: '/production-readiness',
  settings: '/settings',
  login: '/login'
}

export const APP_ROUTE_SEGMENTS = {
  moneyPlan: 'money-plan',
  monthSetup: 'month-setup',
  categoryCleanup: 'category-cleanup',
  accounts: 'accounts',
  cashWalletLedger: 'cash-wallet-ledger',
  investments: 'investments',
  holdings: 'holdings',
  portfolioIntelligence: 'portfolio-intelligence',
  dividendIncome: 'dividend-income',
  pnlCenter: 'pnl-center',
  financialGoals: 'financial-goals',
  cashflow: 'cashflow',
  budget: 'budget',
  netWorth: 'net-worth',
  bills: 'bills',
  imports: 'imports',
  debtHealth: 'debt-health',
  debtPayoff: 'debt-payoff',
  debtStrategy: 'debt-strategy',
  dataHealth: 'data-health',
  productionReadiness: 'production-readiness',
  settings: 'settings'
}

export const NAV_SECTIONS = [
  {
    title: 'Command Center',
    items: [
      {
        name: 'Overview',
        path: APP_ROUTES.overview,
        icon: '⌂',
        description: 'Main financial dashboard'
      },
      {
        name: 'Money Plan',
        path: APP_ROUTES.moneyPlan,
        icon: '◎',
        description: 'Monthly planning and allocation'
      },
      {
        name: 'Month Setup',
        path: APP_ROUTES.monthSetup,
        icon: '↻',
        description: 'Monthly rollover and setup checklist'
      },
      {
        name: 'Category Cleanup',
        path: APP_ROUTES.categoryCleanup,
        icon: '⌁',
        description: 'Clean legacy categories'
      },
      {
        name: 'Data Health',
        path: APP_ROUTES.dataHealth,
        icon: '◇',
        description: 'Find and fix data issues'
      },
      {
        name: 'Production Ready',
        path: APP_ROUTES.productionReadiness,
        icon: '✓',
        description: 'Local production readiness audit'
      }
    ]
  },
  {
    title: 'Money Flow',
    items: [
      {
        name: 'Accounts',
        path: APP_ROUTES.accounts,
        icon: '□',
        description: 'Cash and bank accounts'
      },
      {
        name: 'Cash Ledger',
        path: APP_ROUTES.cashWalletLedger,
        icon: '▣',
        description: 'Cash Wallet monthly closing'
      },
      {
        name: 'Cashflow',
        path: APP_ROUTES.cashflow,
        icon: '↕',
        description: 'Income and expenses'
      },
      {
        name: 'Budget',
        path: APP_ROUTES.budget,
        icon: '◷',
        description: 'Monthly spending plan'
      },
      {
        name: 'Bills',
        path: APP_ROUTES.bills,
        icon: '◴',
        description: 'Upcoming bills'
      },
      {
        name: 'Net Worth',
        path: APP_ROUTES.netWorth,
        icon: '◆',
        description: 'Assets minus liabilities'
      }
    ]
  },
  {
    title: 'Investing',
    items: [
      {
        name: 'Investments',
        path: APP_ROUTES.investments,
        icon: '▤',
        description: 'Investment transactions'
      },
      {
        name: 'Holdings',
        path: APP_ROUTES.holdings,
        icon: '▦',
        description: 'Portfolio holdings'
      },
      {
        name: 'Portfolio IQ',
        path: APP_ROUTES.portfolioIntelligence,
        icon: '◈',
        description: 'Risk and allocation insights'
      },
      {
        name: 'Dividend Income',
        path: APP_ROUTES.dividendIncome,
        icon: '$',
        description: 'Dividend tracking'
      },
      {
        name: 'P&L Center',
        path: APP_ROUTES.pnlCenter,
        icon: '±',
        description: 'Profit and loss tracking'
      }
    ]
  },
  {
    title: 'Planning',
    items: [
      {
        name: 'Goals',
        path: APP_ROUTES.financialGoals,
        icon: '◎',
        description: 'Savings and financial goals'
      },
      {
        name: 'Debt Health',
        path: APP_ROUTES.debtHealth,
        icon: '◬',
        description: 'Debt health and payoff priority'
      },
      {
        name: 'Debt Payoff',
        path: APP_ROUTES.debtPayoff,
        icon: '↘',
        description: 'Debt payoff tracker'
      },
      {
        name: 'Debt Strategy',
        path: APP_ROUTES.debtStrategy,
        icon: '≡',
        description: 'Payoff method comparison'
      }
    ]
  },
  {
    title: 'System',
    items: [
      {
        name: 'Imports',
        path: APP_ROUTES.imports,
        icon: '⇪',
        description: 'CSV import tools'
      },
      {
        name: 'Settings',
        path: APP_ROUTES.settings,
        icon: '⚙',
        description: 'App preferences'
      }
    ]
  }
]
