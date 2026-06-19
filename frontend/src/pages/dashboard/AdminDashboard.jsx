import { Grid, Card, CardContent, Typography, Stack, Chip, Box } from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventIcon from '@mui/icons-material/Event';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import HotelIcon from '@mui/icons-material/Hotel';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';

import StatCard from '../../components/common/StatCard';
import PageHeader from '../../components/common/PageHeader';
import { Empty, Loading } from '../../components/common/States';
import { dashboardService, attendanceService, payrollService, leaveService, holidayService } from '../../services';
import { formatCurrency } from '../../lib/format';

const COLORS = ['#5b6ef5', '#a855f7', '#1aab50', '#f5a524', '#ef4444', '#06b6d4'];

export default function AdminDashboard() {
  const user = useSelector((s) => s.auth.user);
  const role = user?.role;
  const isAdminOrHR = role === 'SUPER_ADMIN' || role === 'HR_MANAGER';
  const roleLabel = (user?.role || '').replace('_', ' ');
  const greeting = (() => {
    const h = dayjs().hour();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();
  const { data: summary, isLoading } = useQuery({ queryKey: ['dash-admin'], queryFn: dashboardService.admin });
  const { data: trend } = useQuery({ queryKey: ['att-trend'], queryFn: () => attendanceService.trend(30) });
  const { data: payrollTrend } = useQuery({
    queryKey: ['pay-trend'],
    queryFn: payrollService.trend,
    enabled: isAdminOrHR,
  });
  const { data: leaveAnalytics } = useQuery({
    queryKey: ['leave-analytics'],
    queryFn: leaveService.analytics,
    enabled: isAdminOrHR,
  });
  const { data: pending } = useQuery({
    queryKey: ['leaves-pending'],
    queryFn: () => leaveService.list({ status: 'PENDING' }),
    enabled: isAdminOrHR,
  });
  const { data: upcoming } = useQuery({ queryKey: ['holidays-upcoming'], queryFn: holidayService.upcoming });
  const { data: recent } = useQuery({ queryKey: ['recent'], queryFn: dashboardService.recent });
  const { data: deptPerf } = useQuery({ queryKey: ['dept-perf'], queryFn: dashboardService.deptPerformance });

  const s = summary?.data || {};

  const trendData = (() => {
    const map = {};
    (trend?.data || []).forEach((r) => {
      const key = dayjs(r._id.date).format('MM-DD');
      map[key] = map[key] || { date: key, PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
      map[key][r._id.status] = r.count;
    });
    return Object.values(map);
  })();

  const payrollData = (payrollTrend?.data || []).map((p) => ({
    label: `${p._id.month}/${String(p._id.year).slice(2)}`,
    total: p.total,
  }));

  const leavePie = (leaveAnalytics?.data || []).reduce((acc, x) => {
    const k = x._id.type;
    const e = acc.find((a) => a.name === k);
    if (e) e.value += x.count; else acc.push({ name: k, value: x.count });
    return acc;
  }, []);

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.fullName || 'Admin'}`}
        subtitle={`${roleLabel} · Overview of your workforce`}
      />

      <Grid container spacing={2}>
        {[
          { t: 'Total Employees', v: s.totalEmployees ?? '-', i: <PeopleIcon />, c: 'primary' },
          { t: 'Present Today', v: s.presentToday ?? '-', i: <EventAvailableIcon />, c: 'success' },
          { t: 'Absent Today', v: s.absentToday ?? '-', i: <EventBusyIcon />, c: 'error' },
          { t: 'On Leave', v: s.onLeaveToday ?? '-', i: <HotelIcon />, c: 'warning' },
          { t: 'Total Holidays', v: s.totalHolidays ?? '-', i: <EventIcon />, c: 'info' },
          { t: 'Monthly Payroll', v: formatCurrency(s.monthlyPayroll), i: <ReceiptLongIcon />, c: 'primary' },
          { t: 'Monthly Commission', v: formatCurrency(s.monthlyCommission), i: <RequestQuoteIcon />, c: 'secondary' },
          { t: 'Departments', v: s.totalDepartments ?? '-', i: <GroupWorkIcon />, c: 'info' },
        ].map((c) => (
          <Grid item xs={12} sm={6} md={3} key={c.t}>
            <StatCard title={c.t} value={c.v} icon={c.i} color={c.c} loading={isLoading} />
          </Grid>
        ))}

        <Grid item xs={12} md={8}>
          <Card><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Attendance Trend (30 days)</Typography>
            <Box sx={{ height: 320 }}>
              {trendData.length ? (
                <ResponsiveContainer>
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="p1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#5b6ef5" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#5b6ef5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" /><YAxis />
                    <Tooltip /><Legend />
                    <Area type="monotone" dataKey="PRESENT" stroke="#1aab50" fill="url(#p1)" />
                    <Area type="monotone" dataKey="LATE" stroke="#f5a524" fillOpacity={0} />
                    <Area type="monotone" dataKey="ABSENT" stroke="#ef4444" fillOpacity={0} />
                    <Area type="monotone" dataKey="LEAVE" stroke="#a855f7" fillOpacity={0} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <Loading />}
            </Box>
          </CardContent></Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Leave Analytics</Typography>
            <Box sx={{ height: 320 }}>
              {leavePie.length ? (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={leavePie} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} label>
                      {leavePie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <Empty title="No leave data yet" />}
            </Box>
          </CardContent></Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Monthly Payroll Trend</Typography>
            <Box sx={{ height: 280 }}>
              {payrollData.length ? (
                <ResponsiveContainer>
                  <BarChart data={payrollData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="label" /><YAxis />
                    <Tooltip />
                    <Bar dataKey="total" fill="#5b6ef5" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty title="No payrolls generated yet" />}
            </Box>
          </CardContent></Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Department Performance</Typography>
            <Box sx={{ height: 280 }}>
              {(deptPerf?.data || []).length ? (
                <ResponsiveContainer>
                  <LineChart data={(deptPerf?.data || []).map((d) => ({ name: d._id || 'Unassigned', employees: d.employees, present: d.present }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" /><YAxis />
                    <Tooltip /><Legend />
                    <Line type="monotone" dataKey="employees" stroke="#5b6ef5" strokeWidth={2} />
                    <Line type="monotone" dataKey="present" stroke="#1aab50" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <Empty title="No data" />}
            </Box>
          </CardContent></Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Pending Leave Requests</Typography>
            <Stack spacing={1}>
              {(pending?.data || []).slice(0, 6).map((l) => (
                <Stack key={l._id} direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1.2, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Box>
                    <Typography variant="body2" fontWeight={700}>{l.employee?.fullName}</Typography>
                    <Typography variant="caption" color="text.secondary">{l.type} · {dayjs(l.fromDate).format('MMM D')} → {dayjs(l.toDate).format('MMM D')}</Typography>
                  </Box>
                  <Chip size="small" label={`${l.days}d`} color="warning" />
                </Stack>
              ))}
              {!(pending?.data || []).length && <Empty title="No pending leaves" />}
            </Stack>
          </CardContent></Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Upcoming Holidays</Typography>
            <Stack spacing={1}>
              {(upcoming?.data || []).map((h) => (
                <Stack key={h._id} direction="row" justifyContent="space-between" sx={{ p: 1.2, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="body2" fontWeight={700}>{h.title}</Typography>
                  <Chip size="small" label={dayjs(h.date).format('MMM D, YYYY')} color="info" />
                </Stack>
              ))}
              {!(upcoming?.data || []).length && <Empty title="No upcoming holidays" />}
            </Stack>
          </CardContent></Card>
        </Grid>

        <Grid item xs={12}>
          <Card><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Recent Activity</Typography>
            <Stack spacing={1}>
              {(recent?.data || []).map((a, i) => (
                <Stack key={i} direction="row" justifyContent="space-between" sx={{ p: 1, borderBottom: '1px dashed', borderColor: 'divider' }}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{a.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{dayjs(a.at).format('MMM D, YYYY HH:mm')}</Typography>
                  </Box>
                  {a.status && <Chip size="small" label={a.status} />}
                </Stack>
              ))}
              {!(recent?.data || []).length && <Empty title="No recent activity" />}
            </Stack>
          </CardContent></Card>
        </Grid>
      </Grid>
    </>
  );
}
