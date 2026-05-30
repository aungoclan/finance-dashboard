import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const LOCAL_STORAGE_KEY = 'finance_dashboard_financial_goals_v1'

const GOAL_TYPES = [
  'Emergency Fund',
  'Investment',
  'Debt Payoff',
  'Travel',
  'Car Fund',
  'House Fund',
  'Business',
  'Other'
]

const PRIORITIES = ['High', 'Medium', 'Low']
const STATUSES = ['active', 'completed', 'paused']

function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function getMonthRange(monthKey) {
  const [yearRaw, monthRaw] = String(monthKey || getMonthKey()).split('-')
  const year = Number(yearRaw)
  const monthIndex = Number(monthRaw) - 1
  const start = new Date(year, monthIndex, 1)
  const end = new Date(year, monthIndex + 1, 1)
  return {
    start,
    end,
    startKey: start.toISOString().slice(0, 10),
    endKey: end.toISOString().slice(0, 10),
    label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)))
}

function normalizeAmount(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.max(amount, 0)
}

function normalizeSignedAmount(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return amount
}

function normalizeText(value) {
  return String(value || '').trim()
}

function getProgress(goal) {
  const target = normalizeAmount(goal.target_amount)
  const current = normalizeAmount(goal.current_amount)
  if (!target) return 0
  return clampPercent((current / target) * 100)
}

function getRemaining(goal) {
  return Math.max(normalizeAmount(goal.target_amount) - normalizeAmount(goal.current_amount), 0)
}

function parseDateKey(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function getDaysLeft(goal) {
  const target = parseDateKey(goal.target_date)
  if (!target) return null
  const today = parseDateKey(todayKey())
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function getMonthsLeft(goal) {
  const daysLeft = getDaysLeft(goal)
  if (daysLeft === null) return null
  if (daysLeft <= 0) return 0
  return Math.max(daysLeft / 30.4375, 1)
}

function getMonthlyNeeded(goal) {
  const remaining = getRemaining(goal)
  const monthsLeft = getMonthsLeft(goal)
  if (!remaining || monthsLeft === null || monthsLeft <= 0) return 0
  return remaining / monthsLeft
}

function buildEmptyForm() {
  return {
    name: '',
    goal_type: 'Emergency Fund',
    target_amount: '',
    current_amount: '',
    target_date: '',
    priority: 'Medium',
    status: 'active',
    note: ''
  }
}

function buildEmptyContributionForm(goalId = '', amount = '') {
  return {
    goalId,
    amount: amount === '' ? '' : String(amount),
    date: todayKey(),
    note: '',
    appendNote: false
  }
}

function normalizeDbGoal(goal) {
  return {
    ...goal,
    goal_type: GOAL_TYPES.includes(goal.goal_type) ? goal.goal_type : 'Other',
    target_amount: normalizeAmount(goal.target_amount),
    current_amount: normalizeAmount(goal.current_amount),
    priority: PRIORITIES.includes(goal.priority) ? goal.priority : 'Medium',
    status: STATUSES.includes(goal.status) ? goal.status : 'active',
    note: goal.note || ''
  }
}

function buildGoalPayload(form, userId) {
  const name = normalizeText(form.name)
  const goalType = GOAL_TYPES.includes(form.goal_type) ? form.goal_type : 'Other'
  const priority = PRIORITIES.includes(form.priority) ? form.priority : 'Medium'
  const status = STATUSES.includes(form.status) ? form.status : 'active'

  return {
    user_id: userId,
    name,
    goal_type: goalType,
    target_amount: normalizeAmount(form.target_amount),
    current_amount: normalizeAmount(form.current_amount),
    target_date: form.target_date || null,
    priority,
    status,
    note: normalizeText(form.note) || null
  }
}

function readLocalGoals() {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('Unable to read local goals', error)
    return []
  }
}

function convertLocalGoalToPayload(goal, userId) {
  return {
    user_id: userId,
    name: normalizeText(goal.name),
    goal_type: GOAL_TYPES.includes(goal.type) ? goal.type : GOAL_TYPES.includes(goal.goal_type) ? goal.goal_type : 'Other',
    target_amount: normalizeAmount(goal.targetAmount ?? goal.target_amount),
    current_amount: normalizeAmount(goal.currentAmount ?? goal.current_amount),
    target_date: goal.targetDate || goal.target_date || null,
    priority: PRIORITIES.includes(goal.priority) ? goal.priority : 'Medium',
    status: STATUSES.includes(goal.status) ? goal.status : 'active',
    note: normalizeText(goal.note) || null
  }
}

function getHealthLabel(goal) {
  const progress = getProgress(goal)
  const remaining = getRemaining(goal)
  const daysLeft = getDaysLeft(goal)
  const createdAt = goal.created_at ? new Date(goal.created_at) : null
  const targetDate = parseDateKey(goal.target_date)
  const today = parseDateKey(todayKey())
  const priority = goal.priority || 'Medium'

  if (goal.status === 'completed' || progress >= 100 || remaining <= 0) {
    return { label: 'Completed', tone: 'good', reason: 'Goal is funded.' }
  }

  if (goal.status === 'paused') {
    return { label: 'Paused', tone: 'neutral', reason: 'Goal is paused.' }
  }

  if (!targetDate) {
    return { label: 'Needs Deadline', tone: 'warn', reason: 'Add a target date for funding math.' }
  }

  if (daysLeft !== null && daysLeft < 0) {
    return { label: 'Past Due', tone: 'danger', reason: 'Target date has passed.' }
  }

  if (!createdAt || Number.isNaN(createdAt.getTime()) || !today) {
    return { label: priority === 'High' ? 'Priority' : 'Active', tone: priority === 'High' ? 'warn' : 'neutral', reason: 'Active goal.' }
  }

  const startMs = createdAt.getTime()
  const targetMs = targetDate.getTime()
  const todayMs = today.getTime()
  const totalMs = targetMs - startMs
  const elapsedMs = todayMs - startMs

  if (totalMs <= 0) {
    return { label: 'Review', tone: 'warn', reason: 'Target timeline needs review.' }
  }

  const expectedProgress = clampPercent((elapsedMs / totalMs) * 100)
  const gap = progress - expectedProgress

  if (gap >= 8) return { label: 'Ahead', tone: 'good', reason: 'Current progress is ahead of timeline.' }
  if (gap <= -8) return { label: 'Behind', tone: 'danger', reason: 'Current progress is behind timeline.' }
  return { label: 'On Track', tone: 'good', reason: 'Current progress roughly matches timeline.' }
}

function getPriorityWeight(goal, health) {
  let score = 1
  if (goal.priority === 'High') score += 3
  if (goal.priority === 'Medium') score += 2
  if (goal.goal_type === 'Emergency Fund') score += 3
  if (health.label === 'Behind' || health.label === 'Past Due') score += 3
  if (health.label === 'Needs Deadline') score += 0.5

  const daysLeft = getDaysLeft(goal)
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 90) score += 2
  if (daysLeft !== null && daysLeft > 90 && daysLeft <= 180) score += 1

  return score
}

function buildGoalInsights(goal) {
  const health = getHealthLabel(goal)
  const remaining = getRemaining(goal)
  const monthlyNeeded = getMonthlyNeeded(goal)
  const monthsLeft = getMonthsLeft(goal)
  const daysLeft = getDaysLeft(goal)
  const progress = getProgress(goal)
  const priorityWeight = getPriorityWeight(goal, health)

  return {
    ...goal,
    health,
    remaining,
    monthlyNeeded,
    monthsLeft,
    daysLeft,
    progress,
    priorityWeight,
    isEligibleForFunding: goal.status === 'active' && remaining > 0
  }
}

function buildFundingSuggestions(goalInsights, fundingPool) {
  const pool = Math.max(normalizeSignedAmount(fundingPool), 0)
  const eligible = goalInsights
    .filter((goal) => goal.isEligibleForFunding)
    .map((goal) => {
      const baseNeed = goal.monthlyNeeded > 0 ? goal.monthlyNeeded : Math.max(Math.min(goal.remaining / 12, goal.remaining), 0)
      const weightedNeed = Math.max(baseNeed, 1) * goal.priorityWeight
      return { ...goal, baseNeed, weightedNeed }
    })

  const totalWeightedNeed = eligible.reduce((sum, goal) => sum + goal.weightedNeed, 0)
  if (pool <= 0 || totalWeightedNeed <= 0) {
    return goalInsights.map((goal) => ({ ...goal, suggestedFunding: 0 }))
  }

  return goalInsights.map((goal) => {
    const match = eligible.find((item) => item.id === goal.id)
    if (!match) return { ...goal, suggestedFunding: 0 }
    const rawSuggestion = pool * (match.weightedNeed / totalWeightedNeed)
    const cappedSuggestion = Math.min(goal.remaining, rawSuggestion)
    return {
      ...goal,
      suggestedFunding: cappedSuggestion >= 1 ? Math.round(cappedSuggestion * 100) / 100 : 0
    }
  })
}

function getHealthStyle(tone) {
  if (tone === 'good') return { background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)', borderColor: 'var(--success)' }
  if (tone === 'danger') return { background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)', borderColor: 'var(--danger)' }
  if (tone === 'warn') return { background: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)', borderColor: 'var(--warning)' }
  return { background: 'color-mix(in srgb, var(--accent-strong) 12%, transparent)', color: 'var(--accent-strong)', borderColor: 'var(--accent-strong)' }
}

export default function FinancialGoalsPage() {
  const [userId, setUserId] = useState(null)
  const [goals, setGoals] = useState([])
  const [cashflowEntries, setCashflowEntries] = useState([])
  const [form, setForm] = useState(buildEmptyForm())
  const [contributionForm, setContributionForm] = useState(buildEmptyContributionForm())
  const [editingId, setEditingId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [monthKey, setMonthKey] = useState(getMonthKey())
  const [fundingPoolOverride, setFundingPoolOverride] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tableMissing, setTableMissing] = useState(false)
  const [localGoalCount, setLocalGoalCount] = useState(0)

  useEffect(() => {
    loadGoals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey])

  async function getCurrentUserId() {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser()

    if (error || !user) {
      throw new Error('Unable to get current user.')
    }

    setUserId(user.id)
    return user.id
  }

  async function loadGoals() {
    setLoading(true)
    setMessage('')
    setTableMissing(false)

    try {
      const currentUserId = await getCurrentUserId()
      const range = getMonthRange(monthKey)
      setLocalGoalCount(readLocalGoals().filter((goal) => normalizeText(goal.name)).length)

      const [goalResult, cashflowResult] = await Promise.all([
        supabase
          .from('financial_goals')
          .select('*')
          .eq('user_id', currentUserId)
          .order('status', { ascending: true })
          .order('priority', { ascending: true })
          .order('target_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('cashflow_entries')
          .select('id,user_id,entry_date,type,amount,category,description,account_id,created_at')
          .eq('user_id', currentUserId)
          .gte('entry_date', range.startKey)
          .lt('entry_date', range.endKey)
          .order('entry_date', { ascending: false })
      ])

      if (goalResult.error) {
        if (String(goalResult.error.message || '').toLowerCase().includes('financial_goals')) {
          setTableMissing(true)
        }
        throw goalResult.error
      }
      if (cashflowResult.error) throw cashflowResult.error

      setGoals((goalResult.data || []).map(normalizeDbGoal))
      setCashflowEntries(cashflowResult.data || [])
    } catch (error) {
      console.error(error)
      setGoals([])
      setCashflowEntries([])
      setMessage(error.message || 'Failed to load financial goals.')
    }

    setLoading(false)
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function updateContributionForm(field, value) {
    setContributionForm((current) => ({ ...current, [field]: value }))
  }

  function resetForm() {
    setForm(buildEmptyForm())
    setEditingId(null)
  }

  function resetContributionForm() {
    setContributionForm(buildEmptyContributionForm())
  }

  function validateGoal(payload) {
    if (!payload.name) return 'Please enter a goal name.'
    if (payload.target_amount <= 0) return 'Target amount must be greater than 0.'
    if (payload.current_amount < 0) return 'Current amount cannot be negative.'
    if (payload.current_amount > payload.target_amount && payload.status !== 'completed') {
      return 'Current amount is above target. Set status to completed or lower the current amount.'
    }
    return ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const currentUserId = userId || (await getCurrentUserId())
      const payload = buildGoalPayload(form, currentUserId)
      const validationError = validateGoal(payload)
      if (validationError) throw new Error(validationError)

      if (editingId) {
        const { error } = await supabase
          .from('financial_goals')
          .update({
            name: payload.name,
            goal_type: payload.goal_type,
            target_amount: payload.target_amount,
            current_amount: payload.current_amount,
            target_date: payload.target_date,
            priority: payload.priority,
            status: payload.status,
            note: payload.note
          })
          .eq('id', editingId)
          .eq('user_id', currentUserId)

        if (error) throw error
        setMessage('Goal updated successfully.')
      } else {
        const { error } = await supabase.from('financial_goals').insert(payload)
        if (error) throw error
        setMessage('Goal added successfully.')
      }

      resetForm()
      await loadGoals()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to save goal.')
    }

    setSaving(false)
  }

  function startEdit(goal) {
    setEditingId(goal.id)
    setForm({
      name: goal.name || '',
      goal_type: goal.goal_type || 'Other',
      target_amount: String(goal.target_amount || ''),
      current_amount: String(goal.current_amount || ''),
      target_date: goal.target_date || '',
      priority: goal.priority || 'Medium',
      status: goal.status || 'active',
      note: goal.note || ''
    })
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startSuggestedContribution(goal, amount = '') {
    const safeAmount = amount || goal.suggestedFunding || goal.monthlyNeeded || ''
    setContributionForm({
      ...buildEmptyContributionForm(goal.id, safeAmount ? Math.round(Number(safeAmount) * 100) / 100 : ''),
      note: goal.suggestedFunding
        ? `Manual funding from Goals Funding Pro suggestion for ${getMonthRange(monthKey).label}.`
        : ''
    })
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function deleteGoal(goal) {
    const ok = window.confirm(`Delete goal "${goal.name}"? This will remove it from Supabase.`)
    if (!ok) return

    setSaving(true)
    setMessage('')

    try {
      const currentUserId = userId || (await getCurrentUserId())
      const { error } = await supabase
        .from('financial_goals')
        .delete()
        .eq('id', goal.id)
        .eq('user_id', currentUserId)

      if (error) throw error
      if (editingId === goal.id) resetForm()
      if (contributionForm.goalId === goal.id) resetContributionForm()
      setMessage('Goal deleted.')
      await loadGoals()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to delete goal.')
    }

    setSaving(false)
  }

  async function updateGoal(goal, updates, successMessage = 'Goal updated.') {
    setSaving(true)
    setMessage('')

    try {
      const currentUserId = userId || (await getCurrentUserId())
      const next = normalizeDbGoal({ ...goal, ...updates })
      const payload = {
        goal_type: next.goal_type,
        target_amount: normalizeAmount(next.target_amount),
        current_amount: normalizeAmount(next.current_amount),
        target_date: next.target_date || null,
        priority: next.priority,
        status: next.status,
        note: next.note || null
      }

      if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
        payload.name = normalizeText(updates.name)
      }

      const { error } = await supabase
        .from('financial_goals')
        .update(payload)
        .eq('id', goal.id)
        .eq('user_id', currentUserId)

      if (error) throw error
      setMessage(successMessage)
      await loadGoals()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to update goal.')
    }

    setSaving(false)
  }

  async function handleManualContribution(event) {
    event.preventDefault()
    const goal = goals.find((item) => item.id === contributionForm.goalId)
    const amount = normalizeAmount(contributionForm.amount)

    if (!goal) {
      setMessage('Please choose a goal for this contribution.')
      return
    }
    if (amount <= 0) {
      setMessage('Contribution must be greater than 0.')
      return
    }

    const remaining = getRemaining(goal)
    if (amount > remaining) {
      const ok = window.confirm(
        `This contribution is higher than the remaining goal balance by ${formatMoney(amount - remaining)}. Continue and mark complete?`
      )
      if (!ok) return
    }

    const nextAmount = normalizeAmount(goal.current_amount) + amount
    const nextStatus = nextAmount >= normalizeAmount(goal.target_amount) ? 'completed' : goal.status
    let nextNote = goal.note || ''
    const contributionNote = normalizeText(contributionForm.note)

    if (contributionForm.appendNote) {
      const logLine = `[${contributionForm.date || todayKey()}] Contribution +${formatMoney(amount)}${contributionNote ? ` · ${contributionNote}` : ''}`
      nextNote = nextNote ? `${nextNote}\n${logLine}` : logLine
    }

    if (nextStatus === 'completed') setStatusFilter('all')

    await updateGoal(
      goal,
      { current_amount: nextAmount, status: nextStatus, note: nextNote },
      nextStatus === 'completed'
        ? `Added ${formatMoney(amount)} to ${goal.name}. Goal marked complete.`
        : `Added ${formatMoney(amount)} to ${goal.name}.`
    )
    resetContributionForm()
  }

  async function importLocalGoals() {
    setSaving(true)
    setMessage('')

    try {
      const localGoals = readLocalGoals().filter((goal) => normalizeText(goal.name))
      if (localGoals.length === 0) throw new Error('No local goals found to import.')

      const currentUserId = userId || (await getCurrentUserId())
      const payloads = localGoals.map((goal) => convertLocalGoalToPayload(goal, currentUserId)).filter((goal) => goal.name)

      const { error } = await supabase.from('financial_goals').insert(payloads)
      if (error) throw error

      window.localStorage.removeItem(LOCAL_STORAGE_KEY)
      setLocalGoalCount(0)
      setMessage(`Imported ${payloads.length} local goal${payloads.length === 1 ? '' : 's'} to Supabase.`)
      await loadGoals()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to import local goals.')
    }

    setSaving(false)
  }

  const monthSummary = useMemo(() => {
    const income = cashflowEntries
      .filter((entry) => entry.type === 'income')
      .reduce((sum, entry) => sum + normalizeAmount(entry.amount), 0)
    const expenses = cashflowEntries
      .filter((entry) => entry.type === 'expense')
      .reduce((sum, entry) => sum + normalizeAmount(entry.amount), 0)
    const net = income - expenses
    return { income, expenses, net, positiveSurplus: Math.max(net, 0) }
  }, [cashflowEntries])

  const goalInsights = useMemo(() => {
    return goals.map(buildGoalInsights)
  }, [goals])

  const fundingPool = useMemo(() => {
    if (fundingPoolOverride !== '') return Math.max(normalizeSignedAmount(fundingPoolOverride), 0)
    return monthSummary.positiveSurplus
  }, [fundingPoolOverride, monthSummary.positiveSurplus])

  const goalsWithSuggestions = useMemo(() => {
    return buildFundingSuggestions(goalInsights, fundingPool)
  }, [goalInsights, fundingPool])

  const filteredGoals = useMemo(() => {
    let rows = [...goalsWithSuggestions]
    if (statusFilter !== 'all') rows = rows.filter((goal) => goal.status === statusFilter)
    if (typeFilter !== 'all') rows = rows.filter((goal) => goal.goal_type === typeFilter)

    return rows.sort((a, b) => {
      const statusRank = { active: 0, paused: 1, completed: 2 }
      const healthRank = { 'Past Due': 0, Behind: 1, 'Needs Deadline': 2, 'On Track': 3, Ahead: 4, Priority: 5, Active: 6, Paused: 7, Completed: 8 }
      const priorityRank = { High: 0, Medium: 1, Low: 2 }
      const statusDiff = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9)
      if (statusDiff !== 0) return statusDiff
      const healthDiff = (healthRank[a.health?.label] ?? 9) - (healthRank[b.health?.label] ?? 9)
      if (healthDiff !== 0) return healthDiff
      const priorityDiff = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)
      if (priorityDiff !== 0) return priorityDiff
      return String(a.target_date || '9999-12-31').localeCompare(String(b.target_date || '9999-12-31'))
    })
  }, [goalsWithSuggestions, statusFilter, typeFilter])

  const selectedContributionGoal = useMemo(() => {
    return goalsWithSuggestions.find((goal) => goal.id === contributionForm.goalId) || null
  }, [contributionForm.goalId, goalsWithSuggestions])

  const summary = useMemo(() => {
    const activeGoals = goalsWithSuggestions.filter((goal) => goal.status === 'active')
    const completedGoals = goalsWithSuggestions.filter((goal) => goal.status === 'completed')
    const behindGoals = goalsWithSuggestions.filter((goal) => goal.health?.label === 'Behind' || goal.health?.label === 'Past Due')
    const allTargetTotal = goalsWithSuggestions.reduce((sum, goal) => sum + normalizeAmount(goal.target_amount), 0)
    const allCurrentTotal = goalsWithSuggestions.reduce((sum, goal) => sum + normalizeAmount(goal.current_amount), 0)
    const activeRemainingTotal = activeGoals.reduce((sum, goal) => sum + goal.remaining, 0)
    const activeMonthlyNeeded = activeGoals.reduce((sum, goal) => sum + goal.monthlyNeeded, 0)
    const suggestedTotal = goalsWithSuggestions.reduce((sum, goal) => sum + normalizeAmount(goal.suggestedFunding), 0)
    const progress = allTargetTotal > 0 ? (allCurrentTotal / allTargetTotal) * 100 : 0
    const emergencyGoals = goalsWithSuggestions.filter((goal) => goal.goal_type === 'Emergency Fund')
    const emergencyTarget = emergencyGoals.reduce((sum, goal) => sum + normalizeAmount(goal.target_amount), 0)
    const emergencyCurrent = emergencyGoals.reduce((sum, goal) => sum + normalizeAmount(goal.current_amount), 0)
    const emergencyGap = Math.max(emergencyTarget - emergencyCurrent, 0)

    return {
      totalCount: goalsWithSuggestions.length,
      activeCount: activeGoals.length,
      completedCount: completedGoals.length,
      behindCount: behindGoals.length,
      targetTotal: allTargetTotal,
      currentTotal: allCurrentTotal,
      remainingTotal: activeRemainingTotal,
      monthlyNeeded: activeMonthlyNeeded,
      suggestedTotal,
      progress,
      emergencyTarget,
      emergencyCurrent,
      emergencyGap
    }
  }, [goalsWithSuggestions])

  const priorityQueue = useMemo(() => {
    return goalsWithSuggestions
      .filter((goal) => goal.isEligibleForFunding)
      .sort((a, b) => {
        const scoreDiff = b.priorityWeight - a.priorityWeight
        if (scoreDiff !== 0) return scoreDiff
        return (b.monthlyNeeded || 0) - (a.monthlyNeeded || 0)
      })
      .slice(0, 5)
  }, [goalsWithSuggestions])

  const typeBreakdown = useMemo(() => {
    const map = new Map()
    goalsWithSuggestions.forEach((goal) => {
      const key = goal.goal_type || 'Other'
      if (!map.has(key)) map.set(key, { type: key, count: 0, current: 0, target: 0 })
      const item = map.get(key)
      item.count += 1
      item.current += normalizeAmount(goal.current_amount)
      item.target += normalizeAmount(goal.target_amount)
    })
    return Array.from(map.values()).sort((a, b) => b.target - a.target)
  }, [goalsWithSuggestions])

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>BÀI 50 · GOALS FUNDING PRO</div>
          <h1 style={titleStyle}>Financial Goals</h1>
          <p style={subtitleStyle}>
            Track goals, calculate required monthly funding, review suggested allocation, and manually add contributions without auto-posting to Cashflow.
          </p>
        </div>
        <div style={heroButtonRowStyle}>
          <button onClick={loadGoals} disabled={loading || saving} style={secondaryButtonStyle}>Refresh</button>
          <button onClick={resetForm} disabled={saving} style={secondaryButtonStyle}>New Goal</button>
        </div>
      </section>

      {message && <div style={messageStyle}>{message}</div>}

      {tableMissing && (
        <section style={warningPanelStyle}>
          <h2 style={warningTitleStyle}>Supabase table needed</h2>
          <p style={mutedStyle}>Run the SQL file included in this zip first:</p>
          <pre style={codeBlockStyle}>supabase/sql/20260425_create_financial_goals.sql</pre>
          <p style={mutedStyle}>After running it in Supabase SQL Editor, refresh this page.</p>
        </section>
      )}

      {localGoalCount > 0 && !tableMissing && (
        <section style={localImportStyle}>
          <div>
            <strong>{localGoalCount} local goal{localGoalCount === 1 ? '' : 's'} found from the first version.</strong>
            <p style={localImportTextStyle}>Import them into Supabase so they are online, then local storage will be cleared.</p>
          </div>
          <button onClick={importLocalGoals} disabled={saving || loading} style={primaryButtonSmallStyle}>Import Local Goals</button>
        </section>
      )}

      <section style={summaryGridStyle}>
        <MetricCard label="Total Goals" value={summary.totalCount} sub={`${summary.activeCount} active · ${summary.completedCount} completed`} />
        <MetricCard label="Saved Toward Goals" value={formatMoney(summary.currentTotal)} sub={`${formatPercent(summary.progress)} of all targets`} positive />
        <MetricCard label="Active Remaining" value={formatMoney(summary.remainingTotal)} sub="Left across active goals" />
        <MetricCard label="Monthly Needed" value={formatMoney(summary.monthlyNeeded)} sub="For active goals only" />
      </section>

      <section style={fundingPanelStyle}>
        <div style={panelHeaderStyle}>
          <div>
            <div style={eyebrowStyle}>SUGGEST + MANUAL CONTRIBUTION</div>
            <h2 style={panelTitleStyle}>Goals Funding Center</h2>
            <p style={mutedStyle}>
              This panel suggests funding based on monthly surplus, priority, deadline, and goal health. It does not auto-create cashflow or transfer money.
            </p>
          </div>
          <div style={fundingControlsStyle}>
            <label style={labelStyle}>Funding Month</label>
            <input type="month" value={monthKey} onChange={(event) => setMonthKey(event.target.value || getMonthKey())} style={inputStyle} />
            <label style={labelStyle}>Available Funding Override</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={fundingPoolOverride}
              onChange={(event) => setFundingPoolOverride(event.target.value)}
              placeholder={`Auto: ${formatMoney(monthSummary.positiveSurplus)}`}
              style={inputStyle}
            />
            {fundingPoolOverride !== '' && (
              <button type="button" onClick={() => setFundingPoolOverride('')} style={tinyButtonStyle}>Use Auto Surplus</button>
            )}
          </div>
        </div>

        <div style={fundingSummaryGridStyle}>
          <MetricCard label="Month Income" value={formatMoney(monthSummary.income)} sub={getMonthRange(monthKey).label} positive />
          <MetricCard label="Month Expenses" value={formatMoney(monthSummary.expenses)} sub="Cashflow expenses" />
          <MetricCard label="Available Funding" value={formatMoney(fundingPool)} sub={fundingPoolOverride === '' ? 'Auto from monthly surplus' : 'Manual override'} positive={fundingPool > 0} />
          <MetricCard label="Suggested Total" value={formatMoney(summary.suggestedTotal)} sub={`${summary.behindCount} goal${summary.behindCount === 1 ? '' : 's'} need review`} />
        </div>

        <div style={fundingGridStyle}>
          <div style={subPanelStyle}>
            <h3 style={subPanelTitleStyle}>Suggested Allocation</h3>
            <p style={smallMutedStyle}>Click Add to open the manual contribution form. You can edit the amount before saving.</p>
            <div style={suggestionListStyle}>
              {priorityQueue.length === 0 ? (
                <div style={emptyStyle}>No active goals need funding right now.</div>
              ) : (
                priorityQueue.map((goal) => (
                  <SuggestionRow key={goal.id} goal={goal} disabled={saving} onAdd={startSuggestedContribution} />
                ))
              )}
            </div>
          </div>

          <div style={subPanelStyle}>
            <h3 style={subPanelTitleStyle}>Manual Contribution</h3>
            <p style={smallMutedStyle}>
              This updates the selected goal current amount only. It does not post to Cashflow and does not move money between accounts.
            </p>
            <form onSubmit={handleManualContribution} style={formStyle}>
              <label style={labelStyle}>Goal</label>
              <select value={contributionForm.goalId} onChange={(event) => updateContributionForm('goalId', event.target.value)} style={inputStyle}>
                <option value="">Choose a goal</option>
                {goalsWithSuggestions
                  .filter((goal) => goal.status !== 'completed')
                  .map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}
              </select>

              <div style={twoColumnFormStyle}>
                <div>
                  <label style={labelStyle}>Amount</label>
                  <input type="number" min="0" step="0.01" value={contributionForm.amount} onChange={(event) => updateContributionForm('amount', event.target.value)} placeholder="250" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input type="date" value={contributionForm.date} onChange={(event) => updateContributionForm('date', event.target.value)} style={inputStyle} />
                </div>
              </div>

              <label style={labelStyle}>Note</label>
              <textarea value={contributionForm.note} onChange={(event) => updateContributionForm('note', event.target.value)} placeholder="Optional funding note..." style={textareaStyle} />

              <label style={checkboxRowStyle}>
                <input type="checkbox" checked={contributionForm.appendNote} onChange={(event) => updateContributionForm('appendNote', event.target.checked)} />
                Add this contribution note to the goal note field
              </label>

              {selectedContributionGoal && (
                <div style={selectedGoalBoxStyle}>
                  <div style={rowBetweenStyle}>
                    <strong>{selectedContributionGoal.name}</strong>
                    <span>{formatMoney(selectedContributionGoal.current_amount)} / {formatMoney(selectedContributionGoal.target_amount)}</span>
                  </div>
                  <div style={progressTrackStyle}><div style={{ ...progressFillStyle, width: `${selectedContributionGoal.progress}%` }} /></div>
                  <div style={smallMutedStyle}>Remaining: {formatMoney(selectedContributionGoal.remaining)} · Suggested: {formatMoney(selectedContributionGoal.suggestedFunding)}</div>
                </div>
              )}

              <div style={buttonRowStyle}>
                <button type="submit" disabled={saving || loading || tableMissing} style={primaryButtonStyle}>{saving ? 'Saving...' : 'Save Contribution'}</button>
                <button type="button" disabled={saving} onClick={resetContributionForm} style={secondaryButtonStyle}>Clear</button>
              </div>
            </form>
          </div>
        </div>

        <div style={infoStripStyle}>
          <strong>Safe logic:</strong> contribution = update goal current amount. No Cashflow entry, no account transfer, no new database table.
        </div>
      </section>

      <section style={contentGridStyle}>
        <div style={panelStyle}>
          <h2 style={panelTitleStyle}>{editingId ? 'Edit Goal' : 'Add Goal'}</h2>
          <p style={mutedStyle}>Goals are stored in Supabase and connected to your logged-in user.</p>

          <form onSubmit={handleSubmit} style={formStyle}>
            <label style={labelStyle}>Goal Name</label>
            <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="Example: Emergency Fund, House Down Payment" style={inputStyle} />

            <div style={twoColumnFormStyle}>
              <div>
                <label style={labelStyle}>Goal Type</label>
                <select value={form.goal_type} onChange={(event) => updateForm('goal_type', event.target.value)} style={inputStyle}>
                  {GOAL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Priority</label>
                <select value={form.priority} onChange={(event) => updateForm('priority', event.target.value)} style={inputStyle}>
                  {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                </select>
              </div>
            </div>

            <div style={twoColumnFormStyle}>
              <div>
                <label style={labelStyle}>Target Amount</label>
                <input type="number" min="0" step="0.01" value={form.target_amount} onChange={(event) => updateForm('target_amount', event.target.value)} placeholder="10000" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Current Amount</label>
                <input type="number" min="0" step="0.01" value={form.current_amount} onChange={(event) => updateForm('current_amount', event.target.value)} placeholder="2500" style={inputStyle} />
              </div>
            </div>

            <div style={twoColumnFormStyle}>
              <div>
                <label style={labelStyle}>Target Date</label>
                <input type="date" value={form.target_date} onChange={(event) => updateForm('target_date', event.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Status</label>
                <select value={form.status} onChange={(event) => updateForm('status', event.target.value)} style={inputStyle}>
                  {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
            </div>

            <label style={labelStyle}>Note</label>
            <textarea value={form.note} onChange={(event) => updateForm('note', event.target.value)} placeholder="Why this goal matters, strategy, or reminder..." style={textareaStyle} />

            <div style={buttonRowStyle}>
              <button type="submit" disabled={saving || loading || tableMissing} style={primaryButtonStyle}>{saving ? 'Saving...' : editingId ? 'Save Goal' : 'Add Goal'}</button>
              {editingId && <button type="button" onClick={resetForm} disabled={saving} style={secondaryButtonStyle}>Cancel</button>}
            </div>
          </form>
        </div>

        <div style={panelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <h2 style={panelTitleStyle}>Your Goals</h2>
              <p style={mutedStyle}>Goal cards now include health, suggested funding, and manual contribution controls.</p>
            </div>
            <div style={filterRowStyle}>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={smallSelectStyle}>
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={smallSelectStyle}>
                <option value="all">All types</option>
                {GOAL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
          </div>

          <div style={goalsListStyle}>
            {loading ? (
              <div style={emptyStyle}>Loading goals...</div>
            ) : filteredGoals.length === 0 ? (
              <div style={emptyStyle}>No goals match this view. Add a goal or change your filters.</div>
            ) : (
              filteredGoals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  disabled={saving}
                  onEdit={startEdit}
                  onDelete={deleteGoal}
                  onUpdate={updateGoal}
                  onAddContribution={startSuggestedContribution}
                />
              ))
            )}
          </div>
        </div>
      </section>

      <section style={panelStyle}>
        <h2 style={panelTitleStyle}>Goal Type Breakdown</h2>
        <p style={mutedStyle}>A quick overview of how your goals are distributed by category.</p>
        <div style={breakdownGridStyle}>
          {typeBreakdown.length === 0 ? (
            <div style={emptyStyle}>No breakdown yet.</div>
          ) : (
            typeBreakdown.map((item) => {
              const progress = item.target > 0 ? (item.current / item.target) * 100 : 0
              return (
                <div key={item.type} style={breakdownCardStyle}>
                  <div style={rowBetweenStyle}>
                    <strong>{item.type}</strong>
                    <span>{formatMoney(item.current)} / {formatMoney(item.target)}</span>
                  </div>
                  <div style={progressTrackStyle}><div style={{ ...progressFillStyle, width: `${clampPercent(progress)}%` }} /></div>
                  <div style={smallMutedStyle}>{item.count} goal{item.count === 1 ? '' : 's'} · {formatPercent(progress)}</div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}

function MetricCard({ label, value, sub, positive }) {
  return (
    <div style={metricCardStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ ...metricValueStyle, color: positive ? 'var(--success)' : 'var(--text-main)' }}>{value}</div>
      <div style={metricSubStyle}>{sub}</div>
    </div>
  )
}

function SuggestionRow({ goal, disabled, onAdd }) {
  return (
    <div style={suggestionRowStyle}>
      <div style={{ minWidth: 0 }}>
        <div style={goalTitleRowStyle}>
          <strong style={suggestionNameStyle}>{goal.name}</strong>
          <span style={{ ...miniBadgeStyle, ...getHealthStyle(goal.health?.tone) }}>{goal.health?.label || 'Active'}</span>
        </div>
        <div style={smallMutedStyle}>
          {goal.goal_type} · {goal.priority} · Monthly needed {formatMoney(goal.monthlyNeeded)}
        </div>
      </div>
      <div style={suggestionAmountBlockStyle}>
        <div style={suggestionAmountStyle}>{formatMoney(goal.suggestedFunding)}</div>
        <button disabled={disabled || goal.suggestedFunding <= 0} onClick={() => onAdd(goal, goal.suggestedFunding)} style={tinyButtonStyle}>Add</button>
      </div>
    </div>
  )
}

function GoalCard({ goal, disabled, onEdit, onDelete, onUpdate, onAddContribution }) {
  const progress = goal.progress ?? getProgress(goal)
  const remaining = goal.remaining ?? getRemaining(goal)
  const daysLeft = goal.daysLeft ?? getDaysLeft(goal)
  const monthlyNeeded = goal.monthlyNeeded ?? getMonthlyNeeded(goal)
  const isCompleted = goal.status === 'completed' || progress >= 100
  const isLate = daysLeft !== null && daysLeft < 0 && !isCompleted
  const healthStyle = getHealthStyle(goal.health?.tone)

  return (
    <article style={goalCardStyle}>
      <div style={goalHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={goalTitleRowStyle}>
            <h3 style={goalNameStyle}>{goal.name}</h3>
            <span style={{ ...badgeStyle, ...statusBadgeStyle(goal.status, isLate) }}>{isLate ? 'late' : goal.status}</span>
            <span style={{ ...badgeStyle, ...healthStyle }}>{goal.health?.label || 'Active'}</span>
          </div>
          <div style={goalMetaStyle}>{goal.goal_type} · {goal.priority} priority{goal.target_date ? ` · Target ${goal.target_date}` : ''}</div>
        </div>
        <div style={goalAmountStyle}>{formatMoney(goal.current_amount)} / {formatMoney(goal.target_amount)}</div>
      </div>

      <div style={progressTrackStyle}><div style={{ ...progressFillStyle, width: `${progress}%` }} /></div>

      <div style={goalStatsGridStyle}>
        <MiniStat label="Progress" value={formatPercent(progress)} />
        <MiniStat label="Remaining" value={formatMoney(remaining)} />
        <MiniStat label="Monthly Needed" value={monthlyNeeded ? formatMoney(monthlyNeeded) : '$0.00'} />
        <MiniStat label="Suggested" value={formatMoney(goal.suggestedFunding)} positive={goal.suggestedFunding > 0} />
        <MiniStat label="Days Left" value={daysLeft === null ? 'No date' : String(daysLeft)} danger={isLate} />
      </div>

      {goal.health?.reason && <p style={insightNoteStyle}>{goal.health.reason}</p>}
      {goal.note && <p style={noteStyle}>{goal.note}</p>}

      <div style={actionRowStyle}>
        <button disabled={disabled || isCompleted} onClick={() => onAddContribution(goal, goal.suggestedFunding || goal.monthlyNeeded)} style={tinyButtonStyle}>Add Contribution</button>
        <button disabled={disabled} onClick={() => onEdit(goal)} style={tinyButtonStyle}>Edit</button>
        {goal.status !== 'completed' ? (
          <button disabled={disabled} onClick={() => onUpdate(goal, { status: 'completed' }, 'Goal marked complete.')} style={tinyButtonStyle}>Complete</button>
        ) : (
          <button disabled={disabled} onClick={() => onUpdate(goal, { status: 'active' }, 'Goal reactivated.')} style={tinyButtonStyle}>Reactivate</button>
        )}
        {goal.status === 'paused' ? (
          <button disabled={disabled} onClick={() => onUpdate(goal, { status: 'active' }, 'Goal resumed.')} style={tinyButtonStyle}>Resume</button>
        ) : goal.status !== 'completed' ? (
          <button disabled={disabled} onClick={() => onUpdate(goal, { status: 'paused' }, 'Goal paused.')} style={tinyButtonStyle}>Pause</button>
        ) : null}
        <button disabled={disabled} onClick={() => onDelete(goal)} style={dangerButtonStyle}>Delete</button>
      </div>
    </article>
  )
}

function MiniStat({ label, value, danger, positive }) {
  return (
    <div style={miniStatStyle}>
      <div style={smallMutedStyle}>{label}</div>
      <strong style={{ color: danger ? 'var(--danger)' : positive ? 'var(--success)' : 'var(--text-main)' }}>{value}</strong>
    </div>
  )
}

function statusBadgeStyle(status, isLate) {
  if (isLate) return { background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)', borderColor: 'var(--danger)' }
  if (status === 'completed') return { background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)', borderColor: 'var(--success)' }
  if (status === 'paused') return { background: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)', borderColor: 'var(--warning)' }
  return { background: 'color-mix(in srgb, var(--accent-strong) 12%, transparent)', color: 'var(--accent-strong)', borderColor: 'var(--accent-strong)' }
}

const pageStyle = { display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1500px', margin: '0 auto', color: 'var(--text-main)' }
const heroStyle = { border: '1px solid var(--border-main)', borderRadius: '18px', padding: '28px', background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-strong) 12%, transparent), var(--bg-card) 58%, color-mix(in srgb, var(--success) 10%, transparent))', display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }
const heroButtonRowStyle = { display: 'flex', gap: '10px', flexWrap: 'wrap' }
const eyebrowStyle = { color: 'var(--accent-strong)', letterSpacing: '0.14em', fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', marginBottom: '8px' }
const titleStyle = { margin: 0, fontSize: '36px', lineHeight: 1.1, fontWeight: 900 }
const subtitleStyle = { margin: '12px 0 0', color: 'var(--text-muted)', fontSize: '17px', lineHeight: 1.5, maxWidth: '850px' }
const messageStyle = { border: '1px solid var(--accent-strong)', background: 'color-mix(in srgb, var(--accent-strong) 12%, transparent)', color: 'var(--text-main)', borderRadius: '14px', padding: '12px 16px' }
const warningPanelStyle = { border: '1px solid var(--warning)', borderRadius: '16px', padding: '18px', background: 'color-mix(in srgb, var(--warning) 12%, transparent)' }
const warningTitleStyle = { margin: '0 0 10px', color: 'var(--warning)', fontSize: '22px' }
const codeBlockStyle = { background: 'var(--bg-card-soft)', border: '1px solid var(--border-main)', borderRadius: '12px', padding: '12px', color: 'var(--text-main)', overflowX: 'auto' }
const localImportStyle = { border: '1px solid var(--success)', borderRadius: '16px', padding: '16px', background: 'color-mix(in srgb, var(--success) 12%, transparent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }
const localImportTextStyle = { margin: '6px 0 0', color: 'var(--success)' }
const summaryGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }
const metricCardStyle = { border: '1px solid var(--border-main)', borderRadius: '16px', padding: '20px', background: 'var(--bg-card)', minWidth: 0 }
const metricLabelStyle = { color: 'var(--text-muted)', fontSize: '14px', marginBottom: '12px' }
const metricValueStyle = { fontSize: '30px', fontWeight: 900, lineHeight: 1.1, wordBreak: 'break-word' }
const metricSubStyle = { color: 'var(--text-muted)', fontSize: '14px', marginTop: '10px' }
const fundingPanelStyle = { border: '1px solid var(--accent-strong)', borderRadius: '20px', padding: '24px', background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-strong) 12%, transparent), var(--bg-card))', minWidth: 0 }
const fundingControlsStyle = { display: 'grid', gridTemplateColumns: '1fr', gap: '8px', minWidth: '260px', maxWidth: '340px' }
const fundingSummaryGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px', margin: '18px 0' }
const fundingGridStyle = { display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(300px, 1fr)', gap: '16px', alignItems: 'start' }
const subPanelStyle = { border: '1px solid var(--border-main)', borderRadius: '16px', padding: '18px', background: 'var(--bg-card-soft)', minWidth: 0 }
const subPanelTitleStyle = { margin: '0 0 8px', fontSize: '21px', fontWeight: 900 }
const suggestionListStyle = { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }
const suggestionRowStyle = { border: '1px solid var(--border-main)', borderRadius: '14px', padding: '12px', background: 'var(--bg-card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }
const suggestionNameStyle = { color: 'var(--text-main)', fontSize: '16px', wordBreak: 'break-word' }
const suggestionAmountBlockStyle = { display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto' }
const suggestionAmountStyle = { color: 'var(--success)', fontSize: '18px', fontWeight: 900, whiteSpace: 'nowrap' }
const infoStripStyle = { border: '1px solid var(--accent-strong)', borderRadius: '14px', padding: '12px 14px', background: 'color-mix(in srgb, var(--accent-strong) 12%, transparent)', color: 'var(--text-main)', marginTop: '16px' }
const selectedGoalBoxStyle = { border: '1px solid var(--border-main)', borderRadius: '14px', padding: '12px', background: 'var(--bg-card)' }
const checkboxRowStyle = { display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontSize: '14px' }
const contentGridStyle = { display: 'grid', gridTemplateColumns: 'minmax(320px, 0.75fr) minmax(0, 1.5fr)', gap: '20px', alignItems: 'start' }
const panelStyle = { border: '1px solid var(--border-main)', borderRadius: '18px', padding: '24px', background: 'var(--bg-card)', minWidth: 0 }
const panelHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }
const panelTitleStyle = { margin: '0 0 8px', fontSize: '26px', fontWeight: 900 }
const mutedStyle = { color: 'var(--text-muted)', margin: '0 0 18px', fontSize: '16px', lineHeight: 1.45 }
const smallMutedStyle = { color: 'var(--text-muted)', fontSize: '13px' }
const formStyle = { display: 'flex', flexDirection: 'column', gap: '12px' }
const twoColumnFormStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }
const labelStyle = { color: 'var(--text-main)', fontSize: '14px', fontWeight: 800 }
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--border-main)', background: 'var(--bg-card-soft)', color: 'var(--text-main)', fontSize: '15px' }
const textareaStyle = { ...inputStyle, minHeight: '90px', resize: 'vertical', fontFamily: 'inherit' }
const buttonRowStyle = { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }
const primaryButtonStyle = { border: 'none', borderRadius: '12px', padding: '12px 16px', background: 'var(--accent-strong)', color: 'white', fontWeight: 900, cursor: 'pointer', flex: 1 }
const primaryButtonSmallStyle = { border: 'none', borderRadius: '12px', padding: '12px 16px', background: 'var(--success)', color: 'white', fontWeight: 900, cursor: 'pointer' }
const secondaryButtonStyle = { border: '1px solid var(--accent-strong)', borderRadius: '12px', padding: '12px 16px', background: 'color-mix(in srgb, var(--accent-strong) 12%, transparent)', color: 'var(--text-main)', fontWeight: 900, cursor: 'pointer' }
const filterRowStyle = { display: 'flex', gap: '10px', flexWrap: 'wrap' }
const smallSelectStyle = { ...inputStyle, width: '170px' }
const goalsListStyle = { display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '780px', overflowY: 'auto', paddingRight: '4px' }
const goalCardStyle = { border: '1px solid var(--border-main)', borderRadius: '16px', padding: '18px', background: 'var(--bg-card-soft)' }
const goalHeaderStyle = { display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '12px' }
const goalTitleRowStyle = { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }
const goalNameStyle = { margin: 0, fontSize: '22px', fontWeight: 900, wordBreak: 'break-word' }
const goalMetaStyle = { color: 'var(--accent-strong)', marginTop: '6px' }
const goalAmountStyle = { fontSize: '18px', fontWeight: 900, whiteSpace: 'nowrap' }
const badgeStyle = { borderRadius: '999px', padding: '5px 10px', fontWeight: 900, fontSize: '12px', textTransform: 'capitalize', border: '1px solid transparent' }
const miniBadgeStyle = { borderRadius: '999px', padding: '4px 8px', fontWeight: 900, fontSize: '11px', border: '1px solid transparent', whiteSpace: 'nowrap' }
const progressTrackStyle = { height: '10px', background: 'var(--bg-card)', borderRadius: '999px', overflow: 'hidden', margin: '12px 0' }
const progressFillStyle = { height: '100%', background: 'linear-gradient(90deg, var(--accent-strong), var(--success))', borderRadius: '999px' }
const goalStatsGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginTop: '14px' }
const miniStatStyle = { border: '1px solid var(--border-main)', borderRadius: '12px', padding: '10px', background: 'var(--bg-card)' }
const noteStyle = { color: 'var(--text-main)', lineHeight: 1.5, margin: '14px 0 0', whiteSpace: 'pre-wrap' }
const insightNoteStyle = { border: '1px solid var(--border-main)', background: 'color-mix(in srgb, var(--accent-strong) 10%, transparent)', borderRadius: '12px', padding: '10px 12px', color: 'var(--text-main)', lineHeight: 1.45, margin: '14px 0 0' }
const actionRowStyle = { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }
const tinyButtonStyle = { border: '1px solid var(--border-main)', borderRadius: '10px', padding: '8px 10px', background: 'var(--bg-card-soft)', color: 'var(--text-main)', fontWeight: 800, cursor: 'pointer' }
const dangerButtonStyle = { ...tinyButtonStyle, borderColor: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)' }
const emptyStyle = { border: '1px dashed var(--border-main)', borderRadius: '14px', padding: '24px', color: 'var(--text-muted)', textAlign: 'center' }
const breakdownGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }
const breakdownCardStyle = { border: '1px solid var(--border-main)', borderRadius: '14px', padding: '14px', background: 'var(--bg-card-soft)' }
const rowBetweenStyle = { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }
