import { useQuery } from '@tanstack/react-query';
import {
  Card, CardContent, Typography, Stack, Chip, Box, Alert, TextField, MenuItem, Grid,
} from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import PushPinIcon from '@mui/icons-material/PushPin';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';

import PageHeader from '../../components/common/PageHeader';
import { Empty, Loading } from '../../components/common/States';
import AnnouncementDetailDialog from '../../components/common/AnnouncementDetailDialog';
import { announcementService } from '../../services';

const PRIORITY_META = {
  URGENT:  { color: 'error',   label: 'Urgent',    severity: 'error'   },
  WARNING: { color: 'warning', label: 'Notice',    severity: 'warning' },
  SUCCESS: { color: 'success', label: 'Good news', severity: 'success' },
  INFO:    { color: 'info',    label: 'Info',      severity: 'info'    },
};

export default function MyAnnouncementsPage() {
  const [priority, setPriority] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-announcements'],
    queryFn: () => announcementService.feed(50),
    refetchInterval: 60_000,
  });

  const items = data?.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((a) => {
      if (priority !== 'ALL' && a.priority !== priority) return false;
      if (q && !(a.title.toLowerCase().includes(q) || a.message.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [items, priority, search]);

  return (
    <>
      <PageHeader
        title="My Announcements"
        subtitle="Company-wide updates and messages targeted at you"
      />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <TextField
                select fullWidth size="small" label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <MenuItem value="ALL">All priorities</MenuItem>
                {Object.keys(PRIORITY_META).map((p) => (
                  <MenuItem key={p} value={p}>{PRIORITY_META[p].label}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth size="small" label="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Title or message contains…"
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <Chip
                color="primary" variant="outlined"
                label={`${filtered.length} of ${items.length}`}
                sx={{ width: '100%' }}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {isLoading && <Loading />}

      {!isLoading && !filtered.length && (
        <Card>
          <CardContent>
            <Empty
              title={items.length ? 'No announcements match your filters' : 'No announcements right now'}
              subtitle={items.length ? 'Try clearing the filters above.' : "You'll see company-wide updates here."}
            />
          </CardContent>
        </Card>
      )}

      <Stack spacing={2}>
        {filtered.map((a) => {
          const meta = PRIORITY_META[a.priority] || PRIORITY_META.INFO;
          return (
            <Alert
              key={a._id}
              severity={meta.severity}
              variant="outlined"
              icon={a.pinned ? <PushPinIcon fontSize="small" /> : <CampaignIcon fontSize="small" />}
              onClick={() => setSelected(a)}
              sx={{
                cursor: 'pointer',
                transition: 'transform .15s ease, box-shadow .15s ease',
                '&:hover': { transform: 'translateY(-1px)', boxShadow: 3 },
                '& .MuiAlert-message': { width: '100%' },
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                <Typography variant="subtitle1" fontWeight={800}>{a.title}</Typography>
                <Chip size="small" color={meta.color} label={meta.label} />
                {a.pinned && <Chip size="small" variant="outlined" label="Pinned" />}
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {dayjs(a.publishAt || a.createdAt).format('MMM D, YYYY HH:mm')}
                </Typography>
              </Stack>
              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  mb: 0.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {a.message}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">
                  {a.createdBy?.fullName ? `Posted by ${a.createdBy.fullName}` : 'Posted by admin'}
                  {a.expiresAt ? ` · valid until ${dayjs(a.expiresAt).format('MMM D, YYYY')}` : ''}
                </Typography>
                <Typography variant="caption" color="primary.main" fontWeight={700}>
                  Click to read more →
                </Typography>
              </Stack>
            </Alert>
          );
        })}
      </Stack>

      <AnnouncementDetailDialog
        open={!!selected}
        announcement={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
