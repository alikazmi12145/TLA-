import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Card, CardContent, Typography, Stack, Chip, Box, Divider, Alert, IconButton, Button, Tooltip,
} from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import PushPinIcon from '@mui/icons-material/PushPin';
import CloseIcon from '@mui/icons-material/Close';
import UndoIcon from '@mui/icons-material/Undo';
import dayjs from 'dayjs';

import { announcementService } from '../../services';
import AnnouncementDetailDialog from './AnnouncementDetailDialog';

const PRIORITY_META = {
  URGENT:  { color: 'error',   label: 'Urgent'  },
  WARNING: { color: 'warning', label: 'Notice'  },
  SUCCESS: { color: 'success', label: 'Good news' },
  INFO:    { color: 'info',    label: 'Info'    },
};

const ALERT_SEVERITY = { URGENT: 'error', WARNING: 'warning', SUCCESS: 'success', INFO: 'info' };

// Per-user localStorage key: dismissed announcements are hidden from THIS
// dashboard widget only; the "My Announcements" page still shows them.
const dismissKey = (userId) => `tla-hrms:announcements:dismissed:${userId || 'anon'}`;

const readDismissed = (userId) => {
  try {
    const raw = localStorage.getItem(dismissKey(userId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
};
const writeDismissed = (userId, set) => {
  try { localStorage.setItem(dismissKey(userId), JSON.stringify([...set])); }
  catch { /* quota / disabled — fail silently */ }
};

/**
 * AnnouncementsCard — shown on every dashboard.
 * Renders the caller's active announcement feed (audience-filtered on the
 * server). Pinned + higher-priority items float to the top.
 * Users can dismiss an item from the dashboard; dismissed items are kept
 * in localStorage and remain visible on the "My Announcements" page.
 */
export default function AnnouncementsCard({ limit = 5 }) {
  const userId = useSelector((s) => s.auth.user?._id);
  const [selected, setSelected] = useState(null);
  const [dismissed, setDismissed] = useState(() => readDismissed(userId));

  // Re-hydrate when the logged-in user changes (login / logout / switch).
  useEffect(() => { setDismissed(readDismissed(userId)); }, [userId]);

  const { data, isLoading } = useQuery({
    queryKey: ['announcements-feed', limit],
    queryFn: () => announcementService.feed(limit),
    refetchInterval: 60_000,
  });
  const items = data?.data || [];
  const visible = useMemo(() => items.filter((a) => !dismissed.has(a._id)), [items, dismissed]);
  const hiddenCount = items.length - visible.length;

  const dismiss = (id) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    writeDismissed(userId, next);
  };
  const restoreAll = () => {
    const next = new Set();
    setDismissed(next);
    writeDismissed(userId, next);
  };

  // Nothing to show → hide the entire card from the dashboard.
  // Users can still see everything on the "My Announcements" page.
  if (!isLoading && !visible.length) return null;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
          <CampaignIcon color="primary" />
          <Typography variant="h6" fontWeight={800}>Announcements</Typography>
          <Box sx={{ flex: 1 }} />
          {hiddenCount > 0 && (
            <Tooltip title="Restore dismissed announcements">
              <Button size="small" startIcon={<UndoIcon />} onClick={restoreAll}>
                Show {hiddenCount} hidden
              </Button>
            </Tooltip>
          )}
          <Chip size="small" label={visible.length} color="primary" variant="outlined" />
        </Stack>

        <Stack spacing={1.5}>
          {visible.map((a, idx) => {
            const meta = PRIORITY_META[a.priority] || PRIORITY_META.INFO;
            const severity = ALERT_SEVERITY[a.priority] || 'info';
            return (
              <Box key={a._id}>
                <Alert
                  severity={severity}
                  variant="outlined"
                  icon={a.pinned ? <PushPinIcon fontSize="small" /> : undefined}
                  onClick={() => setSelected(a)}
                  action={
                    <Tooltip title="Dismiss from dashboard">
                      <IconButton
                        size="small"
                        aria-label="Dismiss announcement"
                        onClick={(e) => { e.stopPropagation(); dismiss(a._id); }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                  sx={{
                    cursor: 'pointer',
                    transition: 'transform .15s ease, box-shadow .15s ease',
                    '&:hover': { transform: 'translateY(-1px)', boxShadow: 2 },
                    '& .MuiAlert-message': { width: '100%' },
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                    <Typography variant="subtitle2" fontWeight={800}>{a.title}</Typography>
                    <Chip size="small" color={meta.color} label={meta.label} />
                    {a.pinned && <Chip size="small" variant="outlined" label="Pinned" />}
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{
                      whiteSpace: 'pre-wrap',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {a.message}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {a.createdBy?.fullName ? `${a.createdBy.fullName} · ` : ''}
                      {dayjs(a.publishAt || a.createdAt).format('MMM D, YYYY HH:mm')}
                      {a.expiresAt ? ` · until ${dayjs(a.expiresAt).format('MMM D')}` : ''}
                    </Typography>
                    <Typography variant="caption" color="primary.main" fontWeight={700}>
                      Read more →
                    </Typography>
                  </Stack>
                </Alert>
                {idx < visible.length - 1 && <Divider sx={{ mt: 1.5, opacity: 0 }} />}
              </Box>
            );
          })}
        </Stack>
      </CardContent>

      <AnnouncementDetailDialog
        open={!!selected}
        announcement={selected}
        onClose={() => setSelected(null)}
      />
    </Card>
  );
}
