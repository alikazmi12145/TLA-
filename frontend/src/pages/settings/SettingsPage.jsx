import { useEffect } from 'react';
import { Card, CardContent, Stack, TextField, Button, Box, Avatar, Typography, MenuItem, Grid, Divider } from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { settingService } from '../../services';
import { asset } from '../../lib/format';
import { PERMISSION_MODULES, normalizeRolePermissions } from '../../lib/permissions';

const ACCESS_OPTIONS = [
  { value: 'none', label: 'No access' },
  { value: 'read', label: 'View only' },
  { value: 'manage', label: 'Manage' },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: settingService.get });
  const { register, handleSubmit, reset, watch } = useForm();

  useEffect(() => {
    if (data?.data) {
      reset({
        ...data.data,
        permissions: normalizeRolePermissions(data.data.permissions),
      });
    }
  }, [data, reset]);

  const logoFile = watch('logo');
  const sigFile = watch('ceoSignature');

  const onSubmit = async (values) => {
    try {
      const fd = new FormData();
      Object.keys(values).forEach((k) => {
        if (k === 'logo' || k === 'ceoSignature' || k === 'permissions') return;
        if (values[k] !== undefined && values[k] !== null) fd.append(k, values[k]);
      });
      fd.append('permissions', JSON.stringify(normalizeRolePermissions(values.permissions)));
      if (values.logo && values.logo[0]) fd.append('logo', values.logo[0]);
      if (values.ceoSignature && values.ceoSignature[0]) fd.append('ceoSignature', values.ceoSignature[0]);
      await settingService.update(fd);
      toast.success('Settings updated');
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch {}
  };

  if (isLoading) return null;

  return (
    <>
      <PageHeader title="Settings" subtitle="Configure company-wide preferences" />
      <Card><CardContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <Stack spacing={3}>
            <Box>
              <Typography variant="overline" color="text.secondary">Company Logo</Typography>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
                <Avatar src={asset(data?.data?.logoUrl)} variant="rounded" sx={{ width: 80, height: 80 }} />
                <Button component="label" variant="outlined" startIcon={<UploadIcon />}>
                  Change logo
                  <input type="file" hidden accept="image/*" {...register('logo')} />
                </Button>
                {logoFile?.[0] && <Typography variant="body2">{logoFile[0].name}</Typography>}
              </Stack>
            </Box>

            <Typography variant="overline" color="text.secondary">Company Info</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField label="Company Name" fullWidth {...register('companyName')} />
              <TextField label="Currency" fullWidth {...register('currency')} />
            </Stack>
            <TextField label="Address" fullWidth {...register('address')} />
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField label="Contact Email" fullWidth {...register('contactEmail')} />
              <TextField label="Contact Phone" fullWidth {...register('contactPhone')} />
            </Stack>

            <Typography variant="overline" color="text.secondary">Authorized Signatory (CEO)</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField label="CEO Name" fullWidth helperText="Shown on payslip signature line" {...register('ceoName')} />
              <TextField label="CEO Title" fullWidth helperText="e.g. Chief Executive Officer" {...register('ceoTitle')} />
            </Stack>
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Signature image (PNG with transparent background works best)</Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Avatar src={asset(data?.data?.ceoSignatureUrl)} variant="rounded" sx={{ width: 140, height: 56, bgcolor: '#f4f5fb' }} />
                <Button component="label" variant="outlined" startIcon={<UploadIcon />}>
                  Upload signature
                  <input type="file" hidden accept="image/*" {...register('ceoSignature')} />
                </Button>
                {sigFile?.[0] && <Typography variant="body2">{sigFile[0].name}</Typography>}
              </Stack>
            </Box>

            <Typography variant="overline" color="text.secondary">Payroll Configuration</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField type="number" label="Working days/month" fullWidth {...register('workingDaysPerMonth', { valueAsNumber: true })} />
              <TextField type="number" label="Working hours/day" fullWidth {...register('workingHoursPerDay', { valueAsNumber: true })} />
              <TextField label="Timezone" fullWidth {...register('timezone')} />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField type="number" label="Late deduction/day" fullWidth {...register('lateDeductionPerDay', { valueAsNumber: true })} />
              <TextField type="number" label="Absent deduction/day" fullWidth {...register('absentDeductionPerDay', { valueAsNumber: true })} />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField type="number" label="Attendance bonus threshold (days)" fullWidth {...register('attendanceBonusThreshold', { valueAsNumber: true })} />
              <TextField type="number" label="Attendance bonus amount" fullWidth {...register('attendanceBonusAmount', { valueAsNumber: true })} />
            </Stack>

            <Typography variant="overline" color="text.secondary">Salary &amp; Ticket Incentive</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField type="number" label="Daily ticket target" fullWidth helperText="Default 120" {...register('dailyTicketTarget', { valueAsNumber: true })} />
              <TextField type="number" label="Incentive per extra ticket" fullWidth helperText="Paid for each ticket above the daily target" {...register('incentivePerExtraTicket', { valueAsNumber: true })} />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField type="number" label="Late grace count" fullWidth helperText="First N lates are ignored" {...register('lateGraceCount', { valueAsNumber: true })} />
              <TextField type="number" label="Lates per absent day" fullWidth helperText="Every M lates after grace = 1 absent day deduction" {...register('latesPerAbsent', { valueAsNumber: true })} />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField type="number" label="Tax %" fullWidth helperText="Applied on gross salary" {...register('taxPercentage', { valueAsNumber: true })} />
              <TextField type="number" label="Payroll closing date" fullWidth helperText="Day of month payroll is locked (1-31)" {...register('payrollClosingDate', { valueAsNumber: true })} />
            </Stack>

            <Divider flexItem />
            <Typography variant="overline" color="text.secondary">Role Permissions</Typography>
            <Typography variant="body2" color="text.secondary">
              Admin can choose which modules HR and Team Leaders can open, and whether they can only view or fully manage them.
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Module</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>HR</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Team Leader</Typography>
              </Grid>
              {PERMISSION_MODULES.map((module) => (
                <Grid container item spacing={2} key={module.key}>
                  <Grid item xs={12} md={4}>
                    <TextField fullWidth value={module.label} InputProps={{ readOnly: true }} />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField select fullWidth label="HR permission" defaultValue="none" {...register(`permissions.HR_MANAGER.${module.key}`)}>
                      {ACCESS_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField select fullWidth label="Team Leader permission" defaultValue="none" {...register(`permissions.TEAM_LEADER.${module.key}`)}>
                      {ACCESS_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                </Grid>
              ))}
            </Grid>

            <Stack direction="row" justifyContent="flex-end">
              <Button type="submit" variant="contained" size="large">Save changes</Button>
            </Stack>
          </Stack>
        </form>
      </CardContent></Card>
    </>
  );
}
