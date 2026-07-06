import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Chip, Stack, Typography, Box, Divider,
} from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import PushPinIcon from '@mui/icons-material/PushPin';
import ScheduleIcon from '@mui/icons-material/Schedule';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import PersonIcon from '@mui/icons-material/Person';
import dayjs from 'dayjs';

const PRIORITY_META = {
  URGENT:  { color: 'error',   label: 'Urgent'    },
  WARNING: { color: 'warning', label: 'Notice'    },
  SUCCESS: { color: 'success', label: 'Good news' },
  INFO:    { color: 'info',    label: 'Info'      },
};

/**
 * Modal that shows the full announcement content. Reused from the employee
 * dashboard card and the My Announcements page so the detail view stays
 * consistent everywhere.
 */
export default function AnnouncementDetailDialog({ open, announcement, onClose }) {
  const a = announcement || {};
  const meta = PRIORITY_META[a.priority] || PRIORITY_META.INFO;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {a.pinned ? <PushPinIcon color="primary" /> : <CampaignIcon color="primary" />}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={800} noWrap title={a.title}>
              {a.title || 'Announcement'}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              <Chip size="small" color={meta.color} label={meta.label} />
              {a.pinned && <Chip size="small" variant="outlined" label="Pinned" />}
            </Stack>
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', mb: 2 }}>
          {a.message}
        </Typography>

        <Divider sx={{ mb: 1.5 }} />

        <Stack spacing={0.75}>
          {a.createdBy?.fullName && (
            <Stack direction="row" spacing={1} alignItems="center">
              <PersonIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                Posted by <strong>{a.createdBy.fullName}</strong>
              </Typography>
            </Stack>
          )}
          {(a.publishAt || a.createdAt) && (
            <Stack direction="row" spacing={1} alignItems="center">
              <ScheduleIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                Published {dayjs(a.publishAt || a.createdAt).format('MMM D, YYYY · HH:mm')}
              </Typography>
            </Stack>
          )}
          {a.expiresAt && (
            <Stack direction="row" spacing={1} alignItems="center">
              <EventBusyIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                Valid until {dayjs(a.expiresAt).format('MMM D, YYYY · HH:mm')}
              </Typography>
            </Stack>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button variant="contained" onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
