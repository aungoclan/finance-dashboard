import { normalizeCategoryName } from './cashflowCategories'

export function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

export function getRecordLegacyText(record) {
  return String(record?.category || record?.name || '').trim()
}

export function isBillLikeCategory(value) {
  return normalizeCategoryName(value).startsWith('bill:')
}

export function isLegacyCashflowEntry(entry) {
  return !entry.category_id || isBillLikeCategory(entry.category)
}

export function isLegacyBudgetRow(row) {
  return !row.category_id
}

export function isLegacyBill(row) {
  return !row.category_id
}

export function getBillDescriptionFromLegacyCategory(category) {
  const text = String(category || '').trim()

  if (!text) return ''

  if (isBillLikeCategory(text)) {
    return text
  }

  return ''
}

export function getCleanDescriptionForCashflow(entry) {
  const existingDescription = String(entry.description || '').trim()
  if (existingDescription) return existingDescription

  const category = String(entry.category || '').trim()
  if (isBillLikeCategory(category)) return category

  return ''
}

export function findCategoryByNameOrAlias(categories = [], aliases = []) {
  const aliasSet = new Set(aliases.map((item) => normalizeCategoryName(item)))

  return (
    categories.find((category) => aliasSet.has(normalizeCategoryName(category.name))) || null
  )
}

export function suggestCategoryForCashflow(entry, categories = []) {
  const rawCategory = String(entry.category || '').trim()
  const description = String(entry.description || '').trim()
  const combined = normalizeCategoryName(`${rawCategory} ${description}`)

  if (entry.category_id) {
    return categories.find((category) => category.id === entry.category_id) || null
  }

  if (entry.type === 'income') {
    if (combined.includes('salary') || combined.includes('paycheck') || combined.includes('payroll')) {
      return findCategoryByNameOrAlias(categories, ['Salary'])
    }

    if (combined.includes('cash income') || combined.includes('cash')) {
      return findCategoryByNameOrAlias(categories, ['Cash Income'])
    }

    if (combined.includes('business')) {
      return findCategoryByNameOrAlias(categories, ['Business Income'])
    }

    if (combined.includes('dividend')) {
      return findCategoryByNameOrAlias(categories, ['Dividend'])
    }

    if (combined.includes('interest')) {
      return findCategoryByNameOrAlias(categories, ['Interest'])
    }

    if (combined.includes('refund')) {
      return findCategoryByNameOrAlias(categories, ['Refund'])
    }

    return findCategoryByNameOrAlias(categories, ['Other Income'])
  }

  if (
    combined.includes('chatgpt') ||
    combined.includes('openai') ||
    combined.includes('netflix') ||
    combined.includes('spotify') ||
    combined.includes('youtube') ||
    combined.includes('apple') ||
    combined.includes('icloud') ||
    combined.includes('google') ||
    combined.includes('subscription') ||
    combined.includes('subscriptions')
  ) {
    return findCategoryByNameOrAlias(categories, ['Subscriptions', 'Subscription'])
  }

  if (
    combined.includes('tmobile') ||
    combined.includes('t-mobile') ||
    combined.includes('verizon') ||
    combined.includes('att') ||
    combined.includes('at&t') ||
    combined.includes('phone')
  ) {
    return findCategoryByNameOrAlias(categories, ['Phone'])
  }

  if (
    combined.includes('insurance') ||
    combined.includes('health insurance') ||
    combined.includes('car insurance')
  ) {
    return findCategoryByNameOrAlias(categories, ['Insurance'])
  }

  if (
    combined.includes('gas') ||
    combined.includes('chevron') ||
    combined.includes('shell') ||
    combined.includes('arco') ||
    combined.includes('exxon')
  ) {
    return findCategoryByNameOrAlias(categories, ['Gas'])
  }

  if (
    combined.includes('grocery') ||
    combined.includes('groceries') ||
    combined.includes('costco') ||
    combined.includes('walmart') ||
    combined.includes('safeway') ||
    combined.includes('trader joe')
  ) {
    return findCategoryByNameOrAlias(categories, ['Groceries'])
  }

  if (
    combined.includes('restaurant') ||
    combined.includes('dining') ||
    combined.includes('doordash') ||
    combined.includes('uber eats')
  ) {
    return findCategoryByNameOrAlias(categories, ['Dining'])
  }

  if (combined.includes('rent') || combined.includes('mortgage')) {
    return findCategoryByNameOrAlias(categories, ['Rent / Mortgage', 'Housing'])
  }

  if (combined.includes('internet') || combined.includes('xfinity') || combined.includes('comcast')) {
    return findCategoryByNameOrAlias(categories, ['Internet'])
  }

  if (combined.includes('utility') || combined.includes('utilities') || combined.includes('smud') || combined.includes('pge')) {
    return findCategoryByNameOrAlias(categories, ['Utilities'])
  }

  if (combined.includes('car payment') || combined.includes('auto loan')) {
    return findCategoryByNameOrAlias(categories, ['Car Payment'])
  }

  if (combined.includes('maintenance') || combined.includes('repair')) {
    return findCategoryByNameOrAlias(categories, ['Auto Maintenance'])
  }

  if (combined.includes('debt') || combined.includes('credit card payment')) {
    return findCategoryByNameOrAlias(categories, ['Debt Payment'])
  }

  if (combined.includes('business')) {
    return findCategoryByNameOrAlias(categories, ['Business'])
  }

  if (combined.includes('tax')) {
    return findCategoryByNameOrAlias(categories, ['Tax'])
  }

  return findCategoryByNameOrAlias(categories, ['Other Expense'])
}

export function suggestCategoryForBudget(row, categories = []) {
  const fakeEntry = {
    type: 'expense',
    category: row.category,
    description: ''
  }

  return suggestCategoryForCashflow(fakeEntry, categories)
}

export function suggestCategoryForBill(row, categories = []) {
  const fakeEntry = {
    type: 'expense',
    category: row.category,
    description: `Bill: ${row.name || ''}`
  }

  return suggestCategoryForCashflow(fakeEntry, categories)
}

export function getCategoryOptionsByTypeForCleanup(categories = [], type = 'expense') {
  return categories
    .filter((category) => !category.is_archived)
    .filter((category) => category.type === type || category.type === 'both')
    .sort((a, b) => {
      const groupCompare = String(a.group_name || '').localeCompare(String(b.group_name || ''))
      if (groupCompare !== 0) return groupCompare

      const sortCompare = Number(a.sort_order || 100) - Number(b.sort_order || 100)
      if (sortCompare !== 0) return sortCompare

      return String(a.name || '').localeCompare(String(b.name || ''))
    })
}