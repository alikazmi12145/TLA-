import { Card, CardContent, Stack, IconButton, Box, Typography, Button, Chip, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import { notificationService } from '../../services';

const ROUTE_FOR = {
  TARGET_ASSIGNED: (n, role) => `${role === 'EMPLOYEE' ? '/my/targets' : '/targets'}${n.meta?.targetId ? `?focus=${n.meta.targetId}` : ''}`,
  TARGET_UPDATED: (n, role) => `${role === 'EMPLOYEE' ? '/my/targets' : '/targets'}${n.meta?.targetId ? `?focus=${n.meta.targetId}` : ''}`,
  LEAVE_APPROVED: (_n, role) => (role === 'EMPLOYEE' ? '/my/leaves' : '/leaves'),
  LEAVE_REJECTED: (_n, role) => (role === 'EMPLOYEE' ? '/my/leaves' : '/leaves'),
  LEAVE_APPLIED: () => '/leaves',
  COMMISSION_ADDED: (_n, role) => (role === 'EMPLOYEE' ? '/my/payroll' : '/commissions'),
  SALARY: (_n, role) => (role === 'EMPLOYEE' ? '/my/payroll' : '/payroll'),
  PAYROLL: (_n, role) => (role === 'EMPLOYEE' ? '/my/payroll' : '/payroll'),
  ATTENDANCE: () => '/my/attendance',
  ATTENDANCE_CLOCK_IN: (_n, role) => (role === 'EMPLOYEE' ? '/my/attendance' : '/attendance'),
  ATTENDANCE_CLOCK_OUT: (_n, role) => (role === 'EMPLOYEE' ? '/my/attendance' : '/attendance'),
};

const routeForNotification = (n, role) => {
  const fn = ROUTE_FOR[n.type];
  return fn ? fn(n, role) : null;
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useSelector((s) => s.auth.user);
  const role = me?.role;
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', me?._id],
    queryFn: () => notificationService.list(),
    enabled: !!me?._id,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const onMarkRead = async (id) => {
    try { await notificationService.markRead(id); qc.invalidateQueries({ queryKey: ['notifications'] }); }
    catch {}
  };
  const onMarkAll = async () => {
    try { await notificationService.markAllRead(); toast.success('All marked as read'); qc.invalidateQueries({ queryKey: ['notifications'] }); }
    catch {}
  };
  const onDelete = async (id) => {
    try { await notificationService.remove(id); qc.invalidateQueries({ queryKey: ['notifications'] }); }
    catch {}
  };

  const onOpen = (n) => {
    if (!n.isRead) onMarkRead(n._id);
    const dest = routeForNotification(n, role);
    if (dest) navigate(dest);
  };

  const items = data?.data?.items || [];
  const unread = data?.data?.unread ?? items.filter((n) => !n.isRead).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `You have ${unread} unread notification${unread > 1 ? 's' : ''}` : 'You are all caught up'}
        actions={<Button startIcon={<DoneAllIcon />} variant="outlined" onClick={onMarkAll} disabled={!unread}>Mark all read</Button>}
      />
      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (items.length ? (
          <Stack spacing={1.2}>
            {items.map((n) => {
              const dest = routeForNotification(n, role);
              const clickable = !!dest;
              return (
                <Box
                  key={n._id}
                  onClick={() => clickable ? onOpen(n) : (!n.isRead && onMarkRead(n._id))}
                  sx={{
                    p: 2, borderRadius: 2,
                    cursor: clickable || !n.isRead ? 'pointer' : 'default',
                    bgcolor: n.isRead ? 'transparent' : 'action.hover',
                    border: '1px solid', borderColor: 'divider',
                    transition: 'all .2s',
                    '&:hover': clickable
                      ? {
                          transform: 'translateY(-2px)',
                          boxShadow: 3,
                          borderColor: 'primary.main',
                          bgcolor: (t) => t.palette.mode === 'light' ? 'rgba(91,110,245,0.05)' : 'rgba(91,110,245,0.12)',
                        }
                      : { transform: 'translateY(-1px)', boxShadow: 1 },
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{n.title}</Typography>
                        {!n.isRead && <Chip size="small" label="New" color="primary" />}
                        {n.type && <Chip size="small" label={n.type} variant="outlined" />}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">{n.message}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        {dayjs(n.createdAt).format('MMM D, YYYY · HH:mm')}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {clickable && (
                        <Tooltip title="Open details">
                          <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); onOpen(n); }}>
                            <ArrowForwardIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); onDelete(n._id); }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        ) : <Empty title="No notifications" subtitle="You'll see updates here when something happens." />)}
      </CardContent></Card>
    </>
  );
}
