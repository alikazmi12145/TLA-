import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, MenuItem, IconButton, Tooltip, Box, Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import NotesIcon from '@mui/icons-material/Notes';
import dayjs from 'dayjs';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import useSettingsPermissions from '../../hooks/useSettingsPermissions';
import { targetService, employeeService } from '../../services';
import { TARGET_TYPES } from '../../lib/constants';

export default function TargetsPage() {
  const { canAccess } = useSettingsPermissions();
  const canManage = canAccess('targets', 'manage');
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [noteView, setNoteView] = useState(null);
  const [empNoteView, setEmpNoteView] = useState(null);
  const [params] = useSearchParams();
  const focusId = params.get('focus');
  const focusRef = useRef(null);

  const { data, isLoading } = useQuery({ queryKey: ['targets'], queryFn: () => targetService.list({}) });
  const { data: emps } = useQuery({ queryKey: ['emps-all'], queryFn: () => employeeService.list({ limit: 100 }) });
  const { data: ranking } = useQuery({ queryKey: ['target-ranking'], queryFn: targetService.ranking });
  const { register, handleSubmit, reset, control } = useForm();

  useEffect(() => {
    if (focusId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusId, data?.data?.length]);

  const startEdit = (t) => {
    setEditing(t);
    reset({
      employee: t.employee?._id || t.employee,
      type: t.type,
      periodStart: t.periodStart?.substring(0, 10),
      periodEnd: t.periodEnd?.substring(0, 10),
      targetValue: t.targetValue,
      achievedValue: t.achievedValue,
      note: t.note || '',
    });
    setOpen(true);
  };
  const startNew = () => { setEditing(null); reset({ employee: '', type: 'ONCE', periodStart: dayjs().format('YYYY-MM-DD'), periodEnd: dayjs().format('YYYY-MM-DD'), targetValue: 0, achievedValue: 0 }); setOpen(true); };

  const TYPE_LABEL = { ONCE: 'Once', WEEKLY: 'Weekly', MONTHLY: 'Monthly', DAILY: 'Once' };

  const onSubmit = async (values) => {
    try {
      if (editing) await targetService.update(editing._id, values);
      else await targetService.create(values);
      toast.success('Saved'); qc.invalidateQueries({ queryKey: ['targets'] }); setOpen(false);
    } catch {}
  };
  const onDelete = async () => {
    try { await targetService.remove(confirm._id); toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['targets'] }); }
    catch {} finally { setConfirm(null); }
  };

  return (
    <>
      <PageHeader title="Tasks" subtitle={canManage ? 'Track one-off / weekly / monthly performance tasks' : 'View task progress and notes'} actions={canManage ? <Button startIcon={<AddIcon />} variant="contained" onClick={startNew}>Set task</Button> : null} />
      <Card sx={{ mb: 2 }}><CardContent>
        <Box sx={{ fontWeight: 700, mb: 1 }}>Top Performers</Box>
        <Stack spacing={1}>
          {(ranking?.data || []).slice(0, 5).map((r, i) => (
            <Box key={r._id || i} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Box sx={{ fontWeight: 600 }}>{r.employee?.fullName}</Box>
                <Box>{r.completion?.toFixed?.(1) || 0}%</Box>
              </Stack>
              <LinearProgress variant="determinate" value={Math.min(100, r.completion || 0)} sx={{ height: 8, borderRadius: 4 }} />
            </Box>
          ))}
          {!(ranking?.data || []).length && <Empty title="No target data" />}
        </Stack>
      </CardContent></Card>

      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (data?.data?.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>{['Employee', 'Type', 'Period', 'Task', 'Achieved', 'Notes', ...(canManage ? ['Actions'] : [])].map((h) => (
                <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {data.data.map((t) => {
                  const isFocus = focusId === t._id;
                  const hasNote = !!(t.note && String(t.note).trim());
                  const hasEmpNote = !!(t.employeeNote && String(t.employeeNote).trim());
                  return (
                    <tr
                      key={t._id}
                      ref={isFocus ? focusRef : null}
                      style={{
                        borderBottom: '1px dashed rgba(0,0,0,0.08)',
                        background: isFocus ? 'rgba(91,110,245,0.10)' : 'transparent',
                        transition: 'background-color .25s ease',
                      }}
                    >
                      <td style={{ padding: '10px 8px' }}>{t.employee?.fullName}</td>
                      <td style={{ padding: '10px 8px' }}>{TYPE_LABEL[t.type] || t.type}</td>
                      <td style={{ padding: '10px 8px' }}>{dayjs(t.periodStart).format('MMM D')} → {dayjs(t.periodEnd).format('MMM D')}</td>
                      <td style={{ padding: '10px 8px' }}>{t.targetValue}</td>
                      <td style={{ padding: '10px 8px' }}>{t.achievedValue}</td>
                      <td style={{ padding: '10px 8px' }}>
                        {(hasNote || hasEmpNote) ? (
                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {hasNote && (
                              <Button
                                size="small"
                                variant="outlined"
                                color="primary"
                                startIcon={<NotesIcon fontSize="small" />}
                                onClick={() => setNoteView(t)}
                              >
                                Check Note
                              </Button>
                            )}
                            {hasEmpNote && (
                              <Button
                                size="small"
                                variant="outlined"
                                color="warning"
                                startIcon={<NotesIcon fontSize="small" />}
                                onClick={() => setEmpNoteView(t)}
                              >
                                Employee Note
                              </Button>
                            )}
                          </Stack>
                        ) : (
                          <Box component="span" sx={{ opacity: 0.5 }}>—</Box>
                        )}
                      </td>
                      {canManage && (
                        <td style={{ padding: '10px 8px' }}>
                          <Tooltip title="Edit"><IconButton size="small" onClick={() => startEdit(t)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setConfirm(t)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No targets yet" />)}
      </CardContent></Card>

      <Dialog open={open && canManage} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Task' : 'Set Task'}</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Controller
                name="employee"
                control={control}
                defaultValue=""
                rules={{ required: true }}
                render={({ field }) => (
                  <TextField select label="Employee" required fullWidth {...field} value={field.value || ''}>
                    {(emps?.data || []).map((e) => (
                      <MenuItem key={e._id} value={e._id}>{e.fullName} ({e.employeeId})</MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="type"
                control={control}
                defaultValue="ONCE"
                rules={{ required: true }}
                render={({ field }) => (
                  <TextField select label="Type" required fullWidth {...field} value={field.value || 'ONCE'}>
                    {TARGET_TYPES.map((t) => (
                      <MenuItem key={t} value={t}>{TYPE_LABEL[t] || t}</MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Stack direction="row" spacing={2}>
                <TextField type="date" label="From" InputLabelProps={{ shrink: true }} required fullWidth {...register('periodStart', { required: true })} />
                <TextField type="date" label="To" InputLabelProps={{ shrink: true }} required fullWidth {...register('periodEnd', { required: true })} />
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField type="number" label="Task value" required fullWidth {...register('targetValue', { valueAsNumber: true })} />
                <TextField type="number" label="Achieved" fullWidth {...register('achievedValue', { valueAsNumber: true })} />
              </Stack>
              <TextField label="Note" fullWidth {...register('note')} />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Save</Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog open={!!confirm && canManage} title="Delete task" message="Are you sure?" onClose={() => setConfirm(null)} onConfirm={onDelete} confirmText="Delete" danger />

      <Dialog open={!!noteView} onClose={() => setNoteView(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Admin Note</DialogTitle>
        <DialogContent>
          {noteView && (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">EMPLOYEE</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{noteView.employee?.fullName || '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">PERIOD</Typography>
                <Typography variant="body2">
                  {dayjs(noteView.periodStart).format('MMM D, YYYY')} → {dayjs(noteView.periodEnd).format('MMM D, YYYY')}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">NOTE</Typography>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>{noteView.note}</Typography>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setNoteView(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!empNoteView} onClose={() => setEmpNoteView(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Employee Note</DialogTitle>
        <DialogContent>
          {empNoteView && (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">EMPLOYEE</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{empNoteView.employee?.fullName || '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">PERIOD</Typography>
                <Typography variant="body2">
                  {dayjs(empNoteView.periodStart).format('MMM D, YYYY')} → {dayjs(empNoteView.periodEnd).format('MMM D, YYYY')}
                </Typography>
              </Box>
              {empNoteView.employeeNoteAt && (
                <Box>
                  <Typography variant="caption" color="text.secondary">SUBMITTED</Typography>
                  <Typography variant="body2">{dayjs(empNoteView.employeeNoteAt).format('MMM D, YYYY h:mm A')}</Typography>
                </Box>
              )}
              <Box>
                <Typography variant="caption" color="text.secondary">EMPLOYEE'S NOTE</Typography>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>{empNoteView.employeeNote}</Typography>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEmpNoteView(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
