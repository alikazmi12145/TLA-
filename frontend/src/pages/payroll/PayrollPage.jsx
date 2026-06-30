import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, MenuItem, Chip, Box, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import useSettingsPermissions from '../../hooks/useSettingsPermissions';
import { payrollService } from '../../services';
import { formatCurrency } from '../../lib/format';
import api from '../../lib/api';
import GeneratePayrollDialog from './GeneratePayrollDialog';

export default function PayrollPage() {
  const { canAccess } = useSettingsPermissions();
  const canWrite = canAccess('payroll', 'manage');
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ month: '', year: '' }); // '' = "All"
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const queryParams = {
    ...(filters.month ? { month: filters.month } : {}),
    ...(filters.year ? { year: filters.year } : {}),
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['payrolls', queryParams],
    queryFn: () => payrollService.list(queryParams),
    staleTime: 0,
  });

  const defaultMonth = dayjs().month() + 1;
  const defaultYear = dayjs().year();

  const onBulk = async () => {
    const month = filters.month || defaultMonth;
    const year = filters.year || defaultYear;
    try { await payrollService.generateBulk({ month, year }); toast.success('Bulk payroll generated'); qc.invalidateQueries({ queryKey: ['payrolls'] }); setBulkOpen(false); }
    catch {}
  };

  const downloadPayslip = async (id) => {
    try {
      const res = await api.get(`/payroll/${id}/payslip`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `payslip-${id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle={
          data?.data
            ? `${data.data.length} record${data.data.length === 1 ? '' : 's'}${filters.month || filters.year ? ' for selected period' : ' (all periods)'}`
            : ''
        }
        actions={
          canWrite ? (
            <>
              <Button variant="outlined" onClick={() => setBulkOpen(true)}>Generate Bulk</Button>
              <Button variant="contained" onClick={() => setOpen(true)}>Generate Single</Button>
            </>
          ) : null
        }
      />
      <Card sx={{ mb: 2 }}><CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <TextField select label="Month" size="small" sx={{ minWidth: 140 }} value={filters.month}
            onChange={(e) => setFilters({ ...filters, month: e.target.value === '' ? '' : Number(e.target.value) })}>
            <MenuItem value="">All months</MenuItem>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <MenuItem key={m} value={m}>{dayjs().month(m - 1).format('MMMM')}</MenuItem>)}
          </TextField>
          <TextField select label="Year" size="small" sx={{ minWidth: 140 }} value={filters.year}
            onChange={(e) => setFilters({ ...filters, year: e.target.value === '' ? '' : Number(e.target.value) })}>
            <MenuItem value="">All years</MenuItem>
            {Array.from({ length: 6 }, (_, i) => dayjs().year() - i).map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </TextField>
          {(filters.month || filters.year) && (
            <Button size="small" onClick={() => setFilters({ month: '', year: '' })}>Clear filters</Button>
          )}
          {isFetching && <Box sx={{ ml: 'auto', fontSize: 12, opacity: 0.6 }}>Refreshing…</Box>}
        </Stack>
      </CardContent></Card>

      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (data?.data?.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>{['Employee', 'Month', 'Basic', 'Commission', 'Bonus', 'Deductions', 'Net', 'Status', 'Actions'].map((h) => (
                <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px' }}>{p.employee?.fullName}</td>
                    <td style={{ padding: '10px 8px' }}>{dayjs(`${p.year}-${p.month}-01`).format('MMM YYYY')}</td>
                    <td style={{ padding: '10px 8px' }}>{formatCurrency(p.basicSalary)}</td>
                    <td style={{ padding: '10px 8px' }}>{formatCurrency(p.commission)}</td>
                    <td style={{ padding: '10px 8px' }}>{formatCurrency(p.attendanceBonus + p.incentives + p.overtime)}</td>
                    <td style={{ padding: '10px 8px', color: '#ef4444' }}>−{formatCurrency(p.lateDeduction + p.absentDeduction + p.otherDeductions)}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 800 }}>{formatCurrency(p.netSalary)}</td>
                    <td style={{ padding: '10px 8px' }}><Chip size="small" label={p.status} color={p.status === 'PAID' ? 'success' : 'default'} /></td>
                    <td style={{ padding: '10px 8px' }}>
                      <Button size="small" startIcon={<DownloadIcon />} onClick={() => downloadPayslip(p._id)}>Payslip</Button>
                      {canWrite && p.status !== 'PAID' && <Button size="small" onClick={async () => { await payrollService.markPaid(p._id); qc.invalidateQueries({ queryKey: ['payrolls'] }); }}>Mark Paid</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No payroll records found" subtitle={filters.month || filters.year ? 'Try clearing the month/year filter to see all records.' : 'Generate payroll for an employee to get started.'} />)}
      </CardContent></Card>

      <Dialog open={bulkOpen} onClose={() => setBulkOpen(false)}>
        <DialogTitle>Generate bulk payroll</DialogTitle>
        <DialogContent>Generate payroll for ALL employees for {dayjs(`${filters.year || defaultYear}-${filters.month || defaultMonth}-01`).format('MMMM YYYY')}?</DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBulkOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={onBulk}>Generate</Button>
        </DialogActions>
      </Dialog>

      <GeneratePayrollDialog
        open={open}
        onClose={() => setOpen(false)}
        onGenerated={() => qc.invalidateQueries({ queryKey: ['payrolls'] })}
        defaultMonth={filters.month || defaultMonth}
        defaultYear={filters.year || defaultYear}
      />
    </>
  );
}
