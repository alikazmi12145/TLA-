import { Grid, Card, CardContent, Typography, Stack, Button, Box, LinearProgress, Chip } from '@mui/material';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventIcon from '@mui/icons-material/Event';
import HotelIcon from '@mui/icons-material/Hotel';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';

import StatCard from '../../components/common/StatCard';
import PageHeader from '../../components/common/PageHeader';
import { Empty } from '../../components/common/States';
import AnnouncementsCard from '../../components/common/AnnouncementsCard';
import { dashboardService, attendanceService, leaveService, payrollService, targetService } from '../../services';
import { formatCurrency, minutesToHours } from '../../lib/format';

const COLORS = ['#1aab50', '#ef4444', '#f5a524', '#a855f7', '#5b6ef5', '#06b6d4'];

export default function EmployeeDashboard() {
  const qc = useQueryClient();
  const user = useSelector((s) => s.auth.user);
  const roleLabel = (user?.role || '').replace('_', ' ');
  const greeting = (() => {
    const h = dayjs().hour();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();
  const { data: summary, isLoading } = useQuery({ queryKey: ['dash-employee'], queryFn: dashboardService.employee });
  const { data: today } = useQuery({ queryKey: ['att-today'], queryFn: attendanceService.today });
  const { data: month } = useQuery({ queryKey: ['att-month'], queryFn: () => attendanceService.myMonth() });
  const { data: balance } = useQuery({ queryKey: ['leave-balance'], queryFn: leaveService.myBalance });
  const { data: payslips } = useQuery({ queryKey: ['my-payroll-mini'], queryFn: payrollService.mine });
  const { data: targets } = useQuery({ queryKey: ['my-targets'], queryFn: targetService.mine });

  const s = summary?.data || {};
  const t = today?.data || null;

  const action = async (fn, success) => {
    try { await fn(); toast.success(success); qc.invalidateQueries(); } catch {}
  };

  const monthData = month?.data || [];
  const monthChart = monthData.map((a) => ({
    date: dayjs(a.date).format('MM-DD'),
    hours: Number(((a.workMinutes || 0) / 60).toFixed(2)),
  }));

  const attendancePie = (() => {
    const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, LEAVE: 0, HOLIDAY: 0 };
    monthData.forEach((a) => { if (counts[a.status] !== undefined) counts[a.status] += 1; });
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: k, value: v }));
  })();

  const leaveBalance = (() => {
    const allotments = { CASUAL: 10, SICK: 8, ANNUAL: 14, EMERGENCY: 5 };
    const used = (balance?.data || []).reduce((acc, b) => ({ ...acc, [b._id]: b.used }), {});
    return Object.entries(allotments).map(([type, total]) => ({
      type,
      total,
      used: used[type] || 0,
      remaining: Math.max(0, total - (used[type] || 0)),
    }));
  })();

  const payslipChart = (payslips?.data || [])
    .slice()
    .reverse()
    .slice(-6)
    .map((p) => ({
      label: dayjs(`${p.year}-${p.month}-01`).format('MMM YY'),
      net: p.netSalary,
      basic: p.basicSalary,
      commission: p.commission,
    }));

  const latestPayroll = (payslips?.data || [])[0];
  const salaryDonut = latestPayroll ? [
    { name: 'Basic', value: latestPayroll.basicSalary || 0 },
    { name: 'Commission', value: latestPayroll.commission || 0 },
    { name: 'Bonus', value: (latestPayroll.attendanceBonus || 0) + (latestPayroll.incentives || 0) + (latestPayroll.overtime || 0) },
    { name: 'Deductions', value: (latestPayroll.lateDeduction || 0) + (latestPayroll.absentDeduction || 0) + (latestPayroll.otherDeductions || 0) },
  ].filter((x) => x.value > 0) : [];

  const targetCompletion = s.dailyTarget ? Math.min(100, ((s.workHours || 0) / 8) * 100) : 0;

  const targetData = (targets?.data || []).slice(0, 6).map((tg) => ({
    name: dayjs(tg.periodStart).format('MMM D'),
    target: tg.targetValue || 0,
    achieved: tg.achievedValue || 0,
  }));

  const radial = [{ name: 'Target', value: targetCompletion, fill: '#5b6ef5' }];

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.fullName || 'there'}`}
        subtitle={`${roleLabel}${user?.designation ? ' · ' + user.designation : ''}`}
      />

      <Grid container spacing={2}>
        <Grid item xs={12}>
          <AnnouncementsCard limit={5} />
        </Grid>

        {[
          { t: 'Present Days', v: s.presentDays ?? '-', i: <EventAvailableIcon />, c: 'success' },
          { t: 'Absent Days', v: s.absentDays ?? '-', i: <EventBusyIcon />, c: 'error' },
          { t: 'Leaves', v: s.leaves ?? '-', i: <HotelIcon />, c: 'warning' },
          { t: 'Holidays', v: s.holidays ?? '-', i: <EventIcon />, c: 'info' },
          { t: 'Work Hours', v: `${s.workHours || 0} h`, i: <AccessTimeIcon />, c: 'primary' },
          { t: 'Current Salary', v: formatCurrency(s.currentSalary), i: <ReceiptLongIcon />, c: 'primary' },
          { t: 'Current Commission', v: formatCurrency(s.currentCommission), i: <RequestQuoteIcon />, c: 'secondary' },
          { t: 'Daily Target', v: s.dailyTarget || 0, i: <EmojiEventsIcon />, c: 'success' },
        ].map((c) => (
          <Grid item xs={12} sm={6} md={3} key={c.t}>
            <StatCard title={c.t} value={c.v} icon={c.i} color={c.c} loading={isLoading} />
          </Grid>
        ))}

        {/* Today's attendance + actions */}
        <Grid item xs={12} md={5}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Today's Attendance</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{dayjs().format('dddd, MMMM D, YYYY')}</Typography>

            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
              {[
                ['Clock In', t?.clockIn],
                ['Clock Out', t?.clockOut],
              ].map(([k, v]) => (
                <Chip key={k} label={`${k}: ${v ? dayjs(v).format('HH:mm') : '—'}`} variant="outlined" />
              ))}
            </Stack>

            {t?.workMinutes ? (
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">Work hours</Typography>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>{minutesToHours(t.workMinutes)}</Typography>
              </Box>
            ) : null}

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button onClick={() => action(attendanceService.clockIn, 'Clocked in')} variant="contained" color="success" disabled={!t?.deviceCheckInAt || !!t?.deviceCheckOutAt || !!t?.clockIn}>Clock in</Button>
              <Button onClick={() => action(attendanceService.clockOut, 'Clocked out')} variant="contained" color="error" disabled={!t?.deviceCheckOutAt || !t?.clockIn || !!t?.clockOut}>Clock out</Button>
            </Stack>
          </CardContent></Card>
        </Grid>

        {/* Daily target gauge */}
        <Grid item xs={12} md={3}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Daily Target</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Today's progress</Typography>
            <Box sx={{ height: 200, position: 'relative' }}>
              <ResponsiveContainer>
                <RadialBarChart innerRadius="65%" outerRadius="100%" data={radial} startAngle={90} endAngle={-270}>
                  <RadialBar dataKey="value" cornerRadius={20} background={{ fill: 'rgba(91,110,245,0.12)' }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#5b6ef5' }}>{targetCompletion.toFixed(0)}%</Typography>
              </Box>
            </Box>
            <LinearProgress variant="determinate" value={targetCompletion} sx={{ height: 8, borderRadius: 4, mt: 1 }} />
          </CardContent></Card>
        </Grid>

        {/* Attendance breakdown pie */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Attendance Breakdown</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>This month</Typography>
            <Box sx={{ height: 240 }}>
              {attendancePie.length ? (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={attendancePie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} label>
                      {attendancePie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <Empty title="No attendance data yet" />}
            </Box>
          </CardContent></Card>
        </Grid>

        {/* Work hours area chart */}
        <Grid item xs={12} md={8}>
          <Card><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Work Hours This Month</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Daily working hours trend</Typography>
            <Box sx={{ height: 280 }}>
              {monthChart.length ? (
                <ResponsiveContainer>
                  <AreaChart data={monthChart} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="hoursGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#5b6ef5" stopOpacity={0.7} />
                        <stop offset="100%" stopColor="#5b6ef5" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" />
                    <YAxis domain={[0, (max) => Math.max(8, max + 1)]} />
                    <Tooltip />
                    <Area type="monotone" dataKey="hours" stroke="#5b6ef5" strokeWidth={3} fill="url(#hoursGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <Empty title="No work hours yet" subtitle="Clock in to start tracking your hours." />}
            </Box>
          </CardContent></Card>
        </Grid>

        {/* Salary composition donut */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Salary Composition</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {latestPayroll ? dayjs(`${latestPayroll.year}-${latestPayroll.month}-01`).format('MMMM YYYY') : 'Latest payslip'}
            </Typography>
            <Box sx={{ height: 240 }}>
              {salaryDonut.length ? (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={salaryDonut} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {salaryDonut.map((_, i) => <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(v)} /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <Empty title="No payroll yet" />}
            </Box>
          </CardContent></Card>
        </Grid>

        {/* Leave balance bar chart */}
        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Leave Balance</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Used vs remaining ({dayjs().year()})</Typography>
            <Box sx={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={leaveBalance}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="type" /><YAxis />
                  <Tooltip /><Legend />
                  <Bar dataKey="used" stackId="a" fill="#ef4444" radius={[0, 0, 6, 6]} />
                  <Bar dataKey="remaining" stackId="a" fill="#1aab50" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </CardContent></Card>
        </Grid>

        {/* Salary trend (last 6 months) */}
        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Salary Trend</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Last 6 payslips</Typography>
            <Box sx={{ height: 260 }}>
              {payslipChart.length ? (
                <ResponsiveContainer>
                  <LineChart data={payslipChart}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="label" /><YAxis />
                    <Tooltip formatter={(v) => formatCurrency(v)} /><Legend />
                    <Line type="monotone" dataKey="net" stroke="#5b6ef5" strokeWidth={3} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="basic" stroke="#a855f7" strokeWidth={2} strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="commission" stroke="#1aab50" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <Empty title="No payslips yet" subtitle="Your salary trend will appear once payroll is generated." />}
            </Box>
          </CardContent></Card>
        </Grid>

        {/* Targets achieved chart */}
        {targetData.length > 0 && (
          <Grid item xs={12}>
            <Card><CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Target vs Achieved</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Recent targets</Typography>
              <Box sx={{ height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={targetData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" /><YAxis />
                    <Tooltip /><Legend />
                    <Bar dataKey="target" fill="#a855f7" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="achieved" fill="#1aab50" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent></Card>
          </Grid>
        )}
      </Grid>
    </>
  );
}
