import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, MenuItem, Tabs, Tab, Box } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import { reportService, employeeService, departmentService } from '../../services';
import { formatCurrency } from '../../lib/format';
import api from '../../lib/api';

const REPORT_TYPES = [
  { key: 'attendance', label: 'Attendance' },
  { key: 'leave', label: 'Leave' },
  { key: 'salary', label: 'Salary' },
  { key: 'commission', label: 'Commission' },
  { key: 'performance', label: 'Performance' },
];

export default function ReportsPage() {
  const [tab, setTab] = useState(0);
  const reportType = REPORT_TYPES[tab].key;
  const [filters, setFilters] = useState({
    employee: '',
    department: '',
    from: dayjs().startOf('month').format('YYYY-MM-DD'),
    to: dayjs().endOf('month').format('YYYY-MM-DD'),
    month: dayjs().month() + 1,
    year: dayjs().year(),
  });

  const { data: emps } = useQuery({ queryKey: ['emps-all'], queryFn: () => employeeService.list({ limit: 100 }) });
  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: departmentService.list });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['report', reportType, filters],
    queryFn: () => reportService.fetch(reportType, filters),
    enabled: false,
  });

  const downloadXlsx = async () => {
    try {
      const res = await api.get(`/reports/${reportType}`, {
        params: { ...filters, format: 'xlsx' },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportType}-report-${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  const renderTable = () => {
    if (isLoading || isFetching) return <TableSkeleton />;
    const rows = data?.data || [];
    if (!rows.length) return <Empty title="Click 'View' to load report data" />;

    const columns = {
      attendance: ['employee', 'date', 'status', 'clockIn', 'clockOut', 'workMinutes', 'isLate'],
      leave: ['employee', 'type', 'fromDate', 'toDate', 'days', 'status'],
      salary: ['employee', 'month', 'year', 'basicSalary', 'commission', 'netSalary', 'status'],
      commission: ['employee', 'period', 'periodStart', 'periodEnd', 'achievedSales', 'commissionAmount'],
      performance: ['employee', 'type', 'periodStart', 'periodEnd', 'targetValue', 'achievedValue', 'completion'],
    }[reportType];

    return (
      <Box sx={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left' }}>{columns.map((c) => (
            <th key={c} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)', textTransform: 'capitalize' }}>{c}</th>
          ))}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r._id || i} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                {columns.map((c) => {
                  let v = r[c];
                  if (c === 'employee') v = r.employee?.fullName || r.employee || '—';
                  else if (['date', 'fromDate', 'toDate', 'periodStart', 'periodEnd'].includes(c) && v) v = dayjs(v).format('MMM D, YYYY');
                  else if (['clockIn', 'clockOut'].includes(c) && v) v = dayjs(v).format('HH:mm');
                  else if (['basicSalary', 'commission', 'netSalary', 'achievedSales', 'commissionAmount'].includes(c) && v != null) v = formatCurrency(v);
                  else if (c === 'completion' && v != null) v = `${Number(v).toFixed(1)}%`;
                  else if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
                  else if (v == null) v = '—';
                  return <td key={c} style={{ padding: '10px 8px' }}>{String(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    );
  };

  return (
    <>
      <PageHeader title="Reports" subtitle="Generate and export business reports" />
      <Card sx={{ mb: 2 }}><CardContent>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
          {REPORT_TYPES.map((r) => <Tab key={r.key} label={r.label} />)}
        </Tabs>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
          <TextField select label="Employee" size="small" sx={{ minWidth: 200 }} value={filters.employee}
            onChange={(e) => setFilters({ ...filters, employee: e.target.value })}>
            <MenuItem value="">All</MenuItem>
            {(emps?.data || []).map((e) => <MenuItem key={e._id} value={e._id}>{e.fullName}</MenuItem>)}
          </TextField>
          <TextField select label="Department" size="small" sx={{ minWidth: 180 }} value={filters.department}
            onChange={(e) => setFilters({ ...filters, department: e.target.value })}>
            <MenuItem value="">All</MenuItem>
            {(depts?.data || []).map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
          </TextField>
          {reportType === 'salary' ? (
            <>
              <TextField select label="Month" size="small" sx={{ minWidth: 120 }} value={filters.month}
                onChange={(e) => setFilters({ ...filters, month: Number(e.target.value) })}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <MenuItem key={m} value={m}>{dayjs().month(m - 1).format('MMM')}</MenuItem>)}
              </TextField>
              <TextField type="number" label="Year" size="small" sx={{ minWidth: 100 }} value={filters.year}
                onChange={(e) => setFilters({ ...filters, year: Number(e.target.value) })} />
            </>
          ) : (
            <>
              <TextField type="date" label="From" size="small" InputLabelProps={{ shrink: true }} value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
              <TextField type="date" label="To" size="small" InputLabelProps={{ shrink: true }} value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            </>
          )}
          <Button variant="contained" onClick={() => refetch()}>View</Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={downloadXlsx}>Export Excel</Button>
        </Stack>
      </CardContent></Card>

      <Card><CardContent>{renderTable()}</CardContent></Card>
    </>
  );
}
