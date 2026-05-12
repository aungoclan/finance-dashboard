import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const INVESTMENT_ACCOUNT_TYPES = ['brokerage', 'ira', 'crypto']
const FUNDING_ACCOUNT_TYPES = ['cash', 'checking', 'savings', 'business']
const INVESTMENT_CASH_SOURCE_TYPES = ['brokerage', 'ira', 'crypto']
const CASH_SYNC_ACCOUNT_TYPES = [...FUNDING_ACCOUNT_TYPES, ...INVESTMENT_CASH_SOURCE_TYPES]
const CASHFLOW_TRANSFER_CATEGORY = 'Transfer'

function buildEmptyForm() {
  return {
    account_id: '',
    symbol: '',
    display_name: '',
    asset_type: 'stock',
    transaction_date: new Date().toISOString().split('T')[0],
    type: 'buy',
    quantity: '',
    unit_price: '',
    fee: '0',
    cash_sync_enabled: true,
    funding_account_id: ''
  }
}

export default function InvestmentsPage() {
  const [accounts, setAccounts] = useState([])
  const [assets, setAssets] = useState([])
  const [transactions, setTransactions] = useState([])
  const [cashflowCategories, setCashflowCategories] = useState([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState(null)

  const [searchText, setSearchText] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sortMode, setSortMode] = useState('newest')

  const [formData, setFormData] = useState(buildEmptyForm())

  useEffect(() => {
    loadInitialData()
  }, [])

  const investmentAccounts = useMemo(() => {
    return accounts.filter((account) => INVESTMENT_ACCOUNT_TYPES.includes(account.account_type))
  }, [accounts])

  const cashReserveFundingAccounts = useMemo(() => {
    return accounts.filter((account) => FUNDING_ACCOUNT_TYPES.includes(account.account_type))
  }, [accounts])

  const investmentCashFundingAccounts = useMemo(() => {
    return accounts.filter((account) => INVESTMENT_CASH_SOURCE_TYPES.includes(account.account_type))
  }, [accounts])

  const fundingAccounts = useMemo(() => {
    const combined = [...cashReserveFundingAccounts, ...investmentCashFundingAccounts]
    const seen = new Set()

    return combined.filter((account) => {
      if (!account?.id || seen.has(account.id)) return false
      seen.add(account.id)
      return true
    })
  }, [cashReserveFundingAccounts, investmentCashFundingAccounts])

  const selectedInvestmentAccount = useMemo(() => {
    return accounts.find((account) => account.id === formData.account_id) || null
  }, [accounts, formData.account_id])

  const selectedFundingAccount = useMemo(() => {
    return accounts.find((account) => account.id === formData.funding_account_id) || null
  }, [accounts, formData.funding_account_id])

  const accountNameById = useMemo(() => {
    const map = new Map()
    for (const account of accounts) {
      map.set(account.id, account.name)
    }
    return map
  }, [accounts])

  const isBuyTransaction = formData.type === 'buy'
  const isSellTransaction = formData.type === 'sell'
  const canSyncCash = isBuyTransaction || isSellTransaction
  const syncDirection = isSellTransaction ? 'in' : 'out'
  const estimatedCashMovement = getFormCashMovement(formData)

  const loadInitialData = async () => {
    setLoading(true)
    setMessage('')

    try {
      await Promise.all([loadAccounts(), loadAssets(), loadCategories(), loadTransactions()])
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to load investment data')
    }

    setLoading(false)
  }

  const loadAccounts = async () => {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) throw new Error('Unable to get current user')

    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) throw error

    setAccounts((data || []).filter((account) => !isArchivedAccount(account)))
  }

  const loadAssets = async () => {
    const { data, error } = await supabase
      .from('assets')
      .select('*')
      .order('symbol', { ascending: true })

    if (error) throw error

    setAssets(data || [])
  }

  const loadCategories = async () => {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) throw new Error('Unable to get current user')

    const { data, error } = await supabase
      .from('cashflow_categories')
      .select('id, name, type, group_name')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true })

    if (error) {
      // Category table can be missing in older local snapshots. Cash sync can still work with legacy category text.
      console.warn('Unable to load cashflow categories:', error.message)
      setCashflowCategories([])
      return
    }

    setCashflowCategories(data || [])
  }

  const loadTransactions = async () => {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) throw new Error('Unable to get current user')

    // Bài 58A Fix 3:
    // After adding funding_account_id, investment_transactions has two links to accounts:
    // account_id and funding_account_id. A plain accounts(...) embed becomes ambiguous.
    // So we do not embed accounts here. We resolve account names from the separate accounts list.
    const newColumnsQuery = await supabase
      .from('investment_transactions')
      .select(`
        id,
        account_id,
        asset_id,
        transaction_date,
        type,
        quantity,
        unit_price,
        fee,
        funding_account_id,
        cashflow_entry_id,
        cash_sync_enabled,
        cash_sync_direction,
        cash_sync_amount,
        created_at,
        assets (
          id,
          symbol,
          display_name,
          asset_type
        )
      `)
      .eq('user_id', user.id)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (!newColumnsQuery.error) {
      setTransactions(newColumnsQuery.data || [])
      return
    }

    console.warn('Bài 58A cash-sync columns query failed. Falling back to legacy investment query:', newColumnsQuery.error.message)

    const legacyQuery = await supabase
      .from('investment_transactions')
      .select(`
        id,
        account_id,
        asset_id,
        transaction_date,
        type,
        quantity,
        unit_price,
        fee,
        created_at,
        assets (
          id,
          symbol,
          display_name,
          asset_type
        )
      `)
      .eq('user_id', user.id)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (legacyQuery.error) throw legacyQuery.error

    setTransactions(
      (legacyQuery.data || []).map((tx) => ({
        ...tx,
        funding_account_id: null,
        cashflow_entry_id: null,
        cash_sync_enabled: false,
        cash_sync_direction: null,
        cash_sync_amount: null
      }))
    )
  }

  const resetForm = () => {
    setFormData(buildEmptyForm())
    setEditingId(null)
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target

    setFormData((prev) => {
      const next = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }

      if (name === 'type' && value !== 'buy' && value !== 'sell') {
        next.cash_sync_enabled = false
        next.funding_account_id = ''
      }

      if (name === 'type' && (value === 'buy' || value === 'sell')) {
        next.cash_sync_enabled = true
      }

      return next
    })
  }

  const handleSymbolChange = (e) => {
    const value = e.target.value.toUpperCase()

    setFormData((prev) => ({
      ...prev,
      symbol: value
    }))

    const matchedAsset = assets.find(
      (asset) => asset.symbol.toUpperCase() === value.toUpperCase()
    )

    if (matchedAsset) {
      setFormData((prev) => ({
        ...prev,
        symbol: matchedAsset.symbol,
        display_name: matchedAsset.display_name || '',
        asset_type: matchedAsset.asset_type
      }))
    }
  }

  const ensureAssetExists = async () => {
    const symbol = formData.symbol.trim().toUpperCase()

    if (!symbol) throw new Error('Symbol is required')

    const existingAsset = assets.find(
      (asset) => asset.symbol.toUpperCase() === symbol
    )

    if (existingAsset) return existingAsset.id

    const { data, error } = await supabase
      .from('assets')
      .insert({
        symbol,
        display_name: formData.display_name.trim() || symbol,
        asset_type: formData.asset_type,
        currency: 'USD'
      })
      .select()
      .single()

    if (error) throw error

    setAssets((prev) => [...prev, data])

    return data.id
  }

  const getCashflowCategoryPayload = () => {
    const transferCategory = cashflowCategories.find(
      (category) => String(category.name || '').toLowerCase() === CASHFLOW_TRANSFER_CATEGORY.toLowerCase()
    )

    return {
      category_id: transferCategory?.id || null,
      category: transferCategory?.name || CASHFLOW_TRANSFER_CATEGORY
    }
  }

  const isOutsideCashFundingAccount = (account) => {
    return Boolean(account && FUNDING_ACCOUNT_TYPES.includes(account.account_type))
  }

  const isInvestmentCashFundingAccount = (account) => {
    return Boolean(account && INVESTMENT_CASH_SOURCE_TYPES.includes(account.account_type))
  }

  const shouldCreateCashflowForFundingAccount = (account) => {
    // Important: brokerage/IRA/crypto funding is internal investment cash.
    // It must stay inside investment_transactions and must NOT create a Cashflow entry,
    // otherwise Accounts will show a false personal cashflow expense/income.
    return isOutsideCashFundingAccount(account)
  }

  const deleteLinkedCashflowEntry = async({ userId, cashflowEntryId }) => {
    if (!cashflowEntryId) return

    const { error } = await supabase
      .from('cashflow_entries')
      .delete()
      .eq('id', cashflowEntryId)
      .eq('user_id', userId)

    if (error) throw error
  }

  const createInvestmentCashSyncEntry = async({
    userId,
    transactionId,
    assetSymbol,
    investmentAccount,
    fundingAccount,
    amount,
    direction
  }) => {
    const categoryPayload = getCashflowCategoryPayload()
    const cashflowType = direction === 'in' ? 'income' : 'expense'
    const description = buildCashSyncDescription({
      assetSymbol,
      investmentAccountName: investmentAccount?.name,
      transactionId,
      direction
    })

    const duplicate = await findExistingCashSyncEntry({
      userId,
      accountId: fundingAccount.id,
      entryDate: formData.transaction_date,
      amount,
      type: cashflowType,
      description
    })

    if (duplicate) return duplicate

    const { data, error } = await supabase
      .from('cashflow_entries')
      .insert({
        user_id: userId,
        account_id: fundingAccount.id,
        entry_date: formData.transaction_date,
        type: cashflowType,
        amount,
        category_id: categoryPayload.category_id,
        category: categoryPayload.category,
        description
      })
      .select('id, account_id, entry_date, type, amount, category, description')
      .single()

    if (error) throw error

    return data
  }

  const findExistingCashSyncEntry = async({
    userId,
    accountId,
    entryDate,
    amount,
    type,
    description
  }) => {
    const { data, error } = await supabase
      .from('cashflow_entries')
      .select('id, account_id, entry_date, type, amount, category, description')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .eq('entry_date', entryDate)
      .eq('type', type)
      .eq('category', CASHFLOW_TRANSFER_CATEGORY)
      .limit(25)

    if (error) throw error

    return (data || []).find((entry) => {
      const sameAmount = Math.abs(Number(entry.amount || 0) - amount) < 0.01
      const sameDescription = String(entry.description || '').trim() === description
      return sameAmount && sameDescription
    })
  }

  const handleAddOrUpdateTransaction = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')
      if (!formData.account_id) throw new Error('Please select an investment account')
      if (!formData.transaction_date) throw new Error('Transaction date is required')
      if (!formData.type) throw new Error('Transaction type is required')

      const assetId = await ensureAssetExists()

      const quantityValue = formData.quantity === '' ? null : Number(formData.quantity)
      const unitPriceValue = formData.unit_price === '' ? null : Number(formData.unit_price)
      const feeValue = formData.fee === '' ? 0 : Number(formData.fee)

      if (
        (formData.type === 'buy' || formData.type === 'sell') &&
        (!quantityValue || !unitPriceValue)
      ) {
        throw new Error('Buy/Sell transactions require quantity and unit price')
      }

      const cashSyncEnabled = (formData.type === 'buy' || formData.type === 'sell') && Boolean(formData.cash_sync_enabled)
      const cashSyncDirection = formData.type === 'sell' ? 'in' : 'out'
      const cashSyncAmount = cashSyncEnabled
        ? getCashMovementAmount(formData.type, quantityValue, unitPriceValue, feeValue)
        : null
      const fundingAccount = cashSyncEnabled ? selectedFundingAccount : null

      if (cashSyncEnabled) {
        if (!fundingAccount) throw new Error(formData.type === 'sell' ? 'Please select Deposit To / Receive Cash To' : 'Please select Pay From / Funding Source')
        if (!CASH_SYNC_ACCOUNT_TYPES.includes(fundingAccount.account_type)) {
          throw new Error('Cash sync account must be Cash Wallet, Checking, Savings, Business, Brokerage, IRA, or Crypto')
        }
        if (!cashSyncAmount || cashSyncAmount <= 0) {
          throw new Error(formData.type === 'sell' ? 'Sell deposit amount must be greater than zero. Check quantity, unit price, and fee.' : 'Cash sync amount must be greater than zero')
        }
      }

      const investmentPayload = {
        account_id: formData.account_id,
        asset_id: assetId,
        transaction_date: formData.transaction_date,
        type: formData.type,
        quantity: quantityValue,
        unit_price: unitPriceValue,
        fee: feeValue,
        funding_account_id: cashSyncEnabled ? fundingAccount.id : null,
        cash_sync_enabled: cashSyncEnabled,
        cash_sync_direction: cashSyncEnabled ? cashSyncDirection : null,
        cash_sync_amount: cashSyncEnabled ? cashSyncAmount : null
      }

      if (editingId) {
        const currentTx = transactions.find((tx) => tx.id === editingId)
        const existingCashflowId = currentTx?.cashflow_entry_id || null

        const { error: updateError } = await supabase
          .from('investment_transactions')
          .update(investmentPayload)
          .eq('id', editingId)
          .eq('user_id', user.id)

        if (updateError) throw updateError

        let nextCashflowId = null

        if (cashSyncEnabled && shouldCreateCashflowForFundingAccount(fundingAccount)) {
          const cashflowPayload = {
            user_id: user.id,
            account_id: fundingAccount.id,
            entry_date: formData.transaction_date,
            type: cashSyncDirection === 'in' ? 'income' : 'expense',
            amount: cashSyncAmount,
            ...getCashflowCategoryPayload(),
            description: buildCashSyncDescription({
              assetSymbol: formData.symbol.trim().toUpperCase(),
              investmentAccountName: selectedInvestmentAccount?.name,
              transactionId: editingId,
              direction: cashSyncDirection
            })
          }

          if (existingCashflowId) {
            const { error: cashflowUpdateError } = await supabase
              .from('cashflow_entries')
              .update(cashflowPayload)
              .eq('id', existingCashflowId)
              .eq('user_id', user.id)

            if (cashflowUpdateError) throw cashflowUpdateError
            nextCashflowId = existingCashflowId
          } else {
            const cashflowEntry = await createInvestmentCashSyncEntry({
              userId: user.id,
              transactionId: editingId,
              assetSymbol: formData.symbol.trim().toUpperCase(),
              investmentAccount: selectedInvestmentAccount,
              fundingAccount,
              amount: cashSyncAmount,
              direction: cashSyncDirection
            })
            nextCashflowId = cashflowEntry?.id || null
          }
        } else if (existingCashflowId) {
          // If the transaction is changed from outside cash funding to brokerage/IRA/crypto
          // internal cash, remove the old Cashflow link automatically.
          await deleteLinkedCashflowEntry({ userId: user.id, cashflowEntryId: existingCashflowId })
        }

        const { error: linkError } = await supabase
          .from('investment_transactions')
          .update({ cashflow_entry_id: nextCashflowId })
          .eq('id', editingId)
          .eq('user_id', user.id)

        if (linkError) throw linkError

        setMessage(
          cashSyncEnabled
            ? shouldCreateCashflowForFundingAccount(fundingAccount)
              ? 'Transaction updated and outside cashflow synced'
              : 'Transaction updated as internal investment cash movement'
            : 'Transaction updated successfully'
        )
      } else {
        const { data: newTransaction, error: insertError } = await supabase
          .from('investment_transactions')
          .insert({
            user_id: user.id,
            ...investmentPayload
          })
          .select('id')
          .single()

        if (insertError) throw insertError

        if (cashSyncEnabled && shouldCreateCashflowForFundingAccount(fundingAccount)) {
          const cashflowEntry = await createInvestmentCashSyncEntry({
            userId: user.id,
            transactionId: newTransaction.id,
            assetSymbol: formData.symbol.trim().toUpperCase(),
            investmentAccount: selectedInvestmentAccount,
            fundingAccount,
            amount: cashSyncAmount,
            direction: cashSyncDirection
          })

          const { error: linkError } = await supabase
            .from('investment_transactions')
            .update({ cashflow_entry_id: cashflowEntry?.id || null })
            .eq('id', newTransaction.id)
            .eq('user_id', user.id)

          if (linkError) throw linkError
        }

        setMessage(
          cashSyncEnabled
            ? shouldCreateCashflowForFundingAccount(fundingAccount)
              ? 'Transaction added and outside cashflow synced'
              : 'Transaction added as internal investment cash movement'
            : 'Transaction added successfully'
        )
      }

      resetForm()
      await Promise.all([loadAssets(), loadTransactions()])
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to save transaction')
    }

    setSaving(false)
  }

  const handleEdit = (tx) => {
    setEditingId(tx.id)
    setFormData({
      account_id: tx.account_id || '',
      symbol: tx.assets?.symbol || '',
      display_name: tx.assets?.display_name || '',
      asset_type: tx.assets?.asset_type || 'stock',
      transaction_date: tx.transaction_date,
      type: tx.type,
      quantity: tx.quantity ?? '',
      unit_price: tx.unit_price ?? '',
      fee: tx.fee ?? '0',
      cash_sync_enabled: Boolean(tx.cash_sync_enabled),
      funding_account_id: tx.funding_account_id || ''
    })
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (tx) => {
    const hasLinkedCashflow = Boolean(tx.cashflow_entry_id)
    const confirmed = window.confirm(
      hasLinkedCashflow
        ? 'Delete this investment transaction and its linked funding cashflow entry?'
        : 'Are you sure you want to delete this investment transaction?'
    )
    if (!confirmed) return

    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      if (hasLinkedCashflow) {
        const { error: cashflowError } = await supabase
          .from('cashflow_entries')
          .delete()
          .eq('id', tx.cashflow_entry_id)
          .eq('user_id', user.id)

        if (cashflowError) throw cashflowError
      }

      const { error } = await supabase
        .from('investment_transactions')
        .delete()
        .eq('id', tx.id)
        .eq('user_id', user.id)

      if (error) throw error

      if (editingId === tx.id) resetForm()

      setMessage(hasLinkedCashflow ? 'Transaction and linked funding cashflow deleted' : 'Transaction deleted successfully')
      await loadTransactions()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to delete transaction')
    }
  }

  const filteredTransactions = useMemo(() => {
    let rows = [...transactions]

    if (typeFilter !== 'all') {
      rows = rows.filter((tx) => tx.type === typeFilter)
    }

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      rows = rows.filter((tx) => {
        const symbol = tx.assets?.symbol?.toLowerCase() || ''
        const name = tx.assets?.display_name?.toLowerCase() || ''
        const account = String(accountNameById.get(tx.account_id) || '').toLowerCase()
        const funding = String(accountNameById.get(tx.funding_account_id) || '').toLowerCase()
        return symbol.includes(q) || name.includes(q) || account.includes(q) || funding.includes(q)
      })
    }

    if (sortMode === 'newest') {
      rows.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date))
    }

    if (sortMode === 'oldest') {
      rows.sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date))
    }

    if (sortMode === 'value_high') {
      rows.sort((a, b) => getTxValue(b) - getTxValue(a))
    }

    if (sortMode === 'value_low') {
      rows.sort((a, b) => getTxValue(a) - getTxValue(b))
    }

    return rows
  }, [transactions, searchText, typeFilter, sortMode, accountNameById])

  const totalValue = filteredTransactions.reduce((sum, tx) => sum + getTxValue(tx), 0)

  return (
    <div>
      <div style={pageHeaderStyle}>
        <div>
          <h1 style={titleStyle}>Investments</h1>
          <p style={subtitleStyle}>
            Add, edit, search, and review investment transactions. Buy orders can sync cash outflow from Cash/Tiet Kiem or from cash already inside brokerage/IRA accounts. Sell orders can sync cash deposits back to Cash Wallet, Savings, Brokerage, IRA, or Crypto accounts.
          </p>
        </div>

        <button type="button" onClick={loadInitialData} style={refreshButtonStyle}>
          Refresh
        </button>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={fundingGuardStyle}>
        <div>
          <div style={guardTitleStyle}>Bài 64A · Investment Account Funding Source</div>
          <p style={guardTextStyle}>
            A Buy moves available cash into an investment position. Use Cash/Tiet Kiem for outside funding, or choose the same brokerage/IRA account when using dividend cash already inside that account. Sell orders can deposit cash back to either outside cash or investment cash.
          </p>
        </div>
        <div style={guardPillStyle}>Manual-first · anti-duplicate</div>
      </div>

      <div style={layoutStyle}>
        <div style={formCardStyle}>
          <div style={formHeaderStyle}>
            <div>
              <h2 style={cardTitleStyle}>
                {editingId ? 'Edit Transaction' : 'Add Transaction'}
              </h2>
              <p style={cardSubtitleStyle}>
                {editingId ? 'Update the selected transaction.' : 'Record a new buy, sell, dividend, fee, or interest.'}
              </p>
            </div>

            {editingId && (
              <button type="button" onClick={resetForm} style={secondaryButtonStyle}>
                Cancel
              </button>
            )}
          </div>

          <form onSubmit={handleAddOrUpdateTransaction}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Investment Account</label>
              <select name="account_id" value={formData.account_id} onChange={handleChange} style={inputStyle}>
                <option value="">Select investment account</option>
                {investmentAccounts.length > 0 ? (
                  investmentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.account_type})
                    </option>
                  ))
                ) : (
                  accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.account_type})
                    </option>
                  ))
                )}
              </select>
              <div style={helpTextStyle}>This is where the asset/holding is kept, such as Robinhood, Fidelity, IRA, or Kraken.</div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Symbol</label>
              <input
                type="text"
                name="symbol"
                value={formData.symbol}
                onChange={handleSymbolChange}
                placeholder="Example: AAPL, BTC, JEPQ"
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Display Name</label>
              <input
                type="text"
                name="display_name"
                value={formData.display_name}
                onChange={handleChange}
                placeholder="Example: Apple Inc."
                style={inputStyle}
              />
            </div>

            <div style={twoColumnStyle}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Asset Type</label>
                <select name="asset_type" value={formData.asset_type} onChange={handleChange} style={inputStyle}>
                  <option value="stock">Stock</option>
                  <option value="etf">ETF</option>
                  <option value="crypto">Crypto</option>
                  <option value="cash">Cash</option>
                </select>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Type</label>
                <select name="type" value={formData.type} onChange={handleChange} style={inputStyle}>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                  <option value="dividend">Dividend</option>
                  <option value="fee">Fee</option>
                  <option value="interest">Interest</option>
                </select>
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Transaction Date</label>
              <input
                type="date"
                name="transaction_date"
                value={formData.transaction_date}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>

            <div style={twoColumnStyle}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Quantity</label>
                <input
                  type="number"
                  step="0.00000001"
                  name="quantity"
                  value={formData.quantity}
                  onChange={handleChange}
                  placeholder="10"
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Unit Price</label>
                <input
                  type="number"
                  step="0.00000001"
                  name="unit_price"
                  value={formData.unit_price}
                  onChange={handleChange}
                  placeholder="185.50"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Fee</label>
              <input
                type="number"
                step="0.00000001"
                name="fee"
                value={formData.fee}
                onChange={handleChange}
                placeholder="0"
                style={inputStyle}
              />
            </div>

            <div style={syncBoxStyle}>
              <label style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  name="cash_sync_enabled"
                  checked={Boolean(formData.cash_sync_enabled)}
                  disabled={!canSyncCash}
                  onChange={handleChange}
                />
                <span>{isSellTransaction ? 'Sync cash deposit for this Sell' : 'Sync cash movement for this Buy'}</span>
              </label>

              <div style={helpTextStyle}>
                {isSellTransaction ? 'This creates a Cashflow income with category Transfer. Choose outside cash or the investment account where sale proceeds stay.' : 'Cash/Reserve creates a Cashflow Transfer. Brokerage/IRA/Crypto uses internal investment cash and does not touch Cashflow.'}
              </div>

              {canSyncCash && formData.cash_sync_enabled && (
                <>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>{isSellTransaction ? 'Deposit To / Receive Cash To' : 'Pay From / Funding Source'}</label>
                    <select
                      name="funding_account_id"
                      value={formData.funding_account_id}
                      onChange={handleChange}
                      style={inputStyle}
                    >
                      <option value="">{isSellTransaction ? 'Select destination account' : 'Select funding account'}</option>
                      {cashReserveFundingAccounts.length > 0 && (
                        <optgroup label="Cash / Reserve">
                          {cashReserveFundingAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name} ({account.account_type})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {investmentCashFundingAccounts.length > 0 && (
                        <optgroup label="Investment Cash">
                          {investmentCashFundingAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name} ({account.account_type})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  <div style={infoTextStyle}>
                    {selectedFundingAccount && INVESTMENT_CASH_SOURCE_TYPES.includes(selectedFundingAccount.account_type)
                      ? 'Investment cash source selected. This records an internal investment cash movement only — no Cashflow entry will be created.'
                      : 'Cash / reserve source selected. This will create an outside Cashflow Transfer entry.'}
                  </div>

                  <div style={cashPreviewStyle}>
                    <div>
                      <strong>{selectedFundingAccount && isInvestmentCashFundingAccount(selectedFundingAccount) ? (isSellTransaction ? 'Internal investment cash deposit' : 'Internal investment cash used') : (isSellTransaction ? 'Estimated cash deposit' : 'Estimated cash outflow')}</strong>
                      <div style={helpTextStyle}>
                        {isSellTransaction ? 'Quantity × Unit Price - Fee' : 'Quantity × Unit Price + Fee'}
                      </div>
                    </div>
                    <div style={isSellTransaction ? cashPreviewIncomeAmountStyle : cashPreviewAmountStyle}>
                      ${formatMoney(estimatedCashMovement)}
                    </div>
                  </div>
                </>
              )}

              {!canSyncCash && (
                <div style={warningTextStyle}>
                  Cash sync is available for Buy and Sell transactions. Dividend and interest income should be handled in Dividend Income Center.
                </div>
              )}
            </div>

            <button type="submit" disabled={saving} style={buttonStyle}>
              {saving ? 'Saving...' : editingId ? 'Update Transaction' : 'Add Transaction'}
            </button>
          </form>
        </div>

        <div style={listCardStyle}>
          <div style={stickyHeaderStyle}>
            <div style={listTopStyle}>
              <div>
                <h2 style={cardTitleStyle}>Investment Transactions</h2>
                <p style={cardSubtitleStyle}>
                  Showing {filteredTransactions.length} of {transactions.length} transactions.
                </p>
              </div>

              <div style={summaryPillStyle}>
                Total: ${formatMoney(totalValue)}
              </div>
            </div>

            <div style={filterGridStyle}>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search symbol, name, account..."
                style={inputStyle}
              />

              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={inputStyle}>
                <option value="all">All types</option>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="dividend">Dividend</option>
                <option value="fee">Fee</option>
                <option value="interest">Interest</option>
              </select>

              <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} style={inputStyle}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="value_high">Value high to low</option>
                <option value="value_low">Value low to high</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div style={emptyStyle}>Loading transactions...</div>
          ) : filteredTransactions.length === 0 ? (
            <div style={emptyStyle}>No matching transactions.</div>
          ) : (
            <div style={transactionListStyle}>
              {filteredTransactions.map((tx) => {
                const value = getTxValue(tx)
                const hasCashSync = Boolean(tx.cash_sync_enabled && tx.cashflow_entry_id)

                return (
                  <div key={tx.id} style={transactionItemStyle}>
                    <div style={transactionMainStyle}>
                      <div>
                        <div style={transactionTitleRowStyle}>
                          <strong style={symbolStyle}>{tx.assets?.symbol || 'N/A'}</strong>
                          <span style={getTypeBadgeStyle(tx.type)}>{tx.type.toUpperCase()}</span>
                          {hasCashSync && <span style={cashSyncedBadgeStyle}>CASH SYNCED</span>}
                        </div>

                        <div style={mutedText}>
                          {tx.assets?.display_name || tx.assets?.symbol || 'Unknown Asset'}
                        </div>

                        <div style={mutedText}>
                          Investment: {accountNameById.get(tx.account_id) || 'Unknown Account'} · {tx.transaction_date}
                        </div>

                        {tx.cash_sync_enabled && (
                          <div style={fundingLineStyle}>
                            {tx.cash_sync_direction === 'in' ? 'Deposit to' : 'Pay from'}: {accountNameById.get(tx.funding_account_id) || 'Cash sync account missing'} · {tx.cash_sync_direction === 'in' ? 'Inflow' : 'Outflow'}: ${formatMoney(tx.cash_sync_amount || getTxValue(tx))}
                          </div>
                        )}
                      </div>

                      <div style={transactionRightStyle}>
                        <div style={valueStyle}>${formatMoney(value)}</div>
                        <div style={mutedText}>Qty: {formatNumber(tx.quantity)}</div>
                        <div style={mutedText}>Price: ${formatMoney(tx.unit_price)}</div>
                      </div>
                    </div>

                    <div style={actionRowStyle}>
                      <span style={mutedText}>Fee: ${formatMoney(tx.fee)}</span>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" onClick={() => handleEdit(tx)} style={editButtonStyle}>
                          Edit
                        </button>

                        <button type="button" onClick={() => handleDelete(tx)} style={deleteButtonStyle}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function isArchivedAccount(account) {
  return String(account?.name || '').startsWith('[ARCHIVED]') || account?.is_archived === true
}

function getTxValue(tx) {
  const quantity = Number(tx.quantity || 0)
  const unitPrice = Number(tx.unit_price || 0)
  const fee = Number(tx.fee || 0)
  return quantity * unitPrice + fee
}

function getCashMovementAmount(type, quantity, unitPrice, fee) {
  const gross = Number(quantity || 0) * Number(unitPrice || 0)
  const feeAmount = Number(fee || 0)

  if (type === 'sell') {
    return Math.max(0, gross - feeAmount)
  }

  return gross + feeAmount
}

function getFormCashMovement(formData) {
  return getCashMovementAmount(formData.type, formData.quantity, formData.unit_price, formData.fee)
}

function buildCashSyncDescription({ assetSymbol, investmentAccountName, transactionId, direction }) {
  const symbol = String(assetSymbol || 'Investment').trim().toUpperCase()
  const accountText = investmentAccountName ? ` ${direction === 'in' ? '←' : '→'} ${investmentAccountName}` : ''

  if (direction === 'in') {
    return `Investment Sell Deposit: ${symbol}${accountText} · tx:${transactionId}`
  }

  return `Investment Buy Funding: ${symbol}${accountText} · tx:${transactionId}`
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-'

  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 8
  })
}

function getTypeBadgeStyle(type) {
  const base = {
    padding: '4px 9px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 800,
    letterSpacing: '0.04em'
  }

  if (type === 'buy') {
    return {
      ...base,
      background: 'rgba(34,197,94,0.14)',
      color: 'var(--success)',
      border: '1px solid rgba(34,197,94,0.28)'
    }
  }

  if (type === 'sell') {
    return {
      ...base,
      background: 'rgba(239,68,68,0.14)',
      color: 'var(--danger)',
      border: '1px solid rgba(239,68,68,0.28)'
    }
  }

  return {
    ...base,
    background: 'rgba(96,165,250,0.14)',
    color: '#93c5fd',
    border: '1px solid rgba(96,165,250,0.28)'
  }
}

const pageHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  marginBottom: '20px',
  flexWrap: 'wrap'
}

const titleStyle = {
  margin: 0,
  color: 'var(--text-main)',
  fontSize: '34px',
  fontWeight: 800
}

const subtitleStyle = {
  marginTop: '8px',
  color: 'var(--text-muted)',
  fontSize: '16px',
  maxWidth: '920px',
  lineHeight: 1.55
}

const fundingGuardStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  marginBottom: '20px',
  padding: '16px',
  borderRadius: '18px',
  background: 'linear-gradient(135deg, var(--info-soft), var(--bg-card))',
  border: '1px solid var(--border-accent)'
}

const guardTitleStyle = {
  color: 'var(--accent)',
  fontWeight: 900,
  marginBottom: '6px'
}

const guardTextStyle = {
  margin: 0,
  color: 'var(--text-muted)',
  fontSize: '14px',
  lineHeight: 1.55,
  maxWidth: '900px'
}

const guardPillStyle = {
  padding: '7px 10px',
  borderRadius: '999px',
  background: 'var(--success-soft)',
  border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
  color: '#bbf7d0',
  fontSize: '12px',
  fontWeight: 900,
  whiteSpace: 'nowrap'
}

const layoutStyle = {
  display: 'grid',
  gridTemplateColumns: '420px minmax(0, 1fr)',
  gap: '24px',
  alignItems: 'start'
}

const formCardStyle = {
  background: 'var(--bg-card)',
  padding: '22px',
  borderRadius: '18px',
  border: '1px solid var(--border-main)',
  boxShadow: 'var(--shadow-card)',
  position: 'sticky',
  top: '20px'
}

const listCardStyle = {
  background: 'var(--bg-card)',
  padding: '22px',
  borderRadius: '18px',
  border: '1px solid var(--border-main)',
  boxShadow: 'var(--shadow-card)',
  minWidth: 0
}

const stickyHeaderStyle = {
  position: 'sticky',
  top: 0,
  zIndex: 20,
  background: 'var(--bg-card)',
  paddingBottom: '14px',
  borderBottom: '1px solid var(--border-main)'
}

const listTopStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  marginBottom: '16px',
  flexWrap: 'wrap'
}

const cardTitleStyle = {
  margin: 0,
  color: 'var(--text-main)',
  fontSize: '24px',
  fontWeight: 800
}

const cardSubtitleStyle = {
  marginTop: '6px',
  marginBottom: 0,
  color: 'var(--text-muted)',
  fontSize: '14px',
  lineHeight: 1.45
}

const formHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  marginBottom: '18px'
}

const fieldStyle = {
  marginBottom: '16px'
}

const twoColumnStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px'
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  color: 'var(--text-main)',
  fontWeight: 700
}

const helpTextStyle = {
  marginTop: '7px',
  color: 'var(--text-muted)',
  fontSize: '12px',
  lineHeight: 1.45
}

const infoTextStyle = {
  marginBottom: '12px',
  padding: '10px 12px',
  borderRadius: '12px',
  color: 'var(--text-muted)',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  fontSize: '12px',
  lineHeight: 1.45
}

const warningTextStyle = {
  marginTop: '10px',
  padding: '10px 12px',
  borderRadius: '12px',
  color: 'var(--warning)',
  background: 'var(--warning-soft)',
  border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
  fontSize: '12px',
  lineHeight: 1.45
}

const inputStyle = {
  width: '100%',
  padding: '11px 12px',
  borderRadius: '10px',
  border: '1px solid var(--border-input)',
  background: 'var(--bg-input)',
  color: 'var(--text-main)',
  outline: 'none'
}

const buttonStyle = {
  width: '100%',
  padding: '13px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--button-bg)',
  color: 'var(--button-text)',
  cursor: 'pointer',
  fontWeight: 800
}

const refreshButtonStyle = {
  padding: '11px 14px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--button-bg)',
  color: 'var(--button-text)',
  cursor: 'pointer',
  fontWeight: 800
}

const secondaryButtonStyle = {
  padding: '9px 12px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--bg-card-soft)',
  color: 'var(--button-text)',
  cursor: 'pointer',
  fontWeight: 700
}

const messageStyle = {
  marginBottom: '16px',
  padding: '12px 14px',
  borderRadius: '12px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-main)'
}

const syncBoxStyle = {
  marginBottom: '16px',
  padding: '14px',
  borderRadius: '16px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)'
}

const checkboxRowStyle = {
  display: 'flex',
  gap: '10px',
  alignItems: 'flex-start',
  color: 'var(--text-main)',
  fontWeight: 800,
  lineHeight: 1.35
}

const cashPreviewStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  padding: '12px',
  borderRadius: '14px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-accent)'
}

const cashPreviewAmountStyle = {
  color: 'var(--danger)',
  fontWeight: 950,
  fontSize: '18px',
  whiteSpace: 'nowrap'
}

const cashPreviewIncomeAmountStyle = {
  ...cashPreviewAmountStyle,
  color: 'var(--success)'
}

const filterGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1.4fr 0.8fr 0.9fr',
  gap: '12px'
}

const summaryPillStyle = {
  padding: '10px 12px',
  borderRadius: '999px',
  background: 'var(--info-soft)',
  border: '1px solid var(--border-accent)',
  color: 'var(--accent)',
  fontWeight: 800,
  whiteSpace: 'nowrap'
}

const transactionListStyle = {
  maxHeight: '680px',
  overflowY: 'auto',
  paddingRight: '6px',
  display: 'grid',
  gap: '12px'
}

const transactionItemStyle = {
  padding: '16px',
  borderRadius: '14px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)'
}

const transactionMainStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '18px'
}

const transactionTitleRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  marginBottom: '8px',
  flexWrap: 'wrap'
}

const symbolStyle = {
  fontSize: '20px',
  color: 'var(--text-main)',
  fontWeight: 900
}

const cashSyncedBadgeStyle = {
  padding: '4px 9px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 900,
  background: 'var(--info-soft)',
  color: 'var(--accent)',
  border: '1px solid var(--border-accent)'
}

const fundingLineStyle = {
  marginTop: '7px',
  color: 'var(--accent)',
  fontSize: '13px',
  lineHeight: 1.35
}

const transactionRightStyle = {
  textAlign: 'right',
  minWidth: '150px'
}

const valueStyle = {
  fontWeight: 900,
  color: 'var(--text-main)',
  fontSize: '18px',
  marginBottom: '6px'
}

const mutedText = {
  marginTop: '5px',
  color: 'var(--text-muted)',
  fontSize: '14px'
}

const actionRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  marginTop: '14px',
  paddingTop: '12px',
  borderTop: '1px solid var(--border-main)'
}

const editButtonStyle = {
  padding: '8px 12px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--button-bg)',
  color: 'var(--button-text)',
  cursor: 'pointer',
  fontWeight: 700
}

const deleteButtonStyle = {
  padding: '8px 12px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--danger)',
  color: 'var(--button-text)',
  cursor: 'pointer',
  fontWeight: 700
}

const emptyStyle = {
  padding: '24px',
  borderRadius: '14px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-muted)',
  textAlign: 'center'
}
