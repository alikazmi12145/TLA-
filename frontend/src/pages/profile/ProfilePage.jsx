import { useEffect, useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, Avatar, Box, Typography, Divider, Chip } from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import { useForm } from 'react-hook-form';
import { useDispatch, useSelector } from 'react-redux';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { authService } from '../../services';
import { setUser } from '../../features/auth/authSlice';
import { asset, initials } from '../../lib/format';

export default function ProfilePage() {
  const dispatch = useDispatch();
  const qc = useQueryClient();
  const user = useSelector((s) => s.auth.user);
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm({
    defaultValues: { fullName: '', phone: '', cnic: '' },
  });

  useEffect(() => {
    if (user) reset({ fullName: user.fullName || '', phone: user.phone || '', cnic: user.cnic || '' });
  }, [user, reset]);

  const file = watch('profilePicture');
  useEffect(() => {
    if (file && file[0]) {
      const url = URL.createObjectURL(file[0]);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(null);
  }, [file]);

  const onSubmit = async (values) => {
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('fullName', values.fullName);
      if (values.phone) fd.append('phone', values.phone);
      if (values.cnic) fd.append('cnic', values.cnic);
      if (values.profilePicture && values.profilePicture[0]) {
        fd.append('profilePicture', values.profilePicture[0]);
      }
      const res = await authService.updateProfile(fd);
      dispatch(setUser(res.data.user));
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['dash-admin'] });
      qc.invalidateQueries({ queryKey: ['dash-employee'] });
      toast.success('Profile updated');
      setPreview(null);
    } catch {
      // interceptor toasts
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="My Profile" subtitle="Manage your personal information and profile picture" />
      <Card><CardContent sx={{ p: { xs: 2, md: 4 } }}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} alignItems={{ xs: 'center', md: 'flex-start' }}>
            <Stack alignItems="center" spacing={1.5} sx={{ minWidth: 180 }}>
              <Box sx={{ position: 'relative' }}>
                <Avatar
                  src={preview || asset(user?.profilePicture)}
                  sx={{
                    width: 140, height: 140, fontSize: 48, fontWeight: 700,
                    bgcolor: 'primary.main',
                    boxShadow: '0 8px 30px rgba(91,110,245,0.35)',
                  }}
                >
                  {initials(user?.fullName)}
                </Avatar>
                <Button
                  component="label"
                  variant="contained"
                  size="small"
                  startIcon={<PhotoCameraIcon />}
                  sx={{
                    position: 'absolute', bottom: -8, right: -8,
                    minWidth: 0, borderRadius: '50%', width: 44, height: 44,
                    background: 'linear-gradient(135deg,#5b6ef5,#a855f7)',
                    '& .MuiButton-startIcon': { m: 0 },
                  }}
                >
                  <input type="file" hidden accept="image/*" {...register('profilePicture')} />
                </Button>
              </Box>
              <Box textAlign="center">
                <Typography variant="h6" fontWeight={700}>{user?.fullName}</Typography>
                <Typography variant="caption" color="text.secondary">{user?.email}</Typography>
              </Box>
              <Chip size="small" label={user?.role?.replace('_', ' ')} color="primary" variant="outlined" />
            </Stack>

            <Box sx={{ flex: 1, width: '100%' }}>
              <Typography variant="overline" color="text.secondary">Personal Information</Typography>
              <Divider sx={{ mb: 2, mt: 0.5 }} />
              <Stack spacing={2}>
                <TextField
                  label="Full Name"
                  fullWidth
                  error={!!errors.fullName}
                  helperText={errors.fullName?.message}
                  {...register('fullName', { required: 'Full name is required', minLength: { value: 2, message: 'Too short' } })}
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField label="Phone" fullWidth {...register('phone')} />
                  <TextField label="CNIC" fullWidth {...register('cnic')} />
                </Stack>
                <TextField label="Email" fullWidth value={user?.email || ''} disabled helperText="Contact HR to change your email" />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField label="Employee ID" fullWidth value={user?.employeeId || ''} disabled />
                  <TextField label="Designation" fullWidth value={user?.designation || ''} disabled />
                </Stack>
              </Stack>

              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
                <Button type="submit" size="large" variant="contained" disabled={submitting}
                  sx={{ background: 'linear-gradient(135deg,#5b6ef5,#a855f7)' }}>
                  {submitting ? 'Saving…' : 'Save changes'}
                </Button>
              </Stack>
            </Box>
          </Stack>
        </form>
      </CardContent></Card>
    </>
  );
}
