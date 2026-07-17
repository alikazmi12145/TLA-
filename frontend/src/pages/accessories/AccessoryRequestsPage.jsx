import { useState } from 'react';
import {
  Card, CardContent, Stack, TextField, Button, MenuItem, Box, Chip, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Typography, TablePagination, Divider, Grid,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RefreshIcon from '@mui/icons-material/Refresh';
import dayjs from 'dayjs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import { accessoryService } from '../../services';
import { ACCESSORY_REQUEST_STATUS, statusColor } from './constants';

export default function AccessoryRequestsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ status: '', q: '' });
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const [action, setAction] = useState(null); // { id, kind }
  const [remarks, setRemarks] = useState('');
  const [detail, setDetail] = useState(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['accessory-requests', filters, page, limit],
    queryFn: () => accessoryService.requests({ ...filters, page: page + 1, limit }),
    keepPreviousData: true,
  });
  const items = data?.data || [];
  const total = data?.meta?.total ?? items.length;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['accessory-requests'] });
    qc.invalidateQueries({ queryKey: ['accessories'] });
    qc.invalidateQueries({ queryKey: ['my-accessory-requests'] });
  };

  const mut = useMutation({
    mutationFn: async ({ id, kind, remarks: r }) => {
      const body = r ? { remarks: r } : undefined;
      if (kind === 'APPROVED') return accessoryService.approve(id, body);
      if (kind === 'REJECTED') return accessoryService.reject(id, body);
      if (kind === 'ISSUED') return accessoryService.issue(id, body);
      if (kind === 'COMPLETED') return accessoryService.complete(id, body);
      return null;
    },
    onSuccess: (_res, vars) => {
      toast.success(`Request ${vars.kind.toLowerCase()}`);
      setAction(null); setRemarks(''); invalidate();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Action failed'),
  });

  const openAction = (id, kind) => { setAction({ id, kind }); setRemarks(''); };
  const submitAction = () => mut.mutate({ ...action, remarks });

  return (
    <>
      <PageHeader
        title="Accessory Requests"
        subtitle="Approve, reject, or issue employee accessory requests"
        actions={
          <Tooltip title="Refresh">
            <span>
              <IconButton onClick={() => refetch()} disabled={isFetching}>
                <RefreshIcon sx={isFetching ? { animation: 'spin 1s linear infinite' } : {}} />
              </IconButton>
            </span>
          </Tooltip>
        }
      />

      <Card sx={{ mb: 2 }}><CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <TextField size="small" label="Search employee / accessory" sx={{ minWidth: 260 }} value={filters.q}
            onChange={(e) => { setPage(0); setFilters({ ...filters, q: e.target.value }); }} />
          <TextField select size="small" label="Status" sx={{ minWidth: 200 }} value={filters.status}
            onChange={(e) => { setPage(0); setFilters({ ...filters, status: e.target.value }); }}>
            <MenuItem value="">All</MenuItem>
            {Object.values(ACCESSORY_REQUEST_STATUS).map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
        </Stack>
      </CardContent></Card>

      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (items.length ? (
          <>
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>
                {['Employee', 'Department', 'Accessory', 'Qty', 'Requested', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ fontWeight: 600 }}>{r.employee?.fullName}</div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>{r.employee?.employeeId || r.employee?.email}</div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>{r.department?.name || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <div>{r.accessory?.name}</div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>{r.accessory?.code}</div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>{r.quantity}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12 }}>{dayjs(r.requestedAt || r.createdAt).format('MMM D, YYYY HH:mm')}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <Chip size="small" label={r.status} color={statusColor[r.status]} />
                    </td>
                    <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                      <Tooltip title="Details"><IconButton size="small" onClick={() => setDetail(r)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
                      {r.status === 'PENDING' && (
                        <>
                          <Tooltip title="Approve"><IconButton size="small" color="success" onClick={() => openAction(r._id, 'APPROVED')}><CheckIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title="Reject"><IconButton size="small" color="error" onClick={() => openAction(r._id, 'REJECTED')}><CloseIcon fontSize="small" /></IconButton></Tooltip>
                        </>
                      )}
                      {(r.status === 'PENDING' || r.status === 'APPROVED') && (
                        <Tooltip title="Issue"><IconButton size="small" color="primary" onClick={() => openAction(r._id, 'ISSUED')}><LocalShippingIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                      {r.status === 'APPROVED' && (
                        <Tooltip title="Reject"><IconButton size="small" color="error" onClick={() => openAction(r._id, 'REJECTED')}><CloseIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                      {r.status === 'ISSUED' && (
                        <Tooltip title="Mark completed"><IconButton size="small" color="success" onClick={() => openAction(r._id, 'COMPLETED')}><DoneAllIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
          <TablePagination
            component="div" count={total} page={page}
            onPageChange={(_e, p) => setPage(p)}
            rowsPerPage={limit}
            onRowsPerPageChange={(e) => { setLimit(Number(e.target.value)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
          </>
        ) : <Empty title="No requests" subtitle="Employee requests will appear here." />)}
      </CardContent></Card>

      <Dialog open={!!action} onClose={() => setAction(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{actionTitle(action?.kind)}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1, opacity: 0.75 }}>
            {actionDescription(action?.kind)}
          </Typography>
          <TextField label="Remarks (optional)" fullWidth multiline rows={3} value={remarks}
            onChange={(e) => setRemarks(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAction(null)} disabled={mut.isPending}>Cancel</Button>
          <Button variant="contained" disabled={mut.isPending}
            color={action?.kind === 'REJECTED' ? 'error' : action?.kind === 'ISSUED' ? 'primary' : 'success'}
            onClick={submitAction}>
            {mut.isPending ? 'Saving…' : `Confirm ${actionTitle(action?.kind)}`}
          </Button>
        </DialogActions>
      </Dialog>

      <RequestDetailsDialog open={!!detail} request={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function actionTitle(kind) {
  return { APPROVED: 'Approve', REJECTED: 'Reject', ISSUED: 'Issue', COMPLETED: 'Complete' }[kind] || '';
}
function actionDescription(kind) {
  return {
    APPROVED: 'Mark this request as approved. Stock will only be deducted once you issue the item.',
    REJECTED: 'Reject this request. The employee will be notified.',
    ISSUED: 'Deduct stock and hand the item over to the employee. This action is atomic and cannot exceed available stock.',
    COMPLETED: 'Close this request. Stock will not be returned.',
  }[kind] || '';
}

export function RequestDetailsDialog({ open, request, onClose }) {
  if (!request) return null;
  const field = (label, value) => (
    <Grid item xs={12} sm={6}>
      <Typography variant="caption" sx={{ opacity: 0.7 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value ?? '—'}</Typography>
    </Grid>
  );
  const fmt = (d) => d ? dayjs(d).format('MMM D, YYYY HH:mm') : '—';
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Request details
        <Chip size="small" sx={{ ml: 1 }} label={request.status} color={statusColor[request.status]} />
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0 }}>
          {field('Employee', request.employee?.fullName)}
          {field('Employee ID', request.employee?.employeeId)}
          {field('Department', request.department?.name)}
          {field('Accessory', `${request.accessory?.name || ''} (${request.accessory?.code || ''})`)}
          {field('Quantity', request.quantity)}
          {field('Requested at', fmt(request.requestedAt || request.createdAt))}
          <Grid item xs={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" sx={{ opacity: 0.7 }}>Note from employee</Typography>
            <Typography variant="body2">{request.note || '—'}</Typography>
          </Grid>
          {field('Approved by', request.approvedBy?.fullName)}
          {field('Approved at', fmt(request.approvedAt))}
          {field('Issued by', request.issuedBy?.fullName)}
          {field('Issued at', fmt(request.issuedAt))}
          {field('Rejected by', request.rejectedBy?.fullName)}
          {field('Rejected at', fmt(request.rejectedAt))}
          {field('Completed by', request.completedBy?.fullName)}
          {field('Completed at', fmt(request.completedAt))}
          <Grid item xs={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" sx={{ opacity: 0.7 }}>Remarks</Typography>
            <Typography variant="body2">{request.remarks || '—'}</Typography>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
