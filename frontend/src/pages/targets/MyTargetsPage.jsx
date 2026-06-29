import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, Box, Stack, Chip, LinearProgress, Typography, Grid, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField } from '@mui/material';
import NotesIcon from '@mui/icons-material/Notes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import dayjs from 'dayjs';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import { targetService } from '../../services';

const completion = (t) => (t.targetValue ? (t.achievedValue / t.targetValue) * 100 : 0);
const fmtDate = (d) => dayjs(d).format('MMM D, YYYY');

export default function MyTargetsPage() {
  const me = useSelector((s) => s.auth.user);
  const [params] = useSearchParams();
  const focusId = params.get('focus');
  const focusRef = useRef(null);

  const queryClient = useQueryClient();
  const [noteFor, setNoteFor] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['my-targets', me?._id],
    queryFn: targetService.mine,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const items = data?.data || [];

  useEffect(() => {
    if (focusId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusId, items.length]);

  const summary = items.reduce(
    (acc, t) => {
      acc.total += t.targetValue || 0;
      acc.achieved += t.achievedValue || 0;
      if (completion(t) >= 100) acc.completed += 1;
      else acc.pending += 1;
      return acc;
    },
    { total: 0, achieved: 0, completed: 0, pending: 0 }
  );
  const overallPct = summary.total ? Math.min(100, (summary.achieved / summary.total) * 100) : 0;

  const periodColor = (t) => {
    const pct = completion(t);
    if (pct >= 100) return 'success';
    if (pct >= 50) return 'warning';
    return 'error';
  };

  return (
    <>
      <PageHeader
        title="My Tasks"
        subtitle={me ? `Performance summary for ${me.fullName}` : ''}
      />

      <Grid container spacing={2} sx={{ mb: 2 }} className="stagger">
        <Grid item xs={6} md={3}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.6 }}>OVERALL</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{overallPct.toFixed(1)}%</Typography>
            <LinearProgress
              variant="determinate"
              value={overallPct}
              sx={{ mt: 1, height: 8, borderRadius: 4 }}
            />
          </CardContent></Card>
        </Grid>
        <Grid item xs={6} md={3}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.6 }}>TOTAL TASK</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{summary.total}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid item xs={6} md={3}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.6 }}>ACHIEVED</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{summary.achieved}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid item xs={6} md={3}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.6 }}>COMPLETED / PENDING</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              {summary.completed}
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, fontSize: 18 }}> / {summary.pending}</Box>
            </Typography>
          </CardContent></Card>
        </Grid>
      </Grid>

      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (items.length ? (
          <Stack spacing={1.5}>
            {items.map((t) => {
              const pct = Math.min(100, completion(t));
              const isFocus = focusId === t._id;
              return (
                <Box
                  key={t._id}
                  ref={isFocus ? focusRef : null}
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: isFocus ? 'primary.main' : 'divider',
                    transition: 'all .25s ease',
                    background: isFocus
                      ? (th) => (th.palette.mode === 'light' ? 'rgba(91,110,245,0.06)' : 'rgba(91,110,245,0.12)')
                      : 'transparent',
                    '&:hover': { transform: 'translateY(-2px)', boxShadow: 1 },
                  }}
                >
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ mb: 1 }}>
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip size="small" label={t.type === 'DAILY' ? 'ONCE' : t.type} color="primary" variant="outlined" />
                        <Typography variant="body2" color="text.secondary">
                          {fmtDate(t.periodStart)} → {fmtDate(t.periodEnd)}
                        </Typography>
                      </Stack>
                      {t.note && (
                        <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
                          <Box component="span" sx={{ fontWeight: 600, mr: 0.5 }}>Admin:</Box>{t.note}
                        </Typography>
                      )}
                      {t.employeeNote && (
                        <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85, color: 'warning.main' }}>
                          <Box component="span" sx={{ fontWeight: 600, mr: 0.5 }}>Your note:</Box>{t.employeeNote}
                        </Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="caption" color="text.secondary">Task</Typography>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t.targetValue}</Typography>
                      </Box>
                      <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="caption" color="text.secondary">Achieved</Typography>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t.achievedValue}</Typography>
                      </Box>
                      {t.status === 'COMPLETED' ? (
                        <Chip
                          label="Completed"
                          color="success"
                          sx={{ fontWeight: 700, minWidth: 76 }}
                        />
                      ) : t.status === 'EXPIRED' ? (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            label="Expired"
                            color="default"
                            sx={{ fontWeight: 700, minWidth: 76 }}
                          />
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            startIcon={<NotesIcon fontSize="small" />}
                            onClick={() => { setNoteFor(t); setNoteText(t.employeeNote || ''); }}
                          >
                            {t.employeeNote ? 'Edit note' : 'Add note'}
                          </Button>
                        </Stack>
                      ) : (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            onClick={async () => {
                              try {
                                await targetService.complete(t._id);
                                await queryClient.invalidateQueries({ queryKey: ['my-targets', me?._id] });
                                toast.success('Task marked complete!');
                              } catch (err) {
                                toast.error(err?.response?.data?.message || 'Failed to mark task complete');
                              }
                            }}
                            sx={{ fontWeight: 700, minWidth: 76 }}
                          >
                            Mark Done
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            startIcon={<NotesIcon fontSize="small" />}
                            onClick={() => { setNoteFor(t); setNoteText(t.employeeNote || ''); }}
                          >
                            {t.employeeNote ? 'Edit note' : 'Add note'}
                          </Button>
                        </Stack>
                      )}
                    </Stack>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={pct}
                    color={periodColor(t)}
                    sx={{ height: 8, borderRadius: 4 }}
                  />
                </Box>
              );
            })}
          </Stack>
        ) : <Empty title="No tasks yet" subtitle="Your manager will assign performance tasks here." />)}
      </CardContent></Card>

      <Dialog open={!!noteFor} onClose={() => !savingNote && setNoteFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Note for admin</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary">
            Explain why this task was not completed on time. Your admin will be notified.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={4}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="E.g. I was on approved leave / system was down / waiting on data from another team…"
            sx={{ mt: 1.5 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setNoteFor(null)} disabled={savingNote}>Cancel</Button>
          <Button
            variant="contained"
            disabled={savingNote || !noteText.trim()}
            onClick={async () => {
              if (!noteFor) return;
              setSavingNote(true);
              try {
                await targetService.addEmployeeNote(noteFor._id, noteText.trim());
                await queryClient.invalidateQueries({ queryKey: ['my-targets', me?._id] });
                toast.success('Note sent to admin');
                setNoteFor(null);
              } catch (err) {
                toast.error(err?.response?.data?.message || 'Failed to save note');
              } finally {
                setSavingNote(false);
              }
            }}
          >
            {savingNote ? 'Saving…' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
