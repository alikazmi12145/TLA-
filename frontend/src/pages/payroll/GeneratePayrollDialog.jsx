import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Button,
  Typography,
  Box,
  Divider,
  Grid,
  Alert,
  CircularProgress,
  Stack,
} from '@mui/material';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import { payrollService, employeeService, settingService } from '../../services';

const SECTION_SX = { color: '#5b6ef5', fontWeight: 700 };

export default function GeneratePayrollDialog({ open, onClose, onGenerated, defaultMonth, defaultYear }) {
  const [employeeId, setEmployeeId] = useState('');
  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: emps } = useQuery({
    queryKey: ['emps-all'],
    queryFn: () => employeeService.list({ limit: 100 }),
    enabled: open,
  });
  const { data: settingResp } = useQuery({
    queryKey: ['setting'],
    queryFn: settingService.get,
    enabled: open,
  });
  const currency = settingResp?.data?.currency || 'PKR';
  const fmt = (n) => `${currency} ${Number(n || 0).toFixed(2)}`;

  const selectedEmp = useMemo(
    () => (emps?.data || []).find((e) => e._id === employeeId),
    [emps, employeeId]
  );

  useEffect(() => {
    if (!open) {
      setEmployeeId('');
      setMonth(defaultMonth);
      setYear(defaultYear);
      setPreview(null);
      setPreviewError('');
    }
  }, [open, defaultMonth, defaultYear]);

  useEffect(() => {
    if (!open || !employeeId || !month || !year) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    payrollService
      .preview({ employee: employeeId, month, year })
      .then((resp) => { if (!cancelled) setPreview(resp.data); })
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(err?.response?.data?.message || err?.message || 'Failed to compute preview');
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [open, employeeId, month, year]);

  const submit = async () => {
    if (!employeeId || !month || !year) {
      toast.error('Pick employee, month and year first');
      return;
    }
    setSubmitting(true);
    try {
      await payrollService.generate({ employee: employeeId, month, year });
      toast.success('Payslip generated and sent to employee');
      onGenerated?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Generate failed');
    } finally {
      setSubmitting(false);
    }
  };

  const meta = preview?._meta || {};
  const workHours = (preview?.workMinutes || 0) / 60;
  const gross = meta.gross || 0;
  const totalDeductions =
    (preview?.lateDeduction || 0) + (preview?.absentDeduction || 0) + (preview?.otherDeductions || 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Generate Payslip
        <Typography variant="caption" display="block" sx={{ opacity: 0.7 }}>
          Pick an employee and month — the system pulls attendance, tickets and settings, then computes the salary automatically.
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={6}>
            <TextField
              select
              fullWidth
              size="small"
              label="Employee"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <MenuItem value="">— Select employee —</MenuItem>
              {(emps?.data || []).map((e) => (
                <MenuItem key={e._id} value={e._id}>
                  {e.fullName} {e.employeeId ? `(${e.employeeId})` : ''}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              select
              fullWidth
              size="small"
              label="Month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <MenuItem key={m} value={m}>{dayjs().month(m - 1).format('MMMM')}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              type="number"
              fullWidth
              size="small"
              label="Year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />

        {!employeeId && (
          <Alert severity="info">Select an employee to preview their calculated payslip.</Alert>
        )}

        {employeeId && previewLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 4, justifyContent: 'center' }}>
            <CircularProgress size={18} />
            <Typography variant="body2">Computing payslip…</Typography>
          </Box>
        )}

        {previewError && <Alert severity="error">{previewError}</Alert>}

        {preview && !previewLoading && (
          <Box>
            {selectedEmp && (
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="body2">
                  <strong>Employee:</strong> {selectedEmp.fullName}
                  {'   '}<strong>Employee ID:</strong> {selectedEmp.employeeId || '—'}
                  {'   '}<strong>Designation:</strong> {selectedEmp.designation || '—'}
                  {'   '}<strong>Email:</strong> {selectedEmp.email}
                </Typography>
              </Box>
            )}

            <Typography variant="subtitle1" sx={SECTION_SX}>Attendance Summary</Typography>
            <Typography variant="body2">
              Present: {preview.presentDays}    Absent: {preview.absentDays}    Leaves: {preview.leaveDays}    Late: {preview.lateDays}
            </Typography>
            <Typography variant="body2">Work Hours: {workHours.toFixed(2)} hrs</Typography>
            <Typography variant="body2">
              Month Days: {meta.monthDays}    Off Days ({(meta.offDays || []).map((d) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ') || 'None'}): {meta.offDayCount || 0}    Public Holidays: {meta.holidayCount || 0}    Working Days: {meta.workingDays}
            </Typography>
            <Typography variant="body2">
              Per-Day Rate: {fmt(meta.perDayRate)}    Chargeable Lates: {meta.chargeableLates} @ {fmt(meta.perLateCharge)}
            </Typography>

            {meta.dailyTicketTarget > 0 && (
              <>
                <Typography variant="subtitle1" sx={{ ...SECTION_SX, mt: 1.5 }}>Ticket Performance</Typography>
                <Typography variant="body2">
                  Daily Target: {meta.dailyTicketTarget}    Extra Tickets (month): {meta.extraTickets}    Per-Ticket Incentive: {fmt(meta.incentivePerExtraTicket)}
                </Typography>
                <Typography variant="body2">Ticket Incentive Earned: {fmt(meta.ticketIncentive)}</Typography>
              </>
            )}

            <Typography variant="subtitle1" sx={{ ...SECTION_SX, mt: 1.5 }}>Salary Breakdown</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 0.5, columnGap: 2, maxWidth: 460 }}>
              <Typography variant="body2">Basic Salary</Typography><Typography variant="body2" align="right">{fmt(preview.basicSalary)}</Typography>
              <Typography variant="body2">Ticket Incentive</Typography><Typography variant="body2" align="right">{fmt(meta.ticketIncentive)}</Typography>
              <Typography variant="body2">Bonus</Typography><Typography variant="body2" align="right">{fmt(meta.bonus)}</Typography>
              <Typography variant="body2">Additional Incentives</Typography><Typography variant="body2" align="right">{fmt(meta.manualIncentives)}</Typography>
              <Typography variant="body2">Attendance Bonus</Typography><Typography variant="body2" align="right">{fmt(preview.attendanceBonus)}</Typography>
              <Typography variant="body2">Commission</Typography><Typography variant="body2" align="right">{fmt(preview.commission)}</Typography>
              <Typography variant="body2">Overtime</Typography><Typography variant="body2" align="right">{fmt(preview.overtime)}</Typography>
              <Typography variant="body2" sx={{ color: '#d33' }}>Late Deduction</Typography><Typography variant="body2" align="right" sx={{ color: '#d33' }}>−{fmt(preview.lateDeduction)}</Typography>
              <Typography variant="body2" sx={{ color: '#d33' }}>Absent Deduction</Typography><Typography variant="body2" align="right" sx={{ color: '#d33' }}>−{fmt(preview.absentDeduction)}</Typography>
              <Typography variant="body2" sx={{ color: '#d33' }}>Tax</Typography><Typography variant="body2" align="right" sx={{ color: '#d33' }}>−{fmt(meta.tax)}</Typography>
              <Typography variant="body2" sx={{ color: '#d33' }}>Other Deductions</Typography><Typography variant="body2" align="right" sx={{ color: '#d33' }}>−{fmt(meta.otherDeductionsInput)}</Typography>
            </Box>

            <Divider sx={{ my: 1.5 }} />

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between">
              <Box>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>Gross</Typography>
                <Typography variant="h6">{fmt(gross)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>Total Deductions</Typography>
                <Typography variant="h6" sx={{ color: '#ef4444' }}>−{fmt(totalDeductions)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>Net Salary</Typography>
                <Typography variant="h5" sx={{ color: '#1aab50', fontWeight: 800 }}>{fmt(preview.netSalary)}</Typography>
              </Box>
            </Stack>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={submitting || !employeeId || previewLoading}
          startIcon={submitting ? <CircularProgress size={14} /> : null}
        >
          Generate &amp; Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
