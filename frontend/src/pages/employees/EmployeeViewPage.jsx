import { Card, CardContent, Grid, Avatar, Typography, Box, Stack, Chip, Divider, Button } from '@mui/material';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import PageHeader from '../../components/common/PageHeader';
import { Loading } from '../../components/common/States';
import BiometricCard from '../../components/biometric/BiometricCard';
import { employeeService } from '../../services';
import { asset, initials, formatCurrency } from '../../lib/format';

const Field = ({ label, value }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 600 }}>{value || '—'}</Typography>
  </Box>
);

export default function EmployeeViewPage() {
  const { id } = useParams();
  const { data, isLoading } = useQuery({ queryKey: ['employee', id], queryFn: () => employeeService.get(id) });
  if (isLoading) return <Loading />;
  const e = data?.data;
  if (!e) return null;

  return (
    <>
      <PageHeader title="Employee Profile" actions={<Button component={Link} to={`/employees/${id}/edit`} variant="contained">Edit</Button>} />
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent sx={{ textAlign: 'center', py: 4 }}>
              <Avatar src={asset(e.profilePicture)} sx={{ width: 110, height: 110, margin: '0 auto', mb: 2, fontSize: 36 }}>
                {initials(e.fullName)}
              </Avatar>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>{e.fullName}</Typography>
              <Typography variant="body2" color="text.secondary">{e.designation || '—'}</Typography>
              <Stack direction="row" justifyContent="center" spacing={1} sx={{ mt: 1 }}>
                <Chip size="small" label={e.role.replace('_', ' ')} />
                <Chip size="small" label={e.status} color={e.isActive ? 'success' : 'default'} />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={8}>
          <Card><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Details</Typography>
            <Grid container spacing={2}>
              <Grid item xs={6} md={4}><Field label="Employee ID" value={e.employeeId} /></Grid>
              <Grid item xs={6} md={4}><Field label="Email" value={e.email} /></Grid>
              <Grid item xs={6} md={4}><Field label="Phone" value={e.phone} /></Grid>
              <Grid item xs={6} md={4}><Field label="CNIC" value={e.cnic} /></Grid>
              <Grid item xs={6} md={4}><Field label="Department" value={e.department?.name} /></Grid>
              <Grid item xs={6} md={4}><Field label="Shift" value={e.shift?.name} /></Grid>
              <Grid item xs={6} md={4}><Field label="Joining Date" value={e.joiningDate ? dayjs(e.joiningDate).format('MMM D, YYYY') : ''} /></Grid>
              <Grid item xs={6} md={4}><Field label="Basic Salary" value={formatCurrency(e.basicSalary)} /></Grid>
              <Grid item xs={6} md={4}><Field label="Daily Target" value={e.dailyTarget} /></Grid>
              <Grid item xs={6} md={4}><Field label="Commission %" value={`${e.commissionRate || 0}%`} /></Grid>
            </Grid>
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary">
              Last login: {e.lastLoginAt ? dayjs(e.lastLoginAt).format('MMM D, YYYY HH:mm') : '—'}
            </Typography>
          </CardContent></Card>
        </Grid>

        <Grid item xs={12}>
          <BiometricCard employee={e} />
        </Grid>
      </Grid>
    </>
  );
}
