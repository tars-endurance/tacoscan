import React, {useState, useEffect, useMemo} from "react";
import { useNavigate } from 'react-router-dom';
import * as Data from "../data";
import styles from './styles.module.css'
import PageHeader from '../../components/PageHeader'
import { SkeletonRows } from '../../components/Skeleton'

const RitualPage = ({network = 'polygon', isSearch = false, searchInput = ''} = {}) => {
    const [pageData, setPageData] = useState({
        rowData: [],
        isLoading: false,
        pageNumber: 1,
        ritualCounter: {},
    });
    const [statusFilter, setStatusFilter] = useState('successful');
    const navigate = useNavigate();
    const [sortBy, setSortBy] = useState('id');
    const [sortOrder, setSortOrder] = useState('desc');

    const handleSort = (field) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('desc');
        }
    };
    const sortInd = (field) => sortBy === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '';

    const STATUS_SHORT = {
        'SUCCESSFUL':                'Successful',
        'ACTIVE':                    'Active',
        'DKG AWAITING TRANSCRIPTS':  'Awaiting TX',
        'DKG AWAITING AGGREGATIONS': 'Awaiting Agg',
        'EXPIRED':                   'Expired',
        'TIME OUT':                  'Time Out',
        'DKG INVALID':               'Invalid',
        'DKG ERROR':                 'Error',
        'TIMEOUT':                   'Timeout',
    };
    const statusClass = (status) => {
        const s = (status || '').toUpperCase();
        if (s === 'SUCCESSFUL') return styles.status_successful;
        if (s === 'ACTIVE') return styles.status_active;
        if (s.includes('AWAITING')) return styles.status_awaiting;
        if (s === 'EXPIRED') return styles.status_expired;
        if (s.includes('TIME') || s.includes('INVALID') || s.includes('ERROR') || s === 'TIMEOUT') return styles.status_timeout;
        return '';
    };

    const sortedData = useMemo(() => {
        const d = [...pageData.rowData];
        d.sort((a, b) => {
            let aVal, bVal;
            switch (sortBy) {
                case 'id':           aVal = parseInt(a.id); bVal = parseInt(b.id); break;
                case 'participants': aVal = a.totalParticipants; bVal = b.totalParticipants; break;
                case 'transcripts':  aVal = a.totalPostedTranscripts; bVal = b.totalPostedTranscripts; break;
                case 'aggregations': aVal = a.totalPostedAggregations; bVal = b.totalPostedAggregations; break;
                case 'updateTime':   aVal = a.updateTime; bVal = b.updateTime; break;
                default: {
                    const av = String(a[sortBy] || ''), bv = String(b[sortBy] || '');
                    return sortOrder === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
                }
            }
            const diff = aVal - bVal;
            return sortOrder === 'asc' ? diff : -diff;
        });
        return d;
    }, [pageData.rowData, sortBy, sortOrder]);

    useEffect(() => {
        setPageData((prevState) => ({
            ...prevState,
            rowData: [],
            ritualCounter: {},
            isLoading: true,
        }));

        Data.getRituals(isSearch, searchInput).then(async (info) => {
            if(info?.rituals === undefined){
                setPageData({
                    isLoading: false,
                    rowData: [],
                    ritualCounter: {},
                });
            } else {
                const [timeout, liveRitualIds] = await Promise.all([
                    Data.getTimeout(),
                    Data.getLiveRitualIds().catch(() => new Set()),
                ]);
                const formattedData = Data.formatRitualsData(info.rituals, timeout, liveRitualIds);

                // Filter out heartbeats (they have their own page)
                let filteredData = formattedData.filter(ritual => !ritual.isHeartbeat);

                // Apply status filter
                if (statusFilter !== 'all') {
                    switch (statusFilter) {
                        case 'successful':
                            filteredData = filteredData.filter(r => r.status === 'SUCCESSFUL' || r.status === 'ACTIVE');
                            break;
                        case 'pending':
                            filteredData = filteredData.filter(r =>
                                r.status === 'DKG AWAITING TRANSCRIPTS' ||
                                r.status === 'DKG AWAITING AGGREGATIONS'
                            );
                            break;
                        case 'failed':
                            filteredData = filteredData.filter(r =>
                                r.status === 'DKG INVALID' ||
                                r.status === 'DKG ERROR' ||
                                r.status === 'TIMEOUT' ||
                                r.status === 'EXPIRED' ||
                                r.status === 'TIME OUT'
                            );
                            break;
                    }
                }

                // Calculate counts for display (non-heartbeat only)
                const dataForCounts = formattedData.filter(r => !r.isHeartbeat);

                const successfulCount = dataForCounts.filter(r =>
                    r.status === 'SUCCESSFUL' || r.status === 'ACTIVE'
                ).length;

                const pendingCount = dataForCounts.filter(r =>
                    r.status === 'DKG AWAITING TRANSCRIPTS' ||
                    r.status === 'DKG AWAITING AGGREGATIONS'
                ).length;

                const failedCount = dataForCounts.filter(r =>
                    r.status === 'TIME OUT' ||
                    r.status === 'EXPIRED' ||
                    r.status === 'DKG INVALID' ||
                    r.status === 'DKG ERROR' ||
                    r.status === 'TIMEOUT'
                ).length;

                const totalCount = dataForCounts.length;

                setPageData({
                    isLoading: false,
                    rowData: filteredData,
                    ritualCounter: {
                        total: totalCount,
                        successful: successfulCount,
                        pending: pendingCount,
                        failed: failedCount
                    },
                });
            }

        }).catch((err) => {
            console.error('Failed to load rituals:', err);
            setPageData({ isLoading: false, rowData: [], ritualCounter: {} });
        });

    }, [network, isSearch, statusFilter]);

    // Component to display heartbeat groups
    // Shared filter button style factory
    const filterBtn = (active) => ({
        padding: '4px 10px',
        background: active ? 'var(--accent-green)' : 'var(--bg-secondary)',
        color: active ? '#000000' : 'var(--text-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: active ? 600 : 500,
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
        transition: 'background 0.15s ease, color 0.15s ease',
        whiteSpace: 'nowrap'
    });

    return (
        <div style={{
            background: 'var(--bg-primary)',
            minHeight: '100vh',
            paddingBottom: '60px'
        }}>
            <div style={{
                maxWidth: '1600px',
                margin: '0 auto',
                padding: '16px 20px'
            }}>

                <PageHeader
                    title={isSearch ? `Search: ${searchInput}` : 'DKG Rituals'}
                    subtitle={isSearch ? undefined : 'Distributed key generation ceremonies for threshold decryption'}
                    stats={[
                        { label: 'Total',      value: pageData.isLoading ? '—' : (pageData.ritualCounter?.total      ?? 0) },
                        { label: 'Successful', value: pageData.isLoading ? '—' : (pageData.ritualCounter?.successful ?? 0) },
                        { label: 'Pending',    value: pageData.isLoading ? '—' : (pageData.ritualCounter?.pending    ?? 0) },
                        { label: 'Failed',     value: pageData.isLoading ? '—' : (pageData.ritualCounter?.failed     ?? 0) },
                    ]}
                />

                {/* Filters row */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                    flexWrap: 'wrap',
                    gap: '8px'
                }}>
                    {/* Left: status filter buttons */}
                    <div style={{
                        display: 'flex',
                        gap: '6px',
                        flexWrap: 'wrap',
                        alignItems: 'center'
                    }}>
                        <button
                            onClick={() => setStatusFilter('all')}
                            style={filterBtn(statusFilter === 'all')}
                        >
                            All ({pageData.ritualCounter?.total ?? 0})
                        </button>
                        <button
                            onClick={() => setStatusFilter('successful')}
                            style={filterBtn(statusFilter === 'successful')}
                        >
                            Successful ({pageData.ritualCounter?.successful ?? 0})
                        </button>
                        <button
                            onClick={() => setStatusFilter('pending')}
                            style={filterBtn(statusFilter === 'pending')}
                        >
                            Pending ({pageData.ritualCounter?.pending ?? 0})
                        </button>
                        <button
                            onClick={() => setStatusFilter('failed')}
                            style={filterBtn(statusFilter === 'failed')}
                        >
                            Failed ({pageData.ritualCounter?.failed ?? 0})
                        </button>
                    </div>

                </div>

                <div className={styles.tableContainer}>
                    <table className={styles.ritualTable}>
                        <thead>
                            <tr>
                                <th onClick={() => handleSort('id')} className={styles.sortable}>#{ sortInd('id')}</th>
                                <th onClick={() => handleSort('authority')} className={styles.sortable}>Authority{sortInd('authority')}</th>
                                <th onClick={() => handleSort('participants')} className={styles.sortable}>Participants{sortInd('participants')}</th>
                                <th onClick={() => handleSort('transcripts')} className={styles.sortable}>Transcripts{sortInd('transcripts')}</th>
                                <th onClick={() => handleSort('aggregations')} className={styles.sortable}>Aggregations{sortInd('aggregations')}</th>
                                <th onClick={() => handleSort('status')} className={styles.sortable}>Status{sortInd('status')}</th>
                                <th onClick={() => handleSort('updateTime')} className={styles.sortable}>Updated{sortInd('updateTime')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pageData.isLoading ? (
                                <SkeletonRows rows={10} cols={7} />
                            ) : sortedData.length === 0 ? (
                                <tr><td colSpan={7} className={styles.tableEmpty}>No rituals</td></tr>
                                ) : sortedData.map((ritual) => (
                                    <tr
                                        key={ritual.id}
                                        className={styles.clickableRow}
                                        onClick={() => navigate(`/rituals/${ritual.id}`)}
                                    >
                                        <td className={styles.ritualIdCell}>{ritual.id}</td>
                                        <td className={styles.addrCell}>{Data.formatString(ritual.authority)}</td>
                                        <td className={styles.numCell}>{ritual.totalParticipants}</td>
                                        <td className={ritual.totalPostedTranscripts === ritual.totalParticipants ? styles.progressFull : styles.progressPartial}>
                                            {ritual.totalPostedTranscripts} / {ritual.totalParticipants}
                                        </td>
                                        <td className={ritual.totalPostedAggregations === ritual.totalParticipants ? styles.progressFull : styles.progressPartial}>
                                            {ritual.totalPostedAggregations} / {ritual.totalParticipants}
                                        </td>
                                        <td>
                                            <span className={`${styles.statusBadge} ${statusClass(ritual.status)}`}>
                                                {STATUS_SHORT[ritual.status] || ritual.status}
                                            </span>
                                        </td>
                                        <td className={styles.dimCell}>{Data.calculateTimeMoment(ritual.updateTime)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

            </div>
        </div>
    );
}

export default RitualPage;
