import * as Const from "../utils/Cons";
import moment from "moment";
import Web3 from "web3";
import { CoordinatorABI } from "../utils/abi";
import { CoordinatorAddress } from "../utils/addresses";
import web3Cache from "../utils/web3Cache";
import BatchProcessor from "../utils/batchProcessor";

import { networkConfig, CURRENT_NETWORK } from '../utils/networkConfig';

// Direct GraphQL fetch to bypass broken GraphQL Mesh stitching runtime
const SUBGRAPH_POLYGON = networkConfig.subgraphPolygon;
const SUBGRAPH_ETHEREUM = networkConfig.subgraphEthereum;
const SUBGRAPH_BASE = networkConfig.subgraphBase;
const SUBGRAPH_COHORTS = networkConfig.subgraphCohorts ?? networkConfig.subgraphBase;

const gqlFetch = async (endpoint, query, variables = {}) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
};

// GraphQL query fragments (matching query.graphql)
const RITUAL_FIELDS = `
  id
  domain
  authority
  participants
  status
  successful
  startedAt
  endedAt
  transcriptCount
  aggregationCount
  publicKey { word0 word1 }
  createdAt
  updatedAt
  transactions(orderBy: timestamp, orderDirection: desc) {
    eventType
    participant
    timestamp
    transactionHash
    gasUsed
    transcriptDigest
    aggregatedTranscriptDigest
    previousAuthority
    newAuthority
  }
  handovers {
    id
    departingParticipant
    incomingParticipant
    status
    requestedAt
    transcriptPostedAt
    blindedSharePostedAt
    canceledAt
    finalizedAt
  }
`;

const RITUAL_COUNTER_FIELDS = `
  ritualCounter(id: "global") {
    total: totalRituals
    unsuccessful: failedRituals
    successful: successfulRituals
    notEnded: pendingRituals
  }
`;

// Beta stakers list - cached in memory
let betaStakers = null;

// Global Web3 instance for reuse
let web3Instance = null;

// Load beta stakers from file
export const loadBetaStakers = async () => {
  if (betaStakers !== null) return betaStakers;

  try {
    const response = await fetch('/beta_stakers.txt');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    betaStakers = new Set(
      text.split('\n')
        .map(addr => addr.trim().toLowerCase())
        .filter(addr => addr.length > 0)
    );
    console.log(`Loaded ${betaStakers.size} beta stakers`);
    return betaStakers;
  } catch (error) {
    console.warn('Could not load beta stakers list:', error);
    betaStakers = new Set();
    return betaStakers;
  }
};

// Check if an address is a beta staker
export const isBetaStaker = async (address) => {
  const stakers = await loadBetaStakers();
  return stakers.has(address.toLowerCase());
};

const tacoAddr = "0x347cc7ede7e5517bd47d20620b2cf1b406edcf07".toLowerCase()
export const ritual_columns = [
  {
    header: "ID",
    accessor: "id",
    numeric: true,
  },
  {
    header: "UPDATED",
    accessor: "updateTime",
    numeric: false,
  },
  {
    header: "AUTHORITY",
    accessor: "authority",
    numeric: false,
  },
  {
    header: "PARTICIPANTS",
    accessor: "totalParticipants",
    numeric: true,
  },
  {
    header: "TRANSCRIPTS",
    accessor: "totalPostedTranscripts",
    numeric: true,
  },
  {
    header: "AGGREGATIONS",
    accessor: "totalPostedAggregations",
    numeric: true,
  },
  {
    header: "CURRENT STATE",
    accessor: "status",
    numeric: false,
  },
];

export const node_columns = [
  {
    header: "Node Provider",
    accessor: "id",
    numeric: false,
  },
  {
    header: "Operator",
    accessor: "registeredOperatorAddress",
    numeric: false,
  },
  {
    header: "Authorized Stake",
    accessor: "authorizedAmount",
    numeric: true,
  },
  {
    header: "Amount Staked",
    accessor: "stakedAmount",
    numeric: true,
  },
  {
    header: "Confirmed",
    accessor: "isOperatorConfirmed",
    numeric: false,
  },
  {
    header: "Bonded At",
    accessor: "bondedAt",
    numeric: true,
  },
  {
    header: "Status",
    accessor: "nodeStatus",
    numeric: false,
  },
];

export const formatString = (data) => {
  if (data == null) {
    return "Not yet finalized";
  }
  if (data.length < 10) {
    return data;
  }

  const fistSymbol = data.slice(0, 7);
  const endSymbol = data.slice(data.length - 7);
  return fistSymbol + " ... " + endSymbol;
};

export const formatGweiFixedZero = (value) => {
  // Handle null/undefined
  if (!value) return "0";

  // Convert to string if not already
  const valueStr = value.toString();

  // For very large numbers, use BigInt for accurate division
  try {
    const valueBigInt = BigInt(valueStr);
    const decimalBigInt = BigInt(Const.DECIMAL_ETH);
    const result = valueBigInt / decimalBigInt;
    return result.toString();
  } catch (e) {
    // Fallback for non-integer values
    return parseFloat(value / Const.DECIMAL_ETH).toFixed(0);
  }
};

export const formatWeiDecimal = (value) => {
  return new Intl.NumberFormat().format(formatGweiFixedZero(value));
};

export const formatWeiDecimalNoSurplus = (value) => {
  // Handle null/undefined
  if (!value) return "0";

  // Convert to string if not already
  const valueStr = value.toString();

  // For very large numbers, use BigInt for accurate division
  try {
    const valueBigInt = BigInt(valueStr);
    const decimalBigInt = BigInt(Const.DECIMAL_ETH);
    const result = valueBigInt / decimalBigInt;
    return new Intl.NumberFormat().format(result.toString());
  } catch (e) {
    // Fallback for non-integer values
    return new Intl.NumberFormat().format(
      parseFloat(value / Const.DECIMAL_ETH).toFixed(0)
    );
  }
};

export function formatTimeToText(timestamp) {
  if (timestamp == 0) return "Didn't staked";
  const date = moment.duration(
    moment(new Date().getTime()).diff(moment(timestamp))
  );
  const day = date.days();
  const month = date.months();
  const year = date.years();
  const hour = date.hours();
  const minute = date.minutes();
  const second = date.seconds();

  if (year > 0) {
    if (year == 1) {
      return year + " year ago";
    } else {
      return year + " years ago";
    }
  } else if (month > 0) {
    if (month == 1) {
      return month + " month ago";
    } else {
      return month + " months ago";
    }
  } else if (day > 0) {
    if (day == 1) {
      return day + " day ago";
    } else {
      return day + " days ago";
    }
  } else if (hour > 0) {
    if (hour == 1) {
      return hour + " hour ago";
    } else {
      return hour + " hours ago";
    }
  } else if (minute > 0) {
    if (minute == 1) {
      return minute + " minute ago";
    } else {
      return minute + " minutes ago";
    }
  } else {
    if (second == 1) {
      return second + " second ago";
    } else {
      return second + " seconds ago";
    }
  }
}

function formatTimestampToText(date) {
  const month = date.months();
  let day = date.days();
  const hours = date.hours();
  const minutes = date.minutes();
  if (month > 0) {
    day = day + month * 30;
  }
  if (day > 0) {
    return `${day < 10 ? "0" + day : day}d ${
      hours < 10 ? "0" + hours : hours
    }h ago`;
  } else {
    return `${hours < 10 ? "0" + hours : hours}h ${
      minutes < 10 ? "0" + minutes : minutes
    }m ago`;
  }
}

export const calculateTimeMoment = (timestamp) => {
  return formatTimestampToText(
    moment.duration(moment(new Date().getTime()).diff(moment(timestamp)))
  );
};

export const formatDate = (timestamp) => {
  return moment(timestamp).format('MMM DD, YYYY [at] HH:mm:ss [UTC]');
};

// const calculateTreasuryFee = (treasuryFee) => (1 / treasuryFee) * 100;
// const calculateTxMaxFee = (txMaxFee) => txMaxFee / Const.SATOSHI_BITCOIN;

function convertFromLittleEndian(hex) {
  try {
    if (hex == null) return "...";
    hex = hex.replace("0x", "");
    hex = hex.padStart(8, "0");
    let littleEndianHex = "";
    for (let i = hex.length - 2; i >= 0; i -= 2) {
      littleEndianHex += hex.slice(i, i + 2);
    }
    return "0x" + littleEndianHex;
  } catch (e) {
    console.log(e);
  }
}

export const detectHeartbeatGroups = (rituals, timeout) => {
  const heartbeats = rituals.filter(r => r.isHeartbeat);
  if (heartbeats.length === 0) return [];

  // March 17, 2025 is the first heartbeat group - don't go farther back
  const cutoffDate = new Date('2025-03-17T00:00:00Z').getTime();

  // Heartbeats run on Mondays around midnight UTC
  // All DKG heartbeats have the duration of the DKG_TIMEOUT set on the coordinator
  const groups = [];
  const dkgTimeoutMs = parseFloat(timeout || 0) * 1000; // Convert timeout to milliseconds
  // Use DKG timeout as the window for grouping, or fallback to 4 hours if not available
  const groupingWindow = dkgTimeoutMs || (4 * 60 * 60 * 1000);

  // Sort heartbeats by timestamp and filter out those before cutoff
  const sortedHeartbeats = [...heartbeats]
    .filter(hb => hb.initTimeStamp >= cutoffDate)
    .sort((a, b) => a.initTimeStamp - b.initTimeStamp);

  sortedHeartbeats.forEach(hb => {
    let addedToGroup = false;

    // Find the Monday midnight UTC for this ritual
    const hbDate = new Date(hb.initTimeStamp);
    const dayOfWeek = hbDate.getUTCDay();
    const hoursFromMidnight = hbDate.getUTCHours();

    // Check if this is near a Monday (day 1) midnight UTC
    // Consider Sunday late night (day 0, hour 22-24) and Monday early morning (day 1, hour 0-6)
    const isNearMondayMidnight =
      (dayOfWeek === 0 && hoursFromMidnight >= 22) || // Sunday 22:00 - 24:00 UTC
      (dayOfWeek === 1 && hoursFromMidnight <= 6) ||  // Monday 00:00 - 06:00 UTC
      (dayOfWeek === 2 && hoursFromMidnight <= 2);    // Tuesday 00:00 - 02:00 UTC (for late runs)

    // Find the nearest Monday midnight for grouping
    let mondayMidnight = new Date(hb.initTimeStamp);
    if (dayOfWeek === 0 && hoursFromMidnight >= 22) {
      // Sunday night - next day is Monday
      mondayMidnight.setUTCDate(mondayMidnight.getUTCDate() + 1);
    } else if (dayOfWeek === 2 && hoursFromMidnight <= 2) {
      // Tuesday early morning - previous day was Monday
      mondayMidnight.setUTCDate(mondayMidnight.getUTCDate() - 1);
    } else if (dayOfWeek !== 1) {
      // Find the previous Monday
      const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      mondayMidnight.setUTCDate(mondayMidnight.getUTCDate() - daysToSubtract);
    }
    mondayMidnight.setUTCHours(0, 0, 0, 0);

    // Look for an existing group near this Monday
    for (let group of groups) {
      // Check if this ritual belongs to an existing Monday batch
      const groupMondayTime = group.mondayMidnight.getTime();
      const timeDiff = Math.abs(mondayMidnight.getTime() - groupMondayTime);

      // If it's the same Monday batch (within a day)
      // Also check if rituals are within the DKG timeout window of each other
      if (timeDiff < 24 * 60 * 60 * 1000) {
        // Check if this ritual is within the DKG timeout window of the first ritual in the group
        const firstRitualTime = group.rituals[0].initTimeStamp;
        const ritualTimeDiff = Math.abs(hb.initTimeStamp - firstRitualTime);

        // Group rituals that start within the DKG timeout window
        if (ritualTimeDiff <= groupingWindow) {
          group.rituals.push(hb);
          addedToGroup = true;
          break;
        }
      }
    }

    if (!addedToGroup) {
      groups.push({
        rituals: [hb],
        timestamp: hb.initTimeStamp,
        mondayMidnight: mondayMidnight,
        weekNumber: null // Will calculate after all groups are formed
      });
    }
  });

  // Sort groups by Monday date (most recent first)
  groups.sort((a, b) => b.mondayMidnight.getTime() - a.mondayMidnight.getTime());

  if (groups.length > 0) {
    const mostRecentMonday = groups[0].mondayMidnight.getTime();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    groups.forEach(group => {
      // Calculate weeks since most recent batch
      const weeksAgo = Math.round((mostRecentMonday - group.mondayMidnight.getTime()) / oneWeek);
      group.weekNumber = weeksAgo;

      // Sort rituals within group by ID
      group.rituals.sort((a, b) => a.id - b.id);

      // Calculate group statistics
      const successful = group.rituals.filter(r =>
        r.status === 'SUCCESSFUL' || r.status === 'ACTIVE'
      ).length;
      const failed = group.rituals.filter(r =>
        r.status === 'TIME OUT' || r.status === 'FAILED'
      ).length;
      const pending = group.rituals.filter(r =>
        r.status === 'PENDING' ||
        r.status === 'AWAITING TRANSCRIPTS' ||
        r.status === 'AWAITING AGGREGATIONS'
      ).length;

      group.stats = {
        total: group.rituals.length,
        successful,
        failed,
        pending,
        successRate: group.rituals.length > 0
          ? ((successful / group.rituals.length) * 100).toFixed(1)
          : '0.0'
      };

      // Overall status is no longer needed since partial failures are expected

      // Get unique participants across all rituals in the group
      const allParticipants = new Set();
      group.rituals.forEach(r => {
        r.participants.forEach(p => allParticipants.add(p));
      });
      group.uniqueParticipants = Array.from(allParticipants);
    });
  }

  return groups;
};

export const formatRitualsData = (rawData, timeout, liveRitualIds = new Set()) => {
  if (rawData === undefined) {
    return [];
  }

  const timeoutMs = parseFloat(timeout) * 1000;

  return rawData
    .map((ritual) => {
      const currentTimestampMs = Date.now();
      const initTimestamp = parseInt(ritual.startedAt || 0);
      const endTimestamp = parseInt(ritual.endedAt || 0);
      const rawStatus = ritual.status || "PENDING";
      const normalizedStatus = rawStatus.toString().toUpperCase();

      let status = normalizedStatus.replaceAll("_", " ");
      if (normalizedStatus === "AWAITING_TRANSCRIPTS") status = "AWAITING TRANSCRIPTS";
      if (normalizedStatus === "AWAITING_AGGREGATIONS") status = "AWAITING AGGREGATIONS";

      const initTimeStampMs = initTimestamp * 1000;
      const timeoutStamp = initTimeStampMs + timeoutMs;

      if (
        (normalizedStatus === "AWAITING_AGGREGATIONS" ||
          normalizedStatus === "AWAITING_TRANSCRIPTS") &&
        timeoutStamp < currentTimestampMs
      ) {
        status = "TIME OUT";
      }

      const transactions = (ritual.transactions || []).map((tx) => ({
        description: tx.description || tx.eventType,
        from: tx.from || tx.participant,
        timestamp: parseInt(tx.timestamp),
        txHash: tx.txHash || tx.transactionHash,
        eventType: tx.eventType,
        participant: tx.participant,
      }));

      const postedTranscripts = transactions
        .filter((tx) => tx.eventType === "TRANSCRIPT_POSTED" && tx.participant)
        .map((tx) => tx.participant);
      const postedAggregations = transactions
        .filter((tx) => tx.eventType === "AGGREGATION_POSTED" && tx.participant)
        .map((tx) => tx.participant);

      const publicKey = ritual.publicKey?.word0 && ritual.publicKey?.word1
        ? `${ritual.publicKey.word0}${ritual.publicKey.word1.slice(2)}`
        : ritual.publicKey || null;

      const participants = ritual.participants || [];
      const dkgSize = participants.length;
      const threshold = ritual.threshold ?? null;
      const latestTransaction = transactions[0];

      // Heartbeat detection: size ≤3 = heartbeat DKG (all small rituals are heartbeats)
      const isHeartbeat = participants.length <= 3;

      return {
        id: ritual.id,
        status: status,
        authority: ritual.authority,
        aggregations: postedAggregations,
        transcripts: postedTranscripts,
        participants: participants,
        publicKey: publicKey,
        initTimeStamp: initTimestamp * 1000,
        endTimeStamp: endTimestamp * 1000,
        threshold: threshold,
        dkgSize: dkgSize,
        accessController: ritual.accessController || null,
        feeModel: ritual.feeModel,
        transactions: transactions,
        updateTime: latestTransaction
          ? latestTransaction.timestamp * 1000
          : (endTimestamp || initTimestamp) * 1000,
        totalParticipants: participants.length,
        totalPostedAggregations: postedAggregations.length,
        totalPostedTranscripts: postedTranscripts.length,
        pendingTranscripts: participants.filter(
          (participant) => !postedTranscripts.includes(participant)
        ),
        pendingAggregations: participants.filter(
          (participant) => !postedAggregations.includes(participant)
        ),
        operatorAddresses: ritual.operatorAddresses || {},
        isHeartbeat: isHeartbeat,
        handovers: ritual.handovers || []
      };
    })
    .sort((a, b) => b.id - a.id);
};

export const formatNodes = async (rawData) => {
  // Handle null or undefined data
  if (!rawData || !Array.isArray(rawData)) {
    return {
      nodes: [],
      statsRecord: {
        numBondedOperators: 0,
        totalAuthorizedAmount: 0,
        totalStaked: 0,
      }
    };
  }

  // Load beta stakers list
  const betaStakersList = await loadBetaStakers();

  const nodes = rawData
    .map((item) => ({
      id: item.id.split('-')[0],
      registeredOperatorAddress: item.tacoOperator?.operator,
      isOperatorConfirmed: item.tacoOperator?.confirmed,
      isAuthorized: parseFloat(item.amount) > 0,
      authorizedAmount: parseFloat(item.amount) || 0,
      stakedAmount: parseFloat(item.stake?.stakedAmount) || 0,
      bondedAt: item.tacoOperator?.bondedTimestamp * 1000,
      isBetaStaker: betaStakersList.has(item.id.split('-')[0].toLowerCase()),
      isReleased: item.isReleased || false,
      isSlashed: item.isSlashed || false,
      isPenalized: item.isPenalized || false,
      totalRewards: item.totalRewards || '0',
      totalRewardsWithdrawn: item.totalRewardsWithdrawn || '0',
      isChildSynced: item.isChildSynced,
      endDeauthorization: item.endDeauthorization,
      nodeStatus: item.isSlashed ? 'Slashed' : item.isPenalized ? 'Penalized' : item.isReleased ? 'Released' : 'Active',
    }))

  const statsRecord = {
    numBondedOperators: 0,
    totalAuthorizedAmount: 0,
    totalStaked: 0,
  };

  // Exclude beta stakers from aggregate stats
  nodes.forEach((node) => {
    if (node.isBetaStaker) return;
    if (node.isOperatorConfirmed) {
      statsRecord.numBondedOperators += 1;
    }
    statsRecord.totalAuthorizedAmount += node.authorizedAmount;
    statsRecord.totalStaked += node.stakedAmount;
  });

  return { nodes, statsRecord };
};

export const formatNodeDetail = (rawData) => {
  console.log("formatNodeDetail input:", rawData);

  // Handle null or missing appAuthorization
  if (!rawData || !rawData.appAuthorization) {
    console.log("No appAuthorization found, returning empty data");
    return {
      id: null,
      registeredOperatorAddress: null,
      isOperatorConfirmed: false,
      isAuthorized: false,
      weiDecimalAuthorizedAmount: "0",
      parsedAuthorizedAmount: 0,
      weiDecimalDeauthorizingAmount: "0",
      weiDecimalStakedAmount: "0",
      parsedStakedAmount: 0,
      bondedAt: null,
      stakedAt: null,
      owner: null,
      authorizer: null,
      beneficiary: null,
      appAuthorization: null,
      events: []
    };
  }

  const appAuthorization = rawData.appAuthorization;

  const getFirstStakedAt = (stakeHistory) => {
    const stakedEvents = stakeHistory.filter(event => event.eventType === 'Staked');
    if (stakedEvents.length > 0) {
      const firstStakedEvent = stakedEvents.reduce((earliest, current) => {
        return earliest.timestamp < current.timestamp ? earliest : current;
      });
      return firstStakedEvent.timestamp;
    }
    return null;
  };

  const firstStakedAt = appAuthorization.stake?.stakeHistory
    ? getFirstStakedAt(appAuthorization.stake?.stakeHistory) * 1000
    : null;

  const mergeAndSortEvents = (stakeHistory, appAuthHistories, tacoOperator) => {
    const combinedEvents = [...stakeHistory, ...appAuthHistories].map(event => ({
      blockNumber: event.blockNumber,
      eventType: event.eventType,
      timestamp: event.timestamp * 1000,
      weiDecimalEventAmount: formatWeiDecimal(event.eventAmount || event.amount),
      parsedEventAmount: parseFloat(event.eventAmount || event.amount),
    }));

    if (tacoOperator?.bondedTimestamp) {
      combinedEvents.push({
        blockNumber: null,
        eventType: 'BondedOperator',
        timestamp: tacoOperator.bondedTimestamp * 1000,
        weiDecimalEventAmount: null,
        parsedEventAmount: null,
      });
    }

    combinedEvents.sort((a, b) => b.timestamp - a.timestamp);
    return combinedEvents;
  };

  const events = mergeAndSortEvents(
    appAuthorization.stake?.stakeHistory || [],
    rawData.appAuthHistories || [],
    appAuthorization.tacoOperator || {}
  );

  const result = {
    id: appAuthorization.id?.split('-')[0],
    registeredOperatorAddress: appAuthorization.tacoOperator?.operator,
    isOperatorConfirmed: appAuthorization.tacoOperator?.confirmed,
    isAuthorized: parseFloat(appAuthorization.amount) > 0,
    weiDecimalAuthorizedAmount: formatWeiDecimal(appAuthorization.amount),
    parsedAuthorizedAmount: parseFloat(appAuthorization.amount),
    weiDecimalDeauthorizingAmount: formatWeiDecimal(appAuthorization.amountDeauthorizing),
    weiDecimalStakedAmount: formatWeiDecimal(appAuthorization.stake?.stakedAmount),
    parsedStakedAmount: parseFloat(appAuthorization.stake?.stakedAmount),
    bondedAt: appAuthorization.tacoOperator?.bondedTimestamp * 1000,
    stakedAt: firstStakedAt,
    owner: appAuthorization.stake?.owner?.id,
    authorizer: appAuthorization.stake?.authorizer,
    beneficiary: appAuthorization.stake?.beneficiary,
    events: events,
  };

  console.log("formatNodeDetail result:", result);
  console.log("Authorized amount:", appAuthorization.amount, "->", result.weiDecimalAuthorizedAmount);
  console.log("Staked amount:", appAuthorization.stake?.stakedAmount, "->", result.weiDecimalStakedAmount);

  return result;
};

export const formatUserDetail = (user) => ({
  rituals: formatRitualsData(user.rituals)
});

// Helper function to retry GraphQL queries with exponential backoff
const retryQuery = async (queryFn, maxRetries = 3) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const result = await queryFn();
            if (result.errors) {
                // Check if it's a network/fetch error vs a GraphQL schema error
                const hasNetworkError = result.errors.some(error =>
                    error.message.includes('Failed to fetch') ||
                    error.message.includes('Network error') ||
                    error.extensions?.code === 'NETWORK_ERROR'
                );

                if (hasNetworkError && attempt < maxRetries - 1) {
                    console.warn(`Network error detected, retrying... (${attempt + 1}/${maxRetries})`);
                    throw new Error(`Network error: ${result.errors[0].message}`);
                } else {
                    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
                }
            }
            return result;
        } catch (error) {
            console.warn(`Query attempt ${attempt + 1} failed:`, error.message);
            if (attempt === maxRetries - 1) throw error;
            // Exponential backoff: wait 1s, 2s, 4s
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
    }
};

// Helper function to get all rituals data with pagination via direct fetch
const getAllRitualsWithPagination = async () => {
    const allRituals = [];
    let skip = 0;
    const pageSize = 1000;
    let hasMore = true;
    let ritualCounter = null;
    let pageCount = 0;
    const maxConsecutiveFailures = 3;
    let consecutiveFailures = 0;

    console.log('🌮 Starting paginated ritual fetch (direct fetch to Polygon)...');

    const query = `
      query GetAllRituals($skip: Int = 0) {
        rituals(
          first: 1000
          skip: $skip
          where: { id_not_in: ["1", "2", "3", "4", "5", "6"] }
          orderBy: id
          orderDirection: asc
        ) { ${RITUAL_FIELDS} }
        ${RITUAL_COUNTER_FIELDS}
      }
    `;

    while (hasMore && consecutiveFailures < maxConsecutiveFailures) {
        pageCount++;
        console.log(`📄 Fetching page ${pageCount} (skip: ${skip})`);

        try {
            const data = await gqlFetch(SUBGRAPH_POLYGON, query, { skip });
            const rituals = data.rituals || [];
            const pageRitualCounter = data.ritualCounter;

            if (!ritualCounter && pageRitualCounter) {
                ritualCounter = pageRitualCounter;
                console.log(`📊 Expected total rituals: ${ritualCounter.total}`);
            }

            if (rituals.length > 0) {
                const existingIds = new Set(allRituals.map(r => r.id));
                const newRituals = rituals.filter(r => !existingIds.has(r.id));
                allRituals.push(...newRituals);
                console.log(`✅ Page ${pageCount}: +${newRituals.length} (total: ${allRituals.length})`);

                if (newRituals.length === 0) { hasMore = false; }
                else {
                    skip += pageSize;
                    consecutiveFailures = 0;
                    hasMore = rituals.length === pageSize;
                    if (ritualCounter?.total && allRituals.length >= parseInt(ritualCounter.total)) hasMore = false;
                }
                if (allRituals.length >= 5000) { hasMore = false; }
            } else {
                hasMore = false;
            }

            if (hasMore) await new Promise(r => setTimeout(r, 200));
        } catch (error) {
            consecutiveFailures++;
            console.error(`❌ Page ${pageCount} failed (${consecutiveFailures}/${maxConsecutiveFailures}):`, error.message);
            if (consecutiveFailures >= maxConsecutiveFailures) throw error;
            await new Promise(r => setTimeout(r, 2000 * consecutiveFailures));
        }
    }

    console.log(`🎉 Pagination complete! Total: ${allRituals.length}`);
    return { rituals: allRituals, ritualCounter };
};

export const getRituals = async (isSearch, searchInput) => {
    const emptyData = { rituals: [] };

    try {
        if (isSearch && searchInput) {
            const isAddress = searchInput.startsWith('0x') && searchInput.length === 42;
            const isTxHash = searchInput.startsWith('0x') && searchInput.length === 66;

            const searchQuery = `
              query SearchRituals($authority: Bytes, $id: ID, $txHash: Bytes, $skip: Int = 0) {
                rituals(
                  first: 1000, skip: $skip,
                  where: { and: [
                    { or: [
                      { authority: $authority }
                      { id: $id }
                      { transactions_: { transactionHash: $txHash } }
                    ] }
                    { id_not_in: ["1", "2", "3", "4", "5", "6"] }
                  ] }
                  orderBy: id, orderDirection: asc
                ) { ${RITUAL_FIELDS} }
                ${RITUAL_COUNTER_FIELDS}
              }
            `;

            const data = await gqlFetch(SUBGRAPH_POLYGON, searchQuery, {
                authority: isAddress ? searchInput.toLowerCase() : null,
                id: !isAddress ? searchInput : null,
                txHash: isTxHash ? searchInput.toLowerCase() : null,
                skip: 0,
            });

            if (data) return data;
        } else {
            const data = await getAllRitualsWithPagination();
            if (data?.rituals) return data;
        }
    } catch (error) {
        console.error('Error fetching rituals from subgraph:', error);
        return {
            rituals: [],
            _errorMessage: `Error fetching ritual data from subgraph: ${error.message}`
        };
    }

    return emptyData;
};


export const getNetworkEvents = async () => {
  // Deprecated — use getAllNetworkEvents instead
  return getAllNetworkEvents();
};

const buildAppAuthorization = (provider) => {
  const providerId = provider.id.toLowerCase();
  return {
    id: providerId + '-' + tacoAddr,
    amount: provider.authorized,
    amountDeauthorizing: provider.deauthorizing,
    endDeauthorization: provider.endDeauthorization,
    appAddress: tacoAddr,
    appName: "TACo",
    isReleased: provider.isReleased,
    isSlashed: provider.isSlashed,
    isPenalized: provider.isPenalized,
    totalRewards: provider.totalRewards,
    totalRewardsWithdrawn: provider.totalRewardsWithdrawn,
    isChildSynced: provider.isChildSynced,
    stake: {
      id: providerId,
      stakedAmount: provider.authorized,
      owner: { id: providerId },
      authorizer: providerId,
      beneficiary: providerId,
      stakeHistory: []
    },
    tacoOperator: provider.operator ? {
      id: provider.operator,
      operator: provider.operator,
      confirmed: provider._confirmed !== undefined ? provider._confirmed : !!provider.operator,
      bondedTimestamp: provider._createdAt || provider.startTimestamp,
      bondedTimestampFirstOperator: provider._createdAt || provider.startTimestamp
    } : null
  };
};

// ─── V2 Native Event Queries ───────────────────────────────────────────────
// Fetches ALL event entity types from all three chain subgraphs.

const ETHEREUM_EVENTS_QUERY = `
  query EthereumEvents {
    authorizationEvents(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id eventType fromAmount toAmount penalty investigator reward
      deauthorizing endDeauthorization operator
      stakingProvider { id }
      transactionHash blockNumber timestamp
    }
    rewardEvents(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id eventType amount sender beneficiary
      endCommitment penaltyPercent endPenalty contract distributor
      stakingProvider { id }
      transactionHash blockNumber timestamp
    }
    governanceEvents(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id eventType contract oldValue newValue
      oldValueInt newValueInt oldValueAddress newValueAddress
      domain transactionHash blockNumber timestamp
    }
    bridgeMessages(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id domain messageType stakingProvider
      transactionHash blockNumber timestamp
    }
    infractions(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id domain infractionType infractionTypeName
      stakingProvider { id }
      ritual { id }
      timestamp
    }
  }
`;

const POLYGON_EVENTS_QUERY = `
  query PolygonEvents {
    ritualTransactions(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id eventType participant transcriptDigest aggregatedTranscriptDigest
      previousAuthority newAuthority
      ritual { id }
      transactionHash blockNumber timestamp gasUsed
    }
    handovers(first: 1000, orderBy: createdAt, orderDirection: desc) {
      id departingParticipant incomingParticipant status
      ritual { id }
      requestedAt transcriptPostedAt blindedSharePostedAt canceledAt finalizedAt
      createdAt updatedAt
    }
    subscriptionPayments(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id domain policyId subscriber amount period slots paymentType
      policy { id sponsor owner }
      transactionHash blockNumber timestamp
    }
    policies(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id domain sponsor owner size startTimestamp endTimestamp cost
      transactionHash blockNumber timestamp
    }
    ritualAccessControls(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id domain ritualId address isAuthorized
      transactionHash blockNumber timestamp
    }
    reimbursementWithdrawals(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id domain recipient amount transactionHash blockNumber timestamp
    }
    reimbursementFailures(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id domain recipient amount transactionHash blockNumber timestamp
    }
    governanceEvents(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id eventType contract oldValue newValue
      oldValueInt newValueInt oldValueAddress newValueAddress
      domain transactionHash blockNumber timestamp
    }
    infractions(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id domain infractionType infractionTypeName
      stakingProvider { id }
      ritual { id }
      timestamp
    }
    bridgeMessages(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id domain messageType stakingProvider
      transactionHash blockNumber timestamp
    }
  }
`;

const BASE_EVENTS_QUERY = `
  query BaseEvents {
    signingCohorts(first: 1000, orderBy: createdAt, orderDirection: desc) {
      id domain chainId authority participants status
      isDeployed deployedAt multisigAddress signers threshold
      createdAt updatedAt
    }
    signingCohortSignatures(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id provider signer
      cohort { id }
      transactionHash blockNumber timestamp
    }
    multisigClones(first: 1000, orderBy: createdAt, orderDirection: desc) {
      id domain cohortId factory signers threshold
      isCleared executionCount totalValue lastExecutedAt
      createdAt updatedAt
    }
    multisigExecutions(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id sender nonce destination value
      multisig { id }
      transactionHash blockNumber timestamp gasUsed
    }
    multisigSignerEvents(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id eventType signer newSigner
      multisig { id }
      transactionHash blockNumber timestamp
    }
    opExecutions(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id domain target result
      transactionHash blockNumber timestamp gasUsed
    }
    contractAuthorizations(first: 1000, orderBy: createdAt, orderDirection: desc) {
      id domain contract isAuthorized createdAt updatedAt
    }
    governanceEvents(first: 1000, orderBy: timestamp, orderDirection: desc) {
      id eventType contract oldValue newValue
      oldValueInt newValueInt oldValueAddress newValueAddress
      domain transactionHash blockNumber timestamp
    }
  }
`;

// Safely fetch from a chain — returns empty object on failure
const safeFetch = async (endpoint, query, chainLabel, variables = {}) => {
  if (!endpoint) return {};
  try {
    return await gqlFetch(endpoint, query, variables);
  } catch (err) {
    console.warn(`⚠️ ${chainLabel} event fetch failed:`, err.message);
    return {};
  }
};

export const getAllNetworkEvents = async () => {
  try {
    const [ethData, polyData, baseData] = await Promise.all([
      safeFetch(SUBGRAPH_ETHEREUM, ETHEREUM_EVENTS_QUERY, 'Ethereum'),
      safeFetch(SUBGRAPH_POLYGON, POLYGON_EVENTS_QUERY, 'Polygon'),
      safeFetch(SUBGRAPH_BASE, BASE_EVENTS_QUERY, 'Base'),
    ]);

    const events = [];
    const ts = (v) => parseInt(v) * 1000;

    // ── Ethereum Events ──
    (ethData.authorizationEvents || []).forEach(e => {
      events.push({
        chain: 'ethereum', category: 'authorization', type: e.eventType,
        stakingProvider: e.stakingProvider?.id, amount: e.toAmount,
        fromAmount: e.fromAmount, penalty: e.penalty, investigator: e.investigator,
        reward: e.reward, operator: e.operator,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (ethData.rewardEvents || []).forEach(e => {
      events.push({
        chain: 'ethereum', category: 'reward', type: e.eventType,
        stakingProvider: e.stakingProvider?.id, amount: e.amount,
        sender: e.sender, beneficiary: e.beneficiary, contract: e.contract,
        distributor: e.distributor,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (ethData.governanceEvents || []).forEach(e => {
      events.push({
        chain: 'ethereum', category: 'governance', type: e.eventType,
        contract: e.contract, domain: e.domain,
        oldValue: e.oldValue, newValue: e.newValue,
        oldValueInt: e.oldValueInt, newValueInt: e.newValueInt,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (ethData.bridgeMessages || []).forEach(e => {
      events.push({
        chain: 'ethereum', category: 'bridge', type: 'BRIDGE_MESSAGE',
        messageType: e.messageType, stakingProvider: e.stakingProvider,
        domain: e.domain,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (ethData.infractions || []).forEach(e => {
      events.push({
        chain: 'ethereum', category: 'infraction', type: e.infractionTypeName,
        stakingProvider: e.stakingProvider?.id, ritualId: e.ritual?.id,
        domain: e.domain, timestamp: ts(e.timestamp),
      });
    });

    // ── Polygon Events ──
    (polyData.ritualTransactions || []).forEach(e => {
      events.push({
        chain: 'polygon', category: 'ritual', type: e.eventType,
        ritualId: e.ritual?.id, participant: e.participant,
        previousAuthority: e.previousAuthority, newAuthority: e.newAuthority,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp), gasUsed: e.gasUsed,
      });
    });
    (polyData.handovers || []).forEach(e => {
      events.push({
        chain: 'polygon', category: 'handover', type: `HANDOVER_${e.status}`,
        ritualId: e.ritual?.id,
        departingParticipant: e.departingParticipant,
        incomingParticipant: e.incomingParticipant,
        timestamp: ts(e.updatedAt),
      });
    });
    (polyData.subscriptionPayments || []).forEach(e => {
      events.push({
        chain: 'polygon', category: 'subscription', type: e.paymentType,
        subscriber: e.subscriber, amount: e.amount,
        policyId: e.policyId, period: e.period, slots: e.slots,
        sponsor: e.policy?.sponsor,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (polyData.policies || []).forEach(e => {
      events.push({
        chain: 'polygon', category: 'policy', type: 'POLICY_CREATED',
        sponsor: e.sponsor, owner: e.owner, size: e.size, cost: e.cost,
        startTimestamp: e.startTimestamp, endTimestamp: e.endTimestamp,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (polyData.ritualAccessControls || []).forEach(e => {
      events.push({
        chain: 'polygon', category: 'access_control',
        type: e.isAuthorized ? 'ACCESS_GRANTED' : 'ACCESS_REVOKED',
        ritualId: e.ritualId?.toString(), address: e.address,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (polyData.reimbursementWithdrawals || []).forEach(e => {
      events.push({
        chain: 'polygon', category: 'reimbursement', type: 'REIMBURSEMENT_WITHDRAWAL',
        recipient: e.recipient, amount: e.amount,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (polyData.reimbursementFailures || []).forEach(e => {
      events.push({
        chain: 'polygon', category: 'reimbursement', type: 'REIMBURSEMENT_FAILURE',
        recipient: e.recipient, amount: e.amount,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (polyData.governanceEvents || []).forEach(e => {
      events.push({
        chain: 'polygon', category: 'governance', type: e.eventType,
        contract: e.contract, domain: e.domain,
        oldValue: e.oldValue, newValue: e.newValue,
        oldValueInt: e.oldValueInt, newValueInt: e.newValueInt,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (polyData.infractions || []).forEach(e => {
      events.push({
        chain: 'polygon', category: 'infraction', type: e.infractionTypeName,
        stakingProvider: e.stakingProvider?.id, ritualId: e.ritual?.id,
        domain: e.domain, timestamp: ts(e.timestamp),
      });
    });
    (polyData.bridgeMessages || []).forEach(e => {
      events.push({
        chain: 'polygon', category: 'bridge', type: 'BRIDGE_MESSAGE',
        messageType: e.messageType, stakingProvider: e.stakingProvider,
        domain: e.domain,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });

    // ── Base Events ──
    (baseData.signingCohorts || []).forEach(e => {
      events.push({
        chain: 'base', category: 'signing', type: `COHORT_${e.status}`,
        cohortId: e.id, authority: e.authority,
        participantCount: e.participants?.length,
        isDeployed: e.isDeployed, multisigAddress: e.multisigAddress,
        threshold: e.threshold,
        timestamp: ts(e.createdAt),
      });
    });
    (baseData.signingCohortSignatures || []).forEach(e => {
      events.push({
        chain: 'base', category: 'signing', type: 'COHORT_SIGNATURE',
        cohortId: e.cohort?.id, provider: e.provider, signer: e.signer,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (baseData.multisigExecutions || []).forEach(e => {
      events.push({
        chain: 'base', category: 'multisig', type: 'MULTISIG_EXECUTION',
        multisigAddress: e.multisig?.id, sender: e.sender,
        destination: e.destination, amount: e.value, nonce: e.nonce,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp), gasUsed: e.gasUsed,
      });
    });
    (baseData.multisigSignerEvents || []).forEach(e => {
      events.push({
        chain: 'base', category: 'multisig', type: e.eventType,
        multisigAddress: e.multisig?.id, signer: e.signer, newSigner: e.newSigner,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });
    (baseData.opExecutions || []).forEach(e => {
      events.push({
        chain: 'base', category: 'op_execution', type: 'OP_EXECUTION',
        target: e.target, result: e.result, domain: e.domain,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp), gasUsed: e.gasUsed,
      });
    });
    (baseData.contractAuthorizations || []).forEach(e => {
      events.push({
        chain: 'base', category: 'contract_auth',
        type: e.isAuthorized ? 'CONTRACT_AUTHORIZED' : 'CONTRACT_DEAUTHORIZED',
        contract: e.contract, domain: e.domain,
        timestamp: ts(e.createdAt),
      });
    });
    (baseData.governanceEvents || []).forEach(e => {
      events.push({
        chain: 'base', category: 'governance', type: e.eventType,
        contract: e.contract, domain: e.domain,
        oldValue: e.oldValue, newValue: e.newValue,
        oldValueInt: e.oldValueInt, newValueInt: e.newValueInt,
        txHash: e.transactionHash, blockNumber: e.blockNumber,
        timestamp: ts(e.timestamp),
      });
    });

    return events.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('Error fetching network events:', error);
    return [];
  }
};

export const getNodes = async (isSearch, searchInput) => {
  const emptyData = { appAuthorizations: [] };

  try {
    let stakingProviders;
    if (!isSearch) {
      const data = await gqlFetch(SUBGRAPH_POLYGON, `
        query { stakingProviders(first: 1000, orderBy: authorized, orderDirection: desc) {
          id operator authorized deauthorizing endDeauthorization startTimestamp
          isReleased isSlashed isPenalized totalRewards totalRewardsWithdrawn
          isChildSynced
        } }
      `);
      stakingProviders = data.stakingProviders;
    } else {
      const search = searchInput.toLowerCase();
      const data = await gqlFetch(SUBGRAPH_POLYGON, `
        query SearchStakers($id: ID!, $address: Bytes) {
          stakingProviders(where: { or: [{ id: $id }, { operator: $address }] }) {
            id operator authorized deauthorizing startTimestamp
          }
        }
      `, { id: search, address: search });
      stakingProviders = data.stakingProviders;
    }

    if (stakingProviders) {
      // Enrich with Ethereum data for confirmed/bonded status
      try {
        const ethData = await gqlFetch(SUBGRAPH_ETHEREUM, `
          query { stakingProviders(first: 1000) { id operator createdAt } }
        `);
        const ethMap = new Map((ethData?.stakingProviders || []).map(p => [p.id.toLowerCase(), p]));
        stakingProviders = stakingProviders.map(p => {
          const eth = ethMap.get(p.id.toLowerCase());
          if (eth) {
            const isConfirmed = eth.operator && eth.operator !== '0x0000000000000000000000000000000000000000';
            return { ...p, _confirmed: isConfirmed, _createdAt: eth.createdAt };
          }
          return { ...p, _confirmed: false, _createdAt: null };
        });
      } catch (e) {
        console.warn('Failed to enrich with Ethereum data:', e);
      }
      return { appAuthorizations: stakingProviders.map(buildAppAuthorization) };
    }
  } catch (e) {
    console.log("error to fetch stakers data " + e);
  }
  return emptyData;
};

export const getNodeDetail = async (node) => {
  try {
    const nodeAddress = node.toLowerCase();

    const data = await gqlFetch(SUBGRAPH_POLYGON, `
      query StakerDetail($id: ID!) {
        stakingProvider(id: $id) {
          id operator previousOperator authorized deauthorizing endDeauthorization startTimestamp
          isReleased isSlashed isPenalized totalPenalty lastSlashInvestigator lastSlashReward
          isChildSynced lastChildSyncAt
          totalRewards totalRewardsWithdrawn
          commitmentEndTimestamp penaltyPercent penaltyEndTimestamp
          createdAt updatedAt
          authorizationEvents(first: 50, orderBy: timestamp, orderDirection: desc) {
            id eventType fromAmount toAmount penalty investigator reward
            deauthorizing endDeauthorization operator
            timestamp blockNumber transactionHash
          }
          rewards(first: 50, orderBy: timestamp, orderDirection: desc) {
            id eventType amount sender beneficiary
            endCommitment penaltyPercent endPenalty
            transactionHash blockNumber timestamp
          }
          infractions(first: 20, orderBy: timestamp, orderDirection: desc) {
            id infractionType infractionTypeName
            ritual { id }
            timestamp
          }
        }
      }
    `, { id: nodeAddress });

    if (data?.stakingProvider) {
      const provider = data.stakingProvider;
      const appAuthorization = buildAppAuthorization(provider);
      const appAuthHistories = (provider.authorizationEvents || []).map(event => ({
        id: event.id,
        amount: event.toAmount,
        eventAmount: event.toAmount,
        eventType: event.eventType,
        fromAmount: event.fromAmount,
        penalty: event.penalty,
        investigator: event.investigator,
        reward: event.reward,
        operator: event.operator,
        stakingProvider: provider.id,
        timestamp: event.timestamp,
        blockNumber: event.blockNumber,
        txHash: event.transactionHash
      }));

      return {
        appAuthorization,
        appAuthHistories,
        // V2 extended fields
        rewardEvents: provider.rewards || [],
        infractions: provider.infractions || [],
        totalRewards: provider.totalRewards,
        totalRewardsWithdrawn: provider.totalRewardsWithdrawn,
        commitmentEndTimestamp: provider.commitmentEndTimestamp,
        penaltyPercent: provider.penaltyPercent,
        penaltyEndTimestamp: provider.penaltyEndTimestamp,
        isReleased: provider.isReleased,
        isSlashed: provider.isSlashed,
        isPenalized: provider.isPenalized,
        totalPenalty: provider.totalPenalty,
        endDeauthorization: provider.endDeauthorization,
        previousOperator: provider.previousOperator,
        isChildSynced: provider.isChildSynced,
      };
    }
  } catch (e) {
    console.log("error to fetch staking provider data " + e);
  }

  return { appAuthorization: null, appAuthHistories: [] };
};

export const getUserDetail = async (userAddress) => {
  try {
    const data = await gqlFetch(SUBGRAPH_POLYGON, `
      query GetUserRituals($authority: Bytes) {
        rituals(
          first: 1000,
          where: { and: [
            { authority: $authority }
            { id_not_in: ["1", "2", "3", "4", "5", "6"] }
          ] }
          orderBy: id, orderDirection: asc
        ) { ${RITUAL_FIELDS} }
        ${RITUAL_COUNTER_FIELDS}
      }
    `, { authority: userAddress });

    if (data) return data;
  } catch (e) {
    console.log("error to fetch user data " + e);
  }
  return [];
};

const getWeb3Instance = () => {
  if (!web3Instance) {
    web3Instance = new Web3(Const.RPC_ETH_POLYGON);
  }
  return web3Instance;
};

// Fetch ritual on-chain data (threshold, accessController, feeModel) from Coordinator contract
export const getRitualOnChainData = async (ritualId) => {
  if (!ritualId || isNaN(ritualId)) return null;
  try {
    return await web3Cache.get(
      `ritual-onchain-${ritualId}`,
      async () => {
        const web3 = getWeb3Instance();
        const coordinatorContract = new web3.eth.Contract(
          CoordinatorABI,
          CoordinatorAddress
        );
        const ritualData = await coordinatorContract.methods.rituals(ritualId).call();
        return {
          threshold: ritualData.threshold ? parseInt(ritualData.threshold) : null,
          accessController: ritualData.accessController || null,
          feeModel: ritualData.feeModel || null,
          authority: ritualData.authority || null,
        };
      },
      3600000
    );
  } catch (error) {
    console.error(`Failed to fetch on-chain data for ritual ${ritualId}:`, error);
    return null;
  }
};

export const getRitualFeeModel = async (ritualId) => {
  if (!ritualId || isNaN(ritualId)) {
    console.error(`Invalid ritual ID: ${ritualId}`);
    return null;
  }

  try {
    // Use cache with longer TTL for fee models
    return await web3Cache.get(
      `ritual-feeModel-${ritualId}`,
      async () => {
        const web3 = getWeb3Instance();
        const coordinatorContract = new web3.eth.Contract(
          CoordinatorABI,
          CoordinatorAddress
        );
        const ritualData = await coordinatorContract.methods.rituals(ritualId).call();
        return ritualData.feeModel;
      },
      3600000 // Cache for 1 hour
    );
  } catch (error) {
    console.error(`Failed to fetch feeModel for ritual ${ritualId}:`, error);
    return null;
  }
};

// ─── Domain Stats ──────────────────────────────────────────────────────────
export const getDomainStats = async () => {
  const results = {};
  const query = `query { domainStats_collection(first: 10) {
    id totalRituals successfulRituals failedRituals activeRituals
    totalStakingProviders activeStakingProviders totalAuthorized totalSlashed
    totalRewardEvents totalRewardsDistributed totalRewardsWithdrawn
    totalSigningCohorts deployedCohorts totalMultisigs totalExecutions
    totalBridgeMessages totalOpExecutions totalInfractions
    totalRitualAccessControls totalPolicies totalSubscriptionPayments totalSubscriptionRevenue
    totalContractAuthorizations totalReimbursements totalReimbursementFailures
    totalGovernanceEvents createdAt updatedAt
  } }`;

  const [ethStats, polyStats, baseStats] = await Promise.all([
    safeFetch(SUBGRAPH_ETHEREUM, query, 'Ethereum'),
    safeFetch(SUBGRAPH_POLYGON, query, 'Polygon'),
    safeFetch(SUBGRAPH_BASE, query, 'Base'),
  ]);

  (ethStats.domainStats_collection || []).forEach(s => { results[`eth-${s.id}`] = { ...s, chain: 'ethereum' }; });
  (polyStats.domainStats_collection || []).forEach(s => { results[`poly-${s.id}`] = { ...s, chain: 'polygon' }; });
  (baseStats.domainStats_collection || []).forEach(s => { results[`base-${s.id}`] = { ...s, chain: 'base' }; });

  return results;
};

// ─── Ritual Access Controls for a specific ritual ──────────────────────────
export const getRitualAccessControls = async (ritualId) => {
  try {
    const data = await gqlFetch(SUBGRAPH_POLYGON, `
      query GetRitualAccessControls($ritualId: Int!) {
        ritualAccessControls(where: { ritualId: $ritualId }, first: 100) {
          id address isAuthorized transactionHash timestamp
        }
      }
    `, { ritualId: parseInt(ritualId) });
    return data?.ritualAccessControls || [];
  } catch (e) {
    console.warn('Error fetching ritual access controls:', e);
    return [];
  }
};

// ─── Handovers for a specific ritual ───────────────────────────────────────
export const getRitualHandovers = async (ritualId) => {
  try {
    const data = await gqlFetch(SUBGRAPH_POLYGON, `
      query GetHandovers($prefix: String!) {
        handovers(where: { id_starts_with: $prefix }, first: 100, orderBy: createdAt, orderDirection: desc) {
          id departingParticipant incomingParticipant status
          requestedAt transcriptPostedAt blindedSharePostedAt canceledAt finalizedAt
          ritual { id }
        }
      }
    `, { prefix: ritualId.toString() });
    return data?.handovers || [];
  } catch (e) {
    console.warn('Error fetching handovers:', e);
    return [];
  }
};

// ─── Infractions for a specific staking provider ───────────────────────────
export const getProviderInfractions = async (providerId) => {
  try {
    const variables = { provider: providerId.toLowerCase() };
    const [ethData, polyData] = await Promise.all([
      safeFetch(SUBGRAPH_ETHEREUM, `
        query GetInfractions($provider: String!) {
          infractions(where: { stakingProvider: $provider }, first: 50, orderBy: timestamp, orderDirection: desc) {
            id infractionType infractionTypeName ritual { id } timestamp
          }
        }
      `, 'Ethereum', variables),
      safeFetch(SUBGRAPH_POLYGON, `
        query GetInfractions($provider: String!) {
          infractions(where: { stakingProvider: $provider }, first: 50, orderBy: timestamp, orderDirection: desc) {
            id infractionType infractionTypeName ritual { id } timestamp
          }
        }
      `, 'Polygon', variables),
    ]);
    return [
      ...(ethData.infractions || []).map(i => ({ ...i, chain: 'ethereum' })),
      ...(polyData.infractions || []).map(i => ({ ...i, chain: 'polygon' })),
    ].sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp));
  } catch (e) {
    console.warn('Error fetching infractions:', e);
    return [];
  }
};

// ─── Governance Events ─────────────────────────────────────────────────────
export const getGovernanceEvents = async () => {
  try {
    const query = `query { governanceEvents(first: 200, orderBy: timestamp, orderDirection: desc) {
      id eventType contract oldValue newValue oldValueInt newValueInt
      oldValueAddress newValueAddress domain transactionHash blockNumber timestamp
    } }`;

    const [ethData, polyData, baseData] = await Promise.all([
      safeFetch(SUBGRAPH_ETHEREUM, query, 'Ethereum'),
      safeFetch(SUBGRAPH_POLYGON, query, 'Polygon'),
      safeFetch(SUBGRAPH_BASE, query, 'Base'),
    ]);

    return [
      ...(ethData.governanceEvents || []).map(e => ({ ...e, chain: 'ethereum' })),
      ...(polyData.governanceEvents || []).map(e => ({ ...e, chain: 'polygon' })),
      ...(baseData.governanceEvents || []).map(e => ({ ...e, chain: 'base' })),
    ].sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp));
  } catch (e) {
    console.warn('Error fetching governance events:', e);
    return [];
  }
};

// ─── Signing Cohorts from Subgraph (v2 native) ────────────────────────────
export const getSigningCohortsFromSubgraph = async () => {
  try {
    const data = await gqlFetch(SUBGRAPH_ETHEREUM, `
      query {
        signingCohorts(first: 200, orderBy: createdAt, orderDirection: desc) {
          id domain chainId authority participants status
          isDeployed deployedAt conditions conditionsSetAt
          multisigAddress signers threshold
          createdAt updatedAt
          signatures(first: 100) {
            id provider signer signature transactionHash timestamp
          }
          multisig {
            id threshold signers executionCount totalValue lastExecutedAt isCleared
          }
        }
      }
    `);
    return data?.signingCohorts || [];
  } catch (e) {
    console.warn('Error fetching signing cohorts from subgraph:', e);
    return [];
  }
};

// ─── Signing Cohort Detail from Subgraph ───────────────────────────────────
export const getSigningCohortDetail = async (cohortId) => {
  try {
    const data = await gqlFetch(SUBGRAPH_ETHEREUM, `
      query GetCohort($id: ID!) {
        signingCohort(id: $id) {
          id domain chainId authority participants status
          isDeployed deployedAt conditions conditionsSetAt
          multisigAddress signers threshold
          createdAt updatedAt
          signatures(first: 200, orderBy: timestamp, orderDirection: desc) {
            id provider signer signature transactionHash blockNumber timestamp
          }
          multisig {
            id factory signers threshold isCleared
            executionCount totalValue lastExecutedAt
            createdAt updatedAt
            executions(first: 100, orderBy: timestamp, orderDirection: desc) {
              id sender nonce destination value transactionHash blockNumber timestamp gasUsed
            }
            signerEvents(first: 50, orderBy: timestamp, orderDirection: desc) {
              id eventType signer newSigner transactionHash timestamp
            }
          }
        }
      }
    `, { id: cohortId });
    return data?.signingCohort || null;
  } catch (e) {
    console.warn('Error fetching signing cohort detail:', e);
    return null;
  }
};

// ─── Policies from Subgraph ────────────────────────────────────────────────
export const getPolicies = async () => {
  try {
    const data = await gqlFetch(SUBGRAPH_POLYGON, `
      query {
        policies(first: 200, orderBy: timestamp, orderDirection: desc) {
          id domain sponsor owner size startTimestamp endTimestamp cost
          transactionHash blockNumber timestamp
          payments(first: 50, orderBy: timestamp, orderDirection: desc) {
            id subscriber amount period slots paymentType timestamp
          }
        }
      }
    `);
    return data?.policies || [];
  } catch (e) {
    console.warn('Error fetching policies:', e);
    return [];
  }
};

// ─── Reward Events for a staking provider ──────────────────────────────────
export const getProviderRewards = async (providerId) => {
  try {
    const data = await gqlFetch(SUBGRAPH_ETHEREUM, `
      query GetRewards($id: ID!) {
        stakingProvider(id: $id) {
          totalRewards
          totalRewardsWithdrawn
          commitmentEndTimestamp
          penaltyPercent
          penaltyEndTimestamp
          rewards(first: 100, orderBy: timestamp, orderDirection: desc) {
            id eventType amount sender beneficiary
            endCommitment penaltyPercent endPenalty
            transactionHash blockNumber timestamp
          }
        }
      }
    `, { id: providerId.toLowerCase() });
    return data?.stakingProvider || null;
  } catch (e) {
    console.warn('Error fetching provider rewards:', e);
    return null;
  }
};

export const getTimeout = async () => {
  if (!networkConfig.coordinator) return null;

  // Use cache to prevent multiple calls
  return web3Cache.get('coordinator-timeout', async () => {
    const web3 = getWeb3Instance();
    const coordinator = networkConfig.coordinator;
    const contractAbi = [
      {
        type: "function",
        name: "timeout",
        stateMutability: "view",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "uint32",
                internalType: "uint32"
            }
        ]
    },
    ];

    const contract = new web3.eth.Contract(contractAbi, coordinator);
    const timeout = await contract.methods
      .timeout()
      .call();
    return timeout;
  }, 300000); // Cache for 5 minutes
};

// ─── All Reward Events (network-wide) ──────────────────────────────────────
export const getAllRewardEvents = async () => {
  try {
    const query = `query {
      rewardEvents(first: 1000, orderBy: timestamp, orderDirection: desc) {
        id
        stakingProvider { id }
        eventType
        amount
        sender
        beneficiary
        endCommitment
        penaltyPercent
        endPenalty
        contract
        distributor
        transactionHash
        blockNumber
        timestamp
      }
    }`;
    const data = await gqlFetch(SUBGRAPH_ETHEREUM, query);
    return (data?.rewardEvents || []).map(e => ({
      ...e,
      stakingProvider: e.stakingProvider?.id || null,
      timestamp: parseInt(e.timestamp) * 1000,
      blockNumber: parseInt(e.blockNumber),
      amount: e.amount || '0',
    }));
  } catch (e) {
    console.warn('Error fetching reward events:', e);
    return [];
  }
};

// ─── Reward Distributions (from taco-rewards GitHub) ───────────────────────
const DISTRIBUTION_DATES = ['2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01'];
const DISTRIBUTIONS_BASE_URL = 'https://raw.githubusercontent.com/nucypher/taco-rewards/main/distributions';

export const getRewardDistributions = async () => {
  try {
    const results = await Promise.all(
      DISTRIBUTION_DATES.map(async (date) => {
        const resp = await fetch(`${DISTRIBUTIONS_BASE_URL}/${date}.json`);
        if (!resp.ok) return null;
        const data = await resp.json();
        return { date, ...data };
      })
    );
    return results.filter(Boolean);
  } catch (e) {
    console.warn('Error fetching reward distributions:', e);
    return [];
  }
};

// ─── All Infractions (network-wide) ────────────────────────────────────────
export const getAllInfractions = async () => {
  try {
    const query = `query {
      infractions(first: 1000, orderBy: timestamp, orderDirection: desc) {
        id
        domain
        ritual { id }
        stakingProvider { id }
        infractionType
        infractionTypeName
        timestamp
      }
    }`;
    const [ethData, polyData] = await Promise.all([
      safeFetch(SUBGRAPH_ETHEREUM, query, 'Ethereum'),
      safeFetch(SUBGRAPH_POLYGON, query, 'Polygon'),
    ]);
    const format = (items, chain) => (items || []).map(i => ({
      ...i,
      chain,
      stakingProvider: i.stakingProvider?.id || null,
      ritualId: i.ritual?.id || null,
      timestamp: parseInt(i.timestamp) * 1000,
    }));
    return [
      ...format(ethData.infractions, 'ethereum'),
      ...format(polyData.infractions, 'polygon'),
    ].sort((a, b) => b.timestamp - a.timestamp);
  } catch (e) {
    console.warn('Error fetching infractions:', e);
    return [];
  }
};

// ─── Recent Bridge Activity (for dashboard) ────────────────────────────────
export const getRecentBridgeActivity = async () => {
  const BRIDGE_QUERY = `query {
    bridgeMessages(first: 15, orderBy: timestamp, orderDirection: desc) {
      id domain messageType stakingProvider transactionHash blockNumber timestamp
    }
  }`;
  const OPS_QUERY = `query {
    opExecutions(first: 15, orderBy: timestamp, orderDirection: desc) {
      id domain target result transactionHash blockNumber timestamp gasUsed
    }
    contractAuthorizations(first: 10, orderBy: createdAt, orderDirection: desc) {
      id domain contract isAuthorized createdAt
    }
  }`;
  try {
    const [ethData, polyData, baseData] = await Promise.all([
      gqlFetch(SUBGRAPH_ETHEREUM, BRIDGE_QUERY).catch(() => ({})),
      gqlFetch(SUBGRAPH_POLYGON, BRIDGE_QUERY).catch(() => ({})),
      gqlFetch(SUBGRAPH_BASE, OPS_QUERY).catch(() => ({})),
    ]);
    const messages = [
      ...(ethData.bridgeMessages || []).map(m => ({ ...m, chain: 'ethereum' })),
      ...(polyData.bridgeMessages || []).map(m => ({ ...m, chain: 'polygon' })),
    ].sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp)).slice(0, 15);
    return {
      bridgeMessages: messages,
      opExecutions: baseData.opExecutions || [],
      contractAuthorizations: baseData.contractAuthorizations || [],
    };
  } catch (e) {
    console.warn('Error fetching bridge activity:', e);
    return { bridgeMessages: [], opExecutions: [], contractAuthorizations: [] };
  }
};

// ─── Op Executions by Domain ───────────────────────────────────────────────
export const getOpExecutionsByDomain = async (domain) => {
  try {
    const data = await gqlFetch(SUBGRAPH_BASE, `
      query GetOpExecutions($domain: Int!) {
        opExecutions(where: { domain: $domain }, first: 200, orderBy: timestamp, orderDirection: desc) {
          id domain target result
          transactionHash blockNumber timestamp gasUsed
        }
      }
    `, { domain: parseInt(domain) });
    return data?.opExecutions || [];
  } catch (e) {
    console.warn('Error fetching op executions by domain:', e);
    return [];
  }
};

// Get all ritual IDs that have access controls set (= live/paid rituals, not heartbeats)
export const getLiveRitualIds = async () => {
  try {
    const data = await gqlFetch(SUBGRAPH_POLYGON, `
      query { ritualAccessControls(first: 1000) { ritualId } }
    `);
    const ids = new Set((data?.ritualAccessControls || []).map(r => String(r.ritualId)));
    console.log(`🔑 Found ${ids.size} live ritual IDs with access controls`);
    return ids;
  } catch (e) {
    console.warn('Error fetching live ritual IDs:', e);
    return new Set();
  }
};
