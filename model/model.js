/**
 * PrivacyShield - model.js
 * On-device preference scoring AI model
 * Zero data leaves the browser - all computation happens locally
 */

const MODEL_KEY = 'privacyshield_model';
const BACKUP_KEY = 'privacyshield_model_backup';
const BEHAVIOR_KEY = 'privacyshield_behavior';
const SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes

const DEFAULT_CATEGORIES = [
  'Fashion', 'Electronics', 'Sports', 'Food', 'Travel', 'Tech',
  'Beauty', 'Books', 'Home', 'Automotive'
];

// Internal model state
let modelState = {
  scores: {},
  totalInteractions: 0,
  lastUpdated: null,
  timePatterns: {},
  snapshotTimer: null
};

/**
 * Initialize model — load from localStorage or start fresh
 */
function initModel() {
  try {
    const saved = localStorage.getItem(MODEL_KEY);
    if (saved) {
      modelState = { ...modelState, ...JSON.parse(saved) };
    } else {
      // Try recovering from backup
      const backup = localStorage.getItem(BACKUP_KEY);
      if (backup) {
        modelState = { ...modelState, ...JSON.parse(backup) };
      } else {
        // Cold start — equal scores for all categories
        modelState.scores = _getEqualScores();
      }
    }
    // Start auto-snapshot
    _startSnapshotTimer();
  } catch (e) {
    console.warn('[PrivacyShield Model] Init failed, starting fresh:', e);
    modelState.scores = _getEqualScores();
  }
}

/**
 * Returns equal distribution for cold start (new user)
 */
function _getEqualScores() {
  const scores = {};
  const equalShare = Math.floor(100 / DEFAULT_CATEGORIES.length);
  DEFAULT_CATEGORIES.forEach(cat => {
    scores[cat] = { raw: equalShare, percentage: equalShare, interactions: 0 };
  });
  return scores;
}

/**
 * Save snapshot to backup every 5 minutes for cache resilience
 */
function _startSnapshotTimer() {
  if (modelState.snapshotTimer) clearInterval(modelState.snapshotTimer);
  modelState.snapshotTimer = setInterval(() => {
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(modelState));
    } catch (e) {
      console.warn('[PrivacyShield Model] Snapshot failed:', e);
    }
  }, SNAPSHOT_INTERVAL);
}

/**
 * Save current model state to localStorage
 */
function _saveModel() {
  try {
    modelState.lastUpdated = Date.now();
    localStorage.setItem(MODEL_KEY, JSON.stringify(modelState));
  } catch (e) {
    console.warn('[PrivacyShield Model] Save failed:', e);
  }
}

/**
 * Normalize raw scores to percentages that sum to 100
 */
function _normalizeScores(rawScores) {
  const total = Object.values(rawScores).reduce((sum, val) => sum + (val.raw || 0), 0);
  if (total === 0) return _getEqualScores();

  const normalized = {};
  Object.entries(rawScores).forEach(([cat, data]) => {
    normalized[cat] = {
      ...data,
      percentage: Math.round((data.raw / total) * 100)
    };
  });

  // Fix rounding errors — add remainder to top category
  const totalPct = Object.values(normalized).reduce((s, d) => s + d.percentage, 0);
  if (totalPct !== 100) {
    const topCat = Object.entries(normalized).sort((a, b) => b[1].percentage - a[1].percentage)[0][0];
    normalized[topCat].percentage += (100 - totalPct);
  }

  return normalized;
}

/**
 * Record time-of-day pattern for predictions
 */
function _recordTimePattern(category) {
  const hour = new Date().getHours();
  const period = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  if (!modelState.timePatterns[period]) modelState.timePatterns[period] = {};
  if (!modelState.timePatterns[period][category]) modelState.timePatterns[period][category] = 0;
  modelState.timePatterns[period][category]++;
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * calculateScores(behaviorData)
 * Takes raw behavior data from tracker.js and returns scored categories
 * Score formula: clicks×3 + hoverTime×2 + scrollDepth×1 + repeatVisit×5
 */
function calculateScores(behaviorData) {
  try {
    if (!behaviorData || !behaviorData.categories) {
      return modelState.scores;
    }

    const rawScores = { ...modelState.scores };

    Object.entries(behaviorData.categories).forEach(([category, data]) => {
      if (!rawScores[category]) {
        rawScores[category] = { raw: 0, percentage: 0, interactions: 0 };
      }

      const clicks = (data.clicks || 0) * 3;
      const hoverTime = (data.timeSpent || 0) * 2;
      const scrollDepth = (data.scrollDepth || 0) * 1;
      const repeatBonus = (data.repeatVisits || 0) * 5;

      rawScores[category].raw = clicks + hoverTime + scrollDepth + repeatBonus;
      rawScores[category].interactions = (data.clicks || 0) + (data.timeSpent || 0);
    });

    modelState.scores = _normalizeScores(rawScores);
    modelState.totalInteractions = Object.values(behaviorData.categories)
      .reduce((sum, d) => sum + (d.clicks || 0), 0);

    _saveModel();
    return modelState.scores;
  } catch (e) {
    console.warn('[PrivacyShield Model] calculateScores failed:', e);
    return modelState.scores;
  }
}

/**
 * getTopCategory()
 * Returns the category with the highest preference score
 */
function getTopCategory() {
  try {
    const scores = modelState.scores;
    if (!scores || Object.keys(scores).length === 0) return null;

    return Object.entries(scores)
      .sort((a, b) => b[1].percentage - a[1].percentage)[0][0];
  } catch (e) {
    return null;
  }
}

/**
 * getPredictions()
 * Returns ranked list of categories with scores + time-of-day boost
 */
function getPredictions() {
  try {
    const hour = new Date().getHours();
    const period = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    const timeBoosts = modelState.timePatterns[period] || {};

    const predictions = Object.entries(modelState.scores).map(([category, data]) => {
      const timeBoost = (timeBoosts[category] || 0) * 2;
      return {
        category,
        score: data.percentage,
        boostedScore: data.percentage + timeBoost,
        interactions: data.interactions || 0,
        confidence: modelState.totalInteractions >= 10 ? 'high' :
                    modelState.totalInteractions >= 3 ? 'medium' : 'low'
      };
    });

    return predictions.sort((a, b) => b.boostedScore - a.boostedScore);
  } catch (e) {
    return [];
  }
}

/**
 * updateModel(newBehaviorData)
 * Called by tracker when user interacts — updates scores in real time
 */
function updateModel(newBehaviorData) {
  try {
    if (!newBehaviorData) return;

    // Record time pattern for top interacted category
    const topCat = Object.entries(newBehaviorData.categories || {})
      .sort((a, b) => (b[1].clicks || 0) - (a[1].clicks || 0))[0];
    if (topCat) _recordTimePattern(topCat[0]);

    return calculateScores(newBehaviorData);
  } catch (e) {
    console.warn('[PrivacyShield Model] updateModel failed:', e);
  }
}

/**
 * resetModel()
 * Wipes all model data and returns to cold start state
 */
function resetModel() {
  try {
    modelState.scores = _getEqualScores();
    modelState.totalInteractions = 0;
    modelState.timePatterns = {};
    modelState.lastUpdated = null;
    localStorage.removeItem(MODEL_KEY);
    localStorage.removeItem(BACKUP_KEY);
    _saveModel();
    return true;
  } catch (e) {
    console.warn('[PrivacyShield Model] resetModel failed:', e);
    return false;
  }
}

/**
 * isNewUser()
 * Returns true if user has fewer than 3 total interactions
 */
function isNewUser() {
  return modelState.totalInteractions < 3;
}

/**
 * getModelStats()
 * Returns current model metadata for dashboard display
 */
function getModelStats() {
  return {
    totalInteractions: modelState.totalInteractions,
    lastUpdated: modelState.lastUpdated,
    confidence: modelState.totalInteractions >= 10 ? 'High' :
                modelState.totalInteractions >= 3 ? 'Medium' : 'Learning...',
    categoriesTracked: Object.keys(modelState.scores).length,
    isNewUser: isNewUser()
  };
}

// Auto-initialize on load
initModel();

// Export for use by content.js and popup.js
window.PrivacyShieldModel = {
  calculateScores,
  getTopCategory,
  getPredictions,
  updateModel,
  resetModel,
  isNewUser,
  getModelStats,
  initModel
};
