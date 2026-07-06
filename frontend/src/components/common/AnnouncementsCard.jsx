import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Card, CardContent, Typography, Stack, Chip, Box, Divider, Alert,
} from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import PushPinIcon from '@mui/icons-material/PushPin';
import dayjs from 'dayjs';

import { announcementService } from '../../services';
import { Empty } from './States';
import AnnouncementDetailDialog from './AnnouncementDetailDialog';

const PRIORITY_META = {
  URGENT:  { color: 'error',   label: 'Urgent'  },
  WARNING: { color: 'warning', label: 'Notice'  },
  SUCCESS: { color: 'success', label: 'Good news' },
  INFO:    { color: 'info',    label: 'Info'    },
};

const ALERT_SEVERITY = { URGENT: 'error', WARNING: 'warning', SUCCESS: 'success', INFO: 'info' };

/**
 * AnnouncementsCard — shown on every dashboard.
 * Renders the caller's active announcement feed (audience-filtered on the
 * server). Pinned + higher-priority items float to the top.
 */
export default function AnnouncementsCard({ limit = 5 }) {
  const [selected, setSelected] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ['announcements-feed', limit],
    queryFn: () => announcementService.feed(limit),
    refetchInterval: 60_000,
  });
  const items = data?.data || [];

  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
          <CampaignIcon color="primary" />
          <Typography variant="h6" fontWeight={800}>Announcements</Typography>
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label={items.length} color="primary" variant="outlined" />
        </Stack>

        {!items.length && !isLoading && (
          <Empty title="No announcements right now" subtitle="You'll see company-wide updates here." />
        )}

        <Stack spacing={1.5}>
          {items.map((a, idx) => {
            const meta = PRIORITY_META[a.priority] || PRIORITY_META.INFO;
            const severity = ALERT_SEVERITY[a.priority] || 'info';
            return (
              <Box key={a._id}>
                <Alert
                  severity={severity}
                  variant="outlined"
                  icon={a.pinned ? <PushPinIcon fontSize="small" /> : undefined}
                  onClick={() => setSelected(a)}
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
                {idx < items.length - 1 && <Divider sx={{ mt: 1.5, opacity: 0 }} />}
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
