import { Box, List, ListItemButton, ListItemIcon, ListItemText, Tooltip, Divider, Button, Stack, Chip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, TextField } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventIcon from '@mui/icons-material/Event';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AssessmentIcon from '@mui/icons-material/Assessment';
import SettingsIcon from '@mui/icons-material/Settings';
import BadgeIcon from '@mui/icons-material/Badge';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import LoginIcon from '@mui/icons-material/Login';
import LogoutIcon from '@mui/icons-material/Logout';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { NavLink } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import dayjs from 'dayjs';
import { useState } from 'react';
import { ROLES } from '../../lib/constants';
import { attendanceService } from '../../services';

const sections = [
  {
    title: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: <DashboardIcon />, allow: 'all' }],
  },
  {
    title: 'HR',
    items: [
      // Employee/department/holiday management is Super Admin only per matrix
      { to: '/employees', label: 'Employees', icon: <PeopleIcon />, allow: ['SUPER_ADMIN'] },
      { to: '/departments', label: 'Departments', icon: <GroupWorkIcon />, allow: ['SUPER_ADMIN'] },
      { to: '/shifts', label: 'Shifts', icon: <AccessTimeIcon />, allow: ['SUPER_ADMIN', 'TEAM_LEADER'] },
      { to: '/holidays', label: 'Holidays', icon: <EventIcon />, allow: ['SUPER_ADMIN'] },
    ],
  },
  {
    title: 'Time',
    items: [
      // Attendance: SUPER_ADMIN + HR (R+W) + TL (read-only)
      { to: '/attendance', label: 'Attendance', icon: <EventAvailableIcon />, allow: ['SUPER_ADMIN', 'HR_MANAGER', 'TEAM_LEADER'] },
      { to: '/my/attendance', label: 'My Attendance', icon: <BadgeIcon />, allow: ['HR_MANAGER', 'TEAM_LEADER', 'EMPLOYEE'] },
      // Leaves admin: SUPER_ADMIN + HR
      { to: '/leaves', label: 'Leaves', icon: <EventBusyIcon />, allow: ['SUPER_ADMIN', 'HR_MANAGER'] },
      { to: '/my/leaves', label: 'My Leaves', icon: <EventBusyIcon />, allow: ['HR_MANAGER', 'TEAM_LEADER', 'EMPLOYEE'] },
    ],
  },
  {
    title: 'Performance',
    items: [
      // Tasks: SUPER_ADMIN + TL
      { to: '/targets', label: 'Tasks', icon: <EmojiEventsIcon />, allow: ['SUPER_ADMIN', 'TEAM_LEADER'] },
      { to: '/my/targets', label: 'My Tasks', icon: <EmojiEventsIcon />, allow: ['HR_MANAGER', 'TEAM_LEADER', 'EMPLOYEE'] },
      // Commissions admin: Super Admin only
      { to: '/commissions', label: 'Commissions', icon: <RequestQuoteIcon />, allow: ['SUPER_ADMIN'] },
    ],
  },
  {
    title: 'Payroll',
    items: [
      // Payroll: SUPER_ADMIN + HR (HR sees read-only inside the page)
      { to: '/payroll', label: 'Payroll', icon: <ReceiptLongIcon />, allow: ['SUPER_ADMIN', 'HR_MANAGER'] },
      { to: '/my/payroll', label: 'My Payslips', icon: <ReceiptLongIcon />, allow: ['HR_MANAGER', 'TEAM_LEADER', 'EMPLOYEE'] },
    ],
  },
  {
    title: 'Insights',
    items: [
      // Reports: Super Admin only
      { to: '/reports', label: 'Reports', icon: <AssessmentIcon />, allow: ['SUPER_ADMIN'] },
    ],
  },
  {
    title: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: <SettingsIcon />, allow: ['SUPER_ADMIN'] }],
  },
];

export default function Sidebar({ onNavigate }) {
  const role = useSelector((s) => s.auth.user?.role);
  const open = useSelector((s) => s.ui.sidebarOpen);
  const qc = useQueryClient();

  const { data: todayData } = useQuery({
    queryKey: ['attendance-today'],
    queryFn: () => attendanceService.today(),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const today = todayData?.data || null;
  const isClockedIn = !!today?.clockIn && !today?.clockOut;
  const isClockedOut = !!today?.clockIn && !!today?.clockOut;

  const invalidateAttendance = () => {
    qc.invalidateQueries({ queryKey: ['attendance-today'] });
    qc.invalidateQueries({ queryKey: ['att-today'] });
    qc.invalidateQueries({ queryKey: ['att-month'] });
    qc.invalidateQueries({ queryKey: ['dash-employee'] });
    qc.invalidateQueries({ queryKey: ['dash-admin'] });
  };

  const clockInMut = useMutation({
    mutationFn: (note) => attendanceService.clockIn(note),
    onSuccess: () => { toast.success('Clocked in'); invalidateAttendance(); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Clock in failed'),
  });
  const clockOutMut = useMutation({
    mutationFn: (note) => attendanceService.clockOut(note),
    onSuccess: () => { toast.success('Clocked out'); invalidateAttendance(); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Clock out failed'),
  });

  const [noteDialog, setNoteDialog] = useState({ open: false, action: null, value: '' });
  const openNoteDialog = (action) => setNoteDialog({ open: true, action, value: '' });
  const closeNoteDialog = () => setNoteDialog({ open: false, action: null, value: '' });
  const submitNoteDialog = (withNote) => {
    const note = withNote ? noteDialog.value.trim() : '';
    if (noteDialog.action === 'in') clockInMut.mutate(note || undefined);
    else if (noteDialog.action === 'out') clockOutMut.mutate(note || undefined);
    closeNoteDialog();
  };

  const isAllowed = (allow) =>
    allow === 'all' || (Array.isArray(allow) && allow.includes(role));

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, overflow: 'auto', py: 1 }}>
        {sections.map((sec, i) => {
          const items = sec.items.filter((it) => isAllowed(it.allow));
          if (!items.length) return null;
          return (
            <Box key={i} sx={{ px: open ? 2 : 1, pb: 1 }}>
              {open && (
                <Box sx={{ fontSize: 11, fontWeight: 700, opacity: 0.55, letterSpacing: 1, px: 1, py: 1 }}>
                  {sec.title.toUpperCase()}
                </Box>
              )}
              <List sx={{ p: 0 }}>
                {items.map((it) => (
                  <Tooltip key={it.to} title={open ? '' : it.label} placement="right">
                    <ListItemButton
                      component={NavLink}
                      to={it.to}
                      end={it.to === '/'}
                      onClick={onNavigate}
                      sx={{
                        borderRadius: 2,
                        mb: 0.5,
                        px: open ? 2 : 1.4,
                        py: 1,
                        position: 'relative',
                        overflow: 'hidden',
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          left: 0,
                          top: '20%',
                          bottom: '20%',
                          width: 3,
                          borderRadius: 4,
                          background: 'linear-gradient(180deg,#5b6ef5,#a855f7)',
                          transform: 'scaleY(0)',
                          transformOrigin: 'center',
                          transition: 'transform .25s ease',
                        },
                        '&:hover': {
                          backgroundColor: (t) =>
                            t.palette.mode === 'light'
                              ? 'rgba(91,110,245,0.08)'
                              : 'rgba(91,110,245,0.14)',
                          transform: open ? 'translateX(3px)' : 'none',
                        },
                        '&.active': {
                          background: 'linear-gradient(135deg, rgba(91,110,245,0.15), rgba(168,85,247,0.15))',
                          color: 'primary.main',
                          '& .MuiListItemIcon-root': { color: 'primary.main' },
                          '&::before': { transform: 'scaleY(1)' },
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 36, transition: 'transform .2s ease' }}>{it.icon}</ListItemIcon>
                      {open && <ListItemText primary={it.label} primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }} />}
                    </ListItemButton>
                  </Tooltip>
                ))}
              </List>
              {i < sections.length - 1 && open && <Divider sx={{ my: 1, opacity: 0.5 }} />}
            </Box>
          );
        })}
      </Box>

      <Box
        sx={{
          p: open ? 2 : 1,
          borderTop: (t) => `1px solid ${t.palette.divider}`,
          background: (t) =>
            t.palette.mode === 'light'
              ? 'linear-gradient(135deg, rgba(91,110,245,0.05), rgba(168,85,247,0.05))'
              : 'linear-gradient(135deg, rgba(91,110,245,0.10), rgba(168,85,247,0.10))',
        }}
      >
        {open ? (
          <Stack spacing={1.2}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Box sx={{ fontSize: 11, fontWeight: 700, opacity: 0.6, letterSpacing: 1 }}>ATTENDANCE</Box>
              <Chip
                size="small"
                icon={<FiberManualRecordIcon sx={{ fontSize: 10 }} />}
                label={isClockedIn ? 'Active' : isClockedOut ? 'Done' : 'Off'}
                color={isClockedIn ? 'success' : isClockedOut ? 'default' : 'warning'}
                sx={{ height: 22, fontSize: 10, fontWeight: 700 }}
              />
            </Stack>
            <Box sx={{ fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
              {today?.clockIn ? (
                <>
                  In: <b>{dayjs(today.clockIn).format('HH:mm')}</b>
                  {today.clockOut ? <> · Out: <b>{dayjs(today.clockOut).format('HH:mm')}</b></> : null}
                </>
              ) : (
                'Not clocked in yet'
              )}
            </Box>
            <Button
              fullWidth
              variant="contained"
              color="success"
              size="small"
              startIcon={<LoginIcon />}
              disabled={isClockedIn || isClockedOut || clockInMut.isPending}
              onClick={() => openNoteDialog('in')}
              sx={{ fontWeight: 700, textTransform: 'none' }}
            >
              {clockInMut.isPending ? 'Clocking in…' : 'Clock In'}
            </Button>
            <Button
              fullWidth
              variant="contained"
              color="error"
              size="small"
              startIcon={<LogoutIcon />}
              disabled={!isClockedIn || clockOutMut.isPending}
              onClick={() => openNoteDialog('out')}
              sx={{ fontWeight: 700, textTransform: 'none' }}
            >
              {clockOutMut.isPending ? 'Clocking out…' : 'Clock Out'}
            </Button>
          </Stack>
        ) : (
          <Stack spacing={1} alignItems="center">
            <Tooltip title={isClockedIn || isClockedOut ? 'Already clocked in' : 'Clock In'} placement="right">
              <span>
                <Button
                  variant="contained"
                  color="success"
                  size="small"
                  disabled={isClockedIn || isClockedOut || clockInMut.isPending}
                  onClick={() => openNoteDialog('in')}
                  sx={{ minWidth: 0, p: 1, borderRadius: 2 }}
                >
                  <LoginIcon fontSize="small" />
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={!isClockedIn ? 'Clock in first' : 'Clock Out'} placement="right">
              <span>
                <Button
                  variant="contained"
                  color="error"
                  size="small"
                  disabled={!isClockedIn || clockOutMut.isPending}
                  onClick={() => openNoteDialog('out')}
                  sx={{ minWidth: 0, p: 1, borderRadius: 2 }}
                >
                  <LogoutIcon fontSize="small" />
                </Button>
              </span>
            </Tooltip>
          </Stack>
        )}
      </Box>
      <Dialog open={noteDialog.open} onClose={closeNoteDialog} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>
          {noteDialog.action === 'in' ? 'Clock In' : 'Clock Out'} — leave a note?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Do you want to leave a note? It will be visible to the Super Admin only. You can skip this if you don't want to add one.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            label="Note (optional)"
            placeholder="Anything you'd like the Super Admin to know…"
            value={noteDialog.value}
            onChange={(e) => setNoteDialog((s) => ({ ...s, value: e.target.value }))}
            inputProps={{ maxLength: 500 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeNoteDialog}>Cancel</Button>
          <Button onClick={() => submitNoteDialog(false)} color="inherit">Skip</Button>
          <Button
            variant="contained"
            disabled={!noteDialog.value.trim()}
            onClick={() => submitNoteDialog(true)}
          >
            Submit with note
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
