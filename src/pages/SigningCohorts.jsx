import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './SigningCohorts.module.css';
import { calculateTimeMoment, getSigningCohortsFromSubgraph } from './data';
import PageHeader from '../components/PageHeader';
import { ListSkeleton } from '../components/Skeleton';
import ChainIcon from '../components/ChainIcon';

// ── Condition hex decoder ─────────────────────────────────────────────────────
function decodeConditions(hex) {
  if (!hex || hex === '0x') return null;
  try {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// ── Compact policy summarizer ─────────────────────────────────────────────────
const TYPE_COLOR = {
  ecdsa:               '#9b7fe8',
  jwt:                 '#b07fe8',
  time:                '#d4915a',
  json:                '#5b9bd5',
  'json-rpc':          '#5b9bd5',
  'context-variable':  '#888',
  context:             '#888',
  'signing-attribute': '#3a7d5e',
  'signing-abi-attribute': '#c0564a',
  contract:            '#c0564a',
  compound:            '#999',
  sequential:          '#5baaaa',
};

const TYPE_LABEL = {
  ecdsa:               'ecdsa',
  jwt:                 'jwt',
  time:                'time',
  json:                'json',
  'json-rpc':          'json',
  'context-variable':  'ctx',
  context:             'ctx',
  'signing-attribute': 'signing',
  'signing-abi-attribute': 'txlimit',
  contract:            'contract',
  compound:            'compound',
  sequential:          'seq',
};

// Collect all leaf condition types recursively (deduplicated)
function collectTypes(cond, out = new Set()) {
  if (!cond) return out;
  const t = cond.conditionType || '';
  if (t === 'compound') {
    (cond.operands || []).forEach((o) => collectTypes(o, out));
  } else if (t === 'sequential') {
    (cond.conditionVariables || []).forEach((s) => collectTypes(s.condition || s, out));
  } else if (t) {
    out.add(t);
  }
  return out;
}

function extractToken(varName) {
  const u = varName.toUpperCase();
  for (const t of ['USDC', 'USDT', 'ETH', 'DAI', 'WETH', 'WBTC', 'BTC']) {
    if (u.includes(t)) return t;
  }
  return null;
}

function extractAmount(step) {
  const rvt = step?.condition?.returnValueTest;
  if (!rvt) return null;
  const c = rvt.comparator;
  if (c === '>=' || c === '>' || c === '==') return `${c} ${rvt.value}`;
  return null;
}

function recipientPath(steps) {
  const hasContract = steps.some((s) => s.condition?.conditionType === 'contract');
  const hasSalt = steps.some((s) => (s.varName || '').toLowerCase().includes('salt'));
  return hasContract || hasSalt ? 'contract-derived' : 'direct';
}

function summarizeCondition(cond) {
  if (!cond) return null;
  const t = cond.conditionType || '';

  if (t === 'compound') {
    const op = (cond.operator || 'and').toLowerCase();
    const operands = cond.operands || [];

    if (op === 'or') {
      const allEcdsa = operands.length > 0 && operands.every((o) => o.conditionType === 'ecdsa');
      if (allEcdsa) {
        const src = (operands[0]?.message || '').toLowerCase().includes('discord') ? 'Discord ' : '';
        return `${src}Signatories — any 1 of ${operands.length}`;
      }
      const allSeqTx = operands.every((o) => {
        const steps = o.conditionVariables || [];
        return o.conditionType === 'sequential' &&
          steps.some((s) => s.condition?.conditionType === 'signing-abi-attribute');
      });
      if (allSeqTx) {
        const firstSteps = operands[0].conditionVariables || [];
        const amtStep = firstSteps.find((s) => {
          const v = (s.varName || '').toLowerCase();
          return v.includes('amount') || v.includes('value');
        });
        const token = amtStep ? extractToken(amtStep.varName || '') : null;
        const amt = amtStep ? extractAmount(amtStep) : null;
        return `${token || 'Token'} transfer${amt ? ' ' + amt : ''} — any route`;
      }
      return `Any of ${operands.length} conditions`;
    }

    // AND
    const parts = operands.map((o) => summarizeCondition(o)).filter(Boolean);
    return parts.length > 1 ? parts.join(' + ') : parts[0] || 'Compound';
  }

  if (t === 'sequential') {
    const steps = cond.conditionVariables || [];
    const types = steps.map((s) => s.condition?.conditionType || '');
    if (types.includes('signing-abi-attribute')) {
      const amtStep = steps.find((s) => {
        const v = (s.varName || '').toLowerCase();
        return v.includes('amount') || v.includes('value');
      });
      const token = amtStep ? extractToken(amtStep.varName || '') : null;
      const amt = amtStep ? extractAmount(amtStep) : null;
      const path = recipientPath(steps);
      return `${token || 'Token'} transfer${amt ? ' ' + amt : ''}, ${path} recipient`;
    }
    if (types.includes('time') && steps.some((s) =>
      ['account', 'sender', 'discord', 'age'].some((k) => (s.varName || '').toLowerCase().includes(k))
    )) {
      return 'Signatory identity + time check';
    }
    return `${steps.length}-step verification`;
  }

  if (t === 'ecdsa') {
    const src = (cond.message || '').toLowerCase().includes('discord') ? 'Discord ' : '';
    return `${src}ECDSA signature`;
  }
  if (t === 'time') return 'Time window';
  if (t === 'json' || t === 'json-rpc') {
    const q = cond.query || cond.endpoint || '';
    if (q.includes('user.id')) return 'Discord membership check';
    return 'JSON data check';
  }
  if (t === 'signing-attribute') return `Signing: ${cond.attributeName || ''}`;
  if (t === 'signing-abi-attribute') return 'Transaction whitelist';
  if (t === 'jwt') return 'JWT token';
  if (t === 'contract') return 'On-chain check';
  return t || null;
}

// ── Chain label helpers ───────────────────────────────────────────────────────
const CHAIN_LABELS = {
  '1':        'ETH',
  '137':      'POLY',
  '8453':     'BASE',
  '11155111': 'SEPOLIA',
  '84532':    'BASE-SEP',
  '80001':    'MUMBAI',
};

function chainLabel(chainId) {
  return CHAIN_LABELS[String(chainId)] || (chainId ? `chain:${chainId}` : '');
}

// ── Main component ────────────────────────────────────────────────────────────
const SigningCohorts = () => {
  const navigate = useNavigate();
  const [cohorts, setCohorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('id');
  const [sortOrder, setSortOrder] = useState('desc');

  useEffect(() => {
    const fetchCohorts = async () => {
      try {
        const cohortsData = await getSigningCohortsFromSubgraph();

        const transformedCohorts = cohortsData.map((cohort) => {
          const signers = cohort.multisig?.signers?.length
            ? cohort.multisig.signers
            : cohort.signers?.length ? cohort.signers : (cohort.participants || []);
          const decodedCond = decodeConditions(cohort.conditions);
          const conditionRoot = decodedCond?.condition || decodedCond;
          const leafTypes = conditionRoot ? [...collectTypes(conditionRoot)] : [];
          const policySummary = conditionRoot ? summarizeCondition(conditionRoot) : null;

          return {
            id: cohort.id,
            signers,
            signersCount: signers.length,
            threshold: cohort.multisig?.threshold || cohort.threshold || 0,
            isActive: cohort.status === 'DEPLOYED' || cohort.status === 'CONDITIONS_SET',
            state: cohort.status?.replace(/_/g, ' ') || 'Unknown',
            authority: cohort.authority,
            chainId: cohort.chainId,
            isDeployed: cohort.isDeployed,
            deployedAt: cohort.deployedAt,
            multisigAddress: cohort.multisigAddress,
            signatureCount: (cohort.signatures || []).length,
            createdAt: cohort.createdAt,
            executionCount: cohort.multisig?.executionCount || 0,
            totalValue: cohort.multisig?.totalValue || '0',
            lastExecutedAt: cohort.multisig?.lastExecutedAt,
            // Policy data
            hasConditions: !!conditionRoot,
            policySummary,
            leafTypes,
            complexityScore: leafTypes.length,
          };
        });

        // Sort: conditions set first, then by complexity, then by id desc
        transformedCohorts.sort((a, b) => {
          if (a.hasConditions !== b.hasConditions) return a.hasConditions ? -1 : 1;
          if (b.complexityScore !== a.complexityScore) return b.complexityScore - a.complexityScore;
          return parseInt(b.id) - parseInt(a.id);
        });

        setCohorts(transformedCohorts);
      } catch (error) {
        console.error('Error fetching cohorts:', error);
        setCohorts([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCohorts();
  }, []);

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const sortedCohorts = [...cohorts].sort((a, b) => {
    if (sortBy === 'id') {
      const diff = parseInt(a.id) - parseInt(b.id);
      return sortOrder === 'asc' ? diff : -diff;
    }
    if (sortBy === 'signers') {
      return sortOrder === 'asc' ? a.signersCount - b.signersCount : b.signersCount - a.signersCount;
    }
    if (sortBy === 'complexity') {
      return sortOrder === 'asc' ? a.complexityScore - b.complexityScore : b.complexityScore - a.complexityScore;
    }
    if (sortBy === 'executionCount') {
      return sortOrder === 'asc' ? a.executionCount - b.executionCount : b.executionCount - a.executionCount;
    }
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    if (typeof aVal === 'boolean') {
      return sortOrder === 'asc'
        ? (aVal === bVal ? 0 : aVal ? -1 : 1)
        : (aVal === bVal ? 0 : aVal ? 1 : -1);
    }
    return sortOrder === 'asc'
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });

  const sortIndicator = (field) =>
    sortBy === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '';

  if (loading) return <ListSkeleton cols={5} rows={10} />;

  return (
    <div className={styles.signingCohorts}>
      <div className={styles.container}>
        <PageHeader
          title="Signing Cohorts"
          subtitle="Groups of nodes authorized to perform threshold signing operations"
          stats={[
            { label: 'Total', value: cohorts.length },
            { label: 'Active', value: cohorts.filter((c) => c.isActive).length },
            { label: 'Total Signers', value: cohorts.reduce((s, c) => s + c.signersCount, 0) },
            { label: 'With Conditions', value: cohorts.filter((c) => c.hasConditions).length },
            { label: 'Deployed', value: cohorts.filter((c) => c.isDeployed).length },
          ]}
        />

        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => handleSort('id')} className={styles.sortable}>
                  #{sortIndicator('id')}
                </th>
                <th onClick={() => handleSort('complexity')} className={styles.sortable}>
                  Policy / Conditions{sortIndicator('complexity')}
                </th>
                <th onClick={() => handleSort('signers')} className={styles.sortable}>
                  Nodes{sortIndicator('signers')}
                </th>
                <th>Threshold</th>
                <th onClick={() => handleSort('state')} className={styles.sortable}>
                  State{sortIndicator('state')}
                </th>
                <th onClick={() => handleSort('executionCount')} className={styles.sortable}>
                  Execs{sortIndicator('executionCount')}
                </th>
                <th onClick={() => handleSort('createdAt')} className={styles.sortable}>
                  Created{sortIndicator('createdAt')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedCohorts.map((cohort) => (
                <tr
                  key={cohort.id}
                  onClick={() => navigate(`/cohort/${cohort.id}`)}
                  className={`${styles.clickableRow} ${cohort.hasConditions ? styles.hasConditions : ''}`}
                >
                  {/* ID */}
                  <td className={styles.idCell}>{cohort.id}</td>

                  {/* Policy / Conditions */}
                  <td className={styles.policyCell}>
                    {cohort.hasConditions ? (
                      <div className={styles.policyContent}>
                        <div className={styles.typeTags}>
                          {cohort.leafTypes.map((t) => (
                            <span
                              key={t}
                              className={styles.typeTag}
                              style={{ color: TYPE_COLOR[t] || '#999', borderColor: TYPE_COLOR[t] || '#999' }}
                            >
                              {TYPE_LABEL[t] || t}
                            </span>
                          ))}
                          {cohort.complexityScore > 3 && (
                            <span className={styles.complexityHint}>+{cohort.complexityScore - 3} more</span>
                          )}
                        </div>
                        {cohort.policySummary && (
                          <div className={styles.policySummary}>{cohort.policySummary}</div>
                        )}
                      </div>
                    ) : (
                      <span className={styles.noConditions}>No conditions set</span>
                    )}
                  </td>

                  {/* Nodes */}
                  <td className={styles.nodesCell}>
                    <span className={styles.nodeCount}>{cohort.signersCount}</span>
                    <span className={styles.chainIcons}>
                      <ChainIcon chainId="1" size={14} />
                      {cohort.chainId && cohort.chainId !== '1' && (
                        <ChainIcon chainId={cohort.chainId} size={14} />
                      )}
                    </span>
                  </td>

                  {/* Threshold */}
                  <td className={styles.thresholdCell}>
                    {cohort.threshold
                      ? `${cohort.threshold} of ${cohort.signersCount}`
                      : cohort.signersCount
                      ? `— of ${cohort.signersCount}`
                      : '—'}
                  </td>

                  {/* State */}
                  <td className={styles.stateCell}>
                    <span className={`${styles.stateBadge} ${styles['state_' + (cohort.state || '').replace(/\s+/g, '_').toLowerCase()]}`}>
                      {cohort.state || 'Unknown'}
                    </span>
                  </td>

                  {/* Executions */}
                  <td className={styles.numericCell}>
                    {cohort.executionCount > 0 ? (
                      <span className={styles.executionBadge}>{cohort.executionCount}</span>
                    ) : (
                      <span className={styles.zeroValue}>—</span>
                    )}
                  </td>

                  {/* Created */}
                  <td className={styles.ageCell}>
                    {cohort.createdAt
                      ? calculateTimeMoment(parseInt(cohort.createdAt) * 1000)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SigningCohorts;
