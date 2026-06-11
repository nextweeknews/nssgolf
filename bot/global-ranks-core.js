"use strict";

const INFINITY_SYMBOL = "\u221e";

const BASE_GLOBAL_RANKS = [
  "<A20",
  "A21",
  "A22",
  "A23",
  "A24",
  "A25",
  "A26",
  "A27",
  "A28",
  "A29",
  "S0",
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
  "S7",
  "S8",
  "S9",
];

const GLOBAL_RANKS_NO_CS = [
  ...BASE_GLOBAL_RANKS,
  ...Array.from({ length: 16 }, (_, index) => `${INFINITY_SYMBOL}${index}`),
];

const GLOBAL_RANKS_WITH_CS = [
  ...BASE_GLOBAL_RANKS,
  ...Array.from({ length: 50 }, (_, index) => `${INFINITY_SYMBOL}${index}`),
];

const GLOBAL_RANK_FIELD_LABELS = {
  current_global_rank: "Current Rank",
  max_global_rank_no_cs: "Max. Rank (No Cloud Saves)",
  max_global_rank_cs: "Max. Rank (with cloud saves)",
};

const RANK_OPERATION_CONFIGS = {
  rank_no_cs: {
    currentField: "current_global_rank",
    maxField: "max_global_rank_no_cs",
    rankOrder: GLOBAL_RANKS_NO_CS,
    currentLabel: "Global rank (no CS)",
    maxLabel: "max rank (no CS)",
  },
  rank_cs: {
    currentField: "current_global_rank",
    maxField: "max_global_rank_cs",
    rankOrder: GLOBAL_RANKS_WITH_CS,
    currentLabel: "Global rank (with CS)",
    maxLabel: "max rank (with CS)",
  },
  max_no_cs: {
    maxField: "max_global_rank_no_cs",
    rankOrder: GLOBAL_RANKS_NO_CS,
    maxLabel: "Global max rank (no CS)",
  },
  max_cs: {
    maxField: "max_global_rank_cs",
    rankOrder: GLOBAL_RANKS_WITH_CS,
    maxLabel: "Global max rank (with CS)",
  },
};

const GLOBAL_RANK_INDEX = new Map(
  GLOBAL_RANKS_WITH_CS.map((rank, index) => [rank, index])
);

function normalizeDiscordId(value) {
  const cleanValue = String(value || "").trim();
  return /^[0-9]+$/.test(cleanValue) ? cleanValue : "";
}

function normalizeRankInput(value, allowedRanks = GLOBAL_RANKS_WITH_CS) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  let cleanValue = rawValue
    .replace(/\s+/g, "")
    .replace(/^infinity/i, INFINITY_SYMBOL)
    .replace(/^inf/i, INFINITY_SYMBOL)
    .replace(/^∞/u, INFINITY_SYMBOL);

  const belowMatch = cleanValue.match(/^<A?20$/i);
  if (belowMatch) {
    cleanValue = "<A20";
  } else {
    const aMatch = cleanValue.match(/^A(2[1-9])$/i);
    const sMatch = cleanValue.match(/^S([0-9])$/i);
    const infinityMatch = cleanValue.match(/^(?:∞)([0-9]{1,2})$/u);

    if (aMatch) {
      cleanValue = `A${aMatch[1]}`;
    } else if (sMatch) {
      cleanValue = `S${sMatch[1]}`;
    } else if (infinityMatch) {
      cleanValue = `${INFINITY_SYMBOL}${Number(infinityMatch[1])}`;
    }
  }

  return allowedRanks.includes(cleanValue) ? cleanValue : "";
}

function isRemoveRankInput(value) {
  return String(value || "").trim().toLowerCase() === "remove";
}

function rankIndex(rank) {
  const cleanRank = normalizeRankInput(rank);
  return GLOBAL_RANK_INDEX.has(cleanRank) ? GLOBAL_RANK_INDEX.get(cleanRank) : -1;
}

function isRankHigher(leftRank, rightRank) {
  if (!normalizeRankInput(leftRank)) {
    return false;
  }

  if (!normalizeRankInput(rightRank)) {
    return true;
  }

  return rankIndex(leftRank) > rankIndex(rightRank);
}

function currentRankIsAboveBothMaximums(settings) {
  const currentRank = normalizeRankInput(settings?.current_global_rank);
  const maxNoCs = normalizeRankInput(settings?.max_global_rank_no_cs);
  const maxCs = normalizeRankInput(settings?.max_global_rank_cs);

  if (!currentRank || !maxNoCs || !maxCs) {
    return false;
  }

  const currentIndex = rankIndex(currentRank);
  return currentIndex > rankIndex(maxNoCs) && currentIndex > rankIndex(maxCs);
}

function cloneSettings(settings) {
  return {
    current_global_rank: settings?.current_global_rank || null,
    max_global_rank_no_cs: settings?.max_global_rank_no_cs || null,
    max_global_rank_cs: settings?.max_global_rank_cs || null,
  };
}

function applyRankUpdate(settings, operation, rankValue) {
  const config = RANK_OPERATION_CONFIGS[operation];
  if (!config) {
    throw new Error(`Unknown global rank update operation: ${operation}`);
  }

  const nextSettings = cloneSettings(settings);
  const changes = [];
  const removeValue = isRemoveRankInput(rankValue);

  if (removeValue) {
    const field = config.currentField || config.maxField;
    const label = config.currentField ? config.currentLabel : config.maxLabel;

    if (nextSettings[field]) {
      nextSettings[field] = null;
      changes.push({
        field,
        label,
        rank: null,
        removed: true,
      });
    }
  } else {
    const rank = normalizeRankInput(rankValue, config.rankOrder);
    if (!rank) {
      const highestRank = config.rankOrder[config.rankOrder.length - 1];
      throw new Error(
        `Use a valid rank from <A20 through ${highestRank}, or remove. You can type infinity ranks like inf3.`
      );
    }

    if (config.currentField) {
      if (nextSettings[config.currentField] !== rank) {
        nextSettings[config.currentField] = rank;
        changes.push({
          field: config.currentField,
          label: config.currentLabel,
          rank,
        });
      }

      if (isRankHigher(rank, nextSettings[config.maxField])) {
        nextSettings[config.maxField] = rank;
        changes.push({
          field: config.maxField,
          label: config.maxLabel,
          rank,
        });
      }
    } else if (nextSettings[config.maxField] !== rank) {
      nextSettings[config.maxField] = rank;
      changes.push({
        field: config.maxField,
        label: config.maxLabel,
        rank,
      });
    }
  }

  if (currentRankIsAboveBothMaximums(nextSettings)) {
    throw new Error(
      "Current rank cannot be above both max rank values. Raise one max value first, or lower the current rank."
    );
  }

  return {
    settings: nextSettings,
    changes,
  };
}

function changedFieldsFromUpdate(updateResult) {
  return [...new Set((updateResult?.changes || []).map((change) => change.field))];
}

function orderRankValuesDescending(values, rankOrder = GLOBAL_RANKS_WITH_CS) {
  const orderMap = new Map(rankOrder.map((rank, index) => [rank, index]));
  return [...new Set(values.map((value) => normalizeRankInput(value)).filter(Boolean))].sort(
    (left, right) => {
      const leftIndex = orderMap.has(left) ? orderMap.get(left) : -1;
      const rightIndex = orderMap.has(right) ? orderMap.get(right) : -1;
      if (leftIndex !== rightIndex) {
        return rightIndex - leftIndex;
      }

      return right.localeCompare(left, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }
  );
}

module.exports = {
  BASE_GLOBAL_RANKS,
  GLOBAL_RANKS_NO_CS,
  GLOBAL_RANKS_WITH_CS,
  GLOBAL_RANK_FIELD_LABELS,
  INFINITY_SYMBOL,
  RANK_OPERATION_CONFIGS,
  applyRankUpdate,
  changedFieldsFromUpdate,
  currentRankIsAboveBothMaximums,
  isRankHigher,
  isRemoveRankInput,
  normalizeDiscordId,
  normalizeRankInput,
  orderRankValuesDescending,
  rankIndex,
};
