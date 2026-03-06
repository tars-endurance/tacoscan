import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  getRituals, getNodes, formatRitualsData, formatNodes,
  getTimeout, getLiveRitualIds, calculateTimeMoment, formatString,
  getSigningCohortsFromSubgraph,
} from './data';
import styles from './Dashboard.module.css';
import { SkeletonRows } from '../components/Skeleton';

// ── Status helpers ──────────────────────────────────────────────────────────
const ritualStatusClass = (s) => {
  const u = (s || '').toUpperCase();
  if (u === 'SUCCESSFUL') return styles.status_successful;
  if (u === 'ACTIVE') return styles.status_active;
  if (u.includes('AWAITING')) return styles.status_awaiting;
  if (u === 'EXPIRED') return styles.status_expired;
  if (u.includes('TIME') || u.includes('INVALID') || u.includes('ERROR') || u === 'TIMEOUT') return styles.status_timeout;
  return '';
};

const STATUS_SHORT = {
  SUCCESSFUL: 'OK', ACTIVE: 'Active',
  'DKG AWAITING TRANSCRIPTS': 'Await TX', 'DKG AWAITING AGGREGATIONS': 'Await Agg',
  EXPIRED: 'Expired', 'TIME OUT': 'Timeout', TIMEOUT: 'Timeout',
  'DKG INVALID': 'Invalid', 'DKG ERROR': 'Error',
};

const CHAIN_NAMES = { '1': 'Ethereum', '137': 'Polygon', '8453': 'Base', '11155111': 'Sepolia', '84532': 'Base Sep', '80002': 'Amoy' };
const chainName = (id) => CHAIN_NAMES[String(id)] || `Chain ${id}`;

const cohortStatusClass = (s) => {
  if (!s) return '';
  const u = s.toUpperCase();
  if (u === 'DEPLOYED' || u === 'CONDITIONS_SET') return styles.cohort_active;
  if (u === 'PENDING') return styles.cohort_pending;
  return styles.cohort_inactive;
};

const cohortStatusLabel = (s) => (s || '').replace(/_/g, ' ');

// ── Heatmap ──────────────────────────────────────────────────────────────────
const HEATMAP_COLOR = {
  SUCCESSFUL: '#22c55e', ACTIVE: '#4ade80',
  'DKG AWAITING TRANSCRIPTS': '#f59e0b', 'DKG AWAITING AGGREGATIONS': '#f59e0b',
  EXPIRED: '#f97316', 'TIME OUT': '#dc2626', TIMEOUT: '#dc2626',
  'DKG INVALID': '#dc2626', 'DKG ERROR': '#dc2626',
};

function RitualHeatmap({ rituals }) {
  const wrapRef = useRef(null);
  const [cols, setCols] = useState(80);
  const ROWS = 8, SQ = 5, GAP = 2, STRIDE = 7;

  useEffect(() => {
    if (!wrapRef.current) return;
    const update = () => setCols(Math.max(1, Math.floor((wrapRef.current.offsetWidth + GAP) / STRIDE)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const total = ROWS * cols;
  const sorted = [...rituals].sort((a, b) => (a.initTimeStamp || 0) - (b.initTimeStamp || 0)).slice(-total);
  const svgW = cols * STRIDE - GAP;
  const svgH = ROWS * STRIDE - GAP;
  const getColor = (s) => HEATMAP_COLOR[(s || '').toUpperCase()] || '#d1d5db';
  const offset = total - sorted.length;

  return (
    <div ref={wrapRef} className={styles.heatmapSvgWrap}>
      <svg width="100%" height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="xMinYMid meet" style={{ display: 'block' }}>
        {sorted.map((r, idx) => {
          const pos = offset + idx;
          const ageRatio = idx / Math.max(sorted.length - 1, 1);
          return (
            <rect key={r.id} x={(pos % cols) * STRIDE} y={Math.floor(pos / cols) * STRIDE}
              width={SQ} height={SQ} rx={1} fill={getColor(r.status)}
              opacity={0.25 + ageRatio * 0.65} style={{ cursor: 'pointer' }}
              onClick={() => window.location.href = `/rituals/${r.id}`}>
              <title>#{r.id} · {r.status} · {r.totalParticipants} nodes</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cohortsLoading, setCohortsLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [recentRituals, setRecentRituals] = useState([]);
  const [allRituals, setAllRituals] = useState([]);
  const [recentHeartbeats, setRecentHeartbeats] = useState([]);
  const [recentCohorts, setRecentCohorts] = useState([]);
  const [cohortStats, setCohortStats] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [ritualsData, nodesData, timeout, liveIds] = await Promise.all([
          getRituals(false, ''),
          getNodes(false, ''),
          getTimeout(),
          getLiveRitualIds().catch(() => new Set()),
        ]);
        const rawRituals = ritualsData?.rituals || [];
        const formatted = formatRitualsData(rawRituals, timeout, liveIds);
        const regular = formatted.filter(r => !r.isHeartbeat);
        const successful = regular.filter(r => r.status === 'SUCCESSFUL' || r.status === 'ACTIVE').length;
        const { nodes } = await formatNodes(nodesData?.appAuthorizations || []);
        setStats({
          totalNodes: nodes.length,
          confirmedNodes: nodes.filter(n => n.isOperatorConfirmed).length,
          regularRituals: regular.length,
          successRate: regular.length > 0 ? ((successful / regular.length) * 100).toFixed(1) : '0',
        });
        setAllRituals(formatted);
        setRecentRituals(regular.slice(0, 12));
        setRecentHeartbeats(formatted.filter(r => r.isHeartbeat).slice(0, 8));
      } catch (err) {
        console.error('Dashboard rituals:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cohorts = await getSigningCohortsFromSubgraph();
        const deployed = cohorts.filter(c => c.status === 'DEPLOYED' || c.status === 'CONDITIONS_SET').length;
        const withConditions = cohorts.filter(c => c.conditions && c.conditions !== '0x').length;
        const totalSignatures = cohorts.reduce((sum, c) => sum + (c.signatures?.length || 0), 0);
        setCohortStats({ total: cohorts.length, deployed, withConditions, totalSignatures });
        setRecentCohorts(cohorts.slice(0, 12));
      } catch (err) {
        console.error('Dashboard cohorts:', err);
      } finally {
        setCohortsLoading(false);
      }
    })();
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* ── Hero ── */}
        <div className={styles.hero}>
          <div className={styles.accentBar}>
            {!loading && stats && (
              <div className={styles.accentFill} style={{ width: `${stats.successRate}%` }} />
            )}
          </div>

          <div className={styles.heroTop}>
            <div className={styles.heroTitleGroup}>
              <span className={styles.heroNet}>TACo Network</span>
              <span className={styles.statusPill}>● Operational</span>
            </div>
            <div className={styles.heroStats}>
              {loading ? (
                [60, 80, 64].map((w, i) => (
                  <span key={i} className={styles.shimmer} style={{ width: w, height: 20, borderRadius: 3 }} />
                ))
              ) : stats && (<>
                <div className={styles.heroStat}>
                  <span className={styles.heroVal}>{stats.totalNodes}</span>
                  <span className={styles.heroLbl}>nodes</span>
                </div>
                <div className={styles.heroDivider} />
                <div className={styles.heroStat}>
                  <span className={styles.heroVal}>{stats.regularRituals.toLocaleString()}</span>
                  <span className={styles.heroLbl}>rituals</span>
                </div>
                <div className={styles.heroDivider} />
                <div className={styles.heroStat}>
                  <span className={`${styles.heroVal} ${styles.heroValGreen}`}>{stats.successRate}%</span>
                  <span className={styles.heroLbl}>success</span>
                </div>
                {cohortStats && cohortStats.totalSignatures > 0 && (<>
                  <div className={styles.heroDivider} />
                  <div className={styles.heroStat}>
                    <span className={`${styles.heroVal} ${styles.heroValGreen}`}>
                      {cohortStats.totalSignatures.toLocaleString()}
                    </span>
                    <span className={styles.heroLbl}>signatures</span>
                  </div>
                </>)}
              </>)}
            </div>
          </div>

          {loading ? (
            <div className={styles.shimmer} style={{ height: 58, borderRadius: 4, display: 'block', width: '100%' }} />
          ) : (
            <>
              <RitualHeatmap rituals={allRituals} />
              <div className={styles.heatmapLegend}>
                {[['#22c55e','Successful'],['#f59e0b','Pending'],['#dc2626','Failed']].map(([color, label]) => (
                  <span key={label} className={styles.legendItem}>
                    <svg width={7} height={7} style={{ flexShrink: 0 }}>
                      <rect width={7} height={7} rx={1} fill={color} opacity={0.85} />
                    </svg>
                    {label}
                  </span>
                ))}
                <span className={styles.legendRight}>← older · newer →</span>
              </div>
            </>
          )}
        </div>

        {/* ── Main grid: Rituals + Cohorts + Explore ── */}
        <div className={styles.mainGrid}>

          {/* Recent DKG Rituals */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>Recent DKG Rituals</span>
              <Link to="/rituals" className={styles.viewAll}>View all →</Link>
            </div>
            <table className={styles.table}>
              <thead><tr><th>#</th><th>Status</th><th>Authority</th><th>Nodes</th><th>Age</th></tr></thead>
              <tbody>
                {loading ? <SkeletonRows rows={8} cols={5} /> : recentRituals.map(r => (
                  <tr key={r.id} className={styles.clickableRow} onClick={() => navigate(`/rituals/${r.id}`)}>
                    <td className={styles.idCell}>{r.id}</td>
                    <td><span className={`${styles.statusBadge} ${ritualStatusClass(r.status)}`}>{STATUS_SHORT[r.status] || r.status}</span></td>
                    <td className={styles.addrCell}>{formatString(r.authority)}</td>
                    <td className={styles.numCell}>{r.totalParticipants}</td>
                    <td className={styles.ageCell}>{calculateTimeMoment(r.updateTime)}</td>
                  </tr>
                ))}
                {!loading && recentRituals.length === 0 && (
                  <tr><td colSpan={5} className={styles.emptyRow}>No rituals found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Signing Cohorts */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardHeaderLeft}>
                <span className={styles.cardTitle}>Signing Cohorts</span>
                {cohortStats && (
                  <span className={styles.cardMeta}>
                    {cohortStats.deployed} deployed · {cohortStats.withConditions} with conditions
                  </span>
                )}
              </div>
              <Link to="/cohorts" className={styles.viewAll}>View all →</Link>
            </div>
            <table className={styles.table}>
              <thead><tr><th>ID</th><th>Status</th><th>Threshold</th><th>Chain</th><th>Age</th></tr></thead>
              <tbody>
                {cohortsLoading ? <SkeletonRows rows={8} cols={5} /> : recentCohorts.map(c => {
                  const signers = c.multisig?.signers?.length || c.signers?.length || c.participants?.length || 0;
                  const threshold = c.multisig?.threshold || c.threshold || 0;
                  return (
                    <tr key={c.id} className={styles.clickableRow} onClick={() => navigate(`/cohort/${c.id}`)}>
                      <td className={styles.idCell}>#{c.id}</td>
                      <td><span className={`${styles.statusBadge} ${cohortStatusClass(c.status)}`}>{cohortStatusLabel(c.status)}</span></td>
                      <td className={styles.dimCell}>{threshold ? `${threshold} of ${signers}` : `— of ${signers}`}</td>
                      <td className={styles.chainCell}>{chainName(c.chainId)}</td>
                      <td className={styles.ageCell}>{c.createdAt ? calculateTimeMoment(parseInt(c.createdAt) * 1000) : '—'}</td>
                    </tr>
                  );
                })}
                {!cohortsLoading && recentCohorts.length === 0 && (
                  <tr><td colSpan={5} className={styles.emptyRow}>No cohorts found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Recent Heartbeats */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>Recent Heartbeats</span>
              <Link to="/heartbeats" className={styles.viewAll}>View all →</Link>
            </div>
            <table className={styles.table}>
              <thead><tr><th>#</th><th>Status</th><th>Nodes</th><th>Age</th></tr></thead>
              <tbody>
                {loading ? <SkeletonRows rows={6} cols={4} /> : recentHeartbeats.map(r => (
                  <tr key={r.id} className={styles.clickableRow} onClick={() => navigate(`/rituals/${r.id}`)}>
                    <td className={styles.idCell}>{r.id}</td>
                    <td><span className={`${styles.statusBadge} ${ritualStatusClass(r.status)}`}>{STATUS_SHORT[r.status] || r.status}</span></td>
                    <td className={styles.numCell}>{r.totalParticipants}</td>
                    <td className={styles.ageCell}>{calculateTimeMoment(r.updateTime)}</td>
                  </tr>
                ))}
                {!loading && recentHeartbeats.length === 0 && (
                  <tr><td colSpan={4} className={styles.emptyRow}>No heartbeats found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Explore */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>Explore</span>
            </div>
            <div className={styles.sectionLinks}>
              {[
                { path: '/nodes',       label: 'Node Operators',   desc: 'Authorized staking providers' },
                { path: '/cohorts',     label: 'Signing Cohorts',  desc: 'Threshold signing groups' },
                { path: '/heartbeats',  label: 'Heartbeats',       desc: 'Weekly DKG health checks' },
                { path: '/rewards',     label: 'Rewards',          desc: 'T token distributions' },
                { path: '/infractions', label: 'Infractions',      desc: 'Missed transcripts & penalties' },
                { path: '/activity',    label: 'Protocol Events',  desc: 'Cross-chain event feed' },
              ].map(s => (
                <Link key={s.path} to={s.path} className={styles.sectionLink}>
                  <span className={styles.sectionLinkLabel}>{s.label}</span>
                  <span className={styles.sectionLinkDesc}>{s.desc}</span>
                  <span className={styles.sectionLinkArrow}>→</span>
                </Link>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Dashboard;
