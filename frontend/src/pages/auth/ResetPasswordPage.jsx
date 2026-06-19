import { Box, Card, CardContent, TextField, Button, Typography, Stack } from '@mui/material';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { authService } from '../../services';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const { register, handleSubmit, formState: { isSubmitting } } = useForm({
    defaultValues: { email: params.get('email') || '', token: params.get('token') || '' },
  });
  const navigate = useNavigate();
  const onSubmit = async (values) => {
    await authService.resetPassword(values);
    toast.success('Password reset! Please sign in.');
    navigate('/login');
  };
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, background: 'linear-gradient(135deg,#0b1020,#1a1f3d)' }}>
      <Card sx={{ width: 460, maxWidth: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>Reset password</Typography>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack spacing={2}>
              <TextField label="Email" fullWidth required {...register('email', { required: true })} />
              <TextField label="Reset token" fullWidth required {...register('token', { required: true })} />
              <TextField type="password" label="New password" fullWidth required {...register('newPassword', { required: true })} />
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Reset password'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
