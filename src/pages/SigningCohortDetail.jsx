import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import styles from "./SigningCohortDetail.module.css";
import { formatString, formatDate, calculateTimeMoment, formatTimeToText, getSigningCohortDetail, getOpExecutionsByDomain } from "./data";
import ConditionRenderer from "../components/ConditionRenderer";
import ChainIcon from "../components/ChainIcon";
import { PageSkeleton } from "../components/Skeleton";

// ── Chain helpers ─────────────────────────────────────────────────────────────
const CHAIN_NAMES = {
  '1':        'Ethereum',
  '137':      'Polygon',
  '8453':     'Base',
  '11155111': 'Sepolia',
  '84532':    'Base Sepolia',
  '80001':    'Mumbai',
  '80002':    'Polygon Amoy',
};
const chainName = (id) => CHAIN_NAMES[String(id)] || `Chain ${id}`;

// ── Tiny address helper ───────────────────────────────────────────────────────
const short = (addr) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';

// ── Decode hex conditions ─────────────────────────────────────────────────────
function decodeConditions(hex) {
  if (!hex || hex === '0x') return null;
  try {
    const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(raw.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

// ── KV row (compact label + value) ───────────────────────────────────────────
function KV({ label, children, mono }) {
  return (
    <div className={styles.kv}>
      <span className={styles.kvLabel}>{label}</span>
      <span className={`${styles.kvValue} ${mono ? styles.kvMono : ''}`}>{children}</span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const SigningCohortDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cohort, setCohort] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("signatories");
  const [showRawJson, setShowRawJson] = useState(false);
  const [opExecutions, setOpExecutions] = useState([]);

  useEffect(() => {
    const fetchCohortDetails = async () => {
      try {
        const cohortData = await getSigningCohortDetail(id);
        if (!cohortData) { setError("Cohort not found"); return; }

        const resolvedSigners = cohortData.signers?.length
          ? cohortData.signers
          : (cohortData.participants || []);

        const conditionsDecoded = decodeConditions(cohortData.conditions);

        setCohort({
          id: cohortData.id,
          signers: resolvedSigners.map(addr => ({ address: addr })),
          signersCount: resolvedSigners.length,
          threshold: cohortData.multisig?.threshold || cohortData.threshold || 0,
          isActive: cohortData.status === 'DEPLOYED' || cohortData.status === 'CONDITIONS_SET',
          state: cohortData.status?.replace(/_/g, ' ') || 'Unknown',
          authority: cohortData.authority,
          chainId: cohortData.chainId,
          domain: cohortData.domain,
          isDeployed: cohortData.isDeployed,
          deployedAt: cohortData.deployedAt,
          multisigAddress: cohortData.multisigAddress,
          signatures: cohortData.signatures || [],
          multisig: cohortData.multisig,
          createdAt: cohortData.createdAt,
          updatedAt: cohortData.updatedAt,
          conditionsRaw: cohortData.conditions,
          conditionsDecoded,
        });

        if (cohortData.domain) {
          const opExecs = await getOpExecutionsByDomain(cohortData.domain);
          setOpExecutions(opExecs);
        }
      } catch (e) {
        console.error("Error fetching cohort details:", e);
        setError("Failed to load cohort details");
      } finally {
        setLoading(false);
      }
    };
    fetchCohortDetails();
  }, [id]);

  if (loading) return <PageSkeleton />;

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBox}>
          <span>{error}</span>
          <button onClick={() => navigate("/cohorts")} className={styles.backBtn}>← Back</button>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: 'signatories', label: 'Signatories', count: cohort?.signatures?.length },
    { key: 'multisig',    label: 'Multisig',    count: cohort?.multisig?.executionCount || null },
    { key: 'executions',  label: 'Executions',  count: opExecutions.length || null },
    { key: 'raw',         label: 'Raw JSON',    count: null },
  ];

  const conditionData = cohort?.conditionsDecoded;

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* ── Compact header ─────────────────────────────────────────────── */}
        <div className={styles.headerRow}>
          <div className={styles.breadcrumb}>
            <a href="/cohorts" className={styles.breadLink}>Signing Cohorts</a>
            <span className={styles.sep}>/</span>
            <span className={styles.breadCurrent}>Cohort #{id}</span>
          </div>
          <div className={styles.headerMeta}>
            <span className={`${styles.statePill} ${styles['state_' + (cohort?.state || '').replace(/\s+/g, '_').toLowerCase()]}`}>
              {cohort?.state}
            </span>
            <span className={styles.metaDot}>·</span>
            <span className={styles.metaItem}>
              {cohort?.threshold
                ? `${cohort.threshold} of ${cohort.signersCount}`
                : `— of ${cohort?.signersCount}`}
            </span>
            <span className={styles.metaDot}>·</span>
            <span className={styles.metaItem}><ChainIcon chainId={cohort?.chainId} size={14} showLabel /></span>
            {cohort?.createdAt && (
              <>
                <span className={styles.metaDot}>·</span>
                <span className={styles.metaAge}>{calculateTimeMoment(parseInt(cohort.createdAt) * 1000)}</span>
              </>
            )}
          </div>
        </div>

        {/* ── Three-column info grid ──────────────────────────────────────── */}
        <div className={styles.infoGrid}>

          {/* Col A: Identity */}
          <div className={styles.infoCard}>
            <div className={styles.infoCardTitle}>Identity</div>
            <KV label="ID">{cohort?.id}</KV>
            <KV label="Chain"><ChainIcon chainId={cohort?.chainId} size={14} showLabel /> <span className={styles.chainId}>({cohort?.chainId})</span></KV>
            {cohort?.domain && <KV label="Domain" mono>{short(cohort.domain)}</KV>}
            {cohort?.authority && (
              <KV label="Authority" mono>
                <a href={`/address/${cohort.authority}`} className={styles.addrLink}>{short(cohort.authority)}</a>
              </KV>
            )}
            {cohort?.multisigAddress && (
              <KV label="Multisig" mono>
                <a href={`https://basescan.org/address/${cohort.multisigAddress}`} target="_blank" rel="noopener noreferrer" className={styles.addrLink}>
                  {short(cohort.multisigAddress)}
                </a>
              </KV>
            )}
            <KV label="Deployed">{cohort?.isDeployed ? 'Yes' : 'No'}</KV>
            {cohort?.deployedAt && (
              <KV label="Deployed at" mono>{calculateTimeMoment(parseInt(cohort.deployedAt) * 1000)}</KV>
            )}
            {cohort?.createdAt && (
              <KV label="Created">{calculateTimeMoment(parseInt(cohort.createdAt) * 1000)}</KV>
            )}
          </div>

          {/* Col B: Conditions */}
          <div className={`${styles.infoCard} ${styles.condCard}`}>
            <div className={styles.infoCardTitle}>
              Conditions
              {conditionData && (
                <button className={styles.jsonToggleSmall} onClick={() => setShowRawJson(v => !v)}>
                  {showRawJson ? 'formatted' : 'JSON'}
                </button>
              )}
            </div>
            {conditionData ? (
              showRawJson ? (
                <pre className={styles.jsonPre}>{JSON.stringify(conditionData, null, 2)}</pre>
              ) : (
                <ConditionRenderer conditionData={conditionData} />
              )
            ) : (
              <span className={styles.dimText}>No conditions set</span>
            )}
          </div>
        </div>

        {/* ── Activity tabs ───────────────────────────────────────────────── */}
        <div className={styles.tabs}>
          {tabs.map(t => (
            <button
              key={t.key}
              className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
              {t.count > 0 && <span className={styles.tabBadge}>{t.count}</span>}
            </button>
          ))}
        </div>

        <div className={styles.tabBody}>

          {/* Signatories */}
          {activeTab === 'signatories' && (
            cohort?.signatures?.length > 0 ? (
              <table className={styles.table}>
                <thead><tr>
                  <th>#</th>
                  <th>Provider</th>
                  <th>Signer</th>
                  <th>Time</th>
                  <th>Tx</th>
                </tr></thead>
                <tbody>
                  {cohort.signatures.map((sig, idx) => (
                    <tr key={idx}>
                      <td className={styles.idxCell}>{idx + 1}</td>
                      <td>
                        <a href={`/address/${sig.provider}`} className={styles.addrLink}>{formatString(sig.provider)}</a>
                      </td>
                      <td className={styles.monoCell}>{formatString(sig.signer)}</td>
                      <td className={styles.ageCell}>{sig.timestamp ? formatTimeToText(parseInt(sig.timestamp) * 1000) : '—'}</td>
                      <td>
                        {sig.transactionHash ? (
                          <a href={`https://basescan.org/tx/${sig.transactionHash}`} target="_blank" rel="noopener noreferrer" className={styles.addrLink}>
                            {formatString(sig.transactionHash)}
                          </a>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className={styles.emptyTab}>No signatures recorded</div>
          )}

          {/* Multisig */}
          {activeTab === 'multisig' && (
            cohort?.multisig ? (
              <>
                <div className={styles.multisigMeta}>
                  <KV label="Clone address" mono>
                    <a href={`https://basescan.org/address/${cohort.multisig.id}`} target="_blank" rel="noopener noreferrer" className={styles.addrLink}>
                      {cohort.multisig.id}
                    </a>
                  </KV>
                  <KV label="Threshold">{cohort.multisig.threshold} of {cohort.multisig.signers?.length || cohort.signersCount}</KV>
                  <KV label="Executions">{cohort.multisig.executionCount}</KV>
                  <KV label="Total value">{cohort.multisig.totalValue || '0'}</KV>
                  <KV label="Cleared">{cohort.multisig.isCleared ? 'Yes' : 'No'}</KV>
                  {cohort.multisig.lastExecutedAt && (
                    <KV label="Last exec">{formatTimeToText(parseInt(cohort.multisig.lastExecutedAt) * 1000)}</KV>
                  )}
                </div>

                {cohort.multisig.executions?.length > 0 ? (
                  <table className={styles.table} style={{ marginTop: 12 }}>
                    <thead><tr>
                      <th>Nonce</th><th>From</th><th>Target</th><th>Value</th><th>Gas</th><th>Time</th><th>Tx</th>
                    </tr></thead>
                    <tbody>
                      {cohort.multisig.executions.map((exec, idx) => (
                        <tr key={idx}>
                          <td className={styles.idxCell}>{exec.nonce}</td>
                          <td><a href={`https://basescan.org/address/${exec.sender}`} target="_blank" rel="noopener noreferrer" className={styles.addrLink}>{formatString(exec.sender)}</a></td>
                          <td><a href={`https://basescan.org/address/${exec.destination}`} target="_blank" rel="noopener noreferrer" className={styles.addrLink}>{formatString(exec.destination)}</a></td>
                          <td>{exec.value || '0'}</td>
                          <td className={styles.dimCell}>{exec.gasUsed || '—'}</td>
                          <td className={styles.ageCell}>{exec.timestamp ? formatTimeToText(parseInt(exec.timestamp) * 1000) : '—'}</td>
                          <td>{exec.transactionHash ? <a href={`https://basescan.org/tx/${exec.transactionHash}`} target="_blank" rel="noopener noreferrer" className={styles.addrLink}>{formatString(exec.transactionHash)}</a> : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div className={styles.emptyTab}>No executions recorded</div>}
              </>
            ) : <div className={styles.emptyTab}>No multisig deployed for this cohort</div>
          )}

          {/* Op Executions */}
          {activeTab === 'executions' && (
            opExecutions.length > 0 ? (
              <table className={styles.table}>
                <thead><tr>
                  <th>Target</th><th>Result</th><th>Gas</th><th>Time</th><th>Tx</th>
                </tr></thead>
                <tbody>
                  {opExecutions.map((exec, idx) => (
                    <tr key={idx}>
                      <td><a href={`https://basescan.org/address/${exec.target}`} target="_blank" rel="noopener noreferrer" className={styles.addrLink}>{formatString(exec.target)}</a></td>
                      <td>
                        <span className={`${styles.resultBadge} ${exec.result === 'true' || exec.result === '1' ? styles.resultOk : styles.resultFail}`}>
                          {exec.result === 'true' || exec.result === '1' ? 'ok' : exec.result || '?'}
                        </span>
                      </td>
                      <td className={styles.dimCell}>{exec.gasUsed || '—'}</td>
                      <td className={styles.ageCell}>{exec.timestamp ? formatTimeToText(parseInt(exec.timestamp) * 1000) : '—'}</td>
                      <td>{exec.transactionHash ? <a href={`https://basescan.org/tx/${exec.transactionHash}`} target="_blank" rel="noopener noreferrer" className={styles.addrLink}>{formatString(exec.transactionHash)}</a> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className={styles.emptyTab}>No op executions found for this cohort's domain</div>
          )}

          {/* Raw JSON */}
          {activeTab === 'raw' && (
            cohort?.conditionsRaw && cohort.conditionsRaw !== '0x' ? (
              <div className={styles.rawSection}>
                <div className={styles.rawLabel}>conditions hex</div>
                <pre className={styles.jsonPre}>{JSON.stringify(cohort.conditionsDecoded, null, 2)}</pre>
              </div>
            ) : <div className={styles.emptyTab}>No conditions data</div>
          )}

        </div>

        <div className={styles.footer}>
          <button onClick={() => navigate("/cohorts")} className={styles.backBtn}>← Signing Cohorts</button>
        </div>
      </div>
    </div>
  );
};

export default SigningCohortDetail;
